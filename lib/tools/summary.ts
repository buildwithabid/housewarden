/**
 * get_household_summary — the spoken-ready overview (docs/TOOLS.md §2).
 */
import { z } from "zod";
import { defineReadTool } from "@/lib/contracts";
import { HouseholdSummarySchema, getHouseholdSummary, joinSpoken, type HouseholdSummary } from "@/lib/domain";
import { numberWord, spokenDate } from "@/lib/time";
import { READ_ANNOTATIONS, catalogueTitle } from "./context";
import { countOf, isAre, sentence, spokenMoney } from "./spoken";

export function spokenSummary(summary: HouseholdSummary): string {
  const { counts, overdue_bills: overdue, household } = summary;
  const parts: string[] = [];
  if (overdue.length === 0) {
    parts.push("No bills are overdue.");
  } else if (overdue.length === 1) {
    const b = overdue[0];
    parts.push(`One bill is overdue: ${b.name}, ${spokenMoney(b.amount, b.currency)}, due ${spokenDate(b.due_date, household.today)}.`);
  } else {
    parts.push(`${numberWord(overdue.length)} bills are overdue: ${joinSpoken(overdue.map((b) => b.name))}.`);
  }
  parts.push(
    sentence(
      `${countOf(counts.chores_due_today, "chore")} ${isAre(counts.chores_due_today)} due today and there ${isAre(counts.shopping_to_buy)} ${countOf(counts.shopping_to_buy, "thing")} to buy`,
    ),
  );
  parts.push(
    counts.pending_confirmations === 0
      ? "Nothing is waiting for approval."
      : sentence(`${countOf(counts.pending_confirmations, "action")} ${isAre(counts.pending_confirmations)} waiting for approval`),
  );
  if (!summary.audit.chain_intact) parts.push("The audit chain is broken; check the console.");
  return parts.map(sentence).join(" ");
}

export const getHouseholdSummaryTool = defineReadTool({
  kind: "read",
  name: "get_household_summary",
  title: catalogueTitle("get_household_summary"),
  description: "Gives a spoken-ready overview of what is due, overdue, waiting for approval and whether the audit log is intact. Needs nothing.",
  inputSchema: z.object({}),
  outputSchema: HouseholdSummarySchema,
  annotations: READ_ANNOTATIONS,
  async run(_input, ctx) {
    const summary = await getHouseholdSummary(ctx.db, ctx.household, ctx.now);
    return { output: summary, spoken: spokenSummary(summary) };
  },
});
