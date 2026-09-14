import type { Metadata } from "next";
import { loadConsole, withHousehold } from "@/lib/console/data";
import { fmtAgo, pendingStatusTone, toolTitle } from "@/lib/console/format";
import { memberNameOf, memberNames, readQuery, type SearchParams } from "@/lib/console/page";
import { listDecidedActions, listMembers, listPendingActions } from "@/lib/domain";
import { sweepExpiredNow } from "@/lib/guard";
import { ConfirmationCard } from "@/components/ConfirmationCard";
import { EmptyState } from "@/components/EmptyState";
import { Flash } from "@/components/Flash";
import { LinkButton } from "@/components/Button";
import { List, ListRow } from "@/components/ListRow";
import { NoHousehold } from "@/components/NoHousehold";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export const metadata: Metadata = { title: "Pending approvals" };

export default async function PendingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [ctx, q] = await Promise.all([loadConsole("/pending"), readQuery(searchParams)]);
  const h = withHousehold(ctx);
  if (!h) {
    return (
      <>
        <PageHeader title="Pending approvals" />
        <NoHousehold />
      </>
    );
  }

  await sweepExpiredNow(h.db, h.now);
  const [pending, decided, members] = await Promise.all([
    listPendingActions(h.db, h.household.id, { status: "pending", limit: 50, now: h.now }),
    listDecidedActions(h.db, h.household.id, h.now, 20),
    listMembers(h.db, h.household.id),
  ]);
  const names = memberNames(members);
  const tz = h.household.timezone;

  return (
    <>
      <PageHeader
        title="Pending approvals"
        description="What the assistant wants to change and is waiting for a person to allow. Nothing here has happened yet."
      />
      <Flash message={q.flash} tone={q.tone} />

      {pending.length === 0 ? (
        <EmptyState title="Nothing waiting" body="When the assistant proposes something that needs a person, it appears here with what would change." />
      ) : (
        <div className="flex flex-col gap-4">
          {pending.map((action) => (
            <ConfirmationCard
              key={action.id}
              action={action}
              memberName={memberNameOf(action.created_by.member_id, names)}
              timeZone={tz}
              today={h.today}
              nowIso={h.now.toISOString()}
              returnTo="/pending"
            />
          ))}
        </div>
      )}

      <div className="mt-8">
        <Section id="decided" title="Recent decisions" count={decided.length}>
          {decided.length === 0 ? (
            <p className="text-sm text-ink-2">No proposals have been decided yet.</p>
          ) : (
            <List>
              {decided.map((a) => {
                const forName = memberNameOf(a.created_by.member_id, names);
                return (
                  <ListRow
                    key={a.id}
                    title={a.preview.summary}
                    meta={[
                      toolTitle(a.tool),
                      `asked by ${a.created_by.label}${forName ? ` for ${forName}` : ""}`,
                      a.decided_by
                        ? `${a.status} by ${a.decided_by.label} ${fmtAgo(a.decided_at ?? a.created_at, h.now, tz, h.today)}`
                        : `${a.status} ${fmtAgo(a.executed_at ?? a.created_at, h.now, tz, h.today)}`,
                    ]}
                    chip={{ label: a.status, tone: pendingStatusTone(a.status) }}
                    trailing={
                      <LinkButton href={`/audit?action=${a.id}`} size="sm">
                        Audit trail
                      </LinkButton>
                    }
                  />
                );
              })}
            </List>
          )}
        </Section>
      </div>
    </>
  );
}
