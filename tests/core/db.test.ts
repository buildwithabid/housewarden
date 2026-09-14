import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb, getDb, listAppliedMigrations, listMigrationFiles, migrate, setDb, type CoreDb } from "@/lib/db";
import { openTestDb, type TestDb } from "./helpers";

function adapterContract(getHandle: () => CoreDb) {
  it("normalises int8 → number, date → string, timestamptz → Date, jsonb → object", async () => {
    const db = getHandle();
    const res = await db.query<{ big: number; c: number; d: string; t: Date; j: { a: number[] } }>(
      `SELECT 1::int8 AS big, count(*) AS c, '2026-10-05'::date AS d, now() AS t, '{"a":[1,2]}'::jsonb AS j FROM (SELECT 1) x`,
    );
    const row = res.rows[0];
    expect(typeof row.big).toBe("number");
    expect(typeof row.c).toBe("number");
    expect(row.d).toBe("2026-10-05");
    expect(row.t).toBeInstanceOf(Date);
    expect(row.j).toEqual({ a: [1, 2] });
    expect(res.rowCount).toBe(1);
  });

  it("serialises Date, object and array parameters", async () => {
    const db = getHandle();
    const res = await db.query<{ ts: Date; j: unknown; arr: unknown }>(
      `SELECT $1::timestamptz AS ts, $2::jsonb AS j, $3::jsonb AS arr`,
      [new Date("2026-10-05T08:01:30.250Z"), { x: [1, { y: "z" }] }, [1, "two", null]],
    );
    expect(res.rows[0].ts.toISOString()).toBe("2026-10-05T08:01:30.250Z");
    expect(res.rows[0].j).toEqual({ x: [1, { y: "z" }] });
    expect(res.rows[0].arr).toEqual([1, "two", null]);
  });

  it("reports rowCount for inserts, updates, deletes and selects", async () => {
    const db = getHandle();
    await db.exec("CREATE TABLE IF NOT EXISTS scratch_contract (a int)");
    await db.query("DELETE FROM scratch_contract");
    const ins = await db.query("INSERT INTO scratch_contract VALUES (1), (2), (3)");
    expect(ins.rowCount).toBe(3);
    const upd = await db.query("UPDATE scratch_contract SET a = a + 1 WHERE a > 1");
    expect(upd.rowCount).toBe(2);
    const sel = await db.query("SELECT a FROM scratch_contract ORDER BY a");
    expect(sel.rowCount).toBe(3);
    expect(sel.rows.map((r) => r.a)).toEqual([1, 3, 4]);
    const del = await db.query("DELETE FROM scratch_contract");
    expect(del.rowCount).toBe(3);
  });

  it("rolls a transaction back when the callback throws", async () => {
    const db = getHandle();
    await db.exec("CREATE TABLE IF NOT EXISTS scratch_tx (a int)");
    await db.query("DELETE FROM scratch_tx");
    await expect(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO scratch_tx VALUES (1)");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const n = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM scratch_tx");
    expect(n.rows[0].n).toBe(0);
    const out = await db.transaction(async (tx) => {
      await tx.query("INSERT INTO scratch_tx VALUES (2)");
      return "committed";
    });
    expect(out).toBe("committed");
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM scratch_tx")).rows[0].n).toBe(1);
  });
}

describe("db adapter (pglite)", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await openTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  adapterContract(() => t.db);
});

describe.skipIf(!process.env.DATABASE_URL_TEST)("db adapter (pg)", () => {
  let db: CoreDb;
  beforeAll(async () => {
    db = await createDb({ kind: "pg", connectionString: process.env.DATABASE_URL_TEST });
  });
  afterAll(async () => {
    await db.close();
  });
  adapterContract(() => db);
});

describe("migrations", () => {
  it("applies every file once and is idempotent on re-run", async () => {
    const t = await openTestDb();
    try {
      const files = listMigrationFiles();
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files[0]).toMatchObject({ version: 1, name: "init" });
      const applied = await listAppliedMigrations(t.db);
      expect(applied.map((m) => m.version)).toEqual(files.map((f) => f.version));
      expect(await migrate(t.db)).toEqual([]);
      expect(await migrate(t.db)).toEqual([]);
      expect((await listAppliedMigrations(t.db)).length).toBe(files.length);
      // the migration file itself is idempotent: re-executing it is a no-op
      await t.db.exec(files[0].sql);
      expect((await listAppliedMigrations(t.db)).length).toBe(files.length);
    } finally {
      await t.close();
    }
  });

  it("never double-applies under concurrent callers", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "housewarden-mig-"));
    const db = await createDb({ kind: "pglite", dataDir: dir, migrate: false });
    try {
      const results = await Promise.all([migrate(db), migrate(db), migrate(db), migrate(db)]);
      const total = results.reduce((n, r) => n + r.length, 0);
      const files = listMigrationFiles();
      expect(total).toBe(files.length);
      expect((await listAppliedMigrations(db)).length).toBe(files.length);
    } finally {
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the schema across re-opening the same data directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "housewarden-reopen-"));
    try {
      const first = await createDb({ kind: "pglite", dataDir: dir });
      await first.query("INSERT INTO household (name, currency, timezone) VALUES ('Persist', 'PKR', 'Asia/Karachi')");
      await first.close();
      const second = await createDb({ kind: "pglite", dataDir: dir });
      try {
        expect(await migrate(second)).toEqual([]);
        const rows = await second.query<{ name: string }>("SELECT name FROM household");
        expect(rows.rows.map((r) => r.name)).toEqual(["Persist"]);
      } finally {
        await second.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("getDb singleton", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("shares one instance across concurrent first callers (in-memory under vitest)", async () => {
    const [a, b] = await Promise.all([getDb(), getDb()]);
    expect(a).toBe(b);
    expect(a.kind).toBe("pglite");
    expect((await listAppliedMigrations(a)).length).toBeGreaterThan(0);
  });

  it("can be pointed at a test database with setDb", async () => {
    const t = await openTestDb();
    try {
      setDb(t.db);
      expect(await getDb()).toBe(t.db);
    } finally {
      setDb(null);
      await t.close();
    }
  });
});
