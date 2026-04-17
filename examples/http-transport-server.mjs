import { createServer } from "node:http";
import { defineAdapter } from "@nla/sdk-core";
import { createHttpTransportHandler } from "@nla/transport-http";

const adapter = defineAdapter({
  id: "echo-http-transport",
  name: "Echo HTTP Transport",
  version: "0.1.0",
  capabilities: {
    invoke: true,
    streaming: true
  },
  async invoke(ctx, message) {
    const input = message.data.input ?? null;
    const text = typeof input?.text === "string" ? input.text : "";

    if (text) {
      const midpoint = Math.max(1, Math.ceil(text.length / 2));
      ctx.outputDelta(text.slice(0, midpoint), {
        mode: "text"
      });
      ctx.outputDelta(text.slice(midpoint), {
        mode: "text"
      });
    }

    return {
      echoed: input
    };
  }
});

const server = createServer(createHttpTransportHandler(adapter, {
  path: "/nla"
}));

server.listen(8787, "127.0.0.1", () => {
  console.log("NLA HTTP transport listening on http://127.0.0.1:8787/nla");
});
