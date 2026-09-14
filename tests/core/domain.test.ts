import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASSISTANT_ACTOR, HousewardenError, type Household, type ToolContext } from "@/lib/contracts";
import {
  findBill,
  getBudgetSummary,
  getHouseholdSummary,
  listBills,
  listChores,
  listMembers,
  listPolicies,
  listReminders,
  listRoutines,
  listShopping,
  planAddReminder,
  planClearShoppingList,
  planCompleteChore,
  planMarkBillPaid,
  planRotateChores,
  planRunRoutine,
  planSetDeviceState,
  planUpdateBill,
  totalsByCurrency,
  validateDeviceState,
} from "@/lib/domain";
import { formatAmount, spokenAmount, toMinor } from "@/lib/money";
import { addMonths, daysBetween, monthRange, spokenDate, spokenInstant, todayInZone, zonedTimeToInstant } from "@/lib/time";
import { T0, openTestDb, seedAt, type TestDb } from "./helpers";

const TODAY = "2026-10-05";

describe("time and money helpers", () => {
  it("computes today in the household zone", () => {
    expect(todayInZone(new Date("2026-10-05T20:30:00.000Z"), "Asia/Karachi")).toBe("2026-10-06");
    expect(todayInZone(new Date("2026-10-05T20:30:00.000Z"), "UTC")).toBe("2026-10-05");
  });
  it("converts zone wall-clock to instants", () => {
    expect(zonedTimeToInstant("2026-10-05", "22:30", "Asia/Karachi").toISOString()).toBe("2026-10-05T17:30:00.000Z");
    expect(zonedTimeToInstant("2026-07-01", "09:00", "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedTimeToInstant("2026-01-01", "09:00", "Europe/London").toISOString()).toBe("2026-01-01T09:00:00.000Z");
    const r = monthRange("2026-10", "Asia/Karachi");
    expect(r.start.toISOString()).toBe("2026-09-30T19:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-10-31T19:00:00.000Z");
  });
  it("adds months with clamping like Postgres", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-10-30", 1)).toBe("2026-11-30");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-05", "2026-09-30")).toBe(-5);
  });
  it("speaks dates and instants", () => {
    expect(spokenDate("2026-10-05", TODAY)).toBe("today");
    expect(spokenDate("2026-10-06", TODAY)).toBe("tomorrow");
    expect(spokenDate("2026-10-09", TODAY)).toBe("in four days");
    expect(spokenDate("2026-09-30", TODAY)).toBe("five days ago");
    expect(spokenDate("2026-10-30", TODAY)).toBe("on 30 October");
    expect(spokenDate("2027-01-02", TODAY)).toBe("on 2 January 2027");
    expect(spokenInstant(new Date("2026-10-06T05:00:00.000Z"), "Asia/Karachi", T0)).toBe("tomorrow at 10");
    expect(spokenInstant(new Date("2026-10-05T17:30:00.000Z"), "Asia/Karachi", T0)).toBe("today at 22:30");
  });
  it("formats money", () => {
    expect(toMinor(3000)).toBe(300000);
    expect(toMinor(45.5)).toBe(4550);
    expect(formatAmount(300000, "PKR")).toBe("3,000 PKR");
    expect(formatAmount(4550, "USD")).toBe("45.50 USD");
    expect(spokenAmount(300000, "PKR")).toBe("3,000 rupees");
    expect(spokenAmount(1200, "CHF")).toBe("12 CHF");
  });
});

