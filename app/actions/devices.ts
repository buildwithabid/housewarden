"use server";

import { redirect } from "next/navigation";
import { bool, finishWithRedirect, num, runConsoleTool, str } from "@/lib/console/outcome";
import { flashUrl } from "@/lib/console/url";

const PAGE = "/devices";

/**
 * Each device tile posts the fields its kind understands; the patch is merged
 * into the current state by the planner and validated for the kind.
 */
export async function setDeviceState(fd: FormData): Promise<void> {
  const kind = str(fd, "kind");
  let state: Record<string, unknown>;
  switch (kind) {
    case "lock":
      state = { locked: bool(fd, "locked") };
      break;
    case "thermostat": {
      const target = num(fd, "target_c");
      const mode = str(fd, "mode");
      state = { ...(mode ? { mode } : {}), ...(target !== undefined ? { target_c: target } : {}) };
      break;
    }
    case "light": {
      const brightness = num(fd, "brightness");
      state = { on: bool(fd, "on"), ...(brightness !== undefined ? { brightness: Math.round(brightness) } : {}) };
      break;
    }
    case "plug":
      state = { on: bool(fd, "on") };
      break;
    default:
      redirect(flashUrl(PAGE, "That device kind is not supported.", "danger"));
  }
  const outcome = await runConsoleTool("set_device_state", { device: str(fd, "device"), state });
  finishWithRedirect(outcome, PAGE);
}

/** "Run" on a routine: confirm-risk by default, so it comes back as a card. */
export async function runRoutine(fd: FormData): Promise<void> {
  const outcome = await runConsoleTool("run_routine", { routine: str(fd, "routine") });
  finishWithRedirect(outcome, PAGE);
}
