import {
  createEnvelope,
  type NlaInteractionPayload,
  type NlaMessage,
  type NlaSessionControlDefinition,
  type NlaSessionControlStateData,
  type NlaSessionInterruptResultData,
  type NlaSessionMessageData
} from "@nla/protocol";

export class NlaSessionInterruptedError extends Error {
  constructor(
    readonly turnId: string,
    message = `Turn interrupted: ${turnId}`
  ) {
    super(message);
    this.name = "NlaSessionInterruptedError";
  }
}

export interface NlaSessionTransportHandle {
  readonly sessionId: string;
  readonly send: (message: NlaMessage) => void;
  readonly close: () => void;
  readonly isClosed: () => boolean;
}

export interface NlaSessionClient {
  readonly registerSession: (input: {
    readonly transport: NlaSessionTransportHandle;
    readonly onUnsolicitedMessage?: (message: NlaMessage) => void;
  }) => void;
  readonly handleMessage: (sessionId: string, message: NlaMessage) => void;
  readonly handleFailure: (sessionId: string, error: Error) => void;
  readonly requestControl: <TMessage extends NlaMessage>(input: {
    readonly sessionId: string;
    readonly message: NlaMessage;
    readonly matches: (message: NlaMessage) => message is TMessage;
  }) => Promise<TMessage>;
  readonly closeSession: (sessionId: string) => void;
  readonly sendSessionMessage: (input: {
    readonly sessionId: string;
    readonly turnId: string;
    readonly message: Omit<NlaSessionMessageData, "sessionId">;
  }) => AsyncIterable<NlaMessage>;
  readonly resolveInteraction: (input: {
    readonly sessionId: string;
    readonly turnId: string;
    readonly resolution: NlaInteractionPayload;
    readonly metadata?: Record<string, unknown>;
  }) => AsyncIterable<NlaMessage>;
  readonly getSessionControls: (input: {
    readonly sessionId: string;
    readonly metadata?: Record<string, unknown>;
  }) => Promise<ReadonlyArray<NlaSessionControlDefinition>>;
  readonly applySessionControl: (input: {
    readonly sessionId: string;
    readonly controlId: string;
    readonly optionId?: string;
    readonly value?: unknown;
    readonly metadata?: Record<string, unknown>;
  }) => Promise<NlaSessionControlStateData>;
  readonly interrupt: (input: {
    readonly sessionId: string;
    readonly turnId?: string;
    readonly metadata?: Record<string, unknown>;
  }) => Promise<NlaSessionInterruptResultData>;
}

export interface CreateNlaSessionClientOptions {
  readonly nextRequestId: (prefix: string) => string;
  readonly now: () => string;
  readonly onSessionClosed?: (sessionId: string) => void;
}

interface ControlWaiter {
  readonly matches: (message: NlaMessage) => boolean;
  readonly resolve: (message: NlaMessage) => void;
  readonly reject: (error: Error) => void;
}

interface PushAsyncIterable<T> extends AsyncIterable<T> {
  readonly push: (value: T) => void;
  readonly fail: (error: Error) => void;
  readonly end: () => void;
}

interface PendingTurn {
  readonly turnId: string;
  readonly emit: (message: NlaMessage) => void;
  readonly fail: (error: Error) => void;
  readonly end: () => void;
  sequence: number;
}

interface SessionState {
  readonly sessionId: string;
  readonly transport: NlaSessionTransportHandle;
  readonly controlWaiters: Map<string, ControlWaiter>;
  readonly pendingTurns: Map<string, PendingTurn>;
  readonly onUnsolicitedMessage?: (message: NlaMessage) => void;
}

const createPushAsyncIterable = <T>(): PushAsyncIterable<T> => {
  const queue: Array<IteratorResult<T>> = [];
  const waiters: Array<{
    readonly resolve: (result: IteratorResult<T>) => void;
    readonly reject: (error: Error) => void;
  }> = [];
  let done = false;
  let failure: Error | undefined;

  const flush = (result: IteratorResult<T>): void => {
    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve(result);
      return;
    }

    queue.push(result);
  };

  return {
    push: (value) => {
      if (done || failure) {
        return;
      }

      flush({
        value,
        done: false
      });
    },
    fail: (error) => {
      if (done || failure) {
        return;
      }

      failure = error;
      while (waiters.length > 0) {
        waiters.shift()!.reject(error);
      }
    },
    end: () => {
      if (done || failure) {
        return;
      }

      done = true;
      while (waiters.length > 0) {
        waiters.shift()!.resolve({
          value: undefined as T,
          done: true
        });
      }
    },
    [Symbol.asyncIterator]: () => ({
      next: () => {
        if (queue.length > 0) {
          return Promise.resolve(queue.shift()!);
        }

        if (failure) {
          return Promise.reject(failure);
        }

        if (done) {
          return Promise.resolve({
            value: undefined as T,
            done: true
          });
        }

        return new Promise<IteratorResult<T>>((resolve, reject) => {
          waiters.push({
            resolve,
            reject
          });
        });
      }
    })
  };
};

