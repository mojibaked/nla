import assert from "node:assert/strict";
import { createServer } from "node:http";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import { runOpenRouterChatRepl } from "../examples/openrouter-chat-repl.mjs";
import { createOpenRouterAdapter } from "../examples/stdio-openrouter-adapter.mjs";
import {
  createTestHost,
  findMessagesByType,
  lastSessionReply,
  singleMessageByType
} from "@nla/test";

test("OpenRouter example streams invoke output and returns a final transcript", async () => {
  const mock = await startMockOpenRouterServer([
    {
      generationId: "gen_invoke_1",
      events: [
        ": OPENROUTER PROCESSING",
        chunkEvent({
          id: "chatcmpl_mock_1",
          model: "test/mock-model",
          choices: [
            {
              index: 0,
              delta: {
                content: "Hello"
              },
              finish_reason: null
            }
          ]
        }),
        chunkEvent({
          id: "chatcmpl_mock_1",
          model: "test/mock-model",
          choices: [
            {
              index: 0,
              delta: {
                content: " world"
              },
              finish_reason: "stop"
            }
          ],
          usage: {
            prompt_tokens: 8,
            completion_tokens: 2,
            total_tokens: 10
          }
        })
      ]
    }
  ]);

  try {
    const host = createTestHost(createOpenRouterAdapter({
      apiKey: "test-key",
      baseUrl: mock.baseUrl,
      defaultModel: "test/mock-model"
    }));
    const result = await host.invoke("chat", {
      prompt: "Say hello",
      system: "Be friendly"
    });
    const deltas = findMessagesByType(result.messages, "invoke.output.delta");

    assert.deepEqual(
      deltas.map((message) => message.data.delta),
      ["Hello", " world"]
    );
    assert.equal(result.output?.data.output.text, "Hello world");
    assert.equal(result.output?.data.output.model, "test/mock-model");
    assert.equal(result.output?.data.output.generationId, "gen_invoke_1");
    assert.equal(result.completed?.type, "invoke.completed");

    assert.equal(mock.requests.length, 1);
    assert.equal(mock.requests[0].body.stream, true);
    assert.equal(mock.requests[0].body.model, "test/mock-model");
    assert.deepEqual(mock.requests[0].body.messages, [
      {
        role: "system",
        content: "Be friendly"
      },
      {
        role: "user",
        content: "Say hello"
      }
    ]);
  } finally {
    await stopServer(mock.server);
  }
});

test("OpenRouter REPL provides a human-readable chat wrapper", async () => {
  const mock = await startMockOpenRouterServer([
    {
      generationId: "gen_repl_1",
      events: [
        chunkEvent({
          id: "chatcmpl_repl_1",
          model: "test/mock-model",
          choices: [
            {
              index: 0,
              delta: {
                content: "Hello from the REPL"
              },
              finish_reason: "stop"
            }
          ]
        })
      ]
    }
  ]);

  try {
    const output = new PassThrough();
    output.setEncoding("utf8");
    let written = "";
    output.on("data", (chunk) => {
      written += chunk;
    });

    await runOpenRouterChatRepl({
      input: Readable.from(["Hello\n", "/exit\n"]),
      output,
      errorOutput: output,
      adapterConfig: {
        apiKey: "test-key",
        baseUrl: mock.baseUrl,
        defaultModel: "test/mock-model"
      }
    });

    assert.match(written, /OpenRouter chat REPL/);
    assert.match(written, /commands> \/exit, \/quit, \/new/);
    assert.match(written, /assistant> Hello from the REPL/);
    assert.equal(mock.requests.length, 1);
  } finally {
    await stopServer(mock.server);
  }
});

test("OpenRouter example preserves session history across turns", async () => {
  const mock = await startMockOpenRouterServer([
    {
      generationId: "gen_session_1",
      events: [
        chunkEvent({
          id: "chatcmpl_session_1",
          model: "test/mock-model",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant"
              },
              finish_reason: null
            }
          ]
        }),
        chunkEvent({
          id: "chatcmpl_session_1",
          model: "test/mock-model",
          choices: [
            {
              index: 0,
              delta: {
                content: "Hello there"
              },
              finish_reason: "stop"
            }
          ]
        })
      ]
    },
    {
      generationId: "gen_session_2",
      events: [
        chunkEvent({
          id: "chatcmpl_session_2",
          model: "test/mock-model",
          choices: [
            {
              index: 0,
              delta: {
                content: "Again"
              },
              finish_reason: "stop"
            }
          ]
        })
      ]
    }
  ]);

  try {
    const host = createTestHost(createOpenRouterAdapter({
      apiKey: "test-key",
      baseUrl: mock.baseUrl,
      defaultModel: "test/mock-model"
    }));

    const started = await host.startSession("sess_openrouter", {
      system: "You are terse",
      model: "test/mock-model"
    });
    assert.ok(singleMessageByType(started, "session.started"));

    const first = await host.sendSessionMessage("sess_openrouter", "Hello");
    const second = await host.sendSessionMessage("sess_openrouter", "And again");

    assert.deepEqual(
      findMessagesByType(first, "session.message.delta").map((message) => message.data.delta),
      ["Hello there"]
    );
    assert.equal(lastSessionReply(first)?.data.text, "Hello there");
    assert.equal(lastSessionReply(second)?.data.text, "Again");

    assert.equal(mock.requests.length, 2);
    assert.equal(mock.requests[0].body.session_id, "sess_openrouter");
    assert.deepEqual(mock.requests[0].body.messages, [
      {
        role: "system",
        content: "You are terse"
      },
      {
        role: "user",
        content: "Hello"
      }
    ]);
    assert.deepEqual(mock.requests[1].body.messages, [
      {
        role: "system",
        content: "You are terse"
      },
      {
        role: "user",
        content: "Hello"
      },
      {
        role: "assistant",
        content: "Hello there"
      },
      {
        role: "user",
        content: "And again"
      }
    ]);
  } finally {
    await stopServer(mock.server);
  }
});

async function startMockOpenRouterServer(scenarios) {
  const requests = [];
  let index = 0;

  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.statusCode = 404;
      response.end();
      return;
    }

    const body = await readJsonBody(request);
    requests.push({
      body
    });

    const scenario = scenarios[index];
    index += 1;
    if (!scenario) {
      response.statusCode = 500;
      response.end(JSON.stringify({
        error: {
          code: "missing_scenario",
          message: "No scenario configured for this request."
        }
      }));
      return;
    }

    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-generation-id": scenario.generationId
    });

    for (const event of scenario.events) {
      response.write(toSseChunk(event));
    }
    response.write("data: [DONE]\n\n");
    response.end();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve mock OpenRouter server address.");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests
  };
}

function chunkEvent(payload) {
  return {
    data: payload
  };
}

function toSseChunk(event) {
  if (typeof event === "string") {
    return `${event}\n\n`;
  }

  const payload = typeof event.data === "string"
    ? event.data
    : JSON.stringify(event.data);
  return `data: ${payload}\n\n`;
}

async function readJsonBody(request) {
  const parts = [];
  for await (const chunk of request) {
    parts.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
  }
  return JSON.parse(parts.join(""));
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
