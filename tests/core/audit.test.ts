import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASSISTANT_ACTOR, CONSOLE_ACTOR, GENESIS_HASH, canonicalJson, type AuditRowBody } from "@/lib/contracts";
import { appendAudit, computeAuditHash, getAuditHead, listAuditRows, sha256Hex, verifyAuditChain } from "@/lib/audit";
import { openTestDb, type TestDb } from "./helpers";

describe("canonicalJson vectors (docs/SPEC.md §7.4)", () => {
  const vectors: [unknown, string, string][] = [
    [{}, "{}", "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"],
    [
      { b: 1, a: { d: null, c: [1, "x", true] } },
      '{"a":{"c":[1,"x",true],"d":null},"b":1}',
      "217d5b489f15468544b928d539ccec3ae0a956c4c1ee42ea520b8073badc223a",
    ],
    [{ a: undefined, b: 2 }, '{"b":2}', "0ab1a6d394cd30195f0642b67ae1180c375ffadf5dd7f39c390668b5fdb6da93"],
    [{ s: "héllo → ✓" }, '{"s":"héllo → ✓"}', "37e36a63a8d61e87c74b3aa145f3a81cf611a11f2166f93229601ced04d59ddc"],
    [
      { d: new Date("2026-10-05T08:01:30.250Z") },
      '{"d":"2026-10-05T08:01:30.250Z"}',
      "61dd9f1e76090f721742e1582cc2f41954672e82bf90aa5e274d28dfd10856c0",
    ],
  ];
  it.each(vectors)("%j", (input, canonical, digest) => {
    expect(canonicalJson(input)).toBe(canonical);
    expect(sha256Hex(canonical)).toBe(digest);
  });
});

describe("hash chain worked example (docs/SPEC.md §7.4)", () => {
  const preview = {
    summary: "Mark bill 'Electricity' (3,000 PKR, due 2026-10-05) as paid",
    changes: [
      {
        entity: "bill",
        id: "c1a2b3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
        op: "update",
        label: "Electricity",
        before: { status: "overdue", paid_at: null },
        after: { status: "paid", paid_at: "2026-10-05T08:01:30.250Z" },
        line: "bill 'Electricity' 3,000 PKR due 2026-10-05: status overdue → paid",
      },
    ],
  };
  const row1: AuditRowBody = {
    seq: 1,
    at: "2026-10-05T08:00:00.000Z",
    actor: ASSISTANT_ACTOR,
    event: "proposed",
    tool: "mark_bill_paid",
    action_id: "7f3d2a9c-5b1e-4c8a-9d6f-1e2b3c4d5e6f",
    input: { bill: "Electricity" },
    result: { status: "needs_confirmation", risk: "confirm", preview },
    prev_hash: GENESIS_HASH,
  };
  const HASH1 = "8d13d950decfe210ea4ac9d033262b26096837c291842609440352aa39434165";
  const HASH2 = "eed2dd5826b2531bfd9d168b9277fa7f58d6f365b1114c44c07281b542f44e73";

  it("row 1 canonical form and hash match the spec", () => {
    expect(canonicalJson(row1)).toBe(
      '{"action_id":"7f3d2a9c-5b1e-4c8a-9d6f-1e2b3c4d5e6f","actor":{"id":"mcp","kind":"assistant","label":"Assistant"},"at":"2026-10-05T08:00:00.000Z","event":"proposed","input":{"bill":"Electricity"},"prev_hash":"0000000000000000000000000000000000000000000000000000000000000000","result":{"preview":{"changes":[{"after":{"paid_at":"2026-10-05T08:01:30.250Z","status":"paid"},"before":{"paid_at":null,"status":"overdue"},"entity":"bill","id":"c1a2b3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d","label":"Electricity","line":"bill \'Electricity\' 3,000 PKR due 2026-10-05: status overdue → paid","op":"update"}],"summary":"Mark bill \'Electricity\' (3,000 PKR, due 2026-10-05) as paid"},"risk":"confirm","status":"needs_confirmation"},"seq":1,"tool":"mark_bill_paid"}',
    );
    expect(computeAuditHash(row1)).toBe(HASH1);
  });

  it("row 2 chains from hash 1", () => {
    const row2: AuditRowBody = {
      seq: 2,
      at: "2026-10-05T08:01:30.250Z",
      actor: CONSOLE_ACTOR,
      event: "executed",
      tool: "mark_bill_paid",
      action_id: row1.action_id,
      input: row1.input,
      result: {
        status: "executed",
        risk: "confirm",
        preview,
        result: {
          bill: { id: "c1a2b3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", name: "Electricity", status: "paid", paid_at: "2026-10-05T08:01:30.250Z" },
        },
      },
      prev_hash: HASH1,
    };
    expect(computeAuditHash(row2)).toBe(HASH2);
  });
});

