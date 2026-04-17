import assert from "node:assert/strict";
import test from "node:test";
import { defineAdapter } from "@nla/sdk-core";
import { invokeAdapter } from "@nla/test";

const greetSchemas = {
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string"
      }
    },
    required: ["name"],
    additionalProperties: false
  },
  outputSchema: {
    type: "object",
    properties: {
      message: {
        type: "string"
      }
    },
    required: ["message"],
    additionalProperties: false
  }
};

test("sdk-core validates invoke input against operation schemas", async () => {
  const adapter = defineAdapter({
    id: "validated-greeter",
    name: "Validated Greeter",
    operations: [
      {
        name: "greet",
        description: "Return a greeting.",
        ...greetSchemas
      }
    ],
    async invoke(_ctx, message) {
      return {
        message: `hi ${message.data.input.name}`
      };
    }
  });

  const result = await invokeAdapter(adapter, "greet", {});
  assert.ok(result.failed);
  assert.equal(result.failed.data.code, "validation_error");
  assert.match(result.failed.data.message, /Invalid input/);
});

test("sdk-core validates returned invoke output against operation schemas", async () => {
  const adapter = defineAdapter({
    id: "bad-greeter",
    name: "Bad Greeter",
    operations: [
      {
        name: "greet",
        description: "Return a malformed greeting.",
        ...greetSchemas
      }
    ],
    async invoke() {
      return {
        wrong: true
      };
    }
  });

  const result = await invokeAdapter(adapter, "greet", {
    name: "Ada"
  });
  assert.ok(result.failed);
  assert.equal(result.failed.data.code, "validation_error");
  assert.match(result.failed.data.message, /Invalid output/);
});

test("sdk-core allows valid invoke input and output", async () => {
  const adapter = defineAdapter({
    id: "good-greeter",
    name: "Good Greeter",
    operations: [
      {
        name: "greet",
        description: "Return a valid greeting.",
        ...greetSchemas
      }
    ],
    async invoke(_ctx, message) {
      return {
        message: `hi ${message.data.input.name}`
      };
    }
  });

  const result = await invokeAdapter(adapter, "greet", {
    name: "Ada"
  });
  assert.ok(result.output);
  assert.deepEqual(result.output.data.output, {
    message: "hi Ada"
  });
  assert.ok(result.completed);
});
