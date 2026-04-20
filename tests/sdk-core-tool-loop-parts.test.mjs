import assert from "node:assert/strict";
import test from "node:test";
import { createEnvelope } from "@nla/protocol";
import {
  createAdapterRuntime,
  defineToolLoopSessionAdapter
} from "@nla/sdk-core";

test("sdk-core tool-loop sessions pass user parts through, emit assistant parts, and persist rich memory", async () => {
  let observedRequest;
  let savedMemory;

  const runtime = createAdapterRuntime(defineToolLoopSessionAdapter({
    id: "tool-loop-parts",
    name: "Tool Loop Parts",
    model: () => ({
      async respond(request) {
        observedRequest = request;
        return {
          type: "assistant",
          parts: [
            {
              type: "text",
              text: "Found two listings"
            },
            {
              type: "image",
              url: "https://example.test/listing-1.jpg"
            },
            {
              type: "image",
              url: "https://example.test/listing-2.jpg"
            }
          ],
          metadata: {
            presentation: {
              kind: "gallery",
              collapsed: true
            }
          }
        };
      }
    }),
    memory: {
      async load() {
        return savedMemory;
      },
      async save(_context, state) {
        savedMemory = state;
      }
    },
    tools: []
  }));

  await runtime.handle(createEnvelope("session.start", {
    sessionId: "sess_tool_loop_parts"
  }, {
    correlationId: "start:sess_tool_loop_parts"
  }));

  const messages = await runtime.handle(createEnvelope("session.message", {
    sessionId: "sess_tool_loop_parts",
    role: "user",
    parts: [
      {
        type: "text",
        text: "Show me M3 listings"
      },
      {
        type: "image",
        assetId: "asset:reference-car",
        filename: "reference.jpg"
      }
    ]
  }, {
    correlationId: "turn:sess_tool_loop_parts"
  }));

  assert.ok(observedRequest);
  assert.deepEqual(observedRequest.messages.at(-1), {
    role: "user",
    text: "Show me M3 listings",
    parts: [
      {
        type: "text",
        text: "Show me M3 listings"
      },
      {
        type: "image",
        assetId: "asset:reference-car",
        filename: "reference.jpg"
      }
    ]
  });

  const reply = messages.find((message) => message.type === "session.message");
  assert.ok(reply);
  assert.equal(reply.data.role, "assistant");
  assert.equal(reply.data.text, "Found two listings");
  assert.deepEqual(reply.data.parts, [
    {
      type: "text",
      text: "Found two listings"
    },
    {
      type: "image",
      url: "https://example.test/listing-1.jpg"
    },
    {
      type: "image",
      url: "https://example.test/listing-2.jpg"
    }
  ]);
  assert.deepEqual(reply.data.metadata, {
    presentation: {
      kind: "gallery",
      collapsed: true
    }
  });

  assert.deepEqual(savedMemory, {
    recent: [
      {
        role: "user",
        text: "Show me M3 listings",
        parts: [
          {
            type: "text",
            text: "Show me M3 listings"
          },
          {
            type: "image",
            assetId: "asset:reference-car",
            filename: "reference.jpg"
          }
        ]
      },
      {
        role: "assistant",
        text: "Found two listings",
        parts: [
          {
            type: "text",
            text: "Found two listings"
          },
          {
            type: "image",
            url: "https://example.test/listing-1.jpg"
          },
          {
            type: "image",
            url: "https://example.test/listing-2.jpg"
          }
        ],
        metadata: {
          presentation: {
            kind: "gallery",
            collapsed: true
          }
        }
      }
    ]
  });
});

test("sdk-core tool-loop sessions forward assistant delta metadata and final rich replies from streams", async () => {
  const runtime = createAdapterRuntime(defineToolLoopSessionAdapter({
    id: "tool-loop-stream-parts",
    name: "Tool Loop Stream Parts",
    model: () => ({
      async *streamRespond() {
        yield {
          type: "assistant.delta",
          delta: "Scanning listings...",
          metadata: {
            phase: "search"
          }
        };
        yield {
          type: "assistant.completed",
          parts: [
            {
              type: "text",
              text: "Done"
            },
            {
              type: "image",
              url: "https://example.test/result.jpg"
            }
          ],
          metadata: {
            presentation: {
              kind: "gallery"
            }
          }
        };
      }
    }),
    tools: []
  }));

  await runtime.handle(createEnvelope("session.start", {
    sessionId: "sess_tool_loop_stream_parts"
  }, {
    correlationId: "start:sess_tool_loop_stream_parts"
  }));

  const messages = [];
  await runtime.handleStream(createEnvelope("session.message", {
    sessionId: "sess_tool_loop_stream_parts",
    role: "user",
    text: "search"
  }, {
    correlationId: "turn:sess_tool_loop_stream_parts"
  }), (message) => {
    messages.push(message);
  });

  const delta = messages.find((message) => message.type === "session.message.delta");
  assert.ok(delta);
  assert.equal(delta.data.delta, "Scanning listings...");
  assert.deepEqual(delta.data.metadata, {
    phase: "search"
  });

  const reply = messages.find((message) => message.type === "session.message");
  assert.ok(reply);
  assert.equal(reply.data.role, "assistant");
  assert.equal(reply.data.text, "Done");
  assert.deepEqual(reply.data.parts, [
    {
      type: "text",
      text: "Done"
    },
    {
      type: "image",
      url: "https://example.test/result.jpg"
    }
  ]);
  assert.deepEqual(reply.data.metadata, {
    presentation: {
      kind: "gallery"
    }
  });
});
