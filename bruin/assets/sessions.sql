/* @bruin
name: pm.sessions
type: duckdb.sql
description: One row per finished Behind the Glass session, ingested from the JSON the app writes to data/sessions/.
materialization:
  type: table
columns:
  - name: session_id
    type: varchar
    checks:
      - name: not_null
      - name: unique
  - name: outcome
    type: varchar
    checks:
      - name: accepted_values
        value: [signed, pass, walked_away, open]
@bruin */
SELECT
  session_id,
  founder_key,
  founder_name,
  company,
  stage,
  CAST(started_at AS TIMESTAMP) AS started_at,
  CAST(ended_at AS TIMESTAMP) AS ended_at,
  outcome,
  founder_turns,
  negotiation_rounds,
  initial_terms,
  final_terms,
  concessions,
  votes,
  weak_spots
FROM read_json('data/sessions/*.json', union_by_name = true, maximum_object_size = 67108864,
  columns = {
    session_id: 'VARCHAR', founder_key: 'VARCHAR', founder_name: 'VARCHAR', company: 'VARCHAR', stage: 'VARCHAR',
    started_at: 'VARCHAR', ended_at: 'VARCHAR', outcome: 'VARCHAR', founder_turns: 'INTEGER', negotiation_rounds: 'INTEGER',
    initial_terms: 'STRUCT(raise_amount DOUBLE, pre_money DOUBLE, liq_pref_multiple DOUBLE, participating BOOLEAN, option_pool_pct DOUBLE, investor_board_seats INTEGER, founder_board_seats INTEGER, independent_board_seats INTEGER, pro_rata BOOLEAN)',
    final_terms: 'STRUCT(raise_amount DOUBLE, pre_money DOUBLE, liq_pref_multiple DOUBLE, participating BOOLEAN, option_pool_pct DOUBLE, investor_board_seats INTEGER, founder_board_seats INTEGER, independent_board_seats INTEGER, pro_rata BOOLEAN)',
    concessions: 'STRUCT(term VARCHAR, "from" VARCHAR, "to" VARCHAR, "by" VARCHAR)[]',
    votes: 'STRUCT(agent VARCHAR, vote VARCHAR, reason VARCHAR)[]',
    weak_spots: 'STRUCT(agent VARCHAR, topic VARCHAR, quote VARCHAR)[]'
  })
