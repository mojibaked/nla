import AjvModule, { type ErrorObject, type ValidateFunction } from "ajv";
import {
  createEnvelope,
  formatValidationIssues,
  validateNlaMessage,
  type NlaActivityData,
  type NlaAdapterIdentity,
  type NlaArtifactData,
  type NlaCapabilities,
  type NlaDiscoveredData,
  type NlaEnvelope,
  type NlaFailedData,
  type NlaInvokeCancelledMessage,
  type NlaInvokeCompletedMessage,
  type NlaInvokeOutputDeltaData,
  type NlaInvokeOutputDeltaMessage,
  type NlaInvokeOutputDeltaMode,
  type NlaInvokeFailedMessage,
  type NlaInvokeOutputMessage,
  type NlaInvokeLogData,
  type NlaInvokeRequestMessage,
  type NlaMessage,
  type NlaOperationDescriptor,
  type NlaInteractionPayload,
  type NlaSessionActivityMessage,
  type NlaSessionArtifactMessage,
  type NlaSessionCompletedMessage,
  type NlaSessionControlDefinition,
  type NlaSessionControlMessage,
  type NlaSessionControlStateData,
  type NlaSessionExecutionData,
  type NlaSessionFailedMessage,
  type NlaSessionMessage,
  type NlaSessionMessageData,
  type NlaSessionMessageDeltaData,
  type NlaSessionControlsGetMessage,
  type NlaSessionInteractionRequestedData,
  type NlaSessionInteractionResolveData,
  type NlaSessionInteractionResolveMessage,
  type NlaSessionInteractionResolvedData,
  type NlaSessionInterruptData,
  type NlaSessionInterruptMessage,
  type NlaSessionInterruptResultData,
  type NlaSessionResumeMessage,
  type NlaSessionStartMessage,
  type NlaSessionStartedData,
  type NlaSessionInterruptStatus,
  type NlaSessionStatus,
  type NlaSessionStatusData,
  type NlaSessionStopMessage,
  type NlaSessionStoppedMessage,
  type NlaValidationIssue
} from "@nla/protocol";

type MaybePromise<T> = T | Promise<T>;
type UnknownRecord = Record<string, unknown>;

export interface NlaRuntimeValidationOptions {
  messages?: boolean;
  operations?: boolean;
  ajv?: JsonSchemaCompiler;
}

export interface NlaRuntimeOptions {
  now?: () => Date;
  createId?: (prefix: string) => string;
  validation?: boolean | NlaRuntimeValidationOptions;
}

export interface NlaRuntimeSession {
  id: string;
  providerRef?: string;
  state?: Record<string, unknown>;
}

export interface NlaAdapterDefinition {
  id: string;
  name: string;
  version?: string;
  capabilities?: NlaCapabilities;
  operations?: NlaOperationDescriptor[];
  invoke?: (ctx: NlaInvokeHandlerContext, message: NlaInvokeRequestMessage) => MaybePromise<unknown>;
  sessionStart?: (ctx: NlaSessionHandlerContext, message: NlaSessionStartMessage) => MaybePromise<void>;
  sessionResume?: (ctx: NlaSessionHandlerContext, message: NlaSessionResumeMessage) => MaybePromise<void>;
  sessionMessage?: (ctx: NlaSessionHandlerContext, message: NlaSessionMessage) => MaybePromise<void>;
  sessionControls?: (
    ctx: NlaSessionHandlerContext,
    message: NlaSessionControlsGetMessage
  ) => MaybePromise<ReadonlyArray<NlaSessionControlDefinition> | void>;
  sessionInput?: (
    ctx: NlaSessionHandlerContext,
    message: NlaSessionInteractionResolveMessage
  ) => MaybePromise<void>;
  sessionInterrupt?: (
    ctx: NlaSessionHandlerContext,
    message: NlaSessionInterruptMessage
  ) => MaybePromise<void>;
  sessionControl?: (ctx: NlaSessionHandlerContext, message: NlaSessionControlMessage) => MaybePromise<void>;
  sessionStop?: (ctx: NlaSessionHandlerContext, message: NlaSessionStopMessage) => MaybePromise<void>;
}

export interface NlaAdapterRuntime {
  readonly adapter: NlaAdapterDefinition;
  handle(message: NlaMessage): Promise<NlaMessage[]>;
  handleStream(message: NlaMessage, sink: NlaRuntimeMessageSink): Promise<void>;
  discover(): NlaDiscoveredData;
}

export type NlaRuntimeMessageSink = (message: NlaMessage) => MaybePromise<void>;

export interface NlaBaseHandlerContext<TRequest extends NlaMessage = NlaMessage> {
  readonly adapter: NlaAdapterIdentity;
  readonly request: TRequest;
  emit<TType extends string, TData>(
    type: TType,
    data: TData,
    options?: {
      correlationId?: string;
      id?: string;
      timestamp?: string;
    }
  ): void;
  createId(prefix?: string): string;
}

export interface NlaInvokeOutputDeltaOptions {
  streamId?: string;
  seq?: number;
  mode?: NlaInvokeOutputDeltaMode;
  contentType?: string;
  metadata?: UnknownRecord;
}

export interface NlaInvokeOutputDeltaRef {
  streamId: string;
  seq: number;
}

export interface NlaInvokeHandlerContext extends NlaBaseHandlerContext<NlaInvokeRequestMessage> {
  output(output: unknown, metadata?: UnknownRecord): void;
  outputDelta(delta: unknown, options?: NlaInvokeOutputDeltaOptions): NlaInvokeOutputDeltaRef;
  progress(label: string, progress?: number, data?: unknown): void;
  log(message: string, level?: NlaInvokeLogData["level"], data?: unknown): void;
  activity(activity: NlaActivityData): void;
  artifact(artifact: NlaArtifactData): void;
  complete(output?: unknown): void;
  cancel(reason?: string): void;
  fail(error: string | Omit<NlaFailedData, "ok">): void;
  isSettled(): boolean;
}

export interface NlaSessionHandlerContext
  extends NlaBaseHandlerContext<
    | NlaSessionStartMessage
    | NlaSessionResumeMessage
    | NlaSessionMessage
    | NlaSessionControlsGetMessage
    | NlaSessionInteractionResolveMessage
    | NlaSessionInterruptMessage
    | NlaSessionControlMessage
    | NlaSessionStopMessage
  > {
  readonly session: NlaRuntimeSession;
  setProviderRef(providerRef?: string): void;
  setState(state?: Record<string, unknown>): void;
  mergeState(partial: Record<string, unknown>): void;
  started(data?: Omit<NlaSessionStartedData, "sessionId">): void;
  status(status: NlaSessionStatus, label?: string, data?: unknown): void;
  execution(execution: Omit<NlaSessionExecutionData, "sessionId">): void;
  message(message: Omit<NlaSessionMessageData, "sessionId">): void;
  reply(text: string, metadata?: Record<string, unknown>): void;
  messageDelta(message: Omit<NlaSessionMessageDeltaData, "sessionId">): void;
  controls(controls: ReadonlyArray<NlaSessionControlDefinition>): void;
  controlState(state: Omit<NlaSessionControlStateData, "sessionId">): void;
  activity(activity: NlaActivityData): void;
  artifact(artifact: NlaArtifactData): void;
  requestInput(request: Omit<NlaSessionInteractionRequestedData, "sessionId">): void;
  resolveInput(resolution: Omit<NlaSessionInteractionResolvedData, "sessionId">): void;
  interruptResult(result: Omit<NlaSessionInterruptResultData, "sessionId">): void;
  complete(): void;
  fail(error: string | Omit<NlaFailedData, "ok">): void;
  stopped(): void;
}

