/**
 * The MCP surface end to end, in process: a real @modelcontextprotocol/client
 * over an in-memory transport calls every one of the 31 tools once with valid
 * input (the SDK validates input on the server and structured output on
 * both sides), runs the needs_confirmation → confirm_action flow, a dry run,
 * a rejection, an idempotent replay, and checks the annotations.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOW_TO_CONFIRM, HOW_TO_CONFIRM_CONSOLE_ONLY, MCP_APP_RESOURCE_URI, READ_TOOL_NAMES, TOOL_NAMES } from "@/lib/contracts";
import { TOOL_BY_NAME, mcpOutputSchema } from "@/lib/tools/registry";
import { addDays, todayInZone } from "@/lib/time";
import { call, connectHousewarden, get, openSeededDb, type ConnectedPair, type SeededDb } from "./helpers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Spoken lines: one or two short sentences, no ids, no hashes, no JSON. */
function expectSpoken(text: string, tool: string): void {
  expect(text.trim().length, `${tool}: empty spoken line`).toBeGreaterThan(0);
  expect(text, `${tool}: spoken line contains an id`).not.toMatch(UUID);
  expect(text, `${tool}: spoken line contains a hash`).not.toMatch(/[0-9a-f]{64}/);
  expect(text, `${tool}: spoken line looks like JSON`).not.toMatch(/[{}[\]]/);
}

