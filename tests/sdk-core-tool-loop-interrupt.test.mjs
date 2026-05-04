import assert from "node:assert/strict";
import test from "node:test";
import { createEnvelope } from "@nla/protocol";
import {
  createAdapterRuntime,
  defineToolLoopSessionAdapter,
  tool
} from "@nla/sdk-core";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(10);
  }

  throw new Error("Timed out waiting for condition");
};

test("sdk-core tool-loop sessions default active turnId onto turn-scoped events", async () => {
  const runtime = createAdapterRuntime(defineToolLoopSessionAdapter({
    id: "tool-loop-turn-events",
    name: "Tool Loop Turn Events",
    model: () => ({
      async respond(request, options = {}) {
        assert.equal(options.turnId, "turn_tool_loop_events");
        const hasToolReply = request.messages.some((message) => message.role === "tool");
        if (!hasToolReply) {
          return {
            type: "tool_calls",
            calls: [
              {
                callId: "call:collect",
                toolName: "collect",
                input: {}
              }
            ]
          };
        }

        return {
          type: "assistant",
          text: "done",
          deltas: ["do", "ne"]
        };
      }
    }),
    tools: [
      tool({
        name: "collect",
        description: "Collect turn-scoped event defaults.",
        inputSchema: {
          type: "object",
          additionalProperties: false
        },
        execute: async (ctx) => {
          assert.equal(ctx.turnId, "turn_tool_loop_events");
          ctx.status("working", "Working");
          ctx.execution({
            state: "running",
            interruptible: true
          });
          ctx.activity({
            activityId: "manual",
            title: "Manual activity",
            status: "running"
          });
          ctx.requestInput({
            kind: "approval",
            requestId: "req:turn-events"
          });
          return {
            ok: true
          };
        }
      })
    ]
  }));

  await runtime.handle(createEnvelope("session.start", {
    sessionId: "sess_tool_loop_events"
  }, {
    correlationId: "start:sess_tool_loop_events"
  }));

  const messages = [];
  await runtime.handleStream(createEnvelope("session.message", {
    sessionId: "sess_tool_loop_events",
    turnId: "turn_tool_loop_events",
    role: "user",
    text: "hello"
  }, {
    correlationId: "turn:sess_tool_loop_events"
  }), (message) => {
    messages.push(message);
  });

  const turnScoped = messages.filter((message) =>
    [
      "session.status",
      "session.execution",
      "session.activity",
      "session.interaction.requested",
      "session.message.delta",
      "session.message"
    ].includes(message.type)
  );

  assert.ok(turnScoped.length > 0);
  assert.equal(
    turnScoped.every((message) => message.data.turnId === "turn_tool_loop_events"),
    true
  );
  assert.ok(messages.some((message) =>
    message.type === "session.activity"
    && message.data.activityId === "tool:collect"
    && message.data.turnId === "turn_tool_loop_events"
  ));
  assert.ok(messages.some((message) =>
    message.type === "session.activity"
    && message.data.activityId === "manual"
    && message.data.turnId === "turn_tool_loop_events"
  ));
  assert.ok(messages.some((message) =>
    message.type === "session.interaction.requested"
    && message.data.request.requestId === "req:turn-events"
    && message.data.turnId === "turn_tool_loop_events"
  ));
});

