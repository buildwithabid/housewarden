/**
 * Spoken-line helpers for the read tools (docs/TOOLS.md, "Spoken-line rules").
 * One or two sentences, present tense, no ids, no hashes, no JSON. Money is
 * read with the currency name, dates relatively when close.
 */
import type { Actor } from "@/lib/contracts";
import { spokenAmount, toMinor } from "@/lib/money";
import { numberWord } from "@/lib/time";
import { lowerFirst, plural, upperFirst } from "@/lib/domain";

/** "no bills", "one bill", "four bills", "14 bills". */
export function countOf(n: number, singular: string, pluralForm?: string): string {
  if (n === 0) return `no ${plural(0, singular, pluralForm)}`;
  return `${numberWord(n)} ${plural(n, singular, pluralForm)}`;
}

/** "is" / "are" agreeing with a count. */
export function isAre(n: number): string {
  return n === 1 ? "is" : "are";
}

/** Capitalises the first letter and closes the sentence with a full stop. */
export function sentence(text: string): string {
  const t = upperFirst(text.trim());
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** "3,000 rupees" from a major-unit amount. */
export function spokenMoney(amount: number, currency: string): string {
  return spokenAmount(toMinor(amount), currency);
}

/** "eight minutes", "45 seconds", "two hours" — time until an instant. */
export function spokenTimeLeft(until: Date | string, now: Date): string {
  const seconds = Math.max(0, Math.round((new Date(until).getTime() - now.getTime()) / 1000));
  if (seconds < 90) return `${numberWord(seconds)} ${plural(seconds, "second")}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${numberWord(minutes)} ${plural(minutes, "minute")}`;
  const hours = Math.round(minutes / 60);
  return `${numberWord(hours)} ${plural(hours, "hour")}`;
}

/** "by the assistant", "from the console", "by demo data". */
export function spokenActor(actor: Actor): string {
  switch (actor.kind) {
    case "assistant":
      return "by the assistant";
    case "console":
      return "from the console";
    default:
      return `by ${lowerFirst(actor.label)}`;
  }
}

/** Keeps a spoken list short: the first `max` items, then "and N more". */
export function truncateList(items: readonly string[], max: number): string[] {
  if (items.length <= max) return [...items];
  const rest = items.length - max;
  return [...items.slice(0, max), `${numberWord(rest)} more`];
}
