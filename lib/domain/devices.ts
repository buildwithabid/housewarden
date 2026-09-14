import { z } from "zod";
import {
  DEVICE_STATE_SCHEMAS,
  DeviceSchema,
  EntityRefSchema,
  HousewardenError,
  MutatingInputBaseSchema,
  ROUTINE_STEP_TOOLS,
  RoutineSchema,
  RoutineStepSchema,
  type Change,
  type Device,
  type DeviceKind,
  type DeviceState,
  type Member,
  type MutationPlan,
  type Queryable,
  type Routine,
  type RoutineStep,
  type ToolContext,
  type ToolRun,
} from "@/lib/contracts";
import { addDays, spokenClock, todayInZone, zonedTimeToInstant } from "@/lib/time";
import { findMember } from "./members";
import { resolvePolicy } from "./policies";
import { AddReminderInputSchema, planAddReminder } from "./reminders";
import { joinSpoken, jsonEqual, matchRef, plural } from "./shared";
import { CheckOffShoppingItemInputSchema, planCheckOffShoppingItem } from "./shopping";

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

interface DeviceRow extends Record<string, unknown> {
  id: string;
  name: string;
  kind: DeviceKind;
  state: DeviceState;
  updated_at: Date;
}

const DEVICE_COLUMNS = "id, name, kind, state, updated_at";

function rowToDevice(row: DeviceRow): Device {
  return { id: row.id, name: row.name, kind: row.kind, state: row.state, updated_at: row.updated_at.toISOString() };
}

export async function listDevices(db: Queryable, householdId: string): Promise<Device[]> {
  const res = await db.query<DeviceRow>(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE household_id = $1 ORDER BY created_at, name`, [householdId]);
  return res.rows.map(rowToDevice);
}

export async function getDeviceById(db: Queryable, householdId: string, id: string): Promise<Device | null> {
  const res = await db.query<DeviceRow>(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE household_id = $1 AND id = $2::uuid`, [householdId, id]);
  return res.rows[0] ? rowToDevice(res.rows[0]) : null;
}

export async function findDevice(db: Queryable, householdId: string, ref: string): Promise<Device> {
  const devices = await listDevices(db, householdId);
  return matchRef(devices, ref, {
    entity: "device",
    label: (d) => d.name,
    notFound: (r) =>
      devices.length
        ? `I couldn't find a device called ${r}. The devices are ${joinSpoken(devices.map((d) => d.name))}.`
        : `I couldn't find a device called ${r}; no devices are set up.`,
  });
}

