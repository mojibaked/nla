import type {
  BrokeredLlmMessage,
  BrokeredLlmRequest,
  BrokeredLlmToolOutputReduction,
  BrokeredLlmToolSpec,
  ConversationMemoryState,
  ContextAssemblyDecision,
  ContextAssemblyPolicy,
  ContextAssemblyReport,
  ContextAssemblyResult,
  ContextPiiFlag,
  ContextSegmentKind,
  ContextSegmentPriority
} from "./types.js";
import {
  assertBrokeredLlmContextValid
} from "./validation.js";

export interface TokenEstimator {
  readonly estimateText: (input: {
    readonly text: string;
    readonly provider?: string;
    readonly model?: string;
  }) => number;
  readonly estimateMessage: (input: {
    readonly message: BrokeredLlmMessage;
    readonly provider?: string;
    readonly model?: string;
  }) => number;
  readonly estimateToolSpec: (input: {
    readonly tool: BrokeredLlmToolSpec;
    readonly provider?: string;
    readonly model?: string;
  }) => number;
}

export interface ToolOutputReducerInput {
  readonly message: BrokeredLlmMessage;
  readonly text: string;
  readonly sourceTokenEstimate: number;
  readonly maxOutputTokens: number;
  readonly outputReduction?: BrokeredLlmToolOutputReduction;
  readonly estimator: TokenEstimator;
  readonly provider?: string;
  readonly model?: string;
}

export interface ToolOutputReduction {
  readonly text: string;
  readonly reducer: string;
  readonly exact?: boolean;
  readonly sourceTokenEstimate: number;
  readonly reducedTokenEstimate: number;
  readonly warnings?: ReadonlyArray<string>;
}

export interface ToolOutputReducer {
  readonly name: string;
  readonly toolName?: string | RegExp;
  readonly reduce: (input: ToolOutputReducerInput) => ToolOutputReduction | undefined;
}

interface ContextSegment {
  readonly id: string;
  readonly kind: ContextSegmentKind;
  readonly priority: ContextSegmentPriority;
  readonly order: number;
  readonly messages: ReadonlyArray<BrokeredLlmMessage>;
  readonly estimatedTokens: number;
  readonly sourceEventIds?: ReadonlyArray<string>;
  readonly sourceMessageIds?: ReadonlyArray<string>;
  readonly reducer?: string;
  readonly pii?: ContextPiiFlag;
  readonly retention?: "ephemeral" | "session" | "long_term_candidate";
  readonly evictionRule: "never" | "drop_oldest" | "drop_first" | "reduce_then_drop";
}

export class ContextAssemblyError extends Error {
  readonly name = "ContextAssemblyError";

  constructor(
    readonly code: "context_budget_exceeded" | "context_exact_tool_output_exceeded",
    message: string
  ) {
    super(message);
  }
}

export const DefaultContextAssemblyPolicy: ContextAssemblyPolicy = {
  maxInputTokens: 64_000,
  reservedOutputTokens: 4_000,
  safetyMarginTokens: 2_000,
  recentHistoryMinTokens: 4_000,
  maxSummaryTokens: 4_000,
  maxToolOutputTokens: 12_000,
  maxToolSpecTokens: 8_000,
  summarizationThresholdTokens: 24_000,
  rawMemoryMessageLimit: 96,
  summaryPolicyVersion: "context-assembler-v1"
};

export const RoughTokenEstimator: TokenEstimator = {
  estimateText: ({ text }) => estimateTextTokens(text),
  estimateMessage: ({ message }) => {
    const toolInput = message.toolInput === undefined
      ? ""
      : safeJson(message.toolInput);
    return 8 + estimateTextTokens([
      message.role,
      message.text,
      message.toolName ?? "",
      message.toolCallId ?? "",
      toolInput
    ].join("\n"));
  },
  estimateToolSpec: ({ tool }) =>
    8 + estimateTextTokens([
      tool.name,
      tool.description,
      tool.inputSchema ? safeJson(tool.inputSchema) : ""
    ].join("\n"))
};

export const JsonToolOutputReducer: ToolOutputReducer = {
  name: "json-structure",
  reduce: (input) => {
    if (
      input.outputReduction?.strategy &&
      input.outputReduction.strategy !== "auto" &&
      input.outputReduction.strategy !== "json" &&
      input.outputReduction.strategy !== "json-array" &&
      input.outputReduction.strategy !== "json-object"
    ) {
      return undefined;
    }

    const parsed = parseJson(input.text);
    if (parsed === undefined) {
      return undefined;
    }

    if (
      Array.isArray(parsed) &&
      input.outputReduction?.strategy !== "json-object"
    ) {
      return createJsonArrayReduction(input, parsed);
    }

    if (
      isJsonObject(parsed) &&
      input.outputReduction?.strategy !== "json-array"
    ) {
      return createJsonObjectReduction(input, parsed);
    }

    return undefined;
  }
};

