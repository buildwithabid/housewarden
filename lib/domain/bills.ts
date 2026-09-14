import { z } from "zod";
import {
  AmountSchema,
  BillRecurrenceSchema,
  BillSchema,
  CurrencySchema,
  HousewardenError,
  IsoDateSchema,
  IsoInstantSchema,
  MutatingInputBaseSchema,
  type Bill,
  type BillRecurrence,
  type BillStatus,
  type Change,
  type MutationPlan,
  type Queryable,
  type ToolContext,
} from "@/lib/contracts";
import { formatAmount, fromMinor, spokenAmount, toMinor } from "@/lib/money";
import { addMonths, addYears, spokenDate, todayInZone } from "@/lib/time";
import { iso, joinSpoken, matchRef } from "./shared";

interface BillRow extends Record<string, unknown> {
  id: string;
  name: string;
  amount_minor: number;
  currency: string;
  due_date: string;
  recurrence: BillRecurrence;
  status: BillStatus;
  paid_at: Date | null;
  days_until_due: number | null;
}

/** Effective status and days_until_due are computed in SQL against $2 = today (YYYY-MM-DD). */
const BILL_SELECT = `
  SELECT id, name, amount_minor, currency, due_date, recurrence,
         CASE WHEN status = 'due' AND due_date < $2::date THEN 'overdue' ELSE status END AS status,
         paid_at,
         CASE WHEN status = 'paid' THEN NULL ELSE (due_date - $2::date) END AS days_until_due
  FROM bills
  WHERE household_id = $1`;

function rowToBill(row: BillRow): Bill {
  return {
    id: row.id,
    name: row.name,
    amount: fromMinor(row.amount_minor),
    currency: row.currency,
    amount_formatted: formatAmount(row.amount_minor, row.currency),
    due_date: row.due_date,
    recurrence: row.recurrence,
    status: row.status,
    paid_at: iso(row.paid_at),
    days_until_due: row.days_until_due,
  };
}

export type BillFilter = "unpaid" | "due" | "overdue" | "paid" | "all";

function filterClause(filter: BillFilter): string {
  switch (filter) {
    case "unpaid":
      return "WHERE b.status IN ('due', 'overdue')";
    case "all":
      return "";
    default:
      return `WHERE b.status = '${filter}'`;
  }
}

/** Bills with their effective status, soonest due first. */
export async function listBills(db: Queryable, householdId: string, today: string, filter: BillFilter = "unpaid"): Promise<Bill[]> {
  const res = await db.query<BillRow>(
    `SELECT * FROM (${BILL_SELECT}) b ${filterClause(filter)} ORDER BY b.due_date, b.name`,
    [householdId, today],
  );
  return res.rows.map(rowToBill);
}

export async function getBillById(db: Queryable, householdId: string, today: string, id: string): Promise<Bill | null> {
  const res = await db.query<BillRow>(`SELECT * FROM (${BILL_SELECT}) b WHERE b.id = $3::uuid`, [householdId, today, id]);
  return res.rows[0] ? rowToBill(res.rows[0]) : null;
}

/** Resolves a bill by id or name; when a name matches several, the unpaid one wins. */
export async function findBill(db: Queryable, householdId: string, today: string, ref: string): Promise<Bill> {
  const bills = await listBills(db, householdId, today, "all");
  return matchRef(bills, ref, {
    entity: "bill",
    label: (b) => b.name,
    prefer: (b) => b.status !== "paid",
    notFound: (r) => {
      const unpaid = bills.filter((b) => b.status !== "paid").map((b) => b.name);
      return unpaid.length
        ? `I couldn't find a bill called ${r}. The unpaid bills are ${joinSpoken(unpaid)}.`
        : `I couldn't find a bill called ${r}; there are no unpaid bills.`;
    },
  });
}

/** Per-currency totals of a list of bills (list_bills.totals_due). */
export function totalsByCurrency(bills: readonly Bill[]): { currency: string; amount: number; amount_formatted: string }[] {
  const sums = new Map<string, number>();
  for (const b of bills) sums.set(b.currency, (sums.get(b.currency) ?? 0) + toMinor(b.amount));
  return [...sums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, minor]) => ({ currency, amount: fromMinor(minor), amount_formatted: formatAmount(minor, currency) }));
}

