# NLA Protocol

Status: draft  
Version target: `nla/v1`

## Overview

NLA is a transport-independent protocol for exposing software surfaces through a
consistent, structured, natural-language-friendly interface.

An NLA adapter can sit in front of:

- a CLI
- an HTTP API
- an MCP server
- a local SDK
- a long-lived agent runtime

The protocol should support both:

1. single request/response style invocation
2. long-lived conversational or resumable sessions

## Design Principles

- Keep the core envelope small.
- Prefer explicit capabilities over implicit behavior.
- Preserve structured input and output.
- Make streaming a first-class concern.
- Make approvals and side effects explicit.
- Keep transports replaceable.
- Keep host-specific behavior out of the base protocol.

## Terms

### Host

The system that launches, embeds, or connects to an NLA adapter.

Examples:

- a desktop app
- a terminal UI
- a web service
- a mobile companion
- another agent runtime
- an LLM-backed adapter that wraps a hosted chat completion API

### Provider

Software that speaks the NLA protocol directly.

### Foreign Adapter

A wrapper that translates another surface into NLA.

Examples:

- wrapping a CLI with structured command schemas
- wrapping an HTTP API behind natural-language-oriented operations
- wrapping an MCP server behind a host-specific session model

### Invocation

A single logical request with correlated outputs, events, and completion.

### Session

A long-lived interaction context that can receive multiple messages or commands
over time.

### Artifact

A durable output produced during execution.

Examples:

- JSON result payload
- file
- report
- image
- transcript

### Input Request

A structured request from adapter to host asking for missing information,
confirmation, credentials, or approval.

## Protocol Layers

NLA is split into three layers.

### 1. Envelope Layer

Every message has a versioned type and a structured payload.

### 2. Capability Layer

The adapter declares what it supports.

Examples:

- invocation
- sessions
- streaming
- artifacts
- approvals
- history
- resources

### 3. Profile Layer

Higher-level interaction patterns are grouped into profiles.

Initial profiles:

- core invoke profile
- session profile
- artifact profile
- approval/input profile
- optional `nla-threads/v1` profile for provider-native saved threads

## Transport

The base protocol is transport-agnostic.

Possible wire implementations:

- stdio JSONL
- local sockets
- websocket
- HTTP streaming
- in-process function calls

`nla/v1` defines message semantics, not a single mandatory wire format.

One practical HTTP mapping is:

- `POST` one request envelope as JSON
- stream response envelopes back as newline-delimited JSON

## Base Envelope

Every protocol message should be representable as:

```json
{
  "protocol": "nla/v1",
  "type": "invoke.request",
  "id": "msg_123",
  "correlationId": "inv_123",
  "timestamp": "2026-04-14T00:00:00.000Z",
  "data": {}
}
```

Suggested fields:

- `protocol`: protocol version string
- `type`: message type
- `id`: unique message id
- `correlationId`: logical operation or session correlation id
- `timestamp`: optional ISO timestamp
- `data`: message payload

Hosts and providers may omit fields that are not required by a particular wire
implementation, but the semantic model should remain consistent.

## Initialization

Before normal traffic, the host and adapter should establish compatibility.

### Host -> Adapter

`initialize`

Suggested payload:

```json
{
  "protocol": "nla/v1",
  "type": "initialize",
  "id": "msg_init_1",
  "data": {
    "host": {
      "name": "example-host",
      "version": "0.1.0"
    },
    "supportedProtocols": ["nla/v1"],
    "preferredTransport": "stdio-jsonl",
    "profiles": {
      "nla-threads/v1": {
        "list": true,
        "history": true
      }
    }
  }
}
```

### Adapter -> Host

`initialized`

Suggested payload:

```json
{
  "protocol": "nla/v1",
  "type": "initialized",
  "id": "msg_init_2",
  "data": {
    "adapter": {
      "id": "example-cli-adapter",
      "name": "Example CLI Adapter",
      "version": "0.1.0"
    },
    "capabilities": {
      "invoke": true,
      "sessions": true,
      "streaming": true,
      "artifacts": true,
      "inputRequests": true
    },
    "profiles": {
      "nla-threads/v1": {
        "list": true,
        "get": true,
        "history": true,
        "attach": true
      }
    }
  }
}
```

## Capability Discovery

An adapter should be able to declare:

- identity
- supported profiles
- operations
- input schemas
- output schemas
- side-effect or risk metadata

An operation descriptor might look like:

```json
{
  "name": "list_todos",
  "description": "Return the current todo list.",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "todos": {
        "type": "array"
      }
    }
  },
  "risk": "read"
}
```

## Core Invoke Profile

The invoke profile is the lowest common denominator for adapters that can handle
discrete operations.

### Host -> Adapter

`invoke.request`

```json
{
  "protocol": "nla/v1",
  "type": "invoke.request",
  "id": "msg_1",
  "correlationId": "inv_1",
  "data": {
    "operation": "list_todos",
    "input": {},
    "context": {
      "cwd": "/Users/alice/project"
    }
  }
}
```

### Adapter -> Host

`invoke.output`

```json
{
  "protocol": "nla/v1",
  "type": "invoke.output",
  "id": "msg_2",
  "correlationId": "inv_1",
  "data": {
    "output": {
      "todos": []
    }
  }
}
```

`invoke.output.delta`

