/**
 * runTool(name, rawInput, actor) — the one entry point both surfaces call
 * (docs/SPEC.md §1). Mutating tools go through propose; guard tools through
 * confirmAction/rejectAction; read tools run the registered definition.
 * Thrown HousewardenErrors become ToolErrors; anything else becomes INTERNAL
 * with a generic message (details are logged server-side, never returned).
 */
import { HousewardenError, TOOL_CATALOGUE, type Actor, type ToolName, type ToolOutcome } from "@/lib/contracts";
import { requireHousehold } from "@/lib/domain";
import { ConfirmActionInputSchema, RejectActionInputSchema, confirmAction, rejectAction } from "./confirm";
import { parseInput } from "./input";
import { resolveGuardOptions, toolContext, type GuardOptions } from "./options";
import { propose } from "./propose";
import { getToolDefinition } from "./registry";

const GENERIC_INTERNAL = "Something went wrong on the Housewarden server and nothing was changed. Please try again.";

function ok(output: unknown, spoken: string): ToolOutcome {
  return { ok: true, output, spoken };
}

export function toToolOutcomeError(err: unknown, tool: string): ToolOutcome {
  if (err instanceof HousewardenError) {
    return { ok: false, error: err.toToolError(), spoken: err.message };
  }
  console.error("[housewarden] tool failed", {
    tool,
    name: err instanceof Error ? err.name : typeof err,
    message: err instanceof Error ? err.message : String(err),
  });
  return { ok: false, error: { error: { code: "INTERNAL", message: GENERIC_INTERNAL } }, spoken: GENERIC_INTERNAL };
}

export async function runTool(name: ToolName, rawInput: unknown, actor: Actor, options: GuardOptions = {}): Promise<ToolOutcome> {
  try {
    const entry = TOOL_CATALOGUE.find((t) => t.name === name);
    if (!entry) throw new HousewardenError("VALIDATION", `There is no tool called ${String(name)}.`, { tool: name });
    const registered = getToolDefinition(name);

    if (entry.kind === "mutating") {
      const result = await propose(name, rawInput, actor, options);
      return ok(result, result.spoken);
    }

    if (entry.kind === "guard" && (!registered || registered.kind !== "guard")) {
      if (name === "confirm_action") {
        const input = parseInput(ConfirmActionInputSchema, rawInput, name);
        const result = await confirmAction(input.action_id, actor, options);
        return ok(result, result.spoken);
      }
      const input = parseInput(RejectActionInputSchema, rawInput, name);
      const result = await rejectAction(input.action_id, actor, input.reason ?? null, options);
      return ok(result, result.spoken);
    }

    if (!registered || registered.kind === "mutating") {
      throw new HousewardenError("INTERNAL", `Tool ${name} is not registered; import lib/tools/registry before calling it.`, { tool: name });
    }
    const input = parseInput(registered.inputSchema, rawInput, name);
    const { db, now } = await resolveGuardOptions(options);
    const household = await requireHousehold(db);
    const run = await registered.run(input, toolContext(db, household, actor, now));
    return ok(run.output, run.spoken);
  } catch (err) {
    return toToolOutcomeError(err, name);
  }
}
