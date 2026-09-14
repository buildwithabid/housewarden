#!/usr/bin/env node
/**
 * demo/record.mjs — drives the four-step demo storyline against a running
 * Housewarden and either verifies it (--check) or records the demo video.
 *
 * The stage (demo/stage.html) is served on the console's own origin through a
 * Playwright route, so the console runs live inside a same-origin iframe under
 * a burned-in caption bar, and an MCP client (@modelcontextprotocol/client over
 * Streamable HTTP) is replayed line by line into a terminal panel. Every line
 * the terminal shows is a real request and a real response.
 *
 *   HOUSEWARDEN_URL=http://localhost:3124 HOUSEWARDEN_TOKEN=… HOUSEWARDEN_ADMIN_SECRET=… \
 *   PLAYWRIGHT_DIR=/path/to/node_modules node demo/record.mjs [--check]
 *
 *   --check   no capture, no pauses; prints a pass/fail table and exits non-zero on failure
 *
 * Video mode captures frames through the Chrome DevTools screencast with their
 * exact timestamps (Playwright's own recorder drifts on idle pages) into
 * demo/raw/frames/ (git-ignored) and writes demo/raw/frames/list.txt, an ffmpeg
 * concat list with per-frame durations, plus demo/raw/marks.json (caption
 * timings for demo/script.md) and demo/thumbnail.png. demo/script.md has the
 * ffmpeg command that turns the list into demo/housewarden-demo.mp4.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const playwrightDir = process.env.PLAYWRIGHT_DIR ?? path.join(root, "node_modules");
const { chromium } = require(path.join(playwrightDir, "playwright"));

const CHECK = process.argv.includes("--check");
const BASE = (process.env.HOUSEWARDEN_URL ?? "http://localhost:3124").replace(/\/+$/, "");
const TOKEN = process.env.HOUSEWARDEN_TOKEN ?? "";
const SECRET = process.env.HOUSEWARDEN_ADMIN_SECRET ?? "";
const RAW_DIR = path.join(root, "demo", "raw");
const FRAMES_DIR = path.join(RAW_DIR, "frames");
const STAGE_URL = `${BASE}/__demo/stage`;

if (!TOKEN || !SECRET) {
  console.error("Set HOUSEWARDEN_TOKEN and HOUSEWARDEN_ADMIN_SECRET (the running server's values).");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Pacing, checks and timing marks
// ---------------------------------------------------------------------------

const pace = CHECK ? 0 : 1;
const wait = (ms) => new Promise((r) => setTimeout(r, ms * pace));
const results = [];
const marks = [];
let showStart = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  else console.log(`ok    ${name}${detail ? ` — ${detail}` : ""}`);
}

function mark(label) {
  const t = showStart ? (Date.now() - showStart) / 1000 : 0;
  marks.push({ t: Number(t.toFixed(1)), label });
}

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Frame capture (video mode): CDP screencast, one PNG per changed frame, exact timestamps
// ---------------------------------------------------------------------------

async function startCapture(page) {
  rmSync(FRAMES_DIR, { recursive: true, force: true });
  mkdirSync(FRAMES_DIR, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let n = 0;
  cdp.on("Page.screencastFrame", (ev) => {
    const file = path.join(FRAMES_DIR, `f${String(n).padStart(5, "0")}.png`);
    n += 1;
    writeFileSync(file, Buffer.from(ev.data, "base64"));
    frames.push({ file, t: ev.metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => undefined);
  });
  await cdp.send("Page.startScreencast", { format: "png", maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  return {
    frames,
    stop: async (endEpochSeconds) => {
      await cdp.send("Page.stopScreencast").catch(() => undefined);
      await new Promise((r) => setTimeout(r, 300));
      await cdp.detach().catch(() => undefined);
      const lines = ["ffconcat version 1.0"];
      for (let i = 0; i < frames.length; i += 1) {
        const next = i + 1 < frames.length ? frames[i + 1].t : endEpochSeconds;
        const d = Math.max(next - frames[i].t, 0.001);
        lines.push(`file '${path.basename(frames[i].file)}'`, `duration ${d.toFixed(4)}`);
      }
      if (frames.length) lines.push(`file '${path.basename(frames[frames.length - 1].file)}'`);
      writeFileSync(path.join(FRAMES_DIR, "list.txt"), `${lines.join("\n")}\n`);
      return frames.length;
    },
  };
}

// ---------------------------------------------------------------------------
// MCP client
// ---------------------------------------------------------------------------

async function connect() {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
    authProvider: { token: async () => TOKEN },
  });
  const client = new Client({ name: "housewarden-demo-video", version: "0.1.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);
  const protocol = typeof transport.protocolVersion === "string" ? transport.protocolVersion : "2025-11-25";
  return { client, protocol };
}

async function callTool(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.find((b) => b.type === "text")?.text ?? "";
  const data = isRecord(res.structuredContent) ? res.structuredContent : {};
  return { text, data, isError: res.isError === true };
}

// ---------------------------------------------------------------------------
// Stage helpers (everything visible goes through window.hw in demo/stage.html)
// ---------------------------------------------------------------------------

function stage(page) {
  const call = (fn, ...args) => page.evaluate(([f, a]) => window.hw[f](...a), [fn, args]);
  return {
    mode: (m) => call("setMode", m),
    caption: async (tag, text) => {
      mark(`${tag ? `[${tag}] ` : ""}${text}`);
      await call("caption", tag, text);
    },
    line: (kind, prefix, text, typed = false) => call("line", kind, prefix, text, typed && !CHECK),
    clear: () => call("clearTerm"),
    termTitle: (t) => call("setTermTitle", t),
    title: (tag, sub) => call("titleSlide", tag, sub),
    blank: () => call("blankSlide"),
    built: (items, right) => call("builtSlide", items, right),
    reveal: (n) => call("revealBuilt", n),
    repo: () => call("repoSlide"),
  };
}

async function say(st, text) {
  await st.line("you", "You:", `"${text}"`, true);
  await wait(600);
}
async function calling(st, name, args) {
  await st.line("call", "Calling:", `${name} ${JSON.stringify(args)}`);
  await wait(500);
}
async function alexa(st, text) {
  await st.line("alexa", "Alexa:", `"${text}"`);
}
function clock(iso) {
  return typeof iso === "string" ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "?";
}
async function previewLines(st, data) {
  const changes = data.preview?.changes;
  if (Array.isArray(changes)) for (const c of changes) if (isRecord(c)) await st.line("note", "", `  - ${c.line}`);
  const warnings = data.preview?.warnings;
  if (Array.isArray(warnings)) for (const w of warnings) await st.line("warn", "", `  ! ${w}`);
}

// ---------------------------------------------------------------------------
// Console helpers (inside the iframe)
// ---------------------------------------------------------------------------

async function consoleFrame(page) {
  for (let i = 0; i < 50; i += 1) {
    const f = page.frame({ name: "console" });
    if (f) return f;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("console iframe not found");
}

async function login(frame) {
  await frame.waitForURL(/\/login/);
  await frame.locator("#secret").fill(SECRET);
  await frame.getByRole("button", { name: "Sign in" }).click();
  await frame.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function ensureDemoData(frame) {
  await frame.goto(`${BASE}/`);
  const empty = frame.getByRole("button", { name: "Load demo data" });
  if (await empty.count()) {
    await empty.first().click();
    await frame.waitForURL(/flash=/);
    check("console: Load demo data seeds the Ali family", /Loaded the/.test(await frame.locator("main").innerText()));
  } else {
    check("console: household already present", true);
  }
  await frame.locator("main").getByText("Ali family").first().waitFor();
}

/** Navigates the iframe to /pending and returns the card for the given summary (call while the iframe is covered). */
async function openPending(frame, summaryFragment) {
  await frame.goto(`${BASE}/pending`);
  const card = frame.locator("article.confirmation-card", { hasText: summaryFragment }).first();
  await card.waitFor({ timeout: 15_000 });
  return card;
}

