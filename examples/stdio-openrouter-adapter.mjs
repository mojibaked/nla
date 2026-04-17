#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { defineAdapter } from "@nla/sdk-core";
import { runAdapterStdio } from "@nla/transport-stdio-jsonl";

export function createOpenRouterAdapter(config = {}) {
  const client = createOpenRouterClient(config);

  return defineAdapter({
    id: "stdio-openrouter",
    name: "Stdio OpenRouter Adapter",
    version: "0.1.0",
    capabilities: {
      invoke: true,
      sessions: true,
      streaming: true
    },
    operations: [
      {
        name: "chat",
        description: "Send a prompt or chat history to OpenRouter and stream the assistant response.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string"
            },
            system: {
              type: "string"
            },
            model: {
              type: "string"
            },
            temperature: {
              type: "number"
            },
            maxTokens: {
              type: "integer",
              minimum: 1
            },
            messages: {
              type: "array",
              items: openRouterMessageSchema()
            }
          },
          anyOf: [
            {
              required: ["prompt"]
            },
            {
              required: ["messages"]
            }
          ],
          additionalProperties: false
        },
        outputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string"
            },
            model: {
              type: "string"
            },
            text: {
              type: "string"
            },
            finishReason: {
              type: ["string", "null"]
            },
            generationId: {
              type: ["string", "null"]
            },
            usage: {
              type: ["object", "null"]
            }
          },
          required: ["text"],
          additionalProperties: true
        },
        risk: "money"
      }
    ],
    async invoke(ctx, message) {
      if (message.data.operation !== "chat") {
        ctx.fail({
          code: "unknown_operation",
          message: `Unknown operation: ${message.data.operation}`
        });
        return;
      }

      const input = asRecord(message.data.input);
      const request = buildChatRequest(input, {
        defaultModel: client.defaultModel,
        sessionId: message.data.context?.sessionId
      });
      const activityId = ctx.createId("llm");
      const title = `OpenRouter chat${request.model ? ` (${request.model})` : ""}`;

      ctx.activity({
        activityId,
        kind: "llm",
        title,
        status: "running",
        data: {
          model: request.model,
          messageCount: request.messages.length,
          endpoint: client.chatCompletionsUrl
        }
      });

      try {
        const result = await streamOpenRouterChat({
          client,
          request,
          onTextDelta(delta) {
            ctx.outputDelta(delta, {
              mode: "text"
            });
          }
        });

        ctx.activity({
          activityId,
          kind: "llm",
          title,
          status: "succeeded",
          data: {
            model: result.model,
            finishReason: result.finishReason,
            generationId: result.generationId
          }
        });

        return result;
      } catch (error) {
        ctx.activity({
          activityId,
          kind: "llm",
          title,
          status: "failed",
          data: {
            model: request.model
          }
        });
        ctx.fail(toNlaFailure(error));
      }
    },
    async sessionStart(ctx, message) {
      const metadata = asRecord(message.data.metadata);
      const state = createSessionState(metadata, client.defaultModel);

      ctx.started({
        state
      });
      ctx.status("idle", "OpenRouter session ready", {
        model: state.model
      });
    },
    async sessionResume(ctx) {
      const state = ensureSessionState(ctx.session.state, client.defaultModel);
      ctx.setState(state);
      ctx.status("idle", "OpenRouter session ready", {
        model: state.model
      });
    },
    async sessionMessage(ctx, message) {
      const state = ensureSessionState(ctx.session.state, client.defaultModel);
      const prompt = coercePrompt(message);
      const conversation = [
        ...state.messages,
        {
          role: "user",
          content: prompt
        }
      ];
      const request = buildChatRequest({
        messages: conversation,
        model: state.model,
        temperature: state.temperature,
        maxTokens: state.maxTokens
      }, {
        defaultModel: client.defaultModel,
        sessionId: ctx.session.id
      });
      const title = `OpenRouter session${request.model ? ` (${request.model})` : ""}`;
      const activityId = ctx.createId("llm");
      const assistantMessageId = ctx.createId("assistant");

      ctx.status("working", "Calling OpenRouter", {
        model: request.model
      });
      ctx.activity({
        activityId,
        kind: "llm",
        title,
        status: "running",
        data: {
          model: request.model,
          messageCount: request.messages.length,
          endpoint: client.chatCompletionsUrl
        }
      });

      try {
        const result = await streamOpenRouterChat({
          client,
          request,
          onTextDelta(delta) {
            ctx.messageDelta({
              messageId: assistantMessageId,
              role: "assistant",
              delta
            });
          }
        });
        const nextState = {
          ...state,
          model: result.model || state.model,
          messages: [
            ...conversation,
            {
              role: "assistant",
              content: result.text
            }
          ]
        };

        ctx.setState(nextState);
        ctx.message({
          role: "assistant",
          text: result.text,
          metadata: {
            model: result.model,
            finishReason: result.finishReason,
            generationId: result.generationId,
            usage: result.usage
          }
        });
        ctx.activity({
          activityId,
          kind: "llm",
          title,
          status: "succeeded",
          data: {
            model: result.model,
            finishReason: result.finishReason,
            generationId: result.generationId
          }
        });
        ctx.status("idle", "OpenRouter session ready", {
          model: result.model
        });
      } catch (error) {
        ctx.activity({
          activityId,
          kind: "llm",
          title,
          status: "failed",
          data: {
            model: request.model
          }
        });
        ctx.fail(toNlaFailure(error));
      }
    }
  });
}

