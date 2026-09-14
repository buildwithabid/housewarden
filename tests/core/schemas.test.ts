import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MUTATING_TOOL_NAMES } from "@/lib/contracts";
import { PLANNERS, ConfirmActionInputSchema, RejectActionInputSchema } from "@/lib/guard";
import { BudgetSummarySchema, HouseholdSummarySchema } from "@/lib/domain";

describe("schemas the MCP layer registers", () => {
  it("covers every mutating tool and converts to JSON Schema", () => {
    expect(Object.keys(PLANNERS).sort()).toEqual([...MUTATING_TOOL_NAMES].sort());
    for (const [name, planner] of Object.entries(PLANNERS)) {
      const input = z.toJSONSchema(planner.inputSchema, { io: "input" });
      expect(input, name).toMatchObject({ type: "object" });
      const props = (input as { properties?: Record<string, unknown> }).properties ?? {};
      expect(Object.keys(props), name).toEqual(expect.arrayContaining(["dry_run", "idempotency_key", "member"]));
      expect(z.toJSONSchema(planner.resultSchema), name).toMatchObject({ type: "object" });
    }
    for (const schema of [ConfirmActionInputSchema, RejectActionInputSchema, BudgetSummarySchema, HouseholdSummarySchema]) {
      expect(z.toJSONSchema(schema)).toMatchObject({ type: "object" });
    }
  });
});