export function defineAdapter<T extends NlaAdapterDefinition>(adapter: T): T {
  return adapter;
}

export function createAdapterRuntime(
  adapter: NlaAdapterDefinition,
  options: NlaRuntimeOptions = {}
): NlaAdapterRuntime {
  return new AdapterRuntime(adapter, options);
}

export function isAdapterRuntime(value: unknown): value is NlaAdapterRuntime {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.handle === "function" && typeof record.discover === "function";
}

interface CompiledOperationDefinition {
  descriptor: NlaOperationDescriptor;
  validateInput?: ValidateFunction;
  validateOutput?: ValidateFunction;
}

interface JsonSchemaCompiler {
  compile(schema: object): ValidateFunction;
}

interface NormalizedValidationOptions {
  messages: boolean;
  operations: boolean;
  ajv?: JsonSchemaCompiler;
}

interface QueuedMessageEmitter {
  emit(message: NlaMessage): void;
  drain(): Promise<void>;
}

interface SessionHandlerState {
  terminal: boolean;
  controlsEmitted?: boolean;
  controlStateEmitted?: boolean;
  interruptResultEmitted?: boolean;
}

const requestTurnId = (
  request:
    | NlaSessionMessage
    | NlaSessionInteractionResolveMessage
    | NlaSessionStartMessage
    | NlaSessionResumeMessage
    | NlaSessionControlsGetMessage
    | NlaSessionInterruptMessage
    | NlaSessionControlMessage
    | NlaSessionStopMessage
): string | undefined => {
  if ("metadata" in request.data && request.data.metadata) {
    const candidate = request.data.metadata.turnId;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
};

class AdapterRuntime implements NlaAdapterRuntime {
  readonly adapter: NlaAdapterDefinition;
  readonly #now: () => Date;
  readonly #createId: (prefix: string) => string;
  readonly #sessions = new Map<string, NlaRuntimeSession>();
  readonly #validation: NormalizedValidationOptions;
  readonly #operations = new Map<string, CompiledOperationDefinition>();
  #counter = 0;

  constructor(adapter: NlaAdapterDefinition, options: NlaRuntimeOptions) {
    this.adapter = adapter;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? ((prefix) => this.#nextId(prefix));
    this.#validation = normalizeValidationOptions(options.validation);
    this.#operations = compileOperations(adapter.operations || [], this.#validation);
  }

  discover(): NlaDiscoveredData {
    return {
      adapter: this.#identity(),
      capabilities: this.adapter.capabilities,
      operations: this.adapter.operations
    };
  }

  async handle(message: NlaMessage): Promise<NlaMessage[]> {
    const messages: NlaMessage[] = [];
    await this.handleStream(message, (response) => {
      messages.push(response);
    });
    return messages;
  }

  async handleStream(message: NlaMessage, sink: NlaRuntimeMessageSink): Promise<void> {
    if (this.#validation.messages) {
      const validation = validateNlaMessage(message);
      if (!validation.ok) {
        throw new Error(`Invalid NLA runtime message: ${formatValidationIssues(validation.errors)}`);
      }
    }

    const emitter = createQueuedMessageEmitter(sink);

    switch (message.type) {
      case "initialize":
        emitter.emit(
          this.#message("initialized", {
            adapter: this.#identity(),
            capabilities: this.adapter.capabilities
          }, message.correlationId)
        );
        break;
      case "discover":
        emitter.emit(this.#message("discovered", this.discover(), message.correlationId));
        break;
      case "invoke.request":
        await this.#handleInvoke(message, emitter);
        break;
      case "session.start":
        await this.#handleSessionStart(message, emitter);
        break;
      case "session.resume":
        await this.#handleSessionResume(message, emitter);
        break;
      case "session.message":
        await this.#handleSessionMessage(message, emitter);
        break;
      case "session.controls.get":
        await this.#handleSessionControls(message, emitter);
        break;
      case "session.interaction.resolve":
        await this.#handleSessionInput(message, emitter);
        break;
      case "session.interrupt":
        await this.#handleSessionInterrupt(message, emitter);
        break;
      case "session.control":
        await this.#handleSessionControl(message, emitter);
        break;
      case "session.stop":
        await this.#handleSessionStop(message, emitter);
        break;
      default:
        break;
    }

    await emitter.drain();
  }

  async #handleInvoke(
    message: NlaInvokeRequestMessage,
    emitter: QueuedMessageEmitter
  ): Promise<void> {
    const correlationId = message.correlationId ?? this.#createId("invoke");
    const state = { settled: false };
    const streamSeqById = new Map<string, number>();
    let defaultStreamId: string | undefined;
    const operation = this.#resolveOperation(message.data.operation);
    const failWithIssues = (summary: string, issues: NlaValidationIssue[]): void => {
      state.settled = true;
      const event: NlaInvokeFailedMessage = this.#message(
        "invoke.failed",
        {
          ok: false,
          code: "validation_error",
          message: summary,
          data: { errors: issues }
        },
        correlationId
      );
      emitter.emit(event);
    };
    const validateOutputOrFail = (output: unknown): boolean => {
      if (!this.#validation.operations || !operation?.validateOutput) return true;
      if (operation.validateOutput(output)) return true;

      failWithIssues(
        `Invalid output for operation ${message.data.operation}.`,
        ajvErrorsToIssues(operation.validateOutput.errors)
      );
      return false;
    };
    const nextOutputDeltaRef = (
      options: NlaInvokeOutputDeltaOptions = {}
    ): NlaInvokeOutputDeltaRef => {
      const streamId = options.streamId
        || defaultStreamId
        || this.#createId("stream");
      if (!defaultStreamId && !options.streamId) {
        defaultStreamId = streamId;
      }
      const seq = options.seq ?? ((streamSeqById.get(streamId) ?? 0) + 1);
      streamSeqById.set(streamId, seq);
      return {
        streamId,
        seq
      };
    };

    const ctx: NlaInvokeHandlerContext = {
      adapter: this.#identity(),
      request: message,
      emit: (type, data, options = {}) => {
        emitter.emit(
          this.#message(type, data, options.correlationId ?? correlationId, options.id, options.timestamp) as NlaMessage
        );
      },
      createId: (prefix = "id") => this.#createId(prefix),
      output: (output, metadata) => {
        if (state.settled) return;
        if (!validateOutputOrFail(output)) return;
        const event: NlaInvokeOutputMessage = this.#message(
          "invoke.output",
          { output, metadata },
          correlationId
        );
        emitter.emit(event);
      },
      outputDelta: (delta, options = {}) => {
        const ref = nextOutputDeltaRef(options);
        if (state.settled) return ref;
        const eventData: NlaInvokeOutputDeltaData = {
          streamId: ref.streamId,
          seq: ref.seq,
          delta,
          mode: options.mode,
          contentType: options.contentType,
          metadata: options.metadata
        };
        const event: NlaInvokeOutputDeltaMessage = this.#message(
          "invoke.output.delta",
          eventData,
          correlationId
        );
        emitter.emit(event);
        return ref;
      },
      progress: (label, progress, data) => {
        emitter.emit(this.#message("invoke.progress", { label, progress, data }, correlationId));
      },
      log: (entry, level = "info", data) => {
        emitter.emit(this.#message("invoke.log", { level, message: entry, data }, correlationId));
      },
      activity: (activity) => {
        emitter.emit(this.#message("invoke.activity", activity, correlationId));
      },
      artifact: (artifact) => {
        emitter.emit(this.#message("invoke.artifact", artifact, correlationId));
      },
      complete: (output) => {
        if (state.settled) return;
        if (output !== undefined && !validateOutputOrFail(output)) return;
        state.settled = true;
        const event: NlaInvokeCompletedMessage = this.#message(
          "invoke.completed",
          output === undefined ? { ok: true } : { ok: true, output },
          correlationId
        );
        emitter.emit(event);
      },
      cancel: (reason) => {
        if (state.settled) return;
        state.settled = true;
        const event: NlaInvokeCancelledMessage = this.#message(
          "invoke.cancelled",
          { ok: false, reason },
          correlationId
        );
        emitter.emit(event);
      },
      fail: (error) => {
        if (state.settled) return;
        state.settled = true;
        const event: NlaInvokeFailedMessage = this.#message(
          "invoke.failed",
          normalizeFailure(error),
          correlationId
        );
        emitter.emit(event);
      },
      isSettled: () => state.settled
    };

    if (!this.adapter.invoke) {
      ctx.fail({
        code: "capability_error",
        message: "Adapter does not implement invoke handling."
      });
      return;
    }

    if (this.adapter.operations?.length && !operation) {
      ctx.fail({
        code: "unknown_operation",
        message: `Unknown operation: ${message.data.operation}`
      });
      return;
    }

    if (this.#validation.operations && operation?.validateInput && !operation.validateInput(message.data.input)) {
      failWithIssues(
        `Invalid input for operation ${message.data.operation}.`,
        ajvErrorsToIssues(operation.validateInput.errors)
      );
      return;
    }

    try {
      const result = await this.adapter.invoke(ctx, message);
      if (result !== undefined && !state.settled) {
        if (!validateOutputOrFail(result)) return;
        ctx.output(result);
        ctx.complete();
      }
    } catch (error) {
      if (!state.settled) {
        ctx.fail({
          code: "runtime_error",
          message: errorMessage(error)
        });
      }
    }
  }

  async #handleSessionStart(
    message: NlaSessionStartMessage,
    emitter: QueuedMessageEmitter
  ): Promise<void> {
    const session = this.#ensureSession(message.data.sessionId);
    const state: SessionHandlerState = { terminal: false };
    const ctx = this.#sessionContext(message, session, emitter, state);

    try {
      if (this.adapter.sessionStart) {
        await this.adapter.sessionStart(ctx, message);
      } else {
        ctx.fail({
          code: "capability_error",
          message: "Adapter does not implement session start handling."
        });
      }
    } catch (error) {
      if (!state.terminal) {
        ctx.fail({
          code: "runtime_error",
          message: errorMessage(error)
        });
      }
    }

    if (state.terminal) this.#sessions.delete(session.id);
  }

  async #handleSessionResume(
    message: NlaSessionResumeMessage,
    emitter: QueuedMessageEmitter
  ): Promise<void> {
    const session = this.#ensureSession(message.data.sessionId);
    session.providerRef = message.data.providerRef ?? session.providerRef;
    session.state = message.data.state ?? session.state;

    const state: SessionHandlerState = { terminal: false };
    const ctx = this.#sessionContext(message, session, emitter, state);

    try {
      if (this.adapter.sessionResume) {
        await this.adapter.sessionResume(ctx, message);
      } else {
        ctx.fail({
          code: "capability_error",
          message: "Adapter does not implement session resume handling."
        });
      }
    } catch (error) {
      if (!state.terminal) {
        ctx.fail({
          code: "runtime_error",
          message: errorMessage(error)
        });
      }
    }

    if (state.terminal) this.#sessions.delete(session.id);
  }

  async #handleSessionMessage(
    message: NlaSessionMessage,
    emitter: QueuedMessageEmitter
  ): Promise<void> {
    const session = this.#ensureSession(message.data.sessionId);
    const state: SessionHandlerState = { terminal: false };
    const ctx = this.#sessionContext(message, session, emitter, state);

    if (!this.adapter.sessionMessage) {
      ctx.fail({
        code: "capability_error",
        message: "Adapter does not implement session message handling."
      });
      return;
    }

    try {
      await this.adapter.sessionMessage(ctx, message);
    } catch (error) {
      if (!state.terminal) {
        ctx.fail({
          code: "runtime_error",
          message: errorMessage(error)
        });
      }
    }

    if (state.terminal) this.#sessions.delete(session.id);
  }

  async #handleSessionInput(
    message: NlaSessionInteractionResolveMessage,
    emitter: QueuedMessageEmitter
  ): Promise<void> {
    const session = this.#ensureSession(message.data.sessionId);
    const state: SessionHandlerState = { terminal: false };
    const ctx = this.#sessionContext(message, session, emitter, state);

    if (!this.adapter.sessionInput) {
      ctx.fail({
        code: "capability_error",
        message: "Adapter does not implement session input handling."
      });
      return;
    }

    try {
      await this.adapter.sessionInput(ctx, message);
    } catch (error) {
      if (!state.terminal) {
        ctx.fail({
          code: "runtime_error",
          message: errorMessage(error)
        });
      }
    }

    if (state.terminal) this.#sessions.delete(session.id);
  }

  async #handleSessionControls(
    message: NlaSessionControlsGetMessage,
    emitter: QueuedMessageEmitter
  ): Promise<void> {
    const session = this.#ensureSession(message.data.sessionId);
    const state: SessionHandlerState = { terminal: false };
    const ctx = this.#sessionContext(message, session, emitter, state);

    if (!this.adapter.sessionControls) {
      ctx.controls([]);
      return;
    }

    try {
      const controls = await this.adapter.sessionControls(ctx, message);
      if (controls !== undefined && !state.controlsEmitted) {
        ctx.controls(controls);
      } else if (!state.controlsEmitted) {
        ctx.controls([]);
      }
    } catch (error) {
      if (!state.terminal) {
        ctx.fail({
          code: "runtime_error",
          message: errorMessage(error)
        });
      }
    }

    if (state.terminal) this.#sessions.delete(session.id);
  }

  async #handleSessionControl(
    message: NlaSessionControlMessage,
    emitter: QueuedMessageEmitter
  ): Promise<void> {
    const session = this.#ensureSession(message.data.sessionId);
    const state: SessionHandlerState = { terminal: false };
    const ctx = this.#sessionContext(message, session, emitter, state);

    if (!this.adapter.sessionControl) {
      ctx.controlState({
        controlId: message.data.control,
        status: "unsupported",
        optionId: message.data.optionId,
        value: message.data.value,
        label: "Adapter does not implement session control handling."
      });
      return;
    }

    try {
      await this.adapter.sessionControl(ctx, message);
    } catch (error) {
      if (!state.terminal) {
        ctx.fail({
          code: "runtime_error",
          message: errorMessage(error)
        });
      }
    }

    if (state.terminal) this.#sessions.delete(session.id);
  }

  async #handleSessionInterrupt(
    message: NlaSessionInterruptMessage,
    emitter: QueuedMessageEmitter
  ): Promise<void> {
    const session = this.#ensureSession(message.data.sessionId);
    const state: SessionHandlerState = { terminal: false };
    const ctx = this.#sessionContext(message, session, emitter, state);

    if (!this.adapter.sessionInterrupt) {
      ctx.interruptResult({
        status: "unsupported",
        turnId: message.data.turnId,
        message: "Adapter does not implement session interrupt handling."
      });
      return;
    }

    try {
      await this.adapter.sessionInterrupt(ctx, message);
    } catch (error) {
      if (!state.terminal) {
        ctx.fail({
          code: "runtime_error",
          message: errorMessage(error)
        });
      }
    }

    if (state.terminal) this.#sessions.delete(session.id);
  }

  async #handleSessionStop(
    message: NlaSessionStopMessage,
    emitter: QueuedMessageEmitter
  ): Promise<void> {
    const session = this.#ensureSession(message.data.sessionId);
    const state: SessionHandlerState = { terminal: false };
    const ctx = this.#sessionContext(message, session, emitter, state);

    try {
      if (this.adapter.sessionStop) {
        await this.adapter.sessionStop(ctx, message);
      } else {
        ctx.stopped();
      }
    } catch (error) {
      if (!state.terminal) {
        ctx.fail({
          code: "runtime_error",
          message: errorMessage(error)
        });
      }
    }

    this.#sessions.delete(session.id);
  }

  #sessionContext(
    request:
      | NlaSessionStartMessage
      | NlaSessionResumeMessage
      | NlaSessionMessage
      | NlaSessionControlsGetMessage
      | NlaSessionInteractionResolveMessage
      | NlaSessionInterruptMessage
      | NlaSessionControlMessage
      | NlaSessionStopMessage,
    session: NlaRuntimeSession,
    emitter: QueuedMessageEmitter,
    state: SessionHandlerState
  ): NlaSessionHandlerContext {
    const correlationId = request.correlationId ?? request.id ?? session.id;
    const currentTurnId = requestTurnId(request);

    const emit = <TType extends string, TData>(
      type: TType,
      data: TData,
      options: { correlationId?: string; id?: string; timestamp?: string } = {}
    ): void => {
      emitter.emit(
        this.#message(type, data, options.correlationId ?? correlationId, options.id, options.timestamp) as NlaMessage
      );
    };

    const fail = (error: string | Omit<NlaFailedData, "ok">): void => {
      if (state.terminal) return;
      state.terminal = true;
      const event: NlaSessionFailedMessage = this.#message(
        "session.failed",
        {
          sessionId: session.id,
          ...normalizeFailure(error)
        },
        correlationId
      );
      emitter.emit(event);
    };

    return {
      adapter: this.#identity(),
      request,
      session,
      emit,
      createId: (prefix = "id") => this.#createId(prefix),
      setProviderRef: (providerRef) => {
        session.providerRef = providerRef;
      },
      setState: (nextState) => {
        session.state = nextState;
      },
      mergeState: (partial) => {
        session.state = {
          ...(session.state || {}),
          ...partial
        };
      },
      started: (data = {}) => {
        session.providerRef = data.providerRef ?? session.providerRef;
        session.state = data.state ?? session.state;
        emit("session.started", {
          sessionId: session.id,
          providerRef: session.providerRef,
          state: session.state
        });
      },
      status: (status, label, data) => {
        const eventData: NlaSessionStatusData = {
          sessionId: session.id,
          status,
          label,
          data
        };
        emit("session.status", eventData);
      },
      execution: (execution) => {
        emit("session.execution", {
          sessionId: session.id,
          ...execution
        });
      },
      message: (message) => {
        emit("session.message", {
          sessionId: session.id,
          ...message
        });
      },
      reply: (text, metadata) => {
        const eventData: NlaSessionMessageData = {
          sessionId: session.id,
          role: "assistant",
          text,
          metadata
        };
        emit("session.message", eventData);
      },
      messageDelta: (message) => {
        emit("session.message.delta", {
          sessionId: session.id,
          ...message
        });
      },
      controls: (controls) => {
        state.controlsEmitted = true;
        emit("session.controls", {
          sessionId: session.id,
          controls: [...controls]
        }, {
          correlationId: "correlationId" in request
            ? request.correlationId ?? request.id ?? correlationId
            : correlationId
        });
      },
      controlState: (controlState) => {
        state.controlStateEmitted = true;
        emit("session.control.state", {
          sessionId: session.id,
          ...controlState
        }, {
          correlationId: "correlationId" in request
            ? request.correlationId ?? request.id ?? correlationId
            : correlationId
        });
      },
      activity: (activity) => {
        const event: NlaSessionActivityMessage = this.#message(
          "session.activity",
          activity,
          correlationId
        );
        emitter.emit(event);
      },
      artifact: (artifact) => {
        const event: NlaSessionArtifactMessage = this.#message(
          "session.artifact",
          artifact,
          correlationId
        );
        emitter.emit(event);
      },
      requestInput: (input) => {
        emit("session.execution", {
          sessionId: session.id,
          state: "awaiting_input",
          turnId: currentTurnId,
          interruptible: true
        });
        emit("session.interaction.requested", {
          sessionId: session.id,
          ...input
        });
      },
      resolveInput: (resolution) => {
        emit("session.interaction.resolved", {
          sessionId: session.id,
          ...resolution
        });
      },
      interruptResult: (result) => {
        state.interruptResultEmitted = true;
        emit("session.interrupt.result", {
          sessionId: session.id,
          ...result
        }, {
          correlationId: "correlationId" in request
            ? request.correlationId ?? request.id ?? correlationId
            : correlationId
        });
      },
      complete: () => {
        if (state.terminal) return;
        state.terminal = true;
        const event: NlaSessionCompletedMessage = this.#message(
          "session.completed",
          { sessionId: session.id },
          correlationId
        );
        emitter.emit(event);
      },
      fail,
      stopped: () => {
        if (state.terminal) return;
        state.terminal = true;
        const event: NlaSessionStoppedMessage = this.#message(
          "session.stopped",
          { sessionId: session.id },
          correlationId
        );
        emitter.emit(event);
      }
    };
  }

  #resolveOperation(operationName: string): CompiledOperationDefinition | undefined {
    return this.#operations.get(operationName);
  }

  #ensureSession(sessionId: string): NlaRuntimeSession {
    const existing = this.#sessions.get(sessionId);
    if (existing) return existing;

    const session: NlaRuntimeSession = { id: sessionId };
    this.#sessions.set(sessionId, session);
    return session;
  }

  #identity(): NlaAdapterIdentity {
    return {
      id: this.adapter.id,
      name: this.adapter.name,
      version: this.adapter.version
    };
  }

  #message<TType extends string, TData>(
    type: TType,
    data: TData,
    correlationId?: string,
    id?: string,
    timestamp?: string
  ): NlaEnvelope<TType, TData> {
    return createEnvelope(type, data, {
      id: id ?? this.#createId("msg"),
      correlationId,
      timestamp: timestamp ?? this.#now().toISOString()
    });
  }

  #nextId(prefix: string): string {
    this.#counter += 1;
    return `${prefix}_${String(this.#counter).padStart(6, "0")}`;
  }
}

