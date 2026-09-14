import type { Metadata } from "next";
import { assignChore, completeChore, rotateChores } from "@/app/actions/chores";
import type { Chore, Member } from "@/lib/contracts";
import { loadConsole, withHousehold } from "@/lib/console/data";
import { fmtDue, fmtInstant } from "@/lib/console/format";
import { readQuery, type SearchParams } from "@/lib/console/page";
import { listChores, listMembers } from "@/lib/domain";
import { ConfirmSlot } from "@/components/ConfirmSlot";
import { EmptyState } from "@/components/EmptyState";
import { Flash } from "@/components/Flash";
import { ChoreForm } from "@/components/forms";
import { List, ListRow } from "@/components/ListRow";
import { NoHousehold } from "@/components/NoHousehold";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Chores" };

const CADENCE: Record<Chore["cadence"], string> = { once: "once", daily: "daily", weekly: "weekly", monthly: "monthly" };

function ChoreRow({ chore, members, today }: { chore: Chore; members: Member[]; today: string }) {
  const overdue = chore.due_date !== null && chore.due_date < today;
  return (
    <ListRow
      title={chore.title}
      meta={[chore.assigned_member ? chore.assigned_member.name : "unassigned", chore.due_date ? `due ${fmtDue(chore.due_date, today)}` : "no date", CADENCE[chore.cadence]]}
      chip={overdue ? { label: "overdue", tone: "danger" } : chore.due_date === today ? { label: "today", tone: "warn" } : undefined}
      trailing={
        <>
          <form action={assignChore} className="flex items-center gap-2">
            <input type="hidden" name="chore" value={chore.id} />
            <label className="sr-only" htmlFor={`assign-${chore.id}`}>
              Assign {chore.title} to
            </label>
            <select id={`assign-${chore.id}`} name="assign_to" className="input min-h-11 w-36 py-1 text-sm" defaultValue={chore.assigned_member?.id ?? ""}>
              <option value="">Nobody</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <SubmitButton size="sm" variant="secondary" pendingLabel="Assigning…">
              Assign
            </SubmitButton>
          </form>
          <form action={completeChore}>
            <input type="hidden" name="chore" value={chore.id} />
            <SubmitButton size="sm" variant="primary" pendingLabel="Completing…">
              Complete
            </SubmitButton>
          </form>
        </>
      }
    />
  );
}

export default async function ChoresPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [ctx, q] = await Promise.all([loadConsole("/chores"), readQuery(searchParams)]);
  const h = withHousehold(ctx);
  if (!h) {
    return (
      <>
        <PageHeader title="Chores" />
        <NoHousehold />
      </>
    );
  }

  const [all, members] = await Promise.all([listChores(h.db, h.household.id, { status: "all" }), listMembers(h.db, h.household.id)]);
  const open = all.filter((c) => c.status === "open");
  const done = all.filter((c) => c.status === "done").sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  const groups: { id: string; title: string; chores: Chore[] }[] = [
    { id: "overdue", title: "Overdue", chores: open.filter((c) => c.due_date !== null && c.due_date < h.today) },
    { id: "today", title: "Today", chores: open.filter((c) => c.due_date === h.today) },
    { id: "later", title: "Later", chores: open.filter((c) => c.due_date !== null && c.due_date > h.today).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")) },
    { id: "unscheduled", title: "Unscheduled", chores: open.filter((c) => c.due_date === null) },
  ].filter((g) => g.chores.length > 0);
  const rotatable = open.filter((c) => c.assigned_member !== null).length;

  return (
    <>
      <PageHeader
        title="Chores"
        description="Who does what and when. Completing a repeating chore schedules the next one for the same person."
        action={
          <form action={rotateChores}>
            <SubmitButton variant="secondary" pendingLabel="Rotating…" disabled={rotatable === 0}>
              Rotate chores
            </SubmitButton>
          </form>
        }
      />
      <Flash message={q.flash} tone={q.tone} />
      <ConfirmSlot id={q.confirm} ctx={h} returnTo="/chores" />

      {open.length === 0 ? (
        <div className="mb-8">
          <EmptyState title="No open chores" body="Add a chore below and assign it to someone. Rotate chores moves every assigned chore to the next person." />
        </div>
      ) : (
        groups.map((g) => (
          <Section key={g.id} id={`chores-${g.id}`} title={g.title} count={g.chores.length}>
            <List>
              {g.chores.map((c) => (
                <ChoreRow key={c.id} chore={c} members={members} today={h.today} />
              ))}
            </List>
          </Section>
        ))
      )}

      <Section id="add-chore" title="Add a chore">
        <div className="rounded-lg border border-border bg-surface p-4 md:p-6">
          <ChoreForm members={members.map((m) => ({ id: m.id, name: m.name }))} />
        </div>
      </Section>

      {done.length > 0 && (
        <details className="row-details">
          <summary className="mb-3 inline-flex min-h-11 items-center text-base font-semibold text-ink">
            Done <span className="ml-2 text-sm font-normal text-ink-3">{done.length}</span>
            <span className="when-closed ml-2 text-sm font-normal text-accent">Show</span>
            <span className="when-open ml-2 text-sm font-normal text-accent">Hide</span>
          </summary>
          <List>
            {done.map((c) => (
              <ListRow key={c.id} muted title={c.title} meta={[c.assigned_member ? c.assigned_member.name : "unassigned", c.completed_at ? `done ${fmtInstant(c.completed_at, h.household.timezone, h.today)}` : "done"]} chip={{ label: "done", tone: "accent" }} />
            ))}
          </List>
        </details>
      )}
    </>
  );
}
