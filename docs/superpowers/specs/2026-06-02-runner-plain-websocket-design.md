# Runner: replace @openclaw/sdk with plain WebSockets

Date: 2026-06-02

## Goal

Remove the `@openclaw/sdk` dependency from the runner service and replace it with a direct WebSocket connection using the `ws` npm package. The HTTP API surface (`GET /health`, `POST /run-agent`) and all behaviour stay identical.

## Architecture

Three files change, one new file is added:

```
runner/
  gateway.js     ← NEW: GatewayClient (WS lifecycle + request/response)
  server.js      ← REWRITE: same HTTP endpoints, uses GatewayClient
  package.json   ← swap @openclaw/sdk → ws
```

### `gateway.js` — GatewayClient

Owns the full WebSocket lifecycle:

- Opens a WS connection to the gateway URL on demand (lazy, same pattern as today's `ensureConnected`).
- Runs the OpenClaw handshake on every new connection.
- Exposes a single `request(method, params, timeoutMs?)` method that sends a framed request and returns a Promise that resolves with the response payload or rejects on error/timeout.
- On WS close, marks the connection as gone and re-runs the handshake on the next `request` call. No background reconnect loop.

### `server.js` — HTTP server

Kept structurally identical to today. The only change is swapping `OpenClaw` SDK calls for three sequential `gw.request()` calls inside `/run-agent`.

### `package.json`

- Remove: `@openclaw/sdk`
- Add: `ws` (standard WebSocket client for Node.js)

## Data flow

### Handshake (runs once per connection)

```
WS opens
  ← {type:"event", event:"connect.challenge", payload:{nonce, ts}}
  → {type:"req", id:"c1", method:"connect", params:{
       minProtocol: 3, maxProtocol: 4,
       role: "operator",
       scopes: ["operator.read", "operator.write"],
       client: {id:"runner", version:"1.0.0", platform:"linux", mode:"operator"},
       auth: {token}
     }}
  ← {type:"res", id:"c1", ok:true, payload:{type:"hello-ok", ...}}
```

### Per `/run-agent` request

```
→ {type:"req", id:"r1", method:"agents.get",  params:{id: agentId}}
← {type:"res", id:"r1", ok:true, payload:{agent:{...}}}

→ {type:"req", id:"r2", method:"agent",       params:{agentId, input, sessionKey:"main",
                                                        timeoutSecs:120}}
← {type:"res", id:"r2", ok:true, payload:{runId:"..."}}

→ {type:"req", id:"r3", method:"agent.wait",  params:{runId, timeoutSecs:180}}
← {type:"res", id:"r3", ok:true, payload:{status:"completed", outputText:"..."}}
```

Output extraction keeps the existing fallback chain: `outputText || finalText || text`.

### Request correlation

Each request gets a `crypto.randomUUID()` as its `id`. A `Map<id, {resolve, reject, timer}>` holds pending promises. Incoming `res` frames look up the id and settle the promise.

## Error handling

| Scenario | Behaviour |
|---|---|
| `ok:false` response | Reject with `error.message` from the gateway response |
| Request timeout | Reject, delete pending entry; defaults: 30 s for `agents.get`, caller-supplied for `agent` and `agent.wait` |
| WS closes mid-request | All pending promises reject with `"connection lost"` |
| Reconnect | On `close`, set `connected = false`; next call re-runs handshake |
| Handshake timeout | If `connect.challenge` or `hello-ok` takes >10 s, reject the connect promise |

`server.js` needs no new error handling. The existing `try/catch` in `/run-agent` returns `500` with `error.message`, which covers all gateway errors.

The Python backend (`main.py`) is unchanged — it already handles `ok:false` from the runner.

## Out of scope

- Event streaming (`run.events()`) — not used today, not added
- Auto-reconnect background loop — lazy reconnect on next call is sufficient
- Changes to `backend/` or `frontend/`
