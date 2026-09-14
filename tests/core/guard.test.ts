import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ASSISTANT_ACTOR,
  CONSOLE_ACTOR,
  HOW_TO_CONFIRM,
  HOW_TO_CONFIRM_CONSOLE_ONLY,
  HousewardenError,
  MemberSchema,
  defineMutatingTool,
  defineReadTool,
  type GuardExecuted,
  type GuardNeedsConfirmation,
  type Household,
} from "@/lib/contracts";
import { listAuditRows, verifyAuditChain } from "@/lib/audit";
import { listBills, listDevices, listMembers, listShopping, getPendingAction, resolvePolicy } from "@/lib/domain";
import { PLANNERS, clearToolDefinitions, confirmAction, propose, registerToolDefinitions, rejectAction, runTool, sweepExpiredNow } from "@/lib/guard";
import { T0, count, minutesAfter, openTestDb, seedAt, type TestDb } from "./helpers";

const TODAY = "2026-10-05";

async function errorCode(promise: Promise<unknown>): Promise<{ code: string; details?: Record<string, unknown> }> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HousewardenError) return { code: err.code, details: err.details };
    throw err;
  }
  throw new Error("expected a HousewardenError");
}

describe("guard", () => {
  let t: TestDb;
  let household: Household;
  const opts = (now: Date = T0) => ({ db: t.db, now });

  beforeAll(async () => {
    t = await openTestDb();
    household = await seedAt(t.db, T0);
  });
  afterAll(async () => {
    await t.close();
  });
  afterEach(() => {
    clearToolDefinitions();
  });

  it("executes a low-risk tool immediately, records the action and audits it", async () => {
    const before = await count(t.db, "audit_log");
    const out = await propose("add_shopping_item", { name: "Bread", category: "Bakery" }, ASSISTANT_ACTOR, opts());
    expect(out.status).toBe("executed");
    const executed = out as GuardExecuted<{ item: { name: string; qty: string } }>;
    expect(executed.risk).toBe("low");
    expect(executed.idempotent_replay).toBe(false);
    expect(executed.result.item).toMatchObject({ name: "Bread", qty: "1" });
    expect(executed.spoken).toBe("Added bread to the shopping list.");
    expect(executed.executed_at).toBe(T0.toISOString());

    const items = await listShopping(t.db, household.id);
    expect(items.some((i) => i.name === "Bread")).toBe(true);
    const action = await getPendingAction(t.db, executed.action_id, T0);
    expect(action).toMatchObject({ status: "executed", tool: "add_shopping_item", risk: "low", created_by: ASSISTANT_ACTOR });
    expect(action?.input).toEqual({ name: "Bread", qty: "1", category: "Bakery" });
    const audit = await listAuditRows(t.db, { actionId: executed.action_id });
    expect(audit.map((r) => r.event)).toEqual(["executed"]);
    expect(await count(t.db, "audit_log")).toBe(before + 1);
    expect((await verifyAuditChain(t.db)).intact).toBe(true);
  });

  it("queues a confirm-risk tool and writes nothing to the domain until confirmed", async () => {
    const out = await propose("mark_bill_paid", { bill: "Electricity" }, ASSISTANT_ACTOR, opts());
    expect(out.status).toBe("needs_confirmation");
    const pending = out as GuardNeedsConfirmation;
    expect(pending.risk).toBe("confirm");
    expect(pending.how_to_confirm).toBe(HOW_TO_CONFIRM);
    expect(pending.expires_at).toBe(minutesAfter(T0, 10).toISOString());
    expect(pending.preview.summary).toBe("Mark bill 'Electricity' (3,000 PKR, due 2026-09-30) as paid");
    expect(pending.preview.changes.map((c) => c.line)).toEqual([
      "bill 'Electricity' 3,000 PKR due 2026-09-30: status overdue → paid",
      "bill 'Electricity' 3,000 PKR due 2026-10-30: new (monthly recurrence)",
    ]);
    expect(pending.preview.warnings).toEqual(["This bill recurs monthly; the next one will be created for 2026-10-30."]);
    expect(pending.spoken).toMatch(/^I can mark Electricity, 3,000 rupees, as paid and create the next one, due on 30 October, but it needs your approval\. Say yes to confirm, or approve it in the console within 10 minutes\.$/);

    // Nothing changed: still one Electricity bill, still overdue.
    const bills = await listBills(t.db, household.id, TODAY, "all");
    const electricity = bills.filter((b) => b.name === "Electricity");
    expect(electricity).toHaveLength(1);
    expect(electricity[0].status).toBe("overdue");
    expect(electricity[0].paid_at).toBeNull();
    const audit = await listAuditRows(t.db, { actionId: pending.action_id });
    expect(audit.map((r) => r.event)).toEqual(["proposed"]);
    expect(audit[0].actor).toEqual(ASSISTANT_ACTOR);
    expect((await getPendingAction(t.db, pending.action_id, T0))?.status).toBe("pending");

    // Ten concurrent confirms: exactly one executes, nine replay.
    const later = minutesAfter(T0, 1);
    const results = await Promise.all(Array.from({ length: 10 }, () => confirmAction(pending.action_id, CONSOLE_ACTOR, opts(later))));
    expect(results.every((r) => r.status === "executed")).toBe(true);
    expect(results.filter((r) => !r.idempotent_replay)).toHaveLength(1);
    expect(results.filter((r) => r.idempotent_replay)).toHaveLength(9);
    const fresh = results.find((r) => !r.idempotent_replay)!;
    expect(fresh.spoken).toBe("Done. Electricity is marked paid. The next one is due on 30 October.");
    expect(fresh.executed_at).toBe(later.toISOString());
    for (const r of results) expect(r.result).toEqual(fresh.result);

    const after = await listBills(t.db, household.id, TODAY, "all");
    const electricityAfter = after.filter((b) => b.name === "Electricity");
    expect(electricityAfter.map((b) => b.status).sort()).toEqual(["due", "paid"]);
    expect(electricityAfter.find((b) => b.status === "due")?.due_date).toBe("2026-10-30");
    const auditAfter = await listAuditRows(t.db, { actionId: pending.action_id });
    expect(auditAfter.map((r) => r.event)).toEqual(["executed", "proposed"]);
    expect(auditAfter[0].actor).toEqual(CONSOLE_ACTOR);

    // A further confirm is still idempotent.
    const again = await confirmAction(pending.action_id, ASSISTANT_ACTOR, opts(minutesAfter(T0, 2)));
    expect(again.idempotent_replay).toBe(true);
    expect(again.action_id).toBe(pending.action_id);
    expect(again.spoken).toBe("That was already done: mark bill 'Electricity' (3,000 PKR, due 2026-09-30) as paid.");
    expect(await count(t.db, "audit_log", "WHERE action_id = $1::uuid", [pending.action_id])).toBe(2);

    // reject after execute → ACTION_NOT_PENDING
    expect(await errorCode(rejectAction(pending.action_id, CONSOLE_ACTOR, null, opts()))).toMatchObject({ code: "ACTION_NOT_PENDING", details: { status: "executed" } });
    expect((await verifyAuditChain(t.db)).intact).toBe(true);
  });

  it("reject writes nothing to the domain and is idempotent", async () => {
    const itemsBefore = await listShopping(t.db, household.id, true);
    const out = (await propose("clear_shopping_list", { include_unchecked: true }, ASSISTANT_ACTOR, opts())) as GuardNeedsConfirmation;
    expect(out.status).toBe("needs_confirmation");
    expect(out.preview.changes.every((c) => c.op === "delete")).toBe(true);

    const rejected = await rejectAction(out.action_id, CONSOLE_ACTOR, "Not now", opts(minutesAfter(T0, 1)));
    expect(rejected).toMatchObject({ status: "rejected", tool: "clear_shopping_list", reason: "Not now", idempotent_replay: false });
    expect(rejected.spoken).toMatch(/^Okay, I won't go ahead with that: remove all \d+ items/);
    expect(await listShopping(t.db, household.id, true)).toEqual(itemsBefore);
    expect((await getPendingAction(t.db, out.action_id, T0))?.status).toBe("rejected");
    const audit = await listAuditRows(t.db, { actionId: out.action_id });
    expect(audit.map((r) => r.event)).toEqual(["rejected", "proposed"]);
    expect(audit[0].result).toEqual({ status: "rejected", reason: "Not now" });

    const again = await rejectAction(out.action_id, CONSOLE_ACTOR, "ignored", opts(minutesAfter(T0, 2)));
    expect(again).toMatchObject({ status: "rejected", reason: "Not now", idempotent_replay: true, rejected_at: rejected.rejected_at });
    expect(await count(t.db, "audit_log", "WHERE action_id = $1::uuid", [out.action_id])).toBe(2);
    expect(await errorCode(confirmAction(out.action_id, CONSOLE_ACTOR, opts()))).toMatchObject({ code: "ACTION_NOT_PENDING", details: { status: "rejected" } });
  });

  it("expires pending actions on access and refuses to confirm them", async () => {
    const devicesBefore = await listDevices(t.db, household.id);
    const out = (await propose("run_routine", { routine: "bedtime" }, ASSISTANT_ACTOR, opts())) as GuardNeedsConfirmation;
    expect(out.status).toBe("needs_confirmation");
    expect((await getPendingAction(t.db, out.action_id, minutesAfter(T0, 11)))?.status).toBe("expired");

    expect(await errorCode(confirmAction(out.action_id, CONSOLE_ACTOR, opts(minutesAfter(T0, 11))))).toMatchObject({
      code: "ACTION_EXPIRED",
      details: { action_id: out.action_id, expires_at: out.expires_at },
    });
    const row = await getPendingAction(t.db, out.action_id, minutesAfter(T0, 12));
    expect(row?.status).toBe("expired");
    expect(row?.decided_by).toMatchObject({ kind: "system", id: "sweeper" });
    const audit = await listAuditRows(t.db, { actionId: out.action_id });
    expect(audit.map((r) => r.event)).toEqual(["expired", "proposed"]);
    expect(await listDevices(t.db, household.id)).toEqual(devicesBefore);
    expect(await errorCode(rejectAction(out.action_id, CONSOLE_ACTOR, null, opts(minutesAfter(T0, 12))))).toMatchObject({ code: "ACTION_NOT_PENDING", details: { status: "expired" } });

    // sweepExpiredNow is the standalone sweep for pages and read tools
    const another = (await propose("run_routine", { routine: "bedtime" }, ASSISTANT_ACTOR, opts(minutesAfter(T0, 20)))) as GuardNeedsConfirmation;
    expect(await sweepExpiredNow(t.db, minutesAfter(T0, 25))).toBe(0);
    expect(await sweepExpiredNow(t.db, minutesAfter(T0, 31))).toBe(1);
    expect((await getPendingAction(t.db, another.action_id, minutesAfter(T0, 31)))?.status).toBe("expired");
  });

  it("replays an idempotency_key without planning or writing again", async () => {
    const billsBefore = await count(t.db, "bills");
    const first = (await propose("add_bill", { name: "Water", amount: 900, due_date: "2026-10-20", recurrence: "monthly", idempotency_key: "water-1" }, ASSISTANT_ACTOR, opts())) as GuardExecuted<unknown>;
    expect(first.status).toBe("executed");
    const auditAfterFirst = await count(t.db, "audit_log");
    const second = (await propose("add_bill", { name: "Water", amount: 950, due_date: "2026-10-21", idempotency_key: "water-1" }, ASSISTANT_ACTOR, opts(minutesAfter(T0, 3)))) as GuardExecuted<unknown>;
    expect(second.status).toBe("executed");
    expect(second.action_id).toBe(first.action_id);
    expect(second.idempotent_replay).toBe(true);
    expect(second.result).toEqual(first.result);
    expect(second.executed_at).toBe(first.executed_at);
    expect(await count(t.db, "bills")).toBe(billsBefore + 1);
    expect(await count(t.db, "audit_log")).toBe(auditAfterFirst);

    // keys are scoped per tool: the same key on another tool is a fresh action
    const other = (await propose("add_shopping_item", { name: "Water bottles", idempotency_key: "water-1" }, ASSISTANT_ACTOR, opts())) as GuardExecuted<unknown>;
    expect(other.action_id).not.toBe(first.action_id);
    expect(other.idempotent_replay).toBe(false);

    // and for a queued action the replay returns the same pending action
    const q1 = (await propose("mark_bill_paid", { bill: "Gas", idempotency_key: "gas-oct" }, ASSISTANT_ACTOR, opts())) as GuardNeedsConfirmation;
    const q2 = (await propose("mark_bill_paid", { bill: "Gas", idempotency_key: "gas-oct" }, ASSISTANT_ACTOR, opts(minutesAfter(T0, 1)))) as GuardNeedsConfirmation;
    expect(q2.status).toBe("needs_confirmation");
    expect(q2.action_id).toBe(q1.action_id);
    expect(q2.expires_at).toBe(q1.expires_at);
    expect(await count(t.db, "pending_actions", "WHERE tool = 'mark_bill_paid' AND idempotency_key = 'gas-oct'")).toBe(1);
    await rejectAction(q1.action_id, CONSOLE_ACTOR, null, opts(minutesAfter(T0, 2)));
    expect(await errorCode(propose("mark_bill_paid", { bill: "Gas", idempotency_key: "gas-oct" }, ASSISTANT_ACTOR, opts(minutesAfter(T0, 3))))).toMatchObject({ code: "ACTION_NOT_PENDING", details: { status: "rejected" } });
  });

  it("dry_run previews without writing a pending action or an audit row", async () => {
    const pendingBefore = await count(t.db, "pending_actions");
    const auditBefore = await count(t.db, "audit_log");
    const shoppingBefore = await count(t.db, "shopping_items");

    const risky = await propose("clear_shopping_list", { dry_run: true }, ASSISTANT_ACTOR, opts());
    expect(risky).toMatchObject({ status: "dry_run", tool: "clear_shopping_list", risk: "confirm", would_require_confirmation: true });
    expect(risky.spoken).toMatch(/^Nothing was changed\. I would remove one checked item from the shopping list; it would need your approval\.$/);

    const safe = await propose("add_shopping_item", { name: "Butter", dry_run: true }, ASSISTANT_ACTOR, opts());
    expect(safe).toMatchObject({ status: "dry_run", risk: "low", would_require_confirmation: false });
    expect(safe.preview.changes[0]).toMatchObject({ entity: "shopping_item", op: "create", label: "Butter" });

    expect(await count(t.db, "pending_actions")).toBe(pendingBefore);
    expect(await count(t.db, "audit_log")).toBe(auditBefore);
    expect(await count(t.db, "shopping_items")).toBe(shoppingBefore);
  });

  it("fails a confirm with STALE_PREVIEW when the state changed in between", async () => {
    const out = (await propose("mark_bill_paid", { bill: "Internet" }, ASSISTANT_ACTOR, opts())) as GuardNeedsConfirmation;
    const changed = await propose("update_bill", { bill: "Internet", amount: 2600 }, CONSOLE_ACTOR, opts(minutesAfter(T0, 1)));
    expect(changed.status).toBe("executed");

    const err = await errorCode(confirmAction(out.action_id, CONSOLE_ACTOR, opts(minutesAfter(T0, 2))));
    expect(err.code).toBe("STALE_PREVIEW");
    const newPreview = err.details?.new_preview as { changes: { line: string }[] };
    expect(newPreview.changes[0].line).toContain("2,600 PKR");

    const row = await getPendingAction(t.db, out.action_id, T0);
    expect(row?.status).toBe("failed");
    expect(row?.error).toMatchObject({ code: "STALE_PREVIEW" });
    const internet = (await listBills(t.db, household.id, TODAY, "all")).filter((b) => b.name === "Internet");
    expect(internet).toHaveLength(1);
    expect(internet[0].status).toBe("due");
    expect((await listAuditRows(t.db, { actionId: out.action_id })).map((r) => r.event)).toEqual(["failed", "proposed"]);
    expect(await errorCode(confirmAction(out.action_id, CONSOLE_ACTOR, opts(minutesAfter(T0, 3))))).toMatchObject({ code: "ACTION_NOT_PENDING", details: { status: "failed" } });
  });

  it("enforces the set_policy floor and console-only approval for high risk", async () => {
    expect(await errorCode(propose("set_policy", { tool_name: "set_policy", risk: "low" }, CONSOLE_ACTOR, opts()))).toMatchObject({ code: "POLICY_INVARIANT" });
    expect(await errorCode(propose("set_policy", { tool_name: "list_bills", risk: "confirm" }, CONSOLE_ACTOR, opts()))).toMatchObject({ code: "POLICY_INVARIANT" });
    expect(await errorCode(propose("set_policy", { tool_name: "confirm_action", risk: "high" }, CONSOLE_ACTOR, opts()))).toMatchObject({ code: "POLICY_INVARIANT" });

    const out = (await propose("set_policy", { tool_name: "clear_shopping_list", risk: "low" }, ASSISTANT_ACTOR, opts())) as GuardNeedsConfirmation;
    expect(out).toMatchObject({ status: "needs_confirmation", risk: "high", how_to_confirm: HOW_TO_CONFIRM_CONSOLE_ONLY });
    expect(out.spoken).toMatch(/a person needs to approve it in the Housewarden console\.$/);

    expect(await errorCode(confirmAction(out.action_id, ASSISTANT_ACTOR, opts(minutesAfter(T0, 1))))).toMatchObject({ code: "HIGH_RISK_CONSOLE_ONLY" });
    expect((await getPendingAction(t.db, out.action_id, minutesAfter(T0, 1)))?.status).toBe("pending");
    expect((await listAuditRows(t.db, { actionId: out.action_id })).map((r) => r.event)).toEqual(["proposed"]);

    const done = await confirmAction(out.action_id, CONSOLE_ACTOR, opts(minutesAfter(T0, 2)));
    expect(done.status).toBe("executed");
    expect(done.result).toMatchObject({ policy: { tool_name: "clear_shopping_list", risk: "low", source: "household" }, previous: { risk: "confirm", source: "builtin" } });
    expect((await resolvePolicy(t.db, household.id, "clear_shopping_list", "", null)).risk).toBe("low");

    // the lowered policy takes effect: clearing now executes immediately
    const cleared = await propose("clear_shopping_list", {}, ASSISTANT_ACTOR, opts(minutesAfter(T0, 3)));
    expect(cleared.status).toBe("executed");
    // raising set_policy to high (its default) is a no-op only if a household row already says so
    const raise = (await propose("set_policy", { tool_name: "set_policy", risk: "high" }, CONSOLE_ACTOR, opts(minutesAfter(T0, 4)))) as GuardNeedsConfirmation;
    expect(raise.risk).toBe("high");
  });

  it("resolves per-member and scoped policies in the documented order", async () => {
    const members = await listMembers(t.db, household.id);
    const adlan = members.find((m) => m.name === "Adlan")!;
    const abid = members.find((m) => m.name === "Abid")!;
    expect((await resolvePolicy(t.db, household.id, "set_device_state", "lock", adlan.id)).risk).toBe("high");
    expect((await resolvePolicy(t.db, household.id, "set_device_state", "lock", abid.id))).toMatchObject({ risk: "confirm", source: "builtin" });
    expect((await resolvePolicy(t.db, household.id, "set_device_state", "thermostat", adlan.id))).toMatchObject({ risk: "low", source: "builtin" });

    const child = (await propose("set_device_state", { device: "Front door", state: { locked: false }, member: "Adlan" }, ASSISTANT_ACTOR, opts())) as GuardNeedsConfirmation;
    expect(child).toMatchObject({ status: "needs_confirmation", risk: "high" });
    expect(child.preview.warnings).toEqual(["Adlan is a child; unlocking needs a person to approve it in the console."]);
    expect(child.preview.changes[0].line).toBe("device 'Front door' (lock): locked → unlocked");
    const adult = (await propose("set_device_state", { device: "Front door", state: { locked: false }, member: "Abid" }, ASSISTANT_ACTOR, opts())) as GuardNeedsConfirmation;
    expect(adult.risk).toBe("confirm");
    const thermostat = await propose("set_device_state", { device: "Living room", state: { target_c: 22 } }, ASSISTANT_ACTOR, opts());
    expect(thermostat).toMatchObject({ status: "executed", risk: "low" });
    expect(thermostat.spoken).toBe("Living room set to 22 degrees.");
    await rejectAction(child.action_id, CONSOLE_ACTOR, null, opts());
    await rejectAction(adult.action_id, CONSOLE_ACTOR, null, opts());
  });

  it("records an execute() failure as failed and keeps the domain untouched", async () => {
    // A registered definition takes precedence over the built-in planner; this one explodes on execute.
    const planner = PLANNERS.add_reminder;
    registerToolDefinitions([
      defineMutatingTool({
        name: "run_routine",
        kind: "mutating",
        title: "Run routine",
        description: "Test double. Explodes on execute.",
        inputSchema: PLANNERS.run_routine.inputSchema,
        resultSchema: z.object({}),
        defaultRisk: "confirm",
        async plan(input, ctx) {
          const real = await PLANNERS.run_routine.plan(input, ctx);
          return { ...real, execute: async () => { throw new Error("device offline"); } };
        },
      }),
    ]);
    expect(planner).toBeDefined();
    const out = (await propose("run_routine", { routine: "bedtime" }, ASSISTANT_ACTOR, opts(minutesAfter(T0, 40)))) as GuardNeedsConfirmation;
    const remindersBefore = await count(t.db, "reminders");
    const err = await errorCode(confirmAction(out.action_id, CONSOLE_ACTOR, opts(minutesAfter(T0, 41))));
    expect(err.code).toBe("INTERNAL");
    expect(await count(t.db, "reminders")).toBe(remindersBefore);
    const row = await getPendingAction(t.db, out.action_id, minutesAfter(T0, 41));
    expect(row?.status).toBe("failed");
    expect(row?.error).toMatchObject({ code: "INTERNAL" });
    expect((await listAuditRows(t.db, { actionId: out.action_id })).map((r) => r.event)).toEqual(["failed", "proposed"]);
    expect((await verifyAuditChain(t.db)).intact).toBe(true);
  });

  it("runTool dispatches mutating, guard and registered read tools and converts errors", async () => {
    const ok = await runTool("add_chore", { title: "Clean the fridge", assign_to: "Rabia", due_date: "2026-10-07" }, CONSOLE_ACTOR, opts());
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.output).toMatchObject({ status: "executed", tool: "add_chore" });
      expect(ok.spoken).toBe("Added: clean the fridge, for Rabia, due in two days.");
    }

    const bad = await runTool("add_chore", { title: "" }, CONSOLE_ACTOR, opts());
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.error.code).toBe("VALIDATION");

    const missing = await runTool("mark_bill_paid", { bill: "Watr" }, ASSISTANT_ACTOR, opts());
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.error.code).toBe("NOT_FOUND");
      expect(missing.spoken).toMatch(/^I couldn't find a bill called Watr\. The unpaid bills are /);
    }

    const unregistered = await runTool("list_members", {}, ASSISTANT_ACTOR, opts());
    expect(unregistered.ok).toBe(false);
    if (!unregistered.ok) expect(unregistered.error.error.code).toBe("INTERNAL");

    registerToolDefinitions([
      defineReadTool({
        name: "list_members",
        kind: "read",
        title: "List members",
        description: "Lists the people in the household. Needs nothing.",
        inputSchema: z.object({}),
        outputSchema: z.object({ members: z.array(MemberSchema) }),
        async run(_input, ctx) {
          const members = await listMembers(ctx.db, ctx.household.id);
          return { output: { members }, spoken: `${members.length} people.` };
        },
      }),
    ]);
    const read = await runTool("list_members", {}, ASSISTANT_ACTOR, opts());
    expect(read.ok).toBe(true);
    if (read.ok) expect((read.output as { members: unknown[] }).members).toHaveLength(4);

    const queued = await runTool("mark_bill_paid", { bill: "School fees" }, ASSISTANT_ACTOR, opts());
    expect(queued.ok).toBe(true);
    const actionId = queued.ok ? (queued.output as GuardNeedsConfirmation).action_id : "";
    const confirmed = await runTool("confirm_action", { action_id: actionId }, ASSISTANT_ACTOR, opts(minutesAfter(T0, 1)));
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.output).toMatchObject({ status: "executed", action_id: actionId, idempotent_replay: false });
    const rejected = await runTool("reject_action", { action_id: actionId }, CONSOLE_ACTOR, opts(minutesAfter(T0, 2)));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.error.code).toBe("ACTION_NOT_PENDING");
    const notFound = await runTool("confirm_action", { action_id: "00000000-0000-4000-8000-000000000000" }, CONSOLE_ACTOR, opts());
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) expect(notFound.error.error.code).toBe("NOT_FOUND");
  });

  it("keeps the audit chain intact after everything above", async () => {
    const v = await verifyAuditChain(t.db);
    expect(v.intact).toBe(true);
    expect(v.rows).toBeGreaterThan(15);
  });
});

describe("guard without a household", () => {
  it("answers HOUSEHOLD_EMPTY", async () => {
    const t = await openTestDb();
    try {
      const out = await runTool("add_shopping_item", { name: "Milk" }, ASSISTANT_ACTOR, { db: t.db, now: T0 });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error.error.code).toBe("HOUSEHOLD_EMPTY");
    } finally {
      await t.close();
    }
  });
});
