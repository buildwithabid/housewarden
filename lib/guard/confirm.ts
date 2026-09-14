/**
 * confirm_action / reject_action — docs/SPEC.md §3.3–3.4. Exactly-once: the
 * claim UPDATE (WHERE status = 'pending') runs under the audit advisory lock,
 * so a second confirmer waits, then finds the row executed and replays it.
 */
import { z } from "zod";
import { HousewardenError, type Actor, type GuardExecuted, type RejectedResult, type Risk } from "@/lib/contracts";
import { appendAudit, lockAuditChain } from "@/lib/audit";
import { requireHousehold } from "@/lib/domain";
import { PENDING_COLUMNS, getPendingRow, type PendingRow } from "@/lib/domain/pending";
import type { TxQueryable } from "@/lib/db";
import { executedEnvelope, rejectedEnvelope } from "./envelope";
import { parseInput } from "./input";
import { resolveGuardOptions, toolContext, type GuardOptions } from "./options";
import { isMutatingTool, resolvePlanner } from "./planners";
import { previewsMatch } from "./propose";
import { spokenRejected, spokenReplayExecuted, spokenReplayRejected } from "./spoken";
import { sweepExpired } from "./sweep";

export const ConfirmActionInputSchema = z.object({
  action_id: z.uuid().describe("The action_id from a needs_confirmation reply."),
});
export type ConfirmActionInput = z.output<typeof ConfirmActionInputSchema>;

export const RejectActionInputSchema = z.object({
  action_id: z.uuid().describe("The action_id from a needs_confirmation reply."),
  reason: z.string().trim().max(200).optional().describe("Why, in the user's words (optional)."),
});
export type RejectActionInput = z.output<typeof RejectActionInputSchema>;

/** Marks an execute() throw so the outer handler can record the failure in a fresh transaction. */
class ExecutionFailure extends Error {
  constructor(readonly cause: unknown) {
    super("execution failed");
    this.name = "ExecutionFailure";
  }
}

type ConfirmOutcome = { kind: "ok"; envelope: GuardExecuted<unknown> } | { kind: "failed"; error: HousewardenError };

function notPendingError(row: PendingRow, now: Date): HousewardenError {
  const expired = row.status === "expired" || (row.status === "pending" && row.expires_at.getTime() <= now.getTime());
  if (expired) {
    return new HousewardenError(
      "ACTION_EXPIRED",
      `That request expired at ${row.expires_at.toISOString().slice(11, 16)} UTC. Ask again and I'll prepare a fresh preview.`,
      { action_id: row.id, expires_at: row.expires_at.toISOString() },
    );
  }
  return new HousewardenError("ACTION_NOT_PENDING", `That request is already ${row.status}; there is nothing to approve.`, {
    action_id: row.id,
    status: row.status,
    ...(row.error ? { error: row.error } : {}),
  });
}

async function markFailed(tx: TxQueryable, row: PendingRow, actor: Actor, now: Date, error: HousewardenError, claimed: boolean): Promise<void> {
  const errorJson = { code: error.code, message: error.message };
  await tx.query(
    `UPDATE pending_actions SET status = 'failed', decided_by = $2::jsonb, decided_at = $3::timestamptz, error = $4::jsonb
     WHERE id = $1::uuid AND status = $5`,
    [row.id, actor, now, errorJson, claimed ? "confirmed" : "pending"],
  );
  await appendAudit(tx, {
    at: now,
    actor,
    event: "failed",
    tool: row.tool,
    action_id: row.id,
    input: row.input,
    result: { status: "failed", error: { ...errorJson, ...(error.details ? { details: error.details } : {}) } },
  });
}

