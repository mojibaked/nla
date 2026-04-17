export const NLA_PROTOCOL_V1 = "nla/v1" as const;
export const NLA_THREADS_PROFILE_V1 = "nla-threads/v1" as const;

export type NlaProtocolVersion = typeof NLA_PROTOCOL_V1;
export type NlaThreadsProfileVersion = typeof NLA_THREADS_PROFILE_V1;

export type NlaTransportKind =
  | "stdio-jsonl"
  | "socket"
  | "websocket"
  | "http-stream"
  | "in-process"
  | string;

export type NlaRiskLevel =
  | "read"
  | "local-write"
  | "external-write"
  | "money"
  | "auth"
  | "secret"
  | "dangerous"
  | "unknown";

export type NlaInputKind =
  | "approval"
  | "choice"
  | "text"
  | "credential"
  | "account"
  | "disambiguation"
  | string;

export type NlaSessionStatus =
  | "idle"
  | "working"
  | "awaiting_input"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "stopped"
  | string;

export type NlaSessionExecutionState =
  | "idle"
  | "running"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "interrupted"
  | string;

export type NlaActivityStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | string;

export type NlaSessionInterruptStatus =
  | "interrupted"
  | "no_active_work"
  | "unsupported"
  | string;

export type NlaMessageRole = "user" | "assistant" | "system" | "tool" | string;

export interface NlaEnvelope<TType extends string = string, TData = unknown> {
  protocol: NlaProtocolVersion;
  type: TType;
  id?: string;
  correlationId?: string;
  timestamp?: string;
  data: TData;
}

export interface NlaHostIdentity {
  name: string;
  version?: string;
}

export interface NlaAdapterIdentity {
  id: string;
  name: string;
  version?: string;
}

export interface NlaCapabilities {
  invoke?: boolean;
  sessions?: boolean;
  streaming?: boolean;
  artifacts?: boolean;
  interactions?: boolean;
  history?: boolean;
  resources?: boolean;
  [key: string]: unknown;
}

export interface NlaOperationDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  risk?: NlaRiskLevel;
  metadata?: Record<string, unknown>;
}

export interface NlaInitializeData {
  host?: NlaHostIdentity;
  supportedProtocols?: string[];
  preferredTransport?: NlaTransportKind;
  profiles?: Record<string, unknown>;
}

export interface NlaInitializedData {
  adapter: NlaAdapterIdentity;
  capabilities?: NlaCapabilities;
  profiles?: Record<string, unknown>;
}

export interface NlaDiscoverData {
  includeSchemas?: boolean;
}

export interface NlaDiscoveredData {
  adapter: NlaAdapterIdentity;
  capabilities?: NlaCapabilities;
  profiles?: Record<string, unknown>;
  operations?: NlaOperationDescriptor[];
}

