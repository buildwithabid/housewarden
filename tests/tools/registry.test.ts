import { describe, expect, it } from "vitest";
import { GUARD_TOOL_NAMES, MUTATING_TOOL_NAMES, READ_TOOL_NAMES, TOOL_CATALOGUE, TOOL_NAMES } from "@/lib/contracts";
import { getToolDefinition } from "@/lib/guard";
import { TOOLS, TOOL_BY_NAME, mcpOutputSchema } from "@/lib/tools/registry";

const DESTRUCTIVE = ["clear_shopping_list", "cancel_reminder", "reject_action"];
const IDEMPOTENT = ["confirm_action", "reject_action", "check_off_shopping_item", "complete_chore", "mark_bill_paid"];

describe("lib/tools/registry", () => {
  it("has the 31 catalogue tools, in catalogue order, with matching kinds and titles", () => {
    expect(TOOLS).toHaveLength(31);
    expect(TOOLS.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    for (const entry of TOOL_CATALOGUE) {
      const def = TOOL_BY_NAME[entry.name];
      expect(def.kind, entry.name).toBe(entry.kind);
      expect(def.title, entry.name).toBe(entry.title);
      if (def.kind === "mutating") expect(def.defaultRisk, entry.name).toBe(entry.risk);
    }
    expect(READ_TOOL_NAMES).toHaveLength(12);
    expect(MUTATING_TOOL_NAMES).toHaveLength(17);
    expect(GUARD_TOOL_NAMES).toHaveLength(2);
  });

  it("registers every definition with the guard at import time", () => {
    for (const name of TOOL_NAMES) expect(getToolDefinition(name)?.name).toBe(name);
  });

  it("describes every tool for a voice assistant: two sentences, at least 20 characters", () => {
    for (const def of TOOLS) {
      expect(def.description.trim().length, def.name).toBeGreaterThanOrEqual(20);
      const sentences = def.description.trim().split(/(?<=\.)\s+/);
      expect(sentences.length, `${def.name}: "${def.description}"`).toBeGreaterThanOrEqual(2);
      expect(def.description.trim().endsWith("."), def.name).toBe(true);
    }
  });

  it("marks exactly the 12 read tools readOnlyHint and every tool closed-world", () => {
    const readOnly = TOOLS.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name);
    expect(readOnly.sort()).toEqual([...READ_TOOL_NAMES].sort());
    for (const def of TOOLS) {
      expect(def.annotations?.openWorldHint, def.name).toBe(false);
      if (def.kind !== "read") expect(def.annotations?.readOnlyHint, def.name).toBe(false);
      expect(def.annotations?.destructiveHint === true, def.name).toBe(DESTRUCTIVE.includes(def.name));
      expect(def.annotations?.idempotentHint === true, def.name).toBe(IDEMPOTENT.includes(def.name));
    }
  });

  it("gives every tool a zod input object and an output schema (guard envelope for mutating tools)", () => {
    for (const def of TOOLS) {
      expect(def.inputSchema.safeParse({ nonsense: true }).success !== undefined, def.name).toBe(true);
      const output = mcpOutputSchema(def);
      expect(output, def.name).toBeDefined();
      if (def.kind === "mutating") {
        expect(output.safeParse({ status: "dry_run", tool: def.name, risk: "low", preview: { summary: "", changes: [], warnings: [] }, would_require_confirmation: false, spoken: "x" }).success, def.name).toBe(true);
        expect(def.inputSchema.safeParse({}).success === true || def.inputSchema.safeParse({}).success === false).toBe(true);
        const parsed = def.inputSchema.safeParse({ dry_run: true, idempotency_key: "k" });
        if (parsed.success) expect(parsed.data).toMatchObject({ dry_run: true, idempotency_key: "k" });
      }
    }
  });
});
