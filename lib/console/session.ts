/**
 * Console session (docs/SPEC.md §8). Every (console) page, layout and server
 * action calls requireConsoleSession() first. The proxy does the same check
 * before the request reaches the app; this is the check that cannot be
 * bypassed by calling a server action directly.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CONSOLE_SESSION_COOKIE, CONSOLE_SESSION_MAX_AGE_SECONDS } from "@/lib/contracts";
import { env } from "@/lib/env";
import { adminSecretUsable, constantTimeEqual, cookieMatchesSecret, sessionToken } from "./session-core";
import { safeNext } from "./url";

/** Whether HOUSEWARDEN_ADMIN_SECRET is set and usable; the login form refuses otherwise. */
export function consoleConfigured(): boolean {
  return adminSecretUsable(env().adminSecret);
}

export async function hasConsoleSession(): Promise<boolean> {
  const store = await cookies();
  return cookieMatchesSecret(store.get(CONSOLE_SESSION_COOKIE)?.value, env().adminSecret);
}

/** Redirects to /login (remembering where the person was going) unless signed in. */
export async function requireConsoleSession(next?: string): Promise<void> {
  if (await hasConsoleSession()) return;
  const target = safeNext(next);
  redirect(target === "/" ? "/login" : `/login?next=${encodeURIComponent(target)}`);
}

/** Constant-time check of a presented secret against HOUSEWARDEN_ADMIN_SECRET. */
export function secretMatches(presented: string): boolean {
  const secret = env().adminSecret;
  if (!adminSecretUsable(secret)) return false;
  return constantTimeEqual(presented, secret);
}

export async function startConsoleSession(): Promise<void> {
  const secret = env().adminSecret;
  if (!adminSecretUsable(secret)) throw new Error("The console is not configured");
  const store = await cookies();
  store.set(CONSOLE_SESSION_COOKIE, sessionToken(secret), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: env().cookieSecure,
    maxAge: CONSOLE_SESSION_MAX_AGE_SECONDS,
  });
}

export async function endConsoleSession(): Promise<void> {
  const store = await cookies();
  store.set(CONSOLE_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: env().cookieSecure,
    maxAge: 0,
  });
}
