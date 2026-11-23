/* @bruin
name: pm.exit_waterfall
type: duckdb.sql
description: What the founders take home at different exit values under the actual terms versus clean terms (1x non-participating) at the same price. The gap is what the terms cost.
materialization:
  type: table
depends:
  - pm.term_outcomes
@bruin */
WITH exits AS (SELECT * FROM (VALUES (20000000.0), (50000000.0), (100000000.0), (500000000.0)) v(exit_value)),
calc AS (
  SELECT
    o.session_id, o.version, e.exit_value, o.investor_pct, o.founder_pct, o.option_pool_pct,
    o.liq_pref_multiple * o.raise_amount AS pref,
    o.participating,
    o.raise_amount
  FROM pm.term_outcomes o CROSS JOIN exits e
),
inv AS (
  SELECT *,
    CASE
      WHEN participating THEN LEAST(exit_value, pref) + investor_pct * GREATEST(exit_value - pref, 0)
      ELSE GREATEST(LEAST(exit_value, pref), investor_pct * exit_value)
    END AS investor_take,
    GREATEST(LEAST(exit_value, raise_amount), investor_pct * exit_value) AS investor_take_clean
  FROM calc
)
SELECT
  session_id, version, exit_value,
  investor_take,
  (exit_value - investor_take) * founder_pct / (founder_pct + option_pool_pct) AS founder_take,
  (exit_value - investor_take_clean) * founder_pct / (founder_pct + option_pool_pct) AS founder_take_clean_terms,
  ((exit_value - investor_take_clean) - (exit_value - investor_take)) * founder_pct / (founder_pct + option_pool_pct) AS cost_of_terms
FROM inv
