#!/usr/bin/env node
import { httpOperation, runHttpAdapterStdio } from "@nla/sdk-http";

const baseUrl = process.env.NLA_HTTP_BASE_URL || "http://127.0.0.1:31338";

await runHttpAdapterStdio({
  id: "stdio-http-demo",
  name: "Stdio HTTP Demo",
  version: "0.1.0",
  operations: [
    httpOperation({
      name: "echo_http",
      description: "POST one JSON value to an HTTP endpoint and return the JSON response.",
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
          echoed: {
            type: "string"
          }
        },
        required: ["echoed"],
        additionalProperties: false
      },
      method: "POST",
      url: `${baseUrl}/echo`,
      body: (input) => ({
        value: input.value
      }),
      parse: "json"
    })
  ]
});
