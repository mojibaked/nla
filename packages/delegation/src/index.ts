import {
  type NlaInteractionPayload,
  type NlaMessage,
  type NlaSessionInteractionRequestedMessage,
  type NlaSessionInterruptResultData,
  type NlaSessionMessage,
  type NlaSessionMessagePart
} from "@nla/protocol";
import {
  tool,
  type NlaSessionToolContextBase,
  type NlaSessionToolDefinition
} from "@nla/sdk-core";

type MaybePromise<T> = T | Promise<T>;

export const NLA_DELEGATION_METADATA_KEY = "nla.delegation";
export const NLA_DELEGATION_DEPTH_METADATA_KEY = "nla.delegation.depth";
export const DEFAULT_NLA_DELEGATION_TIMEOUT_MS = 120_000;
export const DEFAULT_NLA_DELEGATION_MAX_DEPTH = 4;

export interface NlaAdapterTarget {
  readonly id: string;
  readonly name?: string;
  readonly version?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface NlaDelegationContext {
  readonly target: NlaAdapterTarget;
  readonly toolName: string;
  readonly parentSessionId: string;
  readonly parentClientId: string;
  readonly parentTurnId?: string;
  readonly parentUserMessageId?: string;
  readonly parentAssistantMessageId: string;
  readonly parentRequestId?: string;
  readonly depth: number;
  readonly maxDepth: number;
  readonly metadata?: Record<string, unknown>;
}

export interface NlaSessionLaunchRequest {
  readonly target: NlaAdapterTarget;
  readonly context: NlaDelegationContext;
  readonly metadata?: Record<string, unknown>;
  readonly signal: AbortSignal;
}

export interface NlaSessionLauncher {
  readonly launch: (request: NlaSessionLaunchRequest) => MaybePromise<NlaDelegatedSession>;
}

export interface NlaDelegatedUserTurn {
  readonly turnId: string;
  readonly text?: string;
  readonly parts?: ReadonlyArray<NlaSessionMessagePart>;
  readonly metadata?: Record<string, unknown>;
  readonly signal?: AbortSignal;
}

export interface NlaDelegatedInteractionResolution {
  readonly turnId: string;
  readonly resolution: NlaInteractionPayload;
  readonly metadata?: Record<string, unknown>;
  readonly signal?: AbortSignal;
}

export interface NlaDelegatedSessionInterrupt {
  readonly turnId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface NlaDelegatedSessionStop {
  readonly metadata?: Record<string, unknown>;
}

export interface NlaDelegatedSession {
  readonly sessionId: string;
  readonly ephemeral?: boolean;
  sendUserTurn(turn: NlaDelegatedUserTurn): MaybePromise<AsyncIterable<NlaMessage>>;
  resolveInteraction(resolution: NlaDelegatedInteractionResolution): MaybePromise<AsyncIterable<NlaMessage>>;
  interrupt(input: NlaDelegatedSessionInterrupt): MaybePromise<NlaSessionInterruptResultData | void>;
  stop(input?: NlaDelegatedSessionStop): MaybePromise<void>;
}

export interface NlaDelegatedUserMessage {
  readonly text?: string;
  readonly parts?: ReadonlyArray<NlaSessionMessagePart>;
  readonly metadata?: Record<string, unknown>;
}

export interface NlaDelegatedTurnResult<TInput = unknown> {
  readonly target: NlaAdapterTarget;
  readonly sessionId: string;
  readonly turnId: string;
  readonly input: TInput;
  readonly messages: ReadonlyArray<NlaMessage>;
  readonly assistantMessages: ReadonlyArray<NlaSessionMessage>;
  readonly finalAssistantMessage?: NlaSessionMessage;
  readonly assistantDeltas: ReadonlyArray<string>;
}

export interface NlaDelegatedInputMapperInput<TContext, TInput> {
  readonly context: TContext & NlaSessionToolContextBase;
  readonly input: TInput;
  readonly target: NlaAdapterTarget;
  readonly delegation: NlaDelegationContext;
}

export type NlaDelegatedInputMapper<TContext, TInput> = (
  input: NlaDelegatedInputMapperInput<TContext, TInput>
) => MaybePromise<NlaDelegatedUserMessage>;

export type NlaDelegatedOutputMapper<TContext, TInput, TOutput> = (
  result: NlaDelegatedTurnResult<TInput>,
  context: TContext & NlaSessionToolContextBase,
  input: TInput
) => MaybePromise<TOutput>;

export type NlaAdapterTargetResolver<TContext, TInput> =
  | NlaAdapterTarget
  | ((
      context: TContext & NlaSessionToolContextBase,
      input: TInput
    ) => MaybePromise<NlaAdapterTarget>);

export interface NlaAdapterToolOptions<TContext, TInput, TOutput = string> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly decode?: (input: unknown) => TInput;
  readonly target: NlaAdapterTargetResolver<TContext, TInput>;
  readonly launcher: NlaSessionLauncher;
  readonly mapInput?: NlaDelegatedInputMapper<TContext, TInput>;
  readonly mapOutput?: NlaDelegatedOutputMapper<TContext, TInput, TOutput>;
  readonly timeoutMs?: number;
  readonly maxDepth?: number;
}

export class NlaDelegationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NlaDelegationError";
  }
}

