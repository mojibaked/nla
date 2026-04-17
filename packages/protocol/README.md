# @nla/protocol

Core TypeScript types for the draft `nla/v1` protocol.

This package is intentionally small. It provides:

- protocol version constants
- envelope and message types
- message validation helpers for draft `nla/v1` traffic
- invoke and session profile types
- artifact types
- core session interaction messages
- core session interrupt messages

It does not yet provide:

- a transport implementation
- runtime adapters
- host-specific extensions

## Core Session Contract

For session-oriented runtimes, the draft core contract now includes:

- turn and lifecycle messages such as `session.start`, `session.message`, and `session.stop`
- structured interaction suspension and resume via `session.interaction.requested`, `session.interaction.resolve`, and `session.interaction.resolved`
- first-class interruption via `session.interrupt` and `session.interrupt.result`

`session.control` remains available for adapter-defined controls, but `interrupt`
is no longer just an implicit control convention.

## Example

```ts
import { createEnvelope } from "@nla/protocol";

const message = createEnvelope("invoke.request", {
  operation: "list_todos",
  input: {}
});
```
