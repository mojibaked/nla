# @nla/host-core

Host-side primitives for talking to long-lived NLA adapters.

This package provides:

- a generic `createSessionClient(...)` for host/runtime implementations
- request / correlation bookkeeping for long-lived sessions
- async turn streaming over `session.message*`
- pause/resume around `session.interaction.*`
- helpers for `session.controls.get`, `session.control`, and `session.interrupt`

It intentionally does not provide:

- child process or HTTP transport policy
- host-specific interaction/profile decoding
- application capability systems

## Example

```ts
import { createSessionClient } from "@nla/host-core";

const sessionClient = createSessionClient({
  nextRequestId: (prefix) => `${prefix}:${Date.now()}`,
  now: () => new Date().toISOString()
});
```
