"use server";

import { finishForm, finishWithRedirect, runConsoleTool, str, type ActionState } from "@/lib/console/outcome";

const PAGE = "/chores";

export async function addChore(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const assignTo = str(fd, "assign_to");
  const dueDate = str(fd, "due_date");
  const outcome = await runConsoleTool("add_chore", {
    title: str(fd, "title"),
    ...(assignTo ? { assign_to: assignTo } : {}),
    cadence: str(fd, "cadence") ?? "once",
    ...(dueDate ? { due_date: dueDate } : {}),
  });
  return finishForm(outcome, PAGE, fd);
}

export async function assignChore(fd: FormData): Promise<void> {
  const outcome = await runConsoleTool("assign_chore", { chore: str(fd, "chore"), assign_to: str(fd, "assign_to") ?? null });
  finishWithRedirect(outcome, PAGE);
}

export async function completeChore(fd: FormData): Promise<void> {
  const outcome = await runConsoleTool("complete_chore", { chore: str(fd, "chore") });
  finishWithRedirect(outcome, PAGE);
}

export async function rotateChores(): Promise<void> {
  const outcome = await runConsoleTool("rotate_chores", {});
  finishWithRedirect(outcome, PAGE);
}
