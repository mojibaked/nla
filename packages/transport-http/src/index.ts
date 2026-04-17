import type { IncomingMessage, ServerResponse } from "node:http";
import {
  formatValidationIssues,
  validateNlaMessage,
  type NlaEnvelope,
  type NlaMessage
} from "@nla/protocol";
import {
  createAdapterRuntime,
  isAdapterRuntime,
  type NlaAdapterDefinition,
  type NlaAdapterRuntime,
  type NlaRuntimeMessageSink,
  type NlaRuntimeOptions
} from "@nla/sdk-core";

type MaybePromise<T> = T | Promise<T>;

export const NLA_HTTP_NDJSON_MIME = "application/x-ndjson";
export const NLA_HTTP_NDJSON_CONTENT_TYPE = `${NLA_HTTP_NDJSON_MIME}; charset=utf-8`;

export interface NlaHttpTransportServerOptions {
  path?: string;
  runtimeOptions?: NlaRuntimeOptions;
}

export interface NlaHttpTransportRequestOptions {
  fetch?: NlaFetchLike;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export type NlaFetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export function serializeNdjsonMessage(message: NlaEnvelope): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseNdjsonMessage(line: string): NlaMessage {
  const parsed = JSON.parse(line);
  const validation = validateNlaMessage(parsed);
  if (!validation.ok) {
    throw new Error(`Invalid NLA NDJSON message: ${formatValidationIssues(validation.errors)}`);
  }
  return validation.value;
}

export function createHttpTransportHandler(
  adapterOrRuntime: NlaAdapterDefinition | NlaAdapterRuntime,
  options: NlaHttpTransportServerOptions = {}
) {
  const runtime = isAdapterRuntime(adapterOrRuntime)
    ? adapterOrRuntime
    : createAdapterRuntime(adapterOrRuntime, options.runtimeOptions);

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const method = (request.method ?? "GET").toUpperCase();
    const pathname = request.url
      ? new URL(request.url, "http://nla.local").pathname
      : "/";

    if (options.path && pathname !== options.path) {
      writeTransportError(response, 404, `NLA endpoint not found: ${pathname}`);
      return;
    }

    if (method === "OPTIONS") {
      response.statusCode = 204;
      response.setHeader("allow", "POST, OPTIONS");
      response.end();
      return;
    }

    if (method !== "POST") {
      response.setHeader("allow", "POST, OPTIONS");
      writeTransportError(response, 405, `Unsupported NLA HTTP method: ${method}`);
      return;
    }

    try {
      const message = await readHttpRequestMessage(request);

      response.statusCode = 200;
      response.setHeader("content-type", NLA_HTTP_NDJSON_CONTENT_TYPE);
      response.setHeader("cache-control", "no-cache, no-transform");
      response.setHeader("x-content-type-options", "nosniff");
      response.flushHeaders?.();

      if (typeof runtime.handleStream === "function") {
        await runtime.handleStream(message, (event) => writeNdjsonMessage(response, event));
      } else {
        const events = await runtime.handle(message);
        for (const event of events) {
          await writeNdjsonMessage(response, event);
        }
      }

      response.end();
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }

      const statusCode = error instanceof NlaHttpTransportError
        ? error.statusCode
        : 500;
      writeTransportError(response, statusCode, errorMessage(error));
    }
  };
}

export async function sendHttpTransportMessage(
  url: string | URL,
  message: NlaMessage,
  options: NlaHttpTransportRequestOptions = {}
): Promise<NlaMessage[]> {
  const messages: NlaMessage[] = [];
  await streamHttpTransportMessage(url, message, (event) => {
    messages.push(event);
  }, options);
  return messages;
}

export async function streamHttpTransportMessage(
  url: string | URL,
  message: NlaMessage,
  sink: NlaRuntimeMessageSink,
  options: NlaHttpTransportRequestOptions = {}
): Promise<Response> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available for NLA HTTP transport requests.");
  }

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      accept: NLA_HTTP_NDJSON_MIME,
      "content-type": "application/json; charset=utf-8",
      ...options.headers
    },
    body: JSON.stringify(message),
    signal: options.signal
  });

  if (!response.ok) {
    const body = await safeReadText(response);
    throw new Error(
      `NLA HTTP transport request failed with status ${response.status}${body ? `: ${body}` : ""}`
    );
  }

  await readHttpTransportResponse(response, sink);
  return response;
}

export async function readHttpTransportResponse(
  response: Response,
  sink: NlaRuntimeMessageSink
): Promise<void> {
  if (!response.body) return;
  await parseNdjsonStream(response.body, sink);
}

export async function parseNdjsonStream(
  stream: ReadableStream<Uint8Array>,
  sink: NlaRuntimeMessageSink
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = await flushCompleteLines(buffer, sink);
    }

    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) {
      await sink(parseNdjsonMessage(tail));
    }
  } finally {
    reader.releaseLock();
  }
}

async function flushCompleteLines(
  buffer: string,
  sink: NlaRuntimeMessageSink
): Promise<string> {
  while (true) {
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex === -1) return buffer;

    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;

    await sink(parseNdjsonMessage(line));
  }
}

async function readHttpRequestMessage(request: IncomingMessage): Promise<NlaMessage> {
  const chunks: string[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
  }

  const body = chunks.join("").trim();
  if (!body) {
    throw new NlaHttpTransportError(400, "Missing NLA HTTP request body.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new NlaHttpTransportError(400, `Invalid JSON request body: ${errorMessage(error)}`);
  }

  const validation = validateNlaMessage(parsed);
  if (!validation.ok) {
    throw new NlaHttpTransportError(
      400,
      `Invalid NLA HTTP request: ${formatValidationIssues(validation.errors)}`
    );
  }

  return validation.value;
}

function writeTransportError(
  response: ServerResponse,
  statusCode: number,
  message: string
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify({
    error: message
  }));
}

function writeNdjsonMessage(
  response: ServerResponse,
  message: NlaEnvelope
): Promise<void> {
  return writeResponseChunk(response, serializeNdjsonMessage(message));
}

function writeResponseChunk(
  response: ServerResponse,
  chunk: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (error?: Error | null): void => {
      if (settled) return;
      settled = true;
      response.off("error", onError);
      response.off("drain", onDrain);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const onError = (error: Error): void => {
      finish(error);
    };

    const onDrain = (): void => {
      finish();
    };

    response.on("error", onError);

    try {
      const canContinue = response.write(chunk, (error) => {
        if (error) {
          finish(error);
          return;
        }

        if (canContinue) {
          finish();
        }
      });

      if (!canContinue) {
        response.once("drain", onDrain);
      }
    } catch (error) {
      finish(error as Error);
    }
  });
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

class NlaHttpTransportError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "NlaHttpTransportError";
    this.statusCode = statusCode;
  }
}