/** Validates a full state object for a device kind. Throws UNSUPPORTED_STATE. */
export function validateDeviceState(kind: DeviceKind, state: unknown, deviceName: string): DeviceState {
  const parsed = DEVICE_STATE_SCHEMAS[kind].safeParse(state);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "state"}: ${i.message}`).join("; ");
    throw new HousewardenError("UNSUPPORTED_STATE", `That state does not fit a ${kind} like '${deviceName}' (${problems}).`, {
      kind,
      issues: parsed.error.issues.map((i) => ({ path: i.path.map(String), message: i.message })),
    });
  }
  return parsed.data as DeviceState;
}

export interface NewDevice {
  name: string;
  kind: DeviceKind;
  state: DeviceState;
  /** Explicit creation instant, for seeds that insert several devices in one transaction. */
  created_at?: Date;
}

export async function insertDevice(tx: Queryable, householdId: string, input: NewDevice): Promise<Device> {
  const state = validateDeviceState(input.kind, input.state, input.name);
  const res = await tx.query<DeviceRow>(
    `INSERT INTO devices (household_id, name, kind, state, created_at)
     VALUES ($1::uuid, $2, $3, $4::jsonb, coalesce($5::timestamptz, now())) RETURNING ${DEVICE_COLUMNS}`,
    [householdId, input.name, input.kind, state, input.created_at ?? null],
  );
  return rowToDevice(res.rows[0]);
}

function describeStateValue(kind: DeviceKind, key: string, value: unknown): string {
  if (kind === "lock" && key === "locked") return value ? "locked" : "unlocked";
  if ((kind === "light" || kind === "plug") && key === "on") return value ? "on" : "off";
  if (key === "target_c") return `${String(value)}°C`;
  if (key === "brightness") return `${String(value)}%`;
  return String(value);
}

function spokenDeviceState(device: { name: string; kind: DeviceKind }, patch: Record<string, unknown>, merged: DeviceState): string {
  const name = device.name.toLowerCase();
  switch (device.kind) {
    case "lock":
      return merged.locked ? `lock the ${name}` : `unlock the ${name}`;
    case "thermostat": {
      const parts: string[] = [];
      if ("mode" in patch) parts.push(merged.mode === "off" ? "off" : `to ${String(merged.mode)}`);
      if ("target_c" in patch) parts.push(`${"mode" in patch ? "at " : "to "}${String(merged.target_c)} degrees`);
      return `set the ${name} ${parts.join(" ")}`;
    }
    case "light": {
      if ("on" in patch && !merged.on) return `turn the ${name} off`;
      const bright = "brightness" in patch ? ` at ${String(merged.brightness)}%` : "";
      return `turn the ${name} on${bright}`;
    }
    case "plug":
      return merged.on ? `turn the ${name} on` : `turn the ${name} off`;
  }
}

export const SetDeviceStateInputSchema = MutatingInputBaseSchema.extend({
  device: EntityRefSchema.describe("The device's name or id."),
  state: z.record(z.string(), z.unknown()).describe("Fields to change, merged into the current state: lock {locked}, thermostat {mode, target_c}, light {on, brightness}, plug {on}."),
});
export type SetDeviceStateInput = z.output<typeof SetDeviceStateInputSchema>;
export const SetDeviceStateResultSchema = z.object({ device: DeviceSchema });
export type SetDeviceStateResult = z.output<typeof SetDeviceStateResultSchema>;

export async function planSetDeviceState(input: SetDeviceStateInput, ctx: ToolContext): Promise<MutationPlan<SetDeviceStateResult>> {
  const device = await findDevice(ctx.db, ctx.household.id, input.device);
  const merged = validateDeviceState(device.kind, { ...device.state, ...input.state }, device.name);
  const changedKeys = Object.keys(input.state).filter((k) => !jsonEqual(device.state[k], merged[k]));
  if (changedKeys.length === 0) {
    const current = device.kind === "lock" ? (device.state.locked ? "locked" : "unlocked") : "already in that state";
    throw new HousewardenError("ALREADY_DONE", `${device.name} is ${current}.`, { entity: "device", id: device.id, state: device.state });
  }
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of changedKeys) {
    before[k] = device.state[k] ?? null;
    after[k] = merged[k];
  }
  const diff = changedKeys
    .map((k) => `${device.kind === "lock" || (device.kind !== "thermostat" && k === "on") ? "" : `${k} `}${describeStateValue(device.kind, k, device.state[k])} → ${describeStateValue(device.kind, k, merged[k])}`)
    .join(", ");
  const clause = spokenDeviceState(device, after, merged);
  const summary = clause[0].toUpperCase() + clause.slice(1).replace(`the ${device.name.toLowerCase()}`, `'${device.name}'`);

  const warnings: string[] = [];
  const member: Member | null = input.member ? await findMember(ctx.db, ctx.household.id, input.member) : null;
  if (member?.role === "child" && device.kind === "lock" && merged.locked === false) {
    const policy = await resolvePolicy(ctx.db, ctx.household.id, "set_device_state", device.kind, member.id);
    warnings.push(
      policy.risk === "high"
        ? `${member.name} is a child; unlocking needs a person to approve it in the console.`
        : `${member.name} is a child and asked to unlock the door.`,
    );
  }
  const forMember = member ? ` for ${member.name}` : "";
  return {
    preview: {
      summary,
      changes: [
        {
          entity: "device",
          id: device.id,
          op: "update",
          label: device.name,
          before,
          after,
          line: `device '${device.name}' (${device.kind}): ${diff}`,
        },
      ],
      warnings,
    },
    spoken: `${clause}${forMember}`,
    policyScope: device.kind,
    async execute(tx) {
      const res = await tx.query<DeviceRow>(`UPDATE devices SET state = $2::jsonb WHERE id = $1::uuid RETURNING ${DEVICE_COLUMNS}`, [
        device.id,
        merged,
      ]);
      const updated = rowToDevice(res.rows[0]);
      const spoken = spokenExecutedDevice(updated, after);
      return { output: { device: updated }, spoken };
    },
  };
}

function spokenExecutedDevice(device: Device, patch: Record<string, unknown>): string {
  const s = device.state;
  switch (device.kind) {
    case "lock":
      return `${device.name} ${s.locked ? "locked" : "unlocked"}.`;
    case "thermostat": {
      const mode = "mode" in patch ? (s.mode === "off" ? "off" : `${String(s.mode)}, `) : "";
      if (s.mode === "off" && "mode" in patch) return `${device.name} turned off.`;
      return `${device.name} set to ${mode}${String(s.target_c)} degrees.`;
    }
    case "light":
      return s.on ? `${device.name} on${"brightness" in patch ? ` at ${String(s.brightness)}%` : ""}.` : `${device.name} off.`;
    case "plug":
      return `${device.name} ${s.on ? "on" : "off"}.`;
  }
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

interface RoutineRow extends Record<string, unknown> {
  id: string;
  name: string;
  steps: RoutineStep[];
}

function rowToRoutine(row: RoutineRow): Routine {
  return { id: row.id, name: row.name, steps: row.steps };
}

export async function listRoutines(db: Queryable, householdId: string): Promise<Routine[]> {
  const res = await db.query<RoutineRow>(`SELECT id, name, steps FROM routines WHERE household_id = $1 ORDER BY created_at, name`, [householdId]);
  return res.rows.map(rowToRoutine);
}

export async function findRoutine(db: Queryable, householdId: string, ref: string): Promise<Routine> {
  const routines = await listRoutines(db, householdId);
  return matchRef(routines, ref, {
    entity: "routine",
    label: (r) => r.name,
    notFound: (r) =>
      routines.length
        ? `I couldn't find a routine called ${r}. The routines are ${joinSpoken(routines.map((x) => x.name))}.`
        : `I couldn't find a routine called ${r}; no routines are set up.`,
  });
}