export class NlaDelegationDepthError extends NlaDelegationError {
  constructor(depth: number, maxDepth: number) {
    super(`NLA delegation depth ${depth} reached maximum depth ${maxDepth}`);
    this.name = "NlaDelegationDepthError";
  }
}

export class NlaDelegationTimeoutError extends NlaDelegationError {
  constructor(timeoutMs: number) {
    super(`NLA delegation timed out after ${timeoutMs}ms`);
    this.name = "NlaDelegationTimeoutError";
  }
}

export class NlaDelegationFailedError extends NlaDelegationError {
  readonly code?: string;
  readonly data?: unknown;

  constructor(message: string, code?: string, data?: unknown) {
    super(code ? `${message} [${code}]` : message);
    this.name = "NlaDelegationFailedError";
    this.code = code;
    this.data = data;
  }
}

export function adapterTool<TContext = Record<string, never>, TInput = unknown, TOutput = string>(
  options: NlaAdapterToolOptions<TContext, TInput, TOutput>
): NlaSessionToolDefinition<TContext, TInput, TOutput> {
  return tool<TContext, TInput, TOutput>({
    name: options.name,
    description: options.description,
    inputSchema: options.inputSchema,
    decode: options.decode,
    execute: async (context, input) => {
      const maxDepth = normalizeMaxDepth(options.maxDepth);
      const depth = delegationDepth(context);
      if (depth >= maxDepth) {
        throw new NlaDelegationDepthError(depth, maxDepth);
      }

      const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
      const controller = createDelegationAbortController(context.signal, timeoutMs);
      const signal = controller.signal;
      let child: NlaDelegatedSession | undefined;
      let childTurnId: string | undefined;
      let interrupted = false;

      const interruptChild = async (): Promise<void> => {
        if (!child || interrupted) {
          return;
        }
        interrupted = true;
        try {
          await child.interrupt({
            turnId: childTurnId,
            metadata: {
              reason: "parent_abort"
            }
          });
        } catch {
          // Best-effort abort propagation must not hide the original failure.
        }
      };

      try {
        throwIfAborted(signal);
        const target = await withAbort(
          Promise.resolve(resolveTarget(options.target, context, input)),
          signal
        );
        const delegation = createDelegationContext(options.name, target, context, depth, maxDepth);
        const childMessage = await withAbort(
          Promise.resolve((options.mapInput ?? defaultInputMapper<TContext, TInput>)({
            context,
            input,
            target,
            delegation
          })),
          signal
        );
        const childMetadata = childTurnMetadata(childMessage.metadata, delegation);
        childTurnId = context.raw.createId("delegation.turn");
        child = await withAbort(
          Promise.resolve(options.launcher.launch({
            target,
            context: delegation,
            metadata: childMetadata,
            signal
          })),
          signal
        );

        const result = await runDelegatedTurn({
          child,
          context,
          input,
          target,
          turn: {
            turnId: childTurnId,
            text: childMessage.text,
            parts: childMessage.parts,
            metadata: childMetadata,
            signal
          },
          signal,
          toolName: options.name
        });

        const mapOutput = options.mapOutput
          ?? (finalAssistantText as unknown as NlaDelegatedOutputMapper<TContext, TInput, TOutput>);
        return await withAbort(
          Promise.resolve(mapOutput(result, context, input)),
          signal
        );
      } catch (error) {
        if (signal.aborted) {
          await interruptChild();
        }
        throw error;
      } finally {
        controller.dispose();
        if (child && child.ephemeral !== false) {
          try {
            await child.stop({
              metadata: {
                reason: "delegation_complete"
              }
            });
          } catch {
            // Stop is best-effort cleanup for ephemeral children.
          }
        }
      }
    }
  });
}

