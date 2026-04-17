# NLA

Natural Language Adapters.

NLA is a protocol and SDK direction for wrapping software surfaces behind a
consistent natural-language-friendly interface.

The core idea is simple:

```text
Take any surface that accepts structured input and can produce structured output.
Wrap it in a small adapter.
Expose it through a standard protocol.
```

That surface might be:

- a CLI
- an HTTP API
- an MCP server
- an SDK or library
- a local app automation surface
- a long-lived agent runtime

## Thesis

Most "agent integrations" are really adapter problems.

The hard part is usually not the model. The hard part is turning an existing
system into something that can:

- declare what it does
- accept validated input
- stream structured progress
- ask for missing input or approval
- return typed output and artifacts
- behave consistently across hosts

NLA aims to standardize that boundary.

## Design Goals

- Make simple adapters very easy to write.
- Keep the protocol transport-agnostic.
- Support one-shot invocation and long-lived sessions.
- Preserve structured I/O instead of collapsing everything into plain text.
- Make side effects, approvals, and risk explicit.
- Work for both native NLA providers and foreign adapters around existing tools.

## Non-Goals

- NLA is not an LLM provider.
- NLA is not a workflow engine.
- NLA is not a UI framework.
- NLA is not limited to coding agents.
- NLA does not require a specific host application.

## Initial Docs

- [PROTOCOL.md](./PROTOCOL.md): first-pass `nla/v1` protocol draft

## Workspace

Current packages:

- [`@nla/protocol`](./packages/protocol/README.md): core TypeScript types for the
  draft `nla/v1` envelope and profiles, plus message-shape validation helpers
- [`@nla/host-core`](./packages/host-core/README.md): generic host-side session
  client primitives for talking to long-lived NLA providers
- [`@nla/sdk-core`](./packages/sdk-core/README.md): a small adapter runtime with
  handler-based `invoke` and `session` flows, including operation input/output
  schema validation
- [`@nla/sdk-http`](./packages/sdk-http/README.md): an outbound HTTP adapter
  layer for wrapping APIs behind NLA operations
- [`@nla/sdk-cli`](./packages/sdk-cli/README.md): a thin CLI wrapper layer on top
  of `sdk-core`
- [`@nla/test`](./packages/test/README.md): a lightweight adapter/runtime harness
  for tests and local verification
- [`@nla/transport-http`](./packages/transport-http/README.md): an HTTP transport
  for host-adapter communication using streamed NDJSON responses
- [`@nla/transport-stdio-jsonl`](./packages/transport-stdio-jsonl/README.md):
  a stdio JSONL transport with live streaming flush support and a Node child
  process JSONL transport helper for hosts

## Planned Package Shape

The repo starts as protocol-first documentation. If the shape holds up, the
next step is likely a layered package structure:

```text
packages/
  protocol/
  host-core/
  sdk-core/
  sdk-cli/
  sdk-http/
  transport-http/
  sdk-mcp/
  test/
examples/
```

## Working Vocabulary

- `NLA Protocol`: the transport-independent contract
- `NLA Provider`: something that speaks NLA directly
- `Foreign Adapter`: a wrapper that translates another surface into NLA
- `Host`: the application or runtime that launches and talks to adapters

## Status

Draft. This repo is the starting point for formalizing the protocol and then
extracting a standalone SDK around it.

## Local Development

```sh
npm install
npm run build
npm run typecheck
npm test
npm run example:http-transport-server
npm run example:stdio-echo
npm run example:stdio-cli
npm run example:stdio-http
npm run example:stdio-openrouter
npm run example:stdio-openrouter-adapter
```
