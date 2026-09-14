/**
 * The plan builders behind every mutating tool, keyed by tool name. The guard
 * validates input with `inputSchema`, calls `plan` (pure: reads, builds the
 * preview and an execute closure) and decides from the policy whether to
 * execute now or queue. The tools agent's ToolDefinitions wrap these same
 * schemas and planners; when a definition is registered (lib/guard/registry.ts)
 * the guard uses it, otherwise it falls back to this table.
 */
import type { z } from "zod";
import {
  MUTATING_TOOL_NAMES,
  type MutatingInputBase,
  type MutationPlan,
  type ToolContext,
  type ToolName,
} from "@/lib/contracts";
import {
  AddBillInputSchema,
  AddBillResultSchema,
  AddChoreInputSchema,
  AddChoreResultSchema,
  AddMemberInputSchema,
  AddMemberResultSchema,
  AddReminderInputSchema,
  AddReminderResultSchema,
  AddShoppingItemInputSchema,
  AddShoppingItemResultSchema,
  AssignChoreInputSchema,
  AssignChoreResultSchema,
  CancelReminderInputSchema,
  CancelReminderResultSchema,
  CheckOffShoppingItemInputSchema,
  CheckOffShoppingItemResultSchema,
  ClearShoppingListInputSchema,
  ClearShoppingListResultSchema,
  CompleteChoreInputSchema,
  CompleteChoreResultSchema,
  MarkBillPaidInputSchema,
  MarkBillPaidResultSchema,
  RecordExpenseInputSchema,
  RecordExpenseResultSchema,
  RotateChoresInputSchema,
  RotateChoresResultSchema,
  RunRoutineInputSchema,
  RunRoutineResultSchema,
  SetDeviceStateInputSchema,
  SetDeviceStateResultSchema,
  SetPolicyInputSchema,
  SetPolicyResultSchema,
  UpdateBillInputSchema,
  UpdateBillResultSchema,
  planAddBill,
  planAddChore,
  planAddMember,
  planAddReminder,
  planAddShoppingItem,
  planAssignChore,
  planCancelReminder,
  planCheckOffShoppingItem,
  planClearShoppingList,
  planCompleteChore,
  planMarkBillPaid,
  planRecordExpense,
  planRotateChores,
  planRunRoutine,
  planSetDeviceState,
  planSetPolicy,
  planUpdateBill,
} from "@/lib/domain";
import { getToolDefinition } from "./registry";

export type MutatingToolName = Exclude<
  ToolName,
  | "list_members"
  | "get_household_summary"
  | "list_bills"
  | "get_bill"
  | "list_chores"
  | "list_shopping"
  | "list_reminders"
  | "list_devices"
  | "get_budget_summary"
  | "list_pending_actions"
  | "get_audit_log"
  | "verify_audit_chain"
  | "confirm_action"
  | "reject_action"
>;

export interface Planner {
  readonly inputSchema: z.ZodType<MutatingInputBase>;
  readonly resultSchema: z.ZodType;
  plan(input: MutatingInputBase, ctx: ToolContext): Promise<MutationPlan<unknown>>;
}

function definePlanner<I extends MutatingInputBase, R>(
  inputSchema: z.ZodType<I>,
  resultSchema: z.ZodType<R>,
  plan: (input: I, ctx: ToolContext) => Promise<MutationPlan<R>>,
): Planner {
  return {
    inputSchema,
    resultSchema,
    plan: (input, ctx) => plan(inputSchema.parse(input), ctx),
  };
}

export const PLANNERS: Readonly<Record<MutatingToolName, Planner>> = {
  add_member: definePlanner(AddMemberInputSchema, AddMemberResultSchema, planAddMember),
  add_bill: definePlanner(AddBillInputSchema, AddBillResultSchema, planAddBill),
  update_bill: definePlanner(UpdateBillInputSchema, UpdateBillResultSchema, planUpdateBill),
  mark_bill_paid: definePlanner(MarkBillPaidInputSchema, MarkBillPaidResultSchema, planMarkBillPaid),
  add_chore: definePlanner(AddChoreInputSchema, AddChoreResultSchema, planAddChore),
  assign_chore: definePlanner(AssignChoreInputSchema, AssignChoreResultSchema, planAssignChore),
  complete_chore: definePlanner(CompleteChoreInputSchema, CompleteChoreResultSchema, planCompleteChore),
  rotate_chores: definePlanner(RotateChoresInputSchema, RotateChoresResultSchema, planRotateChores),
  add_shopping_item: definePlanner(AddShoppingItemInputSchema, AddShoppingItemResultSchema, planAddShoppingItem),
  check_off_shopping_item: definePlanner(CheckOffShoppingItemInputSchema, CheckOffShoppingItemResultSchema, planCheckOffShoppingItem),
  clear_shopping_list: definePlanner(ClearShoppingListInputSchema, ClearShoppingListResultSchema, planClearShoppingList),
  add_reminder: definePlanner(AddReminderInputSchema, AddReminderResultSchema, planAddReminder),
  cancel_reminder: definePlanner(CancelReminderInputSchema, CancelReminderResultSchema, planCancelReminder),
  record_expense: definePlanner(RecordExpenseInputSchema, RecordExpenseResultSchema, planRecordExpense),
  set_device_state: definePlanner(SetDeviceStateInputSchema, SetDeviceStateResultSchema, planSetDeviceState),
  run_routine: definePlanner(RunRoutineInputSchema, RunRoutineResultSchema, planRunRoutine),
  set_policy: definePlanner(SetPolicyInputSchema, SetPolicyResultSchema, planSetPolicy),
};

export function isMutatingTool(name: string): name is MutatingToolName {
  return (MUTATING_TOOL_NAMES as readonly string[]).includes(name);
}

/** The registered ToolDefinition's schema+plan when present, else the built-in planner. */
export function resolvePlanner(tool: MutatingToolName): Planner {
  const def = getToolDefinition(tool);
  if (def && def.kind === "mutating") {
    return { inputSchema: def.inputSchema, resultSchema: def.resultSchema, plan: (input, ctx) => def.plan(input, ctx) };
  }
  return PLANNERS[tool];
}
