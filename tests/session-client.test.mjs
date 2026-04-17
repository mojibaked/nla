import assert from "node:assert/strict";
import test from "node:test";
import { createEnvelope } from "@nla/protocol";
import {
  createSessionClient,
  NlaSessionInterruptedError
} from "@nla/host-core";

function createHarness() {
  const sent = [];
  let requestSequence = 0;
  let closed = false;
  const sessionId = "sess:compliance";

  const sessionClient = createSessionClient({
    nextRequestId: (prefix) => `${prefix}:${++requestSequence}`,
    now: () => "2026-04-16T20:00:00.000Z"
  });

  sessionClient.registerSession({
    transport: {
      sessionId,
      send: (message) => {
        sent.push(message);
      },
      close: () => {
        closed = true;
      },
      isClosed: () => closed
    }
  });

  const waitForMessage = async (index) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (sent[index]) {
        return sent[index];
      }

      await new Promise((resolve) => {
        setImmediate(resolve);
      });
    }

    assert.ok(sent[index], `expected sent message at index ${index}`);
    return sent[index];
  };

  return {
    sessionClient,
    sessionId,
    waitForMessage
  };
}

async function collect(iterable) {
  const values = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

test("host-core session client streams assistant turn events with canonical sequence metadata", async () => {
  const { sessionClient, sessionId, waitForMessage } = createHarness();

  const turnPromise = collect(
    sessionClient.sendSessionMessage({
      sessionId,
      turnId: "turn:1",
      message: {
        role: "user",
        text: "status",
        parts: [{ type: "text", text: "status" }],
        metadata: {
          clientId: "desktop:test",
          userMessageId: "msg:user:1",
          assistantMessageId: "msg:assistant:1",
          turnId: "turn:1"
        }
      }
    })
  );

  const outbound = await waitForMessage(0);
  assert.equal(outbound.type, "session.message");
  assert.equal(outbound.data.sessionId, sessionId);
  assert.equal(outbound.data.role, "user");
  assert.equal(outbound.correlationId, outbound.id);

  const correlationId = outbound.correlationId;
  sessionClient.handleMessage(sessionId, createEnvelope("session.message.delta", {
    sessionId,
    messageId: "msg:assistant:1",
    role: "assistant",
    delta: "Echo: "
  }, {
    id: "delta:1",
    correlationId,
    timestamp: "2026-04-16T20:00:01.000Z"
  }));
  sessionClient.handleMessage(sessionId, createEnvelope("session.message.delta", {
    sessionId,
    messageId: "msg:assistant:1",
    role: "assistant",
    delta: "status"
  }, {
    id: "delta:2",
    correlationId,
    timestamp: "2026-04-16T20:00:02.000Z"
  }));
  sessionClient.handleMessage(sessionId, createEnvelope("session.message", {
    sessionId,
    role: "assistant",
    text: "Echo: status"
  }, {
    id: "message:1",
    correlationId,
    timestamp: "2026-04-16T20:00:03.000Z"
  }));
  sessionClient.handleMessage(sessionId, createEnvelope("session.completed", {
    sessionId
  }, {
    id: "completed:1",
    correlationId,
    timestamp: "2026-04-16T20:00:04.000Z"
  }));

  const messages = await turnPromise;
  assert.deepEqual(
    messages.map((message) => message.type),
    ["session.message.delta", "session.message.delta", "session.message", "session.completed"]
  );
  assert.equal(messages[0].data.metadata.sequence, 1);
  assert.equal(messages[1].data.metadata.sequence, 2);
});

test("host-core session client pauses on requested interaction and resumes on interaction resolution", async () => {
  const { sessionClient, sessionId, waitForMessage } = createHarness();

  const requestPromise = collect(
    sessionClient.sendSessionMessage({
      sessionId,
      turnId: "turn:2",
      message: {
        role: "user",
        text: "deploy",
        parts: [{ type: "text", text: "deploy" }],
        metadata: {
          clientId: "desktop:test",
          userMessageId: "msg:user:2",
          assistantMessageId: "msg:assistant:2",
          turnId: "turn:2"
        }
      }
    })
  );

  const outbound = await waitForMessage(0);
  const requestCorrelationId = outbound.correlationId;

  sessionClient.handleMessage(sessionId, createEnvelope("session.interaction.requested", {
    sessionId,
    request: {
      kind: "form",
      requestId: "form:req:1",
      title: "Approval",
      options: [
        { id: "approve", label: "Approve" },
        { id: "reject", label: "Reject" }
      ]
    }
  }, {
    id: "interaction:requested:1",
    correlationId: requestCorrelationId,
    timestamp: "2026-04-16T20:00:05.000Z"
  }));

  const requestedMessages = await requestPromise;
  assert.deepEqual(requestedMessages.map((message) => message.type), ["session.interaction.requested"]);

  const resolutionPromise = collect(
    sessionClient.resolveInteraction({
      sessionId,
      turnId: "turn:2",
      resolution: {
        kind: "form",
        requestId: "form:req:1",
        optionId: "approve",
        text: "ship it"
      },
      metadata: {
        clientId: "desktop:test",
        turnId: "turn:2"
      }
    })
  );

  const resolveOutbound = await waitForMessage(1);
  const resolveCorrelationId = resolveOutbound.correlationId;

  sessionClient.handleMessage(sessionId, createEnvelope("session.interaction.resolved", {
    sessionId,
    resolution: {
      kind: "form",
      requestId: "form:req:1",
      optionId: "approve",
      text: "ship it"
    }
  }, {
    id: "interaction:resolved:1",
    correlationId: resolveCorrelationId,
    timestamp: "2026-04-16T20:00:06.000Z"
  }));
  sessionClient.handleMessage(sessionId, createEnvelope("session.completed", {
    sessionId
  }, {
    id: "completed:2",
    correlationId: resolveCorrelationId,
    timestamp: "2026-04-16T20:00:07.000Z"
  }));

  const resolvedMessages = await resolutionPromise;
  assert.deepEqual(
    resolvedMessages.map((message) => message.type),
    ["session.interaction.resolved", "session.completed"]
  );
});

test("host-core session client normalizes session controls and interrupts active work", async () => {
  const { sessionClient, sessionId, waitForMessage } = createHarness();

  const controlsPromise = sessionClient.getSessionControls({
    sessionId,
    metadata: {
      clientId: "desktop:test"
    }
  });

  const controlsRequest = await waitForMessage(0);
  assert.equal(controlsRequest.type, "session.controls.get");

  sessionClient.handleMessage(sessionId, createEnvelope("session.controls", {
    sessionId,
    controls: [
      {
        id: "model",
        kind: "select",
        label: "Model",
        value: "fast",
        options: [
          { id: "fast", label: "Fast" },
          { id: "accurate", label: "Accurate" }
        ]
      },
      {
        id: "verbose",
        kind: "toggle",
        label: "Verbose",
        value: true
      }
    ]
  }, {
    id: "controls:1",
    correlationId: controlsRequest.correlationId,
    timestamp: "2026-04-16T20:00:08.000Z"
  }));

  const controls = await controlsPromise;
  assert.deepEqual(controls.map((control) => control.id), ["model", "verbose"]);
  assert.equal(controls[0].kind, "select");
  assert.equal(controls[1].kind, "toggle");

  const turnPromise = collect(
    sessionClient.sendSessionMessage({
      sessionId,
      turnId: "turn:interrupt",
      message: {
        role: "user",
        text: "long task",
        parts: [{ type: "text", text: "long task" }],
        metadata: {
          clientId: "desktop:test",
          userMessageId: "msg:user:interrupt",
          assistantMessageId: "msg:assistant:interrupt",
          turnId: "turn:interrupt"
        }
      }
    })
  );

  const activeTurnMessage = await waitForMessage(1);
  assert.equal(activeTurnMessage.type, "session.message");

  const interruptPromise = sessionClient.interrupt({
    sessionId,
    turnId: "turn:interrupt"
  });

  const interruptRequest = await waitForMessage(2);
  assert.equal(interruptRequest.type, "session.interrupt");

  sessionClient.handleMessage(sessionId, createEnvelope("session.interrupt.result", {
    sessionId,
    status: "interrupted",
    turnId: "turn:interrupt"
  }, {
    id: "interrupt:result:1",
    correlationId: interruptRequest.correlationId,
    timestamp: "2026-04-16T20:00:09.000Z"
  }));

  const interruptResult = await interruptPromise;
  assert.equal(interruptResult.status, "interrupted");
  assert.equal(interruptResult.turnId, "turn:interrupt");

  await assert.rejects(
    () => turnPromise,
    (error) => error instanceof NlaSessionInterruptedError && error.turnId === "turn:interrupt"
  );
});
