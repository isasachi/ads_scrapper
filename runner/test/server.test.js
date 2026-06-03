import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../server.js";

// Makes an HTTP request to `server` (a net.Server). Returns { status, body }.
function req(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const { port } = server.address();
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: data
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      },
    );
    request.on("error", reject);
    if (data) request.write(data);
    request.end();
  });
}

// Minimal mock GatewayClient.
function mockGw({ runId = "run-1", waitResult = { outputText: "done" } } = {}) {
  return {
    connect: async () => {},
    request: async (method) => {
      if (method === "agents.get") return { agent: {} };
      if (method === "agent") return { runId };
      if (method === "agent.wait") return waitResult;
      throw new Error(`unexpected method: ${method}`);
    },
  };
}

test("GET /health returns ok:true", async () => {
  const server = createApp(mockGw()).listen(0);
  const { status, body } = await req(server, "GET", "/health");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  server.close();
});

test("POST /run-agent returns 400 when agentId is missing", async () => {
  const server = createApp(mockGw()).listen(0);
  const { status, body } = await req(server, "POST", "/run-agent", { input: "hi" });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  server.close();
});

test("POST /run-agent parses JSON outputText", async () => {
  const server = createApp(mockGw({ waitResult: { outputText: '{"key":"value"}' } })).listen(0);
  const { status, body } = await req(server, "POST", "/run-agent", {
    agentId: "seed-generator",
    input: "test query",
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.data, { key: "value" });
  server.close();
});

test("POST /run-agent returns raw string when outputText is not JSON", async () => {
  const server = createApp(mockGw({ waitResult: { outputText: "plain text" } })).listen(0);
  const { status, body } = await req(server, "POST", "/run-agent", {
    agentId: "seed-generator",
    input: "test",
  });
  assert.equal(status, 200);
  assert.deepEqual(body.data, "plain text");
  server.close();
});

test("POST /run-agent falls back to finalText when outputText absent", async () => {
  const server = createApp(mockGw({ waitResult: { finalText: "fallback" } })).listen(0);
  const { status, body } = await req(server, "POST", "/run-agent", {
    agentId: "seed-generator",
    input: "test",
  });
  assert.equal(status, 200);
  assert.deepEqual(body.data, "fallback");
  server.close();
});

test("POST /run-agent ignores assistant stream events from other runs", async () => {
  const handlers = new Set();
  const gw = {
    connect: async () => {},
    onEvent: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    request: async (method) => {
      if (method === "agent") return { runId: "run-1" };
      if (method === "agent.wait") {
        for (const handler of handlers) {
          handler({
            event: "agent",
            payload: { runId: "run-2", stream: "assistant", data: { text: "wrong-run" } },
          });
          handler({
            event: "agent",
            payload: { runId: "run-1", stream: "assistant", data: { text: "right-run" } },
          });
        }
        return { outputText: "wait-output" };
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };
  const server = createApp(gw).listen(0);
  const { status, body } = await req(server, "POST", "/run-agent", {
    agentId: "seed-generator",
    input: "test",
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data, "right-run");
  assert.equal(handlers.size, 0);
  server.close();
});

test("POST /run-agent falls back when assistant event lacks matching run id", async () => {
  const handlers = new Set();
  const gw = {
    connect: async () => {},
    onEvent: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    request: async (method) => {
      if (method === "agent") return { runId: "run-1" };
      if (method === "agent.wait") {
        for (const handler of handlers) {
          handler({
            event: "agent",
            payload: { runId: "run-2", stream: "assistant", data: { text: "wrong-run" } },
          });
        }
        return { finalText: "fallback" };
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };
  const server = createApp(gw).listen(0);
  const { status, body } = await req(server, "POST", "/run-agent", {
    agentId: "seed-generator",
    input: "test",
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data, "fallback");
  server.close();
});

test("POST /run-agent returns 500 when gateway throws", async () => {
  const gw = {
    connect: async () => {},
    request: async () => { throw new Error("gateway error"); },
  };
  const server = createApp(gw).listen(0);
  const { status, body } = await req(server, "POST", "/run-agent", {
    agentId: "seed-generator",
    input: "test",
  });
  assert.equal(status, 500);
  assert.equal(body.ok, false);
  assert.equal(body.error, "gateway error");
  server.close();
});
