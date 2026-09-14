"use server";

import { getDb } from "@/lib/db";
import { failure, finishForm, num, runConsoleTool, str, type ActionState } from "@/lib/console/outcome";
import { instantFromDatetimeLocal } from "@/lib/console/format";
import { withQuery } from "@/lib/console/url";
import { getHousehold } from "@/lib/domain";
import { env } from "@/lib/env";
import { isValidMonth } from "@/lib/time";

export async function recordExpense(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const month = str(fd, "month");
  const page = month && isValidMonth(month) ? withQuery("/budget", { month }) : "/budget";
  const amount = num(fd, "amount");
  if (amount === undefined) return failure("Give the amount as a number, for example 1450 or 45.50.", fd);
  const household = await getHousehold(await getDb());
  const timeZone = household?.timezone ?? env().timezone;
  const whenLocal = str(fd, "occurred_at");
  const occurredAt = whenLocal ? instantFromDatetimeLocal(whenLocal, timeZone) : null;
  if (whenLocal && !occurredAt) return failure("The date and time could not be read. Leave it empty to use now.", fd);
  const note = str(fd, "note");
  const paidBy = str(fd, "paid_by");
  const outcome = await runConsoleTool("record_expense", {
    amount,
    category: str(fd, "category"),
    ...(note ? { note } : {}),
    ...(occurredAt ? { occurred_at: occurredAt.toISOString() } : {}),
    ...(paidBy ? { paid_by: paidBy } : {}),
  });
  return finishForm(outcome, page, fd);
}
