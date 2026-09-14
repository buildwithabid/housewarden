/**
 * node-postgres adapter for a hosted Postgres (DATABASE_URL).
 *
 * Normalisation (docs/SPEC.md §10.2): int8 (OID 20) → number, date (OID 1082)
 * → "YYYY-MM-DD"; timestamptz and jsonb are already Date and object.
 */
import { Pool, types } from "pg";
import type { QueryResult } from "@/lib/contracts";
import type { PgSslMode } from "@/lib/env";
import { normaliseParams, type CoreDb, type TxQueryable } from "./types";

type Row = Record<string, unknown>;

const INT8_OID = 20;
const DATE_OID = 1082;
let parsersInstalled = false;

function installParsers(): void {
  if (parsersInstalled) return;
  types.setTypeParser(INT8_OID, (v: string) => Number(v));
  types.setTypeParser(DATE_OID, (v: string) => v);
  parsersInstalled = true;
}

export interface PgOptions {
  connectionString: string;
  ssl: PgSslMode;
}

function sslConfig(connectionString: string, mode: PgSslMode): boolean | { rejectUnauthorized: boolean } | undefined {
  switch (mode) {
    case "disable":
      return false;
    case "require":
      return { rejectUnauthorized: true };
    case "no-verify":
      return { rejectUnauthorized: false };
    case "auto": {
      let sslmode: string | null = null;
      try {
        sslmode = new URL(connectionString).searchParams.get("sslmode");
      } catch {
        sslmode = null;
      }
      if (sslmode === null || sslmode === "disable" || sslmode === "allow" || sslmode === "prefer") return undefined;
      return { rejectUnauthorized: sslmode !== "no-verify" };
    }
  }
}

export function createPgDb(options: PgOptions): CoreDb {
  installParsers();
  const pool = new Pool({ connectionString: options.connectionString, ssl: sslConfig(options.connectionString, options.ssl) });

  const db: CoreDb = {
    kind: "pg",
    async query<T extends Row = Row>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>> {
      const res = await pool.query<T>(sql, normaliseParams(params));
      return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
    },
    async exec(sql: string): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query(sql);
      } finally {
        client.release();
      }
    },
    async transaction<T>(fn: (tx: TxQueryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const handle: TxQueryable = {
          async query<R extends Row = Row>(sql: string, params?: readonly unknown[]): Promise<QueryResult<R>> {
            const res = await client.query<R>(sql, normaliseParams(params));
            return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
          },
          async exec(sql: string): Promise<void> {
            await client.query(sql);
          },
        };
        const out = await fn(handle);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The connection is broken; releasing it below discards it.
        }
        throw err;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
  return db;
}
