/* @bruin
name: pm.term_outcomes
type: duckdb.sql
description: Cap-table math for every term sheet (first offer and final), assuming founders own 100% of common before the round and the option pool is carved out of the pre-money.
materialization:
  type: table
depends:
  - pm.sessions
columns:
  - name: investor_pct
    type: double
    checks:
      - name: non_negative
@bruin */
WITH t AS (
  SELECT session_id, 'first_offer' AS version, initial_terms AS terms FROM pm.sessions WHERE initial_terms IS NOT NULL
  UNION ALL
  SELECT session_id, 'final' AS version, final_terms AS terms FROM pm.sessions WHERE final_terms IS NOT NULL
)
SELECT
  session_id,
  version,
  terms.raise_amount AS raise_amount,
  terms.pre_money AS pre_money,
  terms.pre_money + terms.raise_amount AS post_money,
  terms.raise_amount / (terms.pre_money + terms.raise_amount) AS investor_pct,
  terms.option_pool_pct AS option_pool_pct,
  1 - terms.raise_amount / (terms.pre_money + terms.raise_amount) - terms.option_pool_pct AS founder_pct,
  terms.liq_pref_multiple AS liq_pref_multiple,
  terms.participating AS participating,
  terms.investor_board_seats AS investor_board_seats,
  terms.founder_board_seats AS founder_board_seats,
  terms.independent_board_seats AS independent_board_seats,
  terms.investor_board_seats >= terms.founder_board_seats AS founders_lost_board_majority,
  terms.pro_rata AS pro_rata
FROM t
