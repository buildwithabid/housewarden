/**
 * URL helpers for the console: flash notices and confirmation cards travel in
 * the query string so that every flow works without client-side JavaScript.
 */

export type FlashTone = "accent" | "warn" | "danger" | "neutral";

export const FLASH_TONES: readonly FlashTone[] = ["accent", "warn", "danger", "neutral"];

export function isFlashTone(value: unknown): value is FlashTone {
  return typeof value === "string" && (FLASH_TONES as readonly string[]).includes(value);
}

/** Appends query parameters to a path (existing parameters are kept). */
export function withQuery(path: string, params: Record<string, string | undefined>): string {
  const [base, existing = ""] = path.split("?", 2);
  const search = new URLSearchParams(existing);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) search.delete(key);
    else search.set(key, value);
  }
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

/** The path with a flash notice, and without any stale confirm/flash parameters. */
export function flashUrl(path: string, message: string, tone: FlashTone): string {
  return withQuery(path, { confirm: undefined, flash: message, tone });
}

/** The path without notice or confirmation parameters. */
export function cleanUrl(path: string): string {
  return withQuery(path, { confirm: undefined, flash: undefined, tone: undefined });
}

/**
 * Only same-origin paths may be used as a post-login or post-action target.
 * Anything else ("//evil", "https://…", missing) becomes "/".
 */
export function safeNext(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

/** Turns page searchParams (string | string[] | undefined) into one string. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
