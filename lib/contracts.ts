/**
 * Housewarden — shared contracts.
 *
 * This is the one file every build agent imports. It contains data shapes,
 * enums, zod schemas that are reused across tools, the storage interface, the
 * tool-definition shape used to register tools, the tool catalogue with
 * default risk levels, and a handful of pure helpers (canonical JSON).
 *
 * Rules for this file:
 *  - No I/O, no framework imports, no Node built-ins. It must be importable
 *    from a server component, a route handler, a script and a vitest file.
 *  - Additive changes only, made by the core agent, announced in the commit
 *    message. Everyone else treats it as read-only. See docs/FILE_OWNERSHIP.md.
 *  - Every shape here is described in prose in docs/SPEC.md; if the two
 *    disagree, this file wins and SPEC.md gets fixed.
 */

import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/server";

// ---------------------------------------------------------------------------
// Enumerations (single source of truth for CHECK constraints in the schema)
// ---------------------------------------------------------------------------

export const RISK_LEVELS = ["read", "low", "confirm", "high"] as const;
export const RiskSchema = z.enum(RISK_LEVELS);
export type Risk = z.infer<typeof RiskSchema>;

export const MEMBER_ROLES = ["adult", "child"] as const;
export const MemberRoleSchema = z.enum(MEMBER_ROLES);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

export const BILL_RECURRENCES = ["none", "monthly", "yearly"] as const;
export const BillRecurrenceSchema = z.enum(BILL_RECURRENCES);
export type BillRecurrence = z.infer<typeof BillRecurrenceSchema>;

export const BILL_STATUSES = ["due", "paid", "overdue"] as const;
export const BillStatusSchema = z.enum(BILL_STATUSES);
export type BillStatus = z.infer<typeof BillStatusSchema>;

export const CHORE_CADENCES = ["once", "daily", "weekly", "monthly"] as const;
export const ChoreCadenceSchema = z.enum(CHORE_CADENCES);
export type ChoreCadence = z.infer<typeof ChoreCadenceSchema>;

export const CHORE_STATUSES = ["open", "done"] as const;
export const ChoreStatusSchema = z.enum(CHORE_STATUSES);
export type ChoreStatus = z.infer<typeof ChoreStatusSchema>;

export const REMINDER_STATUSES = ["scheduled", "done", "cancelled"] as const;
export const ReminderStatusSchema = z.enum(REMINDER_STATUSES);
export type ReminderStatus = z.infer<typeof ReminderStatusSchema>;

export const DEVICE_KINDS = ["lock", "thermostat", "light", "plug"] as const;
export const DeviceKindSchema = z.enum(DEVICE_KINDS);
export type DeviceKind = z.infer<typeof DeviceKindSchema>;

export const PENDING_STATUSES = [
  "pending",
  "confirmed",
  "executed",
  "rejected",
  "expired",
  "failed",
] as const;
export const PendingStatusSchema = z.enum(PENDING_STATUSES);
export type PendingStatus = z.infer<typeof PendingStatusSchema>;

export const AUDIT_EVENTS = [
  "proposed",
  "executed",
  "rejected",
  "expired",
  "failed",
  "seeded",
] as const;
export const AuditEventSchema = z.enum(AUDIT_EVENTS);
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const ACTOR_KINDS = ["assistant", "console", "system"] as const;
export const ActorKindSchema = z.enum(ACTOR_KINDS);
export type ActorKind = z.infer<typeof ActorKindSchema>;

export const ENTITY_KINDS = [
  "household",
  "member",
  "bill",
  "chore",
  "shopping_item",
  "reminder",
  "budget_entry",
  "device",
  "routine",
  "policy",
  "pending_action",
] as const;
export const EntityKindSchema = z.enum(ENTITY_KINDS);
export type EntityKind = z.infer<typeof EntityKindSchema>;

export const CHANGE_OPS = ["create", "update", "delete"] as const;
export const ChangeOpSchema = z.enum(CHANGE_OPS);
export type ChangeOp = z.infer<typeof ChangeOpSchema>;

// ---------------------------------------------------------------------------
// Scalars shared by many schemas
// ---------------------------------------------------------------------------

