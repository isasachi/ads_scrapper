import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";

const HANDSHAKE_TIMEOUT_MS = 10_000;

export class GatewayClient {
  #url;
  #token;
  #ws = null;
  #pending = new Map(); // id → { resolve, reject, timer }
  #eventHandlers = new Set();
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

        if (frame.type === "event" && frame.event !== "connect.challenge") {
          for (const handler of this.#eventHandlers) handler(frame);
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
              client: { id: "gateway-client", version: "1.0.0", platform: "linux", mode: "backend" },
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

  onEvent(handler) {
    this.#eventHandlers.add(handler);
    return () => this.#eventHandlers.delete(handler);
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
