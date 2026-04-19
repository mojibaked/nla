import assert from "node:assert/strict";
import test from "node:test";

import { createSessionClient } from "../packages/host-core/dist/index.js";
import { createEnvelope } from "../packages/protocol/dist/index.js";

const createTransport = (sessionId, sent) => {
  let closed = false;

  return {
    sessionId,
    send: (message) => {
      sent.push(message);
    },
    close: () => {
      closed = true;
    },
    isClosed: () => closed
  };
};

const collect = async (stream) => {
  const messages = [];
  for await (const message of stream) {
    messages.push(message);
  }
  return messages;
};

test("createSessionClient routes turn-bound session events by turnId without correlationId", async () => {
  const sent = [];
  let sequence = 0;
  const client = createSessionClient({
    nextRequestId: (prefix) => `${prefix}:${++sequence}`,
    now: () => "2026-04-18T00:00:00.000Z"
  });

  client.registerSession({
    transport: createTransport("session-1", sent)
  });

  const received = collect(client.sendSessionMessage({
    sessionId: "session-1",
    turnId: "turn-1",
    message: {
      role: "user",
      text: "Hello"
    }
  }));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "session.message");

  client.handleMessage("session-1", createEnvelope("session.message", {
    sessionId: "session-1",
    turnId: "turn-1",
    role: "assistant",
    text: "Hi"
  }, {
    id: "msg-1",
    timestamp: "2026-04-18T00:00:01.000Z"
  }));

  client.handleMessage("session-1", createEnvelope("session.status", {
    sessionId: "session-1",
    turnId: "turn-1",
    status: "completed"
  }, {
    id: "status-1",
    timestamp: "2026-04-18T00:00:02.000Z"
  }));

  const messages = await received;
  assert.deepEqual(messages.map((message) => message.type), [
    "session.message",
    "session.status"
  ]);
  assert.equal(messages[0].data.turnId, "turn-1");
  assert.equal(messages[1].data.turnId, "turn-1");
});

test("createSessionClient forwards unmatched session events to the unsolicited callback", () => {
  const observed = [];
  const client = createSessionClient({
    nextRequestId: (prefix) => `${prefix}:1`,
    now: () => "2026-04-18T00:00:00.000Z"
  });

  client.registerSession({
    transport: createTransport("session-2", []),
    onUnsolicitedMessage: (message) => {
      observed.push(message);
    }
  });

  client.handleMessage("session-2", createEnvelope("session.execution", {
    sessionId: "session-2",
    turnId: "turn-provider-1",
    state: "running",
    interruptible: true
  }, {
    id: "exec-1",
    timestamp: "2026-04-18T00:00:01.000Z"
  }));

  assert.equal(observed.length, 1);
  assert.equal(observed[0].type, "session.execution");
  assert.equal(observed[0].data.turnId, "turn-provider-1");
});