export const DefaultToolOutputReducers: ReadonlyArray<ToolOutputReducer> = [
  JsonToolOutputReducer
];

export const assembleBrokeredLlmContext = (input: {
  readonly request: BrokeredLlmRequest;
  readonly memory?: ConversationMemoryState;
  readonly policy?: Partial<ContextAssemblyPolicy>;
  readonly estimator?: TokenEstimator;
  readonly toolOutputReducers?: ReadonlyArray<ToolOutputReducer>;
}): ContextAssemblyResult => {
  const policy = normalizePolicy(input.policy);
  const estimator = input.estimator ?? RoughTokenEstimator;
  const toolOutputReducers = [
    ...(input.toolOutputReducers ?? []),
    ...DefaultToolOutputReducers
  ];
  const request = input.request;
  const provider = request.provider;
  const model = request.model;
  const toolOutputReductions = buildToolOutputReductionMap(request.tools ?? []);
  const toolSpecTokens = estimateToolSpecTokens(request.tools ?? [], estimator, provider, model);
  const beforeTokens = estimateRequestTokens(request, estimator);
  const budget = policy.maxInputTokens - policy.reservedOutputTokens - policy.safetyMarginTokens;
  const warnings: string[] = [];
  const reduced: ContextAssemblyDecision[] = [];

  if (toolSpecTokens > policy.maxToolSpecTokens) {
    warnings.push(`tool schemas estimate ${toolSpecTokens} tokens, above configured cap ${policy.maxToolSpecTokens}`);
  }

  const rawSegments = buildSegments(request, input.memory, policy, estimator);
  const segments = rawSegments.map((segment) =>
    reduceSegmentIfNeeded(
      segment,
      policy,
      estimator,
      provider,
      model,
      reduced,
      warnings,
      toolOutputReducers,
      toolOutputReductions
    )
  );
  const pinned = segments.filter((segment) => segment.priority === "pinned");
  const optional = segments.filter((segment) => segment.priority !== "pinned");
  let usedTokens = toolSpecTokens + sumTokens(pinned);

  if (usedTokens > budget) {
    throw new ContextAssemblyError(
      "context_budget_exceeded",
      `Pinned context estimates ${usedTokens} tokens, exceeding budget ${budget}`
    );
  }

  const selected = new Set(pinned.map((segment) => segment.id));
  const dropped: ContextAssemblyDecision[] = [];
  const kept: ContextAssemblyDecision[] = [];

  for (const segment of [...optional].sort((a, b) => b.order - a.order)) {
    if (usedTokens + segment.estimatedTokens <= budget) {
      selected.add(segment.id);
      usedTokens += segment.estimatedTokens;
    } else {
      dropped.push(decisionForSegment(segment, "budget_exceeded"));
    }
  }

  const selectedSegments = segments
    .filter((segment) => selected.has(segment.id))
    .sort((a, b) => a.order - b.order);

  for (const segment of selectedSegments) {
    kept.push(decisionForSegment(segment, segment.priority === "pinned" ? "pinned" : "within_budget"));
  }

  const assembledMessages = [
    ...selectedSegments
      .filter((segment) => isSystemLikeSegment(segment))
      .flatMap((segment) => segment.messages),
    ...selectedSegments
      .filter((segment) => !isSystemLikeSegment(segment))
      .flatMap((segment) => segment.messages)
  ];

  const assembledRequest: BrokeredLlmRequest = {
    ...request,
    messages: assembledMessages,
    metadata: {
      ...(request.metadata ?? {}),
      context_policy_version: policy.summaryPolicyVersion,
      context_estimated_input_tokens: usedTokens,
      context_dropped_segments: dropped.length
    }
  };

  const validation = assertBrokeredLlmContextValid(assembledRequest);
  const report: ContextAssemblyReport = {
    policyVersion: policy.summaryPolicyVersion,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    estimatedInputTokens: usedTokens,
    estimatedInputTokensBefore: beforeTokens,
    maxInputTokens: policy.maxInputTokens,
    cacheablePrefixTokens: estimateCacheablePrefixTokens(assembledMessages, estimator, provider, model),
    kept,
    dropped: dropped.sort((a, b) => a.id.localeCompare(b.id)),
    reduced,
    selectedMemoryIds: kept
      .filter((decision) => decision.kind === "memory_summary" || decision.kind === "retrieved_memory")
      .map((decision) => decision.id),
    validationStatus: validation.status,
    validationErrors: validation.errors,
    warnings: [...warnings, ...validation.warnings]
  };

  return {
    request: assembledRequest,
    report
  };
};

const normalizePolicy = (
  policy: Partial<ContextAssemblyPolicy> | undefined
): ContextAssemblyPolicy => ({
  ...DefaultContextAssemblyPolicy,
  ...(policy ?? {})
});

