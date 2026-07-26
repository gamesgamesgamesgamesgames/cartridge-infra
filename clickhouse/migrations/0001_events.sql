-- Raw game-analytics events.
--
-- This is the exact write contract the Vercel collector inserts against.
-- One row per client event. `ts` is server-stamped UTC. The ONLY visitor
-- identifier is `visitor_hash` (a salted daily hash) — no IP or UA is ever
-- stored. Rows expire after 90 days; long-term aggregates live in the rollup
-- tables (see 0002_rollups.sql).
CREATE TABLE IF NOT EXISTS events
(
	ts DateTime64(3),
	event_type LowCardinality(String),
	game_uri String,
	game_slug String,
	surface LowCardinality(String),
	feed_name LowCardinality(String),
	position UInt16,
	query String,
	referrer_type LowCardinality(String),
	referrer_feed LowCardinality(String),
	referrer_query String,
	referrer_domain String,
	action_type LowCardinality(String),
	visitor_hash String,
	session_id String,
	dwell_ms UInt32,
	scroll_pct UInt8,
	tab LowCardinality(String),
	is_authed UInt8
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (game_slug, event_type, ts)
TTL toDateTime(ts) + INTERVAL 90 DAY
