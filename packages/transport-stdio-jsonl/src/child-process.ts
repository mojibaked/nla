import { spawn, type ChildProcessByStdio } from "node:child_process";
import readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  formatValidationIssues,
  validateNlaMessage,
  type NlaMessage
} from "@nla/protocol";
import type { NlaSessionTransportHandle } from "@nla/host-core";

type JsonlChildProcess = ChildProcessByStdio<Writable, Readable, Readable>;
const ProcessTreeStopGraceMs = 1_000;

export interface OpenJsonlChildTransportInput {
  readonly sessionId: string;
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly onMessage: (message: NlaMessage) => void;
  readonly onFailure: (error: Error) => void;
}

export function openJsonlChildTransport(
  input: OpenJsonlChildTransportInput
): NlaSessionTransportHandle {
  const child = spawn(input.command, [...(input.args ?? [])], {
    cwd: input.cwd?.trim() || undefined,
    env: {
      ...process.env,
      ...input.env
    },
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"]
  } as const);

  const stdoutLines = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity
  });
  const stderrLinesReader = readline.createInterface({
    input: child.stderr,
    crlfDelay: Infinity
  });
  const stderrLines: string[] = [];
  let closed = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  const asError = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

  const transportError = (error: Error): Error => {
    const stderr = stderrLines.join("\n").trim();
    if (!stderr) {
      return error;
    }

    return new Error(`${error.message}\n[nla stderr]\n${stderr}`);
  };

  const closeReadline = (lineReader: readline.Interface): void => {
    try {
      lineReader.close();
    } catch {
      // Ignore already-closed readers during teardown.
    }
  };

  const clearKillTimer = (): void => {
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = undefined;
    }
  };

  const signalProcessTree = (signal: NodeJS.Signals): void => {
    if (typeof child.pid !== "number") {
      return;
    }

    if (process.platform !== "win32") {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ESRCH") {
          return;
        }
      }
    }

    try {
      child.kill(signal);
    } catch {
      // Ignore teardown races when the process already exited.
    }
  };

  const close = (): void => {
    if (closed) {
      return;
    }

    closed = true;
    closeReadline(stdoutLines);
    closeReadline(stderrLinesReader);

    try {
      child.stdin.end();
    } catch {
      // Ignore teardown races when the process already exited.
    }

    signalProcessTree("SIGTERM");
    killTimer = setTimeout(() => {
      killTimer = undefined;
      signalProcessTree("SIGKILL");
    }, ProcessTreeStopGraceMs);
    killTimer.unref?.();
  };

  const fail = (error: Error): void => {
    if (closed) {
      return;
    }

    input.onFailure(transportError(error));
    close();
  };

  const parseMessage = (line: string): NlaMessage => {
    const parsed = JSON.parse(line);
    const validation = validateNlaMessage(parsed);

    if (!validation.ok) {
      throw new Error(`Invalid NLA JSONL message: ${formatValidationIssues(validation.errors)}`);
    }

    return validation.value;
  };

  stdoutLines.on("line", (rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    try {
      input.onMessage(parseMessage(line));
    } catch (error) {
      fail(asError(error));
    }
  });

  stderrLinesReader.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    stderrLines.push(trimmed);
    if (stderrLines.length > 20) {
      stderrLines.shift();
    }
  });

  child.on("error", (error) => {
    fail(asError(error));
  });

  child.on("exit", (code, signal) => {
    if (!closed || process.platform === "win32") {
      clearKillTimer();
    }
    if (closed) {
      return;
    }

    fail(new Error(`Adapter process exited (code ${code ?? "null"}, signal ${signal ?? "null"})`));
  });

  return {
    sessionId: input.sessionId,
    send: (message: NlaMessage) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    close,
    isClosed: () => closed
  };
}
