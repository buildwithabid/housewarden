/**
 * npm run demo:client — the narrated walkthrough used to record the video.
 *
 * Talks to a running Housewarden over MCP (Streamable HTTP) exactly as an
 * assistant would, and prints, for each step, what the person says, which
 * tool is called with which arguments, what came back, and the spoken line
 * the assistant reads out.
 *
 *   npm run demo:client                      URL http://localhost:3000/api/mcp, token from .env.local
 *   npm run demo:client -- --auto-approve    say "yes" instead of waiting for the console
 *   npm run demo:client -- --bonus           add the "unlock the front door as Adlan" beat
 *   npm run demo:client -- --fast            no pauses
 *   --url=<endpoint> --token=<token> --pace=<ms>
 */
import type { Client } from "@modelcontextprotocol/client";
import { ENV, MCP_ENDPOINT_PATH } from "@/lib/contracts";
import { loadDotEnvLocal } from "./_env";
import { callTool, connectHousewarden, describeError, get, isRecord, type ToolReply } from "./_mcp";

interface Options {
  url: string;
  token: string;
  pace: number;
  autoApprove: boolean;
  bonus: boolean;
}

function parseArgs(argv: string[]): Options {
  loadDotEnvLocal();
  const opts: Options = {
    url: process.env.HOUSEWARDEN_URL ?? `http://localhost:${process.env.PORT ?? "3000"}${MCP_ENDPOINT_PATH}`,
    token: process.env[ENV.TOKEN] ?? "",
    pace: 1400,
    autoApprove: false,
    bonus: false,
  };
  for (const arg of argv) {
    if (arg === "--fast") opts.pace = 0;
    else if (arg === "--auto-approve") opts.autoApprove = true;
    else if (arg === "--bonus") opts.bonus = true;
    else if (arg.startsWith("--url=")) opts.url = arg.slice(6);
    else if (arg.startsWith("--token=")) opts.token = arg.slice(8);
    else if (arg.startsWith("--pace=")) opts.pace = Number(arg.slice(7)) || 0;
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Narration
// ---------------------------------------------------------------------------

const tty = process.stdout.isTTY === true && !process.env.NO_COLOR;
const ESC = String.fromCharCode(27);
const paint = (code: string) => (s: string) => (tty ? `${ESC}[${code}m${s}${ESC}[0m` : s);
const dim = paint("2");
const bold = paint("1");
const green = paint("32");
const amber = paint("33");
const red = paint("31");
const cyan = paint("36");

let pace = 0;
const pause = (factor = 1) => new Promise<void>((resolve) => setTimeout(resolve, pace * factor));

function heading(step: number, title: string): void {
  console.log(`\n${bold(`Step ${step} - ${title}`)}\n${dim("-".repeat(64))}`);
}
const you = (line: string) => console.log(`  ${cyan("You:     ")} "${line}"`);
const calling = (name: string, args: Record<string, unknown>) =>
  console.log(`  ${dim("Calling: ")} ${name} ${dim(JSON.stringify(args))}`);
const outcome = (line: string, tone: "ok" | "warn" | "bad" = "ok") =>
  console.log(`  ${dim("Result:  ")} ${tone === "ok" ? green(line) : tone === "warn" ? amber(line) : red(line)}`);
const alexa = (line: string) => console.log(`  ${green("Alexa:   ")} "${line}"`);
const note = (line: string) => console.log(`  ${dim("         ")} ${dim(line)}`);

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolReply> {
  calling(name, args);
  await pause(0.5);
  const reply = await callTool(client, name, args);
  if (reply.isError) outcome(describeError(reply.data, "error"), "bad");
  return reply;
}

function previewLines(data: Record<string, unknown>): void {
  const changes = get(data, "preview.changes");
  if (Array.isArray(changes)) {
    for (const change of changes) if (isRecord(change)) note(`- ${String(change.line)}`);
  }
  const warnings = get(data, "preview.warnings");
  if (Array.isArray(warnings)) {
    for (const warning of warnings) note(`! ${String(warning)}`);
  }
}

function clock(iso: unknown): string {
  return typeof iso === "string" ? new Date(iso).toLocaleTimeString() : "?";
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function stepSummary(client: Client): Promise<string | undefined> {
  heading(1, "Ask for a summary");
  you("Alexa, ask Housewarden how the house is doing.");
  const r = await call(client, "get_household_summary");
  if (r.isError) return undefined;
  const counts = get(r.data, "counts");
  if (isRecord(counts)) {
    outcome(
      `${String(counts.bills_overdue)} overdue bill(s) - ${String(counts.chores_due_today)} chore(s) due today - ${String(counts.shopping_to_buy)} to buy - ${String(counts.pending_confirmations)} waiting for approval`,
    );
  }
  alexa(r.text);
  const overdue = get(r.data, "overdue_bills");
  if (Array.isArray(overdue) && overdue.length > 0 && isRecord(overdue[0]) && typeof overdue[0].id === "string") {
    return overdue[0].id;
  }
  return undefined;
}

async function stepPropose(client: Client, billRef: string): Promise<Record<string, unknown> | undefined> {
  heading(2, "Mark the overdue bill paid");
  you("Mark the electricity bill as paid.");
  const r = await call(client, "mark_bill_paid", { bill: billRef });
  if (r.isError) {
    note("Tip: the demo household is already past this step. Run `npm run seed -- --force` and start again.");
    return undefined;
  }
  const status = get(r.data, "status");
  if (status !== "needs_confirmation") {
    outcome(`status ${String(status)} - expected needs_confirmation (is mark_bill_paid still policy "confirm"?)`, "warn");
    alexa(r.text);
    return undefined;
  }
  outcome(
    `needs_confirmation - risk ${String(get(r.data, "risk"))} - expires ${clock(get(r.data, "expires_at"))} - nothing written yet`,
    "warn",
  );
  previewLines(r.data);
  note(String(get(r.data, "how_to_confirm")));
  alexa(r.text);
  return r.data;
}

async function waitForDecision(
  client: Client,
  actionId: string,
  expiresAt: string,
): Promise<{ event: string; actor: string } | undefined> {
  const deadline = Date.parse(expiresAt) + 5_000;
  while (Date.now() < deadline) {
    const log = await callTool(client, "get_audit_log", { action_id: actionId });
    const rows = get(log.data, "rows");
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!isRecord(row)) continue;
        const event = String(row.event);
        if (event === "executed" || event === "rejected" || event === "expired" || event === "failed") {
          const actor = isRecord(row.actor) ? String(row.actor.label) : "?";
          return { event, actor };
        }
      }
    }
    process.stdout.write(dim("."));
    await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
  }
  return undefined;
}

