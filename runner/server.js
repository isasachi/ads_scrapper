import express from "express";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
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
    let unsubscribe = () => {};
    try {
      const { agentId, input } = req.body || {};
      if (!agentId) return res.status(400).json({ ok: false, error: "agentId is required" });

      await gw.connect();

      let outputText = "";
      if (typeof gw.onEvent === "function") {
        unsubscribe = gw.onEvent((frame) => {
          const p = frame.payload;
          if (!p) return;
          if (frame.event === "agent" && p.stream === "assistant" && typeof p.data?.text === "string") {
            outputText = p.data.text;
          }
        });
      }

      const agentResult = await gw.request("agent", {
        agentId,
        message: normalizeInput(input),
        idempotencyKey: randomUUID(),
      });
      const runId = agentResult?.runId;
      if (!runId) {
        throw new Error(`agent did not return runId: ${JSON.stringify(agentResult)}`);
      }

      const waitResult = await gw.request("agent.wait", { runId }, 185_000);
      console.log("[agent.wait] result:", JSON.stringify(waitResult));

      const output = outputText ||
        waitResult?.snapshot?.outputText ||
        waitResult?.snapshot?.finalText ||
        waitResult?.output?.text ||
        waitResult?.outputText ||
        waitResult?.finalText ||
        waitResult?.text || "";

      let parsed = output;
      try {
        parsed = JSON.parse(output);
      } catch {}

      res.json({ ok: true, data: parsed, raw: waitResult });
    } catch (error) {
      console.error("[run-agent] error:", error);
      res.status(500).json({ ok: false, error: error?.message || String(error) });
    } finally {
      unsubscribe();
    }
  });

  return app;
}

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
