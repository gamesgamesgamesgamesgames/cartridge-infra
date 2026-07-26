-- Fix: run the rollup materialized views with DEFINER rights.
--
-- The MVs in 0002 were created without a SQL SECURITY clause, so they default
-- to INVOKER — they execute as whichever user runs the INSERT into `events`.
-- The `ingest` user is deliberately INSERT-only (it's the public collector
-- credential), so those MV bodies fail with ACCESS_DENIED ("necessary to have
-- the grant SELECT(...) ON cartridge_analytics.events"), and every collected
-- event is silently rejected.
--
-- Recreating each MV with `DEFINER = default SQL SECURITY DEFINER` makes the MV
-- read `events` and write its target as `default` (full access), so `ingest`
-- only needs INSERT on `events` — preserving the insert-only security model.
--
-- These MVs use `TO <target>`, so DROP VIEW removes only the view, NOT the
-- target table or its data. Recreating just re-attaches the insert-time trigger
-- with definer rights; no rollup data is lost. Idempotent + safe to re-run.

DROP VIEW IF EXISTS daily_game_surface_mv
-- statement-breakpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_game_surface_mv
TO daily_game_surface
DEFINER = default SQL SECURITY DEFINER
AS
SELECT
	toDate(ts) AS date,
	game_slug,
	surface,
	feed_name,
	sumState(toUInt64(event_type = 'impression')) AS impressions,
	sumState(toUInt64(event_type = 'card_click')) AS clicks,
	uniqState(visitor_hash) AS uniques
FROM events
WHERE event_type IN ('impression', 'card_click')
GROUP BY date, game_slug, surface, feed_name
-- statement-breakpoint

DROP VIEW IF EXISTS daily_game_traffic_mv
-- statement-breakpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_game_traffic_mv
TO daily_game_traffic
DEFINER = default SQL SECURITY DEFINER
AS
SELECT
	toDate(ts) AS date,
	game_slug,
	referrer_type,
	referrer_feed,
	countState() AS pageviews,
	uniqState(visitor_hash) AS uniques
FROM events
WHERE event_type = 'pageview'
GROUP BY date, game_slug, referrer_type, referrer_feed
-- statement-breakpoint

DROP VIEW IF EXISTS daily_game_engagement_mv
-- statement-breakpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_game_engagement_mv
TO daily_game_engagement
DEFINER = default SQL SECURITY DEFINER
AS
SELECT
	toDate(ts) AS date,
	game_slug,
	countStateIf(event_type = 'pageview') AS pageviews,
	avgStateIf(dwell_ms, event_type = 'dwell') AS dwell_avg,
	quantileStateIf(0.5)(dwell_ms, event_type = 'dwell') AS dwell_median,
	avgStateIf(scroll_pct, event_type = 'dwell') AS scroll_avg,
	uniqState(visitor_hash) AS uniques
FROM events
WHERE event_type IN ('pageview', 'dwell')
GROUP BY date, game_slug
-- statement-breakpoint

DROP VIEW IF EXISTS daily_game_search_terms_mv
-- statement-breakpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_game_search_terms_mv
TO daily_game_search_terms
DEFINER = default SQL SECURITY DEFINER
AS
SELECT
	toDate(ts) AS date,
	game_slug,
	query,
	countState() AS impressions
FROM events
WHERE event_type = 'impression' AND query != ''
GROUP BY date, game_slug, query
-- statement-breakpoint

DROP VIEW IF EXISTS daily_game_actions_mv
-- statement-breakpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_game_actions_mv
TO daily_game_actions
DEFINER = default SQL SECURITY DEFINER
AS
SELECT
	toDate(ts) AS date,
	game_slug,
	action_type,
	countState() AS actions
FROM events
WHERE event_type = 'action'
GROUP BY date, game_slug, action_type
-- statement-breakpoint

DROP VIEW IF EXISTS daily_game_tabs_mv
-- statement-breakpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_game_tabs_mv
TO daily_game_tabs
DEFINER = default SQL SECURITY DEFINER
AS
SELECT
	toDate(ts) AS date,
	game_slug,
	tab,
	countState() AS views
FROM events
WHERE event_type = 'dwell' AND tab != ''
GROUP BY date, game_slug, tab