export const createSessionClient = (
  options: CreateNlaSessionClientOptions
): NlaSessionClient => {
  const sessions = new Map<string, SessionState>();

  const stringField = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

  const getSession = (sessionId: string): SessionState | undefined =>
    sessions.get(sessionId);

  const closeSessionState = (sessionId: string): void => {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }

    for (const waiter of session.controlWaiters.values()) {
      waiter.reject(new Error(`NLA session ${sessionId} closed`));
    }
    session.controlWaiters.clear();

    for (const pendingTurn of session.pendingTurns.values()) {
      pendingTurn.fail(new Error(`NLA session ${sessionId} closed`));
    }
    session.pendingTurns.clear();

    session.transport.close();
    sessions.delete(sessionId);
    options.onSessionClosed?.(sessionId);
  };

  const failSessionState = (sessionId: string, error: Error): void => {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }

    for (const waiter of session.controlWaiters.values()) {
      waiter.reject(error);
    }
    session.controlWaiters.clear();

    for (const pendingTurn of session.pendingTurns.values()) {
      pendingTurn.fail(error);
    }
    session.pendingTurns.clear();

    session.transport.close();
    sessions.delete(sessionId);
    options.onSessionClosed?.(sessionId);
  };

  const finishTurn = (session: SessionState, correlationId: string): void => {
    const pendingTurn = session.pendingTurns.get(correlationId);
    if (!pendingTurn) {
      return;
    }

    session.pendingTurns.delete(correlationId);
    pendingTurn.end();
  };

  const pauseTurn = (session: SessionState, correlationId: string): void => {
    const pendingTurn = session.pendingTurns.get(correlationId);
    if (!pendingTurn) {
      return;
    }

    session.pendingTurns.delete(correlationId);
    pendingTurn.end();
  };

  const failTurn = (
    session: SessionState,
    correlationId: string,
    message: string,
    code?: string
  ): void => {
    const pendingTurn = session.pendingTurns.get(correlationId);
    if (!pendingTurn) {
      return;
    }

    session.pendingTurns.delete(correlationId);
    pendingTurn.fail(
      new Error(code ? `${message} [${code}]` : message)
    );
  };

  const interruptTurn = (
    session: SessionState,
    turnId: string
  ): void => {
    for (const [correlationId, pendingTurn] of session.pendingTurns) {
      if (pendingTurn.turnId !== turnId) {
        continue;
      }

      session.pendingTurns.delete(correlationId);
      pendingTurn.fail(new NlaSessionInterruptedError(turnId));
      return;
    }
  };

  const findPendingTurnCorrelationId = (
    session: SessionState,
    turnId: string
  ): string | undefined => {
    for (const [correlationId, pendingTurn] of session.pendingTurns) {
      if (pendingTurn.turnId === turnId) {
        return correlationId;
      }
    }

    return undefined;
  };

  const messageTurnId = (message: NlaMessage): string | undefined => {
    switch (message.type) {
      case "session.message":
      case "session.message.delta":
      case "session.activity":
      case "session.artifact":
      case "session.interaction.requested":
      case "session.interaction.resolved":
      case "session.status":
      case "session.execution":
        return stringField(message.data.turnId);
      default:
        return undefined;
    }
  };

  const pendingTurnCorrelationIdForMessage = (
    session: SessionState,
    message: NlaMessage
  ): string | undefined => {
    const correlationId = stringField(message.correlationId);
    if (correlationId && session.pendingTurns.has(correlationId)) {
      return correlationId;
    }

    const turnId = messageTurnId(message);
    return turnId ? findPendingTurnCorrelationId(session, turnId) : undefined;
  };

  const emitTurnMessage = (
    session: SessionState,
    correlationId: string,
    message: NlaMessage
  ): void => {
    const pendingTurn = session.pendingTurns.get(correlationId);
    if (!pendingTurn) {
      return;
    }

    if (message.type === "session.message.delta") {
      const metadata = {
        ...(message.data.metadata ?? {}),
        sequence: ++pendingTurn.sequence
      };
      pendingTurn.emit({
        ...message,
        data: {
          ...message.data,
          metadata
        }
      });
      return;
    }

    pendingTurn.emit(message);
  };

  const withControlWaiter = <TMessage extends NlaMessage>(input: {
    readonly session: SessionState;
    readonly requestId: string;
    readonly message: NlaMessage;
    readonly matches: (message: NlaMessage) => message is TMessage;
  }): Promise<TMessage> =>
    new Promise<TMessage>((resolve, reject) => {
      input.session.controlWaiters.set(input.requestId, {
        matches: input.matches,
        resolve: (message) => resolve(message as TMessage),
        reject
      });

      try {
        input.session.transport.send(input.message);
      } catch (error) {
        input.session.controlWaiters.delete(input.requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

  const requestTurnStream = (input: {
    readonly session: SessionState;
    readonly correlationId: string;
    readonly turnId: string;
    readonly message: NlaMessage;
  }): AsyncIterable<NlaMessage> => {
    const queue = createPushAsyncIterable<NlaMessage>();
    input.session.pendingTurns.set(input.correlationId, {
      turnId: input.turnId,
      emit: queue.push,
      fail: queue.fail,
      end: queue.end,
      sequence: 0
    });

    try {
      input.session.transport.send(input.message);
    } catch (error) {
      input.session.pendingTurns.delete(input.correlationId);
      queue.fail(error instanceof Error ? error : new Error(String(error)));
    }

    return queue;
  };

  return {
    registerSession: ({ transport, onUnsolicitedMessage }) => {
      sessions.set(transport.sessionId, {
        sessionId: transport.sessionId,
        transport,
        controlWaiters: new Map(),
        pendingTurns: new Map(),
        onUnsolicitedMessage
      });
    },

    handleMessage: (sessionId, message) => {
      const session = getSession(sessionId);
      if (!session) {
        return;
      }

      const correlationId = stringField(message.correlationId);
      let matchedControlWaiter = false;
      if (correlationId) {
        const waiter = session.controlWaiters.get(correlationId);
        if (waiter && waiter.matches(message)) {
          session.controlWaiters.delete(correlationId);
          waiter.resolve(message);
          matchedControlWaiter = true;
          if (message.type !== "session.interrupt.result") {
            return;
          }
        }
      }

      const pendingTurnCorrelationId = pendingTurnCorrelationIdForMessage(session, message);

      switch (message.type) {
        case "session.message.delta":
        case "session.message":
        case "session.activity":
        case "session.execution":
        case "session.artifact":
        case "session.started":
          if (pendingTurnCorrelationId) {
            emitTurnMessage(session, pendingTurnCorrelationId, message);
            return;
          }
          session.onUnsolicitedMessage?.(message);
          return;
        case "session.interaction.requested":
          if (pendingTurnCorrelationId) {
            emitTurnMessage(session, pendingTurnCorrelationId, message);
            pauseTurn(session, pendingTurnCorrelationId);
            return;
          }
          session.onUnsolicitedMessage?.(message);
          return;
        case "session.interaction.resolved":
          if (pendingTurnCorrelationId) {
            emitTurnMessage(session, pendingTurnCorrelationId, message);
            return;
          }
          session.onUnsolicitedMessage?.(message);
          return;
        case "session.status":
          if (pendingTurnCorrelationId) {
            if (message.data.status === "idle" || message.data.status === "completed") {
              emitTurnMessage(session, pendingTurnCorrelationId, message);
              finishTurn(session, pendingTurnCorrelationId);
              return;
            }
          }
          session.onUnsolicitedMessage?.(message);
          return;
        case "session.completed":
          if (pendingTurnCorrelationId) {
            emitTurnMessage(session, pendingTurnCorrelationId, message);
            finishTurn(session, pendingTurnCorrelationId);
            return;
          }
          session.onUnsolicitedMessage?.(message);
          return;
        case "session.failed":
          if (pendingTurnCorrelationId) {
            failTurn(session, pendingTurnCorrelationId, message.data.message, message.data.code);
            return;
          }
          session.onUnsolicitedMessage?.(message);
          return;
        case "session.interrupt.result":
          if (matchedControlWaiter || message.data.status === "interrupted") {
            const turnId = stringField(message.data.turnId);
            if (turnId) {
              interruptTurn(session, turnId);
            }
          }
          return;
        case "session.stopped":
          closeSessionState(sessionId);
          return;
        default:
          session.onUnsolicitedMessage?.(message);
          return;
      }
    },

    handleFailure: (sessionId, error) => {
      failSessionState(sessionId, error);
    },

    requestControl: async ({ sessionId, message, matches }) => {
      const session = getSession(sessionId);
      if (!session) {
        throw new Error(`Unknown NLA session: ${sessionId}`);
      }

      const requestId = stringField(message.correlationId) ?? stringField(message.id);
      if (!requestId) {
        throw new Error("NLA control messages require an id or correlationId");
      }

      return withControlWaiter({
        session,
        requestId,
        message,
        matches
      });
    },

    closeSession: (sessionId) => {
      closeSessionState(sessionId);
    },

    sendSessionMessage: ({ sessionId, turnId, message }) => {
      const session = getSession(sessionId);
      if (!session) {
        throw new Error(`Unknown NLA session: ${sessionId}`);
      }

      const correlationId = options.nextRequestId("session.message");
      return requestTurnStream({
        session,
        correlationId,
        turnId,
        message: createEnvelope("session.message", {
          sessionId,
          ...message
        }, {
          id: correlationId,
          correlationId,
          timestamp: options.now()
        })
      });
    },

    resolveInteraction: ({ sessionId, turnId, resolution, metadata }) => {
      const session = getSession(sessionId);
      if (!session) {
        throw new Error(`Unknown NLA session: ${sessionId}`);
      }

      const correlationId = options.nextRequestId("session.interaction.resolve");
      return requestTurnStream({
        session,
        correlationId,
        turnId,
        message: createEnvelope("session.interaction.resolve", {
          sessionId,
          resolution,
          metadata
        }, {
          id: correlationId,
          correlationId,
          timestamp: options.now()
        })
      });
    },

    getSessionControls: async ({ sessionId, metadata }) => {
      const session = getSession(sessionId);
      if (!session) {
        throw new Error(`Unknown NLA session: ${sessionId}`);
      }

      const requestId = options.nextRequestId("session.controls.get");
      const response = await withControlWaiter({
        session,
        requestId,
        message: createEnvelope("session.controls.get", {
          sessionId,
          metadata
        }, {
          id: requestId,
          correlationId: requestId,
          timestamp: options.now()
        }),
        matches: (message): message is Extract<NlaMessage, { readonly type: "session.controls" }> =>
          message.type === "session.controls" && message.data.sessionId === sessionId
      });

      return response.data.controls;
    },

    applySessionControl: async ({ sessionId, controlId, optionId, value, metadata }) => {
      const session = getSession(sessionId);
      if (!session) {
        throw new Error(`Unknown NLA session: ${sessionId}`);
      }

      const requestId = options.nextRequestId("session.control");
      const response = await withControlWaiter({
        session,
        requestId,
        message: createEnvelope("session.control", {
          sessionId,
          control: controlId,
          optionId,
          value,
          metadata
        }, {
          id: requestId,
          correlationId: requestId,
          timestamp: options.now()
        }),
        matches: (message): message is Extract<NlaMessage, { readonly type: "session.control.state" }> =>
          message.type === "session.control.state" && message.data.sessionId === sessionId
      });

      return response.data;
    },

    interrupt: async ({ sessionId, turnId, metadata }) => {
      const session = getSession(sessionId);
      if (!session) {
        throw new Error(`Unknown NLA session: ${sessionId}`);
      }

      const requestId = options.nextRequestId("session.interrupt");
      const response = await withControlWaiter({
        session,
        requestId,
        message: createEnvelope("session.interrupt", {
          sessionId,
          turnId,
          metadata
        }, {
          id: requestId,
          correlationId: requestId,
          timestamp: options.now()
        }),
        matches: (message): message is Extract<NlaMessage, { readonly type: "session.interrupt.result" }> =>
          message.type === "session.interrupt.result" && message.data.sessionId === sessionId
      });

      return response.data;
    }
  };
};
