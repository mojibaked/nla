#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { createEnvelope } from "@nla/protocol";
import { createAdapterRuntime } from "@nla/sdk-core";
import { createOpenRouterAdapter } from "./stdio-openrouter-adapter.mjs";

export async function runOpenRouterChatRepl(options = {}) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;
  const adapter = options.adapter ?? createOpenRouterAdapter(options.adapterConfig);
  const runtime = options.runtime ?? createAdapterRuntime(adapter);
  const metadata = normalizeSessionMetadata(options.metadata);
  let sessionId = options.sessionId ?? createSessionId();
  let assistantStreamOpen = false;
  let assistantSawDelta = false;

  const write = (value) => {
    output.write(value);
  };

  const writeError = (value) => {
    errorOutput.write(value);
  };

  const closeAssistantStream = () => {
    if (!assistantStreamOpen) return;
    assistantStreamOpen = false;
    write("\n");
  };

  const onMessage = async (message) => {
    switch (message.type) {
      case "session.message.delta":
        if (message.data.role !== "assistant") return;
        if (!assistantStreamOpen) {
          assistantStreamOpen = true;
          assistantSawDelta = true;
          write("assistant> ");
        }
        write(message.data.delta);
        return;
      case "session.message":
        if (message.data.role !== "assistant") return;
        if (assistantStreamOpen) {
          closeAssistantStream();
          return;
        }
        write(`assistant> ${message.data.text || ""}\n`);
        return;
      case "session.failed":
        closeAssistantStream();
        writeError(`error> ${message.data.message}\n`);
        return;
      default:
        return;
    }
  };

  const startSession = async () => {
    await runtime.handleStream(createEnvelope("session.start", {
      sessionId,
      metadata
    }, {
      correlationId: sessionId
    }), onMessage);
  };

  const stopSession = async () => {
    await runtime.handleStream(createEnvelope("session.stop", {
      sessionId
    }, {
      correlationId: sessionId
    }), onMessage);
  };

  const sendUserMessage = async (text) => {
    assistantSawDelta = false;
    await runtime.handleStream(createEnvelope("session.message", {
      sessionId,
      role: "user",
      text
    }, {
      correlationId: sessionId
    }), onMessage);
    if (assistantSawDelta) {
      closeAssistantStream();
    }
  };

  const startFreshSession = async () => {
    await stopSession();
    sessionId = createSessionId();
    await startSession();
    write("system> started a new session\n");
  };

  await startSession();

  write("OpenRouter chat REPL\n");
  if (metadata.model) {
    write(`model> ${metadata.model}\n`);
  }
  write("commands> /exit, /quit, /new\n");

  const rl = readline.createInterface({
    input,
    output,
    terminal: Boolean(input.isTTY && output.isTTY)
  });

  const prompt = () => {
    rl.setPrompt("you> ");
    rl.prompt();
  };

  prompt();

  try {
    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (!line) {
        prompt();
        continue;
      }

      if (line === "/exit" || line === "/quit") {
        break;
      }

      if (line === "/new") {
        await startFreshSession();
        prompt();
        continue;
      }

      try {
        await sendUserMessage(line);
      } catch (error) {
        closeAssistantStream();
        writeError(`error> ${error instanceof Error ? error.message : String(error)}\n`);
      }
      prompt();
    }
  } finally {
    closeAssistantStream();
    rl.close();
    await stopSession().catch(() => {});
  }
}

function normalizeSessionMetadata(metadata = {}) {
  return {
    model: metadata.model || process.env.OPENROUTER_MODEL || undefined,
    system: metadata.system || process.env.OPENROUTER_SYSTEM_PROMPT || undefined
  };
}

function createSessionId() {
  return `sess_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runOpenRouterChatRepl();
}
