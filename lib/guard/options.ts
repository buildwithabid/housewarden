import type { Actor, Household, ToolContext } from "@/lib/contracts";
import { getDb, type CoreDb } from "@/lib/db";
import { env } from "@/lib/env";

export interface GuardOptions {
  /** Database to use; defaults to the shared singleton. */
  db?: CoreDb;
  /** The instant of the call; defaults to the clock. Tests inject it to drive expiry. */
  now?: Date;
  /** Pending-action lifetime; defaults to HOUSEWARDEN_CONFIRM_TTL_SECONDS. */
  ttlSeconds?: number;
}

export interface ResolvedGuardOptions {
  db: CoreDb;
  now: Date;
  ttlSeconds: number;
}

export async function resolveGuardOptions(options: GuardOptions = {}): Promise<ResolvedGuardOptions> {
  return {
    db: options.db ?? (await getDb()),
    now: options.now ?? new Date(),
    ttlSeconds: options.ttlSeconds ?? env().confirmTtlSeconds,
  };
}

export function toolContext(db: ToolContext["db"], household: Household, actor: Actor, now: Date): ToolContext {
  return { db, household, actor, now };
}
