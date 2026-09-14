"use server";

import { redirect } from "next/navigation";
import { CONSOLE_ACTOR, HousewardenError } from "@/lib/contracts";
import { failure, finishForm, finishWithRedirect, refreshConsole, runConsoleTool, str, type ActionState } from "@/lib/console/outcome";
import { requireConsoleSession } from "@/lib/console/session";
import { flashUrl } from "@/lib/console/url";
import { seedDemo } from "@/lib/seed";

/** "Load demo data": the seed, not a tool (there is no household for a tool to act on yet). */
export async function loadDemoData(): Promise<void> {
  await requireConsoleSession();
  let message: string;
  let ok = true;
  try {
    const seeded = await seedDemo(undefined, CONSOLE_ACTOR);
    const c = seeded.counts;
    message = `Loaded the ${seeded.household.name}: ${c.members} members, ${c.bills} bills, ${c.chores} chores, ${c.shopping_items} shopping items, ${c.reminders} reminders, ${c.devices} devices and one routine.`;
  } catch (err) {
    ok = false;
    message = err instanceof HousewardenError ? err.message : "The demo data could not be loaded. Check the server log and try again.";
    if (!(err instanceof HousewardenError)) {
      console.error("[housewarden] seed failed", { name: err instanceof Error ? err.name : typeof err, message: err instanceof Error ? err.message : String(err) });
    }
  }
  refreshConsole();
  redirect(flashUrl("/", message, ok ? "accent" : "danger"));
}

function policyInput(fd: FormData) {
  const member = str(fd, "for_member");
  return {
    tool_name: str(fd, "tool_name"),
    scope: str(fd, "scope") ?? "",
    for_member: member ?? null,
    risk: str(fd, "risk"),
  };
}

/** The "Add rule" form → set_policy (high risk, so it always comes back as a console-approval card). */
export async function setPolicy(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const input = policyInput(fd);
  if (!input.tool_name || !input.risk) return failure("Choose a tool and a risk level.", fd);
  const outcome = await runConsoleTool("set_policy", input);
  return finishForm(outcome, "/settings", fd);
}

/** The inline risk select on a policies row → set_policy. */
export async function setPolicyInline(fd: FormData): Promise<void> {
  const outcome = await runConsoleTool("set_policy", policyInput(fd));
  finishWithRedirect(outcome, "/settings");
}
