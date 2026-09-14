import { z } from "zod";
import {
  BillSchema,
  ChoreSchema,
  DeviceSchema,
  ReminderSchema,
  Sha256HexSchema,
  type Bill,
  type Chore,
  type Device,
  type Household,
  type Queryable,
  type Reminder,
} from "@/lib/contracts";
import { getAuditHead, verifyAuditChain } from "@/lib/audit";
import { todayInZone } from "@/lib/time";
import { listBills } from "./bills";
import { listChores } from "./chores";
import { listDevices } from "./devices";
import { listMembers } from "./members";
import { countPendingActions } from "./pending";
import { listReminders } from "./reminders";
import { countToBuy } from "./shopping";

export const HouseholdSummarySchema = z.object({
  household: z.object({ name: z.string(), currency: z.string(), timezone: z.string(), today: z.string() }),
  counts: z.object({
    members: z.number().int(),
    bills_due: z.number().int(),
    bills_overdue: z.number().int(),
    chores_open: z.number().int(),
    chores_due_today: z.number().int(),
    shopping_to_buy: z.number().int(),
    reminders_next_24h: z.number().int(),
    pending_confirmations: z.number().int(),
  }),
  overdue_bills: z.array(BillSchema),
  due_today: z.object({ bills: z.array(BillSchema), chores: z.array(ChoreSchema), reminders: z.array(ReminderSchema) }),
  devices: z.array(DeviceSchema),
  audit: z.object({ rows: z.number().int(), chain_intact: z.boolean(), last_hash: Sha256HexSchema }),
});
export type HouseholdSummary = z.output<typeof HouseholdSummarySchema>;

/**
 * The dashboard / get_household_summary read. Reads only. "Due today" chores
 * include overdue ones (they are still due), so the list and count agree.
 */
export async function getHouseholdSummary(db: Queryable, household: Household, now: Date): Promise<HouseholdSummary> {
  const today = todayInZone(now, household.timezone);
  const [members, unpaid, openChores, toBuy, remindersSoon, pending, head, verification] = await Promise.all([
    listMembers(db, household.id),
    listBills(db, household.id, today, "unpaid"),
    listChores(db, household.id, { status: "open" }),
    countToBuy(db, household.id),
    listReminders(db, household.id, { status: "scheduled", withinHours: 24, now }),
    countPendingActions(db, household.id, now),
    getAuditHead(db),
    verifyAuditChain(db, { now }),
  ]);
  const overdue: Bill[] = unpaid.filter((b) => b.status === "overdue");
  const dueToday: Bill[] = unpaid.filter((b) => b.due_date === today);
  const choresDue: Chore[] = openChores.filter((c) => c.due_date !== null && c.due_date <= today);
  const remindersToday: Reminder[] = remindersSoon.filter((r) => todayInZone(new Date(r.at), household.timezone) === today);
  const devices: Device[] = await listDevices(db, household.id);
  return {
    household: { name: household.name, currency: household.currency, timezone: household.timezone, today },
    counts: {
      members: members.length,
      bills_due: unpaid.length - overdue.length,
      bills_overdue: overdue.length,
      chores_open: openChores.length,
      chores_due_today: choresDue.length,
      shopping_to_buy: toBuy,
      reminders_next_24h: remindersSoon.filter((r) => new Date(r.at).getTime() >= now.getTime()).length,
      pending_confirmations: pending,
    },
    overdue_bills: overdue,
    due_today: { bills: dueToday, chores: choresDue, reminders: remindersToday },
    devices,
    audit: { rows: head.rows, chain_intact: verification.intact, last_hash: head.hash },
  };
}
