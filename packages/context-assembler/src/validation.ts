import type {
  BrokeredLlmMessage,
  BrokeredLlmRequest
} from "./types.js";

export interface ContextProviderValidationResult {
  readonly status: "passed" | "failed";
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

export class ContextProviderValidationError extends Error {
  readonly name = "ContextProviderValidationError";

  constructor(readonly result: ContextProviderValidationResult) {
    super(`Context provider validation failed: ${result.errors.join("; ")}`);
  }
}

export const validateBrokeredLlmContext = (
  request: BrokeredLlmRequest
): ContextProviderValidationResult => {
  const generic = validateGenericBrokeredContext(request);
  const provider = normalizedProvider(request.provider);
  const providerResult = provider === "openrouter"
    ? validateOpenRouterResponsesContext(request)
    : PassedValidation;

  const errors = [...generic.errors, ...providerResult.errors];
  const warnings = [...generic.warnings, ...providerResult.warnings];
  return {
    status: errors.length > 0 ? "failed" : "passed",
    errors,
    warnings
  };
};

export const assertBrokeredLlmContextValid = (
  request: BrokeredLlmRequest
): ContextProviderValidationResult => {
  const result = validateBrokeredLlmContext(request);
  if (result.status === "failed") {
    throw new ContextProviderValidationError(result);
  }

  return result;
};

const PassedValidation: ContextProviderValidationResult = {
  status: "passed",
  errors: [],
  warnings: []
};

const validateGenericBrokeredContext = (
  request: BrokeredLlmRequest
): ContextProviderValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenToolCallIds = new Set<string>();
  const openToolCalls = new Map<string, BrokeredLlmMessage>();

  if (request.messages.length === 0) {
    errors.push("request must contain at least one message");
  }

  request.messages.forEach((message, index) => {
    if (!message.role) {
      errors.push(`message ${index} is missing a role`);
    }

    if (message.role === "assistant" && message.toolCallId) {
      if (!message.toolName) {
        errors.push(`assistant tool call message ${index} is missing toolName`);
      }
      if (seenToolCallIds.has(message.toolCallId)) {
        errors.push(`duplicate assistant tool call id: ${message.toolCallId}`);
      }
      seenToolCallIds.add(message.toolCallId);
      openToolCalls.set(message.toolCallId, message);
    }

    if (message.role === "tool") {
      if (!message.toolCallId) {
        errors.push(`tool output message ${index} is missing toolCallId`);
        return;
      }

      const call = openToolCalls.get(message.toolCallId);
      if (!call) {
        errors.push(`tool output message ${index} has no preceding assistant tool call: ${message.toolCallId}`);
        return;
      }

      if (message.toolName && call.toolName && message.toolName !== call.toolName) {
        errors.push(
          `tool output message ${index} toolName ${message.toolName} does not match assistant call ${call.toolName}`
        );
      }
    }
  });

  return {
    status: errors.length > 0 ? "failed" : "passed",
    errors,
    warnings
  };
};

const validateOpenRouterResponsesContext = (
  request: BrokeredLlmRequest
): ContextProviderValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(request.metadata ?? {})) {
    if (value === undefined || value === null) {
      warnings.push(`metadata ${key} is empty and will not be forwarded`);
      continue;
    }
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      warnings.push(`metadata ${key} is not a scalar and will not be forwarded`);
    }
  }

  return {
    status: errors.length > 0 ? "failed" : "passed",
    errors,
    warnings
  };
};

const normalizedProvider = (value: string | undefined): string =>
  value?.trim().toLowerCase() ?? "";
