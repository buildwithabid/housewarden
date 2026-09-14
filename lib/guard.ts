/**
 * The guard — the one write path (docs/SPEC.md §3). Re-exports the pieces
 * under lib/guard/ so callers import from "@/lib/guard".
 */
export { propose, replayOutcome, storedInput, previewsMatch } from "./guard/propose";
export { confirmAction, rejectAction, ConfirmActionInputSchema, RejectActionInputSchema } from "./guard/confirm";
export type { ConfirmActionInput, RejectActionInput } from "./guard/confirm";
export { sweepExpired, sweepExpiredNow } from "./guard/sweep";
export { runTool, toToolOutcomeError } from "./guard/run";
export { registerToolDefinitions, getToolDefinition, listToolDefinitions, clearToolDefinitions } from "./guard/registry";
export { PLANNERS, resolvePlanner, isMutatingTool } from "./guard/planners";
export type { Planner, MutatingToolName } from "./guard/planners";
export { resolvePolicy, listPolicies } from "./domain/policies";
export type { GuardOptions } from "./guard/options";
export { parseInput } from "./guard/input";
export type { ToolOutcome } from "./contracts";
