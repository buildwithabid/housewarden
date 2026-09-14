import type { PendingAction } from "@/lib/contracts";
import { approveAction, rejectPending } from "@/app/actions/guard";
import { fmtAgo, fmtInstant, pendingStatusTone, riskLabel, riskTone, toolTitle } from "@/lib/console/format";
import { Chip } from "./Chip";
import { Countdown } from "./Countdown";
import { DiffLine } from "./DiffLine";
import { SubmitButton } from "./SubmitButton";

const HEADER_LABEL: Record<PendingAction["status"], string> = {
  pending: "Needs your approval",
  confirmed: "Being approved",
  executed: "Approved and done",
  rejected: "Rejected",
  expired: "Expired",
  failed: "Failed",
};

/**
 * The human half of the guard (docs/DESIGN.md §4.3). Pending actions get
 * Approve / Reject; decided ones render the same card with the outcome chip.
 */
export function ConfirmationCard({
  action,
  memberName,
  timeZone,
  today,
  nowIso,
  returnTo,
}: {
  action: PendingAction;
  memberName: string | null;
  timeZone: string;
  today: string;
  nowIso: string;
  returnTo: string;
}) {
  const now = new Date(nowIso);
  const pending = action.status === "pending";
  const high = action.risk === "high";
  const band = !pending ? "bg-surface-2" : high ? "bg-danger-soft" : "bg-warn-soft";
  const bandText = !pending ? "text-ink-2" : high ? "text-danger" : "text-warn";
  const label = pending && high ? "Needs a person’s approval" : HEADER_LABEL[action.status];
  const askedBy = `${action.created_by.label}${memberName ? ` · for ${memberName}` : ""} · ${fmtAgo(action.created_at, now, timeZone, today)}`;
  const decided = action.decided_at ? fmtInstant(action.decided_at, timeZone, today) : null;
  const decidedBy = action.decided_by?.label ?? null;

  return (
    <article className="confirmation-card overflow-hidden rounded-xl border border-border bg-surface" aria-labelledby={`card-${action.id}`}>
      <header className={`px-4 py-3 md:px-6 ${band}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-medium uppercase ${bandText}`}>{label}</span>
            <Chip tone={riskTone(action.risk)}>{riskLabel(action.risk)}</Chip>
            {!pending && <Chip tone={pendingStatusTone(action.status)}>{action.status}</Chip>}
          </div>
          <span className={bandText}>
            {pending ? (
              <Countdown expiresAt={action.expires_at} fallback={`Expires ${fmtInstant(action.expires_at, timeZone, today)}`} />
            ) : (
              decided && <span className="text-sm">{decidedBy ? `${decidedBy} · ${decided}` : decided}</span>
            )}
          </span>
        </div>
        <h3 id={`card-${action.id}`} className="mt-2 text-lg font-medium text-ink">
          {action.preview.summary}
        </h3>
      </header>

      <div className="px-4 py-4 md:px-6 md:py-5">
        <p className="text-sm text-ink-2">
          <span className="text-ink-3">{toolTitle(action.tool)}</span> · Asked by {askedBy}
        </p>

        {action.preview.changes.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium uppercase text-ink-2">Changes</p>
            <ul className="mt-1 divide-y divide-border">
              {action.preview.changes.map((change, i) => (
                <DiffLine key={`${change.entity}-${change.id ?? "new"}-${i}`} change={change} timeZone={timeZone} />
              ))}
            </ul>
          </div>
        )}

        {action.preview.warnings.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1">
            {action.preview.warnings.map((w) => (
              <li key={w} className="text-sm text-warn">
                <span aria-hidden="true">⚠ </span>
                {w}
              </li>
            ))}
          </ul>
        )}

        {action.status === "failed" && action.error && (
          <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{action.error.message}</p>
        )}
        {action.status === "rejected" && typeof action.result?.reason === "string" && action.result.reason && (
          <p className="mt-4 text-sm text-ink-2">Reason: {action.result.reason}</p>
        )}
        {action.status === "executed" && action.executed_at && (
          <p className="mt-4 text-sm text-accent">Done · {fmtInstant(action.executed_at, timeZone, today)}</p>
        )}

        {pending && (
          <div className="card-actions mt-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-end">
            <form action={rejectPending} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <input type="hidden" name="action_id" value={action.id} />
              <input type="hidden" name="return_to" value={returnTo} />
              <label className="flex flex-col gap-1 text-xs text-ink-2">
                Reason (optional)
                <input name="reason" className="input min-h-11 text-sm sm:w-56" maxLength={200} placeholder="Not tonight" />
              </label>
              <SubmitButton variant="secondary" pendingLabel="Rejecting…">
                Reject
              </SubmitButton>
            </form>
            <form action={approveAction}>
              <input type="hidden" name="action_id" value={action.id} />
              <input type="hidden" name="return_to" value={returnTo} />
              <SubmitButton variant="primary" pendingLabel="Approving…" className="w-full sm:w-auto">
                Approve
              </SubmitButton>
            </form>
          </div>
        )}
        {pending && high && <p className="mt-3 text-xs text-ink-3">Only this console can approve a high-risk action; the assistant cannot confirm it on its own.</p>}
      </div>
    </article>
  );
}
