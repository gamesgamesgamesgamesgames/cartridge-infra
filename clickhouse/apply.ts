// Module imports
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type ClickHouseClient } from "@clickhouse/client";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "migrations",
);
const STATEMENT_BREAKPOINT = "-- statement-breakpoint";

export interface ConnectionConfig {
  url: string;
  username: string;
  password: string;
  database: string;
}

/**
 * Builds a ClickHouse client from the standard environment variables, allowing
 * individual fields to be overridden (used by the test suite).
 */
export function createClientFromEnv(
  overrides: Partial<ConnectionConfig> = {},
): ClickHouseClient {
  const config: ConnectionConfig = {
    url: overrides.url ?? process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
    username: overrides.username ?? process.env.CLICKHOUSE_USER ?? "default",
    password: overrides.password ?? process.env.CLICKHOUSE_PASSWORD ?? "",
    database:
      overrides.database ?? process.env.CLICKHOUSE_DATABASE ?? "default",
  };

  return createClient(config);
}

/**
 * Splits a migration file into individual statements on the breakpoint marker,
 * dropping empty fragments.
 */
function splitStatements(sql: string): string[] {
  return sql
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** Reads the migration filenames in lexical (i.e. numeric-prefix) order. */
function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

async function ensureMigrationsTable(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `
			CREATE TABLE IF NOT EXISTS schema_migrations
			(
				version String,
				applied_at DateTime DEFAULT now()
			)
			ENGINE = MergeTree
			ORDER BY version
		`,
  });
}

async function appliedVersions(client: ClickHouseClient): Promise<Set<string>> {
  const resultSet = await client.query({
    query: "SELECT DISTINCT version FROM schema_migrations",
    format: "JSONEachRow",
  });
  const rows = await resultSet.json<{ version: string }>();
  return new Set(rows.map((row) => row.version));
}

/**
 * Applies any pending migrations against the given client. Returns the list of
 * versions that were applied during this run (empty when already up to date).
 */
export async function applyMigrations(
  client: ClickHouseClient,
): Promise<{ applied: string[] }> {
  await ensureMigrationsTable(client);

  const alreadyApplied = await appliedVersions(client);
  const files = listMigrationFiles();
  const applied: string[] = [];

  for (const file of files) {
    if (alreadyApplied.has(file)) {
      console.log(`- ${file} (already applied, skipping)`);
      continue;
    }

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const statements = splitStatements(sql);

    console.log(
      `> ${file} (${statements.length} statement${statements.length === 1 ? "" : "s"})`,
    );

    for (let index = 0; index < statements.length; index += 1) {
      await client.command({ query: statements[index] });
      console.log(`  ✓ statement ${index + 1}/${statements.length}`);
    }

    await client.insert({
      table: "schema_migrations",
      values: [{ version: file }],
      format: "JSONEachRow",
    });
    applied.push(file);
  }

  if (applied.length === 0) {
    console.log("Nothing to apply — schema is up to date.");
  } else {
    console.log(
      `Applied ${applied.length} migration${applied.length === 1 ? "" : "s"}.`,
    );
  }

  return { applied };
}

// Run as a script when invoked directly (`bun apply.ts`).
if ((import.meta as ImportMeta & { main?: boolean }).main) {
  const client = createClientFromEnv();
  try {
    await applyMigrations(client);
  } finally {
    await client.close();
  }
}
