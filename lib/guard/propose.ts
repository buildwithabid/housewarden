/**
 * propose(tool, input, actor) — docs/SPEC.md §3.2. The single entry for every
 * mutating tool: validate → resolve member → idempotency → sweep → plan →
 * policy → dry_run | execute now | queue. Everything inside one transaction
 * under the audit lock.
 */
import {
  HousewardenError,
  canonicalJson,
  riskRequiresConfirmation,
  type Actor,
  type GuardResult,
  type MutatingInputBase,
} from "@/lib/contracts";
import { appendAudit, lockAuditChain } from "@/lib/audit";
import { findMember, requireHousehold, resolvePolicy } from "@/lib/domain";
import { findByIdempotencyKey, insertPendingAction, type PendingRow } from "@/lib/domain/pending";
import { dryRunEnvelope, executedEnvelope, needsConfirmationEnvelope } from "./envelope";
import { parseInput } from "./input";
import { resolveGuardOptions, toolContext, type GuardOptions } from "./options";
import { isMutatingTool, resolvePlanner, type MutatingToolName } from "./planners";
import { spokenDryRun, spokenNeedsConfirmation, spokenReplayExecuted, spokenReplayPending } from "./spoken";
import { sweepExpired } from "./sweep";

/** The input as stored and audited: the tool's own fields plus `member`; never dry_run or the key. */
export function storedInput(input: MutatingInputBase): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...input };
  delete copy.dry_run;
  delete copy.idempotency_key;
  if (copy.member === undefined) delete copy.member;
  return copy;
}

/** The outcome an existing row stands for (idempotency replay, docs/SPEC.md §5). */
export function replayOutcome(row: PendingRow, now: Date): GuardResult {
  const expired = row.status === "expired" || (row.status === "pending" && row.expires_at.getTime() <= now.getTime());
  if (row.status === "executed") {
    return executedEnvelope(row, row.result, row.executed_at ?? row.created_at, spokenReplayExecuted(row.preview.summary), true);
  }
  if (row.status === "pending" && !expired) {
    return needsConfirmationEnvelope(row, spokenReplayPending(row.preview.summary, row.expires_at, now));
  }
  const status = expired ? "expired" : row.status;
  throw new HousewardenError(
    "ACTION_NOT_PENDING",
    `That request was already ${status}. Ask again and I'll prepare a fresh preview.`,
    { action_id: row.id, status, ...(row.error ? { error: row.error } : {}) },
  );
}

export async function propose(tool: string, rawInput: unknown, actor: Actor, options: GuardOptions = {}): Promise<GuardResult> {
  if (!isMutatingTool(tool)) {
    throw new HousewardenError("VALIDATION", `${tool} is not a tool that changes anything, so it cannot be proposed.`, { tool });
  }
  const name: MutatingToolName = tool;
  const { db, now, ttlSeconds } = await resolveGuardOptions(options);
  const planner = resolvePlanner(name);
  const input = parseInput(planner.inputSchema, rawInput, name);

  // The sweep commits on its own so a proposal that fails validation or
  // planning (and therefore rolls back) still leaves expired actions marked.
  if (!input.dry_run) await db.transaction((tx) => sweepExpired(tx, now));

  return db.transaction(async (tx) => {
    await lockAuditChain(tx);
    const household = await requireHousehold(tx);
    const member = input.member ? await findMember(tx, household.id, input.member) : null;
    const memberId = member?.id ?? null;
    const actorHere: Actor = memberId ? { ...actor, member_id: memberId } : actor;

    if (input.idempotency_key) {
      const existing = await findByIdempotencyKey(tx, household.id, name, input.idempotency_key);
      if (existing) return replayOutcome(existing, now);
    }

    const ctx = toolContext(tx, household, actorHere, now);
    const plan = await planner.plan(input, ctx);
    const policy = await resolvePolicy(tx, household.id, name, plan.policyScope, memberId);
    const risk = policy.risk;
    const needsConfirmation = riskRequiresConfirmation(risk);

    if (input.dry_run) {
      return dryRunEnvelope(name, risk, plan.preview, needsConfirmation, spokenDryRun(plan.spoken, risk));
    }

    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const row = await insertPendingAction(tx, {
      household_id: household.id,
      tool: name,
      input: storedInput(input),
      preview: plan.preview,
      risk,
      status: needsConfirmation ? "pending" : "executed",
      created_by: actorHere,
      member_id: memberId,
      created_at: now,
      expires_at: expiresAt,
      idempotency_key: input.idempotency_key ?? null,
    });

    if (needsConfirmation) {
      await appendAudit(tx, {
        at: now,
        actor: actorHere,
        event: "proposed",
        tool: name,
        action_id: row.id,
        input: row.input,
        result: { status: "needs_confirmation", risk, preview: plan.preview },
      });
      return needsConfirmationEnvelope(row, spokenNeedsConfirmation(plan.spoken, risk, ttlSeconds));
    }

    const run = await plan.execute(tx, ctx);
    await tx.query(`UPDATE pending_actions SET executed_at = $2::timestamptz, result = $3::jsonb WHERE id = $1::uuid`, [
      row.id,
      now,
      run.output,
    ]);
    await appendAudit(tx, {
      at: now,
      actor: actorHere,
      event: "executed",
      tool: name,
      action_id: row.id,
      input: row.input,
      result: { status: "executed", risk, preview: plan.preview, result: run.output as Record<string, unknown> },
    });
    return executedEnvelope(row, run.output, now, run.spoken, false);
  });
}

/** True when two previews describe the same concrete changes (used at confirm time). */
export function previewsMatch(a: { changes: unknown }, b: { changes: unknown }): boolean {
  return canonicalJson(a.changes) === canonicalJson(b.changes);
}
