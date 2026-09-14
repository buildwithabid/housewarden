/**
 * Per-request context for console pages: the session check, the database,
 * the household (null before the seed) and the instant the request started.
 * Pages read through lib/domain with these; they never write.
 */
import type { Household } from "@/lib/contracts";
import { getDb, type CoreDb } from "@/lib/db";
import { getHousehold } from "@/lib/domain";
import { todayInZone } from "@/lib/time";
import { requireConsoleSession } from "./session";

export interface ConsoleContext {
  db: CoreDb;
  household: Household | null;
  now: Date;
  /** Today's date in the household timezone; null until a household exists. */
  today: string | null;
}

export interface HouseholdContext extends ConsoleContext {
  household: Household;
  today: string;
}

export async function loadConsole(next?: string): Promise<ConsoleContext> {
  await requireConsoleSession(next);
  const db = await getDb();
  const household = await getHousehold(db);
  const now = new Date();
  return { db, household, now, today: household ? todayInZone(now, household.timezone) : null };
}

/** Narrows a context to one with a household (the caller has already handled the empty case). */
export function withHousehold(ctx: ConsoleContext): HouseholdContext | null {
  if (!ctx.household || !ctx.today) return null;
  return { ...ctx, household: ctx.household, today: ctx.today };
}