describe("audit_log in the database", () => {
  let t: TestDb;
  const at = (s: number) => new Date(Date.UTC(2026, 9, 5, 8, 0, s));

  beforeAll(async () => {
    t = await openTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("verifies an empty log as intact at genesis", async () => {
    const v = await verifyAuditChain(t.db);
    expect(v).toMatchObject({ intact: true, rows: 0, last_seq: 0, last_hash: GENESIS_HASH, first_bad_seq: null, reason: null });
  });

  it("appends chained rows that verify and round-trip through the driver", async () => {
    const first = await t.db.transaction((tx) =>
      appendAudit(tx, { at: at(0), actor: ASSISTANT_ACTOR, event: "proposed", tool: "mark_bill_paid", action_id: "7f3d2a9c-5b1e-4c8a-9d6f-1e2b3c4d5e6f", input: { bill: "Electricity", n: 1.5, u: "héllo → ✓" }, result: { status: "needs_confirmation" } }),
    );
    expect(first.seq).toBe(1);
    expect(first.prev_hash).toBe(GENESIS_HASH);
    const second = await t.db.transaction((tx) =>
      appendAudit(tx, { at: at(1), actor: CONSOLE_ACTOR, event: "executed", tool: "mark_bill_paid", action_id: first.action_id, input: { bill: "Electricity" }, result: { status: "executed", when: new Date("2026-10-05T08:00:01.000Z") } }),
    );
    expect(second.prev_hash).toBe(first.hash);
    const third = await t.db.transaction((tx) =>
      appendAudit(tx, { at: at(2), actor: CONSOLE_ACTOR, event: "rejected", tool: "run_routine", action_id: null, input: {}, result: null }),
    );
    expect(third.seq).toBe(3);

    const v = await verifyAuditChain(t.db);
    expect(v).toMatchObject({ intact: true, rows: 3, last_seq: 3, last_hash: third.hash });
    expect(await getAuditHead(t.db)).toEqual({ seq: 3, hash: third.hash, rows: 3 });

    const byAction = await listAuditRows(t.db, { actionId: first.action_id! });
    expect(byAction.map((r) => r.seq)).toEqual([2, 1]);
    const page = await listAuditRows(t.db, { limit: 1, beforeSeq: 3 });
    expect(page.map((r) => r.seq)).toEqual([2]);
    expect(page[0].at).toBe("2026-10-05T08:00:01.000Z");
  });

  it("stops at the row cap", async () => {
    const v = await verifyAuditChain(t.db, { maxRows: 2 });
    expect(v).toMatchObject({ intact: true, rows: 2, last_seq: 2 });
  });

  it("refuses UPDATE and DELETE through the trigger", async () => {
    await expect(t.db.query("UPDATE audit_log SET tool = 'x' WHERE seq = 1")).rejects.toThrow(/append-only/);
    await expect(t.db.query("DELETE FROM audit_log WHERE seq = 1")).rejects.toThrow(/append-only/);
  });

  it("detects a tampered row, a broken link and a gap", async () => {
    await t.db.exec("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update");
    try {
      const original = await t.db.query<{ input: Record<string, unknown> }>("SELECT input FROM audit_log WHERE seq = 2");
      await t.db.query(`UPDATE audit_log SET input = '{"bill":"Gas"}'::jsonb WHERE seq = 2`);
      expect(await verifyAuditChain(t.db)).toMatchObject({ intact: false, first_bad_seq: 2, reason: "hash_mismatch", rows: 1, last_seq: 1 });
      await t.db.query(`UPDATE audit_log SET input = $1::jsonb WHERE seq = 2`, [original.rows[0].input]);
      expect((await verifyAuditChain(t.db)).intact).toBe(true);

      const third = await t.db.query<{ prev_hash: string }>("SELECT prev_hash FROM audit_log WHERE seq = 3");
      await t.db.query("UPDATE audit_log SET prev_hash = $1 WHERE seq = 3", ["1".repeat(64)]);
      expect(await verifyAuditChain(t.db)).toMatchObject({ intact: false, first_bad_seq: 3, reason: "prev_hash_mismatch" });
      await t.db.query("UPDATE audit_log SET prev_hash = $1 WHERE seq = 3", [third.rows[0].prev_hash]);
      expect((await verifyAuditChain(t.db)).intact).toBe(true);

      await t.db.query("DELETE FROM audit_log WHERE seq = 2");
      expect(await verifyAuditChain(t.db)).toMatchObject({ intact: false, first_bad_seq: 3, reason: "seq_gap" });
    } finally {
      await t.db.exec("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update");
    }
  });
});