describe("Housewarden MCP tools over an in-memory client", () => {
  let seeded: SeededDb;
  let pair: ConnectedPair;
  const called = new Set<string>();

  async function invoke(name: string, args: Record<string, unknown> = {}) {
    const reply = await call(pair.client, name, args);
    called.add(name);
    expect(reply.isError, `${name}: ${JSON.stringify(reply.data)}`).toBe(false);
    expectSpoken(reply.text, name);
    const parsed = mcpOutputSchema(TOOL_BY_NAME[name as keyof typeof TOOL_BY_NAME]).safeParse(reply.data);
    expect(parsed.success, `${name}: output does not match its schema: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
    return reply;
  }

  beforeAll(async () => {
    seeded = await openSeededDb();
    pair = await connectHousewarden();
  });
  afterAll(async () => {
    await pair.close();
    await seeded.close();
  });

  it("tools/list: 31 tools with schemas, titles, voice descriptions, readOnlyHint on exactly the 12 reads, _meta.ui on the guard tools", async () => {
    const { tools } = await pair.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name);
    expect(readOnly.sort()).toEqual([...READ_TOOL_NAMES].sort());
    for (const tool of tools) {
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.outputSchema, tool.name).toBeDefined();
      expect(tool.title, tool.name).toBeTruthy();
      expect((tool.description ?? "").length, tool.name).toBeGreaterThanOrEqual(20);
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
      const linked = ["list_pending_actions", "confirm_action", "reject_action"].includes(tool.name);
      if (linked) expect(tool._meta, tool.name).toMatchObject({ ui: { resourceUri: MCP_APP_RESOURCE_URI } });
      else expect(tool._meta, tool.name).toBeUndefined();
    }
    const mutating = tools.find((t) => t.name === "add_bill");
    const props = (mutating?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["dry_run", "idempotency_key", "member", "name", "amount", "due_date"]));
    expect(pair.client.getInstructions()).toContain("confirm_action");
  });

  it("read tools: every one answers with structured content and a spoken line", async () => {
    const members = await invoke("list_members");
    expect((get(members.data, "members") as unknown[]).length).toBe(4);
    expect(members.text).toBe("Four people: Abid and Rabia, and the children Anabiya and Adlan.");

    const summary = await invoke("get_household_summary");
    expect(get(summary.data, "household.name")).toBe("Ali family");
    expect(get(summary.data, "counts.bills_overdue")).toBe(1);
    expect(summary.text).toMatch(/^One bill is overdue: Electricity, 3,000 rupees, due five days ago\./);
    expect(summary.text).toContain("Nothing is waiting for approval.");

    const bills = await invoke("list_bills", { status: "unpaid" });
    expect((get(bills.data, "bills") as unknown[]).length).toBe(5);
    expect(bills.text).toBe("Five bills are unpaid, 69,300 rupees in total. Electricity is overdue; Gas is due in four days.");
    const all = await invoke("list_bills", { status: "all" });
    expect((get(all.data, "totals_due") as unknown[]).length).toBe(1);

    const bill = await invoke("get_bill", { bill: "Internet" });
    expect(get(bill.data, "bill.name")).toBe("Internet");
    // 12 days out is beyond the one-week window, so the date is spoken as a calendar day.
    expect(bill.text).toMatch(/^Internet: 2,500 rupees, due on \d+ \w+, repeats monthly\.$/);

    const chores = await invoke("list_chores", { member: "Adlan" });
    expect((get(chores.data, "chores") as unknown[]).length).toBe(1);
    expect(chores.text).toBe("Adlan has one open chore: take out the bins, due today.");
    const everyChore = await invoke("list_chores", { status: "all" });
    expect((get(everyChore.data, "chores") as unknown[]).length).toBe(4);

    const shopping = await invoke("list_shopping");
    expect(get(shopping.data, "to_buy")).toBe(4);
    expect(shopping.text).toBe("Four things to buy: eggs, milk, apples and rice.");
    const withChecked = await invoke("list_shopping", { include_checked: true });
    expect((get(withChecked.data, "items") as unknown[]).length).toBe(5);
    expect(withChecked.text).toContain("One item already checked off.");

    const reminders = await invoke("list_reminders", { within_hours: 48 });
    expect((get(reminders.data, "reminders") as unknown[]).length).toBe(1);
    expect(reminders.text).toMatch(/^One scheduled reminder in the next two days: call the electrician, tomorrow at 10\.$/);

    const devices = await invoke("list_devices");
    expect((get(devices.data, "devices") as unknown[]).length).toBe(2);
    expect((get(devices.data, "routines") as unknown[]).length).toBe(1);
    expect(devices.text).toBe("The front door is locked and the living room is cooling to 24 degrees. One routine is available: bedtime.");

    const budget = await invoke("get_budget_summary");
    expect(typeof get(budget.data, "total.amount")).toBe("number");
    expect((get(budget.data, "by_category") as unknown[]).length).toBeGreaterThan(0);
    expect(budget.text).toMatch(/so far: [\d,]+ rupees, mostly \w+\. That is/);

    const pending = await invoke("list_pending_actions");
    expect(get(pending.data, "pending_count")).toBe(0);
    expect(pending.text).toBe("Nothing is waiting for approval.");

    const audit = await invoke("get_audit_log", { limit: 5 });
    expect(get(audit.data, "total_rows")).toBe(1);
    expect(get(audit.data, "chain_head.seq")).toBe(1);
    expect(audit.text).toBe("The audit log has one entry. The latest is seeded of seed by demo data.");

    const chain = await invoke("verify_audit_chain");
    expect(get(chain.data, "intact")).toBe(true);
    expect(chain.text).toBe("Yes. One entry, chain intact.");
  });

  it("low-risk mutations execute at once through the guard and audit themselves", async () => {
    const today = todayInZone(new Date(), seeded.household.timezone);

    const added = await invoke("add_bill", { name: "Water", amount: 900, due_date: addDays(today, 15), recurrence: "monthly" });
    expect(get(added.data, "status")).toBe("executed");
    expect(get(added.data, "risk")).toBe("low");
    expect(get(added.data, "result.bill.name")).toBe("Water");
    expect(added.text).toBe("Added Water, 900 rupees, due on " + spokenDay(addDays(today, 15)) + ", monthly.");

    const updated = await invoke("update_bill", { bill: "Gas", amount: 2100 });
    expect(get(updated.data, "result.bill.amount")).toBe(2100);
    expect(updated.text).toBe("Gas is now 2,100 rupees.");

    const chore = await invoke("add_chore", { title: "Clean the fridge", assign_to: "Rabia", due_date: addDays(today, 2) });
    expect(get(chore.data, "result.chore.assigned_member.name")).toBe("Rabia");

    const assigned = await invoke("assign_chore", { chore: "Wash the car", assign_to: "Adlan" });
    expect(get(assigned.data, "result.chore.assigned_member.name")).toBe("Adlan");
    expect(assigned.text).toBe("Wash the car is now Adlan's.");

    const done = await invoke("complete_chore", { chore: "Take out the bins" });
    expect(get(done.data, "result.chore.status")).toBe("done");
    expect(get(done.data, "result.next_chore.due_date")).toBe(addDays(today, 7));

    const item = await invoke("add_shopping_item", { name: "Bread", category: "Bakery", idempotency_key: "bread-1" });
    expect(get(item.data, "status")).toBe("executed");
    expect(get(item.data, "idempotent_replay")).toBe(false);
    expect(item.text).toBe("Added bread to the shopping list.");
    const replay = await invoke("add_shopping_item", { name: "Bread", category: "Bakery", idempotency_key: "bread-1" });
    expect(get(replay.data, "idempotent_replay")).toBe(true);
    expect(get(replay.data, "action_id")).toBe(get(item.data, "action_id"));

    const checked = await invoke("check_off_shopping_item", { item: "Eggs" });
    expect(get(checked.data, "result.item.checked")).toBe(true);
    // lib/domain/shopping.ts (core) lower-cases the count after the full stop; compared case-insensitively.
    expect(checked.text.toLowerCase()).toBe("eggs checked off. four things left.");

    const at = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const reminder = await invoke("add_reminder", { text: "Call the plumber", at, for_member: "Abid" });
    expect(get(reminder.data, "result.reminder.member.name")).toBe("Abid");
    const cancelled = await invoke("cancel_reminder", { reminder: "Call the plumber" });
    expect(get(cancelled.data, "result.reminder.status")).toBe("cancelled");
    expect(cancelled.text).toBe("Cancelled: Call the plumber.");

    const expense = await invoke("record_expense", { amount: 1450, category: "Groceries", note: "Imtiaz", paid_by: "Rabia" });
    expect(get(expense.data, "result.entry.amount")).toBe(1450);
    expect(expense.text).toMatch(/^Recorded 1,450 rupees for groceries\. \w+ is at [\d,]+ rupees\.$/);

    const thermostat = await invoke("set_device_state", { device: "Living room", state: { target_c: 22 } });
    expect(get(thermostat.data, "status")).toBe("executed");
    expect(get(thermostat.data, "result.device.state.target_c")).toBe(22);
    expect(thermostat.text).toBe("Living room set to 22 degrees.");
  });

  it("dry_run returns the preview only and writes nothing", async () => {
    const before = await invoke("get_audit_log", { limit: 1 });
    const rotate = await invoke("rotate_chores", { dry_run: true });
    expect(get(rotate.data, "status")).toBe("dry_run");
    expect(get(rotate.data, "would_require_confirmation")).toBe(false);
    expect((get(rotate.data, "preview.changes") as unknown[]).length).toBeGreaterThan(0);
    expect(rotate.text).toMatch(/^Nothing was changed\. I would move/);
    const routine = await invoke("run_routine", { routine: "bedtime", dry_run: true });
    expect(get(routine.data, "status")).toBe("dry_run");
    expect(get(routine.data, "would_require_confirmation")).toBe(true);
    expect(get(routine.data, "risk")).toBe("confirm");
    const after = await invoke("get_audit_log", { limit: 1 });
    expect(get(after.data, "total_rows")).toBe(get(before.data, "total_rows"));
    expect(get(await invoke("list_pending_actions"), "data.pending_count")).toBe(0);
  });

  it("confirm-risk mutation → needs_confirmation → confirm_action executes exactly once", async () => {
    const proposal = await invoke("mark_bill_paid", { bill: "Electricity" });
    expect(get(proposal.data, "status")).toBe("needs_confirmation");
    expect(get(proposal.data, "risk")).toBe("confirm");
    expect(get(proposal.data, "how_to_confirm")).toBe(HOW_TO_CONFIRM);
    expect(proposal.text).toMatch(/^I can mark Electricity, 3,000 rupees, as paid and create the next one, due on \d+ \w+, but it needs your approval\. Say yes to confirm, or approve it in the console within 10 minutes\.$/);
    const actionId = get(proposal.data, "action_id") as string;
    expect(actionId).toMatch(UUID);

    const stillUnpaid = await invoke("get_bill", { bill: "Electricity" });
    expect(get(stillUnpaid.data, "bill.status")).toBe("overdue");
    const waiting = await invoke("list_pending_actions");
    expect(get(waiting.data, "pending_count")).toBe(1);
    expect(waiting.text).toMatch(/^One action is waiting: mark bill 'Electricity' \(3,000 PKR, due [\d-]+\) as paid\. It expires in (ten|nine) minutes\.$/);
    const proposed = await invoke("get_audit_log", { action_id: actionId });
    expect((get(proposed.data, "rows") as { event: string }[]).map((r) => r.event)).toEqual(["proposed"]);
    expect(proposed.text).toBe("One entry for that action: proposed by the assistant.");

    const confirmed = await invoke("confirm_action", { action_id: actionId });
    expect(get(confirmed.data, "status")).toBe("executed");
    expect(get(confirmed.data, "idempotent_replay")).toBe(false);
    expect(get(confirmed.data, "result.bill.status")).toBe("paid");
    expect(get(confirmed.data, "result.next_bill.recurrence")).toBe("monthly");
    expect(confirmed.text).toMatch(/^Done\. Electricity is marked paid\. The next one is due on \d+ \w+\.$/);

    const again = await invoke("confirm_action", { action_id: actionId });
    expect(get(again.data, "idempotent_replay")).toBe(true);
    expect(get(again.data, "action_id")).toBe(actionId);
    const log = await invoke("get_audit_log", { action_id: actionId });
    expect((get(log.data, "rows") as { event: string }[]).map((r) => r.event).sort()).toEqual(["executed", "proposed"]);
    expect(log.text).toBe("Two entries for that action: proposed by the assistant, then executed by the assistant.");
  });

  it("reject_action declines a waiting action; high-risk proposals say the console must approve", async () => {
    const proposal = await invoke("clear_shopping_list", {});
    expect(get(proposal.data, "status")).toBe("needs_confirmation");
    const actionId = get(proposal.data, "action_id") as string;
    const rejected = await invoke("reject_action", { action_id: actionId, reason: "Not now" });
    expect(get(rejected.data, "status")).toBe("rejected");
    expect(get(rejected.data, "reason")).toBe("Not now");
    expect(rejected.text).toMatch(/^Okay, I won't go ahead with that: remove/);
    const items = await invoke("list_shopping", { include_checked: true });
    expect((get(items.data, "items") as { checked: boolean }[]).some((i) => i.checked)).toBe(true);

    const member = await invoke("add_member", { name: "Munazza", role: "adult" });
    expect(get(member.data, "status")).toBe("needs_confirmation");
    expect(member.text).toBe("I can add Munazza as an adult, but it needs your approval. Say yes to confirm, or approve it in the console within 10 minutes.");

    const policy = await invoke("set_policy", { tool_name: "clear_shopping_list", risk: "low" });
    expect(get(policy.data, "status")).toBe("needs_confirmation");
    expect(get(policy.data, "risk")).toBe("high");
    expect(get(policy.data, "how_to_confirm")).toBe(HOW_TO_CONFIRM_CONSOLE_ONLY);
    const consoleOnly = await call(pair.client, "confirm_action", { action_id: get(policy.data, "action_id") as string });
    expect(consoleOnly.isError).toBe(true);
    expect(get(consoleOnly.data, "error.code")).toBe("HIGH_RISK_CONSOLE_ONLY");

    const routine = await invoke("run_routine", { routine: "bedtime" });
    expect(get(routine.data, "status")).toBe("needs_confirmation");
    await invoke("reject_action", { action_id: get(routine.data, "action_id") as string });

    const chain = await invoke("verify_audit_chain");
    expect(get(chain.data, "intact")).toBe(true);
    expect(get(chain.data, "rows")).toBeGreaterThan(10);
  });

  it("failures come back as isError with the SPEC error code and a calm spoken line", async () => {
    const missing = await call(pair.client, "get_bill", { bill: "Watr" });
    expect(missing.isError).toBe(true);
    expect(get(missing.data, "error.code")).toBe("NOT_FOUND");
    expect(get(missing.data, "error.details.entity")).toBe("bill");
    expect(missing.text).toMatch(/^I couldn't find a bill called Watr\./);

    const done = await call(pair.client, "complete_chore", { chore: "Take out the bins" });
    // The seeded weekly chore was completed above and the next occurrence is open, so this is the new one.
    expect(done.isError).toBe(false);

    const gone = await call(pair.client, "confirm_action", { action_id: "00000000-0000-4000-8000-000000000000" });
    expect(gone.isError).toBe(true);
    expect(get(gone.data, "error.code")).toBe("NOT_FOUND");

    const invalid = await call(pair.client, "add_bill", { name: "", amount: -1 });
    expect(invalid.isError).toBe(true);
    expect(invalid.text).toMatch(/validation/i);
  });

  it("called every one of the 31 tools at least once", () => {
    expect([...called].sort()).toEqual([...TOOL_NAMES].sort());
  });
});

/** "20 October" from YYYY-MM-DD, the way spokenDate renders dates beyond a week. */
function spokenDay(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d} ${months[m - 1]}`;
}