/** ISO-8601 instant with millisecond precision and a zone designator, e.g. 2026-10-05T08:01:30.250Z */
export const IsoInstantSchema = z.iso.datetime({ offset: true });
/** Calendar date, YYYY-MM-DD, interpreted in the household timezone. */
export const IsoDateSchema = z.iso.date();
/** A hex-encoded SHA-256 digest. */
export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
/** Free-form reference to an entity: its uuid, or its display name/title (case-insensitive exact match). */
export const EntityRefSchema = z.string().trim().min(1).max(200);
/** ISO-4217 currency code. */
export const CurrencySchema = z.string().trim().toUpperCase().length(3);
/** A money amount in major units (3000 or 3000.5), never negative, at most 2 decimals. */
export const AmountSchema = z
  .number()
  .finite()
  .min(0)
  .max(1_000_000_000)
  .refine((n) => Number.isInteger(Math.round(n * 100)) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: "at most two decimal places",
  });

export const GENESIS_HASH = "0".repeat(64);

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

export const ActorSchema = z.object({
  kind: ActorKindSchema,
  /** Stable id inside the kind: "mcp" for the MCP endpoint, "admin" for the console, "seed"/"sweeper" for system. */
  id: z.string().min(1).max(100),
  /** Human label shown in the console and audit log, e.g. "Assistant". */
  label: z.string().min(1).max(100),
  /** The household member on whose behalf the action is taken, when known. */
  member_id: z.uuid().nullable().optional(),
});
export type Actor = z.infer<typeof ActorSchema>;

export const ASSISTANT_ACTOR: Actor = { kind: "assistant", id: "mcp", label: "Assistant" };
export const CONSOLE_ACTOR: Actor = { kind: "console", id: "admin", label: "Console" };
export const SEED_ACTOR: Actor = { kind: "system", id: "seed", label: "Demo data" };
export const SWEEPER_ACTOR: Actor = { kind: "system", id: "sweeper", label: "Expiry sweep" };

// ---------------------------------------------------------------------------
// Entity DTOs (what tools return and the console renders). Timestamps are ISO
// strings, dates are YYYY-MM-DD, money is major units + a formatted string.
// Database row shapes are private to lib/domain.
// ---------------------------------------------------------------------------

export const MemberRefSchema = z.object({ id: z.uuid(), name: z.string() });
export type MemberRef = z.infer<typeof MemberRefSchema>;

export const HouseholdSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  currency: CurrencySchema,
  timezone: z.string(),
  created_at: IsoInstantSchema,
});
export type Household = z.infer<typeof HouseholdSchema>;

export const MemberSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: MemberRoleSchema,
  has_pin: z.boolean(),
  created_at: IsoInstantSchema,
});
export type Member = z.infer<typeof MemberSchema>;

export const BillSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  amount: z.number(),
  currency: CurrencySchema,
  /** e.g. "3,000 PKR" or "45.50 USD" — the string a voice assistant should read. */
  amount_formatted: z.string(),
  due_date: IsoDateSchema,
  recurrence: BillRecurrenceSchema,
  /** Effective status: a stored "due" bill whose due_date is before today reads as "overdue". */
  status: BillStatusSchema,
  paid_at: IsoInstantSchema.nullable(),
  /** Days from today to due_date in the household timezone; negative when overdue; null when paid. */
  days_until_due: z.number().int().nullable(),
});
export type Bill = z.infer<typeof BillSchema>;

export const ChoreSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  assigned_member: MemberRefSchema.nullable(),
  cadence: ChoreCadenceSchema,
  due_date: IsoDateSchema.nullable(),
  status: ChoreStatusSchema,
  completed_at: IsoInstantSchema.nullable(),
});
export type Chore = z.infer<typeof ChoreSchema>;

export const ShoppingItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Free text quantity as spoken: "1", "2 kg", "3 packs". */
  qty: z.string(),
  category: z.string().nullable(),
  checked: z.boolean(),
  checked_at: IsoInstantSchema.nullable(),
});
export type ShoppingItem = z.infer<typeof ShoppingItemSchema>;