export interface NlaInvokeContext {
  cwd?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface NlaInvokeRequestData {
  operation: string;
  input?: unknown;
  context?: NlaInvokeContext;
}

export interface NlaInvokeOutputData {
  output?: unknown;
  metadata?: Record<string, unknown>;
}

export type NlaInvokeOutputDeltaMode =
  | "text"
  | "json-patch"
  | "bytes-base64"
  | string;

export interface NlaInvokeOutputDeltaData {
  streamId: string;
  seq: number;
  delta: unknown;
  mode?: NlaInvokeOutputDeltaMode;
  contentType?: string;
  metadata?: Record<string, unknown>;
}

export interface NlaInvokeProgressData {
  label?: string;
  progress?: number;
  data?: unknown;
}

export interface NlaInvokeLogData {
  level?: "debug" | "info" | "warn" | "error" | string;
  message: string;
  data?: unknown;
}

export interface NlaActivityData {
  activityId: string;
  kind?: string;
  title: string;
  status: NlaActivityStatus;
  data?: unknown;
}

export interface NlaArtifactData {
  artifactId: string;
  kind: string;
  title: string;
  mimeType?: string;
  uri?: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
}

export interface NlaCompletedData {
  ok: true;
  output?: unknown;
}

export interface NlaFailedData {
  ok: false;
  code?: string;
  message: string;
  retryable?: boolean;
  data?: unknown;
}

export interface NlaCancelledData {
  ok: false;
  reason?: string;
}

export interface NlaSessionStartData {
  sessionId: string;
  threadRef?: string;
  metadata?: Record<string, unknown>;
}

export interface NlaSessionResumeData {
  sessionId: string;
  providerRef?: string;
  threadRef?: string;
  state?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface NlaSessionMessagePart {
  type: string;
  text?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface NlaSessionMessageData {
  sessionId: string;
  role: NlaMessageRole;
  text?: string;
  parts?: NlaSessionMessagePart[];
  metadata?: Record<string, unknown>;
}

export interface NlaSessionMessageDeltaData {
  sessionId: string;
  messageId: string;
  role: NlaMessageRole;
  delta: string;
  metadata?: Record<string, unknown>;
}

export interface NlaInteractionPayload {
  kind: string;
  requestId: string;
  [key: string]: unknown;
}

export interface NlaSessionInteractionRequestedData {
  sessionId: string;
  request: NlaInteractionPayload;
}

export interface NlaSessionInteractionResolveData {
  sessionId: string;
  resolution: NlaInteractionPayload;
  metadata?: Record<string, unknown>;
}

export interface NlaSessionInteractionResolvedData {
  sessionId: string;
  resolution: NlaInteractionPayload;
}

export interface NlaSessionInterruptData {
  sessionId: string;
  turnId?: string;
  metadata?: Record<string, unknown>;
}

export interface NlaSessionInterruptResultData {
  sessionId: string;
  status: NlaSessionInterruptStatus;
  turnId?: string;
  message?: string;
  data?: unknown;
}

export interface NlaSessionStatusData {
  sessionId: string;
  status: NlaSessionStatus;
  label?: string;
  data?: unknown;
}

export interface NlaSessionExecutionData {
  sessionId: string;
  state: NlaSessionExecutionState;
  turnId?: string;
  interruptible: boolean;
  data?: unknown;
}

export interface NlaSessionStartedData {
  sessionId: string;
  providerRef?: string;
  threadRef?: string;
  state?: Record<string, unknown>;
}

export interface NlaSessionStoppedData {
  sessionId: string;
}

export interface NlaSessionControlData {
  sessionId: string;
  control: string;
  optionId?: string;
  value?: unknown;
  metadata?: Record<string, unknown>;
}

export interface NlaSessionControlStateData {
  sessionId: string;
  controlId: string;
  status?: string;
  optionId?: string;
  value?: unknown;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface NlaSessionControlOption {
  id: string;
  label: string;
  description?: string;
}

export interface NlaSessionControlConfirmation {
  title: string;
  body?: string;
  confirmLabel?: string;
}

export interface NlaSessionControlBase {
  id: string;
  label: string;
  description?: string;
  placement?: "header" | "sheet" | "overflow" | string;
  applyMode?: "immediate" | "next_turn" | "restart_session" | string;
  disabled?: boolean;
}

export interface NlaSessionSelectControl extends NlaSessionControlBase {
  kind: "select";
  value?: string;
  options: NlaSessionControlOption[];
}

export interface NlaSessionToggleControl extends NlaSessionControlBase {
  kind: "toggle";
  value: boolean;
  trueLabel?: string;
  falseLabel?: string;
}

export interface NlaSessionActionControl extends NlaSessionControlBase {
  kind: "action";
  style?: "default" | "destructive" | string;
  confirmation?: NlaSessionControlConfirmation;
}

export type NlaSessionControlDefinition =
  | NlaSessionSelectControl
  | NlaSessionToggleControl
  | NlaSessionActionControl;

export interface NlaSessionControlsGetData {
  sessionId: string;
  metadata?: Record<string, unknown>;
}

export interface NlaSessionControlsData {
  sessionId: string;
  controls: NlaSessionControlDefinition[];
}

export interface NlaThreadsProfileCapabilities {
  list?: boolean;
  get?: boolean;
  history?: boolean;
  attach?: boolean;
  [key: string]: unknown;
}

export interface NlaThreadScope {
  cwd?: string;
  cwdRootId?: string;
  cwdPath?: string;
  includeAllDirectories?: boolean;
  metadata?: Record<string, unknown>;
}

export interface NlaThreadSummaryData {
  threadRef: string;
  sessionId?: string;
  title?: string;
  summary?: string;
  firstPrompt?: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
  metadata?: Record<string, unknown>;
}

export interface NlaThreadsListRequestData {
  limit?: number;
  cursor?: string;
  scope?: NlaThreadScope;
}

export interface NlaThreadsListCompletedData {
  nextCursor?: string;
}

export interface NlaThreadsGetRequestData {
  threadRef: string;
}

export interface NlaThreadsHistoryRequestData {
  threadRef: string;
  limit?: number;
  cursor?: string;
}

export interface NlaThreadsHistoryItemData {
  itemId?: string;
  kind: string;
  role?: NlaMessageRole;
  text?: string;
  parts?: NlaSessionMessagePart[];
  event?: string;
  callId?: string;
  toolName?: string;
  summary?: string;
  changes?: unknown;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export type NlaInitializeMessage = NlaEnvelope<"initialize", NlaInitializeData>;
export type NlaInitializedMessage = NlaEnvelope<"initialized", NlaInitializedData>;
export type NlaDiscoverMessage = NlaEnvelope<"discover", NlaDiscoverData>;
export type NlaDiscoveredMessage = NlaEnvelope<"discovered", NlaDiscoveredData>;

export type NlaInvokeRequestMessage = NlaEnvelope<"invoke.request", NlaInvokeRequestData>;
export type NlaInvokeOutputMessage = NlaEnvelope<"invoke.output", NlaInvokeOutputData>;
export type NlaInvokeOutputDeltaMessage = NlaEnvelope<"invoke.output.delta", NlaInvokeOutputDeltaData>;
export type NlaInvokeProgressMessage = NlaEnvelope<"invoke.progress", NlaInvokeProgressData>;
export type NlaInvokeLogMessage = NlaEnvelope<"invoke.log", NlaInvokeLogData>;
export type NlaInvokeActivityMessage = NlaEnvelope<"invoke.activity", NlaActivityData>;
export type NlaInvokeArtifactMessage = NlaEnvelope<"invoke.artifact", NlaArtifactData>;
export type NlaInvokeCompletedMessage = NlaEnvelope<"invoke.completed", NlaCompletedData>;
export type NlaInvokeFailedMessage = NlaEnvelope<"invoke.failed", NlaFailedData>;
export type NlaInvokeCancelledMessage = NlaEnvelope<"invoke.cancelled", NlaCancelledData>;

export type NlaSessionStartMessage = NlaEnvelope<"session.start", NlaSessionStartData>;
export type NlaSessionResumeMessage = NlaEnvelope<"session.resume", NlaSessionResumeData>;
export type NlaSessionMessage = NlaEnvelope<"session.message", NlaSessionMessageData>;
export type NlaSessionMessageDelta = NlaEnvelope<"session.message.delta", NlaSessionMessageDeltaData>;
export type NlaSessionActivityMessage = NlaEnvelope<"session.activity", NlaActivityData>;
export type NlaSessionArtifactMessage = NlaEnvelope<"session.artifact", NlaArtifactData>;
export type NlaSessionInteractionRequestedMessage = NlaEnvelope<"session.interaction.requested", NlaSessionInteractionRequestedData>;
export type NlaSessionInteractionResolveMessage = NlaEnvelope<"session.interaction.resolve", NlaSessionInteractionResolveData>;
export type NlaSessionInteractionResolvedMessage = NlaEnvelope<"session.interaction.resolved", NlaSessionInteractionResolvedData>;
export type NlaSessionInterruptMessage = NlaEnvelope<"session.interrupt", NlaSessionInterruptData>;
export type NlaSessionInterruptResultMessage = NlaEnvelope<"session.interrupt.result", NlaSessionInterruptResultData>;
export type NlaSessionStatusMessage = NlaEnvelope<"session.status", NlaSessionStatusData>;
export type NlaSessionExecutionMessage = NlaEnvelope<"session.execution", NlaSessionExecutionData>;
export type NlaSessionStartedMessage = NlaEnvelope<"session.started", NlaSessionStartedData>;
export type NlaSessionControlsGetMessage = NlaEnvelope<"session.controls.get", NlaSessionControlsGetData>;
export type NlaSessionControlsMessage = NlaEnvelope<"session.controls", NlaSessionControlsData>;
export type NlaSessionControlMessage = NlaEnvelope<"session.control", NlaSessionControlData>;
export type NlaSessionControlStateMessage = NlaEnvelope<"session.control.state", NlaSessionControlStateData>;
export type NlaSessionStopMessage = NlaEnvelope<"session.stop", { sessionId: string }>;
export type NlaSessionCompletedMessage = NlaEnvelope<"session.completed", { sessionId: string }>;
export type NlaSessionFailedMessage = NlaEnvelope<"session.failed", NlaFailedData & { sessionId: string }>;
export type NlaSessionStoppedMessage = NlaEnvelope<"session.stopped", NlaSessionStoppedData>;

export type NlaThreadsListRequestMessage = NlaEnvelope<"threads.list.request", NlaThreadsListRequestData>;
export type NlaThreadsListItemMessage = NlaEnvelope<"threads.list.item", NlaThreadSummaryData>;
export type NlaThreadsListCompletedMessage = NlaEnvelope<"threads.list.completed", NlaThreadsListCompletedData>;
export type NlaThreadsListFailedMessage = NlaEnvelope<"threads.list.failed", NlaFailedData>;
export type NlaThreadsGetRequestMessage = NlaEnvelope<"threads.get.request", NlaThreadsGetRequestData>;
export type NlaThreadsGetOutputMessage = NlaEnvelope<"threads.get.output", NlaThreadSummaryData>;
export type NlaThreadsGetFailedMessage = NlaEnvelope<"threads.get.failed", NlaFailedData>;
export type NlaThreadsHistoryRequestMessage = NlaEnvelope<"threads.history.request", NlaThreadsHistoryRequestData>;
export type NlaThreadsHistoryItemMessage = NlaEnvelope<"threads.history.item", NlaThreadsHistoryItemData>;
export type NlaThreadsHistoryCompletedMessage = NlaEnvelope<"threads.history.completed", NlaThreadsListCompletedData>;
export type NlaThreadsHistoryFailedMessage = NlaEnvelope<"threads.history.failed", NlaFailedData>;

export type NlaMessage =
  | NlaInitializeMessage
  | NlaInitializedMessage
  | NlaDiscoverMessage
  | NlaDiscoveredMessage
  | NlaInvokeRequestMessage
  | NlaInvokeOutputMessage
  | NlaInvokeOutputDeltaMessage
  | NlaInvokeProgressMessage
  | NlaInvokeLogMessage
  | NlaInvokeActivityMessage
  | NlaInvokeArtifactMessage
  | NlaInvokeCompletedMessage
  | NlaInvokeFailedMessage
  | NlaInvokeCancelledMessage
  | NlaSessionStartMessage
  | NlaSessionResumeMessage
  | NlaSessionMessage
  | NlaSessionMessageDelta
  | NlaSessionActivityMessage
  | NlaSessionArtifactMessage
  | NlaSessionInteractionRequestedMessage
  | NlaSessionInteractionResolveMessage
  | NlaSessionInteractionResolvedMessage
  | NlaSessionInterruptMessage
  | NlaSessionInterruptResultMessage
  | NlaSessionStatusMessage
  | NlaSessionExecutionMessage
  | NlaSessionStartedMessage
  | NlaSessionControlsGetMessage
  | NlaSessionControlsMessage
  | NlaSessionControlMessage
  | NlaSessionControlStateMessage
  | NlaSessionStopMessage
  | NlaSessionCompletedMessage
  | NlaSessionFailedMessage
  | NlaSessionStoppedMessage
  | NlaThreadsListRequestMessage
  | NlaThreadsListItemMessage
  | NlaThreadsListCompletedMessage
  | NlaThreadsListFailedMessage
  | NlaThreadsGetRequestMessage
  | NlaThreadsGetOutputMessage
  | NlaThreadsGetFailedMessage
  | NlaThreadsHistoryRequestMessage
  | NlaThreadsHistoryItemMessage
  | NlaThreadsHistoryCompletedMessage
  | NlaThreadsHistoryFailedMessage;

export interface NlaValidationIssue {
  path: string;
  message: string;
}

export type NlaValidationResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      errors: NlaValidationIssue[];
    };

export function createEnvelope<TType extends string, TData>(
  type: TType,
  data: TData,
  options: Omit<NlaEnvelope<TType, TData>, "protocol" | "type" | "data"> = {}
): NlaEnvelope<TType, TData> {
  return {
    protocol: NLA_PROTOCOL_V1,
    type,
    data,
    ...options
  };
}

export function isNlaEnvelope(value: unknown): value is NlaEnvelope {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.protocol === NLA_PROTOCOL_V1 && typeof record.type === "string" && "data" in record;
}

export function validateNlaMessage(value: unknown): NlaValidationResult<NlaMessage> {
  const errors: NlaValidationIssue[] = [];
  const envelope = asRecord(value, "", errors);
  if (!envelope) return { ok: false, errors };

  if (envelope.protocol !== NLA_PROTOCOL_V1) {
    errors.push({
      path: "protocol",
      message: `Expected ${NLA_PROTOCOL_V1}.`
    });
  }

  optionalString(envelope, "id", errors, "id");
  optionalString(envelope, "correlationId", errors, "correlationId");
  optionalString(envelope, "timestamp", errors, "timestamp");

  const type = requiredString(envelope, "type", errors, "type");
  const data = asRecord(envelope.data, "data", errors);
  if (!type || !data) {
    return { ok: false, errors };
  }

  switch (type) {
    case "initialize":
      validateInitializeData(data, errors, "data");
      break;
    case "initialized":
      validateInitializedData(data, errors, "data");
      break;
    case "discover":
      validateDiscoverData(data, errors, "data");
      break;
    case "discovered":
      validateDiscoveredData(data, errors, "data");
      break;
    case "invoke.request":
      validateInvokeRequestData(data, errors, "data");
      break;
    case "invoke.output":
      validateInvokeOutputData(data, errors, "data");
      break;
    case "invoke.output.delta":
      validateInvokeOutputDeltaData(data, errors, "data");
      break;
    case "invoke.progress":
      validateInvokeProgressData(data, errors, "data");
      break;
    case "invoke.log":
      validateInvokeLogData(data, errors, "data");
      break;
    case "invoke.activity":
    case "session.activity":
      validateActivityData(data, errors, "data");
      break;
    case "invoke.artifact":
    case "session.artifact":
      validateArtifactData(data, errors, "data");
      break;
    case "invoke.completed":
      validateCompletedData(data, errors, "data");
      break;
    case "invoke.failed":
      validateFailedData(data, errors, "data");
      break;
    case "invoke.cancelled":
      validateCancelledData(data, errors, "data");
      break;
    case "session.start":
      validateSessionStartData(data, errors, "data");
      break;
    case "session.resume":
      validateSessionResumeData(data, errors, "data");
      break;
    case "session.message":
      validateSessionMessageData(data, errors, "data");
      break;
    case "session.message.delta":
      validateSessionMessageDeltaData(data, errors, "data");
      break;
    case "session.interaction.requested":
      validateSessionInteractionRequestedData(data, errors, "data");
      break;
    case "session.interaction.resolve":
      validateSessionInteractionResolveData(data, errors, "data");
      break;
    case "session.interaction.resolved":
      validateSessionInteractionResolvedData(data, errors, "data");
      break;
    case "session.interrupt":
      validateSessionInterruptData(data, errors, "data");
      break;
    case "session.interrupt.result":
      validateSessionInterruptResultData(data, errors, "data");
      break;
    case "session.status":
      validateSessionStatusData(data, errors, "data");
      break;
    case "session.execution":
      validateSessionExecutionData(data, errors, "data");
      break;
    case "session.started":
      validateSessionStartedData(data, errors, "data");
      break;
    case "session.controls.get":
      validateSessionControlsGetData(data, errors, "data");
      break;
    case "session.controls":
      validateSessionControlsData(data, errors, "data");
      break;
    case "session.control":
      validateSessionControlData(data, errors, "data");
      break;
    case "session.control.state":
      validateSessionControlStateData(data, errors, "data");
      break;
    case "session.stop":
    case "session.completed":
    case "session.stopped":
      validateSessionOnlyData(data, errors, "data");
      break;
    case "session.failed":
      validateSessionOnlyData(data, errors, "data");
      validateFailedData(data, errors, "data");
      break;
    case "threads.list.request":
      validateThreadsListRequestData(data, errors, "data");
      break;
    case "threads.list.item":
    case "threads.get.output":
      validateThreadSummaryData(data, errors, "data");
      break;
    case "threads.list.completed":
    case "threads.history.completed":
      validateThreadsListCompletedData(data, errors, "data");
      break;
    case "threads.list.failed":
    case "threads.get.failed":
    case "threads.history.failed":
      validateFailedData(data, errors, "data");
      break;
    case "threads.get.request":
      validateThreadsGetRequestData(data, errors, "data");
      break;
    case "threads.history.request":
      validateThreadsHistoryRequestData(data, errors, "data");
      break;
    case "threads.history.item":
      validateThreadsHistoryItemData(data, errors, "data");
      break;
    default:
      errors.push({
        path: "type",
        message: `Unknown NLA message type: ${type}.`
      });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors
    };
  }

  return {
    ok: true,
    value: value as NlaMessage
  };
}

export function assertValidNlaMessage(value: unknown): asserts value is NlaMessage {
  const result = validateNlaMessage(value);
  if (!result.ok) {
    throw new Error(`Invalid NLA message: ${formatValidationIssues(result.errors)}`);
  }
}

export function formatValidationIssues(errors: readonly NlaValidationIssue[]): string {
  return errors
    .map((error) => `${error.path || "<root>"} ${error.message}`.trim())
    .join("; ");
}

function validateInitializeData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  const host = optionalRecord(data, "host", errors, `${path}.host`);
  if (host) {
    requiredString(host, "name", errors, `${path}.host.name`);
    optionalString(host, "version", errors, `${path}.host.version`);
  }

  const protocols = data.supportedProtocols;
  if (protocols !== undefined) {
    if (!Array.isArray(protocols)) {
      errors.push({
        path: `${path}.supportedProtocols`,
        message: "Expected an array of strings."
      });
    } else {
      for (let index = 0; index < protocols.length; index += 1) {
        if (typeof protocols[index] !== "string") {
          errors.push({
            path: `${path}.supportedProtocols[${index}]`,
            message: "Expected a string."
          });
        }
      }
    }
  }

  optionalString(data, "preferredTransport", errors, `${path}.preferredTransport`);
  optionalRecord(data, "profiles", errors, `${path}.profiles`);
}

function validateInitializedData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  const adapter = asRecord(data.adapter, `${path}.adapter`, errors);
  if (adapter) validateAdapterIdentity(adapter, errors, `${path}.adapter`);
  optionalRecord(data, "capabilities", errors, `${path}.capabilities`);
  optionalRecord(data, "profiles", errors, `${path}.profiles`);
}

function validateDiscoverData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  optionalBoolean(data, "includeSchemas", errors, `${path}.includeSchemas`);
}

