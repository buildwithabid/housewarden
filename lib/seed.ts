/**
 * Demo household (docs/SPEC.md §10.4): the Ali family. Refuses to run when a
 * household exists (ALREADY_DONE); otherwise inserts everything in one
 * transaction and appends one `seeded` audit row. Dates are relative to today
 * in the household timezone so the demo always has an overdue bill, chores due
 * today and reminders tomorrow.
 */
import { HousewardenError, SEED_ACTOR, type Actor, type Household } from "@/lib/contracts";
import { appendAudit, lockAuditChain } from "@/lib/audit";
import { getDb, type CoreDb } from "@/lib/db";
import {
  createHousehold,
  getHousehold,
  insertBill,
  insertBudgetEntry,
  insertChore,
  insertDevice,
  insertMember,
  insertReminder,
  insertRoutine,
  insertShoppingItem,
  upsertPolicy,
} from "@/lib/domain";
import { env } from "@/lib/env";
import { addDays, addMonths, monthOf, splitDate, todayInZone, zonedTimeToInstant } from "@/lib/time";

export interface SeedOptions {
  now?: Date;
  name?: string;
  currency?: string;
  timezone?: string;
}

export interface SeedCounts {
  members: number;
  bills: number;
  chores: number;
  shopping_items: number;
  reminders: number;
  budget_entries: number;
  devices: number;
  routines: number;
  policies: number;
}

export interface SeedResult {
  household: Household;
  counts: SeedCounts;
}

/** An instant for `date` at `time` in the zone, but never after `now` (keeps "this month" spend in the past). */
function pastInstant(date: string, time: string, timeZone: string, now: Date): Date {
  const at = zonedTimeToInstant(date, time, timeZone);
  return at.getTime() < now.getTime() ? at : new Date(now.getTime() - 60_000);
}

