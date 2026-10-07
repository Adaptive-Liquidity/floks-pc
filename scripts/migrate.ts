/**
 * Apply migrations/*.sql in filename order.
 * Records each file in schema_migrations. Does not connect unless run directly.
 * Refuses to print DATABASE_URL.
 */

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SCHEMA_MIGRATIONS_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;

type PgClient = {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: Array<{ id: string }> }>;
  end(): Promise<void>;
};

type PgModule = {
  Client: new (config: { connectionString: string }) => PgClient;
};

export function listMigrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => /^\d+.+\.sql$/u.test(name))
    .sort((a, b) => a.localeCompare(b));
}

function loadPg(): PgModule {
  const require = createRequire(new URL("../web/package.json", import.meta.url));
  return require("pg") as PgModule;
}

export async function applyMigrations(databaseUrl: string, migrationsDir: string): Promise<string[]> {
  const client = new (loadPg().Client)({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(SCHEMA_MIGRATIONS_SQL);
    const existing = new Set((await client.query("SELECT id FROM schema_migrations")).rows.map((row) => row.id));
    for (const name of listMigrationFiles(migrationsDir)) {
      if (existing.has(name)) continue;
      const sql = readFileSync(path.join(migrationsDir, name), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [name]);
        await client.query("COMMIT");
        applied.push(name);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
    return applied;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    console.error("DATABASE_URL is required. No migration was applied.");
    process.exitCode = 1;
    return;
  }
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const applied = await applyMigrations(databaseUrl, dir);
  console.log(applied.length === 0 ? "migrations: already current" : `migrations applied: ${applied.join(", ")}`);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  void main();
}
