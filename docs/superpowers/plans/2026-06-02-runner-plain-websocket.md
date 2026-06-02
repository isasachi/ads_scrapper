# Runner plain-WebSocket refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace `@openclaw/sdk` in the runner service with a hand-rolled WebSocket client (`ws` package) that speaks the OpenClaw gateway protocol directly, keeping the HTTP API surface identical.

**Architecture:** A new `GatewayClient` class in `gateway.js` owns the WebSocket lifecycle (handshake, request/response correlation by UUID, lazy reconnect). `server.js` is rewritten as a `createApp(gw)` factory that accepts a `GatewayClient` and returns the Express app — this keeps the production entry point simple and makes the endpoints testable without a live gateway. Tests use Node's built-in `node:test` runner with a mock WS server (also `ws` package).

**Tech Stack:** Node.js ESM, `ws ^8`, `express ^4`, `node:test` + `node:assert` (built-in, no extra deps).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `runner/package.json` | Modify | Swap `@openclaw/sdk` → `ws`; rename package; add test script |
| `runner/gateway.js` | Create | `GatewayClient`: WS connection, handshake, request/response correlation, reconnect |
| `runner/server.js` | Rewrite | `createApp(gw)` export + conditional production entry point |
| `runner/test/gateway.test.js` | Create | Unit tests for `GatewayClient` using an in-process mock WS server |
| `runner/test/server.test.js` | Create | HTTP endpoint tests using a plain mock `GatewayClient` object |

---

## Task 1: Update package.json

**Files:**
- Modify: `runner/package.json`

- [x] **Step 1: Replace contents of `runner/package.json`**

```json
{
  "name": "runner",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch server.js",
    "start": "node server.js",
    "test": "node --test test/gateway.test.js test/server.test.js"
  },
  "dependencies": {
    "express": "^4.21.2",
    "ws": "^8.18.0"
  }
}
```

- [x] **Step 2: Install**

```bash
cd runner && npm install
```

Expected: `node_modules/ws` present, `@openclaw/sdk` absent.

- [x] **Step 3: Commit**

```bash
git add runner/package.json runner/package-lock.json
git commit -m "chore(runner): swap @openclaw/sdk for ws"
```

---

## Task 2: Write failing tests for GatewayClient

**Files:**
- Create: `runner/test/gateway.test.js`

- [x] **Step 1: Create test directory**

```bash
mkdir -p runner/test
```

- [x] **Step 2: Create `runner/test/gateway.test.js`**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { GatewayClient } from "../gateway.js";

// Starts a mock WS server on a random port. Returns { wss, url }.
function mockGateway(onConnection) {
  const wss = new WebSocketServer({ port: 0 });
  wss.on("connection", onConnection);
  const { port } = wss.address();
  return { wss, url: `ws://127.0.0.1:${port}` };
}

// Sends connect.challenge and responds to the connect handshake.
function doHandshake(ws) {
  ws.send(JSON.stringify({
    type: "event",
    event: "connect.challenge",
    payload: { nonce: "test-nonce", ts: 1 },
  }));
  ws.on("message", (raw) => {
    const frame = JSON.parse(raw.toString());
    if (frame.method === "connect") {
      ws.send(JSON.stringify({
        type: "res", id: frame.id, ok: true,
        payload: { type: "hello-ok" },
      }));
    }
  });
}

test("connects after challenge/hello-ok handshake", async () => {
  const { wss, url } = mockGateway((ws) => doHandshake(ws));
  const gw = new GatewayClient({ url, token: "test-token" });
  await gw.connect();
  wss.close();
});

test("connect sends token in auth params", async () => {
  let receivedToken;
  const { wss, url } = mockGateway((ws) => {
    ws.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "n", ts: 1 } }));
    ws.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.method === "connect") {
        receivedToken = frame.params.auth.token;
        ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { type: "hello-ok" } }));
      }
    });
  });
  const gw = new GatewayClient({ url, token: "secret-token" });
  await gw.connect();
  assert.equal(receivedToken, "secret-token");
  wss.close();
});

test("request sends framed req and resolves with payload", async () => {
  const { wss, url } = mockGateway((ws) => {
    doHandshake(ws);
    ws.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.method === "echo") {
        ws.send(JSON.stringify({
          type: "res", id: frame.id, ok: true,
          payload: { value: frame.params.value },
        }));
      }
    });
  });
  const gw = new GatewayClient({ url, token: "t" });
  const result = await gw.request("echo", { value: "hello" });
  assert.deepEqual(result, { value: "hello" });
  wss.close();
});

