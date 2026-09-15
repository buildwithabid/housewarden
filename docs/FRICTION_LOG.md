# Friction log

Real friction met while building Housewarden on **mcp-handler 2.1.1**, **@modelcontextprotocol/server 2.0.0**, **@modelcontextprotocol/client 2.0.0**, **@electric-sql/pglite 0.5.8** and **Next.js 16.3.5** (Node 22). Each entry follows the hackathon's required shape: the task attempted, the steps taken, what was expected versus what happened, a severity rating, the workaround used, and an actionable suggestion. Entries are added by the person who hit the problem, with the date; nothing here is hypothetical. F5 and F6 were reported by the build agents during integration and written up by the integrator from their notes and measurements.

Severity scale: **Blocker** (no way forward), **High** (lost hours or forced a design change), **Medium** (lost real time, workaround exists), **Low** (annoyance).

---

## F1 · Next.js 16 / Turbopack — `next dev` panics when `node_modules` is a symlink outside the project

*2026-09-14 · docs+scripts agent · Next 16.3.5 (Turbopack default)*

- **Task attempted:** run the development server (via `npm run e2e`, which spawns `next dev -p 3123 -H 127.0.0.1`) inside a git worktree whose `node_modules` is a symlink to the main checkout's `node_modules`, so five parallel worktrees share one install instead of running `npm install` five times.
- **Steps:** `git worktree add ../housewarden-wt-docs -b build/docs main` → `ln -s /home/abidali/housewarden/node_modules node_modules` → `npm run e2e`.
- **Expected:** the dev server starts; a symlinked `node_modules` is an ordinary layout (worktrees, CI caches, some monorepo tools), and `tsc`, `eslint`, `tsx` and `next typegen` all resolved through it without complaint.
- **Actual:** immediate exit code 1 with `FATAL: An unexpected Turbopack error occurred … Symlink [project]/node_modules is invalid, it points out of the filesystem root` and a panic log in `/tmp`. The message does not say what to do about it.
- **Severity:** Medium — `next dev` is unusable in that layout until you know the flag; the e2e harness reported it as "server exited with code 1" twice before the cause was clear.
- **Workaround:** `next dev --webpack`. The harness gained an `E2E_NEXT_ARGS` pass-through (`E2E_NEXT_ARGS=--webpack npm run e2e`) and `npm run dev -- --webpack` works the same way. Webpack mode ran the whole 23-check suite in 21 s.
- **Suggestion:** treat a root-level `node_modules` symlink as part of the project (or extend the Turbopack filesystem root to the symlink's target automatically), and make the panic message name both `--webpack` and the `turbopack.root` config option.

## F2 · mcp-handler — the README links to documentation that is not in the npm package

*2026-09-14 · docs+scripts agent · mcp-handler 2.1.1*

- **Task attempted:** learn the handler's options and client-connection details offline (this environment has no web search; the package on disk is the reference).
- **Steps:** `cat node_modules/mcp-handler/README.md` → it links `docs/CLIENTS.md`, `docs/AUTHORIZATION.md` and `docs/ADVANCED.md` → `ls node_modules/mcp-handler/docs/` → `No such file or directory`.
- **Expected:** the relative links resolve inside the installed package, or they are absolute GitHub URLs.
- **Actual:** dead links locally. The option set (`serverInfo`, `verboseLogs`, `onEvent`, `maxSubscriptions`, plus the SDK's `ServerOptions`) and the `withMcpAuth` semantics were recovered by reading `dist/index.d.ts` and `dist/index.mjs`.
- **Severity:** Low.
- **Workaround:** read the built source.
- **Suggestion:** add `docs/` to the `files` field in `package.json`, or switch the README links to absolute repository URLs.

## F3 · @modelcontextprotocol/client — the simplest client setup is not in the README

*2026-09-14 · docs+scripts agent · @modelcontextprotocol/client 2.0.0*

- **Task attempted:** connect to a Streamable HTTP server with a static bearer token, list tools, call a tool, read `structuredContent`, and try the 2026-07-28 version negotiation — the whole e2e harness and the demo walkthrough depend on this.
- **Steps:** the package README is about twenty lines and points to the website. Searched `dist/index.d.mts` (3,250 lines) for `StreamableHTTPClientTransportOptions`, `AuthProvider`, `versionNegotiation`, `callTool`, `listTools`.
- **Expected:** a ten-line example in the README covering the bearer-token case.
- **Actual:** everything needed exists, but only as JSDoc deep in the declaration file: `authProvider: { token: async () => key }` for a plain bearer token, `versionNegotiation: { mode: "legacy" | "auto" | { pin } }` on `ClientOptions` (default `legacy`), and the note that `structuredContent` is `unknown` and must be narrowed. Once found, it worked first time — both negotiation modes, and client-side AJV validation of zod-4 output schemas that use `uuid` and `date-time` formats (the bundled validator includes `ajv-formats`).
- **Severity:** Low.
- **Workaround:** grep the `.d.mts`.
- **Suggestion:** lift those three snippets (bearer token over Streamable HTTP, `versionNegotiation`, narrowing `structuredContent`) into the README; the text already exists in the JSDoc.

## F4 · @modelcontextprotocol/server — `createMcpHandler` docs recommend a package that is not installed

*2026-09-14 · docs+scripts agent · @modelcontextprotocol/server 2.0.0*

- **Task attempted:** stand up a minimal Streamable HTTP server on plain `node:http` to test the e2e harness before the real Next route existed.
- **Steps:** the JSDoc on `createMcpHandler` says: "for Express/Fastify/plain `node:http`, wrap the handler once with `toNodeHandler(handler)` from `@modelcontextprotocol/node`" → `ls node_modules/@modelcontextprotocol/` → `client core server`.
- **Expected:** the recommended adapter to be a dependency of the server package (or of mcp-handler), or the doc comment to say it is a separate install.
- **Actual:** not present, and this environment does not allow package installs, so the throwaway server was mounted through a Next route handler instead (which is how the product mounts it anyway).
- **Severity:** Low.
- **Workaround:** use the web-standard `handler.fetch` through a framework route.
- **Suggestion:** say `npm install @modelcontextprotocol/node` in that JSDoc, or ship a small `toNodeHandler` inside the server package since `node:http` is the most common host.

## F5 · Next.js 16 — `next dev --webpack` races on its own manifests during on-demand compiles

*2026-09-14 · console and tools build agents · Next 16.3.5, webpack mode (see F1 for why)*

- **Task attempted:** drive the freshly built console and the MCP route with a browser and the e2e harness against `next dev --webpack` in a git worktree, hitting several routes for the first time in quick succession (login → dashboard → pending → audit, while the harness POSTs to `/api/mcp`).
- **Steps:** `npm run dev -- --webpack -p 3123`, then open the routes one after another; separately `E2E_NEXT_ARGS=--webpack npm run e2e`.
- **Expected:** on-demand compilation is slower on the first visit to each route and then stable; a page either renders or shows a compile error.
- **Actual:** intermittent 500s that had nothing to do with our code: `Manifest file is empty` and `Unexpected end of JSON input` from the dev server reading one of its own manifests while another on-demand compile was writing it. Reloading the page fixed it every time. `next build && next start` never showed it, and neither did Turbopack on a real (non-symlinked) `node_modules`.
- **Severity:** Medium — real time went into chasing a 500 that was not in our code, and an automated check that hits several cold routes at once cannot be trusted in this mode.
- **Workaround:** warm each route with one request before driving it; retry once on a 500 during development; run the final checks and the video against `next build` + `next start`.
- **Suggestion:** write the dev manifests atomically (temp file + rename) and serialise on-demand compiles that touch the same manifest; when a manifest read fails to parse, retry it once instead of surfacing a 500 to the page.

## F6 · mcp-handler — a fresh `McpServer` per request means every tool's zod schemas are converted again on every request

*2026-09-14 · tools build agent · mcp-handler 2.1.1, @modelcontextprotocol/server 2.0.0*

- **Task attempted:** keep `tools/list` and `tools/call` fast with 31 tools, each carrying a zod v4 input schema and an output schema.
- **Steps:** timed the first and the warm `tools/list` from the e2e client; read `mcp-handler/dist/index.mjs` to see where the time goes.
- **Expected:** the tool registrations (and the zod → JSON Schema conversion the SDK does for `inputSchema` / `outputSchema`) to happen once per process.
- **Actual:** `createMcpHandler` calls the factory on **every** request, building a new `McpServer` and re-registering all 31 tools, so the SDK converts the 31 input and output zod schemas again each time. Measured on our VPS: about 3 s for the first request (module load, PGlite start and the conversions together) and about 30 ms per warm request, which is fine for a home server but scales with the tool count and is repeated work. The stateless design that causes it is also what we want (no sessions, any number of hosts).
- **Severity:** Low — no user-visible problem at this size; it becomes one at a few hundred tools or on a small host.
- **Workaround:** keep everything the factory touches as module-level constants (schemas, catalogue, the cached `ui/pending.html`) so the per-request cost is only the registration itself; nothing is computed inside `registerTools`.
- **Suggestion:** let `createMcpHandler` accept a prebuilt `McpServer` (or a memoised factory keyed by nothing) for stateless deployments, or have the SDK cache the JSON Schema per zod object in a `WeakMap` so re-registration is cheap.

## F7 · Next 16 `output: standalone` — `server.js` chdirs, so a relative data directory silently becomes a second, empty database

*2026-09-15 · deployment · Next 16.3.5, @electric-sql/pglite, systemd --user*

- **Task attempted:** run the built app as a systemd service on a VPS (`node .next/standalone/server.js`, `WorkingDirectory=` the repo root) and have it serve the same embedded-Postgres database that `npm run migrate` and `npm run seed` had just written.
- **Steps:** `next build` with `output: "standalone"`; a unit with `WorkingDirectory=/home/abidali/housewarden` and `HOUSEWARDEN_DATA_DIR` left at its default of `.data/pglite`; `npm run seed`; then call `get_household_summary` through the MCP endpoint.
- **Expected:** the service reads `<repo>/.data/pglite`, the directory the seed just populated, because that is the unit's working directory.
- **Actual:** every tool answered `HOUSEHOLD_EMPTY`. The standalone entry point calls `process.chdir(__dirname)` before loading the app, so the process's cwd is `.next/standalone`, and a relative data directory resolved to `.next/standalone/.data/pglite` — a *second* database, which the migration bootstrap then created and migrated, so nothing errored. Two valid databases, no warning, and the seeded one was never opened.
- **Severity:** High — silent data divergence in production. Nothing fails; the app simply serves an empty world, and the obvious next move (re-run the seed) writes to the wrong one again.
- **Workaround:** give `HOUSEWARDEN_DATA_DIR` an absolute path in the unit (now the default in `deploy/housewarden.service`, with the reason in a comment), and delete the stray `.next/standalone/.data`.
- **Suggestion:** document the `chdir` on the `output: "standalone"` page — it is the single behavioural difference that breaks otherwise-correct relative paths — or set `process.env.NEXT_STANDALONE_ORIGINAL_CWD` before chdir so applications can resolve user-configured paths against the directory the operator actually launched from.

---

## Things that were expected to hurt and did not

Recorded so the log is not only complaints:

- **zod 4 → JSON Schema → AJV round trip.** `guardResultSchema` is a discriminated union whose members use `z.uuid()` and `z.iso.datetime()`; the server advertised it as `outputSchema`, the client validated real `structuredContent` against it without any configuration.
- **Dual-era serving from one handler.** A `versionNegotiation: { mode: "legacy" }` client and a `mode: "auto"` client both listed 31 tools and called tools against the same mcp-handler route; GET answered 405 and an unsupported `MCP-Protocol-Version` answered 400 out of the box.
- **tsx + `@/` path aliases** resolved from `tsconfig.json` with no extra flags, so `npm run migrate|seed|e2e|demo:client` needed no build step.
- **`next typegen`** is a fast, reliable way to make `tsc --noEmit` see the generated route types without a full build.
