/**
 * Environment parsing. Read once, typed, and never prints a secret value.
 * Names and defaults come from lib/contracts.ts (ENV / DEFAULTS).
 */
import { z } from "zod";
import { DB_KINDS, DEFAULTS, ENV, type DbKind } from "@/lib/contracts";

export const PG_SSL_MODES = ["auto", "require", "disable", "no-verify"] as const;
export type PgSslMode = (typeof PG_SSL_MODES)[number];

export interface Env {
  /** Storage adapter. `pg` when DATABASE_URL is set and HOUSEWARDEN_DB is not. */
  db: DbKind;
  /** PGlite data directory; `memory://` is an ephemeral in-memory database. */
  dataDir: string;
  databaseUrl: string | null;
  pgSsl: PgSslMode;
  /** Bearer token for the MCP endpoint; null when unset. */
  token: string | null;
  /** Console login secret; null when unset. */
  adminSecret: string | null;
  allowedOrigins: readonly string[];
  confirmTtlSeconds: number;
  mcpApp: boolean;
  publicUrl: string | null;
  cookieSecure: boolean;
  timezone: string;
  currency: string;
  port: number;
}

const flag = z
  .string()
  .optional()
  .transform((v) => v !== undefined && ["1", "true", "yes", "on"].includes(v.trim().toLowerCase()));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? null : v.trim()));

const RawEnvSchema = z.object({
  [ENV.DB]: z.enum(DB_KINDS).optional(),
  [ENV.DATA_DIR]: z.string().optional(),
  [ENV.DATABASE_URL]: optionalString,
  [ENV.PG_SSL]: z.enum(PG_SSL_MODES).optional(),
  [ENV.TOKEN]: optionalString,
  [ENV.ADMIN_SECRET]: optionalString,
  [ENV.ALLOWED_ORIGINS]: z.string().optional(),
  [ENV.CONFIRM_TTL_SECONDS]: z.coerce.number().int().min(30).max(86_400).optional(),
  [ENV.MCP_APP]: flag,
  [ENV.PUBLIC_URL]: optionalString,
  [ENV.COOKIE_SECURE]: flag,
  [ENV.TIMEZONE]: z.string().optional(),
  [ENV.CURRENCY]: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).optional(),
});

/** Parses an environment map. Throws an Error naming the offending variables (never their values). */
export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = RawEnvSchema.safeParse(source);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "?")))].sort();
    throw new Error(`Invalid environment: ${names.join(", ")}`);
  }
  const raw = parsed.data;
  const databaseUrl = raw[ENV.DATABASE_URL];
  const db: DbKind = raw[ENV.DB] ?? (databaseUrl ? "pg" : DEFAULTS.DB);
  const allowedOrigins = (raw[ENV.ALLOWED_ORIGINS] ?? DEFAULTS.ALLOWED_ORIGINS)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const timezone = raw[ENV.TIMEZONE]?.trim() || DEFAULTS.TIMEZONE;
  return {
    db,
    dataDir: raw[ENV.DATA_DIR]?.trim() || DEFAULTS.DATA_DIR,
    databaseUrl,
    pgSsl: raw[ENV.PG_SSL] ?? DEFAULTS.PG_SSL,
    token: raw[ENV.TOKEN],
    adminSecret: raw[ENV.ADMIN_SECRET],
    allowedOrigins,
    confirmTtlSeconds: raw[ENV.CONFIRM_TTL_SECONDS] ?? DEFAULTS.CONFIRM_TTL_SECONDS,
    mcpApp: raw[ENV.MCP_APP],
    publicUrl: raw[ENV.PUBLIC_URL],
    cookieSecure: raw[ENV.COOKIE_SECURE],
    timezone,
    currency: raw[ENV.CURRENCY] ?? DEFAULTS.CURRENCY,
    port: raw.PORT ?? 3000,
  };
}

let cached: Env | null = null;

/** The process environment, parsed once. */
export function env(): Env {
  if (cached === null) cached = readEnv();
  return cached;
}

/** Forget the cached environment (tests and scripts that mutate process.env). */
export function resetEnvCache(): void {
  cached = null;
}