test("request rejects when ok:false", async () => {
  const { wss, url } = mockGateway((ws) => {
    doHandshake(ws);
    ws.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.method !== "connect") {
        ws.send(JSON.stringify({
          type: "res", id: frame.id, ok: false,
          error: { message: "not found" },
        }));
      }
    });
  });
  const gw = new GatewayClient({ url, token: "t" });
  await assert.rejects(
    () => gw.request("agents.get", { id: "bad" }),
    /not found/,
  );
  wss.close();
});

test("request rejects on timeout", async () => {
  // Server completes handshake but never responds to other requests.
  const { wss, url } = mockGateway((ws) => doHandshake(ws));
  const gw = new GatewayClient({ url, token: "t" });
  await assert.rejects(
    () => gw.request("slow", {}, 100),
    /request timeout/,
  );
  wss.close();
});

test("pending requests reject when connection drops", async () => {
  const { wss, url } = mockGateway((ws) => {
    doHandshake(ws);
    setTimeout(() => ws.close(), 100); // drop after 100 ms
  });
  const gw = new GatewayClient({ url, token: "t" });
  await gw.connect();
  await assert.rejects(
    () => gw.request("slow", {}, 5_000),
    /connection lost/,
  );
  wss.close();
});

test("reconnects transparently on next request after disconnect", async () => {
  let connCount = 0;
  const { wss, url } = mockGateway((ws) => {
    connCount++;
    doHandshake(ws);
    ws.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.method === "ping") {
        if (connCount === 1) {
          ws.close(); // drop connection on first ping
        } else {
          ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { pong: true } }));
        }
      }
    });
  });
  const gw = new GatewayClient({ url, token: "t" });
  // First request drops the connection.
  await assert.rejects(
    () => gw.request("ping", {}),
    /connection lost/,
  );
  // Second request reconnects and succeeds.
  const result = await gw.request("ping", {});
  assert.deepEqual(result, { pong: true });
  assert.equal(connCount, 2);
  wss.close();
});
```

- [x] **Step 3: Run — expect failure**

```bash
cd runner && node --test test/gateway.test.js
```

Expected: `Error: Cannot find module '../gateway.js'`

---

## Task 3: Implement gateway.js

**Files:**
- Create: `runner/gateway.js`

- [x] **Step 1: Create `runner/gateway.js`**

```javascript
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";

const HANDSHAKE_TIMEOUT_MS = 10_000;

export class GatewayClient {
  #url;
  #token;
  #ws = null;
  #pending = new Map(); // id → { resolve, reject, timer }
  #connected = false;
  #connecting = null; // in-flight connect Promise

  constructor({ url, token }) {
    this.#url = url;
    this.#token = token;
  }

  async connect() {
    if (this.#connected) return;
    if (this.#connecting) return this.#connecting;
    this.#connecting = this.#doConnect().finally(() => {
      this.#connecting = null;
    });
    return this.#connecting;
  }

  #doConnect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.#url);

      const timeoutId = setTimeout(() => {
        ws.terminate();
        reject(new Error("handshake timeout"));
      }, HANDSHAKE_TIMEOUT_MS);

      ws.on("error", (err) => {
        if (!this.#connected) {
          clearTimeout(timeoutId);
          reject(err);
        }
      });

      ws.on("close", () => {
        if (!this.#connected) {
          clearTimeout(timeoutId);
          reject(new Error("connection closed during handshake"));
          return;
        }
        this.#connected = false;
        this.#ws = null;
        for (const p of this.#pending.values()) {
          if (p.timer) clearTimeout(p.timer);
          p.reject(new Error("connection lost"));
        }
        this.#pending.clear();
      });

      ws.on("message", (raw) => {
        let frame;
        try {
          frame = JSON.parse(raw.toString());
        } catch {
          return;
        }

        if (frame.type === "event" && frame.event === "connect.challenge") {
          const id = randomUUID();
          this.#pending.set(id, {
            resolve: (payload) => {
              clearTimeout(timeoutId);
              this.#connected = true;
              this.#ws = ws;
              resolve(payload);
            },
            reject: (err) => {
              clearTimeout(timeoutId);
              reject(err);
            },
            timer: null,
          });
          ws.send(JSON.stringify({
            type: "req",
            id,
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 4,
              role: "operator",
              scopes: ["operator.read", "operator.write"],
              client: { id: "runner", version: "1.0.0", platform: "linux", mode: "operator" },
              auth: { token: this.#token },
            },
          }));
          return;
        }

