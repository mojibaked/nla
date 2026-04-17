import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createEnvelope } from "@nla/protocol";
import { defineAdapter } from "@nla/sdk-core";
import {
  createHttpTransportHandler,
  sendHttpTransportMessage,
  streamHttpTransportMessage
} from "@nla/transport-http";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("transport-http send helper collects streamed NDJSON responses", async () => {
  const adapter = defineAdapter({
    id: "http-init",
    name: "HTTP Init"
  });

  const { server, url } = await startHttpTransportServer(adapter);

  try {
    const messages = await sendHttpTransportMessage(
      url,
      createEnvelope("initialize", {})
    );

    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "initialized");
    assert.equal(messages[0].data.adapter.id, "http-init");
  } finally {
    await stopServer(server);
  }
});

test("transport-http streams invoke output before completion", async () => {
  const adapter = defineAdapter({
    id: "http-streaming",
    name: "HTTP Streaming",
    capabilities: {
      invoke: true,
      streaming: true
    },
    async invoke(ctx) {
      ctx.outputDelta("hel", {
        mode: "text"
      });
      await delay(150);
      ctx.outputDelta("lo", {
        mode: "text"
      });
      return {
        message: "hello"
      };
    }
  });

  const { server, url } = await startHttpTransportServer(adapter);

  try {
    const observed = [];
    const startedAt = Date.now();

    const response = await streamHttpTransportMessage(
      url,
      createEnvelope("invoke.request", {
        operation: "stream"
      }, {
        correlationId: "inv_http_stream"
      }),
      (message) => {
        observed.push({
          message,
          elapsedMs: Date.now() - startedAt
        });
      }
    );

    assert.equal(response.status, 200);

    const firstDelta = observed.find((entry) => entry.message.type === "invoke.output.delta");
    const completed = observed.find((entry) => entry.message.type === "invoke.completed");

    assert.ok(firstDelta);
    assert.ok(completed);
    assert.equal(observed[0].message.type, "invoke.output.delta");
    assert.ok(firstDelta.elapsedMs < 120, `expected first delta before completion, got ${firstDelta.elapsedMs}ms`);
    assert.ok(completed.elapsedMs >= 130, `expected completion after delay, got ${completed.elapsedMs}ms`);
  } finally {
    await stopServer(server);
  }
});

async function startHttpTransportServer(adapter) {
  const server = createServer(createHttpTransportHandler(adapter, {
    path: "/nla"
  }));

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve HTTP transport server address.");
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}/nla`
  };
}

async function stopServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
