import { z } from "zod";
import {
  EntityRefSchema,
  HousewardenError,
  IsoInstantSchema,
  MutatingInputBaseSchema,
  ReminderSchema,
  type Member,
  type MutationPlan,
  type Queryable,
  type Reminder,
  type ReminderStatus,
  type ToolContext,
} from "@/lib/contracts";
import { spokenInstant } from "@/lib/time";
import { findMember } from "./members";
import { joinSpoken, matchRef } from "./shared";

interface ReminderRow extends Record<string, unknown> {
  id: string;
  text: string;
  at: Date;
  member_id: string | null;
  member_name: string | null;
  status: ReminderStatus;
}

const REMINDER_SELECT = `
  SELECT r.id, r.text, r.at, r.member_id, m.name AS member_name, r.status
  FROM reminders r LEFT JOIN members m ON m.id = r.member_id
  WHERE r.household_id = $1`;

function rowToReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    text: row.text,
    at: row.at.toISOString(),
    member: row.member_id && row.member_name ? { id: row.member_id, name: row.member_name } : null,
    status: row.status,
  };
}

export type ReminderFilter = ReminderStatus | "all";

export interface ListRemindersOptions {
  status?: ReminderFilter;
  memberId?: string;
  /** Only reminders at or before now + withinHours. Requires `now`. */
  withinHours?: number;
  now?: Date;
}

/** Reminders soonest first; scheduled only by default. */
export async function listReminders(db: Queryable, householdId: string, options: ListRemindersOptions = {}): Promise<Reminder[]> {
  const params: unknown[] = [householdId];
  const clauses: string[] = [];
  const status = options.status ?? "scheduled";
  if (status !== "all") {
    params.push(status);
    clauses.push(`r.status = $${params.length}`);
  }
  if (options.memberId) {
    params.push(options.memberId);
    clauses.push(`r.member_id = $${params.length}::uuid`);
  }
  if (options.withinHours !== undefined && options.now) {
    params.push(new Date(options.now.getTime() + options.withinHours * 3_600_000));
    clauses.push(`r.at <= $${params.length}::timestamptz`);
  }
  const where = clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
  const res = await db.query<ReminderRow>(`${REMINDER_SELECT}${where} ORDER BY r.at, r.text`, params);
  return res.rows.map(rowToReminder);
}

export async function getReminderById(db: Queryable, householdId: string, id: string): Promise<Reminder | null> {
  const res = await db.query<ReminderRow>(`${REMINDER_SELECT} AND r.id = $2::uuid`, [householdId, id]);
  return res.rows[0] ? rowToReminder(res.rows[0]) : null;
}

/** Resolves a reminder by id or exact text; scheduled ones win when the text matches several. */
export async function findReminder(db: Queryable, householdId: string, ref: string): Promise<Reminder> {
  const reminders = await listReminders(db, householdId, { status: "all" });
  return matchRef(reminders, ref, {
    entity: "reminder",
    label: (r) => r.text,
    prefer: (r) => r.status === "scheduled",
    notFound: (r) => {
      const scheduled = reminders.filter((x) => x.status === "scheduled").map((x) => x.text);
      return scheduled.length
        ? `I couldn't find a reminder saying ${r}. The scheduled reminders are: ${joinSpoken(scheduled)}.`
        : `I couldn't find a reminder saying ${r}; nothing is scheduled.`;
    },
  });
}

export interface NewReminder {
  text: string;
  at: Date;
  member_id?: string | null;
  status?: ReminderStatus;
}

export async function insertReminder(tx: Queryable, householdId: string, input: NewReminder): Promise<Reminder> {
  const res = await tx.query<{ id: string }>(
    `INSERT INTO reminders (household_id, text, at, member_id, status) VALUES ($1::uuid, $2, $3::timestamptz, $4::uuid, $5) RETURNING id`,
    [householdId, input.text, input.at, input.member_id ?? null, input.status ?? "scheduled"],
  );
  const reminder = await getReminderById(tx, householdId, res.rows[0].id);
  if (!reminder) throw new HousewardenError("INTERNAL", "Reminder vanished after insert");
  return reminder;
}

// ---------------------------------------------------------------------------
// add_reminder
// ---------------------------------------------------------------------------