export async function seedDemo(db?: CoreDb, actor: Actor = SEED_ACTOR, options: SeedOptions = {}): Promise<SeedResult> {
  const handle = db ?? (await getDb());
  const e = env();
  const now = options.now ?? new Date();
  const timezone = options.timezone ?? e.timezone;
  const currency = options.currency ?? e.currency;
  const name = options.name ?? "Ali family";
  const today = todayInZone(now, timezone);

  return handle.transaction(async (tx) => {
    await lockAuditChain(tx);
    const existing = await getHousehold(tx);
    if (existing) {
      throw new HousewardenError("ALREADY_DONE", `A household ('${existing.name}') already exists; the demo data was not loaded.`, {
        entity: "household",
        id: existing.id,
      });
    }
    const household = await createHousehold(tx, { name, currency, timezone });
    const hid = household.id;

    // Household order (rotate_chores follows it) is created_at; space the instants out.
    const at = (i: number) => new Date(now.getTime() - 60_000 + i);
    const abid = await insertMember(tx, hid, { name: "Abid", role: "adult", created_at: at(0) });
    const rabia = await insertMember(tx, hid, { name: "Rabia", role: "adult", created_at: at(1) });
    const anabiya = await insertMember(tx, hid, { name: "Anabiya", role: "child", created_at: at(2) });
    const adlan = await insertMember(tx, hid, { name: "Adlan", role: "child", created_at: at(3) });

    const bills = [
      { name: "Electricity", amount_minor: 3_000_00, recurrence: "monthly" as const, due_date: addDays(today, -5) },
      { name: "Gas", amount_minor: 1_800_00, recurrence: "monthly" as const, due_date: addDays(today, 4) },
      { name: "Internet", amount_minor: 2_500_00, recurrence: "monthly" as const, due_date: addDays(today, 12) },
      { name: "School fees", amount_minor: 24_000_00, recurrence: "monthly" as const, due_date: addDays(today, 9) },
      { name: "Car insurance", amount_minor: 38_000_00, recurrence: "yearly" as const, due_date: addDays(today, 60) },
    ];
    for (const b of bills) await insertBill(tx, hid, today, { ...b, currency });

    const chores = [
      { title: "Take out the bins", assigned_member_id: adlan.id, cadence: "weekly" as const, due_date: today },
      { title: "Water the plants", assigned_member_id: anabiya.id, cadence: "daily" as const, due_date: today },
      { title: "Wash the car", assigned_member_id: abid.id, cadence: "monthly" as const, due_date: addDays(today, 3) },
      { title: "Sort the recycling", assigned_member_id: rabia.id, cadence: "weekly" as const, due_date: addDays(today, 2) },
    ];
    for (const c of chores) await insertChore(tx, hid, c);

    const shopping = [
      { name: "Milk", qty: "2 L", category: "Dairy" },
      { name: "Eggs", qty: "12", category: "Dairy" },
      { name: "Rice", qty: "5 kg", category: "Pantry" },
      { name: "Dish soap", qty: "1", category: "Household", checked: true, checked_at: new Date(now.getTime() - 3_600_000) },
      { name: "Apples", qty: "1 kg", category: "Fruit" },
    ];
    for (const s of shopping) await insertShoppingItem(tx, hid, s);

    const reminders = [
      { text: "Call the electrician", at: zonedTimeToInstant(addDays(today, 1), "10:00", timezone), member_id: abid.id },
      { text: "Pay school fees", at: zonedTimeToInstant(addDays(today, 8), "09:00", timezone), member_id: rabia.id },
    ];
    for (const r of reminders) await insertReminder(tx, hid, r);

    const [, , dayOfMonth] = splitDate(today);
    const thisMonth = monthOf(today);
    const dayInMonth = (offset: number) => `${thisMonth}-${String(Math.max(1, dayOfMonth - offset)).padStart(2, "0")}`;
    const prevMonthFirst = addMonths(`${thisMonth}-01`, -1);
    const prevDay = (d: number) => `${monthOf(prevMonthFirst)}-${String(d).padStart(2, "0")}`;
    const budget = [
      { amount_minor: 4_200_00, category: "Groceries", note: "Weekly shop", member_id: rabia.id, occurred_at: pastInstant(dayInMonth(1), "11:00", timezone, now) },
      { amount_minor: 3_500_00, category: "Fuel", note: "Petrol", member_id: abid.id, occurred_at: pastInstant(dayInMonth(2), "18:30", timezone, now) },
      { amount_minor: 2_800_00, category: "Groceries", note: "Vegetables and fruit", member_id: rabia.id, occurred_at: pastInstant(dayInMonth(4), "10:15", timezone, now) },
      { amount_minor: 6_000_00, category: "School", note: "Books and uniform", member_id: abid.id, occurred_at: pastInstant(dayInMonth(6), "16:00", timezone, now) },
      { amount_minor: 1_950_00, category: "Household", note: "Cleaning supplies", member_id: rabia.id, occurred_at: pastInstant(dayInMonth(8), "12:45", timezone, now) },
      { amount_minor: 3_000_00, category: "Groceries", note: "Meat", member_id: abid.id, occurred_at: pastInstant(dayInMonth(10), "19:20", timezone, now) },
      { amount_minor: 5_100_00, category: "Groceries", note: "Monthly staples", member_id: rabia.id, occurred_at: zonedTimeToInstant(prevDay(3), "11:00", timezone) },
      { amount_minor: 4_000_00, category: "Fuel", note: "Petrol", member_id: abid.id, occurred_at: zonedTimeToInstant(prevDay(12), "17:40", timezone) },
      { amount_minor: 9_100_00, category: "Household", note: "Water pump repair", member_id: abid.id, occurred_at: zonedTimeToInstant(prevDay(20), "14:00", timezone) },
    ];
    for (const b of budget) await insertBudgetEntry(tx, hid, { ...b, currency });

    await insertDevice(tx, hid, { name: "Front door", kind: "lock", state: { locked: true }, created_at: at(0) });
    await insertDevice(tx, hid, { name: "Living room", kind: "thermostat", state: { mode: "cool", target_c: 24 }, created_at: at(1) });

    await insertRoutine(tx, hid, {
      name: "bedtime",
      steps: [
        { tool: "set_device_state", input: { device: "Front door", state: { locked: true } } },
        { tool: "set_device_state", input: { device: "Living room", state: { mode: "cool", target_c: 26 } } },
        { tool: "add_reminder", input: { text: "Check the stove is off", at: "22:30" } },
      ],
    });

    await upsertPolicy(tx, hid, { tool_name: "set_device_state", scope: "lock", member_id: adlan.id, risk: "high" });

    const counts: SeedCounts = {
      members: 4,
      bills: bills.length,
      chores: chores.length,
      shopping_items: shopping.length,
      reminders: reminders.length,
      budget_entries: budget.length,
      devices: 2,
      routines: 1,
      policies: 1,
    };
    await appendAudit(tx, {
      at: now,
      actor,
      event: "seeded",
      tool: "seed",
      action_id: null,
      input: {},
      result: { counts: { ...counts } },
    });
    return { household, counts };
  });
}

/**
 * Empties every table, audit log included (TRUNCATE bypasses the row-level
 * append-only trigger). Only for the embedded PGlite database — `npm run seed
 * --force` — never a shared Postgres.
 */
export async function resetDatabase(db: CoreDb): Promise<void> {
  if (db.kind !== "pglite") {
    throw new HousewardenError("INTERNAL", "resetDatabase only runs against the embedded PGlite database.");
  }
  await db.exec(
    "TRUNCATE TABLE audit_log, pending_actions, policies, routines, devices, budget_entries, reminders, shopping_items, chores, bills, members, household",
  );
}
