/**
 * Migration runner (docs/SPEC.md §10.3). Files db/migrations/NNNN_name.sql are
 * applied in numeric order, each inside one transaction together with its
 * schema_migrations row. Safe to call on every cold start:
 *   - an in-process mutex serialises concurrent callers on the same Db;
 *   - each file's transaction takes pg_advisory_xact_lock(7744) and re-checks
 *     schema_migrations, so two processes sharing a Postgres cannot double-apply;
 *   - the files themselves are idempotent (IF NOT EXISTS / OR REPLACE).
 */
import fs from "node:fs";
import path from "node:path";
import type { MigrationRecord } from "@/lib/contracts";
import type { CoreDb } from "./types";

export const MIGRATION_ADVISORY_LOCK_KEY = 7744;

export interface MigrationFile {
  version: number;
  name: string;
  file: string;
  sql: string;
}

export function defaultMigrationsDir(): string {
  return path.join(process.cwd(), "db", "migrations");
}

const FILE_PATTERN = /^(\d{4})_([A-Za-z0-9_-]+)\.sql$/;

export function listMigrationFiles(dir: string = defaultMigrationsDir()): MigrationFile[] {
  const files: MigrationFile[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const m = FILE_PATTERN.exec(entry);
    if (!m) continue;
    const file = path.join(dir, entry);
    files.push({ version: Number(m[1]), name: m[2], file, sql: fs.readFileSync(file, "utf8") });
  }
  files.sort((a, b) => a.version - b.version);
  for (let i = 1; i < files.length; i++) {
    if (files[i].version === files[i - 1].version) {
      throw new Error(`Duplicate migration version ${files[i].version}: ${files[i - 1].file} and ${files[i].file}`);
    }
  }
  return files;
}

const BOOTSTRAP_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version     integer      PRIMARY KEY,
  name        text         NOT NULL,
  applied_at  timestamptz  NOT NULL DEFAULT now()
);`;

const inflight = new WeakMap<CoreDb, Promise<unknown>>();

/** Serialises `fn` with every other migrate() call on the same Db. */
function withMutex<T>(db: CoreDb, fn: () => Promise<T>): Promise<T> {
  const previous = inflight.get(db) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  inflight.set(
    db,
    next.catch(() => undefined),
  );
  return next;
}

interface MigrationRow extends Record<string, unknown> {
  version: number;
  name: string;
  applied_at: Date;
}

/** Applied migrations, oldest first. */
export async function listAppliedMigrations(db: CoreDb): Promise<MigrationRecord[]> {
  await db.exec(BOOTSTRAP_SQL);
  const res = await db.query<MigrationRow>("SELECT version, name, applied_at FROM schema_migrations ORDER BY version");
  return res.rows.map((r) => ({ version: r.version, name: r.name, applied_at: r.applied_at.toISOString() }));
}

export interface MigrateOptions {
  dir?: string;
}

/** Applies every pending migration. Returns the records it applied (empty when up to date). */
export function migrate(db: CoreDb, options: MigrateOptions = {}): Promise<MigrationRecord[]> {
  return withMutex(db, async () => {
    const files = listMigrationFiles(options.dir);
    await db.exec(BOOTSTRAP_SQL);
    const applied: MigrationRecord[] = [];
    for (const file of files) {
      const record = await db.transaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);
        const existing = await tx.query<{ version: number }>("SELECT version FROM schema_migrations WHERE version = $1", [
          file.version,
        ]);
        if (existing.rows.length > 0) return null;
        await tx.exec(file.sql);
        const inserted = await tx.query<MigrationRow>(
          "INSERT INTO schema_migrations (version, name) VALUES ($1, $2) RETURNING version, name, applied_at",
          [file.version, file.name],
        );
        const row = inserted.rows[0];
        return { version: row.version, name: row.name, applied_at: row.applied_at.toISOString() } satisfies MigrationRecord;
      });
      if (record) applied.push(record);
    }
    return applied;
  });
}