export async function confirmAction(actionId: string, actor: Actor, options: GuardOptions = {}): Promise<GuardExecuted<unknown>> {
  const { db, now } = await resolveGuardOptions(options);

  // Sweep first, in its own transaction: an error thrown below (expired,
  // not found, console-only) rolls the main transaction back, not the sweep.
  await db.transaction((tx) => sweepExpired(tx, now));

  let outcome: ConfirmOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<ConfirmOutcome> => {
      await lockAuditChain(tx);

      const claim = await tx.query<PendingRow>(
        `UPDATE pending_actions SET status = 'confirmed', decided_by = $2::jsonb, decided_at = $3::timestamptz
         WHERE id = $1::uuid AND status = 'pending' AND expires_at > $3::timestamptz
         RETURNING ${PENDING_COLUMNS}`,
        [actionId, actor, now],
      );
      const row = claim.rows[0];
      if (!row) {
        const existing = await getPendingRow(tx, actionId);
        if (!existing) {
          throw new HousewardenError("NOT_FOUND", "I couldn't find a request with that id. It may have been made up or already cleaned up.", {
            entity: "pending_action",
            ref: actionId,
          });
        }
        if (existing.status === "executed") {
          return {
            kind: "ok",
            envelope: executedEnvelope(existing, existing.result, existing.executed_at ?? now, spokenReplayExecuted(existing.preview.summary), true),
          };
        }
        throw notPendingError(existing, now);
      }

      if (row.risk === "high" && actor.kind !== "console") {
        // Throwing rolls the claim back to 'pending' with no audit row.
        throw new HousewardenError("HIGH_RISK_CONSOLE_ONLY", "This one is high risk: a person has to approve it in the Housewarden console.", {
          action_id: row.id,
          risk: row.risk as Risk,
        });
      }

      const household = await requireHousehold(tx);
      if (!isMutatingTool(row.tool)) {
        throw new HousewardenError("INTERNAL", `Pending action ${row.id} refers to unknown tool ${row.tool}.`);
      }
      const planner = resolvePlanner(row.tool);
      const ctx = toolContext(tx, household, { ...actor, member_id: row.member_id }, now);

      let plan;
      try {
        plan = await planner.plan(parseInput(planner.inputSchema, row.input, row.tool), ctx);
      } catch (err) {
        const error =
          err instanceof HousewardenError
            ? err
            : new HousewardenError("INTERNAL", "The request could not be re-checked against the current state.");
        await markFailed(tx, row, actor, now, error, true);
        return { kind: "failed", error };
      }

      if (!previewsMatch(plan.preview, row.preview)) {
        const error = new HousewardenError(
          "STALE_PREVIEW",
          "Things changed since that was proposed, so I didn't go ahead. Ask again and I'll show you a fresh preview.",
          { action_id: row.id, new_preview: plan.preview },
        );
        await markFailed(tx, row, actor, now, error, true);
        return { kind: "failed", error };
      }

      let run;
      try {
        run = await plan.execute(tx, ctx);
      } catch (err) {
        throw new ExecutionFailure(err);
      }

      await tx.query(`UPDATE pending_actions SET status = 'executed', executed_at = $2::timestamptz, result = $3::jsonb WHERE id = $1::uuid`, [
        row.id,
        now,
        run.output,
      ]);
      await appendAudit(tx, {
        at: now,
        actor,
        event: "executed",
        tool: row.tool,
        action_id: row.id,
        input: row.input,
        result: { status: "executed", risk: row.risk, preview: row.preview, result: run.output as Record<string, unknown> },
      });
      return { kind: "ok", envelope: executedEnvelope(row, run.output, now, `Done. ${run.spoken}`, false) };
    });
  } catch (err) {
    if (!(err instanceof ExecutionFailure)) throw err;
    // The domain changes rolled back with the claim; record the failure on its own.
    const cause = err.cause;
    const error =
      cause instanceof HousewardenError
        ? cause
        : new HousewardenError("INTERNAL", "The action could not be completed; nothing was changed.");
    if (!(cause instanceof HousewardenError)) {
      console.error("[housewarden] execute failed", { action_id: actionId, name: cause instanceof Error ? cause.name : typeof cause, message: cause instanceof Error ? cause.message : String(cause) });
    }
    await db.transaction(async (tx) => {
      await lockAuditChain(tx);
      const row = await getPendingRow(tx, actionId);
      if (row && row.status === "pending") await markFailed(tx, row, actor, now, error, false);
    });
    throw error;
  }

  if (outcome.kind === "failed") throw outcome.error;
  return outcome.envelope;
}

export async function rejectAction(
  actionId: string,
  actor: Actor,
  reason: string | null = null,
  options: GuardOptions = {},
): Promise<RejectedResult> {
  const { db, now } = await resolveGuardOptions(options);
  const cleanReason = reason && reason.trim().length ? reason.trim() : null;
  await db.transaction((tx) => sweepExpired(tx, now));
  return db.transaction(async (tx) => {
    await lockAuditChain(tx);
    const claim = await tx.query<PendingRow>(
      `UPDATE pending_actions SET status = 'rejected', decided_by = $2::jsonb, decided_at = $3::timestamptz, result = $4::jsonb
       WHERE id = $1::uuid AND status = 'pending' AND expires_at > $3::timestamptz
       RETURNING ${PENDING_COLUMNS}`,
      [actionId, actor, now, { reason: cleanReason }],
    );
    const row = claim.rows[0];
    if (!row) {
      const existing = await getPendingRow(tx, actionId);
      if (!existing) {
        throw new HousewardenError("NOT_FOUND", "I couldn't find a request with that id.", { entity: "pending_action", ref: actionId });
      }
      if (existing.status === "rejected") {
        const storedReason = typeof existing.result?.reason === "string" ? existing.result.reason : null;
        return rejectedEnvelope(existing, storedReason, existing.decided_at ?? now, spokenReplayRejected(existing.preview.summary), true);
      }
      const status = existing.status === "pending" ? "expired" : existing.status;
      throw new HousewardenError("ACTION_NOT_PENDING", `That request is already ${status}; there is nothing to decline.`, {
        action_id: existing.id,
        status,
      });
    }
    await appendAudit(tx, {
      at: now,
      actor,
      event: "rejected",
      tool: row.tool,
      action_id: row.id,
      input: row.input,
      result: { status: "rejected", reason: cleanReason },
    });
    return rejectedEnvelope(row, cleanReason, now, spokenRejected(row.preview.summary), false);
  });
}
