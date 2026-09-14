/**
 * Origin allow-list (docs/SPEC.md §8, step 2). Full origins are compared —
 * scheme and host case-insensitively, port exactly — after normalising both
 * sides through the URL parser, so `https://Console.Example.com:443` and
 * `https://console.example.com` are the same origin. An absent Origin header
 * is allowed (non-browser clients); a present one must be on the list.
 */

/** The canonical origin of a value, or null when it is not a valid origin (including the opaque "null"). */
export function normaliseOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.origin === "null") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isOriginAllowed(origin: string | null, allowed: readonly string[]): boolean {
  if (origin === null) return true;
  const presented = normaliseOrigin(origin);
  if (presented === null) return false;
  return allowed.some((entry) => normaliseOrigin(entry) === presented);
}
