/**
 * Page-level helpers: reading the query string every console page understands
 * (`flash`, `tone`, `confirm`, plus per-page params) and loading the pending
 * action a `?confirm=<id>` points at so the page can render its card.
 */
import type { Member, PendingAction, Queryable } from "@/lib/contracts";
import { getPendingAction, isUuid } from "@/lib/domain";
import { isFlashTone, type FlashTone } from "./url";

export type SearchParams = Record<string, string | string[] | undefined>;

export interface PageQuery {
  flash: string | undefined;
  tone: FlashTone | undefined;
  confirm: string | undefined;
  /** First value of any other parameter. */
  get(name: string): string | undefined;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function readQuery(searchParams: Promise<SearchParams> | SearchParams | undefined): Promise<PageQuery> {
  const raw = (await searchParams) ?? {};
  const tone = first(raw.tone);
  return {
    flash: first(raw.flash),
    tone: isFlashTone(tone) ? tone : undefined,
    confirm: first(raw.confirm),
    get: (name) => first(raw[name]),
  };
}

/** The action behind `?confirm=<id>`, or null when the id is missing, malformed or unknown. */
export async function loadConfirm(db: Queryable, id: string | undefined, now: Date): Promise<PendingAction | null> {
  if (!id || !isUuid(id)) return null;
  return getPendingAction(db, id, now);
}

export function memberNames(members: readonly Member[]): Map<string, string> {
  return new Map(members.map((m) => [m.id, m.name]));
}

/** Resolves the member an actor acted for, by id, to a display name. */
export function memberNameOf(id: string | null | undefined, names: Map<string, string>): string | null {
  if (!id) return null;
  return names.get(id) ?? null;
}
