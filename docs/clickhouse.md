# ClickHouse (Cartridge analytics)

Self-hosted ClickHouse backing Cartridge's analytics. It is **colocated on the
appview host** as its own compose project (no dedicated box, no second Caddy),
and has **two consumers** — which is the whole reason the deployment looks the
way it does.

## Topology

```
                       public internet (TLS)
Vercel collector ───────────────────────────────▶ appview Caddy :443
   (INSERT, user=ingest)                             │  vhost ch.kart.sh
                                                     ▼
                        ┌───────── cartridge_shared docker network ─────────┐
                        │                                                    │
   HappyView ───────────▶ clickhouse:8123 ◀──────────────────────────────────┘
   (SELECT, user=readonly, http://clickhouse:8123)
```

Both consumers reach ClickHouse by container name (`clickhouse:8123`) over a
shared external docker network, **`cartridge_shared`**, that the appview compose
project and the clickhouse compose project both join. No host-IP hairpinning, no
cross-host ports.

1. **Insert path — public.** The Cartridge collector runs on Vercel (public
   internet). appview's **existing Caddy** serves a vhost
   (`clickhouse_ingest_domain`, default `ch.kart.sh`) that
   `reverse_proxy`s to `clickhouse:8123`. Writes are gated by the ClickHouse
   **`ingest`** user (INSERT-only, `CLICKHOUSE_INGEST_PASSWORD`). This is the
   only public entry point.

2. **Read path — in-network.** HappyView (on the same host, same shared network)
   reads via `http://clickhouse:8123` as the **`readonly`** user (SELECT-only,
   `CLICKHOUSE_READONLY_PASSWORD`). No public exposure, no UFW changes — the
   traffic never leaves the docker network.

The ClickHouse container publishes `8123` on `127.0.0.1` only (host-side health
checks / `docker exec`); `8123`/`9000` are otherwise reachable solely on
`cartridge_shared`. The stock passwordless `default` user is locked to
`127.0.0.1`/`::1`, so it is usable only via `docker exec`, never over the network
or the public vhost. No new public UFW ports are opened (Caddy already has
80/443).

## Naming contract (must match the app — do not change)

| Thing | Value |
|-------|-------|
| Database | `cartridge_analytics` |
| Insert-only user | `ingest` — `GRANT INSERT ON cartridge_analytics.*` |
| Read-only user | `readonly` — `GRANT SELECT ON cartridge_analytics.*` (readonly profile) |

## Schema & migrations live here

The analytics **schema now lives in this repo** at `clickhouse/`, decoupled from
Cartridge site deploys — adding a table is an infra op, not a site release. Only
the schema moved; the **Cartridge collector (Vercel) and the dashboard app code
stay in the Cartridge repo** and are unchanged.

```
clickhouse/
├── migrations/
│   ├── 0001_events.sql      raw events table (90-day TTL)
│   └── 0002_rollups.sql     rollup targets + insert-time materialized views
├── QUERY-INTERFACE.md       read contract for every rollup table (used by HappyView's Lua)
├── README.md
├── apply.ts                 bun migration runner — used by the test suite only
├── apply.test.ts            end-to-end vitest suite (schema-correctness)
└── package.json             dev-only test harness; NOT part of infra CI
```

**Deploys apply migrations via Ansible**, not `bun apply.ts`. `playbooks/clickhouse.yml`
copies `clickhouse/migrations/*.sql` to the host and runs each statement through
`docker exec clickhouse clickhouse-client --database cartridge_analytics`,
splitting files on the `-- statement-breakpoint` marker. The `.sql` all use
`CREATE ... IF NOT EXISTS`, so re-running is idempotent; it happens on every
clickhouse deploy, right after `CREATE DATABASE IF NOT EXISTS` + the health check.

### Adding a migration

1. Add the next numbered file, e.g. `clickhouse/migrations/0003_*.sql`. Use
   `CREATE TABLE / MATERIALIZED VIEW IF NOT EXISTS`, and separate statements with
   a line containing exactly `-- statement-breakpoint`. Keep each MV's `SELECT`
   column order identical to its target table (inserts map positionally).
2. Ship it either way:
   - **With the stack:** push — `deploy-clickhouse.yml` watches
     `clickhouse/migrations/**` and applies on deploy.
   - **On demand (no redeploy):** run `deploy-clickhouse.yml` via
     *workflow_dispatch* with **`migrate_only: true`** — it runs only the
     migration/schema tasks (`--tags migrate`) against the running container.
     Locally the equivalent is
     `ansible-playbook playbooks/clickhouse.yml --tags migrate`.

### Tests (decision: harness travels with the schema, but stays out of infra CI)

The vitest suite (`apply.test.ts`) applies the migrations against a live
ClickHouse and asserts every rollup. Because the schema moved here and the
Cartridge-side copies are being deleted, the test would be orphaned if left
behind — so it came along with a minimal `package.json`. It is **dev-only**: no
GitHub workflow runs it, so the infra CI stays JS-free (deploys apply via
Ansible). Run it manually:

```bash
docker run --rm -d --name cartridge-ch -p 8123:8123 clickhouse/clickhouse-server:25.3
cd clickhouse
bun install
CLICKHOUSE_TEST_URL=http://localhost:8123 bunx vitest run   # or: bun run test
docker rm -f cartridge-ch
```

