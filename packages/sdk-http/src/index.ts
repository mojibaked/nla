import {
  defineAdapter,
  type NlaAdapterDefinition,
  type NlaInvokeHandlerContext,
  type NlaRuntimeOptions
} from "@nla/sdk-core";
import { runAdapterStdio, type NlaStdioRunOptions } from "@nla/transport-stdio-jsonl";
import type { NlaRiskLevel } from "@nla/protocol";

type MaybePromise<T> = T | Promise<T>;
type UnknownRecord = Record<string, unknown>;

export type NlaHttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export type NlaHttpParseMode = "json" | "text" | "bytes";

export interface NlaHttpRequestSpec {
  method?: NlaHttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: BodyInit;
}

export interface NlaHttpRequestPreview {
  method: string;
  url: string;
  risk: NlaRiskLevel;
}

export interface NlaHttpExecutionResult extends UnknownRecord {
  ok: boolean;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  text?: string;
  json?: unknown;
  bytes?: Uint8Array;
  error?: string;
}

export interface NlaHttpArtifactConfig {
  kind: string;
  title?: string | ((input: UnknownRecord, preview: NlaHttpRequestPreview) => string);
  mimeType?: string;
}

export interface NlaHttpOperationConfig {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  risk?: NlaRiskLevel;
  method?: NlaHttpMethod | ((input: UnknownRecord, ctx: NlaInvokeHandlerContext) => MaybePromise<NlaHttpMethod | undefined>);
  url: string | ((input: UnknownRecord, ctx: NlaInvokeHandlerContext) => MaybePromise<string>);
  query?:
    | Record<string, unknown>
    | ((input: UnknownRecord, ctx: NlaInvokeHandlerContext) => MaybePromise<Record<string, unknown> | undefined>);
  headers?:
    | Record<string, string>
    | ((input: UnknownRecord, ctx: NlaInvokeHandlerContext) => MaybePromise<Record<string, string> | undefined>);
  body?:
    | unknown
    | ((input: UnknownRecord, ctx: NlaInvokeHandlerContext) => MaybePromise<unknown>);
  parse?: NlaHttpParseMode | ((response: Response, result: NlaHttpExecutionResult) => MaybePromise<unknown>);
  output?: (
    result: NlaHttpExecutionResult,
    input: UnknownRecord,
    ctx: NlaInvokeHandlerContext
  ) => MaybePromise<unknown>;
  acceptStatus?: (status: number, response: Response) => boolean;
  artifact?: false | NlaHttpArtifactConfig;
  activityTitle?: string | ((input: UnknownRecord, preview: NlaHttpRequestPreview) => string);
  timeoutMs?: number | ((input: UnknownRecord, ctx: NlaInvokeHandlerContext) => MaybePromise<number | undefined>);
}

export interface NlaHttpAdapterConfig {
  id: string;
  name: string;
  version?: string;
  operations: readonly NlaHttpOperationConfig[];
}

export function httpOperation<T extends NlaHttpOperationConfig>(operation: T): T {
  return operation;
}

export function defineHttpAdapter(config: NlaHttpAdapterConfig): NlaAdapterDefinition {
  const operations = new Map(config.operations.map((operation) => [operation.name, operation]));

  return defineAdapter({
    id: config.id,
    name: config.name,
    version: config.version,
    capabilities: {
      invoke: true
    },
    operations: config.operations.map((operation) => ({
      name: operation.name,
      description: operation.description,
      inputSchema: operation.inputSchema,
      outputSchema: operation.outputSchema,
      risk: operation.risk ?? "unknown"
    })),
    async invoke(ctx, message) {
      const operation = operations.get(message.data.operation);
      if (!operation) {
        ctx.fail({
          code: "unknown_operation",
          message: `Unknown operation: ${message.data.operation}`
        });
        return;
      }

      const input = asRecord(message.data.input);
      const preview = await requestPreview(operation, input, ctx);
      const activityId = ctx.createId("http");
      const title = activityTitleFor(operation, input, preview);

      ctx.activity({
        activityId,
        kind: "network",
        title,
        status: "running",
        data: {
          method: preview.method,
          url: preview.url,
          risk: preview.risk
        }
      });
      ctx.log(`Request ${preview.method} ${preview.url}`, "info");

      const result = await runHttpOperation(operation, input, ctx, preview);
      if (!result.ok) {
        ctx.activity({
          activityId,
          kind: "network",
          title,
          status: "failed",
          data: {
            method: preview.method,
            url: preview.url,
            status: result.status
          }
        });
        ctx.fail({
          code: "http_request_failed",
          message: result.error || `HTTP request failed: ${preview.method} ${preview.url}`,
          data: result
        });
        return;
      }

      ctx.activity({
        activityId,
        kind: "network",
        title,
        status: "succeeded",
        data: {
          method: preview.method,
          url: preview.url,
          status: result.status
        }
      });

      if (operation.artifact !== false) {
        const artifact = operation.artifact;
        if (artifact) {
          ctx.artifact({
            artifactId: `${artifact.kind}-${stableId(`${preview.method}:${preview.url}`)}`,
            kind: artifact.kind,
            title: typeof artifact.title === "function" ? artifact.title(input, preview) : artifact.title || title,
            mimeType: artifact.mimeType || "application/json",
            data: result
          });
        }
      }

      if (operation.output) {
        return operation.output(result, input, ctx);
      }
      if (operation.parse === "json") return result.json;
      if (operation.parse === "text") return result.text;
      if (operation.parse === "bytes") return result.bytes;
      return result;
    }
  });
}