export function finalAssistantText(result: NlaDelegatedTurnResult): string {
  const message = result.finalAssistantMessage;
  if (message?.data.text !== undefined) {
    return message.data.text;
  }

  const partsText = textFromParts(message?.data.parts);
  if (partsText !== undefined) {
    return partsText;
  }

  if (result.assistantDeltas.length > 0) {
    return result.assistantDeltas.join("");
  }

  throw new NlaDelegationError("Delegated session did not produce assistant text");
}

export function finalAssistantJson<T = unknown>(result: NlaDelegatedTurnResult): T {
  return JSON.parse(finalAssistantText(result)) as T;
}

interface DelegationAbortController {
  readonly signal: AbortSignal;
  dispose(): void;
}

interface RunDelegatedTurnInput<TContext, TInput> {
  readonly child: NlaDelegatedSession;
  readonly context: TContext & NlaSessionToolContextBase;
  readonly input: TInput;
  readonly target: NlaAdapterTarget;
  readonly turn: NlaDelegatedUserTurn;
  readonly signal: AbortSignal;
  readonly toolName: string;
}

interface ProcessStreamInput<TContext> {
  readonly child: NlaDelegatedSession;
  readonly context: TContext & NlaSessionToolContextBase;
  readonly target: NlaAdapterTarget;
  readonly turnId: string;
  readonly messages: NlaMessage[];
  readonly assistantMessages: NlaSessionMessage[];
  readonly assistantDeltas: string[];
  readonly signal: AbortSignal;
  readonly toolName: string;
}

interface ProcessStreamResult {
  readonly interaction?: NlaSessionInteractionRequestedMessage;
}

async function runDelegatedTurn<TContext, TInput>(
  input: RunDelegatedTurnInput<TContext, TInput>
): Promise<NlaDelegatedTurnResult<TInput>> {
  const messages: NlaMessage[] = [];
  const assistantMessages: NlaSessionMessage[] = [];
  const assistantDeltas: string[] = [];
  let stream: AsyncIterable<NlaMessage> | undefined = await withAbort(
    Promise.resolve(input.child.sendUserTurn(input.turn)),
    input.signal
  );

  while (stream) {
    const result: ProcessStreamResult = await processDelegatedStream(stream, {
      child: input.child,
      context: input.context,
      target: input.target,
      turnId: input.turn.turnId,
      messages,
      assistantMessages,
      assistantDeltas,
      signal: input.signal,
      toolName: input.toolName
    });

    if (!result.interaction) {
      stream = undefined;
      continue;
    }

    const childRequest = result.interaction.data.request;
    const parentRequest = parentInteractionRequest(
      childRequest,
      input.context,
      input.child.sessionId
    );
    const resolution = await withAbort(
      Promise.resolve(input.context.awaitInput(parentRequest)),
      input.signal
    );
    stream = await withAbort(
      Promise.resolve(input.child.resolveInteraction({
        turnId: result.interaction.data.turnId ?? input.turn.turnId,
        resolution: {
          ...resolution.resolution,
          requestId: childRequest.requestId
        },
        metadata: resolution.metadata,
        signal: input.signal
      })),
      input.signal
    );
  }

  const finalAssistantMessage = assistantMessages[assistantMessages.length - 1];
  return {
    target: input.target,
    sessionId: input.child.sessionId,
    turnId: input.turn.turnId,
    input: input.input,
    messages,
    assistantMessages,
    finalAssistantMessage,
    assistantDeltas
  };
}

