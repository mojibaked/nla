import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleBrokeredLlmContext,
  ContextProviderValidationError,
  validateBrokeredLlmContext
} from "@nla/context-assembler";

test("@nla/context-assembler drops older non-pinned history by token budget", () => {
  const result = assembleBrokeredLlmContext({
    request: {
      installId: "install",
      sessionId: "session",
      messages: [
        {
          role: "system",
          text: "You are concise."
        },
        {
          role: "user",
          text: longText("old user", 60)
        },
        {
          role: "assistant",
          text: longText("old assistant", 60)
        },
        {
          role: "user",
          text: "current request"
        }
      ]
    },
    policy: {
      maxInputTokens: 80,
      reservedOutputTokens: 10,
      safetyMarginTokens: 5,
      recentHistoryMinTokens: 20,
      maxSummaryTokens: 50,
      maxToolOutputTokens: 40,
      maxToolSpecTokens: 100,
      summarizationThresholdTokens: 200,
      rawMemoryMessageLimit: 8,
      summaryPolicyVersion: "test"
    }
  });

  assert.deepEqual(result.request.messages.map((message) => message.text), [
    "You are concise.",
    "current request"
  ]);
  assert.equal(result.report.dropped.length, 2);
});

test("@nla/context-assembler validates brokered tool protocol ordering", () => {
  const result = validateBrokeredLlmContext({
    installId: "install",
    sessionId: "session",
    messages: [
      {
        role: "tool",
        text: "{}",
        toolCallId: "call.missing"
      }
    ]
  });

  assert.equal(result.status, "failed");
  assert.match(result.errors[0] ?? "", /no preceding assistant tool call/);
  assert.throws(
    () => assembleBrokeredLlmContext({
      request: {
        installId: "install",
        sessionId: "session",
        messages: [
          {
            role: "tool",
            text: "{}",
            toolCallId: "call.missing"
          }
        ]
      }
    }),
    ContextProviderValidationError
  );
});

function longText(label, repetitions) {
  return Array.from({ length: repetitions }, (_, index) => `${label}-${index}`).join(" ");
}
