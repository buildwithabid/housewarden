/**
 * get_audit_log, verify_audit_chain.
 */
import { z } from "zod";
import { AuditRowSchema, ChainVerificationSchema, Sha256HexSchema, TOOL_CATALOGUE, defineReadTool, type AuditRow, type ChainVerification } from "@/lib/contracts";
import { getAuditHead, listAuditRows, verifyAuditChain } from "@/lib/audit";
import { numberWord } from "@/lib/time";
import { READ_ANNOTATIONS, catalogueTitle } from "./context";
import { countOf, sentence, spokenActor } from "./spoken";

function toolTitle(tool: string): string {
  return TOOL_CATALOGUE.find((t) => t.name === tool)?.title.toLowerCase() ?? tool;
}

export function spokenAuditRows(rows: readonly AuditRow[], totalRows: number, forAction: boolean): string {
  if (forAction) {
    if (rows.length === 0) return "There are no audit entries for that action.";
    const chronological = [...rows].sort((a, b) => a.seq - b.seq);
    const steps = chronological.map((r, i) => `${i > 0 ? "then " : ""}${r.event} ${spokenActor(r.actor)}`);
    return sentence(`${countOf(rows.length, "entry", "entries")} for that action: ${steps.join(", ")}`);
  }
  if (totalRows === 0) return "The audit log is empty.";
  const latest = rows[0];
  const head = sentence(`The audit log has ${countOf(totalRows, "entry", "entries")}`);
  if (!latest) return head;
  return `${head} ${sentence(`The latest is ${latest.event} of ${toolTitle(latest.tool)} ${spokenActor(latest.actor)}`)}`;
}

const REASONS: Record<NonNullable<ChainVerification["reason"]>, string> = {
  hash_mismatch: "its hash does not match its contents",
  prev_hash_mismatch: "it does not link to the entry before it",
  seq_gap: "an entry is missing before it",
};

export function spokenVerification(v: ChainVerification): string {
  if (v.intact) {
    return v.rows === 0 ? "Yes. The audit log is empty, so there is nothing to break." : `Yes. ${sentence(`${countOf(v.rows, "entry", "entries")}, chain intact`)}`;
  }
  const reason = v.reason ? REASONS[v.reason] : "it could not be verified";
  return `No. The chain is broken at entry ${numberWord(v.first_bad_seq ?? 0)}: ${reason}.`;
}

export const getAuditLogTool = defineReadTool({
  kind: "read",
  name: "get_audit_log",
  title: catalogueTitle("get_audit_log"),
  description: "Reads the tamper-evident audit log, newest first. Optionally needs a limit, a starting point, or an action id.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(200).default(20).describe("How many rows, newest first."),
    before_seq: z.number().int().positive().optional().describe("Only rows with seq below this (pagination)."),
    action_id: z.uuid().optional().describe("Only rows for this pending action."),
  }),
  outputSchema: z.object({
    rows: z.array(AuditRowSchema),
    total_rows: z.number().int(),
    chain_head: z.object({ seq: z.number().int(), hash: Sha256HexSchema }),
  }),
  annotations: READ_ANNOTATIONS,
  async run(input, ctx) {
    const [rows, head] = await Promise.all([
      listAuditRows(ctx.db, { limit: input.limit, beforeSeq: input.before_seq, actionId: input.action_id }),
      getAuditHead(ctx.db),
    ]);
    return {
      output: { rows, total_rows: head.rows, chain_head: { seq: head.seq, hash: head.hash } },
      spoken: spokenAuditRows(rows, head.rows, input.action_id !== undefined),
    };
  },
});

export const verifyAuditChainTool = defineReadTool({
  kind: "read",
  name: "verify_audit_chain",
  title: catalogueTitle("verify_audit_chain"),
  description: "Recomputes every hash in the audit log and reports whether the chain is intact. Needs nothing.",
  inputSchema: z.object({}),
  outputSchema: ChainVerificationSchema,
  annotations: READ_ANNOTATIONS,
  async run(_input, ctx) {
    const verification = await verifyAuditChain(ctx.db, { now: ctx.now });
    return { output: verification, spoken: spokenVerification(verification) };
  },
});
