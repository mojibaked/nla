import assert from "node:assert/strict";
import test from "node:test";

import { createEnvelope } from "../packages/protocol/dist/index.js";
import {
  adapterTool,
  DEFAULT_NLA_DELEGATION_MAX_DEPTH,
  NLA_DELEGATION_DEPTH_METADATA_KEY,
  NLA_DELEGATION_METADATA_KEY
} from "../packages/delegation/dist/index.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(10);
  }

  throw new Error("Timed out waiting for condition");
};

const streamMessages = (messages) => ({
  async *[Symbol.asyncIterator]() {
    for (const message of messages) {
      yield message;
    }
  }
});

const createNeverStream = (onNext) => ({
  [Symbol.asyncIterator]() {
    return {
      next() {
        onNext();
        return new Promise(() => {});
      },
      async return() {
        return {
          done: true
        };
      }
    };
  }
});

const createDelegatedSession = (overrides = {}) => ({
  sessionId: "child-session",
  ephemeral: true,
  sendUserTurn() {
    return streamMessages([]);
  },
  resolveInteraction() {
    return streamMessages([]);
  },
  async interrupt() {},
  async stop() {},
  ...overrides
});

const createToolContext = (options = {}) => {
  let sequence = 0;
  const activities = [];
  const requestData = {
    sessionId: "parent-session",
    role: "user",
    text: "parent request"
  };
  if (options.metadata) {
    requestData.metadata = options.metadata;
  }

  return {
    activities,
    context: {
      sessionId: "parent-session",
      clientId: "parent-client",
      turnId: "parent-turn",
      userMessageId: "parent-user-message",
      assistantMessageId: "parent-assistant-message",
      text: "parent request",
      parts: [],
      session: {
        id: "parent-session"
      },
      request: createEnvelope("session.message", requestData, {
        id: "parent-request",
        correlationId: "parent-correlation"
      }),
      raw: {
        createId(prefix = "id") {
          sequence += 1;
          return `${prefix}:${sequence}`;
        }
      },
      signal: options.signal ?? new AbortController().signal,
      status() {},
      execution() {},
      activity(activity) {
        activities.push(activity);
      },
      requestInput() {},
      awaitInput: options.awaitInput ?? (async (request) => ({
        sessionId: "parent-session",
        resolution: {
          kind: request.kind,
          requestId: request.requestId
        }
      })),
      assistantDelta() {},
      reply() {}
    }
  };
};

test("@nla/delegation adapterTool returns final child assistant text", async () => {
  let launchRequest;
  let sentTurn;
  let stopped = 0;
  const session = createDelegatedSession({
    sendUserTurn(turn) {
      sentTurn = turn;
      return streamMessages([
        createEnvelope("session.activity", {
          activityId: "search",
          title: "Search",
          status: "running"
        }),
        createEnvelope("session.message", {
          sessionId: "child-session",
          turnId: turn.turnId,
          role: "assistant",
          text: "child says hi"
        }),
        createEnvelope("session.completed", {
          sessionId: "child-session"
        })
      ]);
    },
    async stop() {
      stopped += 1;
    }
  });
  const definition = adapterTool({
    name: "ask_child",
    description: "Ask a child adapter.",
    target: {
      id: "child-adapter"
    },
    launcher: {
      launch(request) {
        launchRequest = request;
        return session;
      }
    }
  });
  const { context, activities } = createToolContext();

  const output = await definition.execute(context, "hello child");

  assert.equal(output, "child says hi");
  assert.equal(sentTurn.text, "hello child");
  assert.equal(sentTurn.metadata[NLA_DELEGATION_DEPTH_METADATA_KEY], 1);
  assert.equal(launchRequest.context.depth, 0);
  assert.equal(launchRequest.context.parentSessionId, "parent-session");
  assert.equal(activities.length, 1);
  assert.equal(activities[0].activityId, "ask_child:child-session:search");
  assert.equal(stopped, 1);
});

