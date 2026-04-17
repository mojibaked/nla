import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { httpOperation, defineHttpAdapter } from "@nla/sdk-http";
import { invokeAdapter } from "@nla/test";

test("sdk-http performs a JSON request and returns parsed JSON", async () => {
  await withHttpServer(async (baseUrl) => {
    const adapter = defineHttpAdapter({
      id: "http-echo",
      name: "HTTP Echo",
      operations: [
        httpOperation({
          name: "echo",
          description: "POST JSON and return JSON.",
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
              },
              via: {
                type: "string"
              }
            },
            required: ["echoed", "via"],
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

    const result = await invokeAdapter(adapter, "echo", {
      value: "hello"
    });
    assert.ok(result.output);
    assert.deepEqual(result.output.data.output, {
      echoed: "hello",
      via: "post"
    });
  });
});

test("sdk-http treats unexpected HTTP status as invoke.failed by default", async () => {
  await withHttpServer(async (baseUrl) => {
    const adapter = defineHttpAdapter({
      id: "http-fail",
      name: "HTTP Fail",
      operations: [
        httpOperation({
          name: "missing",
          description: "Request a missing route.",
          risk: "read",
          url: `${baseUrl}/missing`,
          parse: "json"
        })
      ]
    });

    const result = await invokeAdapter(adapter, "missing", {});
    assert.ok(result.failed);
    assert.equal(result.failed.data.code, "http_request_failed");
    assert.equal(result.failed.data.data.status, 404);
  });
});

test("sdk-http can accept non-2xx statuses when explicitly configured", async () => {
  await withHttpServer(async (baseUrl) => {
    const adapter = defineHttpAdapter({
      id: "http-accept-404",
      name: "HTTP Accept 404",
      operations: [
        httpOperation({
          name: "missing_ok",
          description: "Treat 404 as a normal result.",
          risk: "read",
          url: `${baseUrl}/missing`,
          parse: "json",
          acceptStatus: (status) => status === 404,
          output: (result) => ({
            status: result.status,
            body: result.json
          }),
          outputSchema: {
            type: "object",
            properties: {
              status: {
                type: "number"
              },
              body: {
                type: "object"
              }
            },
            required: ["status", "body"],
            additionalProperties: false
          }
        })
      ]
    });

    const result = await invokeAdapter(adapter, "missing_ok", {});
    assert.ok(result.output);
    assert.deepEqual(result.output.data.output, {
      status: 404,
      body: {
        error: "not_found"
      }
    });
  });
});

async function withHttpServer(run) {
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);

    if (req.url === "/echo" && req.method === "POST") {
      const payload = body ? JSON.parse(body) : {};
      res.writeHead(200, {
        "content-type": "application/json"
      });
      res.end(JSON.stringify({
        echoed: payload.value ?? null,
        via: "post"
      }));
      return;
    }

    res.writeHead(404, {
      "content-type": "application/json"
    });
    res.end(JSON.stringify({
      error: "not_found"
    }));
  });

  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error) => {
      if (error) reject(error);
      else resolve(undefined);
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve(undefined);
      });
    });
  }
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
