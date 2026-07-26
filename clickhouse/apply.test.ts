// Module imports
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Local imports
import { applyMigrations } from "./apply";

const TEST_URL = process.env.CLICKHOUSE_TEST_URL;
const TEST_USER = process.env.CLICKHOUSE_TEST_USER ?? "default";
const TEST_PASSWORD = process.env.CLICKHOUSE_TEST_PASSWORD ?? "";

// A unique, disposable database so the suite never touches real data.
const TEST_DATABASE = `cartridge_analytics_test_${Date.now()}`;

const G1 = "stellar-drift";
const G2 = "pixel-quest";
const D1 = "2026-07-18";
const D2 = "2026-07-19";

// Every column the collector writes. Fixtures override the relevant ones.
type EventRow = {
  ts: string;
  event_type: string;
  game_uri: string;
  game_slug: string;
  surface: string;
  feed_name: string;
  position: number;
  query: string;
  referrer_type: string;
  referrer_feed: string;
  referrer_query: string;
  referrer_domain: string;
  action_type: string;
  visitor_hash: string;
  session_id: string;
  dwell_ms: number;
  scroll_pct: number;
  tab: string;
  is_authed: number;
};

function event(overrides: Partial<EventRow>): EventRow {
  return {
    ts: `${D1} 10:00:00.000`,
    event_type: "impression",
    game_uri: `at://did:plc:example/games.gamesgamesgamesgames.game/${overrides.game_slug ?? G1}`,
    game_slug: G1,
    surface: "search",
    feed_name: "",
    position: 0,
    query: "",
    referrer_type: "",
    referrer_feed: "",
    referrer_query: "",
    referrer_domain: "",
    action_type: "",
    visitor_hash: "v1",
    session_id: "s1",
    dwell_ms: 0,
    scroll_pct: 0,
    tab: "",
    is_authed: 0,
    ...overrides,
  };
}

