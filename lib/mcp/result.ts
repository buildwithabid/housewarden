/**
 * ToolOutcome → CallToolResult (docs/SPEC.md §11.1). The spoken line is the
 * one text block; the structured content is the tool's output or, on
 * failure, the ToolError with isError so hosts and the SDK treat it as one.
 */
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { ToolOutcome } from "@/lib/contracts";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : { value };
}

export function toCallToolResult(outcome: ToolOutcome): CallToolResult {
  if (outcome.ok) {
    return { content: [{ type: "text", text: outcome.spoken }], structuredContent: asRecord(outcome.output) };
  }
  return { content: [{ type: "text", text: outcome.spoken }], structuredContent: outcome.error, isError: true };
}
