/**
 * get_budget_summary, record_expense.
 */
import { z } from "zod";
import { defineMutatingTool, defineReadTool } from "@/lib/contracts";
import { BudgetSummarySchema, RecordExpenseInputSchema, RecordExpenseResultSchema, getBudgetSummary, planRecordExpense, type BudgetSummary } from "@/lib/domain";
import { monthName, monthOf, todayInZone } from "@/lib/time";
import { READ_ANNOTATIONS, catalogueTitle, defaultRiskOf, mutatingAnnotations } from "./context";
import { spokenMoney } from "./spoken";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function spokenBudget(summary: BudgetSummary, currentMonth: string): string {
  const name = monthName(summary.month);
  const isCurrent = summary.month === currentMonth;
  if (summary.total.amount === 0) return `Nothing has been recorded for ${name}${isCurrent ? " yet" : ""}.`;
  const top = summary.by_category[0];
  const head = `${name}${isCurrent ? " so far" : ""}: ${spokenMoney(summary.total.amount, summary.currency)}${top ? `, mostly ${top.category.toLowerCase()}` : ""}.`;
  const prev = summary.previous_month;
  const diff = Math.round((summary.total.amount - prev.total.amount) * 100) / 100;
  const prevName = monthName(prev.month);
  const compare =
    diff === 0
      ? `That is the same as ${prevName}.`
      : `That is ${spokenMoney(Math.abs(diff), summary.currency)} ${diff > 0 ? "more" : "less"} than ${prevName}${isCurrent ? " in total" : ""}.`;
  return `${head} ${compare}`;
}

export const getBudgetSummaryTool = defineReadTool({
  kind: "read",
  name: "get_budget_summary",
  title: catalogueTitle("get_budget_summary"),
  description: "Summarises spending for a month by category, with the previous month for comparison. Optionally needs the month as YYYY-MM.",
  inputSchema: z.object({
    month: z.string().regex(MONTH_RE, "YYYY-MM").optional().describe("Month as YYYY-MM; defaults to the current month in the household timezone."),
  }),
  outputSchema: BudgetSummarySchema,
  annotations: READ_ANNOTATIONS,
  async run(input, ctx) {
    const currentMonth = monthOf(todayInZone(ctx.now, ctx.household.timezone));
    const summary = await getBudgetSummary(ctx.db, ctx.household, ctx.now, input.month);
    return { output: summary, spoken: spokenBudget(summary, currentMonth) };
  },
});

export const recordExpenseTool = defineMutatingTool({
  kind: "mutating",
  name: "record_expense",
  title: catalogueTitle("record_expense"),
  description: "Records money spent in a category for the budget. Needs the amount and category.",
  inputSchema: RecordExpenseInputSchema,
  resultSchema: RecordExpenseResultSchema,
  defaultRisk: defaultRiskOf("record_expense"),
  annotations: mutatingAnnotations({ destructive: false }),
  plan: planRecordExpense,
});
