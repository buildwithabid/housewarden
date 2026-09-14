/**
 * Calendar and clock helpers. No timezone library: zone maths uses
 * Intl.DateTimeFormat parts, per docs/SPEC.md §6.
 *
 * Conventions: a "date" is a YYYY-MM-DD string in the household timezone; an
 * "instant" is a Date. `now` is always passed in (ToolContext.now), never read
 * from the clock here, so previews and audit rows agree.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant in a zone. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const out: Partial<ZonedParts> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) {
    if (p.type === "year") out.year = Number(p.value);
    else if (p.type === "month") out.month = Number(p.value);
    else if (p.type === "day") out.day = Number(p.value);
    else if (p.type === "hour") out.hour = Number(p.value) % 24;
    else if (p.type === "minute") out.minute = Number(p.value);
    else if (p.type === "second") out.second = Number(p.value);
  }
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function formatDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** The calendar date of an instant in a zone. */
export function todayInZone(now: Date, timeZone: string): string {
  const p = zonedParts(now, timeZone);
  return formatDate(p.year, p.month, p.day);
}

/** Zone offset (zone wall clock minus UTC) in milliseconds at an instant. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which a zone's wall clock reads `date` `time` (HH:MM or HH:MM:SS). */
export function zonedTimeToInstant(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = splitDate(date);
  const [hh, mm, ss] = time.split(":").map((s) => Number(s));
  const naive = Date.UTC(y, m - 1, d, hh ?? 0, mm ?? 0, ss ?? 0);
  let guess = naive - offsetMs(new Date(naive), timeZone);
  // A second pass corrects guesses that straddle a DST transition.
  guess = naive - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** Start of a calendar date (00:00 wall clock) as an instant. */
export function startOfDayInZone(date: string, timeZone: string): Date {
  return zonedTimeToInstant(date, "00:00", timeZone);
}

export function splitDate(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Not a YYYY-MM-DD date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function isValidDate(date: string): boolean {
  try {
    const [y, m, d] = splitDate(date);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  } catch {
    return false;
  }
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = splitDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return formatDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Adds calendar months, clamping the day to the target month's length (31 Jan + 1 → 28/29 Feb), as Postgres does. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = splitDate(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return formatDate(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addYears(date: string, years: number): string {
  return addMonths(date, years * 12);
}

/** `to` minus `from` in whole days. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = splitDate(from);
  const [ty, tm, td] = splitDate(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** YYYY-MM of a date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

export function previousMonth(month: string): string {
  return monthOf(addMonths(`${month}-01`, -1));
}

/** Half-open instant range [start, end) covering a YYYY-MM month in a zone. */
export function monthRange(month: string, timeZone: string): { start: Date; end: Date } {
  const first = `${month}-01`;
  return {
    start: startOfDayInZone(first, timeZone),
    end: startOfDayInZone(addMonths(first, 1), timeZone),
  };
}

const MONTH_NAMES = [
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

export function monthName(month: string): string {
  const idx = Number(month.slice(5, 7)) - 1;
  return MONTH_NAMES[idx] ?? month;
}

const SMALL_NUMBERS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/** "four" for small counts, digits otherwise — reads naturally when spoken. */
export function numberWord(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < SMALL_NUMBERS.length ? SMALL_NUMBERS[n] : String(n);
}

/** "today", "tomorrow", "yesterday", "in four days", "five days ago", "on 30 October". */
export function spokenDate(date: string, today: string): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 1 && diff <= 7) return `in ${numberWord(diff)} days`;
  if (diff < -1 && diff >= -7) return `${numberWord(-diff)} days ago`;
  const [y, m, d] = splitDate(date);
  const [ty] = splitDate(today);
  return `on ${d} ${MONTH_NAMES[m - 1]}${y === ty ? "" : ` ${y}`}`;
}

/** "10", "10:30", "9:05" — hour in the zone, minutes only when non-zero. */
export function spokenClock(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return p.minute === 0 ? String(p.hour) : `${p.hour}:${pad(p.minute)}`;
}

/** "tomorrow at 10", "today at 22:30", "on 6 October at 9". */
export function spokenInstant(instant: Date, timeZone: string, now: Date): string {
  const date = todayInZone(instant, timeZone);
  const today = todayInZone(now, timeZone);
  return `${spokenDate(date, today)} at ${spokenClock(instant, timeZone)}`;
}
