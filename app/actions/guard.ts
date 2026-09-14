"use server";

import { redirect } from "next/navigation";
import { verifyAuditChain } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { doneMessage, errorMessage, notDoneMessage, returnPath, runConsoleTool, str } from "@/lib/console/outcome";
import { requireConsoleSession } from "@/lib/console/session";
import { flashUrl } from "@/lib/console/url";
import { fmtInstantLong, plural } from "@/lib/console/format";
import { getHousehold } from "@/lib/domain";
import { env } from "@/lib/env";

/** Approve: the console is the approver, so this is the path that executes confirm/high actions. */
export async function approveAction(fd: FormData): Promise<void> {
  const returnTo = returnPath(fd, "/pending");
  const outcome = await runConsoleTool("confirm_action", { action_id: str(fd, "action_id") });
  if (outcome.ok) redirect(flashUrl(returnTo, doneMessage(outcome.output, outcome.spoken), "accent"));
  redirect(flashUrl(returnTo, errorMessage(outcome), "danger"));
}

export async function rejectPending(fd: FormData): Promise<void> {
  const returnTo = returnPath(fd, "/pending");
  const reason = str(fd, "reason");
  const outcome = await runConsoleTool("reject_action", { action_id: str(fd, "action_id"), ...(reason ? { reason } : {}) });
  if (outcome.ok) redirect(flashUrl(returnTo, notDoneMessage(outcome.output, outcome.spoken), "neutral"));
  redirect(flashUrl(returnTo, errorMessage(outcome), "danger"));
}

/** /audit "Verify chain": recomputes every hash directly, not through a tool. */
export async function verifyAudit(): Promise<void> {
  await requireConsoleSession();
  const db = await getDb();
  const household = await getHousehold(db);
  const timeZone = household?.timezone ?? env().timezone;
  const result = await verifyAuditChain(db);
  const checked = fmtInstantLong(result.checked_at, timeZone);
  if (result.intact) {
    redirect(flashUrl("/audit", `Chain intact · ${plural(result.rows, "row")} · checked ${checked}`, "accent"));
  }
  redirect(flashUrl("/audit", `Chain broken at #${result.first_bad_seq} (${result.reason?.replace("_", " ")}) · checked ${checked}`, "danger"));
}