// Fixture set exercising every event type across two games and two dates.
const FIXTURES: EventRow[] = [
  // --- stellar-drift, 2026-07-18 ---
  // impressions: 'space game' x4, 'sci-fi' x2  (6 total)
  event({
    event_type: "impression",
    surface: "search",
    query: "space game",
    visitor_hash: "v1",
  }),
  event({
    event_type: "impression",
    surface: "search",
    query: "space game",
    visitor_hash: "v2",
  }),
  event({
    event_type: "impression",
    surface: "search",
    query: "space game",
    visitor_hash: "v3",
  }),
  event({
    event_type: "impression",
    surface: "search",
    query: "space game",
    visitor_hash: "v1",
  }),
  event({
    event_type: "impression",
    surface: "search",
    query: "sci-fi",
    visitor_hash: "v1",
  }),
  event({
    event_type: "impression",
    surface: "search",
    query: "sci-fi",
    visitor_hash: "v2",
  }),
  // card clicks x3  ->  CTR = 3/6 = 0.5
  event({ event_type: "card_click", surface: "search", visitor_hash: "v1" }),
  event({ event_type: "card_click", surface: "search", visitor_hash: "v2" }),
  event({ event_type: "card_click", surface: "search", visitor_hash: "v3" }),
  // pageviews: feed x2, search x1, direct x1  (uniques v1..v4 = 4)
  event({
    event_type: "pageview",
    surface: "game_page",
    referrer_type: "feed",
    referrer_feed: "trending",
    visitor_hash: "v1",
  }),
  event({
    event_type: "pageview",
    surface: "game_page",
    referrer_type: "feed",
    referrer_feed: "trending",
    visitor_hash: "v2",
  }),
  event({
    event_type: "pageview",
    surface: "game_page",
    referrer_type: "search",
    visitor_hash: "v3",
  }),
  event({
    event_type: "pageview",
    surface: "game_page",
    referrer_type: "direct",
    visitor_hash: "v4",
  }),
  // dwell: 1000/2000/3000ms, scroll 50/60/70, tabs overview x2 + reviews x1
  event({
    event_type: "dwell",
    surface: "game_page",
    dwell_ms: 1000,
    scroll_pct: 50,
    tab: "overview",
    visitor_hash: "v1",
  }),
  event({
    event_type: "dwell",
    surface: "game_page",
    dwell_ms: 2000,
    scroll_pct: 60,
    tab: "overview",
    visitor_hash: "v2",
  }),
  event({
    event_type: "dwell",
    surface: "game_page",
    dwell_ms: 3000,
    scroll_pct: 70,
    tab: "reviews",
    visitor_hash: "v3",
  }),
  // actions: like x2, review x1
  event({
    event_type: "action",
    surface: "game_page",
    action_type: "like",
    visitor_hash: "v1",
  }),
  event({
    event_type: "action",
    surface: "game_page",
    action_type: "like",
    visitor_hash: "v2",
  }),
  event({
    event_type: "action",
    surface: "game_page",
    action_type: "review",
    visitor_hash: "v3",
  }),

  // --- pixel-quest, 2026-07-19 ---
  // impressions on feed surface with empty query (excluded from search terms)
  event({
    ts: `${D2} 12:00:00.000`,
    game_slug: G2,
    event_type: "impression",
    surface: "feed",
    feed_name: "new-releases",
    query: "",
    visitor_hash: "w1",
  }),
  event({
    ts: `${D2} 12:00:00.000`,
    game_slug: G2,
    event_type: "impression",
    surface: "feed",
    feed_name: "new-releases",
    query: "",
    visitor_hash: "w2",
  }),
  event({
    ts: `${D2} 12:00:00.000`,
    game_slug: G2,
    event_type: "impression",
    surface: "feed",
    feed_name: "new-releases",
    query: "",
    visitor_hash: "w3",
  }),
  // card clicks x3  ->  CTR = 3/3 = 1.0
  event({
    ts: `${D2} 12:00:00.000`,
    game_slug: G2,
    event_type: "card_click",
    surface: "feed",
    feed_name: "new-releases",
    visitor_hash: "w1",
  }),
  event({
    ts: `${D2} 12:00:00.000`,
    game_slug: G2,
    event_type: "card_click",
    surface: "feed",
    feed_name: "new-releases",
    visitor_hash: "w2",
  }),
  event({
    ts: `${D2} 12:00:00.000`,
    game_slug: G2,
    event_type: "card_click",
    surface: "feed",
    feed_name: "new-releases",
    visitor_hash: "w3",
  }),
  // pageviews: external x2 (reddit), direct x1
  event({
    ts: `${D2} 12:00:00.000`,
    game_slug: G2,
    event_type: "pageview",
    surface: "game_page",
    referrer_type: "external",
    referrer_domain: "reddit.com",
    visitor_hash: "w1",
  }),
  event({
    ts: `${D2} 12:00:00.000`,
    game_slug: G2,
    event_type: "pageview",
    surface: "game_page",
    referrer_type: "external",
    referrer_domain: "reddit.com",
    visitor_hash: "w2",
  }),
  event({
    ts: `${D2} 12:00:00.000`,
    game_slug: G2,
    event_type: "pageview",
    surface: "game_page",
    referrer_type: "direct",
    visitor_hash: "w3",
  }),
  // dwell: 500/1500ms  ->  avg 1000, median 1000; both overview
  event({
    ts: `${D2} 12:00:00.000`,
    game_slug: G2,
    event_type: "dwell",
    surface: "game_page",
    dwell_ms: 500,
    scroll_pct: 20,
    tab: "overview",
    visitor_hash: "w1",
  }),
  event({
    ts: `${D2} 12:00:00.000`,
    game_slug: G2,
    event_type: "dwell",
    surface: "game_page",
    dwell_ms: 1500,
    scroll_pct: 40,
    tab: "overview",
    visitor_hash: "w2",
  }),
  // action: list_add x1
  event({
    ts: `${D2} 12:00:00.000`,
    game_slug: G2,
    event_type: "action",
    surface: "game_page",
    action_type: "list_add",
    visitor_hash: "w1",
  }),
];

let client: ClickHouseClient;

// `describe.skip` when there is no test instance to hit.
const describeIfDb = TEST_URL ? describe : describe.skip;

