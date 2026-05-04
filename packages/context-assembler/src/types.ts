export type JsonSchema = Readonly<Record<string, unknown>>;

export type BrokeredLlmRole = "system" | "user" | "assistant" | "tool";

export interface ConversationMemoryMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly sourceEventId?: string;
  readonly sourceMessageId?: string;
  readonly turnId?: string;
  readonly createdAt?: string;
}

export interface ConversationMemoryState {
  readonly lastEventId?: string;
  readonly summary?: string;
  readonly summaryEventId?: string;
  readonly summarySourceEventIds?: ReadonlyArray<string>;
  readonly summarySourceMessageIds?: ReadonlyArray<string>;
  readonly recent?: ReadonlyArray<ConversationMemoryMessage>;
  readonly estimatedTokens?: number;
  readonly summaryModel?: string;
  readonly summaryPolicyVersion?: string;
  readonly updatedAt?: string;
}

export interface BrokeredLlmMessage {
  readonly role: BrokeredLlmRole;
  readonly text: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly toolInput?: unknown;
}

export type BrokeredLlmToolOutputReductionStrategy =
  | "auto"
  | "json"
  | "json-array"
  | "json-object"
  | "head-tail"
  | "exact";

export interface BrokeredLlmToolOutputReduction {
  readonly strategy?: BrokeredLlmToolOutputReductionStrategy;
  readonly preserveFields?: ReadonlyArray<string>;
  readonly sampleFirst?: number;
  readonly sampleLast?: number;
}

export interface BrokeredLlmToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: JsonSchema;
  readonly outputReduction?: BrokeredLlmToolOutputReduction;
}

export interface BrokeredLlmRequest {
  readonly installId: string;
  readonly sessionId: string;
  readonly provider?: string;
  readonly model?: string;
  readonly messages: ReadonlyArray<BrokeredLlmMessage>;
  readonly tools?: ReadonlyArray<BrokeredLlmToolSpec>;
  readonly toolChoice?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ContextSegmentKind =
  | "system"
  | "developer"
  | "memory_summary"
  | "retrieved_memory"
  | "recent_exact"
  | "current_user"
  | "assistant"
  | "active_tool_protocol"
  | "historical_tool_protocol"
  | "tool_output_digest"
  | "tool_schema";

export type ContextSegmentPriority =
  | "pinned"
  | "high"
  | "normal"
  | "low"
  | "drop_first";

export type ContextPiiFlag = "unknown" | "none" | "possible" | "redacted";

export interface ContextAssemblyPolicy {
  readonly maxInputTokens: number;
  readonly reservedOutputTokens: number;
  readonly safetyMarginTokens: number;
  readonly recentHistoryMinTokens: number;
  readonly maxSummaryTokens: number;
  readonly maxToolOutputTokens: number;
  readonly maxToolSpecTokens: number;
  readonly summarizationThresholdTokens: number;
  readonly rawMemoryMessageLimit: number;
  readonly summaryPolicyVersion: string;
}

export interface ContextAssemblyDecision {
  readonly id: string;
  readonly kind: ContextSegmentKind;
  readonly role?: BrokeredLlmRole;
  readonly estimatedTokens: number;
  readonly reason: string;
  readonly sourceEventIds?: ReadonlyArray<string>;
  readonly sourceMessageIds?: ReadonlyArray<string>;
  readonly reducer?: string;
  readonly pii?: ContextPiiFlag;
}

export interface ContextAssemblyReport {
  readonly policyVersion: string;
  readonly provider?: string;
  readonly model?: string;
  readonly estimatedInputTokens: number;
  readonly estimatedInputTokensBefore: number;
  readonly maxInputTokens: number;
  readonly cacheablePrefixTokens?: number;
  readonly kept: ReadonlyArray<ContextAssemblyDecision>;
  readonly dropped: ReadonlyArray<ContextAssemblyDecision>;
  readonly reduced: ReadonlyArray<ContextAssemblyDecision>;
  readonly selectedMemoryIds: ReadonlyArray<string>;
  readonly validationStatus: "passed" | "failed" | "skipped";
  readonly validationErrors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

export interface ContextAssemblyResult {
  readonly request: BrokeredLlmRequest;
  readonly report: ContextAssemblyReport;
}
