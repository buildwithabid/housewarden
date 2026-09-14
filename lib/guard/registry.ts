/**
 * Where the tools agent registers its ToolDefinitions so runTool can dispatch
 * read tools (and prefer registered schemas for the rest). lib/tools/registry.ts
 * calls registerToolDefinitions(TOOLS) at module scope.
 */
import type { ToolDefinition, ToolName } from "@/lib/contracts";

const REGISTRY_KEY: unique symbol = Symbol.for("housewarden.tool-registry");
type GlobalWithRegistry = typeof globalThis & { [REGISTRY_KEY]?: Map<ToolName, ToolDefinition> };

function registry(): Map<ToolName, ToolDefinition> {
  const g = globalThis as GlobalWithRegistry;
  if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = new Map();
  return g[REGISTRY_KEY];
}

export function registerToolDefinitions(definitions: Iterable<ToolDefinition>): void {
  const map = registry();
  for (const def of definitions) map.set(def.name, def);
}

export function getToolDefinition(name: ToolName): ToolDefinition | undefined {
  return registry().get(name);
}

export function listToolDefinitions(): ToolDefinition[] {
  return [...registry().values()];
}

/** Tests only. */
export function clearToolDefinitions(): void {
  registry().clear();
}
