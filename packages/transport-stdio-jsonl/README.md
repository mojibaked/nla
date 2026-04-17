# @nla/transport-stdio-jsonl

The first wire transport for NLA: one JSON envelope per line over stdio.

This package provides:

- JSONL encode/decode helpers for NLA envelopes
- a small stdio loop for local adapters
- an adapter runner that can drive `@nla/sdk-core`
- protocol-shape validation on incoming JSONL messages
- live flush of streamed events emitted through `runtime.handleStream(...)`
- `openJsonlChildTransport(...)` for host runtimes that want to supervise an
  NLA child process over stdio JSONL

## Example

```ts
import { createAdapterRuntime, defineAdapter } from "@nla/sdk-core";
import { runAdapterStdio } from "@nla/transport-stdio-jsonl";

const runtime = createAdapterRuntime(defineAdapter({
  id: "echo",
  name: "Echo",
  async invoke(_ctx, message) {
    return { echoed: message.data.input ?? null };
  }
}));

await runAdapterStdio(runtime);
```

## Host-Side Child Transport

If you are implementing a host runtime instead of an adapter, use
`openJsonlChildTransport(...)` together with `@nla/host-core` to supervise a
Node child process that speaks NLA over stdio JSONL.

That helper owns:

- child process spawn/teardown
- stdout JSONL parsing and validation
- stderr capture and error decoration

It does not own:

- session correlation
- turn pause/resume
- control or interrupt policy
