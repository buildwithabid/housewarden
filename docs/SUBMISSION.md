# Devpost submission — Housewarden

Amazon Developer Hackathon 2026 · **Track: Alexa+** (self-hosted MCP server, spec 2025-11-25+, Streamable HTTP) · **Mini challenge: Open Source** (MIT). Every field below is drafted so it can be pasted into the Devpost form; placeholders are marked `TODO`.

| Devpost field | Value |
|---|---|
| Project name | **Housewarden** |
| Tagline (≤ 60 chars) | `Every household action: previewed, confirmed, audited.` (54) |
| Track | Alexa+ — MCP server |
| Mini challenge | Open Source |
| Repository (public) | https://github.com/buildwithabid/housewarden |
| License | MIT (`LICENSE` in the repo root) |
| Demo video (≤ 3 min, English, public) | `TODO: https://youtu.be/…` |
| Try it | `git clone https://github.com/buildwithabid/housewarden && cd housewarden && npm i && npm run dev` — see "Testing instructions" below |
| Built with | next.js, react, typescript, node.js, model-context-protocol, mcp-handler, pglite, postgresql, zod, tailwindcss, vitest |
| Team | Abid Ali (GitHub `buildwithabid`) |
| Friction log | Included — see the section at the end and `docs/FRICTION_LOG.md` |

---

## Elevator pitch

A home assistant is about to be handed real actions: pay this bill, unlock the door, clear the shopping list. The missing piece is not the tools; it is the safety layer around them. Housewarden is a complete, self-hosted household MCP server where every mutating tool is **dry-run previewed, confirmed when risky, executed exactly once, and written to a hash-chained audit log** — and the web console uses the very same path, so Alexa+ can never do anything a person could not see and approve.

## About the project

### Inspiration

Alexa+ integrations run on MCP, which means a voice assistant will soon call tools that move money and open doors. Reading the MCP spec, we noticed that everything about *how* a tool is called is standardised, but nothing about *whether it should be* — previewing, confirming and recording an action are left to each server. Most demo servers skip all three. We wanted to build the household server we would actually let an assistant talk to, and make the safety layer the product rather than a checkbox.

### What it does

- **31 MCP tools** over Streamable HTTP for one household: bills, chores, shopping, reminders, budget, simulated smart-home devices (a lock, a thermostat) and routines, members, policies, pending actions and the audit log.
- **One guard on every write.** A mutating call returns `executed` (low risk, already done and audited) or `needs_confirmation` (a preview of every concrete change, an `action_id`, an expiry, and a spoken sentence telling the user what to say). `confirm_action` runs it exactly once; a repeat replays the stored result; `reject_action` declines it; unapproved actions expire in ten minutes. `dry_run: true` on any mutating tool returns the preview and writes nothing.
- **Policies with a floor.** Adds and updates execute immediately; money-moving and destructive actions need a yes; unlocking the door for a child, or changing the policies themselves, needs a person in the console — an assistant cannot lower the guard and then approve its own change.
- **A tamper-evident audit log.** Every proposal, execution, rejection and expiry appends a row whose SHA-256 covers the previous row's hash. `verify_audit_chain` recomputes the whole chain; the console shows "Chain intact · N rows".
- **A console that is the human half of the guard.** `/pending` shows the same preview the assistant saw, with Approve and Reject; the CRUD pages go through the same `runTool` path as the MCP endpoint. Server-rendered, phone-friendly, works with JavaScript off.
- **Zero-setup self-hosting.** `npm run dev` generates the secrets, runs an embedded Postgres (PGlite), loads a demo family and starts. Any Node 20+ host runs it with `npm run build && npm run start`; managed Postgres is one environment variable away.

### How we built it

