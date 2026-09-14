import { z } from "zod";
import {
  AmountSchema,
  BudgetEntrySchema,
  CurrencySchema,
  EntityRefSchema,
  HousewardenError,
  IsoInstantSchema,
  MutatingInputBaseSchema,
  type BudgetEntry,
  type Household,
  type Member,
  type MutationPlan,
  type Queryable,
  type ToolContext,
} from "@/lib/contracts";
import { formatAmount, fromMinor, spokenAmount, toMinor } from "@/lib/money";
import { monthName, monthOf, monthRange, previousMonth, todayInZone } from "@/lib/time";
import { findMember } from "./members";


interface BudgetRow extends Record<string, unknown> {
  id: string;
  amount_minor: number;
  currency: string;
  category: string;
  note: string | null;
  member_id: string | null;
  member_name: string | null;
  occurred_at: Date;
}

const ENTRY_SELECT = `
  SELECT b.id, b.amount_minor, b.currency, b.category, b.note, b.member_id, m.name AS member_name, b.occurred_at
  FROM budget_entries b LEFT JOIN members m ON m.id = b.member_id
  WHERE b.household_id = $1`;

function rowToEntry(row: BudgetRow): BudgetEntry {
  return {
    id: row.id,
    amount: fromMinor(row.amount_minor),
    currency: row.currency,
    amount_formatted: formatAmount(row.amount_minor, row.currency),
    category: row.category,
    note: row.note,
    member: row.member_id && row.member_name ? { id: row.member_id, name: row.member_name } : null,
    occurred_at: row.occurred_at.toISOString(),
  };
}

export interface NewBudgetEntry {
  amount_minor: number;
  currency: string;
  category: string;
  note?: string | null;
  member_id?: string | null;
  occurred_at: Date;
}

export async function insertBudgetEntry(tx: Queryable, householdId: string, input: NewBudgetEntry): Promise<BudgetEntry> {
  const res = await tx.query<{ id: string }>(
    `INSERT INTO budget_entries (household_id, amount_minor, currency, category, note, member_id, occurred_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7::timestamptz) RETURNING id`,
    [householdId, input.amount_minor, input.currency, input.category, input.note ?? null, input.member_id ?? null, input.occurred_at],
  );
  const found = await tx.query<BudgetRow>(`${ENTRY_SELECT} AND b.id = $2::uuid`, [householdId, res.rows[0].id]);
  if (!found.rows[0]) throw new HousewardenError("INTERNAL", "Budget entry vanished after insert");
  return rowToEntry(found.rows[0]);
}

/** Entries in [start, end), newest first. */
export async function listBudgetEntries(
  db: Queryable,
  householdId: string,
  range: { start: Date; end: Date },
  limit = 50,
): Promise<BudgetEntry[]> {
  const res = await db.query<BudgetRow>(
    `${ENTRY_SELECT} AND b.occurred_at >= $2::timestamptz AND b.occurred_at < $3::timestamptz ORDER BY b.occurred_at DESC LIMIT $4`,
    [householdId, range.start, range.end, Math.min(Math.max(limit, 1), 500)],
  );
  return res.rows.map(rowToEntry);
}

/** Sum of entries in the household currency within [start, end), in minor units. */
export async function sumBudgetMinor(db: Queryable, householdId: string, currency: string, range: { start: Date; end: Date }): Promise<number> {
  const res = await db.query<{ total: number }>(
    `SELECT coalesce(sum(amount_minor), 0)::bigint AS total FROM budget_entries
     WHERE household_id = $1 AND currency = $2 AND occurred_at >= $3::timestamptz AND occurred_at < $4::timestamptz`,
    [householdId, currency, range.start, range.end],
  );
  return res.rows[0]?.total ?? 0;
}

export interface BudgetCategoryTotal {
  category: string;
  amount: number;
  amount_formatted: string;
  /** 0–1 share of the month's total. */
  share: number;
}

export interface BudgetSummary {
  month: string;
  currency: string;
  total: { amount: number; amount_formatted: string };
  by_category: BudgetCategoryTotal[];
  entries: BudgetEntry[];
  bills_paid: { count: number; amount: number; amount_formatted: string };
  previous_month: { month: string; total: { amount: number; amount_formatted: string } };
}

export const BudgetSummarySchema = z.object({
  month: z.string(),
  currency: CurrencySchema,
  total: z.object({ amount: z.number(), amount_formatted: z.string() }),
  by_category: z.array(z.object({ category: z.string(), amount: z.number(), amount_formatted: z.string(), share: z.number() })),
  entries: z.array(BudgetEntrySchema),
  bills_paid: z.object({ count: z.number().int(), amount: z.number(), amount_formatted: z.string() }),
  previous_month: z.object({ month: z.string(), total: z.object({ amount: z.number(), amount_formatted: z.string() }) }),
});