export interface NewRoutine {
  name: string;
  steps: RoutineStep[];
}

export async function insertRoutine(tx: Queryable, householdId: string, input: NewRoutine): Promise<Routine> {
  const steps = z.array(RoutineStepSchema).parse(input.steps);
  const res = await tx.query<RoutineRow>(
    `INSERT INTO routines (household_id, name, steps) VALUES ($1::uuid, $2, $3::jsonb) RETURNING id, name, steps`,
    [householdId, input.name, steps],
  );
  return rowToRoutine(res.rows[0]);
}

export const RunRoutineInputSchema = MutatingInputBaseSchema.extend({
  routine: EntityRefSchema.describe("The routine's name or id."),
});
export type RunRoutineInput = z.output<typeof RunRoutineInputSchema>;
export const RunRoutineStepResultSchema = z.object({
  tool: z.enum(ROUTINE_STEP_TOOLS),
  summary: z.string(),
  result: z.record(z.string(), z.unknown()).nullable(),
});
export const RunRoutineResultSchema = z.object({ routine: RoutineSchema, steps: z.array(RunRoutineStepResultSchema) });
export type RunRoutineResult = z.output<typeof RunRoutineResultSchema>;

interface PlannedStep {
  tool: RoutineStep["tool"];
  summary: string;
  spoken: string;
  changes: Change[];
  warnings: string[];
  /** null when the step is already satisfied (no-op). */
  execute: ((tx: Queryable, ctx: ToolContext) => Promise<ToolRun<unknown>>) | null;
}

const RELATIVE_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "22:30" in a routine step → the next occurrence of that wall-clock time in the household zone. */
function resolveStepInstant(value: unknown, ctx: ToolContext): { at: string; rolled: boolean } | null {
  if (typeof value !== "string") return null;
  if (!RELATIVE_TIME.test(value)) return { at: value, rolled: false };
  const today = todayInZone(ctx.now, ctx.household.timezone);
  let at = zonedTimeToInstant(today, value, ctx.household.timezone);
  let rolled = false;
  if (at.getTime() <= ctx.now.getTime()) {
    at = zonedTimeToInstant(addDays(today, 1), value, ctx.household.timezone);
    rolled = true;
  }
  return { at: at.toISOString(), rolled };
}

function stepInvalid(index: number, step: RoutineStep, cause: unknown): HousewardenError {
  const message = cause instanceof Error ? cause.message : String(cause);
  const code = cause instanceof HousewardenError ? cause.code : "INTERNAL";
  return new HousewardenError("ROUTINE_STEP_INVALID", `Step ${index + 1} (${step.tool}) cannot run: ${message}`, {
    step: index + 1,
    tool: step.tool,
    code,
  });
}

