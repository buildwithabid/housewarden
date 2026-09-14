/**
 * list_bills, get_bill, add_bill, update_bill, mark_bill_paid.
 */
import { z } from "zod";
import { BillSchema, CurrencySchema, EntityRefSchema, defineMutatingTool, defineReadTool, type Bill } from "@/lib/contracts";
import {
  AddBillInputSchema,
  AddBillResultSchema,
  MarkBillPaidInputSchema,
  MarkBillPaidResultSchema,
  UpdateBillInputSchema,
  UpdateBillResultSchema,
  findBill,
  joinSpoken,
  listBills,
  planAddBill,
  planMarkBillPaid,
  planUpdateBill,
  totalsByCurrency,
  type BillFilter,
} from "@/lib/domain";
import { spokenDate, todayInZone } from "@/lib/time";
import { READ_ANNOTATIONS, catalogueTitle, defaultRiskOf, mutatingAnnotations } from "./context";
import { countOf, isAre, sentence, spokenMoney } from "./spoken";

const BILL_FILTERS = ["unpaid", "due", "overdue", "paid", "all"] as const satisfies readonly BillFilter[];

function statusWord(filter: BillFilter): string {
  return filter === "all" ? "on file" : filter;
}

export function spokenBills(bills: readonly Bill[], filter: BillFilter, today: string): string {
  if (bills.length === 0) return filter === "all" ? "There are no bills yet." : `No bills are ${statusWord(filter)}.`;
  const unpaid = bills.filter((b) => b.status !== "paid");
  const totals = totalsByCurrency(unpaid).map((t) => spokenMoney(t.amount, t.currency));
  const head = `${countOf(bills.length, "bill")} ${isAre(bills.length)} ${statusWord(filter)}${
    unpaid.length && filter !== "paid" ? `, ${joinSpoken(totals)} ${filter === "all" ? "still to pay" : "in total"}` : ""
  }`;
  const highlights: string[] = [];
  const overdue = unpaid.filter((b) => b.status === "overdue");
  const due = unpaid.filter((b) => b.status === "due");
  if (overdue.length) highlights.push(`${joinSpoken(overdue.map((b) => b.name))} ${isAre(overdue.length)} overdue`);
  if (due.length) highlights.push(`${due[0].name} is due ${spokenDate(due[0].due_date, today)}`);
  return `${sentence(head)}${highlights.length ? ` ${sentence(highlights.join("; "))}` : ""}`;
}

export function spokenBill(bill: Bill, timezone: string, today: string): string {
  let status: string;
  if (bill.status === "paid" && bill.paid_at) status = `paid ${spokenDate(todayInZone(new Date(bill.paid_at), timezone), today)}`;
  else if (bill.status === "overdue") status = `overdue, was due ${spokenDate(bill.due_date, today)}`;
  else status = `due ${spokenDate(bill.due_date, today)}`;
  const recurrence = bill.recurrence === "none" ? "" : `, repeats ${bill.recurrence}`;
  return `${bill.name}: ${spokenMoney(bill.amount, bill.currency)}, ${status}${recurrence}.`;
}

export const listBillsTool = defineReadTool({
  kind: "read",
  name: "list_bills",
  title: catalogueTitle("list_bills"),
  description: "Lists bills, unpaid ones by default, soonest first. Optionally needs a status filter.",
  inputSchema: z.object({
    status: z.enum(BILL_FILTERS).default("unpaid").describe("unpaid (due + overdue), due, overdue, paid or all."),
  }),
  outputSchema: z.object({
    bills: z.array(BillSchema),
    totals_due: z.array(z.object({ currency: CurrencySchema, amount: z.number(), amount_formatted: z.string() })),
  }),
  annotations: READ_ANNOTATIONS,
  async run(input, ctx) {
    const today = todayInZone(ctx.now, ctx.household.timezone);
    const bills = await listBills(ctx.db, ctx.household.id, today, input.status);
    const totals_due = totalsByCurrency(bills.filter((b) => b.status !== "paid"));
    return { output: { bills, totals_due }, spoken: spokenBills(bills, input.status, today) };
  },
});

export const getBillTool = defineReadTool({
  kind: "read",
  name: "get_bill",
  title: catalogueTitle("get_bill"),
  description: "Reads one bill in detail. Needs the bill name or id.",
  inputSchema: z.object({ bill: EntityRefSchema.describe("The bill's name or id.") }),
  outputSchema: z.object({ bill: BillSchema }),
  annotations: READ_ANNOTATIONS,
  async run(input, ctx) {
    const today = todayInZone(ctx.now, ctx.household.timezone);
    const bill = await findBill(ctx.db, ctx.household.id, today, input.bill);
    return { output: { bill }, spoken: spokenBill(bill, ctx.household.timezone, today) };
  },
});

export const addBillTool = defineMutatingTool({
  kind: "mutating",
  name: "add_bill",
  title: catalogueTitle("add_bill"),
  description: "Adds a bill with an amount and due date, optionally recurring. Needs the name, amount and due date.",
  inputSchema: AddBillInputSchema,
  resultSchema: AddBillResultSchema,
  defaultRisk: defaultRiskOf("add_bill"),
  annotations: mutatingAnnotations({ destructive: false }),
  plan: planAddBill,
});

export const updateBillTool = defineMutatingTool({
  kind: "mutating",
  name: "update_bill",
  title: catalogueTitle("update_bill"),
  description: "Changes a bill's name, amount, currency, due date or recurrence. Needs the bill and at least one field to change.",
  inputSchema: UpdateBillInputSchema,
  resultSchema: UpdateBillResultSchema,
  defaultRisk: defaultRiskOf("update_bill"),
  annotations: mutatingAnnotations(),
  plan: planUpdateBill,
});

export const markBillPaidTool = defineMutatingTool({
  kind: "mutating",
  name: "mark_bill_paid",
  title: catalogueTitle("mark_bill_paid"),
  description: "Marks a bill as paid and, if it recurs, creates the next one. Needs the bill name or id.",
  inputSchema: MarkBillPaidInputSchema,
  resultSchema: MarkBillPaidResultSchema,
  defaultRisk: defaultRiskOf("mark_bill_paid"),
  annotations: mutatingAnnotations({ idempotent: true }),
  plan: planMarkBillPaid,
});
