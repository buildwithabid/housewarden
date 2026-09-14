/**
 * The console side of the guard boundary (docs/SPEC.md §3.5, §12).
 *
 * Every server action calls runTool(..., CONSOLE_ACTOR) and turns the
 * ToolOutcome into either a redirect (success: a flash notice, or the
 * confirmation card via ?confirm=<action_id>) or an ActionState (failure,
 * shown inline next to the form with the submitted fields echoed back).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CONSOLE_ACTOR, type ToolName, type ToolOutcome } from "@/lib/contracts";
import { runTool } from "@/lib/guard";
import { type ActionState } from "./action-state";
import { requireConsoleSession } from "./session";
import { flashUrl, safeNext, withQuery } from "./url";

export { IDLE_STATE, type ActionState, type FormAction } from "./action-state";

/** A trimmed string field, or undefined when missing or blank. */
export function str(fd: FormData, name: string): string | undefined {
  const v = fd.get(name);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

/** A numeric field, or undefined when missing, blank or not a number. */
export function num(fd: FormData, name: string): number | undefined {
  const s = str(fd, name);
  if (s === undefined) return undefined;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/** A checkbox / hidden boolean field ("on", "true", "1", "yes"). */
export function bool(fd: FormData, name: string): boolean {
  const s = str(fd, name);
  return s !== undefined && ["on", "true", "1", "yes"].includes(s.toLowerCase());
}

/** All string fields of a submission (files and secrets are dropped). */
export function fieldsOf(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && k !== "secret") out[k] = v;
  return out;
}

export function failure(message: string, fd?: FormData): ActionState {
  return { ok: false, status: "error", message, fields: fd ? fieldsOf(fd) : undefined, nonce: Date.now() };
}

function previewSummary(output: unknown): string | null {
  if (output && typeof output === "object" && "preview" in output) {
    const preview = (output as { preview?: { summary?: unknown } }).preview;
    if (preview && typeof preview.summary === "string") return preview.summary;
  }
  return null;
}

function outputStatus(output: unknown): string | null {
  if (output && typeof output === "object" && "status" in output) {
    const s = (output as { status?: unknown }).status;
    return typeof s === "string" ? s : null;
  }
  return null;
}

function outputActionId(output: unknown): string | null {
  if (output && typeof output === "object" && "action_id" in output) {
    const id = (output as { action_id?: unknown }).action_id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/**
 * The console layout (pending badge, chain pill, household name) is a shared
 * segment that Next keeps across navigations, so every action that can change
 * what it shows invalidates it before redirecting.
 */
export function refreshConsole(): void {
  revalidatePath("/", "layout");
}

/** Runs one tool as the console after checking the session. The only way a console action writes. */
export async function runConsoleTool(name: ToolName, input: unknown): Promise<ToolOutcome> {
  await requireConsoleSession();
  const outcome = await runTool(name, input, CONSOLE_ACTOR);
  refreshConsole();
  return outcome;
}

/**
 * Where a successful outcome sends the browser: executed → flash with the
 * spoken line; needs_confirmation → the same page with the confirmation card.
 */
export function successUrl(outcome: ToolOutcome & { ok: true }, returnTo: string): string {
  const base = safeNext(returnTo);
  const status = outputStatus(outcome.output);
  const actionId = outputActionId(outcome.output);
  if (status === "needs_confirmation" && actionId) {
    return withQuery(base, { flash: undefined, tone: undefined, confirm: actionId });
  }
  if (status === "rejected") return flashUrl(base, outcome.spoken, "neutral");
  return flashUrl(base, outcome.spoken, "accent");
}

export function errorMessage(outcome: ToolOutcome & { ok: false }): string {
  return outcome.error.error.message;
}

/** The page a form or row button should come back to: its `return_to` field, sanitised, or the given default. */
export function returnPath(fd: FormData, fallback: string): string {
  return safeNext(str(fd, "return_to") ?? fallback);
}

/** Row buttons: always redirect, with a flash on failure. */
export function finishWithRedirect(outcome: ToolOutcome, returnTo: string): never {
  if (outcome.ok) redirect(successUrl(outcome, returnTo));
  redirect(flashUrl(safeNext(returnTo), errorMessage(outcome), "danger"));
}

/** Forms: redirect on success, return an inline error state on failure. */
export function finishForm(outcome: ToolOutcome, returnTo: string, fd: FormData): ActionState {
  if (outcome.ok) redirect(successUrl(outcome, returnTo));
  return failure(errorMessage(outcome), fd);
}

/** "Done: Mark bill 'Electricity' … as paid" for an approved action. */
export function doneMessage(output: unknown, fallback: string): string {
  const summary = previewSummary(output);
  return summary ? `Done: ${summary}` : fallback;
}

export function notDoneMessage(output: unknown, fallback: string): string {
  const summary = previewSummary(output);
  return summary ? `Not done: ${summary}` : fallback;
}