export interface NewBill {
  name: string;
  amount_minor: number;
  currency: string;
  due_date: string;
  recurrence: BillRecurrence;
  paid_at?: Date | null;
}

export async function insertBill(tx: Queryable, householdId: string, today: string, input: NewBill): Promise<Bill> {
  const paidAt = input.paid_at ?? null;
  const res = await tx.query<{ id: string }>(
    `INSERT INTO bills (household_id, name, amount_minor, currency, due_date, recurrence, status, paid_at)
     VALUES ($1::uuid, $2, $3, $4, $5::date, $6, $7, $8::timestamptz) RETURNING id`,
    [householdId, input.name, input.amount_minor, input.currency, input.due_date, input.recurrence, paidAt ? "paid" : "due", paidAt],
  );
  const bill = await getBillById(tx, householdId, today, res.rows[0].id);
  if (!bill) throw new HousewardenError("INTERNAL", "Bill vanished after insert");
  return bill;
}

function nextDueDate(dueDate: string, recurrence: BillRecurrence): string | null {
  if (recurrence === "monthly") return addMonths(dueDate, 1);
  if (recurrence === "yearly") return addYears(dueDate, 1);
  return null;
}

function billLabel(b: { name: string; amount_minor: number; currency: string; due_date: string }): string {
  return `bill '${b.name}' ${formatAmount(b.amount_minor, b.currency)} due ${b.due_date}`;
}

// ---------------------------------------------------------------------------
// add_bill
// ---------------------------------------------------------------------------

export const AddBillInputSchema = MutatingInputBaseSchema.extend({
  name: z.string().trim().min(1).max(100).describe("What the bill is for, e.g. Electricity."),
  amount: AmountSchema.describe("Amount in major units, e.g. 3000 or 45.5."),
  currency: CurrencySchema.optional().describe("ISO-4217 code; defaults to the household currency."),
  due_date: IsoDateSchema.describe("YYYY-MM-DD in the household timezone."),
  recurrence: BillRecurrenceSchema.default("none").describe("none, monthly or yearly."),
});
export type AddBillInput = z.output<typeof AddBillInputSchema>;
export const AddBillResultSchema = z.object({ bill: BillSchema });
export type AddBillResult = z.output<typeof AddBillResultSchema>;

