/* @bruin
name: pm.weak_spots
type: duckdb.sql
description: Founder weak spots the partners logged, counted per founder across all their sessions. Feeds the panel's memory.
materialization:
  type: table
depends:
  - pm.sessions
@bruin */
SELECT founder_key, w.topic AS topic, COUNT(*) AS times, MAX(s.ended_at) AS last_seen
FROM pm.sessions s, UNNEST(s.weak_spots) AS u(w)
WHERE w.topic IS NOT NULL
GROUP BY founder_key, w.topic