const buildSegments = (
  request: BrokeredLlmRequest,
  memory: ConversationMemoryState | undefined,
  policy: ContextAssemblyPolicy,
  estimator: TokenEstimator
): ReadonlyArray<ContextSegment> => {
  const lastUserIndex = findLastUserIndex(request.messages);
  const segments: ContextSegment[] = [
    ...buildMemorySegments(request, memory, policy, estimator)
  ];

  for (let index = 0; index < request.messages.length; index += 1) {
    const message = request.messages[index];
    if (!message) {
      continue;
    }

    if (message.role === "system") {
      const segment = createMessageSegment({
        request,
        estimator,
        id: message.text.trim().startsWith("Conversation summary:")
          ? `memory_summary:${index}`
          : `system:${index}`,
        kind: message.text.trim().startsWith("Conversation summary:")
          ? "memory_summary"
          : "system",
        priority: "pinned",
        order: index,
        messages: [maybeCapMemorySummary(message, request, policy, estimator)],
        evictionRule: "never",
        retention: "session"
      });
      segments.push(segment);
      continue;
    }

    if (message.role === "assistant" && message.toolCallId && message.toolName) {
      const protocol = collectToolProtocolRun(request.messages, index);
      const active = lastUserIndex === -1 || index > lastUserIndex;
      segments.push(createMessageSegment({
        request,
        estimator,
        id: `${active ? "active_tool_protocol" : "historical_tool_protocol"}:${protocol.callIds.join(",")}:${index}`,
        kind: active ? "active_tool_protocol" : "historical_tool_protocol",
        priority: active ? "pinned" : "low",
        order: index,
        messages: protocol.messages,
        evictionRule: active ? "reduce_then_drop" : "drop_first",
        retention: "ephemeral"
      }));
      index = protocol.endIndex;
      continue;
    }

    if (message.role === "tool") {
      const active = lastUserIndex === -1 || index > lastUserIndex;
      segments.push(createMessageSegment({
        request,
        estimator,
        id: `${active ? "active_tool_protocol" : "historical_tool_protocol"}:orphan:${index}`,
        kind: active ? "active_tool_protocol" : "historical_tool_protocol",
        priority: active ? "pinned" : "low",
        order: index,
        messages: [message],
        evictionRule: active ? "never" : "drop_first",
        retention: "ephemeral"
      }));
      continue;
    }

    if (message.role === "user" && index === lastUserIndex) {
      segments.push(createMessageSegment({
        request,
        estimator,
        id: `current_user:${index}`,
        kind: "current_user",
        priority: "pinned",
        order: index,
        messages: [message],
        evictionRule: "never",
        retention: "ephemeral"
      }));
      continue;
    }

    segments.push(createMessageSegment({
      request,
      estimator,
      id: `${message.role === "assistant" ? "assistant" : "recent_exact"}:${index}`,
      kind: message.role === "assistant" ? "assistant" : "recent_exact",
      priority: "normal",
      order: index,
      messages: [message],
      evictionRule: "drop_oldest",
      retention: "session"
    }));
  }

  return segments;
};

const maybeCapMemorySummary = (
  message: BrokeredLlmMessage,
  request: BrokeredLlmRequest,
  policy: ContextAssemblyPolicy,
  estimator: TokenEstimator
): BrokeredLlmMessage => {
  const tokens = estimator.estimateMessage({
    message,
    provider: request.provider,
    model: request.model
  });
  if (tokens <= policy.maxSummaryTokens) {
    return message;
  }

  return {
    ...message,
    text: truncateWithNotice(
      message.text,
      policy.maxSummaryTokens,
      "Conversation summary truncated to fit context budget."
    )
  };
};

const buildMemorySegments = (
  request: BrokeredLlmRequest,
  memory: ConversationMemoryState | undefined,
  policy: ContextAssemblyPolicy,
  estimator: TokenEstimator
): ReadonlyArray<ContextSegment> => {
  if (!memory) {
    return [];
  }

  const segments: ContextSegment[] = [];
  const lastSystemIndex = findLastSystemIndex(request.messages);
  const summaryOrder = lastSystemIndex >= 0 ? lastSystemIndex + 0.1 : -1;
  const recentOrderBase = lastSystemIndex >= 0 ? lastSystemIndex + 0.2 : -0.8;

  if (memory.summary?.trim()) {
    const summaryMessage: BrokeredLlmMessage = {
      role: "system",
      text: `Conversation summary:\n${memory.summary.trim()}`
    };
    segments.push(createMessageSegment({
      request,
      estimator,
      id: `memory_summary:${memory.summaryEventId ?? "structured"}`,
      kind: "memory_summary",
      priority: "pinned",
      order: summaryOrder,
      messages: [maybeCapMemorySummary(summaryMessage, request, policy, estimator)],
      evictionRule: "never",
      retention: "session",
      sourceEventIds: memory.summarySourceEventIds,
      sourceMessageIds: memory.summarySourceMessageIds
    }));
  }

  const recent = (memory.recent ?? []).slice(-policy.rawMemoryMessageLimit);
  recent.forEach((entry, index) => {
    segments.push(createMessageSegment({
      request,
      estimator,
      id: `memory_recent:${entry.sourceEventId ?? index}`,
      kind: "recent_exact",
      priority: "normal",
      order: recentOrderBase + index / 1000,
      messages: [
        {
          role: entry.role,
          text: entry.text
        }
      ],
      evictionRule: "drop_oldest",
      retention: "session",
      sourceEventIds: entry.sourceEventId ? [entry.sourceEventId] : undefined,
      sourceMessageIds: entry.sourceMessageId ? [entry.sourceMessageId] : undefined
    }));
  });

  return segments;
};