function normalizeValidationOptions(
  validation: NlaRuntimeOptions["validation"]
): NormalizedValidationOptions {
  if (validation === false) {
    return {
      messages: false,
      operations: false
    };
  }

  if (validation === undefined || validation === true) {
    return {
      messages: true,
      operations: true
    };
  }

  return {
    messages: validation.messages ?? true,
    operations: validation.operations ?? true,
    ajv: validation.ajv
  };
}

function createQueuedMessageEmitter(sink: NlaRuntimeMessageSink): QueuedMessageEmitter {
  let queue = Promise.resolve();
  let pendingError: unknown;

  return {
    emit(message) {
      queue = queue
        .then(async () => {
          if (pendingError !== undefined) return;
          await sink(message);
        })
        .catch((error) => {
          if (pendingError === undefined) {
            pendingError = error;
          }
        });
    },
    async drain() {
      await queue;
      if (pendingError !== undefined) {
        throw pendingError;
      }
    }
  };
}

function compileOperations(
  operations: readonly NlaOperationDescriptor[],
  validation: NormalizedValidationOptions
): Map<string, CompiledOperationDefinition> {
  const compiled = new Map<string, CompiledOperationDefinition>();
  const ajv = validation.operations
    ? validation.ajv ?? new (AjvModule as unknown as new (options?: unknown) => JsonSchemaCompiler)({
        allErrors: true,
        strict: false
      })
    : undefined;

  for (const descriptor of operations) {
    if (compiled.has(descriptor.name)) {
      throw new Error(`Duplicate operation descriptor: ${descriptor.name}`);
    }

    const entry: CompiledOperationDefinition = {
      descriptor
    };

    if (ajv && descriptor.inputSchema) {
      entry.validateInput = ajv.compile(descriptor.inputSchema);
    }
    if (ajv && descriptor.outputSchema) {
      entry.validateOutput = ajv.compile(descriptor.outputSchema);
    }

    compiled.set(descriptor.name, entry);
  }

  return compiled;
}

