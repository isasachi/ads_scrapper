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