- **Next.js 16** (App Router, TypeScript, Tailwind) hosts both the console and the MCP endpoint at `app/api/mcp/route.ts`.
- **mcp-handler 2** turns an MCP SDK v2 `McpServer` into a web-standard request handler; it serves the 2026-07-28 revision natively and falls back to stateless 2025-era Streamable HTTP, so the same endpoint works for Alexa+ (2025-11-25) and newer hosts.
- **@modelcontextprotocol/server 2** registers each tool with a zod v4 input schema, an output schema (`structuredContent`) and voice-oriented annotations and descriptions; `lib/contracts.ts` is the single source of DTOs, the tool catalogue and default risks.
- **The guard** (`lib/guard`) is the only module that executes a mutation plan: propose → plan (pure, read-only) → policy → execute or queue; confirm does an atomic `pending → confirmed` claim under a Postgres advisory lock, re-plans, compares previews (`STALE_PREVIEW` on drift) and executes once. Audit rows are hashed over a canonical JSON serialisation with published test vectors.
- **Storage** is one `Db` interface with two adapters — **PGlite** (embedded, default) and **pg** — on one Postgres dialect and idempotent SQL migrations.
- **Verification**: vitest suites on in-memory PGlite, and `npm run e2e`, which starts a server and drives it with the real **@modelcontextprotocol/client 2** over Streamable HTTP: no-token → 503, 2025 handshake and 2026 negotiation, `tools/list` = 31 with schemas, read, low-risk mutation and idempotent replay, dry run, confirm-risk mutation with proof nothing was written, exactly-once confirm, reject, chain verification, and the raw 403 / 401 / 405 / 400 answers.

### Challenges we ran into

- Making "exactly once" true under concurrency without sessions or timers: the answer was to make the pending action *the* session, claim it atomically, and sweep expiries on access.
- Re-planning on confirmation so an approval never executes something the approver did not see.
- Keeping one write path honest across two surfaces: the console has no privileged bypass, which forced the confirmation card to be a first-class UI pattern rather than an afterthought.
- Tooling: Next 16's Turbopack refuses a `node_modules` symlink outside the project root, which broke `next dev` in our parallel-worktree build setup until we found `--webpack` (logged in the friction log).

### Accomplishments we are proud of

- A safety model that is explainable in one sequence diagram and provable with one command (`npm run e2e` prints a 23-line pass/fail table).
- Spoken-first tool design: every tool returns a sentence fit for text-to-speech alongside structured output, and the server's `instructions` tell the assistant exactly how to handle a `needs_confirmation`.
- Real product completeness: empty states, error states, a named visual identity, a demo household, a narrated demo client, and zero-setup self-hosting.

### What we learned

MCP SDK v2's output schemas plus a client that validates `structuredContent` make a server's promises checkable, which changes how you design tools: the envelope (`executed` / `needs_confirmation` / `dry_run`) became a typed contract rather than prose. We also learned that a voice host needs the *server* to carry the confirmation state, because the assistant may not support elicitation and the person may want to approve on a screen instead.

### What's next

- The MCP Apps extension: a `ui://housewarden/pending` resource (behind `HOUSEWARDEN_MCP_APP=1`) so hosts that support MCP Apps render Housewarden's own approval card inside the assistant.
- Real device back-ends behind the same `set_device_state` contract.
- Per-member PINs for voice approvals, and household-level notification of pending actions.

---

## How the repo calls the required technology (for the "actually calls it in code" rule)

- `app/api/mcp/route.ts` imports `createMcpHandler` from **`mcp-handler`** and exports it as the `GET`/`POST`/`DELETE` route handlers — the Streamable HTTP MCP endpoint.
- `lib/mcp/register.ts` calls `server.registerTool(...)` from **`@modelcontextprotocol/server`** for each of the 31 tools with zod input/output schemas.
- `tests/e2e/protocol.e2e.ts` and `scripts/demo-client.ts` import `Client` and `StreamableHTTPClientTransport` from **`@modelcontextprotocol/client`** and connect with both `versionNegotiation` modes.
- Spec coverage: 2025-11-25 Streamable HTTP (POST JSON-RPC with `Accept: application/json, text/event-stream`, 202 for notifications, `MCP-Protocol-Version` validation, Origin validation, GET → 405 since serving is stateless) and 2026-07-28 served natively by mcp-handler.

## Testing instructions for judges

1. `git clone https://github.com/buildwithabid/housewarden && cd housewarden && npm install && npm run dev` (Node 20+). Copy the token and admin secret printed at first start; press Enter to load the demo family.
2. Open http://localhost:3000 and sign in with the admin secret. Note "Chain intact" on the dashboard.
3. In a second terminal: `npm run demo:client` — it asks for a summary, proposes paying the overdue Electricity bill, and waits. Go to http://localhost:3000/pending, read the preview, press **Approve**. The terminal continues: the bill is paid, the next month's bill exists, and `verify_audit_chain` reports the chain intact. Add `-- --auto-approve` to confirm by "voice" instead, `-- --bonus` for the child-unlocks-the-door beat (`high` risk, console only).
4. `npm run e2e` runs the full protocol suite against a throwaway server and prints the table (add `E2E_NEXT_ARGS=--webpack` if your checkout uses a symlinked `node_modules`).
5. To connect your own MCP host: endpoint `http://localhost:3000/api/mcp`, header `Authorization: Bearer <token>`; the JSON config shape is in the README.

