// Generates the seven investor portraits with Runware's image inference API.
// Run once from app/: RUNWARE_API_KEY=... npx tsx scripts/generate-portraits.ts  → public/portraits/<agent>.webp
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const STYLE =
  "editorial corporate headshot photograph, head and shoulders, looking at camera, soft key light, dark charcoal studio background with subtle warm rim light, shallow depth of field, 85mm lens, high detail skin texture, natural expression, magazine quality";

const PEOPLE: Record<string, string> = {
  point: "South Asian woman in her late 30s, venture capital partner, warm confident smile, dark hair tied back, emerald green blazer",
  managing: "white man in his early 60s, managing partner of a venture fund, silver hair, calm serious expression, charcoal suit, wire-rim glasses",
  numbers: "East Asian woman in her mid 30s, analytical venture partner, sharp focused expression, straight black hair, deep plum blazer",
  domain: "Nigerian man in his early 40s, product-focused venture partner, curious expression, short hair, round glasses, dark purple sweater over collared shirt",
  skeptic: "white man in his late 40s, devil's advocate venture partner, skeptical raised eyebrow, short brown hair and stubble, dark burgundy blazer, open collar",
  associate: "Scandinavian man in his late 20s, junior venture associate, earnest expression, blond hair, thin glasses, navy blazer",
  counsel: "white woman in her early 50s, general counsel at a venture firm, composed expression, auburn hair, black blazer, thin dark glasses",
};

const key = process.env.RUNWARE_API_KEY;
if (!key) throw new Error("Set RUNWARE_API_KEY");
const out = path.resolve("public/portraits");
fs.mkdirSync(out, { recursive: true });

const tasks = Object.entries(PEOPLE).map(([id, who]) => ({
  id,
  task: {
    taskType: "imageInference",
    taskUUID: randomUUID(),
    positivePrompt: `${who}, ${STYLE}`,
    negativePrompt: "cartoon, illustration, text, watermark, logo, deformed, extra fingers, blurry",
    model: "runware:101@1",
    width: 768,
    height: 768,
    numberResults: 1,
    outputType: "base64Data", // image bytes come back in the response; no second download host
    outputFormat: "WEBP",
    includeCost: true,
  },
}));

// --print-body: print the request JSON instead of sending it (for environments where fetch can't reach the API).
if (process.argv.includes("--print-body")) {
  console.log(JSON.stringify(tasks.map((t) => ({ ...t.task, taskUUID: t.task.taskUUID, _agent: t.id }))));
  process.exit(0);
}

const res = await fetch("https://api.runware.ai/v1", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
  body: JSON.stringify(tasks.map((t) => t.task)),
});
const json = (await res.json()) as { data?: { taskUUID: string; imageBase64Data: string; cost?: number }[]; errors?: unknown };
if (!res.ok || !json.data) throw new Error(`Runware error ${res.status}: ${JSON.stringify(json.errors ?? json)}`);
let cost = 0;
for (const item of json.data) {
  const t = tasks.find((x) => x.task.taskUUID === item.taskUUID)!;
  const img = Buffer.from(item.imageBase64Data, "base64");
  fs.writeFileSync(path.join(out, `${t.id}.webp`), img);
  cost += item.cost ?? 0;
  console.log(`${t.id}.webp  ${(img.length / 1024).toFixed(0)} KB`);
}
console.log(`done, cost $${cost.toFixed(4)}`);
