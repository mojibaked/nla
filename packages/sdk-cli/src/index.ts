import { execFile } from "node:child_process";
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

export type NlaCliParseMode = "json" | "text" | "lines";

export interface NlaCliCommandSpec {
  command: string;
  label?: string;
  argsPrefix?: string[];
}

export interface NlaCliCommandPreview {
  command: string;
  executable: string;
  argv: string[];
  risk: NlaRiskLevel;
}

export interface NlaCliExecutionResult extends UnknownRecord {
  ok: boolean;
  command: string;
  executable: string;
  exitCode?: number;
  signal?: string;
  stdout: string;
  stderr: string;
  json?: unknown;
  lines?: string[];
  error?: string;
}

export interface NlaCliArtifactConfig {
  kind: string;
  title?: string | ((input: UnknownRecord, preview: NlaCliCommandPreview) => string);
  mimeType?: string;
}

export interface NlaCliOperationConfig {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  risk?: NlaRiskLevel;
  command:
    | string
    | NlaCliCommandSpec
    | ((input: UnknownRecord, ctx: NlaInvokeHandlerContext) => MaybePromise<string | NlaCliCommandSpec>);
  args?:
    | Array<string | undefined | null | false>
    | ((input: UnknownRecord, ctx: NlaInvokeHandlerContext) => MaybePromise<Array<string | undefined | null | false>>);
  displayCommand?:
    | string
    | string[]
    | ((input: UnknownRecord, preview: Omit<NlaCliCommandPreview, "command">) => MaybePromise<string | string[]>);
  parse?: NlaCliParseMode | ((stdout: string, result: NlaCliExecutionResult) => unknown);
  output?: (
    result: NlaCliExecutionResult,
    input: UnknownRecord,
    ctx: NlaInvokeHandlerContext
  ) => MaybePromise<unknown>;
  cwd?: string | ((input: UnknownRecord, ctx: NlaInvokeHandlerContext) => MaybePromise<string | undefined>);
  env?: NodeJS.ProcessEnv | ((input: UnknownRecord, ctx: NlaInvokeHandlerContext) => MaybePromise<NodeJS.ProcessEnv | undefined>);
  timeoutMs?: number | ((input: UnknownRecord, ctx: NlaInvokeHandlerContext) => MaybePromise<number | undefined>);
  maxBuffer?: number;
  artifact?: false | NlaCliArtifactConfig;
  activityTitle?: string | ((input: UnknownRecord, preview: NlaCliCommandPreview) => string);
}

export interface NlaCliAdapterConfig {
  id: string;
  name: string;
  version?: string;
  operations: readonly NlaCliOperationConfig[];
}

export function cliOperation<T extends NlaCliOperationConfig>(operation: T): T {
  return operation;
}