function normalizeFailure(error: string | Omit<NlaFailedData, "ok">): NlaFailedData {
  if (typeof error === "string") {
    return {
      ok: false,
      message: error
    };
  }

  return {
    ok: false,
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    data: error.data
  };
}

function ajvErrorsToIssues(errors: readonly ErrorObject[] | null | undefined): NlaValidationIssue[] {
  if (!errors || errors.length === 0) {
    return [
      {
        path: "data",
        message: "Schema validation failed."
      }
    ];
  }

  return errors.map((error) => ({
    path: error.instancePath || "data",
    message: error.message || "Schema validation failed."
  }));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export type NlaToolLoopRole = "system" | "user" | "assistant" | "tool";

export interface NlaToolLoopMessage {
  readonly role: NlaToolLoopRole;
  readonly text: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly toolInput?: unknown;
}

export interface NlaToolLoopToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: Record<string, unknown>;
}

export interface NlaToolLoopToolCall {
  readonly callId: string;
  readonly toolName: string;
  readonly input: unknown;
}

export type NlaToolLoopResponse =
  | {
      readonly type: "assistant";
      readonly text: string;
      readonly deltas?: ReadonlyArray<string>;
    }
  | {
      readonly type: "tool_calls";
      readonly calls: ReadonlyArray<NlaToolLoopToolCall>;
    };