describe("domain reads and planners on the demo household", () => {
  let t: TestDb;
  let household: Household;
  let ctx: ToolContext;

  beforeAll(async () => {
    t = await openTestDb();
    household = await seedAt(t.db, T0);
    ctx = { db: t.db, household, actor: ASSISTANT_ACTOR, now: T0 };
  });
  afterAll(async () => {
    await t.close();
  });

  it("lists bills with effective status, days_until_due and totals", async () => {
    const unpaid = await listBills(t.db, household.id, TODAY, "unpaid");
    expect(unpaid.map((b) => [b.name, b.status, b.days_until_due])).toEqual([
      ["Electricity", "overdue", -5],
      ["Gas", "due", 4],
      ["School fees", "due", 9],
      ["Internet", "due", 12],
      ["Car insurance", "due", 60],
    ]);
    expect(unpaid[0].amount_formatted).toBe("3,000 PKR");
    expect(totalsByCurrency(unpaid)).toEqual([{ currency: "PKR", amount: 69300, amount_formatted: "69,300 PKR" }]);
    expect(await listBills(t.db, household.id, TODAY, "overdue")).toHaveLength(1);
    expect(await listBills(t.db, household.id, TODAY, "paid")).toHaveLength(0);
    await expect(findBill(t.db, household.id, TODAY, "Watr")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await findBill(t.db, household.id, TODAY, "internet")).name).toBe("Internet");
  });

  it("plans mark_bill_paid with a stable, clock-free preview", async () => {
    const plan = await planMarkBillPaid({ bill: "Electricity", dry_run: false }, ctx);
    expect(plan.preview.changes[0]).toMatchObject({ op: "update", before: { status: "overdue" }, after: { status: "paid" } });
    expect(plan.preview.changes[0].after).not.toHaveProperty("paid_at");
    expect(plan.preview.changes[1]).toMatchObject({ op: "create", after: { due_date: "2026-10-30", amount: 3000 } });
    expect(plan.policyScope).toBe("");
    const again = await planMarkBillPaid({ bill: "Electricity", dry_run: false }, { ...ctx, now: new Date(T0.getTime() + 5 * 60_000) });
    expect(again.preview.changes).toEqual(plan.preview.changes);
    const explicit = await planMarkBillPaid({ bill: "Electricity", paid_at: "2026-10-04T10:00:00.000Z", dry_run: false }, ctx);
    expect(explicit.preview.changes[0].after).toMatchObject({ paid_at: "2026-10-04T10:00:00.000Z" });
  });

  it("plans update_bill with only the changed fields", async () => {
    const plan = await planUpdateBill({ bill: "Gas", amount: 2100, dry_run: false }, ctx);
    expect(plan.preview.changes[0].before).toEqual({ amount: 1800, currency: "PKR" });
    expect(plan.preview.changes[0].after).toEqual({ amount: 2100, currency: "PKR" });
    expect(plan.preview.changes[0].line).toBe("bill 'Gas' 1,800 PKR due 2026-10-09: amount 1,800 PKR → 2,100 PKR");
    await expect(planUpdateBill({ bill: "Gas", amount: 1800, dry_run: false }, ctx)).rejects.toMatchObject({ code: "ALREADY_DONE" });
  });

  it("plans complete_chore and rotate_chores", async () => {
    const chores = await listChores(t.db, household.id);
    expect(chores.map((c) => c.title)).toEqual(["Take out the bins", "Water the plants", "Sort the recycling", "Wash the car"]);
    const done = await planCompleteChore({ chore: "Take out the bins", dry_run: false }, ctx);
    expect(done.preview.changes[1]).toMatchObject({ op: "create", after: { due_date: "2026-10-12", assigned_member: "Adlan", cadence: "weekly" } });
    expect(done.spoken).toBe("mark take out the bins as done and schedule the next one, due in seven days");

    const rotate = await planRotateChores({ dry_run: true }, ctx);
    expect(rotate.preview.summary).toBe("Rotate 4 chores to the next member");
    expect(rotate.preview.changes.map((c) => c.line)).toEqual([
      "chore 'Take out the bins': Adlan → Abid",
      "chore 'Water the plants': Anabiya → Adlan",
      "chore 'Sort the recycling': Rabia → Anabiya",
      "chore 'Wash the car': Abid → Rabia",
    ]);
  });

  it("plans clear_shopping_list for checked and all items", async () => {
    const checked = await planClearShoppingList({ include_unchecked: false, dry_run: false }, ctx);
    expect(checked.preview.changes.map((c) => c.label)).toEqual(["Dish soap"]);
    expect(checked.preview.warnings).toEqual([]);
    const all = await planClearShoppingList({ include_unchecked: true, dry_run: false }, ctx);
    expect(all.preview.summary).toBe("Remove all 5 items from the shopping list (4 not yet bought)");
    expect(all.preview.warnings).toEqual(["4 of these items have not been bought."]);
    expect(all.spoken).toBe("clear all five items from the shopping list, including four you haven't bought");
    expect((await listShopping(t.db, household.id)).map((i) => i.name)).toEqual(["Eggs", "Milk", "Apples", "Rice"]);
  });

  it("validates device state per kind and refuses no-op patches", async () => {
    expect(() => validateDeviceState("thermostat", { mode: "cool", target_c: 99 }, "Living room")).toThrow(HousewardenError);
    await expect(planSetDeviceState({ device: "Living room", state: { target_c: 99 }, dry_run: false }, ctx)).rejects.toMatchObject({ code: "UNSUPPORTED_STATE" });
    await expect(planSetDeviceState({ device: "Front door", state: { locked: true }, dry_run: false }, ctx)).rejects.toMatchObject({ code: "ALREADY_DONE" });
    const plan = await planSetDeviceState({ device: "Living room", state: { mode: "heat", target_c: 21 }, dry_run: false }, ctx);
    expect(plan.preview.changes[0]).toMatchObject({ before: { mode: "cool", target_c: 24 }, after: { mode: "heat", target_c: 21 } });
    expect(plan.policyScope).toBe("thermostat");
    expect(plan.spoken).toBe("set the living room to heat at 21 degrees");
  });

  it("plans run_routine with no-op steps and relative times", async () => {
    const routines = await listRoutines(t.db, household.id);
    expect(routines.map((r) => r.name)).toEqual(["bedtime"]);
    const plan = await planRunRoutine({ routine: "bedtime", dry_run: false }, ctx);
    expect(plan.preview.summary).toBe("Run routine 'bedtime' (3 steps)");
    expect(plan.policyScope).toBe("bedtime");
    expect(plan.preview.changes.map((c) => c.line)).toEqual([
      "device 'Front door' (lock): locked → locked (no change)",
      "device 'Living room' (thermostat): target_c 24°C → 26°C",
      "reminder 'Check the stove is off' at 2026-10-05T17:30:00.000Z: new",
    ]);
    expect(plan.spoken).toBe("run the bedtime routine, which would set the living room to 26 degrees and remind you at 22:30 to check the stove is off; the front door is already locked");
    // after 22:30 the reminder rolls to tomorrow with a warning
    const late = await planRunRoutine({ routine: "bedtime", dry_run: false }, { ...ctx, now: new Date("2026-10-05T18:00:00.000Z") });
    expect(late.preview.changes[2].line).toContain("2026-10-06T17:30:00.000Z");
    expect(late.preview.warnings.some((w) => w.includes("tomorrow"))).toBe(true);
  });

  it("rejects reminders in the past", async () => {
    await expect(planAddReminder({ text: "x", at: "2026-10-05T07:00:00.000Z", dry_run: false }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    const plan = await planAddReminder({ text: "Call the electrician", at: "2026-10-06T10:00:00+05:00", for_member: "Abid", dry_run: false }, ctx);
    expect(plan.preview.changes[0].after).toMatchObject({ at: "2026-10-06T05:00:00.000Z", member: "Abid" });
    expect(plan.spoken).toBe("set a reminder for Abid: Call the electrician, tomorrow at 10");
  });

  it("summarises the budget by month", async () => {
    const summary = await getBudgetSummary(t.db, household, T0);
    expect(summary.month).toBe("2026-10");
    expect(summary.total).toEqual({ amount: 21450, amount_formatted: "21,450 PKR" });
    expect(summary.by_category[0]).toMatchObject({ category: "Groceries", amount: 10000, share: 0.466 });
    expect(summary.previous_month).toEqual({ month: "2026-09", total: { amount: 18200, amount_formatted: "18,200 PKR" } });
    expect(summary.bills_paid).toEqual({ count: 0, amount: 0, amount_formatted: "0 PKR" });
    expect(summary.entries).toHaveLength(6);
    const previous = await getBudgetSummary(t.db, household, T0, "2026-09");
    expect(previous.total.amount).toBe(18200);
    expect(previous.entries).toHaveLength(3);
  });

  it("summarises the household", async () => {
    const s = await getHouseholdSummary(t.db, household, T0);
    expect(s.household).toEqual({ name: "Ali family", currency: "PKR", timezone: "Asia/Karachi", today: TODAY });
    expect(s.counts).toEqual({
      members: 4,
      bills_due: 4,
      bills_overdue: 1,
      chores_open: 4,
      chores_due_today: 2,
      shopping_to_buy: 4,
      reminders_next_24h: 1,
      pending_confirmations: 0,
    });
    expect(s.overdue_bills.map((b) => b.name)).toEqual(["Electricity"]);
    expect(s.due_today.chores.map((c) => c.title)).toEqual(["Take out the bins", "Water the plants"]);
    expect(s.devices).toHaveLength(2);
    expect(s.audit).toMatchObject({ rows: 1, chain_intact: true });
    expect((await listReminders(t.db, household.id, { withinHours: 24, now: T0 })).map((r) => r.text)).toEqual(["Call the electrician"]);
    expect((await listMembers(t.db, household.id)).map((m) => m.name)).toEqual(["Abid", "Rabia", "Anabiya", "Adlan"]);
    const policies = await listPolicies(t.db, household.id);
    expect(policies.filter((p) => p.source === "household")).toEqual([
      { tool_name: "set_device_state", scope: "lock", member: { id: expect.any(String), name: "Adlan" }, risk: "high", source: "household" },
    ]);
    expect(policies.find((p) => p.tool_name === "set_policy" && p.source === "builtin")?.risk).toBe("high");
    expect(policies.find((p) => p.tool_name === "set_device_state" && p.scope === "lock" && p.source === "builtin")?.risk).toBe("confirm");
  });
});
