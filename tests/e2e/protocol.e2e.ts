/**
 * Housewarden — end-to-end protocol harness.
 *
 *   npm run e2e                       start `next dev` on a free port (3123 preferred)
 *                                     with a temporary PGlite, seed the demo family,
 *                                     run every check, stop the server, exit = failures
 *   BASE_URL=http://host:port HOUSEWARDEN_TOKEN=… npm run e2e
 *                                     drive an already running server instead
 *                                     (checks that need control of the server env are skipped;
 *                                     the run adds a shopping item and pays the overdue bill)
 *   E2E_VERBOSE=1                     show the server's own output
 *   E2E_NEXT_ARGS="--webpack"         extra arguments for `next dev` (Turbopack refuses a
 *                                     node_modules symlink that points outside the project;
 *                                     git worktrees that share node_modules need --webpack)
 *
 * What it proves, in order: the endpoint never falls open without a token; a
 * real @modelcontextprotocol/client connects with the 2025-11-25 handshake and
 * with version negotiation; tools/list is the 31-tool catalogue with input and
 * output schemas; reads work; a low-risk mutation executes at once and an
 * idempotency key replays it; dry_run writes nothing; a confirm-risk mutation
 * is queued, nothing is written until confirm_action, which executes exactly
 * once and replays idempotently; reject_action never runs; the audit chain
 * verifies; and the raw HTTP guard answers 403 / 401 / 405 / 400 as specified.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Client } from "@modelcontextprotocol/client";
import {
  DEFAULTS,
  ENV,
  HOW_TO_CONFIRM,
  JSONRPC_ERROR_FORBIDDEN_ORIGIN,
  JSONRPC_ERROR_NOT_CONFIGURED,
  JSONRPC_ERROR_UNAUTHORIZED,
  MCP_ENDPOINT_PATH,
  MCP_SERVER_INFO,
  READ_TOOL_NAMES,
  SEED_ACTOR,
  TOOL_NAMES,
} from "@/lib/contracts";
import { callTool, connectHousewarden, describeError, get, isRecord } from "../../scripts/_mcp";

// ---------------------------------------------------------------------------
// Check runner
// ---------------------------------------------------------------------------

type Status = "PASS" | "FAIL" | "SKIP";
interface Row {
  name: string;
  status: Status;
  ms: number;
  detail: string;
}
const rows: Row[] = [];

class SkipCheck extends Error {}
function skip(reason: string): never {
  throw new SkipCheck(reason);
}
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) skip(`${what} unavailable`);
  return value;
}

async function check(name: string, fn: () => Promise<string | void>): Promise<boolean> {
  const started = Date.now();
  try {
    const detail = await fn();
    rows.push({ name, status: "PASS", ms: Date.now() - started, detail: detail ?? "" });
    return true;
  } catch (err) {
    const ms = Date.now() - started;
    if (err instanceof SkipCheck) {
      rows.push({ name, status: "SKIP", ms, detail: err.message });
      return true;
    }
    rows.push({ name, status: "FAIL", ms, detail: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

const tty = process.stdout.isTTY === true && !process.env.NO_COLOR;
const ESC = String.fromCharCode(27);
const paint = (code: string) => (s: string) => (tty ? `${ESC}[${code}m${s}${ESC}[0m` : s);
const green = paint("32");
const red = paint("31");
const dim = paint("2");
const bold = paint("1");

function printTable(): { passed: number; failed: number; skipped: number } {
  const nameWidth = Math.min(66, Math.max(5, ...rows.map((r) => r.name.length)));
  console.log(`\n ${"#".padStart(2)}  ${"RESULT".padEnd(6)}  ${"CHECK".padEnd(nameWidth)}  ${"MS".padStart(6)}  DETAIL`);
  rows.forEach((r, i) => {
    const status = r.status === "PASS" ? green(r.status) : r.status === "FAIL" ? red(r.status) : dim(r.status);
    const pad = " ".repeat(6 - r.status.length);
    console.log(
      ` ${String(i + 1).padStart(2)}  ${status}${pad}  ${r.name.padEnd(nameWidth)}  ${String(r.ms).padStart(6)}  ${r.detail}`,
    );
  });
  const passed = rows.filter((r) => r.status === "PASS").length;
  const failed = rows.filter((r) => r.status === "FAIL").length;
  const skipped = rows.filter((r) => r.status === "SKIP").length;
  const summary = `${passed} passed, ${failed} failed, ${skipped} skipped`;
  console.log(`\n${failed === 0 ? green(bold(summary)) : red(bold(summary))}\n`);
  return { passed, failed, skipped };
}

// ---------------------------------------------------------------------------
// Raw HTTP helpers (no SDK) for the guard checks
// ---------------------------------------------------------------------------

interface RawOptions {
  token?: string;
  origin?: string;
  method?: "POST" | "GET" | "DELETE";
  headers?: Record<string, string>;
  timeoutMs?: number;
}
interface RawResponse {
  status: number;
  headers: Headers;
  json: unknown;
  text: string;
}

function initializeBody(): Record<string, unknown> {
  return {
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "housewarden-e2e-raw", version: "0.1.0" },
    },
  };
}

async function rawRpc(url: string, body: Record<string, unknown> | null, opts: RawOptions = {}): Promise<RawResponse> {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    ...(body ? { "content-type": "application/json" } : {}),
    ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    ...(opts.origin ? { origin: opts.origin } : {}),
    ...(opts.headers ?? {}),
  };
  const res = await fetch(url, {
    method: opts.method ?? "POST",
    headers,
    body: body ? JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json, text };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

interface RunningServer {
  child: ChildProcess;
  output: string[];
  stop(): Promise<void>;
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

async function pickPort(): Promise<number> {
  const preferred = Number(process.env.E2E_PORT) || DEFAULTS.E2E_PORT;
  if (await portFree(preferred)) return preferred;
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // already gone
  }
}

function startNext(port: number, env: NodeJS.ProcessEnv, verbose: boolean): RunningServer {
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const extraArgs = (process.env.E2E_NEXT_ARGS ?? "").split(/\s+/).filter(Boolean);
  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port), "-H", "127.0.0.1", ...extraArgs], {
    env,
    stdio: verbose ? "inherit" : ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const output: string[] = [];
  const capture = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (line.trim()) output.push(line);
    }
    if (output.length > 80) output.splice(0, output.length - 80);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return {
    child,
    output,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      killTree(child, "SIGTERM");
      const timeout = sleep(8_000).then(() => "timeout" as const);
      if ((await Promise.race([exited, timeout])) === "timeout") {
        killTree(child, "SIGKILL");
        await exited;
      }
    },
  };
}

async function waitForEndpoint(url: string, accept: number[], timeoutMs: number, server: RunningServer): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = "no response yet";
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`server exited with code ${server.child.exitCode}\n${server.output.slice(-20).join("\n")}`);
    }
    try {
      const res = await rawRpc(url, { method: "ping" }, { timeoutMs: 20_000 });
      if (accept.includes(res.status)) return res.status;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(500);
  }
  throw new Error(
    `${url} not ready after ${Math.round(timeoutMs / 1000)}s (last: ${last})\n${server.output.slice(-20).join("\n")}`,
  );
}

// ---------------------------------------------------------------------------
// Small readers over structured content
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const short = (id: unknown) => (typeof id === "string" ? id.slice(0, 8) : String(id));

function ok(reply: { isError: boolean; data: Record<string, unknown> }, what: string): void {
  expect(!reply.isError, `${what} returned an error: ${describeError(reply.data, JSON.stringify(reply.data))}`);
}

async function auditTotal(client: Client): Promise<number> {
  const r = await callTool(client, "get_audit_log", { limit: 1 });
  ok(r, "get_audit_log");
  const total = get(r.data, "total_rows");
  expect(typeof total === "number", "get_audit_log.total_rows missing");
  return total;
}

async function pendingCount(client: Client): Promise<number> {
  const r = await callTool(client, "list_pending_actions");
  ok(r, "list_pending_actions");
  const count = get(r.data, "pending_count");
  expect(typeof count === "number", "list_pending_actions.pending_count missing");
  return count;
}

function auditEvents(data: Record<string, unknown>): string[] {
  const list = get(data, "rows");
  if (!Array.isArray(list)) return [];
  return list.map((row) => (isRecord(row) ? String(row.event) : "?"));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const external = process.env.BASE_URL?.trim();
  const verbose = process.env.E2E_VERBOSE === "1";
  const runId = randomBytes(4).toString("hex");
  let server: RunningServer | undefined;
  let tmpDir: string | undefined;
  let legacy: Client | undefined;
  let modern: Client | undefined;

  const cleanup = async () => {
    await Promise.allSettled([legacy?.close(), modern?.close()]);
    legacy = undefined;
    modern = undefined;
    await server?.stop();
    server = undefined;
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  };
  process.once("SIGINT", () => {
    void cleanup().finally(() => process.exit(130));
  });

  let baseUrl: string;
  let token: string;
  let port = 0;
  let serverEnv: NodeJS.ProcessEnv = process.env;
  let allowedOrigin = "";

  if (external) {
    baseUrl = external.replace(/\/+$/, "").replace(new RegExp(`${MCP_ENDPOINT_PATH}$`), "");
    token = process.env[ENV.TOKEN] ?? "";
    if (!token) {
      console.error("BASE_URL is set but HOUSEWARDEN_TOKEN is empty; the harness needs the server's bearer token.");
      return 1;
    }
  } else {
    port = await pickPort();
    baseUrl = `http://127.0.0.1:${port}`;
    allowedOrigin = `http://localhost:${port}`;
    token = `hw_e2e_${randomBytes(24).toString("hex")}`;
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "housewarden-e2e-"));
    serverEnv = {
      ...process.env,
      [ENV.DB]: "pglite",
      [ENV.DATA_DIR]: path.join(tmpDir, "pglite"),
      [ENV.TOKEN]: token,
      [ENV.ADMIN_SECRET]: "e2e-admin-secret-not-secret",
      [ENV.ALLOWED_ORIGINS]: allowedOrigin,
      [ENV.CONFIRM_TTL_SECONDS]: "600",
      [ENV.MCP_APP]: "0",
      PORT: String(port),
      NEXT_TELEMETRY_DISABLED: "1",
    };
  }
  const endpoint = `${baseUrl}${MCP_ENDPOINT_PATH}`;
  console.log(
    `${bold("Housewarden e2e")} — ${endpoint}${external ? " (external server)" : ` (temporary PGlite in ${tmpDir})`}`,
  );

  try {
    // -- 0. Seed a fresh demo household (own server only) --------------------
    const seeded = await check("seed the demo household into a temporary PGlite", async () => {
      if (external) skip("external server is assumed to be seeded");
      for (const key of [ENV.DB, ENV.DATA_DIR, ENV.TOKEN, ENV.ADMIN_SECRET, ENV.TIMEZONE, ENV.CURRENCY]) {
        const value = serverEnv[key];
        if (value !== undefined) process.env[key] = value;
      }
      const { getDb, closeDb } = await import("@/lib/db");
      const { seedDemo } = await import("@/lib/seed");
      const db = await getDb();
      try {
        await seedDemo(db, SEED_ACTOR);
      } finally {
        await closeDb();
      }
      return `Ali family in ${serverEnv[ENV.DATA_DIR]}`;
    });
    if (!seeded) return printTable().failed;

    // -- 1. Never fall open --------------------------------------------------
    await check("HOUSEWARDEN_TOKEN unset → 503, never falls open", async () => {
      if (external) skip("needs control of the server environment");
      const unconfigured = startNext(port, { ...serverEnv, [ENV.TOKEN]: "" }, verbose);
      try {
        const status = await waitForEndpoint(endpoint, [503, 401, 200], 180_000, unconfigured);
        expect(status === 503, `expected 503 with an empty token, got ${status}`);
        const res = await rawRpc(endpoint, initializeBody(), { token: "hw_anything_0123456789abcdef" });
        expect(res.status === 503, `initialize with a token still got ${res.status}, expected 503`);
        expect(
          get(res.json, "error.code") === JSONRPC_ERROR_NOT_CONFIGURED,
          `error.code ${String(get(res.json, "error.code"))}, expected ${JSONRPC_ERROR_NOT_CONFIGURED}`,
        );
        return `503, JSON-RPC error ${JSONRPC_ERROR_NOT_CONFIGURED}`;
      } finally {
        await unconfigured.stop();
      }
    });

    // -- 2. Start the real server --------------------------------------------
    const started = await check(external ? "reach the external server" : "start next dev with a token", async () => {
      if (!external) server = startNext(port, serverEnv, verbose);
      const probe: RunningServer = server ?? {
        child: { exitCode: null } as ChildProcess,
        output: [],
        stop: async () => undefined,
      };
      const status = await waitForEndpoint(endpoint, [401], 180_000, probe);
      return `unauthenticated ping → ${status}`;
    });
    if (!started) return printTable().failed;

    // -- 3. Initialize, both protocol eras -----------------------------------
    await check("initialize — plain 2025-11-25 handshake (legacy mode)", async () => {
      legacy = await connectHousewarden({ url: endpoint, token, mode: "legacy", clientName: "housewarden-e2e-legacy" });
      const info = legacy.getServerVersion();
      expect(info?.name === MCP_SERVER_INFO.name, `serverInfo.name is ${String(info?.name)}`);
      expect(legacy.getServerCapabilities()?.tools !== undefined, "tools capability not advertised");
      const instructions = legacy.getInstructions() ?? "";
      expect(instructions.includes("confirm_action"), "server instructions do not mention confirm_action");
      return `${info?.name} ${info?.version}, instructions ${instructions.length} chars`;
    });
    await check("initialize — version negotiation auto (probe for 2026-07-28)", async () => {
      modern = await connectHousewarden({ url: endpoint, token, mode: "auto", clientName: "housewarden-e2e-auto" });
      const { tools } = await modern.listTools();
      expect(tools.length > 0, "no tools listed over the negotiated connection");
      const info = modern.getServerVersion();
      return `${tools.length} tools, server ${info?.name ?? "(name not surfaced)"}`;
    });

    // -- 4. Catalogue --------------------------------------------------------
    await check("tools/list — 31 tools, each with input schema, output schema, title, hints", async () => {
      const c = need(legacy, "legacy connection");
      const { tools } = await c.listTools();
      const names = tools.map((t) => t.name).sort();
      const wanted: readonly string[] = [...TOOL_NAMES].sort();
      const missing = wanted.filter((n) => !names.includes(n));
      const extra = names.filter((n) => !wanted.includes(n));
      expect(
        tools.length === 31 && missing.length === 0 && extra.length === 0,
        `got ${tools.length} tools; missing [${missing.join(", ")}] extra [${extra.join(", ")}]`,
      );
      const problems: string[] = [];
      const readNames: readonly string[] = READ_TOOL_NAMES;
      for (const tool of tools) {
        if (!isRecord(tool.inputSchema) || tool.inputSchema.type !== "object") problems.push(`${tool.name}: inputSchema`);
        if (!isRecord(tool.outputSchema)) problems.push(`${tool.name}: outputSchema`);
        if (!tool.title) problems.push(`${tool.name}: title`);
        if (!tool.description || tool.description.trim().length < 20) problems.push(`${tool.name}: description`);
        const readOnly = tool.annotations?.readOnlyHint === true;
        if (readNames.includes(tool.name) !== readOnly) problems.push(`${tool.name}: readOnlyHint`);
      }
      expect(problems.length === 0, problems.join("; "));
      return "12 read + 17 mutating + 2 guard, schemas and annotations present";
    });
    await check("tools/list — the same 31 over the negotiated connection", async () => {
      const c = need(modern, "negotiated connection");
      const { tools } = await c.listTools();
      const names = new Set(tools.map((t) => t.name));
      const missing = TOOL_NAMES.filter((n) => !names.has(n));
      expect(tools.length === 31 && missing.length === 0, `got ${tools.length}; missing [${missing.join(", ")}]`);
    });

    // -- 5. Read -------------------------------------------------------------
    await check("read — get_household_summary on both connections", async () => {
      let spoken = "";
      for (const c of [need(legacy, "legacy connection"), need(modern, "negotiated connection")]) {
        const r = await callTool(c, "get_household_summary");
        ok(r, "get_household_summary");
        const name = get(r.data, "household.name");
        expect(typeof name === "string" && name.length > 0, "household.name missing");
        if (!external) {
          expect(name === "Ali family", `household.name is ${String(name)}`);
          const overdue = get(r.data, "counts.bills_overdue");
          expect(overdue === 1, `counts.bills_overdue is ${String(overdue)}`);
        }
        expect(r.text.length > 0, "no spoken line in content[0]");
        spoken = r.text;
      }
      return `"${spoken}"`;
    });

    const client = legacy;
    const itemName = `E2E bread ${runId}`;
    const idempotencyKey = `e2e-${runId}`;
    let firstActionId: string | undefined;

    // -- 6. Low-risk mutation -------------------------------------------------
    await check("low-risk mutation — add_shopping_item executes immediately", async () => {
      const c = need(client, "connection");
      const r = await callTool(c, "add_shopping_item", {
        name: itemName,
        qty: "1",
        category: "Bakery",
        idempotency_key: idempotencyKey,
      });
      ok(r, "add_shopping_item");
      expect(get(r.data, "status") === "executed", `status ${String(get(r.data, "status"))}`);
      expect(get(r.data, "risk") === "low", `risk ${String(get(r.data, "risk"))}`);
      expect(get(r.data, "idempotent_replay") === false, "idempotent_replay should be false");
      expect(get(r.data, "result.item.name") === itemName, "result.item.name mismatch");
      const actionId = get(r.data, "action_id");
      expect(typeof actionId === "string" && UUID.test(actionId), "action_id is not a uuid");
      firstActionId = actionId;
      const list = await callTool(c, "list_shopping");
      ok(list, "list_shopping");
      const items = get(list.data, "items");
      expect(Array.isArray(items) && items.some((i) => isRecord(i) && i.name === itemName), "item not in list_shopping");
      return `executed, action ${short(actionId)}; "${r.text}"`;
    });

    await check("idempotency_key — repeating the call replays instead of acting twice", async () => {
      const c = need(client, "connection");
      const r = await callTool(c, "add_shopping_item", {
        name: itemName,
        qty: "1",
        category: "Bakery",
        idempotency_key: idempotencyKey,
      });
      ok(r, "add_shopping_item (replay)");
      expect(get(r.data, "status") === "executed", `status ${String(get(r.data, "status"))}`);
      expect(get(r.data, "idempotent_replay") === true, "idempotent_replay should be true");
      expect(get(r.data, "action_id") === need(firstActionId, "first action id"), "replay returned a different action_id");
      const list = await callTool(c, "list_shopping");
      const items = get(list.data, "items");
      const copies = Array.isArray(items) ? items.filter((i) => isRecord(i) && i.name === itemName).length : 0;
      expect(copies === 1, `${copies} copies of the item after replay`);
      return `same action ${short(firstActionId)}, one item`;
    });

    // -- 7. Dry run ------------------------------------------------------------
    await check("dry_run — preview only, nothing queued, nothing audited", async () => {
      const c = need(client, "connection");
      const auditBefore = await auditTotal(c);
      const pendingBefore = await pendingCount(c);
      const r = await callTool(c, "mark_bill_paid", { bill: "Electricity", dry_run: true });
      ok(r, "mark_bill_paid dry_run");
      expect(get(r.data, "status") === "dry_run", `status ${String(get(r.data, "status"))}`);
      expect(get(r.data, "would_require_confirmation") === true, "would_require_confirmation should be true");
      const changes = get(r.data, "preview.changes");
      expect(Array.isArray(changes) && changes.length >= 1, "preview has no changes");
      expect((await auditTotal(c)) === auditBefore, "audit log grew during a dry run");
      expect((await pendingCount(c)) === pendingBefore, "a pending action appeared during a dry run");
      return `${changes.length} change line(s), audit ${auditBefore} rows unchanged`;
    });

    // -- 8. Confirm-risk mutation ---------------------------------------------
    let actionId: string | undefined;
    let billId: string | undefined;
    await check("confirm-risk mutation — mark_bill_paid returns needs_confirmation", async () => {
      const c = need(client, "connection");
      const r = await callTool(c, "mark_bill_paid", { bill: "Electricity" });
      ok(r, "mark_bill_paid");
      expect(get(r.data, "status") === "needs_confirmation", `status ${String(get(r.data, "status"))}`);
      expect(get(r.data, "risk") === "confirm", `risk ${String(get(r.data, "risk"))}`);
      const id = get(r.data, "action_id");
      expect(typeof id === "string" && UUID.test(id), "action_id is not a uuid");
      actionId = id;
      const expiresAt = get(r.data, "expires_at");
      expect(
        typeof expiresAt === "string" && Date.parse(expiresAt) > Date.now(),
        `expires_at ${String(expiresAt)} is not in the future`,
      );
      expect(get(r.data, "how_to_confirm") === HOW_TO_CONFIRM, "how_to_confirm text differs from the contract");
      const changes = get(r.data, "preview.changes");
      expect(Array.isArray(changes), "preview.changes missing");
      const update = changes.find((ch) => isRecord(ch) && ch.entity === "bill" && ch.op === "update");
      expect(isRecord(update) && typeof update.id === "string", "no bill update change in the preview");
      billId = update.id;
      expect(r.text.length > 0, "no spoken line");
      return `action ${short(id)}, ${changes.length} change line(s); "${r.text}"`;
    });

    await check("nothing written before confirmation — bill unpaid, action pending, audit [proposed]", async () => {
      const c = need(client, "connection");
      const id = need(actionId, "action id");
      const bill = await callTool(c, "get_bill", { bill: need(billId, "bill id") });
      ok(bill, "get_bill");
      expect(
        get(bill.data, "bill.status") !== "paid" && get(bill.data, "bill.paid_at") === null,
        "bill already paid before confirmation",
      );
      const pending = await callTool(c, "list_pending_actions");
      ok(pending, "list_pending_actions");
      const actions = get(pending.data, "actions");
      expect(
        Array.isArray(actions) && actions.some((a) => isRecord(a) && a.id === id && a.status === "pending"),
        "action is not listed as pending",
      );
      const log = await callTool(c, "get_audit_log", { action_id: id });
      ok(log, "get_audit_log");
      const events = auditEvents(log.data);
      expect(events.length === 1 && events[0] === "proposed", `audit events for the action: [${events.join(", ")}]`);
      return "bill unpaid, 1 pending, audit [proposed]";
    });

    await check("confirm_action — executes exactly once", async () => {
      const c = need(client, "connection");
      const id = need(actionId, "action id");
      const r = await callTool(c, "confirm_action", { action_id: id });
      ok(r, "confirm_action");
      expect(get(r.data, "status") === "executed", `status ${String(get(r.data, "status"))}`);
      expect(get(r.data, "idempotent_replay") === false, "first confirm reported idempotent_replay: true");
      expect(get(r.data, "action_id") === id, "action_id mismatch");
      expect(get(r.data, "result.bill.status") === "paid", "result.bill.status is not paid");
      const bill = await callTool(c, "get_bill", { bill: need(billId, "bill id") });
      ok(bill, "get_bill");
      expect(get(bill.data, "bill.status") === "paid", "bill not paid after confirmation");
      const next = get(r.data, "result.next_bill");
      return `paid; next occurrence ${isRecord(next) ? String(next.due_date) : "none"}; "${r.text}"`;
    });

    await check("confirm_action again — idempotent replay, no second execution", async () => {
      const c = need(client, "connection");
      const id = need(actionId, "action id");
      const r = await callTool(c, "confirm_action", { action_id: id });
      ok(r, "confirm_action (repeat)");
      expect(get(r.data, "status") === "executed", `status ${String(get(r.data, "status"))}`);
      expect(get(r.data, "idempotent_replay") === true, "repeat confirm did not report idempotent_replay");
      expect(get(r.data, "action_id") === id, "action_id mismatch");
      const log = await callTool(c, "get_audit_log", { action_id: id });
      const events = auditEvents(log.data).sort();
      expect(events.join(",") === "executed,proposed", `audit events [${events.join(", ")}], expected exactly proposed + executed`);
      return "replayed; audit still [proposed, executed]";
    });

    // -- 9. Reject -------------------------------------------------------------
    await check("reject_action — a declined proposal never runs", async () => {
      const c = need(client, "connection");
      const proposal = await callTool(c, "clear_shopping_list", {});
      if (proposal.isError && get(proposal.data, "error.code") === "ALREADY_DONE") skip("no checked items to clear");
      ok(proposal, "clear_shopping_list");
      expect(get(proposal.data, "status") === "needs_confirmation", `status ${String(get(proposal.data, "status"))}`);
      const id = get(proposal.data, "action_id");
      expect(typeof id === "string", "action_id missing");
      const r = await callTool(c, "reject_action", { action_id: id, reason: "e2e: not now" });
      ok(r, "reject_action");
      expect(get(r.data, "status") === "rejected", `status ${String(get(r.data, "status"))}`);
      expect(get(r.data, "reason") === "e2e: not now", "reason not echoed");
      const list = await callTool(c, "list_shopping", { include_checked: true });
      const items = get(list.data, "items");
      expect(
        Array.isArray(items) && items.some((i) => isRecord(i) && i.checked === true),
        "checked items were removed despite the rejection",
      );
      const log = await callTool(c, "get_audit_log", { action_id: id });
      const events = auditEvents(log.data).sort();
      expect(events.join(",") === "proposed,rejected", `audit events [${events.join(", ")}]`);
      return `rejected ${short(id)}; "${r.text}"`;
    });

    // -- 10. Chain -------------------------------------------------------------
    await check("verify_audit_chain — intact", async () => {
      const c = need(client, "connection");
      const r = await callTool(c, "verify_audit_chain");
      ok(r, "verify_audit_chain");
      expect(
        get(r.data, "intact") === true,
        `intact is ${String(get(r.data, "intact"))} (${String(get(r.data, "reason"))} at #${String(get(r.data, "first_bad_seq"))})`,
      );
      const total = get(r.data, "rows");
      expect(typeof total === "number" && total >= 5, `rows ${String(total)}`);
      expect(get(r.data, "last_seq") === total, "last_seq != rows");
      return `intact, ${total} rows, head ${short(get(r.data, "last_hash"))}; "${r.text}"`;
    });

    // -- 11. Raw HTTP guard ------------------------------------------------------
    await check("HTTP — Origin present and not allow-listed → 403", async () => {
      const res = await rawRpc(endpoint, initializeBody(), { token, origin: "http://evil.test" });
      expect(res.status === 403, `got ${res.status}`);
      expect(
        get(res.json, "error.code") === JSONRPC_ERROR_FORBIDDEN_ORIGIN,
        `error.code ${String(get(res.json, "error.code"))}`,
      );
      return `403, JSON-RPC error ${JSONRPC_ERROR_FORBIDDEN_ORIGIN}`;
    });
    await check("HTTP — Origin on the allow-list → accepted", async () => {
      if (external) skip("allow-list of an external server is unknown");
      const res = await rawRpc(endpoint, initializeBody(), { token, origin: allowedOrigin });
      expect(res.status === 200, `got ${res.status}`);
      return `200 for Origin ${allowedOrigin}`;
    });
    await check("HTTP — missing bearer → 401 with WWW-Authenticate", async () => {
      const res = await rawRpc(endpoint, initializeBody(), {});
      expect(res.status === 401, `got ${res.status}`);
      const challenge = res.headers.get("www-authenticate") ?? "";
      expect(challenge.toLowerCase().startsWith("bearer"), `WWW-Authenticate is "${challenge}"`);
      expect(get(res.json, "error.code") === JSONRPC_ERROR_UNAUTHORIZED, `error.code ${String(get(res.json, "error.code"))}`);
      return `401, ${challenge}`;
    });
    await check("HTTP — wrong bearer → 401", async () => {
      const res = await rawRpc(endpoint, initializeBody(), { token: `hw_${"0".repeat(64)}` });
      expect(res.status === 401, `got ${res.status}`);
      expect(get(res.json, "error.code") === JSONRPC_ERROR_UNAUTHORIZED, `error.code ${String(get(res.json, "error.code"))}`);
    });
    await check("HTTP — GET without a session → 405 (stateless serving)", async () => {
      const res = await rawRpc(endpoint, null, { token, method: "GET", headers: { accept: "text/event-stream" } });
      expect(res.status === 405, `got ${res.status}`);
    });
    await check("HTTP — unsupported MCP-Protocol-Version header → 400", async () => {
      const res = await rawRpc(
        endpoint,
        { method: "tools/list", params: {} },
        { token, headers: { "mcp-protocol-version": "1999-01-01" } },
      );
      expect(res.status === 400, `got ${res.status}`);
    });
  } finally {
    await cleanup();
  }

  return printTable().failed;
}

main()
  .then((failures) => process.exit(Math.min(failures, 255)))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
