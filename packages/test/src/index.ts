import {
  createEnvelope,
  type NlaInvokeContext,
  type NlaInvokeFailedMessage,
  type NlaInvokeOutputMessage,
  type NlaInvokeCompletedMessage,
  type NlaMessage,
  type NlaSessionControlsMessage,
  type NlaSessionMessage,
  type NlaSessionFailedMessage
} from "@nla/protocol";
import {
  createAdapterRuntime,
  isAdapterRuntime,
  type NlaAdapterDefinition,
  type NlaAdapterRuntime,
  type NlaRuntimeOptions
} from "@nla/sdk-core";

type TestAdapterInput = NlaAdapterDefinition | NlaAdapterRuntime;

export interface NlaTestHostOptions {
  runtimeOptions?: NlaRuntimeOptions;
}

export interface NlaInvokeTestResult {
  request: NlaMessage;
  messages: NlaMessage[];
  output?: NlaInvokeOutputMessage;
  completed?: NlaInvokeCompletedMessage;
  failed?: NlaInvokeFailedMessage;
}

export interface NlaTestHost {
  runtime: NlaAdapterRuntime;
  send(message: NlaMessage): Promise<NlaMessage[]>;
  initialize(): Promise<NlaMessage[]>;
  discover(): Promise<NlaMessage[]>;
  invoke(operation: string, input?: unknown, context?: NlaInvokeContext): Promise<NlaInvokeTestResult>;
  startSession(sessionId: string, metadata?: Record<string, unknown>): Promise<NlaMessage[]>;
  resumeSession(
    sessionId: string,
    options?: {
      providerRef?: string;
      state?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }
  ): Promise<NlaMessage[]>;
  sendSessionMessage(sessionId: string, text: string, role?: string): Promise<NlaMessage[]>;
  sendSessionInput(
    sessionId: string,
    requestId: string,
    optionId?: string,
    text?: string,
    value?: unknown
  ): Promise<NlaMessage[]>;
  sendSessionControl(
    sessionId: string,
    control: string,
    optionId?: string,
    value?: unknown
  ): Promise<NlaMessage[]>;
  getSessionControls(sessionId: string): Promise<NlaSessionControlsMessage | undefined>;
  stopSession(sessionId: string): Promise<NlaMessage[]>;
}

export function createTestHost(
  adapterOrRuntime: TestAdapterInput,
  options: NlaTestHostOptions = {}
): NlaTestHost {
  const runtime = isAdapterRuntime(adapterOrRuntime)
    ? adapterOrRuntime
    : createAdapterRuntime(adapterOrRuntime, options.runtimeOptions);

  return {
    runtime,
    send(message) {
      return runtime.handle(message);
    },
    initialize() {
      return runtime.handle(createEnvelope("initialize", {}));
    },
    discover() {
      return runtime.handle(createEnvelope("discover", {}));
    },
    async invoke(operation, input, context) {
      const request = createEnvelope("invoke.request", {
        operation,
        input,
        context
      }, {
        correlationId: `inv_${operation}`
      });
      const messages = await runtime.handle(request);
      return {
        request,
        messages,
        output: singleMessageByType(messages, "invoke.output"),
        completed: singleMessageByType(messages, "invoke.completed"),
        failed: singleMessageByType(messages, "invoke.failed")
      };
    },
    startSession(sessionId, metadata) {
      return runtime.handle(createEnvelope("session.start", {
        sessionId,
        metadata
      }, {
        correlationId: sessionId
      }));
    },
    resumeSession(sessionId, options = {}) {
      return runtime.handle(createEnvelope("session.resume", {
        sessionId,
        providerRef: options.providerRef,
        state: options.state,
        metadata: options.metadata
      }, {
        correlationId: sessionId
      }));
    },
    sendSessionMessage(sessionId, text, role = "user") {
      return runtime.handle(createEnvelope("session.message", {
        sessionId,
        role,
        text
      }, {
        correlationId: sessionId
      }));
    },
    sendSessionInput(sessionId, requestId, optionId, text, value) {
      return runtime.handle(createEnvelope("session.interaction.resolve", {
        sessionId,
        resolution: {
          kind: "form",
          requestId,
          optionId,
          text,
          value
        }
      }, {
        correlationId: sessionId
      }));
    },
    sendSessionControl(sessionId, control, optionId, value) {
      return runtime.handle(createEnvelope("session.control", {
        sessionId,
        control,
        optionId,
        value
      }, {
        correlationId: sessionId
      }));
    },
    async getSessionControls(sessionId) {
      const messages = await runtime.handle(createEnvelope("session.controls.get", {
        sessionId
      }, {
        correlationId: sessionId
      }));
      return singleMessageByType(messages, "session.controls");
    },
    stopSession(sessionId) {
      return runtime.handle(createEnvelope("session.stop", {
        sessionId
      }, {
        correlationId: sessionId
      }));
    }
  };
}

export async function invokeAdapter(
  adapterOrRuntime: TestAdapterInput,
  operation: string,
  input?: unknown,
  context?: NlaInvokeContext,
  options: NlaTestHostOptions = {}
): Promise<NlaInvokeTestResult> {
  return createTestHost(adapterOrRuntime, options).invoke(operation, input, context);
}

export function findMessagesByType<TType extends NlaMessage["type"]>(
  messages: readonly NlaMessage[],
  type: TType
): Array<Extract<NlaMessage, { type: TType }>> {
  return messages.filter((message) => message.type === type) as Array<Extract<NlaMessage, { type: TType }>>;
}

export function singleMessageByType<TType extends NlaMessage["type"]>(
  messages: readonly NlaMessage[],
  type: TType
): Extract<NlaMessage, { type: TType }> | undefined {
  const matches = findMessagesByType(messages, type);
  return matches.length > 0 ? matches[0] : undefined;
}

export function lastSessionReply(messages: readonly NlaMessage[]): NlaSessionMessage | undefined {
  const replies = findMessagesByType(messages, "session.message")
    .filter((message) => message.data.role === "assistant");
  return replies.length > 0 ? replies[replies.length - 1] : undefined;
}

export function lastSessionFailure(messages: readonly NlaMessage[]): NlaSessionFailedMessage | undefined {
  const failures = findMessagesByType(messages, "session.failed");
  return failures.length > 0 ? failures[failures.length - 1] : undefined;
}
