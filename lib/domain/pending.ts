import {
  type Actor,
  type PendingAction,
  type PendingStatus,
  type Preview,
  type Queryable,
  type Risk,
} from "@/lib/contracts";
import { iso } from "./shared";

export interface PendingRow extends Record<string, unknown> {
  id: string;
  household_id: string;
  tool: string;
  input: Record<string, unknown>;
  preview: Preview;
  risk: Risk;
  status: PendingStatus;
  created_by: Actor;
  member_id: string | null;
  created_at: Date;
  expires_at: Date;
  decided_by: Actor | null;
  decided_at: Date | null;
  executed_at: Date | null;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  idempotency_key: string | null;
}

export const PENDING_COLUMNS =
  "id, household_id, tool, input, preview, risk, status, created_by, member_id, created_at, expires_at, decided_by, decided_at, executed_at, result, error, idempotency_key";

/** DTO mapping. A stored `pending` row past its expiry reads as `expired` (reads never sweep). */
export function rowToPendingAction(row: PendingRow, now: Date): PendingAction {
  const status: PendingStatus = row.status === "pending" && row.expires_at.getTime() <= now.getTime() ? "expired" : row.status;
  return {
    id: row.id,
    tool: row.tool,
    input: row.input,
    preview: row.preview,
    risk: row.risk,
    status,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
    decided_by: row.decided_by,
    decided_at: iso(row.decided_at),
    executed_at: iso(row.executed_at),
    result: row.result,
    error: row.error,
    idempotency_key: row.idempotency_key,
  };
}

export async function getPendingRow(db: Queryable, id: string): Promise<PendingRow | null> {
  const res = await db.query<PendingRow>(`SELECT ${PENDING_COLUMNS} FROM pending_actions WHERE id = $1::uuid`, [id]);
  return res.rows[0] ?? null;
}

export async function getPendingAction(db: Queryable, id: string, now: Date): Promise<PendingAction | null> {
  const row = await getPendingRow(db, id);
  return row ? rowToPendingAction(row, now) : null;
}

export type PendingFilter = "pending" | "all";

export interface ListPendingOptions {
  status?: PendingFilter;
  limit?: number;
  now: Date;
}

/** Newest first. `pending` returns only live (unexpired) proposals. */
export async function listPendingActions(db: Queryable, householdId: string, options: ListPendingOptions): Promise<PendingAction[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const status = options.status ?? "pending";
  const res =
    status === "pending"
      ? await db.query<PendingRow>(
          `SELECT ${PENDING_COLUMNS} FROM pending_actions WHERE household_id = $1 AND status = 'pending' AND expires_at > $2::timestamptz
           ORDER BY created_at DESC LIMIT $3`,
          [householdId, options.now, limit],
        )
      : await db.query<PendingRow>(
          `SELECT ${PENDING_COLUMNS} FROM pending_actions WHERE household_id = $1 ORDER BY created_at DESC LIMIT $2`,
          [householdId, limit],
        );
  return res.rows.map((r) => rowToPendingAction(r, options.now));
}

/** Decided actions (anything not pending), newest first — the console's history strip. */
export async function listDecidedActions(db: Queryable, householdId: string, now: Date, limit = 20): Promise<PendingAction[]> {
  const res = await db.query<PendingRow>(
    `SELECT ${PENDING_COLUMNS} FROM pending_actions WHERE household_id = $1 AND (status <> 'pending' OR expires_at <= $2::timestamptz)
     ORDER BY coalesce(decided_at, executed_at, created_at) DESC LIMIT $3`,
    [householdId, now, Math.min(Math.max(limit, 1), 100)],
  );
  return res.rows.map((r) => rowToPendingAction(r, now));
}

export async function countPendingActions(db: Queryable, householdId: string, now: Date): Promise<number> {
  const res = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pending_actions WHERE household_id = $1 AND status = 'pending' AND expires_at > $2::timestamptz`,
    [householdId, now],
  );
  return res.rows[0]?.n ?? 0;
}

export async function findByIdempotencyKey(db: Queryable, householdId: string, tool: string, key: string): Promise<PendingRow | null> {
  const res = await db.query<PendingRow>(
    `SELECT ${PENDING_COLUMNS} FROM pending_actions WHERE household_id = $1 AND tool = $2 AND idempotency_key = $3`,
    [householdId, tool, key],
  );
  return res.rows[0] ?? null;
}

export interface NewPendingAction {
  household_id: string;
  tool: string;
  input: Record<string, unknown>;
  preview: Preview;
  risk: Risk;
  status: "pending" | "executed";
  created_by: Actor;
  member_id: string | null;
  created_at: Date;
  expires_at: Date;
  idempotency_key: string | null;
}

export async function insertPendingAction(tx: Queryable, input: NewPendingAction): Promise<PendingRow> {
  const res = await tx.query<PendingRow>(
    `INSERT INTO pending_actions (household_id, tool, input, preview, risk, status, created_by, member_id, created_at, expires_at, idempotency_key)
     VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb, $5, $6, $7::jsonb, $8::uuid, $9::timestamptz, $10::timestamptz, $11)
     RETURNING ${PENDING_COLUMNS}`,
    [
      input.household_id,
      input.tool,
      input.input,
      input.preview,
      input.risk,
      input.status,
      input.created_by,
      input.member_id,
      input.created_at,
      input.expires_at,
      input.idempotency_key,
    ],
  );
  return res.rows[0];
}
