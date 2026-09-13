# File ownership for parallel build agents

Five build agents work in parallel git worktrees of `/home/abidali/housewarden`.
Each owns the paths below and **only** those paths. A file outside your
ownership is read-only for you; if you need it changed, say so in your final
report and the orchestrator routes the change. This is what keeps the merge
conflict-free.

Shared, frozen inputs for everyone: `docs/SPEC.md`, `docs/TOOLS.md`,
`docs/DESIGN.md`, `db/migrations/0001_init.sql`, `lib/contracts.ts`.

| Agent | Owns | Notes |
|---|---|---|
| **core** | `lib/db.ts`, `lib/db/**`, `lib/env.ts`, `lib/guard.ts`, `lib/guard/**`, `lib/domain/**`, `lib/audit.ts`, `lib/audit/**`, `lib/seed.ts`, `lib/seed/**`, `lib/time.ts`, `lib/money.ts`, `db/**` (new migrations only; never edit 0001 after this commit), `tests/core/**` | May make **additive** changes to `lib/contracts.ts` (new exports only, never rename/remove), each announced in the commit message. Exposes `getDb`, `createDb`, `runTool`, `propose`, `confirmAction`, `rejectAction`, `sweepExpired`, `appendAudit`, `verifyAuditChain`, `seedDemo`, `resolvePolicy`, and the read functions in `lib/domain/*` that pages and read tools share. |
| **tools** | `app/api/mcp/route.ts`, `app/api/mcp/**` (except `app/api/mcp/ui/**`), `lib/tools/**` (one file per tool + `registry.ts`), `lib/mcp/**` (`auth.ts`, `origin.ts`, `register.ts`, `instructions.ts`, `result.ts`), `tests/tools/**` | Implements the 31 tools against the domain functions and the guard; never writes to the database directly. Tests use `createDb({ dataDir: "memory://" })` and call the route handler with `Request` objects (no network). |
| **console** | `app/(console)/**`, `app/login/**`, `app/logout/**`, `app/actions/**`, `components/**`, `lib/console/**` (session, flash helpers, formatters for the UI), `app/globals.css`, `app/layout.tsx`, `app/page.tsx` (moves to `app/(console)/page.tsx`; leave a redirect-free structure), `app/not-found.tsx`, `app/error.tsx`, `public/**`, `proxy.ts` (only if needed) | Mutates only via `runTool(..., CONSOLE_ACTOR)`; reads via `lib/domain/*`. No client-side data library, no component library. Removes the scaffold's `public/*.svg` and starter `page.tsx` content. |
| **docs+scripts** | `README.md`, `docs/**` (may edit SPEC/TOOLS/DESIGN only to fix factual drift, noting it), `docs/FRICTION_LOG.md`, `docs/SUBMISSION.md`, `scripts/**` (`dev.ts`, `seed.ts`, `migrate.ts`, `demo-client.ts`), `tests/e2e/**`, `package.json` (scripts section and removing the unused `@supabase/supabase-js` dependency — the only agent that edits `package.json`/`package-lock.json`), `vitest.config.ts`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `.gitignore`, `.env.example`, `LICENSE` | Owns the npm scripts contract in `docs/SPEC.md` §13. Runs the full quality gate before its final commit. |
| **mcpapp** | `lib/mcpapp/**`, `app/api/mcp/ui/**`, `ui/**`, `tests/mcpapp/**` | Feature-flagged by `HOUSEWARDEN_MCP_APP`. Exposes `isMcpAppEnabled()`, `registerMcpApp(server)` and `GUARD_UI_TOOLS`; the tools agent calls them from `lib/mcp/register.ts` behind the flag (that two-line hook is the tools agent's, the implementation is mcpapp's). Must not break hosts that ignore `_meta.ui`. |

Nobody edits: `AGENTS.md`, `CLAUDE.md` (Next re-generates the block), `next-env.d.ts`, `.next/**`, `node_modules/**`, `.env.local`.

## Shared contracts and stubs

- Import types and schemas only from `@/lib/contracts`. Do not redeclare enums or DTOs locally.
- If your work needs a function another agent owns and it does not exist yet, write your code against the signature in `docs/SPEC.md` and add a **local stub only inside your own directories** (for example `lib/tools/_stubs.ts`), clearly named, and list it in your final report so the orchestrator deletes it at merge. Never stub inside another agent's directory.
- Error handling: throw `HousewardenError` from domain code; convert at the boundary you own (tools: `toCallToolResult`; console: `ActionState`).
- Never log secrets; never `console.log` in shipped paths (scripts may print).

## Worktree protocol

```bash
git -C /home/abidali/housewarden worktree add ../hw-<agent> -b build/<agent> main
cd ../hw-<agent> && ln -s /home/abidali/housewarden/node_modules node_modules   # do not npm install
```

- Commit early and often on `build/<agent>`; end every commit message with the two attribution lines from the brief.
- Never push. Never create anything public. The orchestrator merges in this order: **core → tools → console → mcpapp → docs+scripts**, re-running the gate after each.
- Before your final commit run what applies to you: `npx next typegen && npx tsc --noEmit`, `npx eslint .`, `npx vitest run` (your tests), and, for console and tools, `npx next build`. Port 3123 is the only port you may bind for local checks; kill what you started.

## Merge checklist (orchestrator)

1. `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run e2e` green on `main`.
2. No file outside an agent's ownership changed in its branch (`git diff --stat main..build/<agent>`).
3. No `_stubs` files remain; no `TODO`/`FIXME` in `lib/**`, `app/**`.
4. `lib/contracts.ts` diff is additive only.
5. Secrets: `git grep -n "HOUSEWARDEN_TOKEN=\|ADMIN_SECRET=" -- ':!docs' ':!README.md' ':!.env.example'` returns nothing.
