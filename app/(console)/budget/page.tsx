import type { Metadata } from "next";
import { loadConsole, withHousehold } from "@/lib/console/data";
import { fmtInstant } from "@/lib/console/format";
import { readQuery, type SearchParams } from "@/lib/console/page";
import { withQuery } from "@/lib/console/url";
import { getBudgetSummary, listMembers } from "@/lib/domain";
import { addMonths, isValidMonth, monthName, monthOf } from "@/lib/time";
import { ConfirmSlot } from "@/components/ConfirmSlot";
import { EmptyState } from "@/components/EmptyState";
import { Flash } from "@/components/Flash";
import { ExpenseForm } from "@/components/forms";
import { LinkButton } from "@/components/Button";
import { List, ListRow } from "@/components/ListRow";
import { NoHousehold } from "@/components/NoHousehold";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { Tile } from "@/components/Tile";

export const metadata: Metadata = { title: "Budget" };

function monthLabel(month: string): string {
  return `${monthName(month)} ${month.slice(0, 4)}`;
}

export default async function BudgetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [ctx, q] = await Promise.all([loadConsole("/budget"), readQuery(searchParams)]);
  const h = withHousehold(ctx);
  if (!h) {
    return (
      <>
        <PageHeader title="Budget" />
        <NoHousehold />
      </>
    );
  }

  const thisMonth = monthOf(h.today);
  const requested = q.get("month");
  const month = requested && isValidMonth(requested) ? requested : thisMonth;
  const [summary, members] = await Promise.all([getBudgetSummary(h.db, h.household, h.now, month), listMembers(h.db, h.household.id)]);
  const prev = monthOf(addMonths(`${month}-01`, -1));
  const next = monthOf(addMonths(`${month}-01`, 1));
  const page = withQuery("/budget", { month });
  const tz = h.household.timezone;
  const categories = [...new Set(summary.entries.map((e) => e.category))].sort();
  const delta = summary.total.amount - summary.previous_month.total.amount;
  const deltaHint =
    summary.previous_month.total.amount === 0
      ? `nothing recorded in ${monthName(summary.previous_month.month)}`
      : delta === 0
        ? `same as ${monthName(summary.previous_month.month)}`
        : `${delta > 0 ? "up" : "down"} ${Math.abs(Math.round((delta / summary.previous_month.total.amount) * 100))}% on ${monthName(summary.previous_month.month)}`;

  return (
    <>
      <PageHeader
        title="Budget"
        description="Money spent by category, from expenses the house records. Bills marked paid are counted separately."
        action={
          <div className="flex items-center gap-2">
            <LinkButton href={withQuery("/budget", { month: prev })} size="sm">
              ‹ {monthName(prev)}
            </LinkButton>
            <form method="get" action="/budget" className="flex items-center gap-2">
              <label className="sr-only" htmlFor="month">
                Month
              </label>
              <input id="month" name="month" type="month" className="input min-h-11 w-40 py-1 text-sm" defaultValue={month} />
              <LinkButton href={withQuery("/budget", { month: next })} size="sm">
                {monthName(next)} ›
              </LinkButton>
            </form>
          </div>
        }
      />
      <Flash message={q.flash} tone={q.tone} />
      <ConfirmSlot id={q.confirm} ctx={h} returnTo={page} />

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        <Tile label={monthLabel(month)} value={summary.total.amount ? summary.total.amount_formatted : "—"} hint={deltaHint} tone={delta > 0 ? "warn" : "neutral"} />
        <Tile label={monthLabel(summary.previous_month.month)} value={summary.previous_month.total.amount ? summary.previous_month.total.amount_formatted : "—"} hint="expenses recorded" />
        <Tile label="Bills paid" value={summary.bills_paid.count ? summary.bills_paid.amount_formatted : "—"} hint={summary.bills_paid.count ? `${summary.bills_paid.count} paid in ${monthName(month)}` : `none paid in ${monthName(month)}`} tone={summary.bills_paid.count ? "accent" : "neutral"} />
      </div>

      <Section id="by-category" title="By category" count={summary.by_category.length}>
        {summary.by_category.length === 0 ? (
          <EmptyState title={`Nothing recorded in ${monthName(month)}`} body="Record an expense below and it appears here by category." />
        ) : (
          <div className="rounded-lg border border-border bg-surface p-4 md:p-6">
            <ul className="flex flex-col gap-3">
              {summary.by_category.map((c) => (
                <li key={c.category}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium text-ink">{c.category}</span>
                    <span className="tabular font-mono text-ink-2">
                      {c.amount_formatted} <span className="text-ink-3">· {Math.round(c.share * 100)}%</span>
                    </span>
                  </div>
                  <div className="bar-track mt-1" aria-hidden="true">
                    <div className="bar" style={{ width: `${Math.max(2, Math.round(c.share * 100))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section id="record" title="Record an expense">
        <div className="rounded-lg border border-border bg-surface p-4 md:p-6">
          <ExpenseForm members={members.map((m) => ({ id: m.id, name: m.name }))} categories={categories} currency={h.household.currency} timeZone={tz} month={month} />
        </div>
      </Section>

      <Section id="entries" title="Entries" count={summary.entries.length}>
        {summary.entries.length === 0 ? (
          <p className="text-sm text-ink-2">No expenses in {monthLabel(month)}.</p>
        ) : (
          <List>
            {summary.entries.map((e) => (
              <ListRow
                key={e.id}
                title={e.note ? `${e.category} · ${e.note}` : e.category}
                meta={[fmtInstant(e.occurred_at, tz, h.today), e.member ? `paid by ${e.member.name}` : "payer not recorded"]}
                trailing={<span className="tabular font-mono text-ink">{e.amount_formatted}</span>}
              />
            ))}
          </List>
        )}
      </Section>
    </>
  );
}
