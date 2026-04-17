import readline from "node:readline";
import type { Readable, Writable } from "node:stream";
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
  type NlaRuntimeOptions
} from "@nla/sdk-core";

type MaybePromise<T> = T | Promise<T>;

export interface NlaMessageProcessor {
  handle(message: NlaMessage): MaybePromise<readonly NlaMessage[] | NlaMessage | void>;
}

export interface NlaStdioRunOptions {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
  runtimeOptions?: NlaRuntimeOptions;
}

export function serializeJsonlMessage(message: NlaEnvelope): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseJsonlMessage(line: string): NlaMessage {
  const parsed = JSON.parse(line);
  const validation = validateNlaMessage(parsed);
  if (!validation.ok) {
    throw new Error(`Invalid NLA JSONL message: ${formatValidationIssues(validation.errors)}`);
  }
  return validation.value;
}

export function createJsonlWriter(output: Writable = process.stdout) {
  return {
    write(message: NlaEnvelope): void {
      safeWrite(output, serializeJsonlMessage(message));
    },
    writeAll(messages: Iterable<NlaEnvelope>): void {
      for (const message of messages) {
        safeWrite(output, serializeJsonlMessage(message));
      }
    }
  };
}

export async function runAdapterStdio(
  adapterOrRuntime: NlaAdapterDefinition | NlaAdapterRuntime,
  options: NlaStdioRunOptions = {}
): Promise<void> {
  const runtime = isAdapterRuntime(adapterOrRuntime)
    ? adapterOrRuntime
    : createAdapterRuntime(adapterOrRuntime, options.runtimeOptions);
  const input = options.stdin ?? process.stdin;
  const output = options.stdout ?? process.stdout;
  const errorOutput = options.stderr ?? process.stderr;
  const writer = createJsonlWriter(output);
  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity
  });

  let queue = Promise.resolve();
  const concurrent = new Set<Promise<void>>();
  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;

    const message = parseJsonlMessage(line);
    const runMessage = async (): Promise<void> => {
      if (typeof runtime.handleStream === "function") {
        await runtime.handleStream(message, (response) => {
          writer.write(response);
        });
        return;
      }

      const responses = await runtime.handle(message);
      writer.writeAll(toArray(responses));
    };
    const handleError = (error: unknown): void => {
      safeWrite(errorOutput, `[nla] ${errorMessage(error)}\n`);
    };

    if (
      message.type === "session.interrupt"
      || message.type === "session.interaction.resolve"
      || message.type === "session.stop"
    ) {
      const task = runMessage().catch(handleError).finally(() => {
        concurrent.delete(task);
      });
      concurrent.add(task);
      continue;
    }

    queue = queue
      .then(runMessage)
      .catch(handleError);
  }

  await queue;
  await Promise.allSettled(concurrent);
}

function toArray(
  value: readonly NlaMessage[] | NlaMessage | void
): readonly NlaMessage[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value as readonly NlaMessage[];
  return [value as NlaMessage];
}

function safeWrite(stream: Writable, value: string): void {
  try {
    stream.write(value);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPIPE") return;
    throw error;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export {
  openJsonlChildTransport,
  type OpenJsonlChildTransportInput
} from "./child-process.js";
