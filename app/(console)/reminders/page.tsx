import type { Metadata } from "next";
import { cancelReminder } from "@/app/actions/reminders";
import { loadConsole, withHousehold } from "@/lib/console/data";
import { fmtInstant, reminderTone } from "@/lib/console/format";
import { readQuery, type SearchParams } from "@/lib/console/page";
import { listMembers, listReminders } from "@/lib/domain";
import { addDays } from "@/lib/time";
import { ConfirmSlot } from "@/components/ConfirmSlot";
import { EmptyState } from "@/components/EmptyState";
import { Flash } from "@/components/Flash";
import { ReminderForm } from "@/components/forms";
import { List, ListRow } from "@/components/ListRow";
import { NoHousehold } from "@/components/NoHousehold";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Reminders" };

export default async function RemindersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [ctx, q] = await Promise.all([loadConsole("/reminders"), readQuery(searchParams)]);
  const h = withHousehold(ctx);
  if (!h) {
    return (
      <>
        <PageHeader title="Reminders" />
        <NoHousehold />
      </>
    );
  }

  const [all, members] = await Promise.all([listReminders(h.db, h.household.id, { status: "all" }), listMembers(h.db, h.household.id)]);
  const upcoming = all.filter((r) => r.status === "scheduled");
  const past = all.filter((r) => r.status !== "scheduled").sort((a, b) => b.at.localeCompare(a.at));
  const tz = h.household.timezone;

  return (
    <>
      <PageHeader title="Reminders" description={`One-off reminders for the house or for one person. Times are in ${tz}.`} />
      <Flash message={q.flash} tone={q.tone} />
      <ConfirmSlot id={q.confirm} ctx={h} returnTo="/reminders" />

      <Section id="upcoming" title="Upcoming" count={upcoming.length}>
        {upcoming.length === 0 ? (
          <EmptyState title="No reminders" body="Add one below with a time in the future, or ask the assistant to remind you." />
        ) : (
          <List>
            {upcoming.map((r) => (
              <ListRow
                key={r.id}
                title={r.text}
                meta={[fmtInstant(r.at, tz, h.today), r.member ? `for ${r.member.name}` : "for everyone"]}
                chip={new Date(r.at).getTime() < h.now.getTime() ? { label: "passed", tone: "warn" } : undefined}
                trailing={
                  <form action={cancelReminder}>
                    <input type="hidden" name="reminder" value={r.id} />
                    <SubmitButton size="sm" variant="danger-secondary" pendingLabel="Cancelling…">
                      Cancel
                    </SubmitButton>
                  </form>
                }
              />
            ))}
          </List>
        )}
      </Section>

      <Section id="add-reminder" title="Add a reminder">
        <div className="rounded-lg border border-border bg-surface p-4 md:p-6">
          <ReminderForm members={members.map((m) => ({ id: m.id, name: m.name }))} timeZone={tz} defaultAt={`${addDays(h.today, 1)}T09:00`} />
        </div>
      </Section>

      {past.length > 0 && (
        <details className="row-details">
          <summary className="mb-3 inline-flex min-h-11 items-center text-base font-semibold text-ink">
            Done and cancelled <span className="ml-2 text-sm font-normal text-ink-3">{past.length}</span>
            <span className="when-closed ml-2 text-sm font-normal text-accent">Show</span>
            <span className="when-open ml-2 text-sm font-normal text-accent">Hide</span>
          </summary>
          <List>
            {past.map((r) => (
              <ListRow key={r.id} muted title={r.text} meta={[fmtInstant(r.at, tz, h.today), r.member ? `for ${r.member.name}` : "for everyone"]} chip={{ label: r.status, tone: reminderTone(r.status) }} />
            ))}
          </List>
        </details>
      )}
    </>
  );
}