const createMessageSegment = (input: {
  readonly request: BrokeredLlmRequest;
  readonly estimator: TokenEstimator;
  readonly id: string;
  readonly kind: ContextSegmentKind;
  readonly priority: ContextSegmentPriority;
  readonly order: number;
  readonly messages: ReadonlyArray<BrokeredLlmMessage>;
  readonly sourceEventIds?: ReadonlyArray<string>;
  readonly sourceMessageIds?: ReadonlyArray<string>;
  readonly evictionRule: ContextSegment["evictionRule"];
  readonly retention?: ContextSegment["retention"];
}): ContextSegment => ({
  id: input.id,
  kind: input.kind,
  priority: input.priority,
  order: input.order,
  messages: input.messages,
  estimatedTokens: sumMessageTokens(input.messages, input.estimator, input.request.provider, input.request.model),
  ...(input.sourceEventIds ? { sourceEventIds: input.sourceEventIds } : {}),
  ...(input.sourceMessageIds ? { sourceMessageIds: input.sourceMessageIds } : {}),
  pii: "unknown",
  evictionRule: input.evictionRule,
  ...(input.retention ? { retention: input.retention } : {})
});

const reduceSegmentIfNeeded = (
  segment: ContextSegment,
  policy: ContextAssemblyPolicy,
  estimator: TokenEstimator,
  provider: string | undefined,
  model: string | undefined,
  reduced: ContextAssemblyDecision[],
  warnings: string[],
  toolOutputReducers: ReadonlyArray<ToolOutputReducer>,
  toolOutputReductions: ReadonlyMap<string, BrokeredLlmToolOutputReduction>
): ContextSegment => {
  if (segment.kind !== "active_tool_protocol") {
    return segment;
  }

  let changed = false;
  const reducerNames = new Set<string>();
  const messages = segment.messages.map((message) => {
    if (message.role !== "tool") {
      return message;
    }

    const reduction = reduceToolOutputMessage({
      message,
      policy,
      estimator,
      provider,
      model,
      toolOutputReducers,
      outputReduction: message.toolName
        ? toolOutputReductions.get(message.toolName)
        : undefined
    });
    if (!reduction) {
      return message;
    }

    changed = true;
    reducerNames.add(reduction.reducer);
    warnings.push(...(reduction.warnings ?? []));
    return {
      ...message,
      text: reduction.text
    };
  });

  if (!changed) {
    return segment;
  }

  const reducer = Array.from(reducerNames).join(",");
  const next: ContextSegment = {
    ...segment,
    id: `${segment.id}:reduced`,
    kind: "active_tool_protocol",
    messages,
    estimatedTokens: sumMessageTokens(messages, estimator, provider, model),
    reducer
  };
  reduced.push(decisionForSegment(next, "reduced", reducer));
  return next;
};

