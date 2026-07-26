# Query Interface

This is the read contract for Cartridge's game-analytics rollups. The HappyView
Lua read-proxy implements against the tables and queries below.

## How the rollups work

Every row inserted into the raw `events` table is fanned out at **insert time**
by a set of `MATERIALIZED VIEW`s into `AggregatingMergeTree` target tables.
There is **no cron** — the rollups are always current with the last insert.

The target tables store partial **aggregate states**, not final numbers. You
**must** read them back through the matching `-Merge` combinator (and group by
the dimensions you want), otherwise you get opaque binary state blobs.

| Column stored as | Read it with |
|---|---|
| `AggregateFunction(sum, UInt64)` | `sumMerge(col)` |
| `AggregateFunction(count)` | `countMerge(col)` |
| `AggregateFunction(uniq, String)` | `uniqMerge(col)` |
| `AggregateFunction(avg, …)` | `avgMerge(col)` |
| `AggregateFunction(quantile(0.5), …)` | `quantileMerge(0.5)(col)` |

Rules of thumb:

- Always filter by `game_slug` and a `date` range; both are the leading key
  columns, so these filters are cheap.
- `date` is a `Date` (UTC day). Use `date BETWEEN '2026-07-01' AND '2026-07-31'`.
- To build a time series, `GROUP BY date` and `ORDER BY date`.
- UInt64 aggregates come back from the HTTP/JSON interface as **strings** —
  cast to number on the client.

Placeholders below: `{slug}`, `{from}`, `{to}` (inclusive `Date` bounds).

---

## `daily_game_surface`

Impressions, clicks, and unique viewers per discovery surface. Powers CTR.

| Column | Type | Meaning |
|---|---|---|
| `date` | `Date` | UTC day |
| `game_slug` | `String` | game key |
| `surface` | `LowCardinality(String)` | `search` \| `feed` \| `game_page` |
| `feed_name` | `LowCardinality(String)` | feed identifier (`''` when N/A) |
| `impressions` | `AggregateFunction(sum, UInt64)` | impression count |
| `clicks` | `AggregateFunction(sum, UInt64)` | card-click count |
| `uniques` | `AggregateFunction(uniq, String)` | distinct `visitor_hash` |

Daily impressions, clicks, uniques, and CTR time series:

```sql
SELECT
	date,
	sumMerge(impressions)                                   AS impressions,
	sumMerge(clicks)                                        AS clicks,
	uniqMerge(uniques)                                      AS uniques,
	sumMerge(clicks) / nullIf(sumMerge(impressions), 0)     AS ctr
FROM daily_game_surface
WHERE game_slug = {slug} AND date BETWEEN {from} AND {to}
GROUP BY date
ORDER BY date;
```

Break the same window down by surface:

```sql
SELECT
	surface,
	feed_name,
	sumMerge(impressions)                                   AS impressions,
	sumMerge(clicks)                                        AS clicks,
	sumMerge(clicks) / nullIf(sumMerge(impressions), 0)     AS ctr
FROM daily_game_surface
WHERE game_slug = {slug} AND date BETWEEN {from} AND {to}
GROUP BY surface, feed_name
ORDER BY impressions DESC;
```

---

## `daily_game_traffic`

Game-page pageviews and uniques split by referrer source.

| Column | Type | Meaning |
|---|---|---|
| `date` | `Date` | UTC day |
| `game_slug` | `String` | game key |
| `referrer_type` | `LowCardinality(String)` | `feed` \| `search` \| `direct` \| `external` \| `''` |
| `referrer_feed` | `LowCardinality(String)` | source feed (`''` when N/A) |
| `pageviews` | `AggregateFunction(count)` | pageview count |
| `uniques` | `AggregateFunction(uniq, String)` | distinct `visitor_hash` |

Daily pageviews + uniques time series:

```sql
SELECT
	date,
	countMerge(pageviews)   AS pageviews,
	uniqMerge(uniques)      AS uniques
FROM daily_game_traffic
WHERE game_slug = {slug} AND date BETWEEN {from} AND {to}
GROUP BY date
ORDER BY date;
```

Traffic-source split for the window:

```sql
SELECT
	referrer_type,
	countMerge(pageviews)   AS pageviews,
	uniqMerge(uniques)      AS uniques
FROM daily_game_traffic
WHERE game_slug = {slug} AND date BETWEEN {from} AND {to}
GROUP BY referrer_type
ORDER BY pageviews DESC;
```

---

## `daily_game_engagement`

Per-game pageview volume plus dwell-time and scroll-depth quality signals.

| Column | Type | Meaning |
|---|---|---|
| `date` | `Date` | UTC day |
| `game_slug` | `String` | game key |
| `pageviews` | `AggregateFunction(count)` | pageviews (from `pageview` events) |
| `dwell_avg` | `AggregateFunction(avg, UInt32)` | mean `dwell_ms` (from `dwell` events) |
| `dwell_median` | `AggregateFunction(quantile(0.5), UInt32)` | median `dwell_ms` |
| `scroll_avg` | `AggregateFunction(avg, UInt8)` | mean `scroll_pct` |
| `uniques` | `AggregateFunction(uniq, String)` | distinct `visitor_hash` (pageview + dwell) |

Daily engagement time series:

```sql
SELECT
	date,
	countMerge(pageviews)               AS pageviews,
	uniqMerge(uniques)                  AS uniques,
	avgMerge(dwell_avg)                 AS dwell_ms_avg,
	quantileMerge(0.5)(dwell_median)    AS dwell_ms_median,
	avgMerge(scroll_avg)                AS scroll_pct_avg
FROM daily_game_engagement
WHERE game_slug = {slug} AND date BETWEEN {from} AND {to}
GROUP BY date
ORDER BY date;
```

Single rolled-up summary for the whole window (drop `GROUP BY date`):

```sql
SELECT
	countMerge(pageviews)               AS pageviews,
	avgMerge(dwell_avg)                 AS dwell_ms_avg,
	quantileMerge(0.5)(dwell_median)    AS dwell_ms_median,
	avgMerge(scroll_avg)                AS scroll_pct_avg
FROM daily_game_engagement
WHERE game_slug = {slug} AND date BETWEEN {from} AND {to};
```

---

## `daily_game_search_terms`

Impression counts per search query (empty queries are never recorded).

| Column | Type | Meaning |
|---|---|---|
| `date` | `Date` | UTC day |
| `game_slug` | `String` | game key |
| `query` | `String` | search term |
| `impressions` | `AggregateFunction(count)` | impressions under this query |

Top search terms driving impressions in the window:

```sql
SELECT
	query,
	countMerge(impressions) AS impressions
FROM daily_game_search_terms
WHERE game_slug = {slug} AND date BETWEEN {from} AND {to}
GROUP BY query
ORDER BY impressions DESC
LIMIT 25;
```

---

## `daily_game_actions`

Engagement action counts per action type.

| Column | Type | Meaning |
|---|---|---|
| `date` | `Date` | UTC day |
| `game_slug` | `String` | game key |
| `action_type` | `LowCardinality(String)` | `like` \| `review` \| `list_add` |
| `actions` | `AggregateFunction(count)` | action count |

Action totals for the window:

```sql
SELECT
	action_type,
	countMerge(actions) AS actions
FROM daily_game_actions
WHERE game_slug = {slug} AND date BETWEEN {from} AND {to}
GROUP BY action_type
ORDER BY actions DESC;
```

Daily per-type time series:

```sql
SELECT
	date,
	action_type,
	countMerge(actions) AS actions
FROM daily_game_actions
WHERE game_slug = {slug} AND date BETWEEN {from} AND {to}
GROUP BY date, action_type
ORDER BY date, action_type;
```

---

## `daily_game_tabs`

In-page tab views, derived from `dwell` events that carry a `tab`.

| Column | Type | Meaning |
|---|---|---|
| `date` | `Date` | UTC day |
| `game_slug` | `String` | game key |
| `tab` | `LowCardinality(String)` | in-page tab name |
| `views` | `AggregateFunction(count)` | dwell views on this tab |

Tab popularity for the window:

```sql
SELECT
	tab,
	countMerge(views) AS views
FROM daily_game_tabs
WHERE game_slug = {slug} AND date BETWEEN {from} AND {to}
GROUP BY tab
ORDER BY views DESC;
```
