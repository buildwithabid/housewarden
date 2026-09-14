/**
 * The single table of Housewarden's 31 tools (docs/SPEC.md §11.1), in
 * TOOL_CATALOGUE order. Importing this module registers the definitions with
 * the guard so runTool can dispatch read and guard tools; lib/mcp/register.ts
 * turns the same table into server.registerTool calls.
 *
 * Output schemas are computed once here, not per request: mcp-handler builds
 * a fresh McpServer per request, so registration must stay cheap.
 */
import type { z } from "zod";
import { TOOL_CATALOGUE, guardResultSchema, type ToolDefinition, type ToolName } from "@/lib/contracts";
import { registerToolDefinitions } from "@/lib/guard";
import { getAuditLogTool, verifyAuditChainTool } from "./audit";
import { addBillTool, getBillTool, listBillsTool, markBillPaidTool, updateBillTool } from "./bills";
import { getBudgetSummaryTool, recordExpenseTool } from "./budget";
import { addChoreTool, assignChoreTool, completeChoreTool, listChoresTool, rotateChoresTool } from "./chores";
import { listDevicesTool, runRoutineTool, setDeviceStateTool } from "./devices";
import { confirmActionTool, rejectActionTool } from "./guard";
import { addMemberTool, listMembersTool } from "./members";
import { listPendingActionsTool } from "./pending";
import { setPolicyTool } from "./policies";
import { addReminderTool, cancelReminderTool, listRemindersTool } from "./reminders";
import { addShoppingItemTool, checkOffShoppingItemTool, clearShoppingListTool, listShoppingTool } from "./shopping";
import { getHouseholdSummaryTool } from "./summary";

/** Every tool by name. The Record type makes a missing or misnamed tool a compile error. */
export const TOOL_BY_NAME: Readonly<Record<ToolName, ToolDefinition>> = {
  list_members: listMembersTool,
  get_household_summary: getHouseholdSummaryTool,
  list_bills: listBillsTool,
  get_bill: getBillTool,
  list_chores: listChoresTool,
  list_shopping: listShoppingTool,
  list_reminders: listRemindersTool,
  list_devices: listDevicesTool,
  get_budget_summary: getBudgetSummaryTool,
  list_pending_actions: listPendingActionsTool,
  get_audit_log: getAuditLogTool,
  verify_audit_chain: verifyAuditChainTool,
  add_member: addMemberTool,
  add_bill: addBillTool,
  update_bill: updateBillTool,
  mark_bill_paid: markBillPaidTool,
  add_chore: addChoreTool,
  assign_chore: assignChoreTool,
  complete_chore: completeChoreTool,
  rotate_chores: rotateChoresTool,
  add_shopping_item: addShoppingItemTool,
  check_off_shopping_item: checkOffShoppingItemTool,
  clear_shopping_list: clearShoppingListTool,
  add_reminder: addReminderTool,
  cancel_reminder: cancelReminderTool,
  record_expense: recordExpenseTool,
  set_device_state: setDeviceStateTool,
  run_routine: runRoutineTool,
  set_policy: setPolicyTool,
  confirm_action: confirmActionTool,
  reject_action: rejectActionTool,
};

/** All 31 definitions in catalogue order. */
export const TOOLS: readonly ToolDefinition[] = TOOL_CATALOGUE.map((entry) => TOOL_BY_NAME[entry.name]);

const OUTPUT_SCHEMAS = new Map<ToolName, z.ZodType>(
  TOOLS.map((def) => [def.name, def.kind === "mutating" ? guardResultSchema(def.resultSchema) : def.outputSchema]),
);

/**
 * The MCP outputSchema of a tool: the guard envelope around the tool's result
 * for mutating tools, the tool's own shape for read and guard tools.
 */
export function mcpOutputSchema(def: ToolDefinition): z.ZodType {
  const schema = OUTPUT_SCHEMAS.get(def.name);
  return schema ?? (def.kind === "mutating" ? guardResultSchema(def.resultSchema) : def.outputSchema);
}

export function getTool(name: ToolName): ToolDefinition {
  return TOOL_BY_NAME[name];
}

registerToolDefinitions(TOOLS);