const reduceToolOutputMessage = (input: {
  readonly message: BrokeredLlmMessage;
  readonly policy: ContextAssemblyPolicy;
  readonly estimator: TokenEstimator;
  readonly provider?: string;
  readonly model?: string;
  readonly toolOutputReducers: ReadonlyArray<ToolOutputReducer>;
  readonly outputReduction?: BrokeredLlmToolOutputReduction;
}): ToolOutputReduction | undefined => {
  const { message, policy, estimator, provider, model, outputReduction } = input;
  const sourceTokenEstimate = estimator.estimateMessage({ message, provider, model });
  if (sourceTokenEstimate <= policy.maxToolOutputTokens) {
    return undefined;
  }

  if (requiresExactToolOutput(message, outputReduction)) {
    throw new ContextAssemblyError(
      "context_exact_tool_output_exceeded",
      `Tool output for ${message.toolName ?? "unknown"} requires exact retention and estimates ${sourceTokenEstimate} tokens, above cap ${policy.maxToolOutputTokens}`
    );
  }

  if (outputReduction?.strategy === "head-tail") {
    return createHeadTailReduction({
      message,
      sourceText: message.text,
      sourceTokenEstimate,
      maxOutputTokens: policy.maxToolOutputTokens,
      notice: `Tool output for ${message.toolName ?? "unknown"} was reduced to fit context budget.`,
      reducer: "head-tail",
      estimator,
      provider,
      model
    });
  }

  const reducerInput: ToolOutputReducerInput = {
    message,
    text: message.text,
    sourceTokenEstimate,
    maxOutputTokens: policy.maxToolOutputTokens,
    ...(outputReduction ? { outputReduction } : {}),
    estimator,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {})
  };
  const reducerWarnings: string[] = [];

  for (const reducer of input.toolOutputReducers) {
    if (!toolOutputReducerMatches(reducer, message.toolName)) {
      continue;
    }

    try {
      const reduction = reducer.reduce(reducerInput);
      if (!reduction) {
        continue;
      }

      return enforceToolOutputCap({
        message,
        reduction: {
          ...reduction,
          warnings: [...reducerWarnings, ...(reduction.warnings ?? [])]
        },
        maxOutputTokens: policy.maxToolOutputTokens,
        estimator,
        provider,
        model
      });
    } catch (error) {
      if (error instanceof ContextAssemblyError) {
        throw error;
      }
      reducerWarnings.push(
        `tool output reducer ${reducer.name} failed for ${message.toolName ?? "unknown"}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const headTail = createHeadTailReduction({
    message,
    sourceText: message.text,
    sourceTokenEstimate,
    maxOutputTokens: policy.maxToolOutputTokens,
    notice: `Tool output for ${message.toolName ?? "unknown"} was reduced to fit context budget.`,
    reducer: "head-tail",
    estimator,
    provider,
    model
  });

  return {
    ...headTail,
    warnings: reducerWarnings
  };
};

const enforceToolOutputCap = (input: {
  readonly message: BrokeredLlmMessage;
  readonly reduction: ToolOutputReduction;
  readonly maxOutputTokens: number;
  readonly estimator: TokenEstimator;
  readonly provider?: string;
  readonly model?: string;
}): ToolOutputReduction => {
  const reducedTokenEstimate = input.estimator.estimateMessage({
    message: {
      ...input.message,
      text: input.reduction.text
    },
    provider: input.provider,
    model: input.model
  });

  if (reducedTokenEstimate <= input.maxOutputTokens) {
    return {
      ...input.reduction,
      reducedTokenEstimate
    };
  }

  if (input.reduction.exact) {
    throw new ContextAssemblyError(
      "context_exact_tool_output_exceeded",
      `Tool output for ${input.message.toolName ?? "unknown"} was marked exact after ${input.reduction.reducer} reduction and estimates ${reducedTokenEstimate} tokens, above cap ${input.maxOutputTokens}`
    );
  }

  const capped = createHeadTailReduction({
    message: input.message,
    sourceText: input.reduction.text,
    sourceTokenEstimate: input.reduction.sourceTokenEstimate,
    maxOutputTokens: input.maxOutputTokens,
    notice: `Reduced tool output for ${input.message.toolName ?? "unknown"} still exceeded context cap after ${input.reduction.reducer}; applying head-tail cap.`,
    reducer: `${input.reduction.reducer}+head-tail`,
    estimator: input.estimator,
    provider: input.provider,
    model: input.model
  });

  return {
    ...capped,
    warnings: input.reduction.warnings
  };
};

const createHeadTailReduction = (input: {
  readonly message: BrokeredLlmMessage;
  readonly sourceText: string;
  readonly sourceTokenEstimate: number;
  readonly maxOutputTokens: number;
  readonly notice: string;
  readonly reducer: string;
  readonly estimator: TokenEstimator;
  readonly provider?: string;
  readonly model?: string;
}): ToolOutputReduction => {
  let tokenCap = input.maxOutputTokens;
  let text = "";
  let reducedTokenEstimate = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    text = truncateWithNotice(input.sourceText, tokenCap, input.notice, {
      minimumCharacters: 24
    });
    reducedTokenEstimate = input.estimator.estimateMessage({
      message: {
        ...input.message,
        text
      },
      provider: input.provider,
      model: input.model
    });
    if (reducedTokenEstimate <= input.maxOutputTokens) {
      break;
    }
    tokenCap = Math.max(1, Math.floor(tokenCap * 0.72) - 8);
  }

  return {
    text,
    reducer: input.reducer,
    sourceTokenEstimate: input.sourceTokenEstimate,
    reducedTokenEstimate
  };
};

const toolOutputReducerMatches = (
  reducer: ToolOutputReducer,
  toolName: string | undefined
): boolean => {
  if (!reducer.toolName) {
    return true;
  }
  if (!toolName) {
    return false;
  }
  if (typeof reducer.toolName === "string") {
    return reducer.toolName === toolName;
  }
  reducer.toolName.lastIndex = 0;
  return reducer.toolName.test(toolName);
};

const requiresExactToolOutput = (
  message: BrokeredLlmMessage,
  outputReduction: BrokeredLlmToolOutputReduction | undefined
): boolean => {
  if (outputReduction?.strategy === "exact") {
    return true;
  }

  const toolName = message.toolName?.trim();
  if (!toolName) {
    return false;
  }

  return toolNameRequiresExactOutput(toolName);
};

const ExactToolOutputTokens = new Set([
  "approval",
  "approve",
  "authenticate",
  "authorization",
  "authorize",
  "credential",
  "credentials",
  "mnemonic",
  "oauth",
  "oidc",
  "openid",
  "passkey",
  "secret",
  "secrets",
  "seedphrase",
  "signature",
  "signed",
  "signing",
  "webauthn"
]);

const ExactToolOutputAuthContextTokens = new Set([
  "callback",
  "challenge",
  "code",
  "exchange",
  "oauth",
  "request",
  "resolution",
  "resolve",
  "response",
  "result",
  "token",
  "verify"
]);

const ExactToolOutputSignContextTokens = new Set([
  "digest",
  "message",
  "payload",
  "request",
  "result",
  "transaction",
  "typed",
  "typeddata"
]);

const ExactToolOutputTokenPairs: ReadonlyArray<readonly [string, string]> = [
  ["access", "token"],
  ["api", "key"],
  ["client", "secret"],
  ["device", "code"],
  ["id", "token"],
  ["private", "key"],
  ["recovery", "code"],
  ["refresh", "token"],
  ["seed", "phrase"]
];

const toolNameRequiresExactOutput = (toolName: string): boolean => {
  const tokens = tokenizeToolName(toolName);
  if (tokens.length === 0) {
    return false;
  }

  if (tokens.some((token) => ExactToolOutputTokens.has(token))) {
    return true;
  }

  if (tokens.includes("wallet") && tokens.includes("setup")) {
    return true;
  }

  if (ExactToolOutputTokenPairs.some(([left, right]) => tokens.includes(left) && tokens.includes(right))) {
    return true;
  }

  if (
    tokens.includes("sign") &&
    tokens.some((token) => ExactToolOutputSignContextTokens.has(token))
  ) {
    return true;
  }

  const hasAuthToken = tokens.includes("auth") || tokens.includes("authentication");
  if (
    hasAuthToken &&
    !tokens.includes("status") &&
    tokens.some((token) => ExactToolOutputAuthContextTokens.has(token))
  ) {
    return true;
  }

  return false;
};

const tokenizeToolName = (toolName: string): ReadonlyArray<string> =>
  toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 0);

const buildToolOutputReductionMap = (
  tools: ReadonlyArray<BrokeredLlmToolSpec>
): ReadonlyMap<string, BrokeredLlmToolOutputReduction> => {
  const outputReductions = new Map<string, BrokeredLlmToolOutputReduction>();
  for (const tool of tools) {
    if (tool.outputReduction) {
      outputReductions.set(tool.name, tool.outputReduction);
    }
  }
  return outputReductions;
};

const createJsonArrayReduction = (
  input: ToolOutputReducerInput,
  items: ReadonlyArray<unknown>
): ToolOutputReduction => {
  const lines: string[] = [
    `[Tool output reduced by json-array. Original estimate: ${input.sourceTokenEstimate} tokens. Total items: ${items.length}.]`
  ];
  const keys = collectArrayObjectKeys(items);
  if (keys.length > 0) {
    lines.push(`Common item keys: ${formatKeyList(keys)}`);
  }

  if (items.length === 0) {
    lines.push("Array was empty.");
    return createStructuredReduction(input, "json-array", lines.join("\n"));
  }

  const firstCount = clampSampleCount(input.outputReduction?.sampleFirst, 3);
  const lastCount = clampSampleCount(input.outputReduction?.sampleLast, 2);
  const first = items.slice(0, Math.min(firstCount, items.length));
  lines.push("First items:");
  first.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${boundedJson(summarizeJsonValue(item, 0, input.outputReduction?.preserveFields), 700)}`
    );
  });

  const lastStart = Math.max(first.length, items.length - lastCount);
  const last = items.slice(lastStart);
  if (last.length > 0) {
    lines.push("Last items:");
    last.forEach((item, index) => {
      lines.push(
        `${lastStart + index + 1}. ${boundedJson(summarizeJsonValue(item, 0, input.outputReduction?.preserveFields), 700)}`
      );
    });
  }

  return createStructuredReduction(input, "json-array", lines.join("\n"));
};

