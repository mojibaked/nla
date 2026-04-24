# @nla/delegation

Host-runtime-independent helpers for exposing one NLA adapter session as a tool
inside another NLA tool-loop adapter.

The package defines only the abstraction boundary. Hosts provide an
`NlaSessionLauncher` that knows how to locate and start the target adapter.

## Boundary

`@nla/delegation` is the portable NLA-to-NLA layer. It must not depend on a
specific host runtime, install catalog, process model, or product UI.

The package owns:

- delegation metadata conventions
- generic target/session launcher interfaces
- adapter-as-tool helpers
- output mapping helpers
- generic lifecycle policy for a delegated tool call

Hosts own:

- resolving a target adapter id to a runnable install
- starting, stopping, and interrupting child sessions
- mapping child session events into host-native event logs or UI
- enforcing host-specific auth, capability, quota, and install policy

## V0

V0 is the narrow proof that one NLA adapter can be used as a tool by another
without importing host-specific APIs.

Implemented API surface:

- `NlaAdapterTarget`
- `NlaDelegationContext`
- `NlaSessionLauncher`
- `NlaDelegatedSession`
- `adapterTool(...)`
- `finalAssistantText(...)`
- `finalAssistantJson(...)`

V0 behavior:

- parent adapters call an injected `NlaSessionLauncher`
- delegated calls start a child session and send one user turn
- child assistant output becomes the parent tool result
- child `session.activity` messages can be forwarded as parent tool activity
- child `session.interaction.requested` is forwarded through parent
  `awaitInput(...)`, then resolved back into the child session
- parent abort and timeout are propagated to child `interrupt(...)`
- ephemeral child sessions are stopped in cleanup
- delegation depth metadata prevents obvious recursion loops

V0 host-runtime implementation:

- host-runtime implements `NlaSessionLauncher`
- process adapters can obtain an `NlaSessionLauncher` through the host
  capability bridge exposed by `@host-runtime/sdk/delegation`
- child sessions are ephemeral/private by default
- child sessions are not normal user-visible or resumable host sessions
- host-runtime mirrors delegated work into parent-scoped
  `conversation.activity.updated` events when there is a parent turn id

V0 explicitly does not include:

- visible/resumable child sessions
- reusable long-lived delegated sessions
- cross-host or remote delegation discovery
- budget, quota, or policy negotiation
- a stable public taxonomy for every nested activity detail field
- reusable adapter-facing delegation transports outside host-runtime's
  capability bridge

## V1+

V1+ should keep the same core boundary but add product-grade lifecycle and
observability.

Likely additions:

- explicit delegation modes:
  - `ephemeral`: private child session, stopped after the tool call
  - `reuse`: private child session reused within a parent session
  - `attached`: visible child session with its own host session record
- structured parent-child tracing fields in protocol metadata, such as
  `delegationId`, `parentSessionId`, `parentTurnId`, `parentToolCallId`,
  `childSessionId`, and `depth`
- stable nested activity detail schema
- richer failure mapping with child failure code, target id, child turn id, and
  retryability
- interrupt propagation from parent turn to all active delegated children
- policy hooks for allowed targets, max depth, timeout, and budget
- optional delegation result artifacts, not only assistant text/json
- launcher implementations for stdio, in-process, HTTP, and host-native
  providers
- end-to-end tests with a real parent adapter and real child adapter process

Open design questions:

- Whether parent-child metadata should remain only in message metadata or become
  first-class protocol fields.
- Whether `attached` child sessions belong in `@nla/delegation` policy or only
  in host implementations.
- How much child transcript should be retained for audit when the child session
  is ephemeral.
- Whether delegation target resolution should standardize on adapter id,
  install id, capability tags, or a richer target descriptor.

## Near-Term Integration Plan

1. Review the host-runtime launcher implementation and nested activity events.
   Done.
2. Add a standalone `research.agent` adapter package.
   Done.
3. Add a host-runtime wrapper/install for `research.agent`.
   Done.
4. Add an Autotrader research tool backed by `adapterTool(...)`.
   Done.
5. Add an adapter-facing host capability bridge for delegation.
   Done.
6. Add a process-adapter-to-process-adapter end-to-end test through the host
   capability bridge.
   Done.
7. Add an Autotrader-to-research smoke test with a deterministic research
   install or test double.
   Next.
