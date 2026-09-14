/**
 * Expiry sweep (docs/SPEC.md §3.6). No timer: called at the start of
 * propose, confirm and reject, and by pages/tools that list pending actions
 * through sweepExpiredNow. Assumes the audit lock is held (takes it again).
 */
import { SWEEPER_ACTOR, type Queryable } from "@/lib/contracts";
import { appendAudit, lockAuditChain } from "@/lib/audit";
import { getDb, type CoreDb } from "@/lib/db";

interface SweptRow extends Record<string, unknown> {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  expires_at: Date;
}

/** Marks every pending action past its expiry as expired and audits each one. */
export async function sweepExpired(tx: Queryable, now: Date): Promise<{ id: string; tool: string }[]> {
  await lockAuditChain(tx);
  const res = await tx.query<SweptRow>(
    `UPDATE pending_actions SET status = 'expired', decided_at = $1::timestamptz, decided_by = $2::jsonb
     WHERE status = 'pending' AND expires_at <= $1::timestamptz
     RETURNING id, tool, input, expires_at`,
    [now, SWEEPER_ACTOR],
  );
  for (const row of res.rows) {
    await appendAudit(tx, {
      at: now,
      actor: SWEEPER_ACTOR,
      event: "expired",
      tool: row.tool,
      action_id: row.id,
      input: row.input,
      result: { status: "expired", expires_at: row.expires_at.toISOString() },
    });
  }
  return res.rows.map((r) => ({ id: r.id, tool: r.tool }));
}

/** Sweep in its own transaction. Returns how many actions expired. */
export async function sweepExpiredNow(db?: CoreDb, now: Date = new Date()): Promise<number> {
  const handle = db ?? (await getDb());
  const swept = await handle.transaction((tx) => sweepExpired(tx, now));
  return swept.length;
}