async function stepApprove(
  client: Client,
  proposal: Record<string, unknown>,
  opts: Options,
  consoleUrl: string,
): Promise<void> {
  heading(3, "The guard asks; a person approves");
  const actionId = String(proposal.action_id);
  const expiresAt = String(proposal.expires_at);
  if (opts.autoApprove) {
    await pause();
    you("Yes.");
    const r = await call(client, "confirm_action", { action_id: actionId });
    if (r.isError) return;
    outcome(
      `${String(get(r.data, "status"))} - executed once - idempotent_replay ${String(get(r.data, "idempotent_replay"))}`,
    );
    alexa(r.text);
    return;
  }
  note(`Open ${consoleUrl}/pending - the badge shows 1 waiting. The card lists the change lines above.`);
  note(`Tap Approve (or Reject). Waiting until ${clock(expiresAt)} `);
  const decision = await waitForDecision(client, actionId, expiresAt);
  console.log("");
  if (!decision) {
    outcome("expired - ask again for a fresh preview", "bad");
    return;
  }
  outcome(`${decision.event} by ${decision.actor}`, decision.event === "executed" ? "ok" : "warn");
  const changes = get(proposal, "preview.changes");
  const update = Array.isArray(changes)
    ? changes.find((c) => isRecord(c) && c.entity === "bill" && c.op === "update")
    : undefined;
  const billId = isRecord(update) && typeof update.id === "string" ? update.id : undefined;
  if (decision.event === "executed" && billId) {
    you("Did that go through?");
    const bill = await call(client, "get_bill", { bill: billId });
    if (!bill.isError) alexa(bill.text);
  }
}