async function processDelegatedStream<TContext>(
  stream: AsyncIterable<NlaMessage>,
  input: ProcessStreamInput<TContext>
): Promise<ProcessStreamResult> {
  const iterator = stream[Symbol.asyncIterator]();
  let done = false;

  try {
    while (true) {
      const next = await abortableNext(iterator, input.signal);
      if (next.done) {
        done = true;
        return {};
      }

      const message = next.value;
      input.messages.push(message);

      switch (message.type) {
        case "session.activity":
          forwardChildActivity(message, input);
          break;
        case "session.message.delta":
          if (message.data.role === "assistant") {
            input.assistantDeltas.push(message.data.delta);
          }
          break;
        case "session.message":
          if (message.data.role === "assistant") {
            input.assistantMessages.push(message);
          }
          break;
        case "session.interaction.requested":
          return {
            interaction: message
          };
        case "session.failed":
          throw new NlaDelegationFailedError(
            message.data.message,
            message.data.code,
            message.data.data
          );
        default:
          break;
      }
    }
  } finally {
    if (!done) {
      try {
        await iterator.return?.();
      } catch {
        // Ignore stream cleanup failures after an interaction or abort.
      }
    }
  }
}

function forwardChildActivity<TContext>(
  message: Extract<NlaMessage, { type: "session.activity" }>,
  input: ProcessStreamInput<TContext>
): void {
  const { turnId, ...activity } = message.data;
  input.context.activity({
    ...activity,
    activityId: `${input.toolName}:${input.child.sessionId}:${activity.activityId}`,
    data: {
      childSessionId: input.child.sessionId,
      childTurnId: turnId,
      targetId: input.target.id,
      data: activity.data
    }
  });
}

function parentInteractionRequest<TContext>(
  request: NlaInteractionPayload,
  context: TContext & NlaSessionToolContextBase,
  childSessionId: string
): NlaInteractionPayload {
  const existingMetadata = asRecord(request.metadata);
  return {
    ...request,
    requestId: context.raw.createId("delegation.input"),
    metadata: {
      ...existingMetadata,
      [NLA_DELEGATION_METADATA_KEY]: {
        childSessionId,
        childRequestId: request.requestId,
        parentSessionId: context.sessionId,
        parentTurnId: context.turnId
      }
    }
  };
}

function createDelegationContext<TContext>(
  toolName: string,
  target: NlaAdapterTarget,
  context: TContext & NlaSessionToolContextBase,
  depth: number,
  maxDepth: number
): NlaDelegationContext {
  return {
    target,
    toolName,
    parentSessionId: context.sessionId,
    parentClientId: context.clientId,
    parentTurnId: context.turnId,
    parentUserMessageId: context.userMessageId,
    parentAssistantMessageId: context.assistantMessageId,
    parentRequestId: context.request.id ?? context.request.correlationId,
    depth,
    maxDepth,
    metadata: {
      [NLA_DELEGATION_DEPTH_METADATA_KEY]: depth
    }
  };
}

function childTurnMetadata(
  metadata: Record<string, unknown> | undefined,
  delegation: NlaDelegationContext
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    [NLA_DELEGATION_DEPTH_METADATA_KEY]: delegation.depth + 1,
    [NLA_DELEGATION_METADATA_KEY]: {
      parentSessionId: delegation.parentSessionId,
      parentTurnId: delegation.parentTurnId,
      parentClientId: delegation.parentClientId,
      toolName: delegation.toolName,
      targetId: delegation.target.id,
      depth: delegation.depth + 1
    }
  };
}

