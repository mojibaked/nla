# @nla/sdk-http

HTTP adapter helpers for NLA.

This package sits on top of:

- `@nla/sdk-core`
- `@nla/transport-stdio-jsonl`

It provides:

- operation descriptors for outbound HTTP-backed adapters, not the host-adapter
  transport itself
- request building helpers for method, URL, query, headers, and body
- response parsing for JSON, text, and bytes
- a direct `runHttpAdapterStdio(...)` helper

By default, non-2xx responses are treated as failures. Use `acceptStatus` when
an API intentionally returns other statuses as normal flow.

## Example

```ts
import { defineHttpAdapter, httpOperation } from "@nla/sdk-http";

const adapter = defineHttpAdapter({
  id: "http-echo",
  name: "HTTP Echo",
  operations: [
    httpOperation({
      name: "echo",
      description: "POST JSON and return JSON.",
      method: "POST",
      url: "http://127.0.0.1:3000/echo",
      body: (input) => ({ value: input.value }),
      parse: "json"
    })
  ]
});
```