export const ReminderSchema = z.object({
  id: z.uuid(),
  text: z.string(),
  at: IsoInstantSchema,
  member: MemberRefSchema.nullable(),
  status: ReminderStatusSchema,
});
export type Reminder = z.infer<typeof ReminderSchema>;

export const BudgetEntrySchema = z.object({
  id: z.uuid(),
  amount: z.number(),
  currency: CurrencySchema,
  amount_formatted: z.string(),
  category: z.string(),
  note: z.string().nullable(),
  member: MemberRefSchema.nullable(),
  occurred_at: IsoInstantSchema,
});
export type BudgetEntry = z.infer<typeof BudgetEntrySchema>;

/** Device state, validated per kind at runtime (see DEVICE_STATE_SCHEMAS). */
export const LockStateSchema = z.object({ locked: z.boolean() });
export const ThermostatStateSchema = z.object({
  mode: z.enum(["heat", "cool", "off"]),
  target_c: z.number().min(5).max(35),
});
export const LightStateSchema = z.object({
  on: z.boolean(),
  brightness: z.number().int().min(0).max(100).optional(),
});
export const PlugStateSchema = z.object({ on: z.boolean() });
export const DEVICE_STATE_SCHEMAS = {
  lock: LockStateSchema,
  thermostat: ThermostatStateSchema,
  light: LightStateSchema,
  plug: PlugStateSchema,
} as const satisfies Record<DeviceKind, z.ZodType>;
export const DeviceStateSchema = z.record(z.string(), z.unknown());
export type DeviceState = z.infer<typeof DeviceStateSchema>;

export const DeviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: DeviceKindSchema,
  state: DeviceStateSchema,
  updated_at: IsoInstantSchema,
});
export type Device = z.infer<typeof DeviceSchema>;

/** Tools a routine step may invoke. Steps never go through the guard individually; the routine is the guarded unit. */
export const ROUTINE_STEP_TOOLS = ["set_device_state", "add_reminder", "check_off_shopping_item"] as const;
export const RoutineStepSchema = z.object({
  tool: z.enum(ROUTINE_STEP_TOOLS),
  input: z.record(z.string(), z.unknown()),
});
export type RoutineStep = z.infer<typeof RoutineStepSchema>;

export const RoutineSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  steps: z.array(RoutineStepSchema),
});
export type Routine = z.infer<typeof RoutineSchema>;

export const PolicySchema = z.object({
  tool_name: z.string(),
  /** Sub-scope inside the tool, e.g. the device kind for set_device_state. "" means any. */
  scope: z.string(),
  member: MemberRefSchema.nullable(),
  risk: RiskSchema,
  /** "builtin" = the compiled-in default, "household" = a row in the policies table. */
  source: z.enum(["builtin", "household"]),
});
export type Policy = z.infer<typeof PolicySchema>;

// ---------------------------------------------------------------------------
// Guard: preview, results, pending actions, audit rows
// ---------------------------------------------------------------------------

export const ChangeSchema = z.object({
  entity: EntityKindSchema,
  /** The entity id, or null for an entity that does not exist yet. */
  id: z.string().nullable(),
  op: ChangeOpSchema,
  /** Display name of the entity, e.g. "Electricity". */
  label: z.string(),
  /** Fields before the change (update/delete) — only the fields that change. */
  before: z.record(z.string(), z.unknown()).nullable(),
  /** Fields after the change (create/update) — only the fields that change. */
  after: z.record(z.string(), z.unknown()).nullable(),
  /** One diff-like human line: "bill 'Electricity' 3,000 PKR due 2026-10-05: status overdue → paid" */
  line: z.string(),
});
export type Change = z.infer<typeof ChangeSchema>;

export const PreviewSchema = z.object({
  /** One sentence: "Mark bill 'Electricity' (3,000 PKR, due 2026-10-05) as paid" */
  summary: z.string(),
  changes: z.array(ChangeSchema),
  /** Things the approver should know: "This bill recurs monthly; the next one will be created for 2026-11-05." */
  warnings: z.array(z.string()),
});
export type Preview = z.infer<typeof PreviewSchema>;

