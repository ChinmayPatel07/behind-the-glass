import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import express from "express";
import type { StartupInfo } from "../src/shared/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
for (const f of [path.resolve(here, "../.env"), path.resolve(here, "../../.env")]) if (fs.existsSync(f)) process.loadEnvFile(f);

const { Session } = await import("./engine.js");
const { realLlm } = await import("./llm.js");
type Llm = typeof realLlm;

export function createApp(llm: Llm = realLlm) {
  const app = express();
  app.use(express.json());
  const sessions = new Map<string, InstanceType<typeof Session>>();

  app.get("/api/health", (_req, res) => res.json({ ok: true, key: Boolean(process.env.ANTHROPIC_API_KEY) }));

  app.post("/api/session", async (req, res) => {
    const b = req.body as Partial<StartupInfo>;
    if (!b.founder_name || !b.company || !b.one_liner)
      return res.status(400).json({ error: "founder_name, company and one_liner are required" });
    const info: StartupInfo = {
      founder_name: b.founder_name,
      company: b.company,
      one_liner: b.one_liner,
      stage: b.stage || "seed",
      raise_amount: Number(b.raise_amount) || 3_000_000,
      traction: b.traction || "",
      extra: b.extra || "",
    };
    const id = randomUUID().slice(0, 8);
    const s = new Session(id, info, llm);
    sessions.set(id, s);
    res.json({ id });
    s.start().catch((e) => console.error(e));
  });

  app.get("/api/session/:id/events", (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).end();
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    s.attach(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    res.on("close", () => clearInterval(ping));
  });

  app.post("/api/session/:id/say", (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).end();
    const text = String(req.body?.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "empty" });
    if (s.busy) return res.status(409).json({ error: "The partners are still talking" });
    res.json({ ok: true });
    s.founderSays(text);
  });

  app.post("/api/session/:id/sign", (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).end();
    res.json({ ok: true });
    s.sign();
  });

  // Production: serve the built frontend.
  const dist = path.resolve(here, "../dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8787;
  createApp().listen(port, () => console.log(`Behind the Glass server on http://localhost:${port}`));
}