function validateDiscoveredData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  const adapter = asRecord(data.adapter, `${path}.adapter`, errors);
  if (adapter) validateAdapterIdentity(adapter, errors, `${path}.adapter`);
  optionalRecord(data, "capabilities", errors, `${path}.capabilities`);
  optionalRecord(data, "profiles", errors, `${path}.profiles`);

  const operations = data.operations;
  if (operations === undefined) return;
  if (!Array.isArray(operations)) {
    errors.push({
      path: `${path}.operations`,
      message: "Expected an array."
    });
    return;
  }

  for (let index = 0; index < operations.length; index += 1) {
    const operation = asRecord(operations[index], `${path}.operations[${index}]`, errors);
    if (!operation) continue;
    requiredString(operation, "name", errors, `${path}.operations[${index}].name`);
    optionalString(operation, "description", errors, `${path}.operations[${index}].description`);
    optionalRecord(operation, "inputSchema", errors, `${path}.operations[${index}].inputSchema`);
    optionalRecord(operation, "outputSchema", errors, `${path}.operations[${index}].outputSchema`);
    optionalString(operation, "risk", errors, `${path}.operations[${index}].risk`);
    optionalRecord(operation, "metadata", errors, `${path}.operations[${index}].metadata`);
  }
}

function validateInvokeRequestData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "operation", errors, `${path}.operation`);
  const context = optionalRecord(data, "context", errors, `${path}.context`);
  if (!context) return;
  optionalString(context, "cwd", errors, `${path}.context.cwd`);
  optionalString(context, "sessionId", errors, `${path}.context.sessionId`);
  optionalRecord(context, "metadata", errors, `${path}.context.metadata`);
}