export async function streamOpenRouterChat({
  client,
  request,
  onTextDelta
}) {
  const response = await fetch(client.chatCompletionsUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${client.apiKey}`,
      "content-type": "application/json",
      accept: "text/event-stream"
    },
    body: JSON.stringify({
      ...request,
      stream: true
    })
  });

  if (!response.ok) {
    throw await openRouterHttpError(response);
  }
  if (!response.body) {
    throw new OpenRouterApiError("OpenRouter returned no response body.", {
      code: "empty_response"
    });
  }

  const generationId = response.headers.get("x-generation-id");
  let completionId;
  let model = request.model || null;
  let finishReason = null;
  let usage = null;
  let text = "";

  await consumeSse(response.body, async (payload) => {
    if (!payload || payload === "[DONE]") return;

    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch (error) {
      throw new OpenRouterApiError(`Failed to parse OpenRouter stream event: ${String(error)}`, {
        code: "invalid_stream_event",
        data: {
          payload
        }
      });
    }

    if (chunk.error) {
      throw new OpenRouterApiError(chunk.error.message || "OpenRouter stream failed.", {
        code: chunk.error.code || "stream_error",
        data: chunk
      });
    }

    completionId = chunk.id || completionId || null;
    model = chunk.model || model || null;
    usage = chunk.usage || usage;

    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
    if (!choice) return;
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      finishReason = choice.finish_reason;
    }

    const deltaText = extractDeltaText(choice.delta);
    if (!deltaText) return;

    text += deltaText;
    await onTextDelta(deltaText);
  });

  return {
    id: completionId || null,
    model,
    text,
    finishReason,
    generationId,
    usage
  };
}

function createOpenRouterClient(config) {
  const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for the OpenRouter example adapter.");
  }

  const baseUrl = (config.baseUrl || process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");

  return {
    apiKey,
    baseUrl,
    defaultModel: config.defaultModel || process.env.OPENROUTER_MODEL || undefined,
    chatCompletionsUrl: `${baseUrl}/chat/completions`
  };
}

function buildChatRequest(input, options = {}) {
  const system = typeof input.system === "string" ? input.system.trim() : "";
  const requestMessages = Array.isArray(input.messages)
    ? normalizeMessages(input.messages)
    : [];
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  const messages = [];

  if (system) {
    messages.push({
      role: "system",
      content: system
    });
  }
  messages.push(...requestMessages);
  if (prompt) {
    messages.push({
      role: "user",
      content: prompt
    });
  }

  if (messages.length === 0) {
    throw new OpenRouterApiError("Provide either prompt or messages for the chat request.", {
      code: "invalid_input"
    });
  }

  const request = {
    messages
  };
  const model = typeof input.model === "string" && input.model.trim()
    ? input.model.trim()
    : options.defaultModel;
  if (model) {
    request.model = model;
  }
  if (typeof input.temperature === "number") {
    request.temperature = input.temperature;
  }
  if (Number.isInteger(input.maxTokens)) {
    request.max_tokens = input.maxTokens;
  }
  if (options.sessionId) {
    request.session_id = options.sessionId;
  }

  return request;
}

function createSessionState(metadata, defaultModel) {
  const state = {
    model: typeof metadata.model === "string" && metadata.model.trim()
      ? metadata.model.trim()
      : defaultModel,
    temperature: typeof metadata.temperature === "number"
      ? metadata.temperature
      : undefined,
    maxTokens: Number.isInteger(metadata.maxTokens)
      ? metadata.maxTokens
      : undefined,
    messages: []
  };
  const system = typeof metadata.system === "string" ? metadata.system.trim() : "";
  if (system) {
    state.messages.push({
      role: "system",
      content: system
    });
  }
  if (Array.isArray(metadata.messages)) {
    state.messages.push(...normalizeMessages(metadata.messages));
  }
  return state;
}

function ensureSessionState(value, defaultModel) {
  if (!value || typeof value !== "object") {
    return createSessionState({}, defaultModel);
  }

  return {
    model: typeof value.model === "string" && value.model.trim()
      ? value.model.trim()
      : defaultModel,
    temperature: typeof value.temperature === "number"
      ? value.temperature
      : undefined,
    maxTokens: Number.isInteger(value.maxTokens)
      ? value.maxTokens
      : undefined,
    messages: Array.isArray(value.messages)
      ? normalizeMessages(value.messages)
      : []
  };
}

function normalizeMessages(messages) {
  return messages
    .map((message) => ({
      role: typeof message?.role === "string" ? message.role : "",
      content: typeof message?.content === "string" ? message.content : ""
    }))
    .filter((message) => message.role && message.content);
}

function coercePrompt(message) {
  const text = typeof message.data.text === "string"
    ? message.data.text.trim()
    : "";
  if (text) return text;

  throw new OpenRouterApiError("Session messages require a text payload.", {
    code: "invalid_input"
  });
}

async function consumeSse(stream, onData) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, {
        stream: true
      });
      buffer = await flushSseBuffer(buffer, onData);
    }

    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) {
      await flushSseEvent(tail, onData);
    }
  } finally {
    reader.releaseLock();
  }
}

async function flushSseBuffer(buffer, onData) {
  const separator = /\r?\n\r?\n/g;
  let match;
  let lastIndex = 0;

  while ((match = separator.exec(buffer)) !== null) {
    const chunk = buffer.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;
    if (chunk.trim()) {
      await flushSseEvent(chunk, onData);
    }
  }

  return buffer.slice(lastIndex);
}

async function flushSseEvent(rawEvent, onData) {
  const lines = rawEvent.split(/\r?\n/);
  const dataLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1
      ? line
      : line.slice(0, separatorIndex);
    let value = separatorIndex === -1
      ? ""
      : line.slice(separatorIndex + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }

    if (field === "data") {
      dataLines.push(value);
    }
  }

  if (dataLines.length === 0) return;
  await onData(dataLines.join("\n"));
}

async function openRouterHttpError(response) {
  const body = await safeJson(response);
  const error = body?.error || {};
  const message = typeof error.message === "string"
    ? error.message
    : `OpenRouter request failed with HTTP ${response.status}.`;

  return new OpenRouterApiError(message, {
    code: typeof error.code === "string" ? error.code : `http_${response.status}`,
    status: response.status,
    data: body
  });
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractDeltaText(delta) {
  if (!delta) return "";
  if (typeof delta.content === "string") return delta.content;
  if (Array.isArray(delta.content)) {
    return delta.content
      .map((part) => typeof part?.text === "string" ? part.text : "")
      .join("");
  }
  return "";
}

function toNlaFailure(error) {
  return {
    code: error instanceof OpenRouterApiError
      ? error.code
      : "runtime_error",
    message: error instanceof Error
      ? error.message
      : String(error),
    data: error instanceof OpenRouterApiError
      ? error.data
      : undefined
  };
}

function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function openRouterMessageSchema() {
  return {
    type: "object",
    properties: {
      role: {
        type: "string"
      },
      content: {
        type: "string"
      }
    },
    required: ["role", "content"],
    additionalProperties: false
  };
}

class OpenRouterApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "OpenRouterApiError";
    this.code = options.code;
    this.status = options.status;
    this.data = options.data;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAdapterStdio(createOpenRouterAdapter());
}
