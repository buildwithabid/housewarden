import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED_ACTOR } from "@/lib/contracts";
import { listAuditRows, verifyAuditChain } from "@/lib/audit";
import { getHousehold, listBills, listDevices, listMembers } from "@/lib/domain";
import { resetDatabase, seedDemo } from "@/lib/seed";
import { T0, count, openTestDb, type TestDb } from "./helpers";

describe("seedDemo", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await openTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("loads the Ali family once and audits it", async () => {
    expect(await getHousehold(t.db)).toBeNull();
    const result = await seedDemo(t.db, SEED_ACTOR, { now: T0, timezone: "Asia/Karachi", currency: "PKR" });
    expect(result.household).toMatchObject({ name: "Ali family", currency: "PKR", timezone: "Asia/Karachi" });
    expect(result.counts).toEqual({ members: 4, bills: 5, chores: 4, shopping_items: 5, reminders: 2, budget_entries: 9, devices: 2, routines: 1, policies: 1 });

    const members = await listMembers(t.db, result.household.id);
    expect(members.map((m) => [m.name, m.role, m.has_pin])).toEqual([
      ["Abid", "adult", false],
      ["Rabia", "adult", false],
      ["Anabiya", "child", false],
      ["Adlan", "child", false],
    ]);
    const bills = await listBills(t.db, result.household.id, "2026-10-05", "all");
    expect(bills.filter((b) => b.status === "overdue").map((b) => b.name)).toEqual(["Electricity"]);
    expect(bills.find((b) => b.name === "Car insurance")).toMatchObject({ recurrence: "yearly", due_date: "2026-12-04" });
    const devices = await listDevices(t.db, result.household.id);
    expect(devices.map((d) => [d.name, d.kind, d.state])).toEqual([
      ["Front door", "lock", { locked: true }],
      ["Living room", "thermostat", { mode: "cool", target_c: 24 }],
    ]);
    const audit = await listAuditRows(t.db);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ seq: 1, event: "seeded", tool: "seed", actor: SEED_ACTOR, input: {}, result: { counts: result.counts } });
    expect((await verifyAuditChain(t.db)).intact).toBe(true);
  });

  it("refuses to seed twice", async () => {
    await expect(seedDemo(t.db, SEED_ACTOR, { now: T0 })).rejects.toMatchObject({ code: "ALREADY_DONE" });
    expect(await count(t.db, "members")).toBe(4);
    expect(await count(t.db, "audit_log")).toBe(1);
  });

  it("resetDatabase empties everything so the seed can run again", async () => {
    await resetDatabase(t.db);
    expect(await getHousehold(t.db)).toBeNull();
    expect(await count(t.db, "audit_log")).toBe(0);
    const again = await seedDemo(t.db, SEED_ACTOR, { now: T0 });
    expect(again.counts.members).toBe(4);
    expect((await verifyAuditChain(t.db))).toMatchObject({ intact: true, rows: 1 });
  });
});
