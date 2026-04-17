#!/usr/bin/env node
import { cliOperation, runCliAdapterStdio } from "@nla/sdk-cli";

await runCliAdapterStdio({
  id: "stdio-cli-demo",
  name: "Stdio CLI Demo",
  version: "0.1.0",
  operations: [
    cliOperation({
      name: "echo_json",
      description: "Return the provided value through a local Node child process.",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: {
          value: {
            type: "string"
          }
        },
        required: ["value"],
        additionalProperties: false
      },
      outputSchema: {
        type: "object",
        properties: {
          value: {
            type: "string"
          }
        },
        required: ["value"],
        additionalProperties: false
      },
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