Without `CLICKHOUSE_TEST_URL` the suite skips with a message. `apply.ts` is kept
only because the test imports `applyMigrations()` from it (and it's handy for
local ad-hoc runs); it is never used by the deploy path.

## HappyView read-proxy config (manual — script variables, NOT process env)

HappyView's Lua read-proxy loads `env.*` from the **`happyview_script_variables`
table**, not the container environment — so putting `CLICKHOUSE_*` in
`happyview.env` does nothing. These four values are **seeded manually** (the
deploy does not touch the admin API). Set each via the admin API:

- **Endpoint:** `POST /admin/script-variables`
- **Base path:** HappyView nests **all** routes (incl. `/admin`) under its
  `BASE_PATH`, which is `/hv` in production — so the real URL is
  `http://127.0.0.1:3000/hv/admin/script-variables`. Drop `/hv` only if your
  instance is root-mounted (`BASE_PATH=''`).
- **Auth:** `Authorization: Bearer <admin key>`, where the key has the
  `script-variables:create` scope. Values are encrypted at rest with
  `TOKEN_ENCRYPTION_KEY`.
- **Reach:** HappyView is not published on the host, so run these from a shell
  that can reach the container — e.g. `docker exec -it happyview sh` (curl inside
  the container hits `http://127.0.0.1:3000/hv/...`), or any host/container on the
  `default`/`cartridge_shared` network targeting `http://happyview:3000/hv/...`.

The four variables:

| Script variable | Value |
|-----------------|-------|
| `CLICKHOUSE_URL` | `http://clickhouse:8123` (in-network, shared docker network) |
| `CLICKHOUSE_READ_USER` | `readonly` |
| `CLICKHOUSE_READONLY_PASSWORD` | the `readonly` user's password (`CLICKHOUSE_READONLY_PASSWORD`) |
| `CLICKHOUSE_DATABASE` | `cartridge_analytics` |

```bash
# From inside the happyview container (docker exec -it happyview sh), or any
# peer on the network using http://happyview:3000/hv as $BASE.
BASE=http://127.0.0.1:3000/hv     # root-mounted instance: BASE=http://127.0.0.1:3000
AUTH="Authorization: Bearer <admin key>"   # scope: script-variables:create

curl -X POST "$BASE/admin/script-variables" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"key":"CLICKHOUSE_URL","value":"http://clickhouse:8123"}'
curl -X POST "$BASE/admin/script-variables" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"key":"CLICKHOUSE_READ_USER","value":"readonly"}'
curl -X POST "$BASE/admin/script-variables" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"key":"CLICKHOUSE_READONLY_PASSWORD","value":"<readonly password>"}'
curl -X POST "$BASE/admin/script-variables" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"key":"CLICKHOUSE_DATABASE","value":"cartridge_analytics"}'
```

## Which deploy owns which piece

Both workflows target the **appview host** and both create `cartridge_shared`
idempotently, so either can run first.

| Piece | Owned by | Files |
|-------|----------|-------|
| ClickHouse container/config/users/database + **schema migrations** | `deploy-clickhouse.yml` → `playbooks/clickhouse.yml` | `templates/clickhouse/**`, `clickhouse/migrations/**` |
| Public ingest vhost (Caddy) + shared-net attach | `deploy-appview.yml` → `playbooks/appview{,-deploy}.yml` | `templates/appview/Caddyfile.j2`, `templates/appview/docker-compose.yml.j2` |
| HappyView read-proxy script variables | manual (see above) — not owned by any deploy | — |

Editing the CH stack or a migration triggers the clickhouse workflow; editing the
vhost/compose triggers the appview workflow (it already watches `templates/appview/**`).

## GitHub Actions secrets

`deploy-clickhouse.yml` (targets the appview host — reuses the appview SSH/IP):

| Secret | Purpose |
|--------|---------|
| `APPVIEW_SSH_KEY` | Deploy SSH key (shared appview host) |
| `APPVIEW_SERVER_IP` | appview host IP (the colocation target) |
| `CLICKHOUSE_INGEST_PASSWORD` | Password for the `ingest` user |
| `CLICKHOUSE_READONLY_PASSWORD` | Password for the `readonly` user (also seeded manually as the HappyView `CLICKHOUSE_READONLY_PASSWORD` script variable) |

`deploy-appview.yml` passes `clickhouse_ingest_domain` for the Caddy vhost. It
does not touch the readonly password — that lives on the clickhouse deploy.

Image tag, mem limit, data dir and the passwords are passed as `-e` extra-vars,
matching the Meilisearch pattern.

## Files

- `playbooks/clickhouse.yml` — CH stack + schema migrations (`roles: [base]`); `--tags migrate` for schema-only runs
- `templates/clickhouse/docker-compose.yml.j2` — ClickHouse only (no Caddy), joins `cartridge_shared`
- `templates/clickhouse/config.xml.j2` → `config.d/network.xml` — listen host + memory
- `templates/clickhouse/users.xml.j2` → `users.d/cartridge.xml` — users, grants, quotas
- `clickhouse/` — schema, migrations, read contract, dev-only test harness
- `host_vars_example/clickhouse.main.yml`, `host_vars_example/clickhouse.secrets.yml`
- `.github/workflows/deploy-clickhouse.yml` — deploy + `migrate_only` dispatch
- appview side: `templates/appview/{Caddyfile,docker-compose.yml}.j2`, `playbooks/appview{,-deploy}.yml`, `.github/workflows/deploy-appview.yml`