/** Month summary in the household currency (get_budget_summary and /budget). */
export async function getBudgetSummary(db: Queryable, household: Household, now: Date, month?: string): Promise<BudgetSummary> {
  const m = month ?? monthOf(todayInZone(now, household.timezone));
  const range = monthRange(m, household.timezone);
  const prev = previousMonth(m);
  const prevRange = monthRange(prev, household.timezone);
  const currency = household.currency;

  const byCat = await db.query<{ category: string; total: number }>(
    `SELECT category, sum(amount_minor)::bigint AS total FROM budget_entries
     WHERE household_id = $1 AND currency = $2 AND occurred_at >= $3::timestamptz AND occurred_at < $4::timestamptz
     GROUP BY category ORDER BY total DESC, category`,
    [household.id, currency, range.start, range.end],
  );
  const totalMinor = byCat.rows.reduce((s, r) => s + r.total, 0);
  const billsPaid = await db.query<{ n: number; total: number }>(
    `SELECT count(*)::int AS n, coalesce(sum(amount_minor), 0)::bigint AS total FROM bills
     WHERE household_id = $1 AND currency = $2 AND paid_at IS NOT NULL AND paid_at >= $3::timestamptz AND paid_at < $4::timestamptz`,
    [household.id, currency, range.start, range.end],
  );
  const prevMinor = await sumBudgetMinor(db, household.id, currency, prevRange);
  const entries = await listBudgetEntries(db, household.id, range, 50);
  const fmt = (minor: number) => ({ amount: fromMinor(minor), amount_formatted: formatAmount(minor, currency) });

  return {
    month: m,
    currency,
    total: fmt(totalMinor),
    by_category: byCat.rows.map((r) => ({
      category: r.category,
      ...fmt(r.total),
      share: totalMinor > 0 ? Math.round((r.total / totalMinor) * 1000) / 1000 : 0,
    })),
    entries,
    bills_paid: { count: billsPaid.rows[0]?.n ?? 0, ...fmt(billsPaid.rows[0]?.total ?? 0) },
    previous_month: { month: prev, total: fmt(prevMinor) },
  };
}

// ---------------------------------------------------------------------------
// record_expense
// ---------------------------------------------------------------------------

export const RecordExpenseInputSchema = MutatingInputBaseSchema.extend({
  amount: AmountSchema.describe("Amount spent, in major units."),
  currency: CurrencySchema.optional().describe("ISO-4217 code; defaults to the household currency."),
  category: z.string().trim().min(1).max(60).describe("e.g. Groceries, Fuel, School."),
  note: z.string().trim().max(300).optional().describe("Where or what, e.g. the shop name."),
  occurred_at: IsoInstantSchema.optional().describe("When; defaults to now."),
  paid_by: EntityRefSchema.optional().describe("Member name or id who paid."),
});
export type RecordExpenseInput = z.output<typeof RecordExpenseInputSchema>;
export const RecordExpenseResultSchema = z.object({
  entry: BudgetEntrySchema,
  month_total: z.object({ month: z.string(), amount: z.number(), amount_formatted: z.string() }),
});
export type RecordExpenseResult = z.output<typeof RecordExpenseResultSchema>;

export async function planRecordExpense(input: RecordExpenseInput, ctx: ToolContext): Promise<MutationPlan<RecordExpenseResult>> {
  const currency = input.currency ?? ctx.household.currency;
  const minor = toMinor(input.amount);
  const explicitAt = input.occurred_at ? new Date(input.occurred_at) : null;
  if (explicitAt && Number.isNaN(explicitAt.getTime())) throw new HousewardenError("VALIDATION", "occurred_at is not a valid instant.");
  const member: Member | null = input.paid_by ? await findMember(ctx.db, ctx.household.id, input.paid_by) : null;
  const note = input.note && input.note.length ? input.note : null;
  // occurred_at appears in the preview only when the caller fixed it, so the
  // preview does not change between proposal and approval.
  const after: Record<string, unknown> = { amount: input.amount, currency, category: input.category, note, member: member ? member.name : null };
  if (explicitAt) after.occurred_at = explicitAt.toISOString();
  return {
    preview: {
      summary: `Record expense ${formatAmount(minor, currency)} for ${input.category}${member ? ` (paid by ${member.name})` : ""}`,
      changes: [
        {
          entity: "budget_entry",
          id: null,
          op: "create",
          label: `${input.category} ${formatAmount(minor, currency)}`,
          before: null,
          after,
          line: `budget entry ${formatAmount(minor, currency)} ${input.category}${note ? ` '${note}'` : ""}${member ? ` by ${member.name}` : ""}: new`,
        },
      ],
      warnings: currency !== ctx.household.currency ? [`${currency} is not the household currency; it will not count towards the ${ctx.household.currency} monthly total.`] : [],
    },
    spoken: `record ${spokenAmount(minor, currency)} for ${input.category.toLowerCase()}${member ? `, paid by ${member.name}` : ""}`,
    policyScope: "",
    async execute(tx, execCtx) {
      const occurredAt = explicitAt ?? execCtx.now;
      const entry = await insertBudgetEntry(tx, ctx.household.id, {
        amount_minor: minor,
        currency,
        category: input.category,
        note,
        member_id: member?.id ?? null,
        occurred_at: occurredAt,
      });
      const month = monthOf(todayInZone(occurredAt, ctx.household.timezone));
      const total = await sumBudgetMinor(tx, ctx.household.id, ctx.household.currency, monthRange(month, ctx.household.timezone));
      return {
        output: {
          entry,
          month_total: { month, amount: fromMinor(total), amount_formatted: formatAmount(total, ctx.household.currency) },
        },
        spoken: `Recorded ${spokenAmount(minor, currency)} for ${input.category.toLowerCase()}. ${monthName(month)} is at ${spokenAmount(total, ctx.household.currency)}.`,
      };
    },
  };
}
