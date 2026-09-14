/**
 * Pure session primitives shared by the console (lib/console/session.ts) and
 * the request proxy (proxy.ts). No Next imports, so the proxy can use them.
 *
 * The cookie never carries the admin secret. It carries
 * hmac_sha256(secret, "housewarden-console-v1") in hex (docs/SPEC.md §8), so a
 * leaked cookie cannot be turned back into the secret, and rotating the secret
 * invalidates every session at once.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_MESSAGE = "housewarden-console-v1";
export const MIN_ADMIN_SECRET_LENGTH = 8;

/** The value stored in the session cookie for a given admin secret. */
export function sessionToken(secret: string): string {
  return createHmac("sha256", secret).update(SESSION_MESSAGE, "utf8").digest("hex");
}

/**
 * Constant-time string comparison. Both sides are hashed first so the buffers
 * always have equal length and the comparison leaks neither length nor prefix.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** True when HOUSEWARDEN_ADMIN_SECRET is set and long enough to protect the console. */
export function adminSecretUsable(secret: string | null | undefined): secret is string {
  return typeof secret === "string" && secret.length >= MIN_ADMIN_SECRET_LENGTH;
}

/** True when a presented cookie value is the session token for this secret. */
export function cookieMatchesSecret(cookieValue: string | undefined, secret: string | null | undefined): boolean {
  if (!cookieValue || !adminSecretUsable(secret)) return false;
  return constantTimeEqual(cookieValue, sessionToken(secret));
}
