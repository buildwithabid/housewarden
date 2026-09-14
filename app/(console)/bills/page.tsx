import type { Metadata } from "next";
import { markBillPaid, updateBill } from "@/app/actions/bills";
import type { Bill } from "@/lib/contracts";
import { loadConsole, withHousehold } from "@/lib/console/data";
import { billTone, fmtDue, fmtInstant } from "@/lib/console/format";
import { readQuery, type SearchParams } from "@/lib/console/page";
import { listBills } from "@/lib/domain";
import { ConfirmSlot } from "@/components/ConfirmSlot";
import { EmptyState } from "@/components/EmptyState";
import { Flash } from "@/components/Flash";
import { BillForm } from "@/components/forms";
import { List, ListRow } from "@/components/ListRow";
import { NoHousehold } from "@/components/NoHousehold";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Bills" };

const RECURRENCE: Record<Bill["recurrence"], string> = { none: "one-off", monthly: "monthly", yearly: "yearly" };

function EditBill({ bill }: { bill: Bill }) {
  return (
    <details className="row-details mt-1">
      <summary className="inline-flex min-h-8 items-center rounded-md text-sm text-accent hover:underline">
        <span className="when-closed">Edit</span>
        <span className="when-open">Close</span>
      </summary>
      <form action={updateBill} className="mt-3 grid gap-3 rounded-lg border border-border bg-surface-2 p-3 sm:grid-cols-2" aria-label={`Edit ${bill.name}`}>
        <input type="hidden" name="bill" value={bill.id} />
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Name
          <input name="name" className="input text-sm" defaultValue={bill.name} maxLength={100} required />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Amount ({bill.currency})
          <input name="amount" className="input tabular text-sm" type="number" inputMode="decimal" min="0" step="0.01" defaultValue={bill.amount} required />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Due date
          <input name="due_date" className="input text-sm" type="date" defaultValue={bill.due_date} required />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Repeats
          <select name="recurrence" className="input text-sm" defaultValue={bill.recurrence}>
            <option value="none">Does not repeat</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>
        <input type="hidden" name="currency" value={bill.currency} />
        <div className="sm:col-span-2 sm:flex sm:justify-end">
          <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…" className="w-full sm:w-auto">
            Save changes
          </SubmitButton>
        </div>
      </form>
    </details>
  );
}

export default async function BillsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [ctx, q] = await Promise.all([loadConsole("/bills"), readQuery(searchParams)]);
  const h = withHousehold(ctx);
  if (!h) {
    return (
      <>
        <PageHeader title="Bills" />
        <NoHousehold />
      </>
    );
  }

  const all = await listBills(h.db, h.household.id, h.today, "all");
  const unpaid = all.filter((b) => b.status !== "paid").sort((a, b) => a.due_date.localeCompare(b.due_date));
  const paid = all.filter((b) => b.status === "paid").sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""));
  const tz = h.household.timezone;

  return (
    <>
      <PageHeader title="Bills" description="What the house pays and when. Marking a bill paid asks for approval; a recurring one creates its next occurrence." />
      <Flash message={q.flash} tone={q.tone} />
      <ConfirmSlot id={q.confirm} ctx={h} returnTo="/bills" />

      <Section id="unpaid" title="Due" count={unpaid.length}>
        {unpaid.length === 0 ? (
          <EmptyState title="No bills" body="Add the ones you pay every month and Housewarden will tell you what’s due." />
        ) : (
          <List>
            {unpaid.map((bill) => (
              <ListRow
                key={bill.id}
                title={bill.name}
                meta={[bill.amount_formatted, `due ${fmtDue(bill.due_date, h.today)}`, RECURRENCE[bill.recurrence]]}
                chip={{ label: bill.status === "overdue" ? "overdue" : bill.days_until_due !== null && bill.days_until_due <= 3 ? "due soon" : "due", tone: billTone(bill.status, bill.days_until_due) }}
                extra={<EditBill bill={bill} />}
                trailing={
                  <form action={markBillPaid}>
                    <input type="hidden" name="bill" value={bill.id} />
                    <SubmitButton size="sm" variant="primary" pendingLabel="Proposing…">
                      Mark paid
                    </SubmitButton>
                  </form>
                }
              />
            ))}
          </List>
        )}
      </Section>

      <Section id="add-bill" title="Add a bill">
        <div className="rounded-lg border border-border bg-surface p-4 md:p-6">
          <BillForm currency={h.household.currency} today={h.today} />
        </div>
      </Section>

      {paid.length > 0 && (
        <details className="row-details">
          <summary className="mb-3 inline-flex min-h-11 items-center text-base font-semibold text-ink">
            Paid <span className="ml-2 text-sm font-normal text-ink-3">{paid.length}</span>
            <span className="when-closed ml-2 text-sm font-normal text-accent">Show</span>
            <span className="when-open ml-2 text-sm font-normal text-accent">Hide</span>
          </summary>
          <List>
            {paid.map((bill) => (
              <ListRow key={bill.id} muted title={bill.name} meta={[bill.amount_formatted, bill.paid_at ? `paid ${fmtInstant(bill.paid_at, tz, h.today)}` : "paid", RECURRENCE[bill.recurrence]]} chip={{ label: "paid", tone: "accent" }} />
            ))}
          </List>
        </details>
      )}
    </>
  );
}