export const HOW_TO_CONFIRM = "Call confirm_action with the action_id, or approve it in the Housewarden console.";
export const HOW_TO_CONFIRM_CONSOLE_ONLY = "This action is high risk: a person must approve it in the Housewarden console.";

/** Fields every mutating tool accepts in addition to its own. */
export const MutatingInputBaseSchema = z.object({
  dry_run: z
    .boolean()
    .default(false)
    .describe("When true, return the preview only. Nothing is written and nothing is queued."),
  idempotency_key: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Optional client-chosen key. Repeating a call with the same key returns the original outcome instead of acting twice."),
  member: EntityRefSchema.optional().describe("Who is asking, if known: a member id or name. Used for per-member policies and the audit trail."),
});
export type MutatingInputBase = z.infer<typeof MutatingInputBaseSchema>;

/**
 * Builds the output schema of a mutating tool: the guard envelope with the
 * tool-specific `result` type. Read tools return their own shape directly.
 */
export function guardResultSchema<R extends z.ZodType>(result: R) {
  return z.discriminatedUnion("status", [
    z.object({
      status: z.literal("executed"),
      tool: z.string(),
      action_id: z.uuid(),
      risk: RiskSchema,
      preview: PreviewSchema,
      result,
      executed_at: IsoInstantSchema,
      /** True when this call repeated an earlier one (same idempotency_key or a second confirm_action) and nothing new happened. */
      idempotent_replay: z.boolean(),
      spoken: z.string(),
    }),
    z.object({
      status: z.literal("needs_confirmation"),
      tool: z.string(),
      action_id: z.uuid(),
      risk: RiskSchema,
      preview: PreviewSchema,
      expires_at: IsoInstantSchema,
      how_to_confirm: z.string(),
      spoken: z.string(),
    }),
    z.object({
      status: z.literal("dry_run"),
      tool: z.string(),
      risk: RiskSchema,
      preview: PreviewSchema,
      would_require_confirmation: z.boolean(),
      spoken: z.string(),
    }),
  ]);
}

export type GuardExecuted<R> = {
  status: "executed";
  tool: string;
  action_id: string;
  risk: Risk;
  preview: Preview;
  result: R;
  executed_at: string;
  idempotent_replay: boolean;
  spoken: string;
};
export type GuardNeedsConfirmation = {
  status: "needs_confirmation";
  tool: string;
  action_id: string;
  risk: Risk;
  preview: Preview;
  expires_at: string;
  how_to_confirm: string;
  spoken: string;
};
export type GuardDryRun = {
  status: "dry_run";
  tool: string;
  risk: Risk;
  preview: Preview;
  would_require_confirmation: boolean;
  spoken: string;
};
export type GuardResult<R = unknown> = GuardExecuted<R> | GuardNeedsConfirmation | GuardDryRun;

export const RejectedResultSchema = z.object({
  status: z.literal("rejected"),
  tool: z.string(),
  action_id: z.uuid(),
  preview: PreviewSchema,
  reason: z.string().nullable(),
  rejected_at: IsoInstantSchema,
  idempotent_replay: z.boolean(),
  spoken: z.string(),
});
export type RejectedResult = z.infer<typeof RejectedResultSchema>;

export const PendingActionSchema = z.object({
  id: z.uuid(),
  tool: z.string(),
  input: z.record(z.string(), z.unknown()),
  preview: PreviewSchema,
  risk: RiskSchema,
  status: PendingStatusSchema,
  created_by: ActorSchema,
  created_at: IsoInstantSchema,
  expires_at: IsoInstantSchema,
  decided_by: ActorSchema.nullable(),
  decided_at: IsoInstantSchema.nullable(),
  executed_at: IsoInstantSchema.nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  idempotency_key: z.string().nullable(),
});
export type PendingAction = z.infer<typeof PendingActionSchema>;

export const AuditRowSchema = z.object({
  seq: z.number().int().positive(),
  at: IsoInstantSchema,
  actor: ActorSchema,
  event: AuditEventSchema,
  tool: z.string(),
  action_id: z.uuid().nullable(),
  input: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()).nullable(),
  prev_hash: Sha256HexSchema,
  hash: Sha256HexSchema,
});
export type AuditRow = z.infer<typeof AuditRowSchema>;
/** The row as hashed: everything except `hash`. */
export type AuditRowBody = Omit<AuditRow, "hash">;

