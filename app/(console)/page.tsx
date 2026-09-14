import type { Metadata } from "next";
import { loadConsole, withHousehold } from "@/lib/console/data";
import { billTone, fmtDue, fmtInstant, plural } from "@/lib/console/format";
import { readQuery, type SearchParams } from "@/lib/console/page";
import { getHouseholdSummary } from "@/lib/domain";
import { sweepExpiredNow } from "@/lib/guard";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { Flash } from "@/components/Flash";
import { LinkButton } from "@/components/Button";
import { List, ListRow } from "@/components/ListRow";
import { LoadDemoButton } from "@/components/NoHousehold";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { Tile } from "@/components/Tile";

export const metadata: Metadata = { title: "Dashboard" };

function deviceStateLabel(kind: string, state: Record<string, unknown>): string {
  switch (kind) {
    case "lock":
      return state.locked ? "Locked" : "Unlocked";
    case "thermostat":
      return `${String(state.mode ?? "off")} · ${String(state.target_c ?? "—")}°C`;
    case "light":
      return state.on ? `On${typeof state.brightness === "number" ? ` · ${state.brightness}%` : ""}` : "Off";
    case "plug":
      return state.on ? "On" : "Off";
    default:
      return "—";
  }
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [ctx, q] = await Promise.all([loadConsole("/"), readQuery(searchParams)]);
  const h = withHousehold(ctx);

  if (!h) {
    return (
      <>
        <Flash message={q.flash} tone={q.tone} />
        <section className="rounded-xl border border-border bg-surface px-4 py-10 text-center md:px-6 md:py-16">
          <p className="text-xs font-medium uppercase text-ink-2">Housewarden console</p>
          <h1 className="mt-2 text-xl">No household yet</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-ink-2">
            Load the demo family to see how Housewarden works: bills, chores, a shopping list, reminders, a budget, two simulated devices and a
            bedtime routine. Every change an assistant proposes shows up here for you to approve, and everything is written to a
            hash-chained audit log.
          </p>
          <div className="mt-6 flex justify-center">
            <LoadDemoButton />
          </div>
        </section>
      </>
    );
  }

  await sweepExpiredNow(h.db, h.now);
  const s = await getHouseholdSummary(h.db, h.household, h.now);
  const tz = h.household.timezone;
  const unpaid = s.counts.bills_due + s.counts.bills_overdue;
  const todayCount = s.due_today.bills.length + s.overdue_bills.length + s.due_today.chores.length + s.due_today.reminders.length;

  return (
    <>
      <Flash message={q.flash} tone={q.tone} />
      <PageHeader title={h.household.name} description={`${plural(s.counts.members, "member")} · ${h.household.currency} · ${tz}`} />

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-6">
        <Tile
          label="Bills due"
          value={unpaid ? String(unpaid) : "—"}
          hint={s.counts.bills_overdue ? `${s.counts.bills_overdue} overdue` : unpaid ? "none overdue" : "nothing unpaid"}
          tone={s.counts.bills_overdue ? "danger" : unpaid ? "neutral" : "accent"}
          href="/bills"
        />
        <Tile
          label="Chores open"
          value={s.counts.chores_open ? String(s.counts.chores_open) : "—"}
          hint={s.counts.chores_due_today ? `${s.counts.chores_due_today} due today` : "none due today"}
          tone={s.counts.chores_due_today ? "warn" : "neutral"}
          href="/chores"
        />
        <Tile label="Shopping" value={s.counts.shopping_to_buy ? String(s.counts.shopping_to_buy) : "—"} hint="to buy" href="/shopping" />
        <Tile label="Reminders" value={s.counts.reminders_next_24h ? String(s.counts.reminders_next_24h) : "—"} hint="next 24 hours" href="/reminders" />
        <Tile
          label="Pending"
          value={s.counts.pending_confirmations ? String(s.counts.pending_confirmations) : "—"}
          hint={s.counts.pending_confirmations ? "waiting for you" : "nothing waiting"}
          tone={s.counts.pending_confirmations ? "warn" : "neutral"}
          href="/pending"
        />
        <Tile
          label="Audit chain"
          value={s.audit.rows ? String(s.audit.rows) : "—"}
          hint={s.audit.chain_intact ? "chain intact" : "chain broken"}
          tone={s.audit.chain_intact ? "accent" : "danger"}
          href="/audit"
        />
      </div>

      <Section id="today" title="Today" count={todayCount}>
        {todayCount === 0 ? (
          <EmptyState title="Nothing due today" body="No bills, chores or reminders are due today. The lists have everything that is coming up." />
        ) : (
          <List>
            {s.overdue_bills.map((b) => (
              <ListRow key={b.id} title={b.name} meta={[b.amount_formatted, `due ${fmtDue(b.due_date, h.today)}`]} chip={{ label: "overdue", tone: billTone(b.status, b.days_until_due) }} trailing={<LinkButton href="/bills" size="sm">Open bills</LinkButton>} />
            ))}
            {s.due_today.bills.map((b) => (
              <ListRow key={b.id} title={b.name} meta={[b.amount_formatted, "due today"]} chip={{ label: "due today", tone: "warn" }} trailing={<LinkButton href="/bills" size="sm">Open bills</LinkButton>} />
            ))}
            {s.due_today.chores.map((c) => (
              <ListRow
                key={c.id}
                title={c.title}
                meta={[c.assigned_member ? c.assigned_member.name : "unassigned", c.due_date ? `due ${fmtDue(c.due_date, h.today)}` : "no date"]}
                chip={c.due_date && c.due_date < h.today ? { label: "overdue", tone: "danger" } : { label: "chore", tone: "neutral" }}
                trailing={<LinkButton href="/chores" size="sm">Open chores</LinkButton>}
              />
            ))}
            {s.due_today.reminders.map((r) => (
              <ListRow key={r.id} title={r.text} meta={[fmtInstant(r.at, tz, h.today), r.member ? `for ${r.member.name}` : "for everyone"]} chip={{ label: "reminder", tone: "info" }} trailing={<LinkButton href="/reminders" size="sm">Open reminders</LinkButton>} />
            ))}
          </List>
        )}
      </Section>

      {s.devices.length > 0 && (
        <Section id="devices" title="Devices" count={s.devices.length}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
            {s.devices.map((d) => (
              <Tile key={d.id} label={d.kind} value={d.name} hint={deviceStateLabel(d.kind, d.state)} href="/devices" />
            ))}
          </div>
        </Section>
      )}

      {!s.audit.chain_intact && (
        <p className="mt-2 flex items-center gap-2 text-sm text-danger">
          <Chip tone="danger">chain broken</Chip> The audit log does not verify. Open the audit page to see where.
        </p>
      )}
    </>
  );
}
