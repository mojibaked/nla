import assert from "node:assert/strict";
import test from "node:test";
import { cliOperation, defineCliAdapter } from "@nla/sdk-cli";
import { invokeAdapter } from "@nla/test";

test("sdk-cli executes a command and returns parsed output", async () => {
  const adapter = defineCliAdapter({
    id: "cli-echo-json",
    name: "CLI Echo JSON",
    operations: [
      cliOperation({
        name: "echo_json",
        description: "Echo one string value through a child process.",
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

  const result = await invokeAdapter(adapter, "echo_json", {
    value: "hello"
  });
  assert.ok(result.output);
  assert.deepEqual(result.output.data.output, {
    value: "hello"
  });
});

test("sdk-cli surfaces subprocess failures as invoke.failed", async () => {
  const adapter = defineCliAdapter({
    id: "cli-fail",
    name: "CLI Fail",
    operations: [
      cliOperation({
        name: "explode",
        description: "Exit non-zero.",
        risk: "read",
        command: {
          command: process.execPath,
          label: "node"
        },
        args: () => [
          "-e",
          "process.stderr.write('boom'); process.exit(3);"
        ]
      })
    ]
  });

  const result = await invokeAdapter(adapter, "explode", {});
  assert.ok(result.failed);
  assert.equal(result.failed.data.code, "cli_command_failed");
  assert.match(String(result.failed.data.data.stderr), /boom/);
});