export const ChainVerificationSchema = z.object({
  intact: z.boolean(),
  rows: z.number().int().nonnegative(),
  last_seq: z.number().int().nonnegative(),
  last_hash: Sha256HexSchema,
  checked_at: IsoInstantSchema,
  /** First row that failed, when not intact. */
  first_bad_seq: z.number().int().positive().nullable(),
  reason: z.enum(["hash_mismatch", "prev_hash_mismatch", "seq_gap"]).nullable(),
});
export type ChainVerification = z.infer<typeof ChainVerificationSchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  "VALIDATION",
  "NOT_FOUND",
  "AMBIGUOUS_REF",
  "ALREADY_DONE",
  "ACTION_NOT_PENDING",
  "ACTION_EXPIRED",
  "STALE_PREVIEW",
  "HIGH_RISK_CONSOLE_ONLY",
  "POLICY_INVARIANT",
  "HOUSEHOLD_EMPTY",
  "UNSUPPORTED_STATE",
  "ROUTINE_STEP_INVALID",
  "UNAUTHORIZED",
  "FORBIDDEN_ORIGIN",
  "NOT_CONFIGURED",
  "INTERNAL",
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ToolErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ToolError = z.infer<typeof ToolErrorSchema>;

/** Thrown by domain and guard code; converted to a ToolError at the MCP and console boundaries. */
export class HousewardenError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "HousewardenError";
    this.code = code;
    this.details = details;
  }
  toToolError(): ToolError {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}

/**
 * What runTool returns to both surfaces (docs/SPEC.md §1). The MCP handler
 * turns it into a CallToolResult, the console into an ActionState.
 */
export type ToolOutcome =
  | { ok: true; output: unknown; spoken: string }
  | { ok: false; error: ToolError; spoken: string };

/** JSON-RPC error codes used by the HTTP layer in front of the MCP handler. */
export const JSONRPC_ERROR_UNAUTHORIZED = -32001;
export const JSONRPC_ERROR_FORBIDDEN_ORIGIN = -32003;
export const JSONRPC_ERROR_NOT_CONFIGURED = -32004;

// ---------------------------------------------------------------------------
// Storage interface
// ---------------------------------------------------------------------------

export interface QueryResult<T> {
  rows: T[];
  /** Rows returned by SELECT or affected by INSERT/UPDATE/DELETE. */
  rowCount: number;
}

/** Anything that can run one parameterised SQL statement: a Db or a transaction handle. */
export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

export const DB_KINDS = ["pglite", "pg"] as const;
export type DbKind = (typeof DB_KINDS)[number];

/**
 * The storage interface. Two adapters implement it (lib/db/pglite.ts and
 * lib/db/pg.ts); everything above lib/db speaks only this. Both adapters
 * normalise driver output so that: int8/bigint → number, date → "YYYY-MM-DD"
 * string, timestamptz → Date, jsonb → parsed value, numeric is never used.
 */
export interface Db extends Queryable {
  readonly kind: DbKind;
  /** Run multi-statement SQL with no parameters (migrations only). */
  exec(sql: string): Promise<void>;
  /** Run fn inside BEGIN/COMMIT; rolls back and rethrows on error. Nested calls are not supported. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export const MigrationRecordSchema = z.object({
  version: z.number().int().positive(),
  name: z.string(),
  applied_at: IsoInstantSchema,
});
export type MigrationRecord = z.infer<typeof MigrationRecordSchema>;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface ToolContext {
  db: Queryable;
  household: Household;
  actor: Actor;
  /** The instant the call started; use it instead of new Date() so previews and audit rows agree. */
  now: Date;
}

export interface ToolRun<O> {
  output: O;
  /** One or two short sentences fit for text-to-speech. No ids, no hashes. */
  spoken: string;
}

/**
 * What a mutating tool computes in its dry-run phase. `execute` is only ever
 * called by the guard, inside a transaction, after the policy decision (and,
 * for confirm/high risk, after a person or confirm_action approved it and the
 * re-planned preview still matches).
 */