function validateInvokeOutputData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  optionalRecord(data, "metadata", errors, `${path}.metadata`);
}

function validateInvokeOutputDeltaData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "streamId", errors, `${path}.streamId`);
  requiredNumber(data, "seq", errors, `${path}.seq`);
  optionalString(data, "mode", errors, `${path}.mode`);
  optionalString(data, "contentType", errors, `${path}.contentType`);
  optionalRecord(data, "metadata", errors, `${path}.metadata`);
}

function validateInvokeProgressData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  optionalString(data, "label", errors, `${path}.label`);
  optionalNumber(data, "progress", errors, `${path}.progress`);
}

function validateInvokeLogData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "message", errors, `${path}.message`);
  optionalString(data, "level", errors, `${path}.level`);
}

function validateActivityData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "activityId", errors, `${path}.activityId`);
  optionalString(data, "kind", errors, `${path}.kind`);
  requiredString(data, "title", errors, `${path}.title`);
  requiredString(data, "status", errors, `${path}.status`);
}

function validateArtifactData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "artifactId", errors, `${path}.artifactId`);
  requiredString(data, "kind", errors, `${path}.kind`);
  requiredString(data, "title", errors, `${path}.title`);
  optionalString(data, "mimeType", errors, `${path}.mimeType`);
  optionalString(data, "uri", errors, `${path}.uri`);
  optionalRecord(data, "metadata", errors, `${path}.metadata`);
}