async function planStep(index: number, step: RoutineStep, ctx: ToolContext): Promise<PlannedStep> {
  try {
    switch (step.tool) {
      case "set_device_state": {
        const input = SetDeviceStateInputSchema.parse(step.input);
        try {
          const plan = await planSetDeviceState(input, ctx);
          return { tool: step.tool, summary: plan.preview.summary, spoken: plan.spoken, changes: plan.preview.changes, warnings: plan.preview.warnings, execute: plan.execute };
        } catch (err) {
          if (err instanceof HousewardenError && err.code === "ALREADY_DONE") {
            const device = await findDevice(ctx.db, ctx.household.id, input.device);
            const desired = { ...device.state, ...input.state };
            const line = Object.keys(input.state)
              .map((k) => `${describeStateValue(device.kind, k, device.state[k])} → ${describeStateValue(device.kind, k, desired[k])}`)
              .join(", ");
            return {
              tool: step.tool,
              summary: `'${device.name}' is already ${line.split(" → ")[1] ?? "in that state"} (no change)`,
              spoken: `the ${device.name.toLowerCase()} is already ${describeStateValue(device.kind, Object.keys(input.state)[0] ?? "", desired[Object.keys(input.state)[0] ?? ""])}`,
              changes: [{ entity: "device", id: device.id, op: "update", label: device.name, before: {}, after: {}, line: `device '${device.name}' (${device.kind}): ${line} (no change)` }],
              warnings: [],
              execute: null,
            };
          }
          throw err;
        }
      }
      case "add_reminder": {
        const resolved = resolveStepInstant(step.input.at, ctx);
        const input = AddReminderInputSchema.parse({ ...step.input, ...(resolved ? { at: resolved.at } : {}) });
        const plan = await planAddReminder(input, ctx);
        const warnings = [...plan.preview.warnings];
        if (resolved?.rolled) warnings.push(`The time ${String(step.input.at)} has passed today, so the reminder is set for tomorrow.`);
        const clock = spokenClock(new Date(input.at), ctx.household.timezone);
        return {
          tool: step.tool,
          summary: plan.preview.summary,
          spoken: `remind you at ${clock} to ${input.text.toLowerCase()}`,
          changes: plan.preview.changes,
          warnings,
          execute: plan.execute,
        };
      }
      case "check_off_shopping_item": {
        const input = CheckOffShoppingItemInputSchema.parse(step.input);
        try {
          const plan = await planCheckOffShoppingItem(input, ctx);
          return { tool: step.tool, summary: plan.preview.summary, spoken: plan.spoken, changes: plan.preview.changes, warnings: plan.preview.warnings, execute: plan.execute };
        } catch (err) {
          if (err instanceof HousewardenError && err.code === "ALREADY_DONE") {
            return {
              tool: step.tool,
              summary: `'${input.item}' is already checked off (no change)`,
              spoken: `${input.item.toLowerCase()} is already checked off`,
              changes: [{ entity: "shopping_item", id: typeof err.details?.id === "string" ? err.details.id : null, op: "update", label: input.item, before: {}, after: {}, line: `shopping item '${input.item}': already checked (no change)` }],
              warnings: [],
              execute: null,
            };
          }
          throw err;
        }
      }
    }
  } catch (err) {
    if (err instanceof HousewardenError && err.code === "ROUTINE_STEP_INVALID") throw err;
    throw stepInvalid(index, step, err);
  }
}

export async function planRunRoutine(input: RunRoutineInput, ctx: ToolContext): Promise<MutationPlan<RunRoutineResult>> {
  const routine = await findRoutine(ctx.db, ctx.household.id, input.routine);
  if (routine.steps.length === 0) {
    throw new HousewardenError("ALREADY_DONE", `The ${routine.name} routine has no steps.`, { entity: "routine", id: routine.id });
  }
  const planned: PlannedStep[] = [];
  for (let i = 0; i < routine.steps.length; i++) planned.push(await planStep(i, routine.steps[i], ctx));
  const active = planned.filter((s) => s.execute !== null);
  const noops = planned.filter((s) => s.execute === null);
  const spokenActive = active.map((s) => s.spoken);
  const spokenNoop = noops.map((s) => s.spoken);
  const clause =
    active.length === 0
      ? `run the ${routine.name} routine, though every step is already done (${joinSpoken(spokenNoop)})`
      : `run the ${routine.name} routine, which would ${joinSpoken(spokenActive)}${spokenNoop.length ? `; ${joinSpoken(spokenNoop)}` : ""}`;
  return {
    preview: {
      summary: `Run routine '${routine.name}' (${routine.steps.length} ${plural(routine.steps.length, "step")})`,
      changes: planned.flatMap((s) => s.changes),
      warnings: planned.flatMap((s) => s.warnings),
    },
    spoken: clause,
    policyScope: routine.name.toLowerCase(),
    async execute(tx, execCtx) {
      const steps: RunRoutineResult["steps"] = [];
      for (const step of planned) {
        if (step.execute === null) {
          steps.push({ tool: step.tool, summary: step.summary, result: null });
          continue;
        }
        const run = await step.execute(tx, execCtx);
        steps.push({ tool: step.tool, summary: step.summary, result: run.output as Record<string, unknown> });
      }
      const applied = steps.filter((s) => s.result !== null).length;
      const skipped = steps.length - applied;
      return {
        output: { routine, steps },
        spoken: `Ran the ${routine.name} routine: ${applied} ${plural(applied, "step")} applied${skipped ? `, ${skipped} already done` : ""}.`,
      };
    },
  };
}