export interface MutationPlan<O> {
  preview: Preview;
  /** Spoken line for the preview ("I can mark Electricity, 3,000 rupees, as paid. Shall I?"). */
  spoken: string;
  /** Policy sub-scope, e.g. the device kind. "" when the tool has no sub-scope. */
  policyScope: string;
  execute(tx: Queryable, ctx: ToolContext): Promise<ToolRun<O>>;
}

export type ToolKind = "read" | "mutating" | "guard";

interface ToolDefinitionBase {
  name: ToolName;
  /** Display title, e.g. "Mark bill paid". */
  title: string;
  /**
   * Written for a voice assistant: sentence one says what it does, sentence
   * two says what it needs. Example: "Marks a bill as paid and, if it recurs,
   * creates the next one. Needs the bill name or id."
   */
  description: string;
  annotations?: ToolAnnotations;
}

export interface ReadToolDefinition<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType>
  extends ToolDefinitionBase {
  kind: "read";
  inputSchema: I;
  outputSchema: O;
  run(input: z.output<I>, ctx: ToolContext): Promise<ToolRun<z.output<O>>>;
}

export interface MutatingToolDefinition<
  I extends z.ZodType<MutatingInputBase> = z.ZodType<MutatingInputBase>,
  R extends z.ZodType = z.ZodType,
> extends ToolDefinitionBase {
  kind: "mutating";
  /** Must extend MutatingInputBaseSchema. */
  inputSchema: I;
  /** The tool-specific result; the MCP outputSchema is guardResultSchema(resultSchema). */
  resultSchema: R;
  defaultRisk: Exclude<Risk, "read">;
  plan(input: z.output<I>, ctx: ToolContext): Promise<MutationPlan<z.output<R>>>;
}

export interface GuardToolDefinition<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType>
  extends ToolDefinitionBase {
  kind: "guard";
  inputSchema: I;
  outputSchema: O;
  run(input: z.output<I>, ctx: ToolContext): Promise<ToolRun<z.output<O>>>;
}

export type ToolDefinition = ReadToolDefinition | MutatingToolDefinition | GuardToolDefinition;

/** Identity helpers so tool files get inference without `as` casts. */
export function defineReadTool<I extends z.ZodType, O extends z.ZodType>(
  def: ReadToolDefinition<I, O>,
): ReadToolDefinition<I, O> {
  return def;
}
export function defineMutatingTool<I extends z.ZodType<MutatingInputBase>, R extends z.ZodType>(
  def: MutatingToolDefinition<I, R>,
): MutatingToolDefinition<I, R> {
  return def;
}
export function defineGuardTool<I extends z.ZodType, O extends z.ZodType>(
  def: GuardToolDefinition<I, O>,
): GuardToolDefinition<I, O> {
  return def;
}

// ---------------------------------------------------------------------------
// Tool catalogue — every tool, its kind and its default risk. 31 tools.
// ---------------------------------------------------------------------------

export interface ToolCatalogueEntry {
  name: string;
  kind: ToolKind;
  title: string;
  risk: Risk;
}