export type NlaToolLoopStreamEvent =
  | {
      readonly type: "assistant.delta";
      readonly delta: string;
    }
  | {
      readonly type: "assistant.completed";
      readonly text: string;
    }
  | {
      readonly type: "tool_calls";
      readonly calls: ReadonlyArray<NlaToolLoopToolCall>;
    };

export interface NlaToolLoopRequest {
  readonly messages: ReadonlyArray<NlaToolLoopMessage>;
  readonly tools: ReadonlyArray<NlaToolLoopToolSpec>;
}

export interface NlaToolLoopModel {
  readonly respond: (request: NlaToolLoopRequest) => Promise<NlaToolLoopResponse>;
  readonly streamRespond?: (
    request: NlaToolLoopRequest
  ) => Promise<AsyncIterable<NlaToolLoopStreamEvent>> | AsyncIterable<NlaToolLoopStreamEvent>;
}

export interface NlaToolLoopTool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly execute: (input: TInput) => Promise<TOutput>;
}

export interface NlaSessionToolContextBase {
  readonly sessionId: string;
  readonly clientId: string;
  readonly turnId?: string;
  readonly userMessageId?: string;
  readonly assistantMessageId: string;
  readonly text: string;
  readonly session: NlaRuntimeSession;
  readonly request: NlaSessionMessage;
  readonly raw: NlaSessionHandlerContext;
  status(status: NlaSessionStatus, label?: string, data?: unknown): void;
  execution(execution: Omit<NlaSessionExecutionData, "sessionId">): void;
  activity(activity: NlaActivityData): void;
  requestInput(request: NlaInteractionPayload): void;
  awaitInput(request: NlaInteractionPayload): Promise<NlaSessionInteractionResolveData>;
  assistantDelta(delta: string, metadata?: Record<string, unknown>): void;
  reply(text: string, metadata?: Record<string, unknown>): void;
}

