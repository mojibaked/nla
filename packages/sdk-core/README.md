# @nla/sdk-core

Small runtime helpers for building NLA adapters.

This package provides:

- adapter definition helpers
- an in-memory runtime for `invoke` and `session` messages
- emission helpers for status, artifacts, input requests, and failures
- input and output schema validation for declared operations
- streamed invoke output via `invoke.output.delta`
- transport-facing incremental delivery via `runtime.handleStream(...)`

It intentionally does not provide:

- a transport
- schema validation
- host-side session plumbing
- host-specific extensions

If you are implementing a host instead of an adapter, use
[`@nla/host-core`](../host-core/README.md) for the generic session client.

## Example

```ts
import { createAdapterRuntime, defineAdapter } from "@nla/sdk-core";

const runtime = createAdapterRuntime(defineAdapter({
  id: "echo",
  name: "Echo",
  capabilities: {
    invoke: true
  },
  async invoke(_ctx, message) {
    return {
      echoed: message.data.input ?? null
    };
  }
}));
```