export const TOOL_CATALOGUE = [
  // READ (12)
  { name: "list_members", kind: "read", title: "List members", risk: "read" },
  { name: "get_household_summary", kind: "read", title: "Household summary", risk: "read" },
  { name: "list_bills", kind: "read", title: "List bills", risk: "read" },
  { name: "get_bill", kind: "read", title: "Get bill", risk: "read" },
  { name: "list_chores", kind: "read", title: "List chores", risk: "read" },
  { name: "list_shopping", kind: "read", title: "List shopping", risk: "read" },
  { name: "list_reminders", kind: "read", title: "List reminders", risk: "read" },
  { name: "list_devices", kind: "read", title: "List devices", risk: "read" },
  { name: "get_budget_summary", kind: "read", title: "Budget summary", risk: "read" },
  { name: "list_pending_actions", kind: "read", title: "List pending actions", risk: "read" },
  { name: "get_audit_log", kind: "read", title: "Audit log", risk: "read" },
  { name: "verify_audit_chain", kind: "read", title: "Verify audit chain", risk: "read" },
  // MUTATING (17) — every one goes through the guard
  { name: "add_member", kind: "mutating", title: "Add member", risk: "confirm" },
  { name: "add_bill", kind: "mutating", title: "Add bill", risk: "low" },
  { name: "update_bill", kind: "mutating", title: "Update bill", risk: "low" },
  { name: "mark_bill_paid", kind: "mutating", title: "Mark bill paid", risk: "confirm" },
  { name: "add_chore", kind: "mutating", title: "Add chore", risk: "low" },
  { name: "assign_chore", kind: "mutating", title: "Assign chore", risk: "low" },
  { name: "complete_chore", kind: "mutating", title: "Complete chore", risk: "low" },
  { name: "rotate_chores", kind: "mutating", title: "Rotate chores", risk: "low" },
  { name: "add_shopping_item", kind: "mutating", title: "Add shopping item", risk: "low" },
  { name: "check_off_shopping_item", kind: "mutating", title: "Check off shopping item", risk: "low" },
  { name: "clear_shopping_list", kind: "mutating", title: "Clear shopping list", risk: "confirm" },
  { name: "add_reminder", kind: "mutating", title: "Add reminder", risk: "low" },
  { name: "cancel_reminder", kind: "mutating", title: "Cancel reminder", risk: "low" },
  { name: "record_expense", kind: "mutating", title: "Record expense", risk: "low" },
  { name: "set_device_state", kind: "mutating", title: "Set device state", risk: "low" },
  { name: "run_routine", kind: "mutating", title: "Run routine", risk: "confirm" },
  { name: "set_policy", kind: "mutating", title: "Set policy", risk: "high" },
  // GUARD (2)
  { name: "confirm_action", kind: "guard", title: "Confirm action", risk: "low" },
  { name: "reject_action", kind: "guard", title: "Reject action", risk: "low" },
] as const satisfies readonly ToolCatalogueEntry[];

export type ToolName = (typeof TOOL_CATALOGUE)[number]["name"];
export const TOOL_NAMES: readonly ToolName[] = TOOL_CATALOGUE.map((t) => t.name);
export const ToolNameSchema = z.enum(TOOL_NAMES as [ToolName, ...ToolName[]]);

export const READ_TOOL_NAMES: readonly ToolName[] = TOOL_CATALOGUE.filter((t) => t.kind === "read").map((t) => t.name);
export const MUTATING_TOOL_NAMES: readonly ToolName[] = TOOL_CATALOGUE.filter((t) => t.kind === "mutating").map(
  (t) => t.name,
);
export const GUARD_TOOL_NAMES: readonly ToolName[] = TOOL_CATALOGUE.filter((t) => t.kind === "guard").map((t) => t.name);

/** Default risk per tool with no sub-scope. Policies in the database override these. */
export const DEFAULT_RISK: Readonly<Record<ToolName, Risk>> = Object.fromEntries(
  TOOL_CATALOGUE.map((t) => [t.name, t.risk]),
) as Record<ToolName, Risk>;

/**
 * Built-in scoped defaults. These apply even on an empty policies table.
 * Resolution order (first match wins):
 *   1. policies row (tool, scope, member)
 *   2. policies row (tool, "",    member)
 *   3. policies row (tool, scope, null)
 *   4. policies row (tool, "",    null)
 *   5. BUILTIN_SCOPED_POLICIES (tool, scope)
 *   6. DEFAULT_RISK[tool]
 */
export const BUILTIN_SCOPED_POLICIES: readonly { tool_name: ToolName; scope: string; risk: Risk }[] = [
  { tool_name: "set_device_state", scope: "lock", risk: "confirm" },
];

/** set_policy can never be lowered below this; prevents an assistant from switching the guard off. */
export const SET_POLICY_MINIMUM_RISK: Risk = "confirm";

export function riskRequiresConfirmation(risk: Risk): boolean {
  return risk === "confirm" || risk === "high";
}

export function compareRisk(a: Risk, b: Risk): number {
  return RISK_LEVELS.indexOf(a) - RISK_LEVELS.indexOf(b);
}

