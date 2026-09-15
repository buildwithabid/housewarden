# Devpost submission — Housewarden

Amazon Developer Hackathon 2026 · **Track: Alexa+** (self-hosted MCP server, spec 2025-11-25+, Streamable HTTP) · **Mini challenge: Open Source** (MIT). Every field below is written so it can be pasted into the Devpost form. The only placeholder is the video URL, marked **`TODO_VIDEO_URL`** — the owner fills it in after uploading `demo/housewarden-demo.mp4` (see "How to submit" at the end).

| Devpost field | Value |
|---|---|
| Project name | **Housewarden** |
| Tagline (≤ 60 chars) | `Every household action: previewed, confirmed, audited.` (54) |
| Track | Alexa+ — self-hosted MCP server (Streamable HTTP, spec 2025-11-25 and 2026-07-28) |
| Mini challenge | Open Source |
| Repository (public) | https://github.com/buildwithabid/housewarden |
| License | MIT (`LICENSE` in the repo root) |
| Demo video (≤ 3 min, English, public) | **`TODO_VIDEO_URL`** — upload `demo/housewarden-demo.mp4` (2:27, 1280×720, burned-in English captions, silent track) to YouTube as *Public* or *Unlisted*, then paste the link here and in the Devpost "Video link" field |
| Try it | `git clone https://github.com/buildwithabid/housewarden && cd housewarden && npm install && npm run dev` — see "Testing instructions" below |
| Built with | next.js, react, typescript, node.js, model-context-protocol, mcp-handler, pglite, postgresql, zod, tailwindcss, vitest, playwright |
| Team | Abid Ali (GitHub `buildwithabid`) |
| Friction log | Included — seven entries in `docs/FRICTION_LOG.md`, summarised at the end of this document |

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
- **An MCP App.** The `ui://housewarden/pending` resource (MCP Apps extension, on by default) renders the same approval card inside hosts that support it; hosts that do not see ordinary tools with a spoken text fallback.
- **Zero-setup self-hosting.** `npm run dev` generates the secrets, runs an embedded Postgres (PGlite), loads a demo family and starts. Any Node 20+ host runs it with `npm run build && npm run start`; managed Postgres is one environment variable away.

### How we built it

- **Next.js 16** (App Router, TypeScript, Tailwind) hosts both the console and the MCP endpoint at `app/api/mcp/route.ts`.
- **mcp-handler 2** turns an MCP SDK v2 `McpServer` into a web-standard request handler; it serves the 2026-07-28 revision natively and falls back to stateless 2025-era Streamable HTTP, so the same endpoint works for Alexa+ (2025-11-25) and newer hosts. A 30-line wrapper adds the bearer-token check (constant time), the Origin allow-list and the never-fall-open 503.
- **@modelcontextprotocol/server 2** registers each tool with a zod v4 input schema, an output schema (`structuredContent`) and voice-oriented annotations and descriptions; `lib/contracts.ts` is the single source of DTOs, the tool catalogue and default risks. `registerResource` publishes the MCP App document, and the guard tools carry `_meta.ui.resourceUri`.
- **The guard** (`lib/guard`) is the only module that executes a mutation plan: propose → plan (pure, read-only) → policy → execute or queue; confirm does an atomic `pending → confirmed` claim under a Postgres advisory lock, re-plans, compares previews (`STALE_PREVIEW` on drift) and executes once. Audit rows are hashed over a canonical JSON serialisation with published test vectors.
- **Storage** is one `Db` interface with two adapters — **PGlite** (embedded, default) and **pg** — on one Postgres dialect and idempotent SQL migrations.
- **Verification**: 93 vitest tests on in-memory PGlite (core, tools, MCP App), and `npm run e2e`, which starts a server and drives it with the real **@modelcontextprotocol/client 2** over Streamable HTTP: no-token → 503, 2025 handshake and 2026 negotiation, `tools/list` = 31 with schemas, read, low-risk mutation and idempotent replay, dry run, confirm-risk mutation with proof nothing was written, exactly-once confirm, reject, chain verification, and the raw 403 / 401 / 405 / 400 answers — 23 checks. The demo video itself is driven by the same kind of client (`demo/record.mjs --check` replays the storyline as 26 more assertions).

### Challenges we ran into