const createJsonObjectReduction = (
  input: ToolOutputReducerInput,
  value: Readonly<Record<string, unknown>>
): ToolOutputReduction => {
  const entries = Object.entries(value);
  const previewEntries = selectObjectEntries(value, input.outputReduction?.preserveFields, 20);
  const scalarEntries = previewEntries
    .filter(([, entryValue]) => isScalarJsonValue(entryValue))
    .slice(0, 12);
  const nestedEntries = previewEntries
    .filter(([, entryValue]) => !isScalarJsonValue(entryValue))
    .slice(0, 8);
  const lines: string[] = [
    `[Tool output reduced by json-object. Original estimate: ${input.sourceTokenEstimate} tokens.]`,
    `Top-level keys: ${formatKeyList(entries.map(([key]) => key))}`
  ];

  if (scalarEntries.length > 0) {
    lines.push("Scalar fields:");
    scalarEntries.forEach(([key, entryValue]) => {
      lines.push(
        `- ${key}: ${boundedJson(summarizeJsonValue(entryValue, 0, input.outputReduction?.preserveFields), 260)}`
      );
    });
  }

  if (nestedEntries.length > 0) {
    lines.push("Nested previews:");
    nestedEntries.forEach(([key, entryValue]) => {
      lines.push(
        `- ${key}: ${boundedJson(summarizeJsonValue(entryValue, 0, input.outputReduction?.preserveFields), 700)}`
      );
    });
  }

  return createStructuredReduction(input, "json-object", lines.join("\n"));
};

