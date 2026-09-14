/**
 * Storage entry point (docs/SPEC.md §10).
 *
 *   getDb()     — process-wide singleton (survives Next dev HMR via globalThis),
 *                 adapter chosen by env, migrations applied on first use.
 *   createDb()  — a fresh, migrated Db for tests and scripts.
 *   setDb()     — point the singleton at a Db you created (route-handler tests).
 *   closeDb()   — close and forget the singleton.
 */
import type { DbKind } from "@/lib/contracts";
import { DEFAULTS } from "@/lib/contracts";
import { env, type PgSslMode } from "@/lib/env";
import { migrate, listAppliedMigrations, listMigrationFiles } from "./db/migrate";
import { createPgDb } from "./db/pg";
import { createPgliteDb } from "./db/pglite";
import type { CoreDb, TxQueryable } from "./db/types";

export type { CoreDb, TxQueryable };
export { migrate, listAppliedMigrations, listMigrationFiles };

export interface CreateDbOptions {
  /** Adapter; defaults to the environment's choice. */
  kind?: DbKind;
  /** PGlite data directory or `memory://`. */
  dataDir?: string;
  /** Postgres connection string for the `pg` adapter. */
  connectionString?: string;
  ssl?: PgSslMode;
  /** Apply migrations before returning (default true). */
  migrate?: boolean;
  /** Override the migrations directory (tests). */
  migrationsDir?: string;
}

export async function createDb(options: CreateDbOptions = {}): Promise<CoreDb> {
  const e = env();
  const kind = options.kind ?? (options.connectionString ? "pg" : options.dataDir ? "pglite" : e.db);
  let db: CoreDb;
  if (kind === "pg") {
    const connectionString = options.connectionString ?? e.databaseUrl;
    if (!connectionString) throw new Error("DATABASE_URL is required for the pg adapter");
    db = createPgDb({ connectionString, ssl: options.ssl ?? e.pgSsl });
  } else {
    db = await createPgliteDb(options.dataDir ?? e.dataDir ?? DEFAULTS.DATA_DIR);
  }
  if (options.migrate ?? true) {
    try {
      await migrate(db, { dir: options.migrationsDir });
    } catch (err) {
      await db.close().catch(() => undefined);
      throw err;
    }
  }
  return db;
}

interface DbSlot {
  promise: Promise<CoreDb> | null;
}

const SLOT_KEY: unique symbol = Symbol.for("housewarden.db");
type GlobalWithSlot = typeof globalThis & { [SLOT_KEY]?: DbSlot };

function slot(): DbSlot {
  const g = globalThis as GlobalWithSlot;
  if (!g[SLOT_KEY]) g[SLOT_KEY] = { promise: null };
  return g[SLOT_KEY];
}

/** The shared, migrated database. Concurrent first callers share one creation. */
export function getDb(): Promise<CoreDb> {
  const s = slot();
  if (!s.promise) {
    s.promise = createDb().catch((err: unknown) => {
      s.promise = null;
      throw err;
    });
  }
  return s.promise;
}

/** Replace (or clear, with null) the singleton. Does not close the previous Db. */
export function setDb(db: CoreDb | null): void {
  slot().promise = db ? Promise.resolve(db) : null;
}

export async function closeDb(): Promise<void> {
  const s = slot();
  const p = s.promise;
  s.promise = null;
  if (p) {
    const db = await p.catch(() => null);
    if (db) await db.close();
  }
}