- Making "exactly once" true under concurrency without sessions or timers: the answer was to make the pending action *the* session, claim it atomically, and sweep expiries on access.
- Re-planning on confirmation so an approval never executes something the approver did not see.
- Keeping one write path honest across two surfaces: the console has no privileged bypass, which forced the confirmation card to be a first-class UI pattern rather than an afterthought.
- Tooling: Next 16's Turbopack refuses a `node_modules` symlink outside the project root, which broke `next dev` in our parallel-worktree build setup until we found `--webpack` — and webpack dev mode then raced on its own manifests under concurrent on-demand compiles (F1, F5 in the friction log). mcp-handler builds a fresh `McpServer` per request, so we had to keep every schema a module-level constant to make that cheap (F6).

### Accomplishments we are proud of

- A safety model that is explainable in one sequence diagram and provable with one command (`npm run e2e` prints a 23-line pass/fail table).
- Spoken-first tool design: every tool returns a sentence fit for text-to-speech alongside structured output, and the server's `instructions` tell the assistant exactly how to handle a `needs_confirmation`.
- Real product completeness: empty states, error states, a named visual identity, a demo household, a narrated demo client, an MCP App, and zero-setup self-hosting.

### What we learned

MCP SDK v2's output schemas plus a client that validates `structuredContent` make a server's promises checkable, which changes how you design tools: the envelope (`executed` / `needs_confirmation` / `dry_run`) became a typed contract rather than prose. We also learned that a voice host needs the *server* to carry the confirmation state, because the assistant may not support elicitation and the person may want to approve on a screen instead.

### What's next

- Real device back-ends behind the same `set_device_state` contract.
- Per-member PINs for voice approvals, and household-level notification of pending actions.
- A host-capability check for the MCP App once a stateful transport makes client capabilities visible at registration time.

---

## How the repo calls the required technology (for the "actually calls it in code" rule)

- `app/api/mcp/route.ts` imports `createMcpHandler` from **`mcp-handler`** and exports it as the `POST`/`DELETE` route handlers — the Streamable HTTP MCP endpoint (GET answers 405: serving is stateless).
- `lib/mcp/register.ts` calls `server.registerTool(...)` from **`@modelcontextprotocol/server`** for each of the 31 tools with zod input/output schemas; `lib/mcpapp/register.ts` calls `server.registerResource(...)` for the `ui://housewarden/pending` MCP App.
- `tests/e2e/protocol.e2e.ts`, `scripts/demo-client.ts` and `demo/record.mjs` import `Client` and `StreamableHTTPClientTransport` from **`@modelcontextprotocol/client`** and connect with both `versionNegotiation` modes.
- Spec coverage: 2025-11-25 Streamable HTTP (POST JSON-RPC with `Accept: application/json, text/event-stream`, 202 for notifications, `MCP-Protocol-Version` validation, Origin validation, GET → 405 since serving is stateless) and 2026-07-28 served natively by mcp-handler.

## Testing instructions for judges

1. `git clone https://github.com/buildwithabid/housewarden && cd housewarden && npm install && npm run dev` (Node 20+). Copy the token and admin secret printed at first start; press Enter to load the demo family.
2. Open http://localhost:3000 and sign in with the admin secret. Note "Chain intact" on the dashboard.
3. In a second terminal: `npm run demo:client` — it asks for a summary, proposes paying the overdue Electricity bill, and waits. Go to http://localhost:3000/pending, read the preview, press **Approve**. The terminal continues: the bill is paid, the next month's bill exists, and `verify_audit_chain` reports the chain intact. Add `-- --auto-approve` to confirm by "voice" instead, `-- --bonus` for the child-unlocks-the-door beat (`high` risk, console only).
4. `npm run e2e` runs the full protocol suite against a throwaway server and prints the table (add `E2E_NEXT_ARGS=--webpack` if your checkout uses a symlinked `node_modules`). `npm test` runs the 93 unit and integration tests.
5. To connect your own MCP host: endpoint `http://localhost:3000/api/mcp`, header `Authorization: Bearer <token>`; the JSON config shape is in the README. A host that supports MCP Apps will also list the `ui://housewarden/pending` resource; `GET /api/mcp/ui` previews that card in a browser.

## Demo video

File: `demo/housewarden-demo.mp4` (1280×720, H.264, 30 fps, silent AAC track, under three minutes). Captions are burned in; there is no narration. It was recorded with Playwright driving the real console and a real MCP client against a freshly seeded server (`demo/record.mjs`; shot list and every caption in `demo/script.md`), then assembled with ffmpeg. Nothing in it is mocked: every terminal line is an actual request and response.