export interface NlaSessionToolDefinition<TContext, TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly decode?: (input: unknown) => TInput;
  readonly execute: (context: TContext & NlaSessionToolContextBase, input: TInput) => MaybePromise<TOutput>;
}

export interface NlaToolLoopSessionMemoryMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface NlaToolLoopSessionMemoryState {
  readonly summary?: string;
  readonly recent?: ReadonlyArray<NlaToolLoopSessionMemoryMessage>;
}

export interface NlaToolLoopSessionMemoryStore<TContext> {
  readonly load: (
    context: TContext & NlaSessionToolContextBase
  ) => MaybePromise<NlaToolLoopSessionMemoryState | undefined>;
  readonly save: (
    context: TContext & NlaSessionToolContextBase,
    state: NlaToolLoopSessionMemoryState
  ) => MaybePromise<void>;
  readonly maxRecentMessages?: number;
  readonly compact?: (input: {
    readonly context: TContext & NlaSessionToolContextBase;
    readonly state: NlaToolLoopSessionMemoryState;
    readonly maxRecentMessages: number;
  }) => MaybePromise<NlaToolLoopSessionMemoryState>;
  readonly formatSummary?: (summary: string) => string;
}

export interface NlaToolLoopSessionAdapterDefinition<TContext> {
  readonly id: string;
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly instructions?: string;
  readonly model:
    | NlaToolLoopModel
    | ((context: TContext & NlaSessionToolContextBase) => NlaToolLoopModel);
  readonly tools: ReadonlyArray<NlaSessionToolDefinition<TContext, any, any>>;
  readonly maxIterations?: number;
  readonly createContext?: (
    ctx: NlaSessionHandlerContext,
    message: NlaSessionMessage
  ) => MaybePromise<TContext>;
  readonly onSessionStart?: (ctx: NlaSessionHandlerContext) => MaybePromise<void>;
  readonly onSessionResume?: (ctx: NlaSessionHandlerContext) => MaybePromise<void>;
  readonly memory?: NlaToolLoopSessionMemoryStore<TContext>;
}

export const tool = <TContext, TInput = unknown, TOutput = unknown>(
  definition: NlaSessionToolDefinition<TContext, TInput, TOutput>
): NlaSessionToolDefinition<TContext, TInput, TOutput> => definition;

export interface NlaToolLoopCallbacks {
  readonly onAssistantDelta?: (delta: string) => MaybePromise<void>;
  readonly onToolCallStart?: (call: NlaToolLoopToolCall) => MaybePromise<void>;
  readonly onToolCallCompleted?: (call: NlaToolLoopToolCall, output: unknown) => MaybePromise<void>;
}

export interface NlaToolLoopRunResult {
  readonly text: string;
  readonly messages: ReadonlyArray<NlaToolLoopMessage>;
}

export interface NlaToolLoopOptions {
  readonly model: NlaToolLoopModel;
  readonly tools: ReadonlyArray<NlaToolLoopTool<unknown, unknown>>;
  readonly maxIterations?: number;
  readonly ajv?: JsonSchemaCompiler;
}

interface CompiledNlaToolLoopTool {
  readonly definition: NlaToolLoopTool<unknown, unknown>;
  readonly validateInput?: ValidateFunction;
}

interface ToolLoopCorrelationState {
  current: string;
}

interface PendingToolLoopInput {
  readonly correlation: ToolLoopCorrelationState;
  readonly resolve: (resolution: NlaSessionInteractionResolveData) => void;
  readonly reject: (error: Error) => void;
}

const DefaultToolLoopSessionMemoryRecentMessages = 8;

class ToolLoopAwaitInputStoppedError extends Error {
  constructor(sessionId: string) {
    super(`Tool loop input wait stopped for session ${sessionId}`);
    this.name = "ToolLoopAwaitInputStoppedError";
  }
}

export class NlaToolLoop {
  readonly #model: NlaToolLoopModel;
  readonly #maxIterations: number;
  readonly #toolByName: Map<string, CompiledNlaToolLoopTool>;
  readonly #toolSpecs: ReadonlyArray<NlaToolLoopToolSpec>;

  constructor(options: NlaToolLoopOptions) {
    this.#model = options.model;
    this.#maxIterations = options.maxIterations ?? 8;
    this.#toolByName = compileToolLoopTools(options.tools, options.ajv);
    this.#toolSpecs = options.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
  }

  async run(input: {
    readonly messages: ReadonlyArray<NlaToolLoopMessage>;
    readonly callbacks?: NlaToolLoopCallbacks;
  }): Promise<NlaToolLoopRunResult> {
    let messages = [...input.messages];

    for (let iteration = 0; iteration < this.#maxIterations; iteration += 1) {
      const response = await this.#runModel({
        messages,
        tools: this.#toolSpecs
      }, input.callbacks);

      if (response.type === "assistant") {
        return {
          text: response.text,
          messages
        };
      }

      const assistantToolMessages = response.calls.map<NlaToolLoopMessage>((call) => ({
        role: "assistant",
        text: "",
        toolName: call.toolName,
        toolCallId: call.callId,
        toolInput: call.input
      }));
      messages = [...messages, ...assistantToolMessages];

      for (const call of response.calls) {
        const output = await this.#executeToolCall(call, input.callbacks);
        messages = [
          ...messages,
          {
            role: "tool",
            toolName: call.toolName,
            toolCallId: call.callId,
            text: serializeToolLoopOutput(output)
          }
        ];
      }
    }

    throw new Error("Tool loop exceeded maximum iterations");
  }

  async #runModel(
    request: NlaToolLoopRequest,
    callbacks: NlaToolLoopCallbacks | undefined
  ): Promise<NlaToolLoopResponse> {
    if (!this.#model.streamRespond) {
      const response = await this.#model.respond(request);
      if (response.type === "assistant") {
        for (const delta of response.deltas ?? []) {
          await callbacks?.onAssistantDelta?.(delta);
        }
      }
      return response;
    }

    const events = await this.#model.streamRespond(request);
    let terminal: NlaToolLoopResponse | undefined;

    for await (const event of events) {
      switch (event.type) {
        case "assistant.delta":
          await callbacks?.onAssistantDelta?.(event.delta);
          break;
        case "assistant.completed":
          terminal = {
            type: "assistant",
            text: event.text
          };
          break;
        case "tool_calls":
          terminal = {
            type: "tool_calls",
            calls: event.calls
          };
          break;
      }
    }

    if (!terminal) {
      throw new Error("Tool loop model stream ended without a terminal event");
    }

    return terminal;
  }

  async #executeToolCall(
    call: NlaToolLoopToolCall,
    callbacks: NlaToolLoopCallbacks | undefined
  ): Promise<unknown> {
    const tool = this.#toolByName.get(call.toolName);
    if (!tool) {
      throw new Error(`Unknown tool: ${call.toolName}`);
    }

    if (tool.validateInput && !tool.validateInput(call.input)) {
      throw new Error(
        `Invalid input for tool ${call.toolName}: ${formatValidationIssues(ajvErrorsToIssues(tool.validateInput.errors))}`
      );
    }

    await callbacks?.onToolCallStart?.(call);
    const output = await tool.definition.execute(call.input);
    await callbacks?.onToolCallCompleted?.(call, output);
    return output;
  }
}

