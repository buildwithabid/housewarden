/**
 * Turns a guard `Change` into the three-column diff line the confirmation
 * card renders: entity · label · what changes. Values are formatted for a
 * person (dates in the household zone, booleans as yes/no, money as-is).
 */
import type { Change } from "@/lib/contracts";
import { fmtClock, fmtDateShort, dateOf } from "./format";

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface DiffPart {
  key: string;
  before: string | null;
  after: string | null;
}

export interface DiffView {
  entity: string;
  label: string;
  op: Change["op"];
  /** "new", "removed" or the per-field arrows. */
  parts: DiffPart[];
  /** The planner's own one-line description, for tooltips and screen readers. */
  line: string;
}

export function fmtValue(value: unknown, timeZone: string): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  if (typeof value === "string") {
    if (ISO_INSTANT.test(value)) {
      try {
        return `${fmtDateShort(dateOf(value, timeZone))} ${fmtClock(value, timeZone)}`;
      } catch {
        return value;
      }
    }
    if (ISO_DATE.test(value)) {
      try {
        return fmtDateShort(value);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => fmtValue(v, timeZone)).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k} ${fmtValue(v, timeZone)}`)
      .join(", ");
  }
  return String(value);
}

export function describeChange(change: Change, timeZone: string): DiffView {
  const before = change.before ?? {};
  const after = change.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const parts: DiffPart[] = keys.map((key) => ({
    key,
    before: key in before ? fmtValue(before[key], timeZone) : null,
    after: key in after ? fmtValue(after[key], timeZone) : null,
  }));
  return { entity: change.entity.replace("_", " "), label: change.label, op: change.op, parts, line: change.line };
}