// ---------------------------------------------------------------------------
// Environment variables and other constants (names and defaults; parsing is lib/env.ts)
// ---------------------------------------------------------------------------

export const ENV = {
  DB: "HOUSEWARDEN_DB",
  DATA_DIR: "HOUSEWARDEN_DATA_DIR",
  DATABASE_URL: "DATABASE_URL",
  PG_SSL: "HOUSEWARDEN_PG_SSL",
  TOKEN: "HOUSEWARDEN_TOKEN",
  ADMIN_SECRET: "HOUSEWARDEN_ADMIN_SECRET",
  ALLOWED_ORIGINS: "HOUSEWARDEN_ALLOWED_ORIGINS",
  CONFIRM_TTL_SECONDS: "HOUSEWARDEN_CONFIRM_TTL_SECONDS",
  MCP_APP: "HOUSEWARDEN_MCP_APP",
  PUBLIC_URL: "HOUSEWARDEN_PUBLIC_URL",
  COOKIE_SECURE: "HOUSEWARDEN_COOKIE_SECURE",
  TIMEZONE: "HOUSEWARDEN_TIMEZONE",
  CURRENCY: "HOUSEWARDEN_CURRENCY",
} as const;

export const DEFAULTS = {
  DB: "pglite" as DbKind,
  DATA_DIR: ".data/pglite",
  /** Special DATA_DIR value: an ephemeral in-memory PGlite (tests). */
  DATA_DIR_MEMORY: "memory://",
  PG_SSL: "auto" as "auto" | "require" | "disable" | "no-verify",
  ALLOWED_ORIGINS: "" as string,
  CONFIRM_TTL_SECONDS: 600,
  /** The MCP App is on unless HOUSEWARDEN_MCP_APP is 0/false/off/no (lib/mcpapp/register.ts is the reader). */
  MCP_APP: true,
  COOKIE_SECURE: false,
  TIMEZONE: "Asia/Karachi",
  CURRENCY: "PKR",
  E2E_PORT: 3123,
} as const;

export const MCP_SERVER_INFO = {
  name: "housewarden",
  title: "Housewarden",
  version: "0.1.0",
  websiteUrl: "https://github.com/buildwithabid/housewarden",
} as const;

export const MCP_ENDPOINT_PATH = "/api/mcp";
export const MCP_APP_RESOURCE_URI = "ui://housewarden/pending";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

export const CONSOLE_SESSION_COOKIE = "hw_session";
export const CONSOLE_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export const BEARER_REALM = "housewarden";

// ---------------------------------------------------------------------------
// Canonical JSON — the exact serialisation hashed into the audit chain.
// lib/audit.ts computes sha256(prev_hash + canonicalJson(rowBody)) over it.
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON:
 *  - object keys sorted by UTF-16 code unit order (JavaScript default sort)
 *  - keys whose value is undefined are dropped; undefined inside arrays becomes null
 *  - no whitespace
 *  - strings escaped exactly as JSON.stringify does
 *  - numbers as JSON.stringify emits them; NaN/Infinity throw
 *  - Date values become their toISOString() (millisecond precision, "Z")
 *  - null stays null
 * Test vectors live in docs/SPEC.md §7 and tests/core/audit.test.ts.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new HousewardenError("INTERNAL", "canonicalJson: non-finite number");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "undefined":
      throw new HousewardenError("INTERNAL", "canonicalJson: undefined is not serialisable");
    case "bigint":
    case "symbol":
    case "function":
      throw new HousewardenError("INTERNAL", `canonicalJson: unsupported type ${typeof value}`);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalJson(v === undefined ? null : v)).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(record[k])).join(",") + "}";
}

/** The body of an audit row in the exact field set that is hashed. */
export function auditRowBody(row: AuditRow | AuditRowBody): AuditRowBody {
  return {
    seq: row.seq,
    at: row.at,
    actor: row.actor,
    event: row.event,
    tool: row.tool,
    action_id: row.action_id,
    input: row.input,
    result: row.result,
    prev_hash: row.prev_hash,
  };
}