test("@nla/delegation forwards child interaction requests and resolves them back to the child", async () => {
  let forwardedRequest;
  let childResolution;
  const session = createDelegatedSession({
    sendUserTurn(turn) {
      return streamMessages([
        createEnvelope("session.interaction.requested", {
          sessionId: "child-session",
          turnId: turn.turnId,
          request: {
            kind: "approval",
            requestId: "child-request",
            title: "Approve?"
          }
        })
      ]);
    },
    resolveInteraction(resolution) {
      childResolution = resolution;
      return streamMessages([
        createEnvelope("session.message", {
          sessionId: "child-session",
          turnId: resolution.turnId,
          role: "assistant",
          text: "approved"
        })
      ]);
    }
  });
  const definition = adapterTool({
    name: "ask_child",
    description: "Ask a child adapter.",
    target: {
      id: "child-adapter"
    },
    launcher: {
      launch() {
        return session;
      }
    }
  });
  const { context } = createToolContext({
    awaitInput: async (request) => {
      forwardedRequest = request;
      return {
        sessionId: "parent-session",
        resolution: {
          kind: request.kind,
          requestId: request.requestId,
          optionId: "yes"
        },
        metadata: {
          resolvedBy: "test"
        }
      };
    }
  });

  const output = await definition.execute(context, "needs approval");

  assert.equal(output, "approved");
  assert.equal(forwardedRequest.kind, "approval");
  assert.notEqual(forwardedRequest.requestId, "child-request");
  assert.equal(
    forwardedRequest.metadata[NLA_DELEGATION_METADATA_KEY].childRequestId,
    "child-request"
  );
  assert.equal(childResolution.resolution.requestId, "child-request");
  assert.equal(childResolution.resolution.optionId, "yes");
  assert.deepEqual(childResolution.metadata, {
    resolvedBy: "test"
  });
});

test("@nla/delegation rejects when the child session fails", async () => {
  let stopped = 0;
  const session = createDelegatedSession({
    sendUserTurn() {
      return streamMessages([
        createEnvelope("session.failed", {
          sessionId: "child-session",
          ok: false,
          code: "child_error",
          message: "Child exploded"
        })
      ]);
    },
    async stop() {
      stopped += 1;
    }
  });
  const definition = adapterTool({
    name: "ask_child",
    description: "Ask a child adapter.",
    target: {
      id: "child-adapter"
    },
    launcher: {
      launch() {
        return session;
      }
    }
  });
  const { context } = createToolContext();

  await assert.rejects(
    () => definition.execute(context, "fail"),
    /Child exploded \[child_error\]/
  );
  assert.equal(stopped, 1);
});

test("@nla/delegation propagates parent abort to the child session", async () => {
  const controller = new AbortController();
  let nextStarted = false;
  let interrupted = 0;
  let stopped = 0;
  const session = createDelegatedSession({
    sendUserTurn() {
      return createNeverStream(() => {
        nextStarted = true;
      });
    },
    async interrupt(input) {
      interrupted += 1;
      assert.ok(input.turnId);
    },
    async stop() {
      stopped += 1;
    }
  });
  const definition = adapterTool({
    name: "ask_child",
    description: "Ask a child adapter.",
    timeoutMs: 1000,
    target: {
      id: "child-adapter"
    },
    launcher: {
      launch() {
        return session;
      }
    }
  });
  const { context } = createToolContext({
    signal: controller.signal
  });

  const pending = definition.execute(context, "hang");
  await waitFor(() => nextStarted);
  controller.abort(new Error("parent aborted"));

  await assert.rejects(
    () => pending,
    /parent aborted/
  );
  assert.equal(interrupted, 1);
  assert.equal(stopped, 1);
});

test("@nla/delegation prevents recursion at the default max depth", async () => {
  let launched = false;
  const definition = adapterTool({
    name: "ask_child",
    description: "Ask a child adapter.",
    target: {
      id: "child-adapter"
    },
    launcher: {
      launch() {
        launched = true;
        return createDelegatedSession();
      }
    }
  });
  const { context } = createToolContext({
    metadata: {
      [NLA_DELEGATION_DEPTH_METADATA_KEY]: DEFAULT_NLA_DELEGATION_MAX_DEPTH
    }
  });

  await assert.rejects(
    () => definition.execute(context, "recurse"),
    {
      name: "NlaDelegationDepthError"
    }
  );
  assert.equal(launched, false);
});

test("@nla/delegation times out delegated turns and cleans up the child session", async () => {
  let nextStarted = false;
  let interrupted = 0;
  let stopped = 0;
  const session = createDelegatedSession({
    sendUserTurn() {
      return createNeverStream(() => {
        nextStarted = true;
      });
    },
    async interrupt() {
      interrupted += 1;
    },
    async stop() {
      stopped += 1;
    }
  });
  const definition = adapterTool({
    name: "ask_child",
    description: "Ask a child adapter.",
    timeoutMs: 20,
    target: {
      id: "child-adapter"
    },
    launcher: {
      launch() {
        return session;
      }
    }
  });
  const { context } = createToolContext();

  await assert.rejects(
    async () => {
      const pending = definition.execute(context, "hang");
      await waitFor(() => nextStarted);
      await pending;
    },
    /timed out/
  );
  assert.equal(interrupted, 1);
  assert.equal(stopped, 1);
});
