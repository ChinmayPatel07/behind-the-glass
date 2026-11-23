/* @bruin
name: pm.founder_profile
type: duckdb.sql
description: What the panel remembers about each founder across sessions; read by the agents at the start of the next session.
materialization:
  type: table
depends:
  - pm.sessions
  - pm.scorecard
  - pm.carta_benchmarks
@bruin */
WITH ranked AS (
  SELECT s.founder_key, s.ended_at, sc.*,
    ROW_NUMBER() OVER (PARTITION BY s.founder_key ORDER BY s.ended_at DESC) AS rn,
    COUNT(*) OVER (PARTITION BY s.founder_key) AS sessions
  FROM pm.sessions s JOIN pm.scorecard sc USING (session_id)
)
SELECT
  r.founder_key,
  r.sessions,
  r.outcome AS last_outcome,
  r.founder_pct AS last_founder_pct,
  ROUND(100 * (1 - (SELECT value FROM pm.carta_benchmarks WHERE metric = 'median_seed_dilution')), 1) AS benchmark_founder_pct,
  CASE
    WHEN r.founder_concessions > r.firm_concessions THEN 'Last time the founder gave ground on more terms than the firm did.'
    WHEN r.firm_concessions > 0 THEN 'Last time the founder won concessions from the firm.'
    ELSE NULL
  END AS concession_note
FROM ranked r
WHERE rn = 1