if (!TEST_URL) {
  console.warn(
    "[analytics] CLICKHOUSE_TEST_URL is not set — skipping ClickHouse integration tests.",
  );
}

describeIfDb("ClickHouse analytics schema", () => {
  beforeAll(async () => {
    // Bootstrap client (no database yet) to create the throwaway database.
    const bootstrap = createClient({
      url: TEST_URL!,
      username: TEST_USER,
      password: TEST_PASSWORD,
    });
    await bootstrap.command({
      query: `CREATE DATABASE IF NOT EXISTS ${TEST_DATABASE}`,
    });
    await bootstrap.close();

    client = createClient({
      url: TEST_URL!,
      username: TEST_USER,
      password: TEST_PASSWORD,
      database: TEST_DATABASE,
    });

    await applyMigrations(client);

    // MVs only see inserts made after they exist, so insert AFTER migrating.
    await client.insert({
      table: "events",
      values: FIXTURES,
      format: "JSONEachRow",
    });
  }, 60_000);

  afterAll(async () => {
    if (client) {
      await client.command({
        query: `DROP DATABASE IF EXISTS ${TEST_DATABASE}`,
      });
      await client.close();
    }
  });

  // Small helper: run a query and return parsed rows.
  async function rows<T>(query: string): Promise<T[]> {
    const resultSet = await client.query({ query, format: "JSONEachRow" });
    return resultSet.json<T>();
  }

  it("re-applying migrations is a no-op", async () => {
    const result = await applyMigrations(client);
    expect(result.applied).toEqual([]);
  });

  it("configures a 90-day TTL on the events table", async () => {
    const [{ statement }] = await rows<{ statement: string }>(
      "SHOW CREATE TABLE events",
    );
    expect(statement).toContain("TTL");
    // ClickHouse normalizes `INTERVAL 90 DAY` to `toIntervalDay(90)` in
    // SHOW CREATE, so match the 90-day window in either form.
    expect(statement).toMatch(/toIntervalDay\(90\)|INTERVAL 90 DAY/);
  });

  it("rolls up impressions and clicks, yielding CTR", async () => {
    const [g1] = await rows<{ impressions: string; clicks: string }>(`
			SELECT sumMerge(impressions) AS impressions, sumMerge(clicks) AS clicks
			FROM daily_game_surface
			WHERE game_slug = '${G1}' AND date BETWEEN '${D1}' AND '${D1}'
		`);
    expect(Number(g1.impressions)).toBe(6);
    expect(Number(g1.clicks)).toBe(3);
    expect(Number(g1.clicks) / Number(g1.impressions)).toBeCloseTo(0.5, 5);

    const [g2] = await rows<{ impressions: string; clicks: string }>(`
			SELECT sumMerge(impressions) AS impressions, sumMerge(clicks) AS clicks
			FROM daily_game_surface
			WHERE game_slug = '${G2}' AND date BETWEEN '${D2}' AND '${D2}'
		`);
    expect(Number(g2.impressions)).toBe(3);
    expect(Number(g2.clicks)).toBe(3);
    expect(Number(g2.clicks) / Number(g2.impressions)).toBeCloseTo(1.0, 5);
  });

  it("counts per-day uniques via uniqMerge", async () => {
    const [g1] = await rows<{ uniques: string }>(`
			SELECT uniqMerge(uniques) AS uniques
			FROM daily_game_traffic
			WHERE game_slug = '${G1}' AND date = '${D1}'
		`);
    expect(Number(g1.uniques)).toBe(4);
  });

  it("splits traffic by referrer source", async () => {
    const split = await rows<{ referrer_type: string; pageviews: string }>(`
			SELECT referrer_type, sum(pageviews) AS pageviews
			FROM (
				SELECT referrer_type, countMerge(pageviews) AS pageviews
				FROM daily_game_traffic
				WHERE game_slug = '${G1}' AND date = '${D1}'
				GROUP BY referrer_type, referrer_feed
			)
			GROUP BY referrer_type
			ORDER BY referrer_type
		`);
    const byType = Object.fromEntries(
      split.map((row) => [row.referrer_type, Number(row.pageviews)]),
    );
    expect(byType).toEqual({ direct: 1, feed: 2, search: 1 });

    const [external] = await rows<{ pageviews: string }>(`
			SELECT countMerge(pageviews) AS pageviews
			FROM daily_game_traffic
			WHERE game_slug = '${G2}' AND date = '${D2}' AND referrer_type = 'external'
		`);
    expect(Number(external.pageviews)).toBe(2);
  });

  it("ranks top search terms, excluding empty queries", async () => {
    const terms = await rows<{ query: string; impressions: string }>(`
			SELECT query, countMerge(impressions) AS impressions
			FROM daily_game_search_terms
			WHERE game_slug = '${G1}' AND date = '${D1}'
			GROUP BY query
			ORDER BY impressions DESC
		`);
    expect(terms.map((term) => [term.query, Number(term.impressions)])).toEqual(
      [
        ["space game", 4],
        ["sci-fi", 2],
      ],
    );

    // pixel-quest impressions all had empty queries -> nothing recorded.
    const empty = await rows<{ query: string }>(`
			SELECT query FROM daily_game_search_terms WHERE game_slug = '${G2}'
		`);
    expect(empty).toHaveLength(0);
  });

  it("computes dwell average and median plus scroll depth", async () => {
    const [g1] = await rows<{
      dwell_avg: string;
      dwell_median: string;
      scroll_avg: string;
      pageviews: string;
      uniques: string;
    }>(`
			SELECT
				avgMerge(dwell_avg) AS dwell_avg,
				quantileMerge(0.5)(dwell_median) AS dwell_median,
				avgMerge(scroll_avg) AS scroll_avg,
				countMerge(pageviews) AS pageviews,
				uniqMerge(uniques) AS uniques
			FROM daily_game_engagement
			WHERE game_slug = '${G1}' AND date = '${D1}'
		`);
    expect(Number(g1.dwell_avg)).toBeCloseTo(2000, 5);
    expect(Number(g1.dwell_median)).toBeCloseTo(2000, 5);
    expect(Number(g1.scroll_avg)).toBeCloseTo(60, 5);
    expect(Number(g1.pageviews)).toBe(4);
    // unique visitors across pageview + dwell events = v1..v4
    expect(Number(g1.uniques)).toBe(4);

    const [g2] = await rows<{ dwell_avg: string; dwell_median: string }>(`
			SELECT
				avgMerge(dwell_avg) AS dwell_avg,
				quantileMerge(0.5)(dwell_median) AS dwell_median
			FROM daily_game_engagement
			WHERE game_slug = '${G2}' AND date = '${D2}'
		`);
    expect(Number(g2.dwell_avg)).toBeCloseTo(1000, 5);
    expect(Number(g2.dwell_median)).toBeCloseTo(1000, 5);
  });

  it("counts engagement actions by type", async () => {
    const g1 = await rows<{ action_type: string; actions: string }>(`
			SELECT action_type, countMerge(actions) AS actions
			FROM daily_game_actions
			WHERE game_slug = '${G1}' AND date = '${D1}'
			GROUP BY action_type
			ORDER BY action_type
		`);
    expect(g1.map((row) => [row.action_type, Number(row.actions)])).toEqual([
      ["like", 2],
      ["review", 1],
    ]);

    const [listAdd] = await rows<{ actions: string }>(`
			SELECT countMerge(actions) AS actions
			FROM daily_game_actions
			WHERE game_slug = '${G2}' AND date = '${D2}' AND action_type = 'list_add'
		`);
    expect(Number(listAdd.actions)).toBe(1);
  });

  it("counts in-page tab views from dwell events", async () => {
    const tabs = await rows<{ tab: string; views: string }>(`
			SELECT tab, countMerge(views) AS views
			FROM daily_game_tabs
			WHERE game_slug = '${G1}' AND date = '${D1}'
			GROUP BY tab
			ORDER BY views DESC
		`);
    expect(tabs.map((row) => [row.tab, Number(row.views)])).toEqual([
      ["overview", 2],
      ["reviews", 1],
    ]);
  });
});
