/**
 * Formatters for the console (docs/DESIGN.md §5): thousands separators,
 * currency code after the number, `30 Sep` in lists, `30 September 2026` in
 * detail, relative time only within seven days.
 */
import {
  TOOL_CATALOGUE,
  type Actor,
  type AuditEvent,
  type BillStatus,
  type PendingStatus,
  type Risk,
} from "@/lib/contracts";
import { formatAmount, toMinor } from "@/lib/money";
import { daysBetween, splitDate, todayInZone, zonedParts, zonedTimeToInstant } from "@/lib/time";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "3,000 PKR" from major units. */
export function fmtMoney(amount: number, currency: string): string {
  return formatAmount(toMinor(amount), currency);
}

/** "30 Sep" (with the year when it differs from today's). */
export function fmtDateShort(date: string, today?: string): string {
  const [y, m, d] = splitDate(date);
  const sameYear = today ? splitDate(today)[0] === y : true;
  return `${d} ${MONTH_SHORT[m - 1]}${sameYear ? "" : ` ${y}`}`;
}

/** "30 September 2026". */
export function fmtDateLong(date: string): string {
  const [y, m, d] = splitDate(date);
  return `${d} ${MONTH_LONG[m - 1]} ${y}`;
}

/** "today", "tomorrow", "in 3 days", "5 days ago", otherwise "30 Sep". */
export function fmtDateRelative(date: string, today: string): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 1 && diff <= 7) return `in ${diff} days`;
  if (diff < -1 && diff >= -7) return `${-diff} days ago`;
  return fmtDateShort(date, today);
}

/** Relative wording plus the calendar date when they differ: "in 4 days · 18 Sep". */
export function fmtDue(date: string, today: string): string {
  const rel = fmtDateRelative(date, today);
  const short = fmtDateShort(date, today);
  return rel === short ? short : `${rel} · ${short}`;
}

/** "10:00" wall-clock time in the household zone. */
export function fmtClock(iso: string, timeZone: string): string {
  const p = zonedParts(new Date(iso), timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** The calendar date of an instant in the household zone. */
export function dateOf(iso: string, timeZone: string): string {
  return todayInZone(new Date(iso), timeZone);
}

/** "tomorrow, 10:00" / "30 Sep, 10:00". */
export function fmtInstant(iso: string, timeZone: string, today: string): string {
  return `${fmtDateRelative(dateOf(iso, timeZone), today)}, ${fmtClock(iso, timeZone)}`;
}

/** "30 September 2026, 10:00". */
export function fmtInstantLong(iso: string, timeZone: string): string {
  return `${fmtDateLong(dateOf(iso, timeZone))}, ${fmtClock(iso, timeZone)}`;
}

/** "just now", "2 min ago", "in 8 min", "3 h ago", "2 days ago"; beyond a week the short date. */
export function fmtAgo(iso: string, now: Date, timeZone: string, today: string): string {
  const diffMs = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const future = diffMs > 0;
  const wrap = (s: string) => (future ? `in ${s}` : `${s} ago`);
  if (abs < 45_000) return "just now";
  if (abs < 3_600_000) return wrap(`${Math.max(1, Math.round(abs / 60_000))} min`);
  if (abs < 86_400_000) return wrap(`${Math.round(abs / 3_600_000)} h`);
  if (abs < 7 * 86_400_000) {
    const days = Math.round(abs / 86_400_000);
    return wrap(`${days} ${days === 1 ? "day" : "days"}`);
  }
  return fmtInstant(iso, timeZone, today);
}

/** "mm:ss" for a countdown. */
export function fmtCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** First ten characters of a hash, for tables. */
export function fmtHash(hash: string): string {
  return hash.slice(0, 10);
}

/** "2026-09-15T09:00" for a datetime-local input, in the household zone. */
export function datetimeLocalValue(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Parses a datetime-local value ("YYYY-MM-DDTHH:MM[:SS]") as wall-clock time in the zone. */
export function instantFromDatetimeLocal(value: string, timeZone: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  try {
    const at = zonedTimeToInstant(m[1], m[2], timeZone);
    return Number.isNaN(at.getTime()) ? null : at;
  } catch {
    return null;
  }
}

export function toolTitle(name: string): string {
  return TOOL_CATALOGUE.find((t) => t.name === name)?.title ?? name;
}

export function actorLabel(actor: Actor): string {
  return actor.label;
}

/** "Assistant · for Abid" when the member is known. */
export function actorWithMember(actor: Actor, memberName: string | null): string {
  return memberName ? `${actor.label} · for ${memberName}` : actor.label;
}

export type ChipTone = "neutral" | "info" | "accent" | "warn" | "danger" | "danger-muted";

/** Risk chips: read → neutral, low → info, confirm → warn, high → danger (DESIGN.md §1). */
export function riskTone(risk: Risk): ChipTone {
  switch (risk) {
    case "read":
      return "neutral";
    case "low":
      return "info";
    case "confirm":
      return "warn";
    case "high":
      return "danger";
  }
}

export function riskLabel(risk: Risk): string {
  switch (risk) {
    case "read":
      return "read";
    case "low":
      return "low risk";
    case "confirm":
      return "confirm";
    case "high":
      return "high risk";
  }
}

export function pendingStatusTone(status: PendingStatus): ChipTone {
  switch (status) {
    case "executed":
      return "accent";
    case "pending":
    case "confirmed":
      return "warn";
    case "failed":
      return "danger";
    case "rejected":
    case "expired":
      return "danger-muted";
  }
}

export function auditEventTone(event: AuditEvent): ChipTone {
  switch (event) {
    case "executed":
      return "accent";
    case "proposed":
      return "warn";
    case "failed":
      return "danger";
    case "rejected":
    case "expired":
      return "danger-muted";
    case "seeded":
      return "info";
  }
}

/** Bill chips: paid → accent, overdue → danger, due within three days → warn, else neutral. */
export function billTone(status: BillStatus, daysUntilDue: number | null): ChipTone {
  if (status === "paid") return "accent";
  if (status === "overdue") return "danger";
  if (daysUntilDue !== null && daysUntilDue <= 3) return "warn";
  return "neutral";
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function capitalize(text: string): string {
  return text.length ? text[0].toUpperCase() + text.slice(1) : text;
}

export function reminderTone(status: "scheduled" | "done" | "cancelled"): ChipTone {
  switch (status) {
    case "scheduled":
      return "info";
    case "done":
      return "accent";
    case "cancelled":
      return "danger-muted";
  }
}
