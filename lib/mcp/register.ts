/**
 * registerTools(server) — registers every definition in lib/tools/registry.ts
 * with an SDK v2 McpServer and returns the handles by name, so the MCP App
 * (lib/mcpapp) can attach its _meta to the guard tools.
 *
 * Every handler goes through runTool(name, args, ASSISTANT_ACTOR): mutating
 * tools reach the database only through the guard, exactly like the console.
 */
import type { McpServer, RegisteredTool, ToolAnnotations } from "@modelcontextprotocol/server";
import { ASSISTANT_ACTOR, type ToolDefinition } from "@/lib/contracts";
import { runTool } from "@/lib/guard";
import { guardToolUiMeta } from "@/lib/mcpapp/register";
import { TOOLS, mcpOutputSchema } from "@/lib/tools/registry";
import { toCallToolResult } from "./result";

/** Used only when a definition carries no annotations of its own. */
export function defaultAnnotations(def: ToolDefinition): ToolAnnotations {
  return { readOnlyHint: def.kind === "read", openWorldHint: false };
}

/** `_meta` for the MCP App on the guard tools (empty for every other tool, and everywhere when the flag is off). */
function uiMeta(name: string): { _meta?: Record<string, unknown> } {
  const meta = guardToolUiMeta(name);
  return "_meta" in meta ? { _meta: { ...meta._meta } } : {};
}

export function registerTools(server: McpServer): Map<string, RegisteredTool> {
  const handles = new Map<string, RegisteredTool>();
  for (const def of TOOLS) {
    const handle = server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema,
        outputSchema: mcpOutputSchema(def),
        annotations: def.annotations ?? defaultAnnotations(def),
        ...uiMeta(def.name),
      },
      async (args: unknown) => toCallToolResult(await runTool(def.name, args, ASSISTANT_ACTOR)),
    );
    handles.set(def.name, handle);
  }
  return handles;
}