| Time | On screen | Caption (the voice-over, burned in) |
|---|---|---|
| 0:00–0:16 | Title card, then the seeded dashboard with "Chain intact" | A home assistant is about to be handed real actions. Housewarden shows what will change, asks, and keeps a tamper-evident record. |
| 0:16–0:29 | Terminal: MCP client connects (Streamable HTTP, MCP 2026-07-28, 31 tools); Step 1 `get_household_summary` | Ask for a summary. Reads are free: no confirmation, no side effects, one spoken sentence. |
| 0:29–0:40 | Step 2 `mark_bill_paid` → `needs_confirmation` with the change lines, the warning and the spoken line | A money-moving action. The guard plans it, previews every change and asks. Nothing has been written. |
| 0:40–0:56 | Split view: `/pending` card, badge "Pending 1", Approve, "Done"; terminal `confirm_action` → `executed`, `idempotent_replay: true` | A person approves on /pending. Same preview, same guard. The assistant's own confirm_action finds it already approved: executed once, replayed — never twice. |
| 0:56–1:12 | `/audit`: proposed → executed rows, Verify chain → "Chain intact · 3 rows"; terminal `verify_audit_chain` | Every row is hashed over the one before it. Verify chain recomputes every hash from the first row. |
| 1:12–1:34 | Bonus: `set_device_state` unlock front door → `needs_confirmation`; approve; `confirm_action` → executed | A second guarded action. Locks are confirm-risk; for a child the policy makes it high-risk — console only. |
| 1:34–1:40 | Dashboard: Front door "Unlocked", chain intact · 5 rows | Paid, unlocked, approved by a person, and every step in a chain that still verifies. |
| 1:40–2:19 | "How it is built" slide, six points revealed one by one, with the 90-second quickstart | One write path · hash-chained audit · Streamable HTTP + MCP 2026-07-28 via SDK v2 · 31 tools · MCP App UI · self-host in 90 seconds. |
| 2:19–2:27 | Repo card: github.com/buildwithabid/housewarden · MIT · Alexa+ track · Open Source mini challenge | Open source, MIT. |

---

## Product feedback per SDK touched

Written from what we actually used; details and repro steps are in `docs/FRICTION_LOG.md`.

**mcp-handler 2.1.1**
- Excellent fit for Next.js: one `createMcpHandler(register, options)` call, framework-agnostic `Request → Response`, and dual-era serving (2026-07-28 natively, 2025 Streamable HTTP fallback) with no configuration. The per-request `McpServer` factory keeps serving stateless, which is what a self-hosted home server wants.
- The same factory re-registers every tool on every request, so the SDK converts all input and output schemas again each time — about 30 ms warm for 31 tools, but repeated work that grows with the catalogue (F6). Accepting a prebuilt server for stateless deployments, or caching the JSON Schema per zod object, would remove it.
- The README links to `docs/CLIENTS.md`, `docs/AUTHORIZATION.md` and `docs/ADVANCED.md`, none of which are in the npm tarball (F2).
- The handler performs no Origin validation and `withMcpAuth` is OAuth-shaped (it advertises a protected-resource metadata URL). A self-hosted bearer-token server needs its own 30-line wrapper for 503/403/401; a documented "static bearer token + Origin allow-list" option would cover the common self-hosting case.

**@modelcontextprotocol/server 2.0.0**
- `registerTool` with a full zod object for `inputSchema`/`outputSchema`, annotations and `structuredContent` is exactly the right shape for voice hosts: the spoken line lives in `content[0].text`, the data in `structuredContent`, and the client can validate it. `registerResource` plus `_meta` on tools was enough to implement the MCP Apps extension without any extra package.
- The JSDoc on `createMcpHandler` is thorough (era classification, why validation is left to the caller). It recommends `toNodeHandler` from `@modelcontextprotocol/node` for plain `node:http`, but that package is not a dependency of the server package (F4).

**@modelcontextprotocol/client 2.0.0**
- Worked first time once the API was located: `authProvider: { token }` for a plain bearer, `versionNegotiation: { mode }` for the 2026 probe, AJV validation of the server's output schemas with formats supported.
- The README is a pointer to the website; the three snippets a server author needs (bearer token, negotiation mode, narrowing `structuredContent`) should be in it (F3).

