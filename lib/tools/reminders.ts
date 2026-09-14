/**
 * list_reminders, add_reminder, cancel_reminder.
 */
import { z } from "zod";
import { EntityRefSchema, ReminderSchema, defineMutatingTool, defineReadTool, type Reminder } from "@/lib/contracts";
import {
  AddReminderInputSchema,
  AddReminderResultSchema,
  CancelReminderInputSchema,
  CancelReminderResultSchema,
  findMember,
  joinSpoken,
  listReminders,
  lowerFirst,
  planAddReminder,
  planCancelReminder,
  plural,
  type ReminderFilter,
} from "@/lib/domain";
import { numberWord, spokenInstant } from "@/lib/time";
import { READ_ANNOTATIONS, catalogueTitle, defaultRiskOf, mutatingAnnotations } from "./context";
import { countOf, sentence, truncateList } from "./spoken";

const REMINDER_FILTERS = ["scheduled", "done", "cancelled", "all"] as const satisfies readonly ReminderFilter[];

/** "day", "two days", "six hours" — for "in the next …". */
export function spokenWindow(hours: number): string {
  if (hours === 24) return "day";
  if (hours < 24) return `${numberWord(hours)} ${plural(hours, "hour")}`;
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${numberWord(days)} ${plural(days, "day")}`;
  }
  return `${hours} hours`;
}

export function spokenReminders(
  reminders: readonly Reminder[],
  filter: ReminderFilter,
  memberName: string | null,
  withinHours: number | undefined,
  timezone: string,
  now: Date,
): string {
  const scope = `${memberName ? ` for ${memberName}` : ""}${withinHours !== undefined ? ` in the next ${spokenWindow(withinHours)}` : ""}`;
  const what = filter === "all" ? "reminder" : `${filter} reminder`;
  if (reminders.length === 0) return `No ${what}s${scope}.`;
  const list = truncateList(
    reminders.map((r) => `${lowerFirst(r.text)}, ${spokenInstant(new Date(r.at), timezone, now)}`),
    4,
  );
  return sentence(`${countOf(reminders.length, what)}${scope}: ${joinSpoken(list)}`);
}

export const listRemindersTool = defineReadTool({
  kind: "read",
  name: "list_reminders",
  title: catalogueTitle("list_reminders"),
  description: "Lists upcoming reminders, soonest first. Optionally needs a status, a member, or a time window in hours.",
  inputSchema: z.object({
    status: z.enum(REMINDER_FILTERS).default("scheduled").describe("scheduled, done, cancelled or all."),
    member: EntityRefSchema.optional().describe("Only reminders for this member (name or id)."),
    within_hours: z.number().int().min(1).max(8760).optional().describe("Only reminders before now plus this many hours."),
  }),
  outputSchema: z.object({ reminders: z.array(ReminderSchema) }),
  annotations: READ_ANNOTATIONS,
  async run(input, ctx) {
    const member = input.member ? await findMember(ctx.db, ctx.household.id, input.member) : null;
    const reminders = await listReminders(ctx.db, ctx.household.id, {
      status: input.status,
      memberId: member?.id,
      withinHours: input.within_hours,
      now: ctx.now,
    });
    return {
      output: { reminders },
      spoken: spokenReminders(reminders, input.status, member?.name ?? null, input.within_hours, ctx.household.timezone, ctx.now),
    };
  },
});

export const addReminderTool = defineMutatingTool({
  kind: "mutating",
  name: "add_reminder",
  title: catalogueTitle("add_reminder"),
  description: "Adds a reminder at a specific time, optionally for one member. Needs the text and the time with timezone offset.",
  inputSchema: AddReminderInputSchema,
  resultSchema: AddReminderResultSchema,
  defaultRisk: defaultRiskOf("add_reminder"),
  annotations: mutatingAnnotations({ destructive: false }),
  plan: planAddReminder,
});

export const cancelReminderTool = defineMutatingTool({
  kind: "mutating",
  name: "cancel_reminder",
  title: catalogueTitle("cancel_reminder"),
  description: "Cancels a scheduled reminder. Needs the reminder id or its exact text.",
  inputSchema: CancelReminderInputSchema,
  resultSchema: CancelReminderResultSchema,
  defaultRisk: defaultRiskOf("cancel_reminder"),
  annotations: mutatingAnnotations({ destructive: true }),
  plan: planCancelReminder,
});
