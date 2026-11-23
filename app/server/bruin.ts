// Bridge between the live session and the Bruin pipeline in /bruin.
// Each finished session is written as JSON; `bruin run` ingests it into DuckDB and
// builds the scorecard + founder profile that the agents read as memory next time.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";

const here = path.dirname(fileURLToPath(import.meta.url));
// PM_BRUIN_DIR lets tests point at a scratch copy so they never touch real session data.
export const BRUIN_DIR = process.env.PM_BRUIN_DIR || path.resolve(here, "../../bruin");
const SESSIONS_DIR = path.join(BRUIN_DIR, "data/sessions");
const DB_PATH = path.join(BRUIN_DIR, "behind_the_glass.duckdb");

export function writeSession(id: string, data: unknown) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SESSIONS_DIR, `${id}.json`), JSON.stringify(data, null, 2));
}

export function runBruin(): Promise<{ ok: boolean; log: string }> {
  const bin = process.env.BRUIN_BIN || "bruin";
  return new Promise((resolve) => {
    let log = "";
    // .bruin.yml lives next to the pipeline (not at the git root), so point Bruin at it explicitly.
    const child = spawn(bin, ["run", "--config-file", path.join(BRUIN_DIR, ".bruin.yml"), "."], { cwd: BRUIN_DIR, env: process.env });
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    child.on("error", (e: NodeJS.ErrnoException) =>
      resolve({
        ok: false,
        log:
          e.code === "ENOENT"
            ? "Bruin CLI not found. Install it: curl -LsSf https://getbruin.com/install/cli | sh"
            : String(e),
      }),
    );
    child.on("close", (code) => resolve({ ok: code === 0, log: log.slice(-4000) }));
  });
}

async function query(sql: string, values: string[] = []) {
  if (!fs.existsSync(DB_PATH)) return [];
  const inst = await DuckDBInstance.create(DB_PATH, { access_mode: "READ_ONLY" });
  const conn = await inst.connect();
  try {
    const reader = await conn.runAndReadAll(sql, values);
    return reader.getRowObjectsJson() as Record<string, string | number | boolean | null>[];
  } finally {
    conn.closeSync();
    inst.closeSync();
  }
}

export async function scorecardFor(sessionId: string) {
  const rows = await query("SELECT * FROM pm.scorecard WHERE session_id = ?", [sessionId]);
  return rows[0] ?? null;
}

export async function waterfallFor(sessionId: string) {
  const rows = await query(
    "SELECT version, exit_value, founder_take, founder_take_clean_terms FROM pm.exit_waterfall WHERE session_id = ? ORDER BY version, exit_value",
    [sessionId],
  );
  return rows.map((r) => ({
    version: String(r.version),
    exit_value: Number(r.exit_value),
    founder_take: Number(r.founder_take),
    founder_take_clean_terms: Number(r.founder_take_clean_terms),
  }));
}

// Output of the Python Monte Carlo asset (pm.exit_simulation).
export async function simulationFor(sessionId: string) {
  const rows = await query(
    "SELECT version, p50_take, mean_cost_of_terms, wipeout_pct, simulations FROM pm.exit_simulation WHERE session_id = ? ORDER BY version",
    [sessionId],
  );
  return rows.map((r) => ({
    version: String(r.version),
    p50_take: Number(r.p50_take),
    mean_cost_of_terms: Number(r.mean_cost_of_terms),
    wipeout_pct: Number(r.wipeout_pct),
    simulations: Number(r.simulations),
  }));
}

export async function weakSpotsFor(founderKey: string) {
  const rows = await query(
    "SELECT topic, times FROM pm.weak_spots WHERE founder_key = ? ORDER BY times DESC LIMIT 5",
    [founderKey],
  );
  return rows.map((r) => ({ topic: String(r.topic), times: Number(r.times) }));
}

// Memory the panel carries into the next session with the same founder.
export async function memoryFor(founderKey: string): Promise<string | null> {
  try {
    const prof = await query("SELECT * FROM pm.founder_profile WHERE founder_key = ?", [founderKey]);
    if (!prof.length) return null;
    const p = prof[0];
    const weak = await weakSpotsFor(founderKey);
    const weakText = weak.map((w) => `${w.topic.replace(/_/g, " ")} (${w.times}x)`).join(", ");
    return `You have met this founder ${p.sessions} time(s) before. Last outcome: ${p.last_outcome}. Founder kept ${p.last_founder_pct}% after the last deal (seed benchmark: about ${p.benchmark_founder_pct}%). Weak spots the partners logged before: ${weakText || "none recorded"}. ${p.concession_note ?? ""}`.trim();
  } catch {
    return null;
  }
}