const createStructuredReduction = (
  input: ToolOutputReducerInput,
  reducer: string,
  text: string
): ToolOutputReduction => ({
  text,
  reducer,
  sourceTokenEstimate: input.sourceTokenEstimate,
  reducedTokenEstimate: input.estimator.estimateMessage({
    message: {
      ...input.message,
      text
    },
    provider: input.provider,
    model: input.model
  })
});

const parseJson = (text: string): unknown | undefined => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const isJsonObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isScalarJsonValue = (value: unknown): boolean =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

const collectArrayObjectKeys = (
  items: ReadonlyArray<unknown>
): ReadonlyArray<string> => {
  const keys = new Set<string>();
  for (const item of items.slice(0, 25)) {
    if (!isJsonObject(item)) {
      continue;
    }
    for (const key of Object.keys(item)) {
      keys.add(key);
      if (keys.size >= 18) {
        return Array.from(keys);
      }
    }
  }
  return Array.from(keys);
};

const formatKeyList = (
  keys: ReadonlyArray<string>,
  maxKeys = 18
): string => {
  if (keys.length === 0) {
    return "(none)";
  }
  if (keys.length <= maxKeys) {
    return keys.join(", ");
  }
  return `${keys.slice(0, maxKeys).join(", ")}, ... (${keys.length - maxKeys} more)`;
};

const summarizeJsonValue = (
  value: unknown,
  depth = 0,
  preserveFields?: ReadonlyArray<string>
): unknown => {
  if (typeof value === "string") {
    return abbreviate(value, 220);
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    const sampleLimit = depth >= 2 ? 1 : 2;
    return {
      type: "array",
      length: value.length,
      sample: value.slice(0, sampleLimit).map((item) => summarizeJsonValue(item, depth + 1, preserveFields))
    };
  }
  if (isJsonObject(value)) {
    const keys = Object.keys(value);
    const sampleEntries = selectObjectEntries(value, preserveFields, depth >= 2 ? 3 : 6);
    return {
      type: "object",
      keys: keys.slice(0, 12),
      sample: Object.fromEntries(
        sampleEntries.map(([key, entryValue]) => [
          key,
          summarizeJsonValue(entryValue, depth + 1, preserveFields)
        ])
      )
    };
  }
  return String(value);
};

const selectObjectEntries = (
  value: Readonly<Record<string, unknown>>,
  preserveFields: ReadonlyArray<string> | undefined,
  maxEntries: number
): ReadonlyArray<readonly [string, unknown]> => {
  const entries = Object.entries(value);
  if (!preserveFields?.length) {
    return entries.slice(0, maxEntries);
  }

  const selected: Array<readonly [string, unknown]> = [];
  const selectedKeys = new Set<string>();
  for (const field of preserveFields) {
    if (Object.hasOwn(value, field)) {
      selected.push([field, value[field]]);
      selectedKeys.add(field);
    }
    if (selected.length >= maxEntries) {
      return selected;
    }
  }

  for (const entry of entries) {
    if (selectedKeys.has(entry[0])) {
      continue;
    }
    selected.push(entry);
    if (selected.length >= maxEntries) {
      return selected;
    }
  }

  return selected;
};

const clampSampleCount = (
  value: number | undefined,
  fallback: number
): number => {
  if (value === undefined) {
    return fallback;
  }
  return Math.max(0, Math.min(10, value));
};

const boundedJson = (
  value: unknown,
  maxCharacters: number
): string => {
  const text = safeJson(value, 2);
  if (text.length <= maxCharacters) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxCharacters - 18))}... [truncated]`;
};

const abbreviate = (
  text: string,
  maxCharacters: number
): string => {
  if (text.length <= maxCharacters) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxCharacters - 18))}... [truncated]`;
};

