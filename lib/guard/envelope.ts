import {
  HOW_TO_CONFIRM,
  HOW_TO_CONFIRM_CONSOLE_ONLY,
  type GuardDryRun,
  type GuardExecuted,
  type GuardNeedsConfirmation,
  type Preview,
  type RejectedResult,
  type Risk,
} from "@/lib/contracts";
import type { PendingRow } from "@/lib/domain/pending";

export function executedEnvelope(
  row: Pick<PendingRow, "tool" | "id" | "risk" | "preview">,
  result: unknown,
  executedAt: Date,
  spoken: string,
  replay: boolean,
): GuardExecuted<unknown> {
  return {
    status: "executed",
    tool: row.tool,
    action_id: row.id,
    risk: row.risk,
    preview: row.preview,
    result,
    executed_at: executedAt.toISOString(),
    idempotent_replay: replay,
    spoken,
  };
}

export function needsConfirmationEnvelope(
  row: Pick<PendingRow, "tool" | "id" | "risk" | "preview" | "expires_at">,
  spoken: string,
): GuardNeedsConfirmation {
  return {
    status: "needs_confirmation",
    tool: row.tool,
    action_id: row.id,
    risk: row.risk,
    preview: row.preview,
    expires_at: row.expires_at.toISOString(),
    how_to_confirm: row.risk === "high" ? HOW_TO_CONFIRM_CONSOLE_ONLY : HOW_TO_CONFIRM,
    spoken,
  };
}

export function dryRunEnvelope(tool: string, risk: Risk, preview: Preview, wouldRequire: boolean, spoken: string): GuardDryRun {
  return { status: "dry_run", tool, risk, preview, would_require_confirmation: wouldRequire, spoken };
}

export function rejectedEnvelope(
  row: Pick<PendingRow, "tool" | "id" | "preview">,
  reason: string | null,
  rejectedAt: Date,
  spoken: string,
  replay: boolean,
): RejectedResult {
  return {
    status: "rejected",
    tool: row.tool,
    action_id: row.id,
    preview: row.preview,
    reason,
    rejected_at: rejectedAt.toISOString(),
    idempotent_replay: replay,
    spoken,
  };
}
