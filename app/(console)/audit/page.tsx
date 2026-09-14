import type { Metadata } from "next";
import Link from "next/link";
import { verifyAudit } from "@/app/actions/guard";
import { listAuditRows, verifyAuditChain } from "@/lib/audit";
import { loadConsole } from "@/lib/console/data";
import { auditEventTone, fmtHash, fmtInstant, fmtInstantLong, plural, toolTitle } from "@/lib/console/format";
import { readQuery, type SearchParams } from "@/lib/console/page";
import { withQuery } from "@/lib/console/url";
import { isUuid } from "@/lib/domain";
import { env } from "@/lib/env";
import { todayInZone } from "@/lib/time";
import type { AuditRow } from "@/lib/contracts";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { Flash } from "@/components/Flash";
import { JsonBlock } from "@/components/JsonBlock";
import { LinkButton } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Audit log" };

const PAGE_SIZE = 50;

function Expanded({ row }: { row: AuditRow }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <JsonBlock label="Input" value={row.input} />
      <JsonBlock label="Result" value={row.result} />
      <p className="text-xs text-ink-3 md:col-span-2">
        <span className="font-medium text-ink-2">hash</span> <span className="font-mono break-all">{row.hash}</span>
        <br />
        <span className="font-medium text-ink-2">prev</span> <span className="font-mono break-all">{row.prev_hash}</span>
      </p>
    </div>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [ctx, q] = await Promise.all([loadConsole("/audit"), readQuery(searchParams)]);
  const tz = ctx.household?.timezone ?? env().timezone;
  const today = ctx.today ?? todayInZone(ctx.now, tz);
  const beforeRaw = q.get("before");
  const beforeSeq = beforeRaw && /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : undefined;
  const actionRaw = q.get("action");
  const actionId = actionRaw && isUuid(actionRaw) ? actionRaw : undefined;

  const [rows, chain] = await Promise.all([
    listAuditRows(ctx.db, { limit: PAGE_SIZE, beforeSeq, actionId }),
    verifyAuditChain(ctx.db, { now: ctx.now }),
  ]);
  const oldest = rows[rows.length - 1];
  const olderHref = rows.length === PAGE_SIZE && oldest ? withQuery("/audit", { before: String(oldest.seq), action: actionId }) : null;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change made through Housewarden, in order, each row hashed together with the one before it."
        action={
          <form action={verifyAudit}>
            <SubmitButton variant="secondary" pendingLabel="Verifying…">
              Verify chain
            </SubmitButton>
          </form>
        }
      />
      <Flash message={q.flash} tone={q.tone} />

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-ink-2">
        <Chip tone={chain.intact ? "accent" : "danger"}>{chain.intact ? `Chain intact · ${plural(chain.rows, "row")}` : `Chain broken at #${chain.first_bad_seq ?? "?"}`}</Chip>
        {actionId && (
          <span className="flex items-center gap-2">
            Showing action <span className="font-mono text-xs">{actionId.slice(0, 8)}…</span>
            <Link href="/audit" className="text-accent underline-offset-2 hover:underline">
              Show all
            </Link>
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={actionId ? "No rows for that action" : "Nothing recorded yet"}
          body={actionId ? "The audit log has no rows with that action id." : "Every change made through Housewarden is written here and chained to the one before it."}
        />
      ) : (
        <>
          {/* Phones: one list row per audit row, expandable. */}
          <div className="divide-y divide-border rounded-lg border border-border bg-surface md:hidden">
            {rows.map((row) => (
              <details key={row.seq} className="row-details">
                <summary className="flex flex-col gap-1 px-4 py-3">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-ink-3">#{row.seq}</span>
                    <Chip tone={auditEventTone(row.event)}>{row.event}</Chip>
                  </span>
                  <span className="font-medium text-ink">{toolTitle(row.tool)}</span>
                  <span className="text-sm text-ink-2">
                    {row.actor.label} · {fmtInstant(row.at, tz, today)} · <span className="font-mono text-xs">{fmtHash(row.hash)}</span>
                  </span>
                </summary>
                <div className="border-t border-border px-4 py-3">
                  {row.action_id && (
                    <p className="mb-3 text-xs">
                      <Link href={`/audit?action=${row.action_id}`} className="text-accent underline-offset-2 hover:underline">
                        All rows for this action
                      </Link>
                    </p>
                  )}
                  <Expanded row={row} />
                </div>
              </details>
            ))}
          </div>

          {/* Wider screens: a table; each row can open a details row beneath it. */}
          <div className="relative hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-ink-2">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">#</th>
                  <th scope="col" className="px-3 py-2 font-medium">Time</th>
                  <th scope="col" className="px-3 py-2 font-medium">Actor</th>
                  <th scope="col" className="px-3 py-2 font-medium">Event</th>
                  <th scope="col" className="px-3 py-2 font-medium">Tool</th>
                  <th scope="col" className="px-3 py-2 font-medium">Action</th>
                  <th scope="col" className="px-3 py-2 font-medium">Hash</th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              {rows.map((row) => (
                <tbody key={row.seq} className="audit-group border-t border-border">
                  <tr>
                    <td className="px-3 py-2 font-mono text-xs text-ink-3">{row.seq}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink" title={fmtInstantLong(row.at, tz)}>
                      {fmtInstant(row.at, tz, today)}
                    </td>
                    <td className="px-3 py-2 text-ink">{row.actor.label}</td>
                    <td className="px-3 py-2">
                      <Chip tone={auditEventTone(row.event)}>{row.event}</Chip>
                    </td>
                    <td className="px-3 py-2 text-ink">{toolTitle(row.tool)}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.action_id ? (
                        <Link href={`/audit?action=${row.action_id}`} className="text-accent underline-offset-2 hover:underline" title={row.action_id}>
                          {row.action_id.slice(0, 8)}…
                        </Link>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-2" title={row.hash}>
                      {fmtHash(row.hash)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <details className="row-details audit-toggle">
                        <summary className="inline-flex min-h-8 items-center rounded-md px-2 text-xs text-accent hover:bg-surface-2">
                          <span className="when-closed">Show</span>
                          <span className="when-open">Hide</span>
                        </summary>
                      </details>
                    </td>
                  </tr>
                  <tr className="audit-expand">
                    <td colSpan={8} className="px-3 pb-3">
                      <Expanded row={row} />
                    </td>
                  </tr>
                </tbody>
              ))}
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-ink-3">{beforeSeq ? `Rows before #${beforeSeq}` : "Newest first"}</span>
            <div className="flex gap-2">
              {beforeSeq && (
                <LinkButton href={withQuery("/audit", { action: actionId })} size="sm">
                  Newest
                </LinkButton>
              )}
              {olderHref && (
                <LinkButton href={olderHref} size="sm">
                  Older
                </LinkButton>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
