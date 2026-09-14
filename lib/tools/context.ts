/**
 * Small helpers shared by the tool definitions.
 */
import type { ToolAnnotations } from "@modelcontextprotocol/server";
import { DEFAULT_RISK, HousewardenError, TOOL_CATALOGUE, type Queryable, type Risk, type ToolContext, type ToolName } from "@/lib/contracts";
import { getDb, type CoreDb } from "@/lib/db";

/** True when a Queryable is the full database handle (runTool passes it for read and guard tools). */
export function isCoreDb(db: Queryable): db is CoreDb {
  const candidate = db as Partial<CoreDb>;
  return typeof candidate.transaction === "function" && typeof candidate.exec === "function" && typeof candidate.kind === "string";
}

/** The database handle behind a tool context; falls back to the shared singleton. */
export function coreDbOf(ctx: ToolContext): Promise<CoreDb> {
  return isCoreDb(ctx.db) ? Promise.resolve(ctx.db) : getDb();
}

/** The display title from TOOL_CATALOGUE, so tools/list and the console agree. */
export function catalogueTitle(name: ToolName): string {
  const entry = TOOL_CATALOGUE.find((t) => t.name === name);
  if (!entry) throw new HousewardenError("INTERNAL", `${name} is not in the tool catalogue.`);
  return entry.title;
}

/** The catalogue's default risk for a mutating tool. */
export function defaultRiskOf(name: ToolName): Exclude<Risk, "read"> {
  const risk = DEFAULT_RISK[name];
  if (risk === "read") throw new HousewardenError("INTERNAL", `${name} is a read tool and has no mutating risk.`);
  return risk;
}

/** Read tools: never write, only touch Housewarden's own data. */
export const READ_ANNOTATIONS: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };

export interface MutatingAnnotationOptions {
  /** true = may delete or overwrite; false = only adds. Omit when the tool updates (the protocol default, true). */
  destructive?: boolean;
  /** true = repeating the call with the same input has no further effect. */
  idempotent?: boolean;
}

/** Mutating and guard tools: closed-world, with the hints docs/TOOLS.md lists. */
export function mutatingAnnotations(options: MutatingAnnotationOptions = {}): ToolAnnotations {
  return {
    readOnlyHint: false,
    openWorldHint: false,
    ...(options.destructive !== undefined ? { destructiveHint: options.destructive } : {}),
    ...(options.idempotent ? { idempotentHint: true } : {}),
  };
}
