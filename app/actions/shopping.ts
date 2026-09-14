"use server";

import { bool, finishForm, finishWithRedirect, runConsoleTool, str, type ActionState } from "@/lib/console/outcome";

const PAGE = "/shopping";

export async function addShoppingItem(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const qty = str(fd, "qty");
  const category = str(fd, "category");
  const outcome = await runConsoleTool("add_shopping_item", {
    name: str(fd, "name"),
    ...(qty ? { qty } : {}),
    ...(category ? { category } : {}),
  });
  return finishForm(outcome, PAGE, fd);
}

export async function checkOffItem(fd: FormData): Promise<void> {
  const outcome = await runConsoleTool("check_off_shopping_item", { item: str(fd, "item") });
  finishWithRedirect(outcome, PAGE);
}

/** "Clear checked" / "Clear all": confirm-risk, so it comes back as a card. */
export async function clearList(fd: FormData): Promise<void> {
  const outcome = await runConsoleTool("clear_shopping_list", { include_unchecked: bool(fd, "include_unchecked") });
  finishWithRedirect(outcome, PAGE);
}
