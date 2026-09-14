/**
 * Test support: one PGlite database in a temporary directory per test file,
 * plus small factories. Never touches .data/.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SEED_ACTOR, type Household } from "@/lib/contracts";
import { createDb, type CoreDb } from "@/lib/db";
import { seedDemo } from "@/lib/seed";

export interface TestDb {
  db: CoreDb;
  dir: string;
  close(): Promise<void>;
}

export async function openTestDb(): Promise<TestDb> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "housewarden-core-"));
  const db = await createDb({ kind: "pglite", dataDir: dir });
  return {
    db,
    dir,
    async close() {
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Seeds the Ali family at a fixed instant and returns the household. */
export async function seedAt(db: CoreDb, now: Date): Promise<Household> {
  const { household } = await seedDemo(db, SEED_ACTOR, { now, timezone: "Asia/Karachi", currency: "PKR" });
  return household;
}

export const T0 = new Date("2026-10-05T08:00:00.000Z");

export function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

export async function count(db: CoreDb, table: string, where = "", params: unknown[] = []): Promise<number> {
  const res = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} ${where}`, params);
  return res.rows[0].n;
}
