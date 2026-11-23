// Runs every SQL asset of the Bruin pipeline, in dependency order, on DuckDB against a
// fixture session, and checks the cap-table math. Mirrors what `bruin run` executes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(here, "../../bruin/assets");
const ORDER = ["sessions", "term_outcomes", "exit_waterfall", "weak_spots", "scorecard", "founder_profile"];

test("Bruin pipeline SQL builds the scorecard from a session", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-bruin-"));
  fs.mkdirSync(path.join(dir, "data/sessions"), { recursive: true });
  fs.copyFileSync(path.join(here, "fixtures/session-signed.json"), path.join(dir, "data/sessions/t1.json"));
  const prev = process.cwd();
  process.chdir(dir); // assets read data/sessions relative to the pipeline folder, like `bruin run`
  try {
    const db = await DuckDBInstance.create(":memory:");
    const c = await db.connect();
    await c.run("CREATE SCHEMA pm");
    await c.run(`CREATE TABLE pm.carta_benchmarks AS SELECT * FROM read_csv('${path.join(ASSETS, "carta_benchmarks.csv")}')`);
    for (const a of ORDER) {
      const sql = fs.readFileSync(path.join(ASSETS, `${a}.sql`), "utf8").replace(/\/\* @bruin[\s\S]*?@bruin \*\//, "");
      await c.run(`CREATE TABLE pm.${a} AS ${sql}`);
    }
    const [sc] = (await c.runAndReadAll("SELECT * FROM pm.scorecard")).getRowObjectsJS() as Record<string, unknown>[];
    // $3M on $15M pre → 16.7% to investors; 10% pool → founders keep 73.3%
    assert.equal(sc.dilution_pct, 16.7);
    assert.equal(sc.founder_pct, 73.3);
    assert.equal(sc.benchmark_dilution_pct, 19);
    assert.equal(sc.cost_of_terms_at_100m_m, 0); // final terms are clean 1x non-participating
    assert.equal(sc.founder_pct_won_in_negotiation, 8.3);
    const [first] = (await c.runAndReadAll("SELECT cost_of_terms FROM pm.exit_waterfall WHERE version='first_offer' AND exit_value=100000000")).getRowObjectsJS() as { cost_of_terms: number }[];
    // first offer 2x participating on $3M at $12M pre: investor takes 6 + 20% of 94 = 24.8M vs 20M clean
    assert.ok(Math.abs(first.cost_of_terms - 4.8e6 * (0.65 / 0.8)) < 1);
    const prof = (await c.runAndReadAll("SELECT * FROM pm.founder_profile")).getRowObjectsJS();
    assert.equal(prof.length, 1);
    const weak = (await c.runAndReadAll("SELECT topic FROM pm.weak_spots ORDER BY topic")).getRowObjectsJS().map((r) => r.topic);
    assert.deepEqual(weak, ["competition", "unit_economics"]);
  } finally {
    process.chdir(prev);
  }
});
