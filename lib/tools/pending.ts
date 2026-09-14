/**
 * list_pending_actions — sweeps expired proposals first (docs/SPEC.md §3.6),
 * then lists what is waiting for a person.
 */
import { z } from "zod";
import { PendingActionSchema, defineReadTool, type PendingAction } from "@/lib/contracts";
import { countPendingActions, joinSpoken, listPendingActions, lowerFirst, type PendingFilter } from "@/lib/domain";
import { sweepExpiredNow } from "@/lib/guard";
import { numberWord } from "@/lib/time";
import { READ_ANNOTATIONS, catalogueTitle, coreDbOf } from "./context";
import { countOf, isAre, sentence, spokenTimeLeft, truncateList } from "./spoken";

const PENDING_FILTERS = ["pending", "all"] as const satisfies readonly PendingFilter[];

export function spokenPending(actions: readonly PendingAction[], pendingCount: number, filter: PendingFilter, now: Date): string {
  const waiting = actions.filter((a) => a.status === "pending");
  if (filter === "all") {
    return `${sentence(`${countOf(actions.length, "action")} on record`)} ${sentence(`${countOf(pendingCount, "action")} ${isAre(pendingCount)} waiting for approval`)}`;
  }
  if (waiting.length === 0) return "Nothing is waiting for approval.";
  if (waiting.length === 1) {
    const a = waiting[0];
    return `One action is waiting: ${lowerFirst(a.preview.summary)}. It expires in ${spokenTimeLeft(a.expires_at, now)}.`;
  }
  const list = truncateList(
    waiting.map((a) => lowerFirst(a.preview.summary)),
    3,
  );
  return `${numberWord(waiting.length)} actions are waiting: ${joinSpoken(list)}.`;
}

export const listPendingActionsTool = defineReadTool({
  kind: "read",
  name: "list_pending_actions",
  title: catalogueTitle("list_pending_actions"),
  description: "Lists actions waiting for approval, with what each would change and when it expires. Optionally needs a status filter.",
  inputSchema: z.object({
    status: z.enum(PENDING_FILTERS).default("pending").describe("pending (waiting now) or all (including decided ones)."),
    limit: z.number().int().min(1).max(100).default(20).describe("How many to return, newest first."),
  }),
  outputSchema: z.object({ actions: z.array(PendingActionSchema), pending_count: z.number().int() }),
  annotations: READ_ANNOTATIONS,
  async run(input, ctx) {
    const db = await coreDbOf(ctx);
    await sweepExpiredNow(db, ctx.now);
    const actions = await listPendingActions(db, ctx.household.id, { status: input.status, limit: input.limit, now: ctx.now });
    const pending_count = await countPendingActions(db, ctx.household.id, ctx.now);
    return { output: { actions, pending_count }, spoken: spokenPending(actions, pending_count, input.status, ctx.now) };
  },
});