function validateCompletedData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  const ok = data.ok;
  if (ok !== undefined && ok !== true) {
    errors.push({
      path: `${path}.ok`,
      message: "Expected true."
    });
  }
}

function validateFailedData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  const ok = data.ok;
  if (ok !== undefined && ok !== false) {
    errors.push({
      path: `${path}.ok`,
      message: "Expected false."
    });
  }
  optionalString(data, "code", errors, `${path}.code`);
  requiredString(data, "message", errors, `${path}.message`);
  optionalBoolean(data, "retryable", errors, `${path}.retryable`);
}

function validateCancelledData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  const ok = data.ok;
  if (ok !== undefined && ok !== false) {
    errors.push({
      path: `${path}.ok`,
      message: "Expected false."
    });
  }
  optionalString(data, "reason", errors, `${path}.reason`);
}

function validateSessionStartData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);
  optionalString(data, "threadRef", errors, `${path}.threadRef`);
  optionalRecord(data, "metadata", errors, `${path}.metadata`);
}

function validateSessionResumeData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);
  optionalString(data, "providerRef", errors, `${path}.providerRef`);
  optionalString(data, "threadRef", errors, `${path}.threadRef`);
  optionalRecord(data, "state", errors, `${path}.state`);
  optionalRecord(data, "metadata", errors, `${path}.metadata`);
}