async function stepVerify(client: Client, actionId: string | undefined): Promise<void> {
  heading(4, "The audit chain");
  you("Is the audit log intact?");
  const r = await call(client, "verify_audit_chain");
  if (r.isError) return;
  outcome(
    `intact ${String(get(r.data, "intact"))} - ${String(get(r.data, "rows"))} rows - head ${String(get(r.data, "last_hash")).slice(0, 12)}...`,
  );
  alexa(r.text);
  if (!actionId) return;
  const log = await call(client, "get_audit_log", { action_id: actionId });
  const rows = get(log.data, "rows");
  if (Array.isArray(rows)) {
    for (const row of [...rows].reverse()) {
      if (!isRecord(row)) continue;
      const actor = isRecord(row.actor) ? String(row.actor.label) : "?";
      note(
        `#${String(row.seq)}  ${String(row.event).padEnd(9)} ${actor.padEnd(10)} hash ${String(row.hash).slice(0, 12)}...  prev ${String(row.prev_hash).slice(0, 12)}...`,
      );
    }
  }
  alexa(log.text);
}

async function stepBonus(client: Client): Promise<void> {
  heading(5, "Bonus: a child asks to unlock the door");
  you("Unlock the front door. (asked by Adlan)");
  const r = await call(client, "set_device_state", { device: "Front door", state: { locked: false }, member: "Adlan" });
  if (r.isError) return;
  outcome(`${String(get(r.data, "status"))} - risk ${String(get(r.data, "risk"))}`, "warn");
  previewLines(r.data);
  alexa(r.text);
  const actionId = get(r.data, "action_id");
  if (typeof actionId === "string") {
    await pause();
    you("Never mind.");
    const rj = await call(client, "reject_action", { action_id: actionId, reason: "Demo: not now" });
    if (!rj.isError) alexa(rj.text);
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  pace = opts.pace;
  if (!opts.token) {
    console.error(
      "No token: set HOUSEWARDEN_TOKEN (or run `npm run dev` once to create .env.local), or pass --token=...",
    );
    process.exit(1);
  }
  const consoleUrl = new URL(opts.url).origin;
  console.log(`${bold("Housewarden demo")} - ${opts.url}${opts.autoApprove ? " (auto-approve)" : ""}`);

  let client: Client;
  try {
    client = await connectHousewarden({ url: opts.url, token: opts.token, clientName: "housewarden-demo" });
  } catch (err) {
    console.error(`Could not connect: ${err instanceof Error ? err.message : String(err)}`);
    console.error("Is the server running (`npm run dev`) and is the token the one in its .env.local?");
    process.exit(1);
  }
  const info = client.getServerVersion();
  note(`connected to ${info?.name ?? "server"} ${info?.version ?? ""} over Streamable HTTP`);

  try {
    await pause();
    const overdueId = await stepSummary(client);
    await pause(1.5);
    const proposal = await stepPropose(client, overdueId ?? "Electricity");
    await pause(1.5);
    if (proposal) await stepApprove(client, proposal, opts, consoleUrl);
    await pause(1.5);
    await stepVerify(client, proposal ? String(proposal.action_id) : undefined);
    if (opts.bonus) {
      await pause(1.5);
      await stepBonus(client);
    }
    console.log(`\n${bold("Ask, preview, approve, verify.")} ${dim("That is the whole idea.")}\n`);
  } finally {
    await client.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
