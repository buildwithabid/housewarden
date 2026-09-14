/**
 * confirm_action, reject_action — the human half of the guard, exposed as
 * tools so a voice host can relay the user's yes or no. Both run through
 * lib/guard; the MCP actor is whoever runTool was called with.
 */
import { z } from "zod";
import { RejectedResultSchema, defineGuardTool, guardResultSchema } from "@/lib/contracts";
import { ConfirmActionInputSchema, RejectActionInputSchema, confirmAction, rejectAction } from "@/lib/guard";
import { catalogueTitle, coreDbOf, mutatingAnnotations } from "./context";

/** confirm_action returns the executed envelope of whichever tool was queued; its result is that tool's result. */
export const ConfirmActionOutputSchema = guardResultSchema(z.record(z.string(), z.unknown()));

/** Every planner returns an object; anything else (never, by construction) is wrapped so the envelope stays valid. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };
}

export const confirmActionTool = defineGuardTool({
  kind: "guard",
  name: "confirm_action",
  title: catalogueTitle("confirm_action"),
  description: "Approves a waiting action so it runs exactly once. Needs the action id from a needs_confirmation reply.",
  inputSchema: ConfirmActionInputSchema,
  outputSchema: ConfirmActionOutputSchema,
  annotations: mutatingAnnotations({ idempotent: true }),
  async run(input, ctx) {
    const db = await coreDbOf(ctx);
    const result = await confirmAction(input.action_id, ctx.actor, { db, now: ctx.now });
    return { output: { ...result, result: asRecord(result.result) }, spoken: result.spoken };
  },
});

export const rejectActionTool = defineGuardTool({
  kind: "guard",
  name: "reject_action",
  title: catalogueTitle("reject_action"),
  description: "Declines a waiting action so it never runs. Needs the action id; a reason is optional.",
  inputSchema: RejectActionInputSchema,
  outputSchema: RejectedResultSchema,
  annotations: mutatingAnnotations({ destructive: true, idempotent: true }),
  async run(input, ctx) {
    const db = await coreDbOf(ctx);
    const result = await rejectAction(input.action_id, ctx.actor, input.reason ?? null, { db, now: ctx.now });
    return { output: result, spoken: result.spoken };
  },
});
