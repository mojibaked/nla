# @nla/transport-http

HTTP transport helpers for NLA using one request envelope in and a streamed
NDJSON response out.

This package provides:

- a Node HTTP server handler for exposing an adapter or runtime over HTTP
- a fetch-based client for sending one NLA message and consuming streamed events
- NDJSON encode/decode helpers for `nla/v1` envelopes

The default wire mapping is:

- `POST` one JSON NLA envelope to the adapter endpoint
- receive `application/x-ndjson` response chunks as NLA envelopes

## Example

```ts
import { createServer } from "node:http";
import { defineAdapter } from "@nla/sdk-core";
import { createHttpTransportHandler } from "@nla/transport-http";

const adapter = defineAdapter({
  id: "echo-http",
  name: "Echo HTTP",
  async invoke(_ctx, message) {
    return { echoed: message.data.input ?? null };
  }
});

const server = createServer(createHttpTransportHandler(adapter, {
  path: "/nla"
}));

server.listen(8787);
```
