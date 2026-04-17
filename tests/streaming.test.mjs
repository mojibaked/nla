import assert from "node:assert/strict";
import test from "node:test";
import { validateNlaMessage } from "@nla/protocol";
import { defineAdapter } from "@nla/sdk-core";
import { findMessagesByType, invokeAdapter } from "@nla/test";

test("protocol validation accepts invoke.output.delta and rejects missing seq", () => {
  const ok = validateNlaMessage({
    protocol: "nla/v1",
    type: "invoke.output.delta",
    data: {
      streamId: "stream_1",
      seq: 1,
      mode: "text",
      delta: "hel"
    }
  });
  assert.equal(ok.ok, true);

  const bad = validateNlaMessage({
    protocol: "nla/v1",
    type: "invoke.output.delta",
    data: {
      streamId: "stream_1",
      delta: "hel"
    }
  });
  assert.equal(bad.ok, false);
  assert.match(
    bad.errors.map((error) => error.path).join(" "),
    /seq/
  );
});

test("sdk-core emits invoke.output.delta with stable stream ids and incrementing seq", async () => {
  const adapter = defineAdapter({
    id: "streaming-echo",
    name: "Streaming Echo",
    operations: [
      {
        name: "stream_echo",
        description: "Stream a greeting before returning the final payload.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string"
            }
          },
          required: ["name"],
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string"
            }
          },
          required: ["message"],
          additionalProperties: false
        }
      }
    ],
    async invoke(ctx, message) {
      ctx.outputDelta("hel", {
        mode: "text"
      });
      ctx.outputDelta(`lo ${message.data.input.name}`, {
        mode: "text"
      });

      return {
        message: `hello ${message.data.input.name}`
      };
    }
  });

  const result = await invokeAdapter(adapter, "stream_echo", {
    name: "Ada"
  });
  const deltas = findMessagesByType(result.messages, "invoke.output.delta");

  assert.equal(deltas.length, 2);
  assert.equal(deltas[0].data.streamId, deltas[1].data.streamId);
  assert.equal(deltas[0].data.seq, 1);
  assert.equal(deltas[1].data.seq, 2);
  assert.equal(deltas[0].data.delta, "hel");
  assert.equal(deltas[1].data.delta, "lo Ada");
  assert.ok(result.output);
  assert.deepEqual(result.output.data.output, {
    message: "hello Ada"
  });
});
