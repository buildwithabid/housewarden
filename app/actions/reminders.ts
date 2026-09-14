"use server";

import { getDb } from "@/lib/db";
import { failure, finishForm, finishWithRedirect, runConsoleTool, str, type ActionState } from "@/lib/console/outcome";
import { instantFromDatetimeLocal } from "@/lib/console/format";
import { getHousehold } from "@/lib/domain";
import { env } from "@/lib/env";

const PAGE = "/reminders";

async function householdTimeZone(): Promise<string> {
  const household = await getHousehold(await getDb());
  return household?.timezone ?? env().timezone;
}

export async function addReminder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const atLocal = str(fd, "at");
  const at = atLocal ? instantFromDatetimeLocal(atLocal, await householdTimeZone()) : null;
  if (!at) return failure("Give a date and time for the reminder.", fd);
  const member = str(fd, "for_member");
  const outcome = await runConsoleTool("add_reminder", {
    text: str(fd, "text"),
    at: at.toISOString(),
    ...(member ? { for_member: member } : {}),
  });
  return finishForm(outcome, PAGE, fd);
}

export async function cancelReminder(fd: FormData): Promise<void> {
  const outcome = await runConsoleTool("cancel_reminder", { reminder: str(fd, "reminder") });
  finishWithRedirect(outcome, PAGE);
}
