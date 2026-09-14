/**
 * Helpers shared by the domain modules: reference matching, spoken-list
 * joining, small formatting utilities.
 */
import { HousewardenError, type EntityKind } from "@/lib/contracts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function lowerFirst(text: string): string {
  return text.length ? text[0].toLowerCase() + text.slice(1) : text;
}

export function upperFirst(text: string): string {
  return text.length ? text[0].toUpperCase() + text.slice(1) : text;
}

/** "a", "a and b", "a, b and c". */
export function joinSpoken(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return n === 1 ? singular : pluralForm;
}

export interface RefMatchOptions<T> {
  entity: EntityKind;
  label: (row: T) => string;
  /** Message when nothing matches; receives the (trimmed) reference. */
  notFound: (ref: string) => string;
  /** When several rows match by label, narrow to these before reporting AMBIGUOUS_REF. */
  prefer?: (row: T) => boolean;
}

/**
 * Resolves a free-form reference (uuid or case-insensitive exact label) to one
 * row. Throws NOT_FOUND {entity, ref} or AMBIGUOUS_REF {entity, candidates}.
 */
export function matchRef<T extends { id: string }>(rows: readonly T[], ref: string, options: RefMatchOptions<T>): T {
  const needle = ref.trim();
  if (isUuid(needle)) {
    const byId = rows.find((r) => r.id.toLowerCase() === needle.toLowerCase());
    if (byId) return byId;
    throw new HousewardenError("NOT_FOUND", options.notFound(needle), { entity: options.entity, ref: needle });
  }
  const lower = needle.toLowerCase();
  let candidates = rows.filter((r) => options.label(r).trim().toLowerCase() === lower);
  if (candidates.length > 1 && options.prefer) {
    const preferred = candidates.filter(options.prefer);
    if (preferred.length === 1) candidates = preferred;
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new HousewardenError("NOT_FOUND", options.notFound(needle), { entity: options.entity, ref: needle });
  }
  throw new HousewardenError("AMBIGUOUS_REF", `More than one ${options.entity.replace("_", " ")} is called ${needle}. Use the id instead.`, {
    entity: options.entity,
    ref: needle,
    candidates: candidates.map((r) => ({ id: r.id, label: options.label(r) })),
  });
}

/** Deep-equal for plain JSON values (used to detect no-op patches). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as Record<string, unknown>).sort();
    const kb = Object.keys(b as Record<string, unknown>).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) => jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}