function validateSessionMessageData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);
  requiredString(data, "role", errors, `${path}.role`);
  optionalString(data, "text", errors, `${path}.text`);
  optionalRecord(data, "metadata", errors, `${path}.metadata`);

  const parts = data.parts;
  if (parts === undefined) return;
  if (!Array.isArray(parts)) {
    errors.push({
      path: `${path}.parts`,
      message: "Expected an array."
    });
    return;
  }

  for (let index = 0; index < parts.length; index += 1) {
    const part = asRecord(parts[index], `${path}.parts[${index}]`, errors);
    if (!part) continue;
    requiredString(part, "type", errors, `${path}.parts[${index}].type`);
    optionalString(part, "text", errors, `${path}.parts[${index}].text`);
  }
}

function validateSessionMessageDeltaData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);
  requiredString(data, "messageId", errors, `${path}.messageId`);
  requiredString(data, "role", errors, `${path}.role`);
  requiredString(data, "delta", errors, `${path}.delta`);
  optionalRecord(data, "metadata", errors, `${path}.metadata`);
}

function validateSessionInteractionRequestedData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);
  const request = asRecord(data.request, `${path}.request`, errors);
  if (!request) {
    return;
  }
  requiredString(request, "kind", errors, `${path}.request.kind`);
  requiredString(request, "requestId", errors, `${path}.request.requestId`);
}

function validateSessionInteractionResolveData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);
  const resolution = asRecord(data.resolution, `${path}.resolution`, errors);
  if (!resolution) {
    return;
  }
  requiredString(resolution, "kind", errors, `${path}.resolution.kind`);
  requiredString(resolution, "requestId", errors, `${path}.resolution.requestId`);
  optionalRecord(data, "metadata", errors, `${path}.metadata`);
}