export function defineCliAdapter(config: NlaCliAdapterConfig): NlaAdapterDefinition {
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
      const preview = await commandPreview(operation, input, ctx);
      const activityId = ctx.createId("cli");
      const title = activityTitleFor(operation, input, preview);

      ctx.activity({
        activityId,
        kind: "command",
        title,
        status: "running",
        data: {
          command: preview.command,
          risk: preview.risk
        }
      });
      ctx.log(`Running ${preview.command}`, "info");

      const result = await runCliOperation(operation, input, ctx, preview);
      if (!result.ok) {
        ctx.activity({
          activityId,
          kind: "command",
          title,
          status: "failed",
          data: {
            command: preview.command,
            exitCode: result.exitCode,
            stderr: result.stderr
          }
        });
        ctx.fail({
          code: "cli_command_failed",
          message: result.error || `Command failed: ${preview.command}`,
          data: result
        });
        return;
      }

      ctx.activity({
        activityId,
        kind: "command",
        title,
        status: "succeeded",
        data: {
          command: preview.command
        }
      });

      if (operation.artifact !== false) {
        const artifact = operation.artifact;
        if (artifact) {
          ctx.artifact({
            artifactId: `${artifact.kind}-${stableId(preview.command)}`,
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
      if (operation.parse === "lines") return result.lines;
      if (operation.parse === "text") return result.stdout;
      return result;
    }
  });
}

export async function runCliAdapterStdio(
  config: NlaCliAdapterConfig,
  options: NlaStdioRunOptions & { runtimeOptions?: NlaRuntimeOptions } = {}
): Promise<void> {
  await runAdapterStdio(defineCliAdapter(config), options);
}

export async function runCliOperation(
  operation: NlaCliOperationConfig,
  input: UnknownRecord,
  ctx: NlaInvokeHandlerContext,
  preview?: NlaCliCommandPreview
): Promise<NlaCliExecutionResult> {
  const resolvedPreview = preview ?? await commandPreview(operation, input, ctx);
  const command = await commandSpec(operation, input, ctx);
  const cwd = typeof operation.cwd === "function" ? await operation.cwd(input, ctx) : operation.cwd;
  const env = typeof operation.env === "function" ? await operation.env(input, ctx) : operation.env;
  const timeoutMs = typeof operation.timeoutMs === "function" ? await operation.timeoutMs(input, ctx) : operation.timeoutMs;

  try {
    const { stdout, stderr } = await execFilePromise(command.command, resolvedPreview.argv, {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      timeout: timeoutMs || 30_000,
      maxBuffer: operation.maxBuffer || 1024 * 1024
    });

    const result: NlaCliExecutionResult = {
      ok: true,
      command: resolvedPreview.command,
      executable: command.label || command.command,
      stdout: stdout.trimEnd(),
      stderr: stderr.trimEnd()
    };
    applyParse(operation, result);
    return result;
  } catch (error) {
    const result: NlaCliExecutionResult = {
      ok: false,
      command: resolvedPreview.command,
      executable: command.label || command.command,
      exitCode: typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : undefined,
      signal: cleanString((error as NodeJS.ErrnoException & { signal?: unknown }).signal),
      stdout: cleanString((error as NodeJS.ErrnoException & { stdout?: unknown }).stdout) || "",
      stderr: cleanString((error as NodeJS.ErrnoException & { stderr?: unknown }).stderr) || "",
      error: errorMessage(error)
    };
    try {
      applyParse(operation, result);
    } catch {
      return result;
    }
    return result;
  }
}

async function commandPreview(
  operation: NlaCliOperationConfig,
  input: UnknownRecord,
  ctx: NlaInvokeHandlerContext
): Promise<NlaCliCommandPreview> {
  const command = await commandSpec(operation, input, ctx);
  const argv = [
    ...(command.argsPrefix || []),
    ...cleanArgs(await commandArgs(operation, input, ctx))
  ];
  const executable = command.label || command.command;
  const basePreview = {
    executable,
    argv,
    risk: operation.risk ?? "unknown"
  };
  return {
    ...basePreview,
    command: await displayCommand(operation, input, basePreview)
  };
}

async function commandSpec(
  operation: NlaCliOperationConfig,
  input: UnknownRecord,
  ctx: NlaInvokeHandlerContext
): Promise<NlaCliCommandSpec> {
  const value = typeof operation.command === "function"
    ? await operation.command(input, ctx)
    : operation.command;
  if (typeof value === "string") {
    return {
      command: value,
      label: value
    };
  }
  return {
    command: value.command,
    label: value.label || value.command,
    argsPrefix: cleanArgs(value.argsPrefix || [])
  };
}

async function commandArgs(
  operation: NlaCliOperationConfig,
  input: UnknownRecord,
  ctx: NlaInvokeHandlerContext
): Promise<Array<string | undefined | null | false>> {
  if (!operation.args) return [];
  if (typeof operation.args === "function") {
    return operation.args(input, ctx);
  }
  return operation.args;
}

async function displayCommand(
  operation: NlaCliOperationConfig,
  input: UnknownRecord,
  preview: Omit<NlaCliCommandPreview, "command">
): Promise<string> {
  const display = operation.displayCommand;
  if (typeof display === "function") {
    return stringifyDisplay(await display(input, preview));
  }
  if (display !== undefined) {
    return stringifyDisplay(display);
  }
  return stringifyDisplay([preview.executable, ...preview.argv]);
}

function applyParse(
  operation: NlaCliOperationConfig,
  result: NlaCliExecutionResult
): void {
  if (!operation.parse) return;
  if (typeof operation.parse === "function") {
    const parsed = operation.parse(result.stdout, result);
    if (parsed !== undefined) {
      result.json = parsed;
    }
    return;
  }

  if (operation.parse === "json") {
    try {
      result.json = result.stdout ? JSON.parse(result.stdout) : null;
    } catch (error) {
      throw new Error(`Failed to parse JSON output: ${errorMessage(error)}`);
    }
    return;
  }

  if (operation.parse === "lines") {
    result.lines = result.stdout ? result.stdout.split(/\r?\n/) : [];
  }
}

function activityTitleFor(
  operation: NlaCliOperationConfig,
  input: UnknownRecord,
  preview: NlaCliCommandPreview
): string {
  const title = operation.activityTitle;
  if (typeof title === "function") return title(input, preview);
  if (typeof title === "string") return title;
  return `Run ${preview.command}`;
}

function asRecord(value: unknown): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as UnknownRecord;
}

function cleanArgs(values: Array<string | undefined | null | false>): string[] {
  return values.flatMap((value) => (typeof value === "string" && value.length > 0) ? [value] : []);
}

function stringifyDisplay(display: string | string[]): string {
  return Array.isArray(display) ? display.join(" ") : display;
}

function execFilePromise(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout: number;
    maxBuffer: number;
  }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function stableId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