export function defineToolLoopSessionAdapter<TContext>(
  definition: NlaToolLoopSessionAdapterDefinition<TContext>
): NlaAdapterDefinition {
  const pendingInputsBySession = new Map<string, Map<string, PendingToolLoopInput>>();

  const getSessionPendingInputs = (sessionId: string): Map<string, PendingToolLoopInput> => {
    let pending = pendingInputsBySession.get(sessionId);
    if (!pending) {
      pending = new Map<string, PendingToolLoopInput>();
      pendingInputsBySession.set(sessionId, pending);
    }
    return pending;
  };

  const deletePendingInput = (sessionId: string, requestId: string): void => {
    const pending = pendingInputsBySession.get(sessionId);
    if (!pending) {
      return;
    }

    pending.delete(requestId);
    if (pending.size === 0) {
      pendingInputsBySession.delete(sessionId);
    }
  };

  const rejectPendingInputs = (sessionId: string, error: Error): void => {
    const pending = pendingInputsBySession.get(sessionId);
    if (!pending) {
      return;
    }

    pendingInputsBySession.delete(sessionId);
    for (const entry of pending.values()) {
      entry.reject(error);
    }
  };

  const initializeSession = async (
    ctx: NlaSessionHandlerContext,
    handler:
      | NlaToolLoopSessionAdapterDefinition<TContext>["onSessionStart"]
      | NlaToolLoopSessionAdapterDefinition<TContext>["onSessionResume"]
  ): Promise<void> => {
    ctx.started();
    ctx.execution({
      state: "idle",
      interruptible: false
    });
    if (handler) {
      await handler(ctx);
    }
  };

  return defineAdapter({
    id: definition.id,
    name: definition.name,
    version: definition.version,
    description: definition.description,
    capabilities: {
      sessions: true,
      streaming: true,
      interactions: true
    },
    sessionStart: (ctx) => initializeSession(ctx, definition.onSessionStart),
    sessionResume: (ctx) => initializeSession(ctx, definition.onSessionResume),
    sessionMessage: async (ctx, message) => {
      if (message.data.role !== "user") {
        ctx.fail({
          code: "unsupported_role",
          message: `Unsupported NLA session.message role: ${message.data.role}`
        });
        return;
      }

      const text = requireTextSessionMessage(message);
      const metadata = asRecord(message.data.metadata);
      const assistantMessageId = optionalString(metadata?.assistantMessageId) ?? ctx.createId("msg");
      const sessionId = message.data.sessionId;
      const responseCorrelation: ToolLoopCorrelationState = {
        current: requestCorrelationId(message, sessionId)
      };
      const emitSession = <TType extends string, TData>(
        type: TType,
        data: TData,
        options: {
          correlationId?: string;
          id?: string;
          timestamp?: string;
        } = {}
      ): void => {
        ctx.emit(type, data, {
          correlationId: options.correlationId ?? responseCorrelation.current,
          id: options.id,
          timestamp: options.timestamp
        });
      };
      const emitFailure = (error: string | Omit<NlaFailedData, "ok">): void => {
        emitSession("session.failed", {
          sessionId,
          ...normalizeFailure(error)
        });
      };
      const toolContextBase: NlaSessionToolContextBase = {
        sessionId,
        clientId: optionalString(metadata?.clientId) ?? "nla-host",
        turnId: optionalString(metadata?.turnId),
        userMessageId: optionalString(metadata?.userMessageId),
        assistantMessageId,
        text,
        session: ctx.session,
        request: message,
        raw: ctx,
        status: (status, label, data) => {
          emitSession("session.status", {
            sessionId,
            status,
            label,
            data
          });
        },
        execution: (execution) => {
          emitSession("session.execution", {
            sessionId,
            ...execution
          });
        },
        activity: (activity) => {
          emitSession("session.activity", activity);
        },
        requestInput: (request) => {
          emitSession("session.execution", {
            sessionId,
            state: "awaiting_input",
            turnId: optionalString(metadata?.turnId),
            interruptible: true
          });
          emitSession("session.interaction.requested", {
            sessionId,
            request
          });
        },
        awaitInput: (request) =>
          new Promise<NlaSessionInteractionResolveData>((resolve, reject) => {
            const pending = getSessionPendingInputs(sessionId);
            if (pending.has(request.requestId)) {
              reject(new Error(`Duplicate pending input request: ${request.requestId}`));
              return;
            }

            pending.set(request.requestId, {
              correlation: responseCorrelation,
              resolve: (resolution) => {
                deletePendingInput(sessionId, request.requestId);
                resolve(resolution);
              },
              reject: (error) => {
                deletePendingInput(sessionId, request.requestId);
                reject(error);
              }
            });

            emitSession("session.execution", {
              sessionId,
              state: "awaiting_input",
              turnId: optionalString(metadata?.turnId),
              interruptible: true
            });
            emitSession("session.interaction.requested", {
              sessionId,
              request
            });
          }),
        assistantDelta: (delta, deltaMetadata) => {
          emitSession("session.message.delta", {
            sessionId,
            messageId: assistantMessageId,
            role: "assistant",
            delta,
            metadata: deltaMetadata
          });
        },
        reply: (replyText, replyMetadata) => {
          emitSession("session.message", {
            sessionId,
            role: "assistant",
            text: replyText,
            metadata: replyMetadata
          }, {
            id: assistantMessageId
          });
        }
      };

      const adapterContext = definition.createContext
        ? await definition.createContext(ctx, message)
        : {} as TContext;
      const toolContext = Object.assign({}, adapterContext, toolContextBase) as TContext & NlaSessionToolContextBase;
      const loadedMemory = definition.memory
        ? normalizeToolLoopSessionMemory(
            await definition.memory.load(toolContext)
          )
        : undefined;
      const model = typeof definition.model === "function"
        ? definition.model(toolContext)
        : definition.model;
      const loop = new NlaToolLoop({
        model,
        tools: definition.tools.map((entry) => ({
          name: entry.name,
          description: entry.description,
          inputSchema: entry.inputSchema,
          execute: async (input) => {
            const activityId = `tool:${entry.name}`;
            toolContext.activity({
              activityId,
              title: `Tool ${entry.name}`,
              status: "running"
            });

            try {
              const decodedInput = entry.decode
                ? entry.decode(input)
                : input;
              const output = await entry.execute(toolContext, decodedInput);
              toolContext.activity({
                activityId,
                title: `Tool ${entry.name}`,
                status: "succeeded"
              });
              return output;
            } catch (error) {
              toolContext.activity({
                activityId,
                title: `Tool ${entry.name}`,
                status: "failed"
              });
              throw error;
            }
          }
        })),
        maxIterations: definition.maxIterations
      });

      const messages: NlaToolLoopMessage[] = [];
      if (definition.instructions?.trim()) {
        messages.push({
          role: "system",
          text: definition.instructions.trim()
        });
      }
      if (loadedMemory?.summary) {
        messages.push({
          role: "system",
          text: formatToolLoopMemorySummary(definition.memory, loadedMemory.summary)
        });
      }
      if (loadedMemory?.recent) {
        messages.push(
          ...loadedMemory.recent.map((entry) => ({
            role: entry.role,
            text: entry.text
          }))
        );
      }
      messages.push({
        role: "user",
        text
      });

      toolContext.execution({
        state: "running",
        turnId: toolContext.turnId,
        interruptible: true
      });
      try {
        const result = await loop.run({
          messages,
          callbacks: {
            onAssistantDelta: (delta) => {
              toolContext.assistantDelta(delta);
            }
          }
        });
        if (definition.memory) {
          await definition.memory.save(
            toolContext,
            await compactToolLoopSessionMemory(definition.memory, toolContext, {
              summary: loadedMemory?.summary,
              recent: [
                ...(loadedMemory?.recent ?? []),
                {
                  role: "user",
                  text
                },
                {
                  role: "assistant",
                  text: result.text
                }
              ]
            })
          );
        }
        toolContext.reply(result.text);
        emitSession("session.completed", {
          sessionId
        });
      } catch (error) {
        if (error instanceof ToolLoopAwaitInputStoppedError) {
          return;
        }

        emitFailure({
          code: "tool_loop_failed",
          message: errorMessage(error)
        });
      }
    },
    sessionInput: async (ctx, message) => {
      const sessionId = message.data.sessionId;
      const requestId = message.data.resolution.requestId;
      const pending = pendingInputsBySession.get(sessionId);
      const entry = pending?.get(requestId);

      if (!entry) {
        ctx.fail({
          code: "unknown_input_request",
          message: `Unknown input request: ${requestId}`
        });
        return;
      }

      entry.correlation.current = requestCorrelationId(message, sessionId);
      ctx.resolveInput({
        resolution: message.data.resolution
      });

      // Let the resolved event flush ahead of resumed tool output.
      await Promise.resolve();

      entry.resolve({
        sessionId,
        resolution: message.data.resolution,
        metadata: message.data.metadata
      });
    },
    sessionStop: (ctx) => {
      rejectPendingInputs(ctx.session.id, new ToolLoopAwaitInputStoppedError(ctx.session.id));
      ctx.stopped();
    }
  });
}

