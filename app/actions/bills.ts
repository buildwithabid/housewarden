"use server";

import { failure, finishForm, finishWithRedirect, num, runConsoleTool, str, type ActionState } from "@/lib/console/outcome";

const PAGE = "/bills";

export async function addBill(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const amount = num(fd, "amount");
  if (amount === undefined) return failure("Give the amount as a number, for example 900 or 45.50.", fd);
  const currency = str(fd, "currency");
  const outcome = await runConsoleTool("add_bill", {
    name: str(fd, "name"),
    amount,
    ...(currency ? { currency: currency.toUpperCase() } : {}),
    due_date: str(fd, "due_date"),
    recurrence: str(fd, "recurrence") ?? "none",
  });
  return finishForm(outcome, PAGE, fd);
}

/** Inline edit on a bill row: sends every field; the planner keeps only what changed. */
export async function updateBill(fd: FormData): Promise<void> {
  const amount = num(fd, "amount");
  const currency = str(fd, "currency");
  const outcome = await runConsoleTool("update_bill", {
    bill: str(fd, "bill"),
    name: str(fd, "name"),
    ...(amount !== undefined ? { amount } : {}),
    ...(currency ? { currency: currency.toUpperCase() } : {}),
    due_date: str(fd, "due_date"),
    recurrence: str(fd, "recurrence"),
  });
  finishWithRedirect(outcome, PAGE);
}

/** "Mark paid" is confirm-risk by default, so this usually comes back as a card on /bills. */
export async function markBillPaid(fd: FormData): Promise<void> {
  const outcome = await runConsoleTool("mark_bill_paid", { bill: str(fd, "bill") });
  finishWithRedirect(outcome, PAGE);
}
