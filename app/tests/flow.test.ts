import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerEvent } from "../src/shared/types.js";
import { fakeLlm } from "./fake-llm.js";

// Point the Bruin bridge at a scratch dir and at a missing CLI so no real data is touched.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pm-flow-"));
process.env.PM_BRUIN_DIR = scratch;
process.env.BRUIN_BIN = "bruin-not-installed-for-test";
const { Session } = await import("../server/engine.js");

function collector() {
  const events: ServerEvent[] = [];
  const res = { write: (s: string) => s.startsWith("data: ") && events.push(JSON.parse(s.slice(6))), on: () => {} };
  return { events, res };
}

test("full session: pitch → partner meeting → term sheet → negotiate → sign → debrief", async () => {
  const llm = fakeLlm();
  const s = new Session("t1", { founder_name: "Test", company: "TestCo", one_liner: "x", stage: "seed", raise_amount: 3e6, traction: "", extra: "" }, llm);
  const { events, res } = collector();
  s.attach(res as never);
  await s.start();
  assert.equal(s.phase, "pitch");

  await s.founderSays("Our pitch.");
  assert.ok(s.ledger.some((e) => e.kind === "fact_check"), "associate fact-check logged");
  assert.ok(s.ledger.some((e) => e.kind === "whisper" && e.to === "skeptic"), "whisper logged with target");
  assert.ok(s.ledger.some((e) => e.kind === "weakness" && e.topic === "unit_economics"), "weak spot logged");
  const firstSpeakers = events.filter((e) => e.type === "speak").map((e) => (e as { line: { speaker: string } }).line.speaker);
  assert.ok(firstSpeakers.includes("numbers"), "most urgent agent got the floor");
  assert.ok(!firstSpeakers.includes("counsel"), "counsel stays silent during the pitch");

  await s.founderSays("Answer two.");
  await s.founderSays("Answer three."); // managing partner calls the meeting from turn 3
  assert.equal(s.phase, "termsheet");
  assert.equal(s.votes.length, 7, "all seven partners voted");
  assert.ok(s.terms && s.terms.pre_money === 12e6);

  await s.founderSays("Twelve is too low; we have two other term sheets at sixteen.");
  assert.equal(s.terms!.pre_money, 13e6);
  assert.ok(s.concessions.some((c) => c.term === "pre_money" && c.by === "investors"));
  assert.ok(s.concessions.some((c) => c.term === "participating"));

  await s.sign();
  assert.equal(s.outcome, "signed");
  const debrief = events.find((e) => e.type === "debrief");
  assert.ok(debrief && debrief.type === "debrief");
  assert.equal(debrief.debrief.bruin_ok, false, "missing Bruin CLI is reported, not hidden");
  assert.match(debrief.debrief.bruin_log, /not found/i);
  const saved = JSON.parse(fs.readFileSync(path.join(scratch, "data/sessions/t1.json"), "utf8"));
  assert.equal(saved.outcome, "signed");
  assert.equal(saved.final_terms.pre_money, 13e6);
  assert.equal(saved.votes.length, 7);
  assert.equal(s.busy, false);
});

test("founder input is ignored while the partners are busy", async () => {
  const s = new Session("t2", { founder_name: "T", company: "C", one_liner: "x", stage: "seed", raise_amount: 3e6, traction: "", extra: "" }, fakeLlm({ delayMs: 30 }));
  await s.start();
  const p = s.founderSays("one");
  await s.founderSays("two (should be dropped)");
  await p;
  assert.equal(s.transcript.filter((l) => l.speaker === "founder").length, 1);
});