async function approve(frame, card) {
  await card.getByRole("button", { name: "Approve" }).click();
  await frame.waitForURL(/flash=/, { timeout: 20_000 });
  return frame.locator("body").innerText();
}

// ---------------------------------------------------------------------------
// The storyline
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(RAW_DIR, { recursive: true });
  const stageHtml = readFileSync(path.join(root, "demo", "stage.html"), "utf8");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, colorScheme: "light" });
  const page = await context.newPage();
  await page.route(`${STAGE_URL}*`, (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: stageHtml }));
  const st = stage(page);

  let client = null;
  let capture = null;
  try {
    // --- 0:00 Title, while the console logs in and seeds behind it ---------
    await page.goto(STAGE_URL);
    await st.title("Every household action: previewed, confirmed, audited.", "A self-hosted MCP server for Alexa+ and any MCP host");
    if (!CHECK) capture = await startCapture(page);
    showStart = Date.now();
    await st.caption("", "A home assistant is about to be handed real actions.");
    const frame = await consoleFrame(page);
    await login(frame);
    check("console: login with HOUSEWARDEN_ADMIN_SECRET", true);
    await ensureDemoData(frame);
    const nav = await frame.locator("aside").innerText();
    check("console: sidebar refreshed after loading demo data", /Household: Ali family/.test(nav) && !/No household yet/.test(nav), nav.replace(/\s+/g, " ").slice(0, 80));
    await wait(1500);

    // --- Dashboard with the thesis -----------------------------------------
    await st.mode("console");
    await st.caption("", "A home assistant is about to be handed real actions. Housewarden shows what will change, asks, and keeps a tamper-evident record.");
    const dash0 = await frame.locator("main").innerText();
    check("console: dashboard shows the seeded household", /Ali family/.test(dash0));
    check("console: dashboard shows the audit chain intact", /chain intact/i.test(dash0));
    await wait(10_000);

    // --- The MCP client connects -------------------------------------------
    const conn = await connect();
    client = conn.client;
    const info = client.getServerVersion();
    check("mcp: client connected over Streamable HTTP", Boolean(info?.name), `${info?.name} ${info?.version}, protocol ${conn.protocol}`);
    const tools = await client.listTools();
    check("mcp: tools/list has 31 tools", tools.tools.length === 31, `${tools.tools.length} tools`);

    await st.mode("terminal");
    await st.termTitle(`npm run demo:client — @modelcontextprotocol/client → ${BASE}/api/mcp (Streamable HTTP, MCP ${conn.protocol})`);
    await st.caption("Live demo", "An MCP client connects over Streamable HTTP with a bearer token — the way Alexa+ talks to a self-hosted server.");
    await st.line("dim", "", `connected to ${info?.name ?? "housewarden"} ${info?.version ?? ""} · protocol ${conn.protocol} · ${tools.tools.length} tools`);
    await wait(3200);

    // --- Step 1: summary ---------------------------------------------------
    await st.line("head", "", "Step 1 — Ask for a summary");
    await st.caption("Step 1 of 4", "Ask for a summary. Reads are free: no confirmation, no side effects, one spoken sentence.");
    await say(st, "Alexa, ask Housewarden how the house is doing.");
    await calling(st, "get_household_summary", {});
    const summary = await callTool(client, "get_household_summary");
    const counts = summary.data.counts ?? {};
    check("mcp: get_household_summary answers", !summary.isError && typeof summary.text === "string", summary.text);
    check("mcp: summary shows one overdue bill", counts.bills_overdue === 1, `bills_overdue=${counts.bills_overdue}`);
    await st.line("result", "Result:", `${counts.bills_overdue} overdue bill · ${counts.chores_due_today} chores due today · ${counts.shopping_to_buy} to buy · ${counts.pending_confirmations} waiting for approval`);
    await alexa(st, summary.text);
    const overdue = Array.isArray(summary.data.overdue_bills) ? summary.data.overdue_bills[0] : undefined;
    const billRef = isRecord(overdue) && typeof overdue.name === "string" ? overdue.name : "Electricity";
    // After a recurring bill is paid its name resolves to the next occurrence, so the "is it paid" check uses the id.
    const billId = isRecord(overdue) && typeof overdue.id === "string" ? overdue.id : billRef;
    await wait(6000);

    // --- Step 2: mark the overdue bill paid → needs_confirmation ------------
    await st.line("head", "", "Step 2 — Mark the overdue bill paid");
    await st.caption("Step 2 of 4", "A money-moving action. The guard plans it, previews every change and asks. Nothing has been written.");
    await say(st, "Mark the electricity bill as paid.");
    await calling(st, "mark_bill_paid", { bill: billRef });
    const proposal = await callTool(client, "mark_bill_paid", { bill: billRef });
    check("guard: mark_bill_paid returns needs_confirmation", proposal.data.status === "needs_confirmation", `status=${proposal.data.status}`);
    const actionId = String(proposal.data.action_id ?? "");
    check("guard: proposal carries action_id, preview and expiry", actionId.length > 0 && Array.isArray(proposal.data.preview?.changes) && typeof proposal.data.expires_at === "string");
    await st.line("warn", "Result:", `needs_confirmation · risk ${proposal.data.risk} · expires ${clock(proposal.data.expires_at)} · nothing written yet`);
    await previewLines(st, proposal.data);
    await st.line("note", "", `  ${proposal.data.how_to_confirm ?? ""}`);
    await alexa(st, proposal.text);
    const bill = await callTool(client, "get_bill", { bill: billRef });
    check("guard: the bill is still unpaid before approval", bill.data.bill?.status !== "paid", `status=${bill.data.bill?.status}`);
    await wait(8000);

    // --- Step 3: approve on /pending, then confirm_action replays ----------
    const card = await openPending(frame, billRef);
    const badge = await frame.locator("aside").innerText();
    check("console: pending badge shows 1 waiting", /Pending\s*1/.test(badge.replace(/\n/g, " ")), badge.replace(/\s+/g, " ").slice(0, 60));
    await st.mode("split");
    await st.caption("Step 3 of 4", "A person approves on /pending. Same preview, same guard — the console has no privileged path around it.");
    await wait(3800);
    if (!CHECK) await page.screenshot({ path: path.join(root, "demo", "thumbnail.png") });
    const approved = await approve(frame, card);
    check("console: Approve on /pending executes the action", /Done:.*paid/i.test(approved), approved.split("\n").find((l) => /Done/.test(l)) ?? "");
    const header = await frame.locator("aside").innerText();
    check("console: pending badge cleared after approval", !/Pending\s*1/.test(header.replace(/\n/g, " ")), header.replace(/\s+/g, " ").slice(0, 60));
    await wait(4200);
    await st.caption("Step 3 of 4", "The assistant's own confirm_action finds it already approved: executed once, replayed — never twice.");
    await calling(st, "confirm_action", { action_id: actionId });
    const confirmed = await callTool(client, "confirm_action", { action_id: actionId });
    check("guard: confirm_action after console approval returns executed", confirmed.data.status === "executed", `status=${confirmed.data.status}`);
    check("guard: confirm_action reports idempotent_replay", confirmed.data.idempotent_replay === true, `idempotent_replay=${confirmed.data.idempotent_replay}`);
    await st.line("result", "Result:", `executed · idempotent_replay ${confirmed.data.idempotent_replay} · ran exactly once`);
    await alexa(st, confirmed.text);
    const paid = await callTool(client, "get_bill", { bill: billId });
    check("domain: the original bill is paid after approval", paid.data.bill?.status === "paid", paid.text);
    await wait(6000);

    // --- Step 4: audit verified ---------------------------------------------
    await frame.goto(`${BASE}/audit`);
    await frame.locator("main").getByText(/Chain intact · \d+ rows/).first().waitFor();
    await st.caption("Step 4 of 4", "The audit log: every row is hashed over the one before it. Verify chain recomputes every hash from the first row.");
    await wait(3200);
    await frame.getByRole("button", { name: "Verify chain" }).click();
    await frame.waitForURL(/flash=/);
    const auditText = await frame.locator("main").innerText();
    check("console: Verify chain reports Chain intact", /Chain intact · \d+ rows/.test(auditText), auditText.match(/Chain intact · \d+ rows[^\n]*/)?.[0] ?? "");
    check("console: audit shows proposed and executed for the action", /proposed/.test(auditText) && /executed/.test(auditText));
    await wait(3600);
    await st.line("head", "", "Step 4 — The audit chain");
    await say(st, "Is the audit log intact?");
    await calling(st, "verify_audit_chain", {});
    const verify = await callTool(client, "verify_audit_chain");
    check("mcp: verify_audit_chain intact", verify.data.intact === true, `${verify.data.rows} rows, head ${String(verify.data.last_hash ?? "").slice(0, 12)}`);
    await st.line("result", "Result:", `intact ${verify.data.intact} · ${verify.data.rows} rows · head ${String(verify.data.last_hash ?? "").slice(0, 12)}…`);
    await alexa(st, verify.text);
    await wait(6000);

    // --- Second confirmation: the front-door lock ---------------------------
    await st.mode("terminal");
    await st.caption("One more", "A second guarded action: unlocking the front door. Locks are confirm-risk; for a child the policy makes it high-risk — console only.");
    await st.line("head", "", "Bonus — Unlock the front door");
    await say(st, "Unlock the front door.");
    const lockArgs = { device: "Front door", state: { locked: false } };
    await calling(st, "set_device_state", lockArgs);
    const lock = await callTool(client, "set_device_state", lockArgs);
    check("guard: set_device_state on a lock returns needs_confirmation", lock.data.status === "needs_confirmation", `status=${lock.data.status}, risk=${lock.data.risk}`);
    const lockId = String(lock.data.action_id ?? "");
    await st.line("warn", "Result:", `needs_confirmation · risk ${lock.data.risk} · expires ${clock(lock.data.expires_at)}`);
    await previewLines(st, lock.data);
    await alexa(st, lock.text);
    await wait(6000);
    const lockCard = await openPending(frame, "Front door");
    await st.mode("split");
    await st.caption("One more", "The same card, the same Approve. Then the assistant's confirm_action completes the loop.");
    await wait(3600);
    const lockApproved = await approve(frame, lockCard);
    check("console: Approve on /pending executes the unlock", /Done:.*Front door/i.test(lockApproved), lockApproved.split("\n").find((l) => /Done/.test(l)) ?? "");
    await wait(3000);
    await calling(st, "confirm_action", { action_id: lockId });
    const lockConfirmed = await callTool(client, "confirm_action", { action_id: lockId });
    check("guard: confirm_action on the unlock returns executed", lockConfirmed.data.status === "executed", `status=${lockConfirmed.data.status}`);
    await st.line("result", "Result:", `executed · idempotent_replay ${lockConfirmed.data.idempotent_replay}`);
    await alexa(st, lockConfirmed.text);
    await wait(5000);

    // --- Closing look at the dashboard --------------------------------------
    await st.blank();
    await st.mode("slide");
    await frame.goto(`${BASE}/`);
    await frame.locator("main").getByText(/chain intact/i).first().waitFor();
    await st.mode("console");
    await st.caption("", "Paid, unlocked, approved by a person, and every step in a chain that still verifies.");
    const dash = await frame.locator("main").innerText();
    check("console: dashboard shows the lock unlocked", /Unlocked/.test(dash));
    check("console: dashboard shows chain intact after everything", /chain intact/i.test(dash));
    await wait(6000);

    // --- How it is built ----------------------------------------------------
    await st.built(
      [
        { title: "One validated write path", body: "Every mutating tool and every console form runs propose → preview → policy → execute or queue. There is no second path." },
        { title: "Hash-chained audit log", body: "hash = sha256(prev_hash + canonical row). verify_audit_chain recomputes from the first row; UPDATE and DELETE are refused." },
        { title: "Streamable HTTP, MCP 2026-07-28", body: "mcp-handler 2 + @modelcontextprotocol/server v2: 2026-07-28 served natively, 2025-11-25 as fallback. Bearer token, Origin allow-list." },
        { title: "31 tools, spoken first", body: "12 read, 17 guarded mutations, 2 guard. zod schemas in and out, structuredContent plus one sentence fit for a voice." },
        { title: "MCP App UI", body: "ui://housewarden/pending renders the same approval card inside hosts that support MCP Apps; other hosts see plain tools." },
        { title: "Self-host in 90 seconds", body: "Embedded Postgres (PGlite), secrets generated on first start, demo family loaded. Any Node 20+ host; managed Postgres is one variable." },
      ],
      `Zero setup<pre><span class="c">$</span> git clone github.com/buildwithabid/housewarden
<span class="c">$</span> cd housewarden && npm install
<span class="c">$</span> npm run dev
<span class="g">✓</span> HOUSEWARDEN_TOKEN and ADMIN_SECRET written to .env.local
<span class="g">✓</span> PGlite ready, schema applied
<span class="c">?</span> Load the demo household (Ali family)? (Y/n)
<span class="g">✓</span> Console http://localhost:3000 · MCP /api/mcp</pre>Then <b>npm run e2e</b> proves it with a real MCP client: 23 checks, from the 2025 handshake to 403 / 401 / 405 / 400.`,
    );
    await st.mode("slide");
    const builtCaptions = [
      "One guard on every write: propose, preview, policy, then execute — or wait for a person.",
      "A tamper-evident record: each audit row is hashed over the previous one and the whole chain is re-verified on demand.",
      "Streamable HTTP with MCP 2026-07-28 via SDK v2, and the 2025-11-25 handshake for today's hosts.",
      "31 tools, every one with a schema in, a schema out and a sentence to speak.",
      "An MCP App resource so a capable host shows Housewarden's own approval card in the conversation.",
      "Self-hosted in 90 seconds on any Node host — embedded Postgres, secrets generated, demo family loaded.",
    ];
    for (let i = 0; i < builtCaptions.length; i += 1) {
      await st.reveal(i + 1);
      await st.caption("How it is built", builtCaptions[i]);
      await wait(6200);
    }

    // --- Repo ---------------------------------------------------------------
    await st.repo();
    await st.caption("", "Open source, MIT. github.com/buildwithabid/housewarden");
    await wait(8000);
    mark("end");
  } finally {
    const showEnd = Date.now();
    if (client) await client.close().catch(() => undefined);
    if (capture) {
      const frameCount = await capture.stop(showEnd / 1000);
      const meta = { framesDir: FRAMES_DIR, frameCount, durationSeconds: Number(((showEnd - showStart) / 1000).toFixed(2)), marks };
      writeFileSync(path.join(RAW_DIR, "marks.json"), JSON.stringify(meta, null, 2));
      console.log(`captured ${frameCount} frames over ${meta.durationSeconds}s → ${FRAMES_DIR}/list.txt`);
    }
    await context.close();
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed${CHECK ? " (check mode)" : ""}`);
  return failed;
}

main()
  .then((failed) => process.exit(failed ? 1 : 0))
  .catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
