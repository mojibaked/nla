# Examples

This directory is reserved for concrete NLA adapters and hosts once the base
protocol settles.

Planned examples:

- CLI adapter
- HTTP API adapter
- MCP-backed adapter
- minimal host talking over stdio JSONL

Current example:

- [`stdio-echo-adapter.mjs`](./stdio-echo-adapter.mjs): a tiny adapter built on
  `@nla/sdk-core` and exposed over `@nla/transport-stdio-jsonl`; emits
  `invoke.output.delta` when the input includes `text`
- [`stdio-cli-adapter.mjs`](./stdio-cli-adapter.mjs): a CLI-backed adapter built
  with `@nla/sdk-cli`
- [`stdio-http-adapter.mjs`](./stdio-http-adapter.mjs): an HTTP-backed adapter
  built with `@nla/sdk-http`
- [`openrouter-chat-repl.mjs`](./openrouter-chat-repl.mjs): a human-friendly
  chat REPL that runs the OpenRouter adapter in-process
- [`stdio-openrouter-adapter.mjs`](./stdio-openrouter-adapter.mjs): a real LLM
  adapter backed by OpenRouter; supports streamed `invoke` output and streamed
  `session` replies over raw stdio NLA messages
- [`http-transport-server.mjs`](./http-transport-server.mjs): an adapter exposed
  over `@nla/transport-http` with streamed NDJSON responses

OpenRouter examples expect:

- `OPENROUTER_API_KEY`: required
- `OPENROUTER_BASE_URL`: optional, defaults to `https://openrouter.ai/api/v1`
- `OPENROUTER_MODEL`: optional default model when requests do not specify one
- `OPENROUTER_SYSTEM_PROMPT`: optional default system prompt for the REPL

Suggested commands:

- `npm run example:stdio-openrouter`: launches the human chat REPL
- `npm run example:stdio-openrouter-adapter`: launches the raw stdio NLA adapter
