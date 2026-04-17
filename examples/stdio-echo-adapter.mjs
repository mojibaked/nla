#!/usr/bin/env node
import { createAdapterRuntime, defineAdapter } from "@nla/sdk-core";
import { runAdapterStdio } from "@nla/transport-stdio-jsonl";

const adapter = defineAdapter({
  id: "stdio-echo",
  name: "Stdio Echo Adapter",
  version: "0.1.0",
  capabilities: {
    invoke: true,
    sessions: true,
    streaming: true
  },
  operations: [
    {
      name: "echo",
      description: "Echo the input payload back to the caller.",
      inputSchema: {
        type: "object",
        additionalProperties: true
      },
      outputSchema: {
        type: "object",
        properties: {
          echoed: {}
        }
      },
      risk: "read"
    }
  ],
  async invoke(ctx, message) {
    if (message.data.operation !== "echo") {
      ctx.fail({
        code: "unknown_operation",
        message: `Unknown operation: ${message.data.operation}`
      });
      return;
    }

    ctx.log(`Running ${message.data.operation}`, "info");
    const input = message.data.input;
    if (input && typeof input === "object" && typeof input.text === "string") {
      const text = input.text;
      const midpoint = Math.ceil(text.length / 2);
      ctx.outputDelta(text.slice(0, midpoint), {
        mode: "text"
      });
      ctx.outputDelta(text.slice(midpoint), {
        mode: "text"
      });
    }
    return {
      echoed: input ?? null
    };
  },
  async sessionStart(ctx) {
    ctx.started();
    ctx.status("idle", "Echo session ready");
  },
  async sessionMessage(ctx, message) {
    const text = message.data.text?.trim() || "";
    ctx.status("working", "Echoing message");
    ctx.reply(text ? `echo: ${text}` : "echo:");
    ctx.status("idle", "Echo session ready");
  }
});

await runAdapterStdio(createAdapterRuntime(adapter));
