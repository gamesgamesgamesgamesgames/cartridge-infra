# Cartridge Analytics — ClickHouse

Self-hosted ClickHouse schema for game-analytics events. A Vercel route inserts
rows into `events`; insert-time `MATERIALIZED VIEW`s roll them up into
`AggregatingMergeTree` tables that HappyView's Lua read-proxy queries. There is
**no cron** — see [`QUERY-INTERFACE.md`](./QUERY-INTERFACE.md) for the read
contract.

```
clickhouse/
├── migrations/
│   ├── 0001_events.sql      raw events table (90-day TTL)
│   └── 0002_rollups.sql     rollup targets + materialized views
├── apply.ts                 migration runner (bun) — used by the test suite
├── apply.test.ts            end-to-end vitest suite
├── package.json             dev-only test harness (NOT part of infra CI)
├── QUERY-INTERFACE.md       read contract for every rollup table
└── README.md
```

> **Deploys apply these migrations via Ansible**, not `bun apply.ts` — see
> `playbooks/clickhouse.yml` and `docs/clickhouse.md`. The `apply.ts`/`bun`
> path below is for local dev and the test suite only.

## Run migrations locally

Start a throwaway ClickHouse:

```bash
docker run --rm -d --name cartridge-ch -p 8123:8123 -p 9000:9000 clickhouse/clickhouse-server:24
```

Apply the migrations (defaults target `http://localhost:8123`, user `default`,
empty password, database `default`):

```bash
cd clickhouse
bun install
bun apply.ts
```

Override the connection via env vars:

```bash
CLICKHOUSE_URL=http://localhost:8123 \
CLICKHOUSE_USER=default \
CLICKHOUSE_PASSWORD= \
CLICKHOUSE_DATABASE=default \
bun apply.ts
```

Re-running is safe: applied files are tracked in a `schema_migrations` table
and skipped on subsequent runs.

Tear down:

```bash
docker rm -f cartridge-ch
```

## Adding a migration

Create the next numbered file in `migrations/` (e.g. `0003_*.sql`). Use
`CREATE TABLE IF NOT EXISTS` / `CREATE MATERIALIZED VIEW IF NOT EXISTS`, and
separate multiple statements with a line containing exactly:

```sql
-- statement-breakpoint
```

Keep each MV's `SELECT` column order identical to its target table's column
order — inserts into the target map positionally.

## Tests

The suite needs a real ClickHouse. Without `CLICKHOUSE_TEST_URL` it is skipped
with a message. It creates an isolated `cartridge_analytics_test_<ts>` database,
applies the migrations, inserts fixtures, asserts every rollup, and drops the
database afterward.

```bash
docker run --rm -d --name cartridge-ch -p 8123:8123 clickhouse/clickhouse-server:24

cd clickhouse
bun install
CLICKHOUSE_TEST_URL=http://localhost:8123 bunx vitest run   # or: bun run test
```

Optional: `CLICKHOUSE_TEST_USER`, `CLICKHOUSE_TEST_PASSWORD`.
