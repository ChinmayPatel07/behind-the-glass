/* @bruin
name: pm.scorecard
type: duckdb.sql
description: The debrief scorecard per session - final deal versus Carta benchmarks, what the terms cost at a $100M exit, and how the negotiation moved the first offer.
materialization:
  type: table
depends:
  - pm.sessions
  - pm.term_outcomes
  - pm.exit_waterfall
  - pm.carta_benchmarks
@bruin */
WITH b AS (
  SELECT
    MAX(CASE WHEN metric = 'median_seed_valuation' THEN value END) AS bench_valuation,
    MAX(CASE WHEN metric = 'median_seed_dilution' THEN value END) AS bench_dilution
  FROM pm.carta_benchmarks
),
f AS (SELECT * FROM pm.term_outcomes WHERE version = 'final'),
i AS (SELECT * FROM pm.term_outcomes WHERE version = 'first_offer'),
w AS (SELECT * FROM pm.exit_waterfall WHERE version = 'final' AND exit_value = 100000000)
SELECT
  s.session_id, s.founder_key, s.company, s.outcome, s.founder_turns, s.negotiation_rounds,
  (SELECT COUNT(*) FROM UNNEST(s.votes) AS u(v) WHERE v.vote = 'invest') AS invest_votes,
  len(s.votes) AS total_votes,
  ROUND(f.pre_money / 1e6, 2) AS final_pre_money_m,
  ROUND(i.pre_money / 1e6, 2) AS first_offer_pre_money_m,
  ROUND(b.bench_valuation / 1e6, 1) AS benchmark_seed_valuation_m,
  ROUND(f.investor_pct * 100, 1) AS dilution_pct,
  ROUND(b.bench_dilution * 100, 1) AS benchmark_dilution_pct,
  ROUND(f.founder_pct * 100, 1) AS founder_pct,
  ROUND((f.founder_pct - i.founder_pct) * 100, 1) AS founder_pct_won_in_negotiation,
  f.liq_pref_multiple, f.participating, f.founders_lost_board_majority, f.pro_rata,
  ROUND(w.founder_take / 1e6, 2) AS founder_take_at_100m_m,
  ROUND(w.cost_of_terms / 1e6, 2) AS cost_of_terms_at_100m_m,
  (SELECT COUNT(*) FROM UNNEST(s.concessions) AS u(c) WHERE c.by = 'investors') AS firm_concessions,
  (SELECT COUNT(*) FROM UNNEST(s.concessions) AS u(c) WHERE c.by = 'founder_gave') AS founder_concessions,
  len(s.weak_spots) AS weak_spots_logged
FROM pm.sessions s
CROSS JOIN b
LEFT JOIN f ON f.session_id = s.session_id
LEFT JOIN i ON i.session_id = s.session_id
LEFT JOIN w ON w.session_id = s.session_id
