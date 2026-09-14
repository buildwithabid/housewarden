import type { z } from "zod";
import { HousewardenError } from "@/lib/contracts";

/** Parses with a zod schema, converting failure to a calm VALIDATION error. */
export function parseInput<T>(schema: z.ZodType<T>, raw: unknown, tool: string): T {
  const parsed = schema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((i) => `${i.path.map(String).join(".") || "input"}: ${i.message}`);
  throw new HousewardenError("VALIDATION", `I can't run ${tool} with that input: ${problems.join("; ")}.`, {
    tool,
    issues: parsed.error.issues.map((i) => ({ path: i.path.map(String), message: i.message })),
  });
}