function resolveTarget<TContext, TInput>(
  target: NlaAdapterTargetResolver<TContext, TInput>,
  context: TContext & NlaSessionToolContextBase,
  input: TInput
): MaybePromise<NlaAdapterTarget> {
  return typeof target === "function"
    ? target(context, input)
    : target;
}

function defaultInputMapper<TContext, TInput>(
  input: NlaDelegatedInputMapperInput<TContext, TInput>
): NlaDelegatedUserMessage {
  return defaultUserMessage(input.input);
}

function defaultUserMessage(input: unknown): NlaDelegatedUserMessage {
  if (typeof input === "string") {
    return {
      text: input
    };
  }

  const record = asRecord(input);
  if (record) {
    const text = typeof record.text === "string"
      ? record.text
      : typeof record.prompt === "string"
        ? record.prompt
        : undefined;
    const parts = Array.isArray(record.parts)
      ? record.parts as ReadonlyArray<NlaSessionMessagePart>
      : undefined;
    const metadata = asRecord(record.metadata);

    if (text !== undefined || parts) {
      return {
        text,
        parts,
        metadata
      };
    }

    return {
      text: JSON.stringify(input)
    };
  }

  if (input === undefined || input === null) {
    return {
      text: ""
    };
  }

  return {
    text: String(input)
  };
}

function delegationDepth(context: NlaSessionToolContextBase): number {
  const metadata = context.request.data.metadata;
  return readDepth(metadata?.[NLA_DELEGATION_DEPTH_METADATA_KEY])
    ?? readDepth(asRecord(metadata?.[NLA_DELEGATION_METADATA_KEY])?.depth)
    ?? 0;
}

function readDepth(value: unknown): number | undefined {
  const numberValue = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : undefined;

  return typeof numberValue === "number" && Number.isFinite(numberValue) && numberValue >= 0
    ? Math.floor(numberValue)
    : undefined;
}

function normalizeMaxDepth(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : DEFAULT_NLA_DELEGATION_MAX_DEPTH;
}

function normalizeTimeoutMs(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_NLA_DELEGATION_TIMEOUT_MS;
}

function createDelegationAbortController(
  parentSignal: AbortSignal,
  timeoutMs: number
): DelegationAbortController {
  const controller = new AbortController();
  const abortFromParent = (): void => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal.reason ?? new Error("NLA delegation aborted"));
    }
  };
  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new NlaDelegationTimeoutError(timeoutMs));
    }
  }, timeoutMs);

  if (parentSignal.aborted) {
    abortFromParent();
  } else {
    parentSignal.addEventListener("abort", abortFromParent, {
      once: true
    });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal.removeEventListener("abort", abortFromParent);
    }
  };
}

async function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) {
    throw abortReason(signal);
  }

  let removeAbortListener = (): void => {};
  const abortPromise = new Promise<T>((_, reject) => {
    const onAbort = (): void => {
      reject(abortReason(signal));
    };
    removeAbortListener = () => {
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, {
      once: true
    });
  });

  promise.catch(() => undefined);

  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    removeAbortListener();
  }
}

async function abortableNext<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal
): Promise<IteratorResult<T>> {
  return withAbort(Promise.resolve(iterator.next()), signal);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortReason(signal);
  }
}

function abortReason(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) {
    return reason;
  }

  if (typeof reason === "string" && reason.trim()) {
    return new Error(reason);
  }

  return new Error("NLA delegation aborted");
}

function textFromParts(
  parts: ReadonlyArray<NlaSessionMessagePart> | undefined
): string | undefined {
  if (!parts || parts.length === 0) {
    return undefined;
  }

  const text = parts.map((part) =>
    part.type === "text" && typeof part.text === "string"
      ? part.text
      : ""
  ).join("");

  return text.trim() ? text.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