const decisionForSegment = (
  segment: ContextSegment,
  reason: string,
  reducer?: string
): ContextAssemblyDecision => ({
  id: segment.id,
  kind: segment.kind,
  role: segment.messages.length === 1 ? segment.messages[0]?.role : undefined,
  estimatedTokens: segment.estimatedTokens,
  reason,
  ...(segment.sourceEventIds ? { sourceEventIds: segment.sourceEventIds } : {}),
  ...(segment.sourceMessageIds ? { sourceMessageIds: segment.sourceMessageIds } : {}),
  ...(reducer ?? segment.reducer ? { reducer: reducer ?? segment.reducer } : {}),
  ...(segment.pii ? { pii: segment.pii } : {})
});

const isSystemLikeSegment = (segment: ContextSegment): boolean =>
  segment.kind === "system" ||
  segment.kind === "developer" ||
  segment.kind === "memory_summary";

const findLastUserIndex = (messages: ReadonlyArray<BrokeredLlmMessage>): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }
  return -1;
};

const findLastSystemIndex = (messages: ReadonlyArray<BrokeredLlmMessage>): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "system") {
      return index;
    }
  }
  return -1;
};

const collectToolProtocolRun = (
  messages: ReadonlyArray<BrokeredLlmMessage>,
  startIndex: number
): {
  readonly messages: ReadonlyArray<BrokeredLlmMessage>;
  readonly callIds: ReadonlyArray<string>;
  readonly endIndex: number;
} => {
  const runMessages: BrokeredLlmMessage[] = [];
  const callIds: string[] = [];
  let index = startIndex;

  for (; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant" || !message.toolCallId || !message.toolName) {
      break;
    }
    runMessages.push(message);
    callIds.push(message.toolCallId);
  }

  const pendingCallIds = new Set(callIds);
  for (; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.role !== "tool" || !message.toolCallId || !pendingCallIds.has(message.toolCallId)) {
      break;
    }
    runMessages.push(message);
    pendingCallIds.delete(message.toolCallId);
  }

  return {
    messages: runMessages,
    callIds,
    endIndex: Math.max(startIndex, index - 1)
  };
};

const estimateRequestTokens = (
  request: BrokeredLlmRequest,
  estimator: TokenEstimator
): number =>
  sumMessageTokens(request.messages, estimator, request.provider, request.model) +
  estimateToolSpecTokens(request.tools ?? [], estimator, request.provider, request.model);

const estimateToolSpecTokens = (
  tools: ReadonlyArray<BrokeredLlmToolSpec>,
  estimator: TokenEstimator,
  provider: string | undefined,
  model: string | undefined
): number =>
  tools.reduce(
    (sum, tool) => sum + estimator.estimateToolSpec({ tool, provider, model }),
    0
  );

const estimateCacheablePrefixTokens = (
  messages: ReadonlyArray<BrokeredLlmMessage>,
  estimator: TokenEstimator,
  provider: string | undefined,
  model: string | undefined
): number => {
  const prefix: BrokeredLlmMessage[] = [];
  for (const message of messages) {
    if (message.role !== "system") {
      break;
    }
    prefix.push(message);
  }
  return sumMessageTokens(prefix, estimator, provider, model);
};

const sumMessageTokens = (
  messages: ReadonlyArray<BrokeredLlmMessage>,
  estimator: TokenEstimator,
  provider: string | undefined,
  model: string | undefined
): number =>
  messages.reduce(
    (sum, message) => sum + estimator.estimateMessage({ message, provider, model }),
    0
  );

const sumTokens = (segments: ReadonlyArray<ContextSegment>): number =>
  segments.reduce((sum, segment) => sum + segment.estimatedTokens, 0);

const estimateTextTokens = (text: string): number => {
  const trimmed = text.trim();
  return trimmed ? Math.max(1, Math.ceil(trimmed.length / 4)) : 0;
};

const truncateWithNotice = (
  text: string,
  maxTokens: number,
  notice: string,
  options?: {
    readonly minimumCharacters?: number;
  }
): string => {
  const maxChars = Math.max(options?.minimumCharacters ?? 80, maxTokens * 4);
  if (text.length <= maxChars) {
    return text;
  }

  const noticeText = `[${notice} Original characters: ${text.length}.]\n`;
  const remaining = Math.max(40, maxChars - noticeText.length);
  const headLength = Math.floor(remaining / 2);
  const tailLength = remaining - headLength;
  return `${noticeText}${text.slice(0, headLength)}\n[...omitted...]\n${text.slice(text.length - tailLength)}`;
};

const safeJson = (value: unknown, space?: number): string => {
  try {
    return JSON.stringify(value, null, space);
  } catch {
    return String(value);
  }
};