export async function planAddBill(input: AddBillInput, ctx: ToolContext): Promise<MutationPlan<AddBillResult>> {
  const currency = input.currency ?? ctx.household.currency;
  const minor = toMinor(input.amount);
  const today = todayInZone(ctx.now, ctx.household.timezone);
  const recurrenceNote = input.recurrence === "none" ? "" : ` (${input.recurrence} recurrence)`;
  return {
    preview: {
      summary: `Add bill '${input.name}' (${formatAmount(minor, currency)}, due ${input.due_date}${input.recurrence === "none" ? "" : `, ${input.recurrence}`})`,
      changes: [
        {
          entity: "bill",
          id: null,
          op: "create",
          label: input.name,
          before: null,
          after: { name: input.name, amount: input.amount, currency, due_date: input.due_date, recurrence: input.recurrence, status: "due" },
          line: `${billLabel({ name: input.name, amount_minor: minor, currency, due_date: input.due_date })}: new${recurrenceNote}`,
        },
      ],
      warnings: input.due_date < today ? [`The due date ${input.due_date} is already in the past; the bill will show as overdue.`] : [],
    },
    spoken: `add ${input.name}, ${spokenAmount(minor, currency)}, due ${spokenDate(input.due_date, today)}${input.recurrence === "none" ? "" : `, ${input.recurrence}`}`,
    policyScope: "",
    async execute(tx) {
      const bill = await insertBill(tx, ctx.household.id, today, {
        name: input.name,
        amount_minor: minor,
        currency,
        due_date: input.due_date,
        recurrence: input.recurrence,
      });
      return {
        output: { bill },
        spoken: `Added ${bill.name}, ${spokenAmount(minor, currency)}, due ${spokenDate(bill.due_date, today)}${input.recurrence === "none" ? "" : `, ${input.recurrence}`}.`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// update_bill
// ---------------------------------------------------------------------------

export const UpdateBillInputSchema = MutatingInputBaseSchema.extend({
  bill: z.string().trim().min(1).max(200).describe("The bill's name or id."),
  name: z.string().trim().min(1).max(100).optional(),
  amount: AmountSchema.optional(),
  currency: CurrencySchema.optional(),
  due_date: IsoDateSchema.optional(),
  recurrence: BillRecurrenceSchema.optional(),
}).refine((v) => [v.name, v.amount, v.currency, v.due_date, v.recurrence].some((f) => f !== undefined), {
  message: "Give at least one field to change: name, amount, currency, due_date or recurrence.",
});
export type UpdateBillInput = z.output<typeof UpdateBillInputSchema>;
export const UpdateBillResultSchema = z.object({ bill: BillSchema });
export type UpdateBillResult = z.output<typeof UpdateBillResultSchema>;

export async function planUpdateBill(input: UpdateBillInput, ctx: ToolContext): Promise<MutationPlan<UpdateBillResult>> {
  const today = todayInZone(ctx.now, ctx.household.timezone);
  const bill = await findBill(ctx.db, ctx.household.id, today, input.bill);
  if (bill.status === "paid") {
    throw new HousewardenError("ALREADY_DONE", `${bill.name} is already paid; paid bills can't be changed.`, { entity: "bill", id: bill.id });
  }
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const lines: string[] = [];
  const spokenParts: string[] = [];

  const next = {
    name: input.name ?? bill.name,
    amount_minor: input.amount !== undefined ? toMinor(input.amount) : toMinor(bill.amount),
    currency: input.currency ?? bill.currency,
    due_date: input.due_date ?? bill.due_date,
    recurrence: input.recurrence ?? bill.recurrence,
  };
  if (next.name !== bill.name) {
    before.name = bill.name;
    after.name = next.name;
    lines.push(`name ${bill.name} → ${next.name}`);
    spokenParts.push(`called ${next.name}`);
  }
  if (next.amount_minor !== toMinor(bill.amount) || next.currency !== bill.currency) {
    before.amount = bill.amount;
    before.currency = bill.currency;
    after.amount = fromMinor(next.amount_minor);
    after.currency = next.currency;
    lines.push(`amount ${bill.amount_formatted} → ${formatAmount(next.amount_minor, next.currency)}`);
    spokenParts.push(spokenAmount(next.amount_minor, next.currency));
  }
  if (next.due_date !== bill.due_date) {
    before.due_date = bill.due_date;
    after.due_date = next.due_date;
    lines.push(`due_date ${bill.due_date} → ${next.due_date}`);
    spokenParts.push(`due ${spokenDate(next.due_date, today)}`);
  }
  if (next.recurrence !== bill.recurrence) {
    before.recurrence = bill.recurrence;
    after.recurrence = next.recurrence;
    lines.push(`recurrence ${bill.recurrence} → ${next.recurrence}`);
    spokenParts.push(next.recurrence === "none" ? "not recurring" : next.recurrence);
  }
  if (lines.length === 0) {
    throw new HousewardenError("ALREADY_DONE", `${bill.name} already has those values; nothing to change.`, { entity: "bill", id: bill.id });
  }
  return {
    preview: {
      summary: `Update bill '${bill.name}' (${lines.join(", ")})`,
      changes: [
        {
          entity: "bill",
          id: bill.id,
          op: "update",
          label: bill.name,
          before,
          after,
          line: `${billLabel({ name: bill.name, amount_minor: toMinor(bill.amount), currency: bill.currency, due_date: bill.due_date })}: ${lines.join(", ")}`,
        },
      ],
      warnings: [],
    },
    spoken: `change ${bill.name} to be ${joinSpoken(spokenParts)}`,
    policyScope: "",
    async execute(tx) {
      await tx.query(
        `UPDATE bills SET name = $2, amount_minor = $3, currency = $4, due_date = $5::date, recurrence = $6 WHERE id = $1::uuid`,
        [bill.id, next.name, next.amount_minor, next.currency, next.due_date, next.recurrence],
      );
      const updated = await getBillById(tx, ctx.household.id, today, bill.id);
      if (!updated) throw new HousewardenError("INTERNAL", "Bill vanished during update");
      return { output: { bill: updated }, spoken: `${updated.name} is now ${joinSpoken(spokenParts)}.` };
    },
  };
}

// ---------------------------------------------------------------------------
// mark_bill_paid
// ---------------------------------------------------------------------------

export const MarkBillPaidInputSchema = MutatingInputBaseSchema.extend({
  bill: z.string().trim().min(1).max(200).describe("The bill's name or id."),
  paid_at: IsoInstantSchema.optional().describe("When it was paid; defaults to now."),
});
export type MarkBillPaidInput = z.output<typeof MarkBillPaidInputSchema>;
export const MarkBillPaidResultSchema = z.object({ bill: BillSchema, next_bill: BillSchema.nullable() });
export type MarkBillPaidResult = z.output<typeof MarkBillPaidResultSchema>;

export async function planMarkBillPaid(input: MarkBillPaidInput, ctx: ToolContext): Promise<MutationPlan<MarkBillPaidResult>> {
  const today = todayInZone(ctx.now, ctx.household.timezone);
  const bill = await findBill(ctx.db, ctx.household.id, today, input.bill);
  if (bill.status === "paid") {
    throw new HousewardenError("ALREADY_DONE", `${bill.name} is already marked paid.`, { entity: "bill", id: bill.id });
  }
  const minor = toMinor(bill.amount);
  const nextDue = nextDueDate(bill.due_date, bill.recurrence);
  const explicitPaidAt = input.paid_at ? new Date(input.paid_at) : null;
  // The preview must not depend on the clock (it is re-planned at confirm time),
  // so paid_at appears only when the caller fixed it.
  const after: Record<string, unknown> = { status: "paid" };
  const before: Record<string, unknown> = { status: bill.status };
  if (explicitPaidAt) {
    before.paid_at = null;
    after.paid_at = explicitPaidAt.toISOString();
  }
  const changes: Change[] = [
    {
      entity: "bill",
      id: bill.id,
      op: "update",
      label: bill.name,
      before,
      after,
      line: `${billLabel({ name: bill.name, amount_minor: minor, currency: bill.currency, due_date: bill.due_date })}: status ${bill.status} → paid`,
    },
  ];
  const warnings: string[] = [];
  if (nextDue) {
    changes.push({
      entity: "bill",
      id: null,
      op: "create",
      label: bill.name,
      before: null,
      after: { name: bill.name, amount: bill.amount, currency: bill.currency, due_date: nextDue, status: "due" },
      line: `${billLabel({ name: bill.name, amount_minor: minor, currency: bill.currency, due_date: nextDue })}: new (${bill.recurrence} recurrence)`,
    });
    warnings.push(`This bill recurs ${bill.recurrence}; the next one will be created for ${nextDue}.`);
  }
  return {
    preview: {
      summary: `Mark bill '${bill.name}' (${bill.amount_formatted}, due ${bill.due_date}) as paid`,
      changes,
      warnings,
    },
    spoken: `mark ${bill.name}, ${spokenAmount(minor, bill.currency)}, as paid${nextDue ? ` and create the next one, due ${spokenDate(nextDue, today)}` : ""}`,
    policyScope: "",
    async execute(tx, execCtx) {
      const paidAt = explicitPaidAt ?? execCtx.now;
      await tx.query(`UPDATE bills SET status = 'paid', paid_at = $2::timestamptz WHERE id = $1::uuid`, [bill.id, paidAt]);
      const paid = await getBillById(tx, ctx.household.id, today, bill.id);
      if (!paid) throw new HousewardenError("INTERNAL", "Bill vanished during payment");
      let nextBill: Bill | null = null;
      if (nextDue) {
        nextBill = await insertBill(tx, ctx.household.id, today, {
          name: bill.name,
          amount_minor: minor,
          currency: bill.currency,
          due_date: nextDue,
          recurrence: bill.recurrence,
        });
      }
      return {
        output: { bill: paid, next_bill: nextBill },
        spoken: `${paid.name} is marked paid.${nextBill ? ` The next one is due ${spokenDate(nextBill.due_date, today)}.` : ""}`,
      };
    },
  };
}