```json
{
  "protocol": "nla/v1",
  "type": "invoke.output.delta",
  "id": "msg_2b",
  "correlationId": "inv_1",
  "data": {
    "streamId": "stream_1",
    "seq": 1,
    "mode": "text",
    "delta": "hel"
  }
}
```

### Streaming Execution Events

Adapters may emit streamed output and progress while an invocation is running:

- `invoke.output.delta`
- `invoke.progress`
- `invoke.log`
- `invoke.activity`
- `invoke.artifact`

`invoke.output.delta` is the primary streamed-response primitive for the invoke
profile. Hosts should treat `streamId` plus `seq` as the ordering key. Adapters
may emit a final materialized `invoke.output`, may include the final materialized
result in `invoke.completed`, or both.

### Completion

An invocation must terminate with exactly one of:

- `invoke.completed`
- `invoke.failed`
- `invoke.cancelled`

## Session Profile

Some integrations need durable state across multiple turns.

Examples:

- conversational agents
- interactive developer tools
- browser or terminal supervisors
- approval-heavy workflows

### Host -> Adapter

- `session.start`
- `session.resume`
- `session.message`
- `session.input`
- `session.control`
- `session.stop`

### Adapter -> Host

- `session.started`
- `session.status`
- `session.message`
- `session.message.delta`
- `session.activity`
- `session.artifact`
- `session.input.required`
- `session.input.resolved`
- `session.control.state`
- `session.completed`
- `session.failed`
- `session.stopped`

Session-scoped messages should include `sessionId` in their payloads. Hosts and
providers may also repeat the same value in `correlationId` for easier routing.

### Session State

Session state is adapter-owned and opaque to the host unless explicitly exposed
through typed fields.

Hosts may persist:

- session ids
- adapter ids
- provider references
- opaque adapter state blobs

Hosts should not parse provider-specific transcript formats or provider-specific
saved-state internals.

## Threads Profile

`nla-threads/v1` is an optional profile for adapters that expose provider-native
saved threads.

This profile is separate from live session execution. It is for:

- listing saved threads
- reading thread metadata
- importing thread history
- attaching a new live session to an existing provider-native thread

Core messages:

- `threads.list.request`
- `threads.list.item`
- `threads.list.completed`
- `threads.list.failed`
- `threads.get.request`
- `threads.get.output`
- `threads.get.failed`
- `threads.history.request`
- `threads.history.item`
- `threads.history.completed`
- `threads.history.failed`

The key primitive is `threadRef`, which is opaque to the host.

Suggested `threads.list.item` / `threads.get.output` fields:

- `threadRef`
- `sessionId`
- `title`
- `summary`
- `firstPrompt`
- `createdAt`
- `updatedAt`
- `messageCount`
- `metadata`

Suggested `threads.history.item.kind` values:

- `message`
- `tool`
- `file_change`

## Input and Approval Profile

An adapter may need:

- missing arguments
- credentials
- account selection
- human approval
- disambiguation

Base request shape:

```json
{
  "protocol": "nla/v1",
  "type": "session.input.required",
  "id": "msg_req_1",
  "correlationId": "sess_1",
  "data": {
    "sessionId": "sess_1",
    "requestId": "req_1",
    "kind": "approval",
    "title": "Run write operation?",
    "body": "This will modify local files.",
    "options": [
      { "id": "approve", "label": "Approve", "style": "primary" },
      { "id": "deny", "label": "Deny", "style": "destructive" }
    ],
    "risk": "local-write"
  }
}
```

Resolution shape:

```json
{
  "protocol": "nla/v1",
  "type": "session.input",
  "id": "msg_req_2",
  "correlationId": "sess_1",
  "data": {
    "sessionId": "sess_1",
    "requestId": "req_1",
    "optionId": "approve",
    "text": "Proceed."
  }
}
```

## Artifact Profile

Artifacts provide durable outputs separate from message text.

Suggested artifact fields:

- `artifactId`
- `kind`
- `title`
- `mimeType`
- `uri`
- `data`
- `metadata`

Artifacts may be inline, file-backed, or host-resolved.

## Errors

Errors should be explicit and typed.

Suggested error categories:

- protocol error
- validation error
- authorization error
- capability error
- runtime error
- transport error

An error should indicate:

- where it occurred
- whether the operation can continue
- whether the failure is retryable

## Extensions

The base protocol should stay small. Host-specific features should be expressed
as extensions rather than folded into the core.

Possible extensions:

- history import
- wallet actions
- terminal attachments
- resource browsing
- host-managed model access

Extension naming should be explicit, for example:

- `nla.history/v1`
- `nla.wallet/v1`
- `nla.terminal/v1`

## Security Posture

NLA should assume adapters may trigger real side effects.

The protocol should encourage:

- explicit risk classification
- approval boundaries
- structured audit trails
- secret isolation
- least-privilege execution

The protocol should not assume that plain-text natural language is sufficient as
an approval or authorization boundary.

## Open Questions

- Which parts of initialization are mandatory in `v1`?
- Should operation discovery be mandatory or optional?
- Should session support be a required profile or an optional one?
- How much of artifact transport belongs in the core protocol?
- How much should approval semantics be standardized versus host-defined?
- Should there be a canonical JSON Schema requirement for operation contracts?

## Initial Direction

The first implementation should likely prove out:

1. a core `invoke` profile
2. a session profile
3. a stdio JSONL wire format
4. a small TypeScript SDK
5. one or two real foreign adapters

That is enough to validate whether NLA is merely a naming exercise or a real,
stable abstraction boundary.
