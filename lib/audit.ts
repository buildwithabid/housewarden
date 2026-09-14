/**
 * Hash-chained audit log (docs/SPEC.md §7).
 *
 *   body = { seq, at, actor, event, tool, action_id, input, result, prev_hash }
 *   hash = sha256_hex( prev_hash + canonicalJson(body) )
 *   row 1: prev_hash = GENESIS_HASH (64 zeros); row n: prev_hash = hash of row n-1
 *
 * Appenders serialise on pg_advisory_xact_lock(7743) so seq has no gaps. The
 * guard takes that lock once per transaction; appendAudit takes it again,
 * which is a no-op inside the same transaction, so seeding and scripts can
 * call it directly.
 */
import { createHash } from "node:crypto";
import {
  GENESIS_HASH,
  auditRowBody,
  canonicalJson,
  type Actor,
  type AuditEvent,
  type AuditRow,
  type AuditRowBody,
  type ChainVerification,
  type Queryable,
} from "@/lib/contracts";

export const AUDIT_ADVISORY_LOCK_KEY = 7743;
/** verifyAuditChain stops after this many rows unless told otherwise. */
export const AUDIT_VERIFY_MAX_ROWS = 10_000;
const VERIFY_PAGE_SIZE = 500;

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The hash of a row body: sha256(prev_hash + canonicalJson(body)). */
export function computeAuditHash(body: AuditRowBody): string {
  return sha256Hex(body.prev_hash + canonicalJson(auditRowBody(body)));
}

export async function lockAuditChain(tx: Queryable): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock($1)", [AUDIT_ADVISORY_LOCK_KEY]);
}

export interface AuditEntry {
  at: Date;
  actor: Actor;
  event: AuditEvent;
  tool: string;
  action_id: string | null;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
}

interface AuditDbRow extends Record<string, unknown> {
  seq: number;
  at: Date;
  actor: Actor;
  event: AuditEvent;
  tool: string;
  action_id: string | null;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  prev_hash: string;
  hash: string;
}

const AUDIT_COLUMNS = "seq, at, actor, event, tool, action_id, input, result, prev_hash, hash";

export function rowToAuditRow(row: AuditDbRow): AuditRow {
  return {
    seq: row.seq,
    at: row.at.toISOString(),
    actor: row.actor,
    event: row.event,
    tool: row.tool,
    action_id: row.action_id,
    input: row.input,
    result: row.result,
    prev_hash: row.prev_hash,
    hash: row.hash,
  };
}

/** Head of the chain: last seq/hash and the row count. Empty log → seq 0, GENESIS_HASH. */
export async function getAuditHead(db: Queryable): Promise<{ seq: number; hash: string; rows: number }> {
  const head = await db.query<{ seq: number; hash: string }>("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1");
  const count = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log");
  const last = head.rows[0];
  return { seq: last?.seq ?? 0, hash: last?.hash ?? GENESIS_HASH, rows: count.rows[0]?.n ?? 0 };
}

/**
 * Appends one row inside the caller's transaction. Reads the chain head under
 * the advisory lock, computes seq/prev_hash/hash and inserts.
 */
export async function appendAudit(tx: Queryable, entry: AuditEntry): Promise<AuditRow> {
  await lockAuditChain(tx);
  const head = await tx.query<{ seq: number; hash: string }>("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1");
  const last = head.rows[0];
  const body: AuditRowBody = {
    seq: (last?.seq ?? 0) + 1,
    at: entry.at.toISOString(),
    actor: entry.actor,
    event: entry.event,
    tool: entry.tool,
    action_id: entry.action_id,
    input: entry.input,
    result: entry.result,
    prev_hash: last?.hash ?? GENESIS_HASH,
  };
  const hash = computeAuditHash(body);
  const inserted = await tx.query<AuditDbRow>(
    `INSERT INTO audit_log (seq, at, actor, event, tool, action_id, input, result, prev_hash, hash)
     VALUES ($1, $2::timestamptz, $3::jsonb, $4, $5, $6::uuid, $7::jsonb, $8::jsonb, $9, $10)
     RETURNING ${AUDIT_COLUMNS}`,
    [body.seq, body.at, body.actor, body.event, body.tool, body.action_id, body.input, body.result, body.prev_hash, hash],
  );
  return rowToAuditRow(inserted.rows[0]);
}

export interface AuditQuery {
  /** Max rows (1–200). */
  limit?: number;
  /** Only rows with seq < before_seq. */
  beforeSeq?: number;
  /** Only rows for this pending action. */
  actionId?: string;
}

/** Rows newest first, for the console table and get_audit_log. */
export async function listAuditRows(db: Queryable, query: AuditQuery = {}): Promise<AuditRow[]> {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 200);
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.beforeSeq !== undefined) {
    params.push(query.beforeSeq);
    clauses.push(`seq < $${params.length}`);
  }
  if (query.actionId !== undefined) {
    params.push(query.actionId);
    clauses.push(`action_id = $${params.length}::uuid`);
  }
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const res = await db.query<AuditDbRow>(
    `SELECT ${AUDIT_COLUMNS} FROM audit_log ${where} ORDER BY seq DESC LIMIT $${params.length}`,
    params,
  );
  return res.rows.map(rowToAuditRow);
}

export interface VerifyOptions {
  /** Stop after this many rows (default AUDIT_VERIFY_MAX_ROWS). */
  maxRows?: number;
  now?: Date;
}

/**
 * Recomputes every hash from row 1 in seq order (docs/SPEC.md §7.3). Checks,
 * per row: seq === previous + 1 (seq_gap), prev_hash === previous.hash
 * (prev_hash_mismatch), hash === sha256(prev_hash + canonicalJson(body))
 * (hash_mismatch). Reads in pages so memory stays flat.
 */
export async function verifyAuditChain(db: Queryable, options: VerifyOptions = {}): Promise<ChainVerification> {
  const maxRows = options.maxRows ?? AUDIT_VERIFY_MAX_ROWS;
  const checkedAt = (options.now ?? new Date()).toISOString();
  let prevSeq = 0;
  let prevHash = GENESIS_HASH;
  let rows = 0;

  const fail = (row: AuditDbRow, reason: ChainVerification["reason"]): ChainVerification => ({
    intact: false,
    rows,
    last_seq: prevSeq,
    last_hash: prevHash,
    checked_at: checkedAt,
    first_bad_seq: row.seq,
    reason,
  });

  while (rows < maxRows) {
    const page = await db.query<AuditDbRow>(
      `SELECT ${AUDIT_COLUMNS} FROM audit_log WHERE seq > $1 ORDER BY seq ASC LIMIT $2`,
      [prevSeq, Math.min(VERIFY_PAGE_SIZE, maxRows - rows)],
    );
    if (page.rows.length === 0) break;
    for (const row of page.rows) {
      if (row.seq !== prevSeq + 1) return fail(row, "seq_gap");
      if (row.prev_hash !== prevHash) return fail(row, "prev_hash_mismatch");
      const expected = computeAuditHash({ ...rowToAuditRow(row) });
      if (row.hash !== expected) return fail(row, "hash_mismatch");
      prevSeq = row.seq;
      prevHash = row.hash;
      rows += 1;
    }
  }

  return {
    intact: true,
    rows,
    last_seq: prevSeq,
    last_hash: prevHash,
    checked_at: checkedAt,
    first_bad_seq: null,
    reason: null,
  };
}