test("sdk-core tool-loop sessions interrupt an active model call", async () => {
  let observedSignal;
  const runtime = createAdapterRuntime(defineToolLoopSessionAdapter({
    id: "tool-loop-interrupt-model",
    name: "Tool Loop Interrupt Model",
    model: () => ({
      async *streamRespond(_request, options = {}) {
        observedSignal = options.signal;
        await new Promise((resolve, reject) => {
          const signal = options.signal;
          if (!signal) {
            reject(new Error("Expected AbortSignal"));
            return;
          }

          if (signal.aborted) {
            reject(signal.reason ?? new Error("aborted"));
            return;
          }

          signal.addEventListener("abort", () => {
            reject(signal.reason ?? new Error("aborted"));
          }, {
            once: true
          });
        });
        return;
      }
    }),
    tools: []
  }));

  await runtime.handle(createEnvelope("session.start", {
    sessionId: "sess_tool_loop_interrupt_model"
  }, {
    correlationId: "start:sess_tool_loop_interrupt_model"
  }));

  const turnMessages = [];
  const turnPromise = runtime.handleStream(createEnvelope("session.message", {
    sessionId: "sess_tool_loop_interrupt_model",
    role: "user",
    text: "hello",
    metadata: {
      turnId: "turn_tool_loop_interrupt_model"
    }
  }, {
    correlationId: "turn:sess_tool_loop_interrupt_model"
  }), (message) => {
    turnMessages.push(message);
  });

  await waitFor(() => observedSignal !== undefined);
  await waitFor(() =>
    turnMessages.some((message) =>
      message.type === "session.execution"
      && message.data.turnId === "turn_tool_loop_interrupt_model"
      && message.data.state === "running"
    )
  );

  const interruptMessages = await runtime.handle(createEnvelope("session.interrupt", {
    sessionId: "sess_tool_loop_interrupt_model",
    turnId: "turn_tool_loop_interrupt_model"
  }, {
    correlationId: "interrupt:sess_tool_loop_interrupt_model"
  }));
  await turnPromise;

  const interruptResult = interruptMessages.find(
    (message) => message.type === "session.interrupt.result"
  );
  assert.ok(interruptResult);
  assert.equal(interruptResult.data.status, "interrupted");
  assert.equal(interruptResult.data.turnId, "turn_tool_loop_interrupt_model");
  assert.equal(interruptResult.data.message, "Interrupted");
  assert.equal(observedSignal.aborted, true);
  assert.equal(
    turnMessages.some((message) => message.type === "session.completed"),
    false
  );
  assert.equal(
    turnMessages.some((message) => message.type === "session.failed"),
    false
  );
});

test("sdk-core tool-loop sessions interrupt pending awaitInput work", async () => {
  const runtime = createAdapterRuntime(defineToolLoopSessionAdapter({
    id: "tool-loop-interrupt-input",
    name: "Tool Loop Interrupt Input",
    model: () => ({
      async respond(request) {
        const hasToolReply = request.messages.some((message) => message.role === "tool");
        if (!hasToolReply) {
          return {
            type: "tool_calls",
            calls: [
              {
                callId: "call:await-input",
                toolName: "await_input",
                input: {}
              }
            ]
          };
        }

        return {
          type: "assistant",
          text: "done"
        };
      }
    }),
    tools: [
      tool({
        name: "await_input",
        description: "Pause for user input.",
        inputSchema: {
          type: "object",
          additionalProperties: false
        },
        execute: async (ctx) => {
          await ctx.awaitInput({
            kind: "form",
            requestId: "req:await-input"
          });
          return {
            ok: true
          };
        }
      })
    ]
  }));

  await runtime.handle(createEnvelope("session.start", {
    sessionId: "sess_tool_loop_interrupt_input"
  }, {
    correlationId: "start:sess_tool_loop_interrupt_input"
  }));

  const turnMessages = [];
  const turnPromise = runtime.handleStream(createEnvelope("session.message", {
    sessionId: "sess_tool_loop_interrupt_input",
    role: "user",
    text: "pause",
    metadata: {
      turnId: "turn_tool_loop_interrupt_input"
    }
  }, {
    correlationId: "turn:sess_tool_loop_interrupt_input"
  }), (message) => {
    turnMessages.push(message);
  });

  await waitFor(() =>
    turnMessages.some((message) =>
      message.type === "session.interaction.requested"
      && message.data.request.requestId === "req:await-input"
    )
  );

  const interruptMessages = await runtime.handle(createEnvelope("session.interrupt", {
    sessionId: "sess_tool_loop_interrupt_input",
    turnId: "turn_tool_loop_interrupt_input"
  }, {
    correlationId: "interrupt:sess_tool_loop_interrupt_input"
  }));
  await turnPromise;

  const interruptResult = interruptMessages.find(
    (message) => message.type === "session.interrupt.result"
  );
  assert.ok(interruptResult);
  assert.equal(interruptResult.data.status, "interrupted");
  assert.equal(interruptResult.data.turnId, "turn_tool_loop_interrupt_input");
  assert.equal(
    turnMessages.some((message) => message.type === "session.completed"),
    false
  );
  assert.equal(
    turnMessages.some((message) => message.type === "session.failed"),
    false
  );
});
