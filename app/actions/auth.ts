"use server";

import { redirect } from "next/navigation";
import { failure, str, type ActionState } from "@/lib/console/outcome";
import { consoleConfigured, endConsoleSession, secretMatches, startConsoleSession } from "@/lib/console/session";
import { safeNext } from "@/lib/console/url";

const NOT_CONFIGURED = "The console isn’t configured yet. Set HOUSEWARDEN_ADMIN_SECRET (8 or more characters) and restart the server.";
const NO_MATCH = "That secret didn’t match. Try again.";

/** /login: constant-time check against HOUSEWARDEN_ADMIN_SECRET; one neutral message on failure. */
export async function login(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const next = safeNext(str(fd, "next"));
  if (!consoleConfigured()) return failure(NOT_CONFIGURED);
  const secret = fd.get("secret");
  if (typeof secret !== "string" || secret.length === 0 || !secretMatches(secret)) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return failure(NO_MATCH);
  }
  await startConsoleSession();
  redirect(next);
}

export async function logout(): Promise<void> {
  await endConsoleSession();
  redirect("/login");
}
