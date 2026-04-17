import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { PassThrough, Readable } from "node:stream";
import { createEnvelope } from "@nla/protocol";
import { defineAdapter } from "@nla/sdk-core";
import {
  openJsonlChildTransport,
  parseJsonlMessage,
  runAdapterStdio,
  serializeJsonlMessage
} from "@nla/transport-stdio-jsonl";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("transport-stdio-jsonl flushes streamed messages before invoke completion", async () => {
  const adapter = defineAdapter({
    id: "stdio-streaming",
    name: "Stdio Streaming",
    async invoke(ctx) {
      ctx.outputDelta("hel", {
        mode: "text"
      });
      await delay(120);
      return {
        message: "hello"
      };
    }
  });

  const output = new PassThrough();
  output.setEncoding("utf8");

  let written = "";
  output.on("data", (chunk) => {
    written += chunk;
  });

  const request = serializeJsonlMessage(createEnvelope("invoke.request", {
    operation: "stream"
  }, {
    correlationId: "inv_stdio_stream"
  }));

  let completed = false;
  const runPromise = runAdapterStdio(adapter, {
    stdin: Readable.from([request]),
    stdout: output
  }).then(() => {
    completed = true;
  });

  await once(output, "data");
  assert.equal(completed, false);

  await runPromise;

  const messages = written
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(parseJsonlMessage);

  assert.equal(messages[0].type, "invoke.output.delta");
  assert.equal(messages.at(-1)?.type, "invoke.completed");
});

test("transport-stdio-jsonl child transport forwards validated NLA messages", async () => {
  const received = [];
  const failures = [];
  const transport = openJsonlChildTransport({
    sessionId: "sess_child_echo",
    command: process.execPath,
    args: ["-e", "process.stdin.pipe(process.stdout)"],
    onMessage: (message) => {
      received.push(message);
    },
    onFailure: (error) => {
      failures.push(error);
    }
  });

  const outbound = createEnvelope("session.start", {
    sessionId: "sess_child_echo"
  }, {
    id: "start:1",
    correlationId: "start:1"
  });

  transport.send(outbound);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (received.length > 0) {
      break;
    }
    await delay(10);
  }

  transport.close();

  assert.equal(failures.length, 0);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], outbound);
});

test("transport-stdio-jsonl child transport includes stderr in failures", async () => {
  const failures = [];
  const transport = openJsonlChildTransport({
    sessionId: "sess_child_fail",
    command: process.execPath,
    args: ["-e", "process.stderr.write('boom\\n'); setTimeout(() => process.exit(2), 10);"],
    onMessage: () => {},
    onFailure: (error) => {
      failures.push(error);
    }
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (failures.length > 0) {
      break;
    }
    await delay(10);
  }

  transport.close();

  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /\[nla stderr\]/);
  assert.match(failures[0].message, /boom/);
});
