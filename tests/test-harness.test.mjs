import assert from "node:assert/strict";
import test from "node:test";
import { defineAdapter } from "@nla/sdk-core";
import { createTestHost, lastSessionReply, singleMessageByType } from "@nla/test";

test("@nla/test preserves session state across multiple messages", async () => {
  const adapter = defineAdapter({
    id: "session-counter",
    name: "Session Counter",
    sessionStart(ctx) {
      ctx.started({
        state: {
          count: 0
        }
      });
      ctx.status("idle", "ready");
    },
    sessionMessage(ctx, message) {
      const count = Number(ctx.session.state?.count || 0) + 1;
      ctx.mergeState({
        count
      });
      ctx.reply(`${message.data.text}:${count}`);
    }
  });

  const host = createTestHost(adapter);
  const started = await host.startSession("sess_counter");
  assert.ok(singleMessageByType(started, "session.started"));

  const first = await host.sendSessionMessage("sess_counter", "hello");
  assert.equal(lastSessionReply(first)?.data.text, "hello:1");

  const second = await host.sendSessionMessage("sess_counter", "again");
  assert.equal(lastSessionReply(second)?.data.text, "again:2");
});