        if (frame.type === "res") {
          const p = this.#pending.get(frame.id);
          if (!p) return;
          this.#pending.delete(frame.id);
          if (p.timer) clearTimeout(p.timer);
          if (frame.ok) {
            p.resolve(frame.payload);
          } else {
            p.reject(new Error(frame.error?.message || "gateway error"));
          }
        }
      });
    });
  }

  async request(method, params, timeoutMs = 30_000) {
    if (!this.#connected) await this.connect();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`request timeout: ${method}`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
  }
}
```

- [x] **Step 2: Run gateway tests**

```bash
cd runner && node --test test/gateway.test.js
```

Expected: all 7 tests pass.

```
✔ connects after challenge/hello-ok handshake
✔ connect sends token in auth params
✔ request sends framed req and resolves with payload
✔ request rejects when ok:false
✔ request rejects on timeout
✔ pending requests reject when connection drops
✔ reconnects transparently on next request after disconnect
```

- [x] **Step 3: Commit**

```bash
git add runner/gateway.js runner/test/gateway.test.js
git commit -m "feat(runner): add GatewayClient with plain-ws protocol"
```

---

## Task 4: Write failing tests for server endpoints

**Files:**
- Create: `runner/test/server.test.js`

- [x] **Step 1: Create `runner/test/server.test.js`**

```javascript
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
```

- [x] **Step 2: Run — expect failure**

```bash
cd runner && node --test test/server.test.js
```

Expected: `SyntaxError` or `does not provide an export named 'createApp'` — `server.js` doesn't export `createApp` yet.

---

## Task 5: Rewrite server.js

**Files:**
- Modify: `runner/server.js`

- [x] **Step 1: Replace contents of `runner/server.js`**

```javascript
import express from "express";
import { fileURLToPath } from "node:url";
import { GatewayClient } from "./gateway.js";

function normalizeInput(input) {
  return typeof input === "string" ? input : JSON.stringify(input);
}

export function createApp(gw) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/run-agent", async (req, res) => {
    try {
      const { agentId, input } = req.body || {};
      if (!agentId) return res.status(400).json({ ok: false, error: "agentId is required" });

      await gw.connect();
      await gw.request("agents.get", { id: agentId });
      const { runId } = await gw.request("agent", {
        agentId,
        input: normalizeInput(input),
        sessionKey: "main",
        timeoutSecs: 120,
      });
      const result = await gw.request("agent.wait", { runId, timeoutSecs: 180 }, 185_000);
      const output = result?.outputText || result?.finalText || result?.text || "";

      let parsed = output;
      try {
        parsed = JSON.parse(output);
      } catch {}

      res.json({ ok: true, data: parsed, raw: result });
    } catch (error) {
      res.status(500).json({ ok: false, error: error?.message || String(error) });
    }
  });

  return app;
}

// Only start listening when executed directly (not imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const gw = new GatewayClient({
    url: process.env.OPENCLAW_GATEWAY_URL || "ws://host.docker.internal:18789",
    token: process.env.OPENCLAW_GATEWAY_TOKEN,
  });
  const app = createApp(gw);
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`runner listening on :${port}`);
  });
}
```

- [x] **Step 2: Run all tests**

```bash
cd runner && npm test
```

Expected: all 13 tests pass.

```
▶ gateway tests
  ✔ connects after challenge/hello-ok handshake
  ✔ connect sends token in auth params
  ✔ request sends framed req and resolves with payload
  ✔ request rejects when ok:false
  ✔ request rejects on timeout
  ✔ pending requests reject when connection drops
  ✔ reconnects transparently on next request after disconnect

▶ server tests
  ✔ GET /health returns ok:true
  ✔ POST /run-agent returns 400 when agentId is missing
  ✔ POST /run-agent parses JSON outputText
  ✔ POST /run-agent returns raw string when outputText is not JSON
  ✔ POST /run-agent falls back to finalText when outputText absent
  ✔ POST /run-agent returns 500 when gateway throws
```

- [x] **Step 3: Verify the entry point starts without a live gateway**

```bash
cd runner && OPENCLAW_GATEWAY_TOKEN=test node server.js &
sleep 1 && curl -s http://localhost:3001/health && kill %1
```

Expected: `{"ok":true}` — the server starts and responds to health checks without attempting a WS connection (connect is lazy, on first `/run-agent`).

- [x] **Step 4: Commit**

```bash
git add runner/server.js runner/test/server.test.js
git commit -m "feat(runner): rewrite server using GatewayClient, drop @openclaw/sdk"
```