function compileToolLoopTools(
  tools: ReadonlyArray<NlaToolLoopTool<unknown, unknown>>,
  ajvOverride?: JsonSchemaCompiler
): Map<string, CompiledNlaToolLoopTool> {
  const compiled = new Map<string, CompiledNlaToolLoopTool>();
  const ajv = ajvOverride ?? new (AjvModule as unknown as new (options?: unknown) => JsonSchemaCompiler)({
    allErrors: true,
    strict: false
  });

  for (const tool of tools) {
    if (compiled.has(tool.name)) {
      throw new Error(`Duplicate tool definition: ${tool.name}`);
    }

    compiled.set(tool.name, {
      definition: tool,
      validateInput: tool.inputSchema ? ajv.compile(tool.inputSchema) : undefined
    });
  }

  return compiled;
}

function serializeToolLoopOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function normalizeToolLoopSessionMemory(
  value: NlaToolLoopSessionMemoryState | undefined
): NlaToolLoopSessionMemoryState | undefined {
  if (!value) {
    return undefined;
  }

  const summary = typeof value.summary === "string" && value.summary.trim()
    ? value.summary.trim()
    : undefined;
  const recent = Array.isArray(value.recent)
    ? value.recent.flatMap((entry) => normalizeToolLoopSessionMemoryMessage(entry) ? [entry] : [])
    : [];

  if (!summary && recent.length === 0) {
    return undefined;
  }

  return {
    ...(summary ? { summary } : {}),
    ...(recent.length > 0 ? { recent } : {})
  };
}

function normalizeToolLoopSessionMemoryMessage(
  value: unknown
): value is NlaToolLoopSessionMemoryMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    (record.role === "user" || record.role === "assistant")
    && typeof record.text === "string"
    && record.text.trim().length > 0
  );
}

async function compactToolLoopSessionMemory<TContext>(
  memory: NlaToolLoopSessionMemoryStore<TContext>,
  context: TContext & NlaSessionToolContextBase,
  state: NlaToolLoopSessionMemoryState
): Promise<NlaToolLoopSessionMemoryState> {
  const maxRecentMessages = normalizeRecentMessageLimit(memory.maxRecentMessages);
  const compacted = memory.compact
    ? normalizeToolLoopSessionMemory(
        await memory.compact({
          context,
          state: normalizeToolLoopSessionMemory(state) ?? {},
          maxRecentMessages
        })
      ) ?? {}
    : normalizeToolLoopSessionMemory(state) ?? {};

  const recent = compacted.recent?.slice(-maxRecentMessages);
  return {
    ...(compacted.summary ? { summary: compacted.summary } : {}),
    ...(recent && recent.length > 0 ? { recent } : {})
  };
}

function normalizeRecentMessageLimit(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : DefaultToolLoopSessionMemoryRecentMessages;
}

function formatToolLoopMemorySummary<TContext>(
  memory: NlaToolLoopSessionMemoryStore<TContext> | undefined,
  summary: string
): string {
  const text = summary.trim();
  if (!text) {
    return "";
  }

  return memory?.formatSummary
    ? memory.formatSummary(text)
    : `Conversation summary:\n${text}`;
}

function requireTextSessionMessage(message: NlaSessionMessage): string {
  if (typeof message.data.text === "string" && message.data.text.trim()) {
    return message.data.text.trim();
  }

  if (Array.isArray(message.data.parts) && message.data.parts.length > 0) {
    const text = message.data.parts.map((part) => {
      if (part.type !== "text" || typeof part.text !== "string") {
        throw new Error("Tool loop session adapters only support text session.message parts");
      }
      return part.text;
    }).join("").trim();

    if (text) {
      return text;
    }
  }

  throw new Error("Tool loop session adapters require a non-empty text session.message");
}

function requestCorrelationId(
  message: Pick<NlaMessage, "correlationId" | "id">,
  fallback: string
): string {
  return message.correlationId ?? message.id ?? fallback;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}