function validateSessionInteractionResolvedData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);
  const resolution = asRecord(data.resolution, `${path}.resolution`, errors);
  if (!resolution) {
    return;
  }
  requiredString(resolution, "kind", errors, `${path}.resolution.kind`);
  requiredString(resolution, "requestId", errors, `${path}.resolution.requestId`);
}

function validateSessionInterruptData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);
  optionalString(data, "turnId", errors, `${path}.turnId`);
  optionalRecord(data, "metadata", errors, `${path}.metadata`);
}

function validateSessionInterruptResultData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);
  requiredString(data, "status", errors, `${path}.status`);
  optionalString(data, "turnId", errors, `${path}.turnId`);
  optionalString(data, "message", errors, `${path}.message`);
}

function validateSessionStatusData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);
  requiredString(data, "status", errors, `${path}.status`);
  optionalString(data, "label", errors, `${path}.label`);
}

function validateSessionExecutionData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);
  requiredString(data, "state", errors, `${path}.state`);
  optionalString(data, "turnId", errors, `${path}.turnId`);
  requiredBoolean(data, "interruptible", errors, `${path}.interruptible`);
}

function validateSessionStartedData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);
  optionalString(data, "providerRef", errors, `${path}.providerRef`);
  optionalString(data, "threadRef", errors, `${path}.threadRef`);
  optionalRecord(data, "state", errors, `${path}.state`);
}

function validateSessionControlsGetData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);
  optionalRecord(data, "metadata", errors, `${path}.metadata`);
}

function validateSessionControlsData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);

  const controls = data.controls;
  if (!Array.isArray(controls)) {
    errors.push({
      path: `${path}.controls`,
      message: "Expected an array."
    });
    return;
  }

  for (let index = 0; index < controls.length; index += 1) {
    const control = asRecord(controls[index], `${path}.controls[${index}]`, errors);
    if (!control) continue;
    validateSessionControlDefinition(control, errors, `${path}.controls[${index}]`);
  }
}

function validateSessionControlData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);
  requiredString(data, "control", errors, `${path}.control`);
  optionalString(data, "optionId", errors, `${path}.optionId`);
  optionalRecord(data, "metadata", errors, `${path}.metadata`);
}

function validateSessionControlStateData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);
  requiredString(data, "controlId", errors, `${path}.controlId`);
  optionalString(data, "status", errors, `${path}.status`);
  optionalString(data, "optionId", errors, `${path}.optionId`);
  optionalString(data, "label", errors, `${path}.label`);
  optionalRecord(data, "metadata", errors, `${path}.metadata`);
}

function validateSessionControlDefinition(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "id", errors, `${path}.id`);
  requiredString(data, "label", errors, `${path}.label`);
  optionalString(data, "description", errors, `${path}.description`);
  optionalString(data, "placement", errors, `${path}.placement`);
  optionalString(data, "applyMode", errors, `${path}.applyMode`);
  optionalBoolean(data, "disabled", errors, `${path}.disabled`);

  const kind = requiredString(data, "kind", errors, `${path}.kind`);
  if (!kind) {
    return;
  }

  switch (kind) {
    case "select": {
      optionalString(data, "value", errors, `${path}.value`);
      const options = data.options;
      if (!Array.isArray(options)) {
        errors.push({
          path: `${path}.options`,
          message: "Expected an array."
        });
        return;
      }

      for (let index = 0; index < options.length; index += 1) {
        const option = asRecord(options[index], `${path}.options[${index}]`, errors);
        if (!option) continue;
        requiredString(option, "id", errors, `${path}.options[${index}].id`);
        requiredString(option, "label", errors, `${path}.options[${index}].label`);
        optionalString(option, "description", errors, `${path}.options[${index}].description`);
      }
      return;
    }
    case "toggle":
      requiredBoolean(data, "value", errors, `${path}.value`);
      optionalString(data, "trueLabel", errors, `${path}.trueLabel`);
      optionalString(data, "falseLabel", errors, `${path}.falseLabel`);
      return;
    case "action": {
      optionalString(data, "style", errors, `${path}.style`);
      const confirmation = optionalRecord(data, "confirmation", errors, `${path}.confirmation`);
      if (!confirmation) {
        return;
      }
      requiredString(confirmation, "title", errors, `${path}.confirmation.title`);
      optionalString(confirmation, "body", errors, `${path}.confirmation.body`);
      optionalString(confirmation, "confirmLabel", errors, `${path}.confirmation.confirmLabel`);
      return;
    }
    default:
      errors.push({
        path: `${path}.kind`,
        message: `Unknown session control kind: ${kind}.`
      });
  }
}

function validateSessionOnlyData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "sessionId", errors, `${path}.sessionId`);
}