## Demo video plan (under 3 minutes)

| Time | On screen | Voice-over |
|---|---|---|
| 0:00–0:20 | Title card, then the README's sequence diagram | The thesis: an assistant is about to be given real actions; Housewarden previews, confirms and audits every one. |
| 0:20–0:50 | Terminal: `npm run dev`, secrets box, demo family loaded; browser: dashboard with "Chain intact" | Zero setup: embedded Postgres, demo household, one token. |
| 0:50–1:30 | `npm run demo:client`: step 1 summary, step 2 `mark_bill_paid` → `needs_confirmation` with the change lines | The assistant asks; nothing has been written. |
| 1:30–2:05 | Browser: pending badge, `/pending` card, Approve; terminal continues with "executed" | The person approves on a screen (caption: or says "yes" and the assistant calls `confirm_action`). |
| 2:05–2:35 | `/audit`: proposed → executed for the same action id, Verify chain → intact; terminal: `verify_audit_chain` | Tamper-evident record, verifiable in one call. |
| 2:35–2:55 | Bonus: "Unlock the front door" as Adlan → `high` → console only; `npm run e2e` table scrolling | Policies with a floor; proven end to end with a real MCP client. |
| 2:55–3:00 | Repo URL, MIT | Open source, self-host it anywhere Node runs. |

---

## Product feedback per SDK touched

Written from what we actually used; details and repro steps are in `docs/FRICTION_LOG.md`.

**mcp-handler 2.1.1**
- Excellent fit for Next.js: one `createMcpHandler(register, options)` call, framework-agnostic `Request → Response`, and dual-era serving (2026-07-28 natively, 2025 Streamable HTTP fallback) with no configuration. The per-request `McpServer` factory keeps serving stateless, which is what a self-hosted home server wants.
- The README links to `docs/CLIENTS.md`, `docs/AUTHORIZATION.md` and `docs/ADVANCED.md`, none of which are in the npm tarball (F2).
- The handler performs no Origin validation and `withMcpAuth` is OAuth-shaped (it advertises a protected-resource metadata URL). A self-hosted bearer-token server needs its own 30-line wrapper for 503/403/401; a documented "static bearer token + Origin allow-list" option would cover the common self-hosting case.

**@modelcontextprotocol/server 2.0.0**
- `registerTool` with a full zod object for `inputSchema`/`outputSchema`, annotations and `structuredContent` is exactly the right shape for voice hosts: the spoken line lives in `content[0].text`, the data in `structuredContent`, and the client can validate it.
- The JSDoc on `createMcpHandler` is thorough (era classification, why validation is left to the caller). It recommends `toNodeHandler` from `@modelcontextprotocol/node` for plain `node:http`, but that package is not a dependency of the server package (F4).

**@modelcontextprotocol/client 2.0.0**
- Worked first time once the API was located: `authProvider: { token }` for a plain bearer, `versionNegotiation: { mode }` for the 2026 probe, AJV validation of the server's output schemas with formats supported.
- The README is a pointer to the website; the three snippets a server author needs (bearer token, negotiation mode, narrowing `structuredContent`) should be in it (F3).

**Next.js 16.3.5**
- `next typegen` and the standalone output are convenient; route handlers pass web-standard `Request` objects straight to mcp-handler.
- Turbopack panics on a `node_modules` symlink that points outside the project root, with a message that does not mention `--webpack` or `turbopack.root` (F1).

**@electric-sql/pglite 0.5.8**
- Touched only through the project's `Db` interface from the scripts; the single-connection constraint shaped `npm run dev` (open, migrate, seed, close, then start Next) but caused no friction while doing this work, so nothing is logged for it.

## Friction log

Four real entries, in the hackathon's required format (task, steps, expected vs actual, severity, workaround, suggestion), plus a short list of things that were expected to hurt and did not: **`docs/FRICTION_LOG.md`**.

- F1 · Next 16 / Turbopack — `next dev` panics when `node_modules` is a symlink outside the project root (Medium; workaround `--webpack`).
- F2 · mcp-handler — README links to docs that are not in the package (Low).
- F3 · @modelcontextprotocol/client — the simplest client setup is not in the README (Low).
- F4 · @modelcontextprotocol/server — `createMcpHandler` docs recommend a package that is not installed (Low).
