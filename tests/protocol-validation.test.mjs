import assert from "node:assert/strict";
import test from "node:test";
import { formatValidationIssues, validateNlaMessage } from "@nla/protocol";
import { parseJsonlMessage } from "@nla/transport-stdio-jsonl";

test("validateNlaMessage rejects session messages without sessionId", () => {
  const result = validateNlaMessage({
    protocol: "nla/v1",
    type: "session.message",
    data: {
      role: "user",
      text: "hello"
    }
  });

  assert.equal(result.ok, false);
  assert.match(formatValidationIssues(result.errors), /sessionId/);
});

test("parseJsonlMessage rejects invalid invoke requests", () => {
  assert.throws(
    () => parseJsonlMessage(JSON.stringify({
      protocol: "nla/v1",
      type: "invoke.request",
      data: {
        input: {
          hello: "world"
        }
      }
    })),
    /operation/
  );
});

test("validateNlaMessage accepts thread profile discovery and list messages", () => {
  const initialized = validateNlaMessage({
    protocol: "nla/v1",
    type: "initialized",
    data: {
      adapter: {
        id: "claude",
        name: "Claude"
      },
      profiles: {
        "nla-threads/v1": {
          list: true,
          history: true
        }
      }
    }
  });

  assert.equal(initialized.ok, true);

  const threadListItem = validateNlaMessage({
    protocol: "nla/v1",
    type: "threads.list.item",
    correlationId: "list-1",
    data: {
      threadRef: "thread-1",
      title: "Saved thread",
      updatedAt: "2026-04-15T21:00:00.000Z"
    }
  });

  assert.equal(threadListItem.ok, true);
});

test("validateNlaMessage rejects thread history items without kind", () => {
  const result = validateNlaMessage({
    protocol: "nla/v1",
    type: "threads.history.item",
    correlationId: "history-1",
    data: {
      itemId: "evt-1"
    }
  });

  assert.equal(result.ok, false);
  assert.match(formatValidationIssues(result.errors), /kind/);
});

test("validateNlaMessage accepts session.control.state messages", () => {
  const result = validateNlaMessage({
    protocol: "nla/v1",
    type: "session.control.state",
    data: {
      sessionId: "session-1",
      controlId: "setup",
      label: "Waiting for auth"
    }
  });

  assert.equal(result.ok, true);
});