**Next.js 16.3.5**
- `next typegen`, the standalone output and `outputFileTracingIncludes` are convenient; route handlers pass web-standard `Request` objects straight to mcp-handler.
- Turbopack panics on a `node_modules` symlink that points outside the project root, with a message that does not mention `--webpack` or `turbopack.root` (F1). In webpack dev mode, concurrent on-demand compiles can read a half-written manifest (`Manifest file is empty`, `Unexpected end of JSON input`) — never in `next build && next start` (F5).
- A `path.resolve` on a runtime-configured data directory makes Turbopack trace the whole project into the standalone output; the `/* turbopackIgnore: true */` hint fixes it, but the build warning could say that the *entire directory* is being included.

**@electric-sql/pglite 0.5.8**
- Touched only through the project's `Db` interface from the scripts; the single-connection constraint shaped `npm run dev` (open, migrate, seed, close, then start Next) but caused no friction while doing this work, so nothing is logged for it.

## Friction log

Six real entries, in the hackathon's required format (task, steps, expected vs actual, severity, workaround, suggestion), plus a short list of things that were expected to hurt and did not: **`docs/FRICTION_LOG.md`**. Paste that file's F1–F6 sections into the Devpost "Friction log" field.

- F1 · Next 16 / Turbopack — `next dev` panics when `node_modules` is a symlink outside the project root (Medium; workaround `--webpack`).
- F2 · mcp-handler — README links to docs that are not in the package (Low).
- F3 · @modelcontextprotocol/client — the simplest client setup is not in the README (Low).
- F4 · @modelcontextprotocol/server — `createMcpHandler` docs recommend a package that is not installed (Low).
- F5 · Next 16 — `next dev --webpack` races on its own manifests during concurrent on-demand compiles (Medium; warm routes first, or use `next build && next start`).
- F6 · mcp-handler — a fresh `McpServer` per request re-converts every tool schema per request (Low; keep schemas module-level).

---

## How to submit (owner checklist)

1. **Push and check the repo.** `git push origin main` from this checkout; confirm https://github.com/buildwithabid/housewarden is *public*, shows the MIT `LICENSE`, and that `app/api/mcp/route.ts` is visible (the "calls the required technology in code" rule).
2. **Upload the video.** Upload `demo/housewarden-demo.mp4` to YouTube (or Vimeo) as **Public** (Unlisted is accepted by Devpost but Public is safer for the "public" rule), title "Housewarden — every household action previewed, confirmed, audited (Alexa+ MCP server)", language English. Copy the URL and replace every `TODO_VIDEO_URL` in this file and in `README.md`; commit and push.
3. **Devpost account.** Sign in at devpost.com (or register), complete the profile name that should appear on the entry.
4. **Join the hackathon.** Open the Amazon Developer Hackathon 2026 page on Devpost, press **Join hackathon**, accept the rules.
5. **Start the submission.** "Enter a submission" → **Project name**: Housewarden · **Tagline**: `Every household action: previewed, confirmed, audited.` (54 characters).
6. **Track and challenge.** Track: **Alexa+**. Mini challenge / opt-in: **Open Source**. Confirm the repository field points at the public MIT repo.
7. **Description.** Paste "Elevator pitch" and the "About the project" sections above into the "About the project" editor (headings map to Devpost's Inspiration / What it does / How we built it / Challenges / Accomplishments / What we learned / What's next prompts).
8. **Links.** Repository URL: https://github.com/buildwithabid/housewarden · Video link: the YouTube URL · optional "Try it out" link: the repo.
9. **Built with.** Add the tags from the table at the top (next.js, react, typescript, node.js, model-context-protocol, mcp-handler, pglite, postgresql, zod, tailwindcss, vitest, playwright).
10. **Images.** Upload `demo/thumbnail.png` as the cover image and, from `docs/screens/`, `dashboard-1280.png`, `pending-1280.png` and `audit-1280.png` as gallery images.
11. **Friction log.** Paste F1–F6 from `docs/FRICTION_LOG.md` into the friction-log field (or attach the file if the form accepts uploads); mention that "Product feedback per SDK touched" above is the per-SDK summary.
12. **Testing instructions.** Paste "Testing instructions for judges" into the testing-instructions field, including the token note.
13. **Review, then Submit.** Preview the entry, check the video plays, the repo link opens, and the track/mini-challenge selections are shown. Press **Submit**. Deadline: 23 October 2026 (the plan is to submit by 10 October).
14. **After submitting.** Keep the repo public and the video public until judging ends; do not force-push over `main`.
