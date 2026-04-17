# @nla/sdk-cli

CLI adapter helpers for NLA.

This package sits on top of:

- `@nla/sdk-core`
- `@nla/transport-stdio-jsonl`

It provides:

- operation descriptors for CLI-backed adapters
- child-process execution helpers
- basic parse modes for text, lines, and JSON
- a direct `runCliAdapterStdio(...)` helper

## Example

```ts
import { cliOperation, defineCliAdapter } from "@nla/sdk-cli";

const adapter = defineCliAdapter({
  id: "echo-json",
  name: "Echo JSON",
  operations: [
    cliOperation({
      name: "echo",
      description: "Echo structured JSON.",
      risk: "read",
      command: {
        command: process.execPath,
        label: "node"
      },
      args: (input) => [
        "-e",
        "process.stdout.write(JSON.stringify({ value: process.argv[1] }))",
        String(input.value ?? "")
      ],
      parse: "json"
    })
  ]
});
```