function validateThreadsListRequestData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  optionalNumber(data, "limit", errors, `${path}.limit`);
  optionalString(data, "cursor", errors, `${path}.cursor`);
  const scope = optionalRecord(data, "scope", errors, `${path}.scope`);
  if (!scope) return;
  optionalString(scope, "cwd", errors, `${path}.scope.cwd`);
  optionalString(scope, "cwdRootId", errors, `${path}.scope.cwdRootId`);
  optionalString(scope, "cwdPath", errors, `${path}.scope.cwdPath`);
  optionalBoolean(scope, "includeAllDirectories", errors, `${path}.scope.includeAllDirectories`);
  optionalRecord(scope, "metadata", errors, `${path}.scope.metadata`);
}

function validateThreadSummaryData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "threadRef", errors, `${path}.threadRef`);
  optionalString(data, "sessionId", errors, `${path}.sessionId`);
  optionalString(data, "title", errors, `${path}.title`);
  optionalString(data, "summary", errors, `${path}.summary`);
  optionalString(data, "firstPrompt", errors, `${path}.firstPrompt`);
  optionalString(data, "createdAt", errors, `${path}.createdAt`);
  optionalString(data, "updatedAt", errors, `${path}.updatedAt`);
  optionalNumber(data, "messageCount", errors, `${path}.messageCount`);
  optionalRecord(data, "metadata", errors, `${path}.metadata`);
}

function validateThreadsListCompletedData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  optionalString(data, "nextCursor", errors, `${path}.nextCursor`);
}

function validateThreadsGetRequestData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "threadRef", errors, `${path}.threadRef`);
}

function validateThreadsHistoryRequestData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "threadRef", errors, `${path}.threadRef`);
  optionalNumber(data, "limit", errors, `${path}.limit`);
  optionalString(data, "cursor", errors, `${path}.cursor`);
}

function validateThreadsHistoryItemData(
  data: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(data, "kind", errors, `${path}.kind`);
  optionalString(data, "itemId", errors, `${path}.itemId`);
  optionalString(data, "role", errors, `${path}.role`);
  optionalString(data, "text", errors, `${path}.text`);
  optionalString(data, "event", errors, `${path}.event`);
  optionalString(data, "callId", errors, `${path}.callId`);
  optionalString(data, "toolName", errors, `${path}.toolName`);
  optionalString(data, "summary", errors, `${path}.summary`);
  optionalString(data, "createdAt", errors, `${path}.createdAt`);
  optionalRecord(data, "metadata", errors, `${path}.metadata`);

  const parts = data.parts;
  if (parts === undefined) return;
  if (!Array.isArray(parts)) {
    errors.push({
      path: `${path}.parts`,
      message: "Expected an array."
    });
    return;
  }

  for (let index = 0; index < parts.length; index += 1) {
    const part = asRecord(parts[index], `${path}.parts[${index}]`, errors);
    if (!part) continue;
    requiredString(part, "type", errors, `${path}.parts[${index}].type`);
    optionalString(part, "text", errors, `${path}.parts[${index}].text`);
  }
}

function validateAdapterIdentity(
  adapter: Record<string, unknown>,
  errors: NlaValidationIssue[],
  path: string
): void {
  requiredString(adapter, "id", errors, `${path}.id`);
  requiredString(adapter, "name", errors, `${path}.name`);
  optionalString(adapter, "version", errors, `${path}.version`);
}

function asRecord(
  value: unknown,
  path: string,
  errors: NlaValidationIssue[]
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push({
      path,
      message: "Expected an object."
    });
    return undefined;
  }
  return value as Record<string, unknown>;
}

function optionalRecord(
  record: Record<string, unknown>,
  key: string,
  errors: NlaValidationIssue[],
  path: string
): Record<string, unknown> | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  return asRecord(value, path, errors);
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  errors: NlaValidationIssue[],
  path: string
): string | undefined {
  const value = record[key];
  if (typeof value === "string") return value;
  errors.push({
    path,
    message: "Expected a string."
  });
  return undefined;
}

function requiredNumber(
  record: Record<string, unknown>,
  key: string,
  errors: NlaValidationIssue[],
  path: string
): number | undefined {
  const value = record[key];
  if (typeof value === "number") return value;
  errors.push({
    path,
    message: "Expected a number."
  });
  return undefined;
}

function requiredBoolean(
  record: Record<string, unknown>,
  key: string,
  errors: NlaValidationIssue[],
  path: string
): boolean | undefined {
  const value = record[key];
  if (typeof value === "boolean") return value;
  errors.push({
    path,
    message: "Expected a boolean."
  });
  return undefined;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  errors: NlaValidationIssue[],
  path: string
): void {
  const value = record[key];
  if (value === undefined || typeof value === "string") return;
  errors.push({
    path,
    message: "Expected a string."
  });
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  errors: NlaValidationIssue[],
  path: string
): void {
  const value = record[key];
  if (value === undefined || typeof value === "boolean") return;
  errors.push({
    path,
    message: "Expected a boolean."
  });
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  errors: NlaValidationIssue[],
  path: string
): void {
  const value = record[key];
  if (value === undefined || typeof value === "number") return;
  errors.push({
    path,
    message: "Expected a number."
  });
}
