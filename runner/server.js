import express from "express";
import { OpenClaw } from "@openclaw/sdk";

const app = express();
app.use(express.json({ limit: "2mb" }));

const oc = new OpenClaw({
  url: process.env.OPENCLAW_GATEWAY_URL || "ws://host.docker.internal:18789",
  token: process.env.OPENCLAW_GATEWAY_TOKEN,
  requestTimeoutMs: 30000,
});

let connected = false;
async function ensureConnected() {
  if (!connected) {
    await oc.connect();
    connected = true;
  }
}

function normalizeInput(input) {
  return typeof input === "string" ? input : JSON.stringify(input);
}

app.get("/health", async (_req, res) => {
  res.json({ ok: true });
});

app.post("/run-agent", async (req, res) => {
  try {
    const { agentId, input } = req.body || {};
    if (!agentId) return res.status(400).json({ ok: false, error: "agentId is required" });

    await ensureConnected();
    const agent = await oc.agents.get(agentId);
    const run = await agent.run({
      input: normalizeInput(input),
      sessionKey: "main",
      timeoutMs: 120000,
    });
    const result = await run.wait({ timeoutMs: 180000 });
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

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`runner listening on :${port}`);
});
