/**
 * PGlite adapter: embedded Postgres, single connection, persisted to a
 * directory (default .data/pglite) or ephemeral with `memory://`.
 *
 * Normalisation (docs/SPEC.md §10.2): date (OID 1082) → "YYYY-MM-DD" via a
 * custom parser; int8 is already a number; timestamptz → Date; jsonb → object.
 */
import fs from "node:fs";
import path from "node:path";
import { PGlite, types } from "@electric-sql/pglite";
import type { QueryResult } from "@/lib/contracts";
import { DEFAULTS } from "@/lib/contracts";
import { normaliseParams, type CoreDb, type TxQueryable } from "./types";

type Row = Record<string, unknown>;

function toResult<T extends Row>(res: { rows: T[]; affectedRows?: number }): QueryResult<T> {
  return { rows: res.rows, rowCount: res.rows.length > 0 ? res.rows.length : (res.affectedRows ?? 0) };
}

export async function createPgliteDb(dataDir: string): Promise<CoreDb> {
  const isMemory = dataDir === DEFAULTS.DATA_DIR_MEMORY;
  // turbopackIgnore: the data directory is runtime configuration, not an asset;
  // without the hint Turbopack traces the whole project into the standalone build.
  const resolved = isMemory ? dataDir : path.resolve(/* turbopackIgnore: true */ process.cwd(), dataDir);
  if (!isMemory) fs.mkdirSync(resolved, { recursive: true });

  const pg = await PGlite.create(resolved, {
    parsers: {
      [types.DATE]: (v: string) => v,
      [types.INT8]: (v: string) => Number(v),
    },
  });

  const db: CoreDb = {
    kind: "pglite",
    async query<T extends Row = Row>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>> {
      return toResult(await pg.query<T>(sql, normaliseParams(params)));
    },
    async exec(sql: string): Promise<void> {
      await pg.exec(sql);
    },
    async transaction<T>(fn: (tx: TxQueryable) => Promise<T>): Promise<T> {
      return pg.transaction(async (tx) => {
        const handle: TxQueryable = {
          async query<R extends Row = Row>(sql: string, params?: readonly unknown[]): Promise<QueryResult<R>> {
            return toResult(await tx.query<R>(sql, normaliseParams(params)));
          },
          async exec(sql: string): Promise<void> {
            await tx.exec(sql);
          },
        };
        return fn(handle);
      });
    },
    async close(): Promise<void> {
      if (!pg.closed) await pg.close();
    },
  };
  return db;
}
