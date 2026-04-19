import assert from "node:assert/strict";
import test from "node:test";
import { createEnvelope } from "@nla/protocol";
import { createAdapterRuntime, defineAdapter } from "@nla/sdk-core";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("sdk-core session emitters can emit uncorrelated session traffic after the handler returns", async () => {
  const messages = [];
  const runtime = createAdapterRuntime(defineAdapter({
    id: "session-emitter",
    name: "Session Emitter",
    async sessionStart(ctx) {
      ctx.started({
        providerRef: `provider:${ctx.session.id}`
      });
      ctx.execution({
        state: "idle",
        interruptible: false
      });
    },
    async sessionMessage(ctx) {
      const background = ctx.createSessionEmitter({
        turnId: "provider-background-turn"
      });

      ctx.execution({
        state: "running",
        interruptible: false
      });
      ctx.reply("Foreground reply.");
      ctx.complete();

      setTimeout(() => {
        background.execution({
          state: "running",
          interruptible: false
        });
        background.reply("Background follow-up.");
        background.complete();
      }, 10);
    }
  }));

  await runtime.handleStream(createEnvelope("session.start", {
    sessionId: "sess_emitter"
  }, {
    correlationId: "start:sess_emitter"
  }), (message) => {
    messages.push(message);
  });

  await runtime.handleStream(createEnvelope("session.message", {
    sessionId: "sess_emitter",
    role: "user",
    text: "hello"
  }, {
    correlationId: "turn:sess_emitter"
  }), (message) => {
    messages.push(message);
  });

  const countAfterReturn = messages.length;
  assert.equal(
    messages.some(
      (message) =>
        message.type === "session.message"
        && message.data.role === "assistant"
        && message.data.text === "Background follow-up."
    ),
    false
  );

  await delay(30);

  assert.ok(messages.length > countAfterReturn);

  const foregroundReply = messages.find(
    (message) =>
      message.type === "session.message"
      && message.data.role === "assistant"
      && message.data.text === "Foreground reply."
  );
  const backgroundExecution = messages.find(
    (message) =>
      message.type === "session.execution"
      && message.data.turnId === "provider-background-turn"
      && message.data.state === "running"
  );
  const backgroundReply = messages.find(
    (message) =>
      message.type === "session.message"
      && message.data.role === "assistant"
      && message.data.text === "Background follow-up."
  );

  assert.ok(foregroundReply);
  assert.equal(foregroundReply.correlationId, "turn:sess_emitter");

  assert.ok(backgroundExecution);
  assert.equal(backgroundExecution.correlationId, undefined);

  assert.ok(backgroundReply);
  assert.equal(backgroundReply.correlationId, undefined);
  assert.equal(backgroundReply.data.turnId, "provider-background-turn");
});