export async function runHttpAdapterStdio(
  config: NlaHttpAdapterConfig,
  options: NlaStdioRunOptions & { runtimeOptions?: NlaRuntimeOptions } = {}
): Promise<void> {
  await runAdapterStdio(defineHttpAdapter(config), options);
}

export async function runHttpOperation(
  operation: NlaHttpOperationConfig,
  input: UnknownRecord,
  ctx: NlaInvokeHandlerContext,
  preview?: NlaHttpRequestPreview
): Promise<NlaHttpExecutionResult> {
  const request = await requestSpec(operation, input, ctx);
  const resolvedPreview = preview ?? {
    method: request.method || "GET",
    url: request.url,
    risk: operation.risk ?? "unknown"
  };
  const timeoutMs = typeof operation.timeoutMs === "function" ? await operation.timeoutMs(input, ctx) : operation.timeoutMs;
  const abortController = typeof AbortController === "function" ? new AbortController() : undefined;
  const timeoutHandle = abortController && timeoutMs
    ? setTimeout(() => abortController.abort(), timeoutMs)
    : undefined;

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: abortController?.signal
    });

    const result: NlaHttpExecutionResult = {
      ok: acceptStatus(operation, response),
      method: request.method || "GET",
      url: request.url,
      status: response.status,
      statusText: response.statusText,
      headers: headersToRecord(response.headers)
    };
    await applyParse(operation, response, result);

    if (!result.ok) {
      result.error = `Unexpected HTTP status ${response.status} for ${request.method || "GET"} ${request.url}`;
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      method: request.method || "GET",
      url: request.url,
      error: errorMessage(error)
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function requestPreview(
  operation: NlaHttpOperationConfig,
  input: UnknownRecord,
  ctx: NlaInvokeHandlerContext
): Promise<NlaHttpRequestPreview> {
  const request = await requestSpec(operation, input, ctx);
  return {
    method: request.method || "GET",
    url: request.url,
    risk: operation.risk ?? "unknown"
  };
}

async function requestSpec(
  operation: NlaHttpOperationConfig,
  input: UnknownRecord,
  ctx: NlaInvokeHandlerContext
): Promise<NlaHttpRequestSpec> {
  const method = typeof operation.method === "function"
    ? await operation.method(input, ctx)
    : operation.method;
  const rawUrl = typeof operation.url === "function"
    ? await operation.url(input, ctx)
    : operation.url;
  const query = typeof operation.query === "function"
    ? await operation.query(input, ctx)
    : operation.query;
  const headers = {
    ...(typeof operation.headers === "function" ? await operation.headers(input, ctx) : operation.headers)
  } as Record<string, string>;
  const bodyValue = typeof operation.body === "function"
    ? await operation.body(input, ctx)
    : operation.body;
  const url = appendQuery(rawUrl, query);
  const body = normalizeBody(bodyValue, headers);

  return {
    method: method || inferMethod(body),
    url,
    headers,
    body
  };
}

async function applyParse(
  operation: NlaHttpOperationConfig,
  response: Response,
  result: NlaHttpExecutionResult
): Promise<void> {
  if (!operation.parse) {
    result.text = await response.text();
    return;
  }

  if (typeof operation.parse === "function") {
    const parsed = await operation.parse(response, result);
    if (parsed !== undefined) {
      result.json = parsed;
    }
    return;
  }

  if (operation.parse === "json") {
    const text = await response.text();
    result.text = text;
    result.json = text ? JSON.parse(text) : null;
    return;
  }

  if (operation.parse === "text") {
    result.text = await response.text();
    return;
  }

  const arrayBuffer = await response.arrayBuffer();
  result.bytes = new Uint8Array(arrayBuffer);
}

function acceptStatus(operation: NlaHttpOperationConfig, response: Response): boolean {
  if (operation.acceptStatus) return operation.acceptStatus(response.status, response);
  return response.ok;
}

function normalizeBody(
  body: unknown,
  headers: Record<string, string>
): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string" || body instanceof Uint8Array || body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return body as BodyInit;
  }

  if (!hasHeader(headers, "content-type")) {
    headers["content-type"] = "application/json";
  }
  return JSON.stringify(body);
}

function inferMethod(body: BodyInit | undefined): NlaHttpMethod {
  return body === undefined ? "GET" : "POST";
}

function appendQuery(url: string, query?: Record<string, unknown>): string {
  if (!query || Object.keys(query).length === 0) return url;
  const resolved = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === false) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === false) continue;
        resolved.searchParams.append(key, String(item));
      }
      continue;
    }
    resolved.searchParams.append(key, String(value));
  }
  return resolved.toString();
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function hasHeader(headers: Record<string, string>, target: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === target.toLowerCase());
}

function activityTitleFor(
  operation: NlaHttpOperationConfig,
  input: UnknownRecord,
  preview: NlaHttpRequestPreview
): string {
  const title = operation.activityTitle;
  if (typeof title === "function") return title(input, preview);
  if (typeof title === "string") return title;
  return `Request ${preview.method} ${preview.url}`;
}

function asRecord(value: unknown): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as UnknownRecord;
}

function stableId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