export const AddReminderInputSchema = MutatingInputBaseSchema.extend({
  text: z.string().trim().min(1).max(300).describe("What to be reminded of."),
  at: IsoInstantSchema.describe("When, as an ISO-8601 instant with offset, e.g. 2026-10-06T10:00:00+05:00."),
  for_member: EntityRefSchema.optional().describe("Member name or id the reminder is for."),
});
export type AddReminderInput = z.output<typeof AddReminderInputSchema>;
export const AddReminderResultSchema = z.object({ reminder: ReminderSchema });
export type AddReminderResult = z.output<typeof AddReminderResultSchema>;

export async function planAddReminder(input: AddReminderInput, ctx: ToolContext): Promise<MutationPlan<AddReminderResult>> {
  const at = new Date(input.at);
  if (Number.isNaN(at.getTime())) throw new HousewardenError("VALIDATION", "The reminder time is not a valid instant.");
  if (at.getTime() <= ctx.now.getTime()) {
    throw new HousewardenError("VALIDATION", "The reminder time has already passed. Give a time in the future.", { at: at.toISOString() });
  }
  const member: Member | null = input.for_member ? await findMember(ctx.db, ctx.household.id, input.for_member) : null;
  const when = spokenInstant(at, ctx.household.timezone, ctx.now);
  const forSpoken = member ? ` for ${member.name}` : "";
  return {
    preview: {
      summary: `Add reminder '${input.text}' at ${at.toISOString()}${member ? ` for ${member.name}` : ""}`,
      changes: [
        {
          entity: "reminder",
          id: null,
          op: "create",
          label: input.text,
          before: null,
          after: { text: input.text, at: at.toISOString(), member: member ? member.name : null, status: "scheduled" },
          line: `reminder '${input.text}' at ${at.toISOString()}${member ? ` for ${member.name}` : ""}: new`,
        },
      ],
      warnings: [],
    },
    spoken: `set a reminder${forSpoken}: ${input.text}, ${when}`,
    policyScope: "",
    async execute(tx) {
      const reminder = await insertReminder(tx, ctx.household.id, { text: input.text, at, member_id: member?.id ?? null });
      return { output: { reminder }, spoken: `Reminder set${forSpoken}: ${reminder.text}, ${when}.` };
    },
  };
}

// ---------------------------------------------------------------------------
// cancel_reminder
// ---------------------------------------------------------------------------

export const CancelReminderInputSchema = MutatingInputBaseSchema.extend({
  reminder: EntityRefSchema.describe("The reminder's id or its exact text."),
});
export type CancelReminderInput = z.output<typeof CancelReminderInputSchema>;
export const CancelReminderResultSchema = z.object({ reminder: ReminderSchema });
export type CancelReminderResult = z.output<typeof CancelReminderResultSchema>;

export async function planCancelReminder(input: CancelReminderInput, ctx: ToolContext): Promise<MutationPlan<CancelReminderResult>> {
  const reminder = await findReminder(ctx.db, ctx.household.id, input.reminder);
  if (reminder.status !== "scheduled") {
    throw new HousewardenError("ALREADY_DONE", `That reminder is already ${reminder.status}.`, { entity: "reminder", id: reminder.id });
  }
  return {
    preview: {
      summary: `Cancel reminder '${reminder.text}' (${reminder.at})`,
      changes: [
        {
          entity: "reminder",
          id: reminder.id,
          op: "update",
          label: reminder.text,
          before: { status: "scheduled" },
          after: { status: "cancelled" },
          line: `reminder '${reminder.text}' at ${reminder.at}: status scheduled → cancelled`,
        },
      ],
      warnings: [],
    },
    spoken: `cancel the reminder: ${reminder.text}`,
    policyScope: "",
    async execute(tx) {
      await tx.query(`UPDATE reminders SET status = 'cancelled' WHERE id = $1::uuid`, [reminder.id]);
      const updated = await getReminderById(tx, ctx.household.id, reminder.id);
      if (!updated) throw new HousewardenError("INTERNAL", "Reminder vanished during cancel");
      return { output: { reminder: updated }, spoken: `Cancelled: ${updated.text}.` };
    },
  };
}
