-- Insert-time rollups. Each raw event is fanned out by a MATERIALIZED VIEW
-- into an AggregatingMergeTree target that stores partial aggregate STATES.
-- There is NO cron: aggregation happens synchronously with every insert into
-- `events`. Read the rollups with the matching `-Merge` combinators (see
-- QUERY-INTERFACE.md).
--
-- Every MV SELECT lists its columns in the SAME order as its target table so
-- the insert maps correctly. Rollups keep a long (730 day) TTL, well beyond
-- the 90-day raw retention.

-- 1. daily_game_surface: impressions/clicks/uniques per surface + feed.
CREATE TABLE IF NOT EXISTS daily_game_surface
(
	date Date,
	game_slug String,
	surface LowCardinality(String),
	feed_name LowCardinality(String),
	impressions AggregateFunction(sum, UInt64),
	clicks AggregateFunction(sum, UInt64),
	uniques AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (game_slug, date, surface, feed_name)
TTL date + INTERVAL 730 DAY
-- statement-breakpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_game_surface_mv
TO daily_game_surface
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

-- 2. daily_game_traffic: pageviews + uniques split by referrer.
CREATE TABLE IF NOT EXISTS daily_game_traffic
(
	date Date,
	game_slug String,
	referrer_type LowCardinality(String),
	referrer_feed LowCardinality(String),
	pageviews AggregateFunction(count),
	uniques AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (game_slug, date, referrer_type, referrer_feed)
TTL date + INTERVAL 730 DAY
-- statement-breakpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_game_traffic_mv
TO daily_game_traffic
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

-- 3. daily_game_engagement: pageviews + dwell/scroll stats per game.
-- A single MV handles both the `pageview` and `dwell` event types using the
-- `-StateIf` combinators, which keeps every column positionally aligned with
-- the target table (a pair of partial MVs would rely on positional defaults
-- and is easy to get subtly wrong).
CREATE TABLE IF NOT EXISTS daily_game_engagement
(
	date Date,
	game_slug String,
	pageviews AggregateFunction(count),
	dwell_avg AggregateFunction(avg, UInt32),
	dwell_median AggregateFunction(quantile(0.5), UInt32),
	scroll_avg AggregateFunction(avg, UInt8),
	uniques AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
ORDER BY (game_slug, date)
TTL date + INTERVAL 730 DAY
-- statement-breakpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_game_engagement_mv
TO daily_game_engagement
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

-- 4. daily_game_search_terms: impression counts per search query.
CREATE TABLE IF NOT EXISTS daily_game_search_terms
(
	date Date,
	game_slug String,
	query String,
	impressions AggregateFunction(count)
)
ENGINE = AggregatingMergeTree
ORDER BY (game_slug, date, query)
TTL date + INTERVAL 730 DAY
-- statement-breakpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_game_search_terms_mv
TO daily_game_search_terms
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

-- 5. daily_game_actions: engagement action counts per type.
CREATE TABLE IF NOT EXISTS daily_game_actions
(
	date Date,
	game_slug String,
	action_type LowCardinality(String),
	actions AggregateFunction(count)
)
ENGINE = AggregatingMergeTree
ORDER BY (game_slug, date, action_type)
TTL date + INTERVAL 730 DAY
-- statement-breakpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_game_actions_mv
TO daily_game_actions
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

-- 6. daily_game_tabs: dwell views per in-page tab.
CREATE TABLE IF NOT EXISTS daily_game_tabs
(
	date Date,
	game_slug String,
	tab LowCardinality(String),
	views AggregateFunction(count)
)
ENGINE = AggregatingMergeTree
ORDER BY (game_slug, date, tab)
TTL date + INTERVAL 730 DAY
-- statement-breakpoint
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_game_tabs_mv
TO daily_game_tabs
AS
SELECT
	toDate(ts) AS date,
	game_slug,
	tab,
	countState() AS views
FROM events
WHERE event_type = 'dwell' AND tab != ''
GROUP BY date, game_slug, tab
