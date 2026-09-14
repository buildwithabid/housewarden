# Housewarden — product and system specification

Status: design baseline, 2026-09-13. Every build agent implements against this
document and `lib/contracts.ts`. Where prose and code disagree, `lib/contracts.ts`
wins and this document is corrected.

## 0. The thesis in one paragraph

A home assistant is about to be handed real actions — pay this bill, lock the
door, clear the shopping list. The missing piece is not the tools; it is the
safety layer around them. Housewarden is a complete household product (bills,
chores, shopping, reminders, budget, simulated devices and routines, members)
built on **one validated write path**: every mutating tool goes through the
**guard**, which produces a dry-run preview, requires confirmation for risky
actions, executes exactly once, and appends to a hash-chained audit log. The
console uses the same path as the assistant, so a model cannot reach a weaker
path than a person can.

## 1. System overview

```
                     ┌──────────────────────────────────────────────────────────┐
  Alexa+ / any MCP   │ app/api/mcp/route.ts                                     │
  host (Streamable   │  checkOrigin → requireBearer → createMcpHandler(mcp-handler) │
  HTTP, 2025-11-25   │      └─ registers 31 tools from lib/tools/registry.ts     │
  or 2026-07-28)  ──►│      └─ (flag) registers ui://housewarden/pending         │
                     └───────────────┬──────────────────────────────────────────┘
                                     │ runTool(name, input, ASSISTANT_ACTOR)
                     ┌───────────────▼──────────────────────────────────────────┐
  Console (Next.js   │ lib/guard/*  — the ONE write path                         │
  server actions) ──►│  propose → plan (dry-run preview) → policy → execute |    │
  runTool(name,      │  queue → confirm/reject/expire → audit append (hash chain) │
  input, CONSOLE_ACTOR)└──────────────┬───────────────────────────────────────────┘
                                     │ lib/domain/* (plans + executes per entity)
                     ┌───────────────▼──────────────────────────────────────────┐
                     │ lib/db.ts — Db interface; adapters: PGlite (default) / pg │
                     │ db/migrations/*.sql applied on first use                  │
                     └──────────────────────────────────────────────────────────┘
```

Key modules and owners are in `docs/FILE_OWNERSHIP.md`. The single entry point
both surfaces call is:

```ts
// lib/guard/run.ts (core agent)
runTool(name: ToolName, rawInput: unknown, actor: Actor): Promise<ToolOutcome>
// ToolOutcome = { ok: true, output: unknown, spoken: string } | { ok: false, error: ToolError, spoken: string }
```

`runTool` validates `rawInput` with the tool's `inputSchema`, loads the
household, builds a `ToolContext`, dispatches by tool kind (read → `run`;
mutating → `guard.propose`; guard → `run`) and converts thrown
`HousewardenError`s to `ToolError`. Unknown errors become `INTERNAL` with a
generic message (the real error is logged server-side without secrets).

## 2. Entities and invariants

All ids are uuid v4. All money is stored as integer minor units and presented
as major units plus a formatted string. Dates are `YYYY-MM-DD` in the
household timezone; instants are ISO-8601 with milliseconds and `Z`.

| Entity | Fields (DTO in `lib/contracts.ts`) | Invariants |
|---|---|---|
| household | id, name, currency, timezone, created_at | Exactly one row (unique index on a constant). Empty table = "not set up"; every tool except the seed returns `HOUSEHOLD_EMPTY`. |
| members | id, name, role adult\|child, has_pin, created_at | Name unique per household (case-insensitive). PIN stored only as `sha256("<id>:<pin>")`. |
| bills | id, name, amount, currency, amount_formatted, due_date, recurrence none\|monthly\|yearly, status due\|paid\|overdue, paid_at, days_until_due | `status='paid' ⇔ paid_at IS NOT NULL`. Effective status on read: stored `due` with `due_date < today` reads as `overdue`. Marking a recurring bill paid creates the next occurrence (`due_date + 1 month/year`, status `due`). |
| chores | id, title, assigned_member, cadence once\|daily\|weekly\|monthly, due_date, status open\|done, completed_at | `status='done' ⇔ completed_at IS NOT NULL`. Completing a recurring chore creates the next occurrence with the same assignee. |
| shopping_items | id, name, qty (text), category, checked, checked_at | `checked ⇔ checked_at IS NOT NULL`. `clear_shopping_list` deletes checked items by default; `include_unchecked: true` deletes all. |
| reminders | id, text, at, member, status scheduled\|done\|cancelled | Only `scheduled` reminders can be cancelled. |
| budget_entries | id, amount, currency, amount_formatted, category, note, member, occurred_at | Amount ≥ 0. |
| devices | id, name, kind lock\|thermostat\|light\|plug, state, updated_at | `state` validated per kind (`DEVICE_STATE_SCHEMAS`): lock `{locked}`, thermostat `{mode heat\|cool\|off, target_c 5–35}`, light `{on, brightness? 0–100}`, plug `{on}`. Patches merge into the existing state and the merged object must validate. |
| routines | id, name, steps[] | Each step `{tool ∈ ROUTINE_STEP_TOOLS, input}`. The routine is the guarded unit; steps are executed in one transaction and never guarded individually. |
| policies | tool_name, scope, member, risk, source builtin\|household | Unique per (tool, scope, member). `set_policy` may never be set below `confirm` (`SET_POLICY_MINIMUM_RISK`). Read tools cannot be raised (they never mutate). |
| pending_actions | id, tool, input, preview, risk, status, created_by, created_at, expires_at, decided_by, decided_at, executed_at, result, error, idempotency_key | One row per guarded proposal — including immediately executed ones (status `executed` from birth), so idempotency and history have one home. Unique (tool, idempotency_key) when the key is present. |
| audit_log | seq, at, actor, event, tool, action_id, input, result, prev_hash, hash | Append-only (trigger refuses UPDATE/DELETE). `seq` contiguous from 1. `prev_hash` of row n = `hash` of row n-1; row 1 uses 64 zeros. |

Cross-cutting invariants:

1. **Reads write nothing.** Read tools never insert, update or sweep. They compute derived states (overdue, days_until_due) in the query.
2. **Mutations write only inside the guard.** No module outside `lib/guard` calls a `MutationPlan.execute`. Server actions and MCP handlers only call `runTool`.
3. **Every mutation is audited.** An `executed`, `proposed`, `rejected`, `expired` or `failed` row exists for every state transition of a pending action. Seeding writes one `seeded` row.
4. **Dry runs leave no trace.** `dry_run: true` writes no pending action and no audit row.

## 3. The guard

### 3.1 State machine

```
                     dry_run:true ──────────────────────────────► (nothing stored) status "dry_run"
                     │
 propose(tool,input) ┴─ plan() → preview + policyScope → risk = resolvePolicy(tool, scope, member)
        │
        ├─ risk ∈ {read, low}  ──► INSERT pending_actions(status='executed') + execute + audit 'executed'
        │                          └─► status "executed"
        │
        └─ risk ∈ {confirm, high} ► INSERT pending_actions(status='pending', expires_at=now+TTL) + audit 'proposed'
                                     └─► status "needs_confirmation"
                                              │
             ┌────────────────────────────────┼─────────────────────────────┬──────────────────┐
             ▼                                ▼                             ▼                  ▼
   confirm_action / console approve    reject_action / console reject   sweep (expires_at ≤ now)   (no decision)
   claim: pending→confirmed             pending→rejected                pending→expired
   re-plan; preview equal?              audit 'rejected'                audit 'expired'
     yes → execute → executed
           audit 'executed'
     no  → failed (STALE_PREVIEW)
           audit 'failed'
   execute throws → failed, audit 'failed'
```

Terminal states: `executed`, `rejected`, `expired`, `failed`. `confirmed` is
transient (visible only inside the confirm transaction); a crash between claim
and commit rolls the row back to `pending`.

### 3.2 propose(tool, input, actor)

1. Parse input with the tool's `inputSchema` (zod). Failure → `VALIDATION`.
2. Resolve `input.member` (id or name) → `member_id`; unknown → `NOT_FOUND {entity:"member"}`.
3. **Idempotency**: if `idempotency_key` is set and a row `(household, tool, key)` exists → return that row's current outcome: `executed` (with `idempotent_replay: true`), `needs_confirmation` (same action_id and expires_at), or the error for `rejected`/`expired`/`failed` (`ACTION_NOT_PENDING` with `details.status`). Nothing new is written.
4. Sweep expired actions (§3.6) — in the same transaction.
5. `plan = await tool.plan(parsed, ctx)` — pure computation: reads, builds `preview`, `spoken`, `policyScope`, and an `execute` closure. It must not write.
6. `risk = resolvePolicy(tool, plan.policyScope, member_id)` (§4).
7. `dry_run` → return `{status:"dry_run", ...}`. Nothing written.
8. `risk ∈ {read, low}` → in one transaction: insert the pending_actions row with `status='executed'`, run `plan.execute(tx, ctx)`, store `result`, append audit `executed`. Return `{status:"executed"}`.
9. `risk ∈ {confirm, high}` → in one transaction: insert row `status='pending'`, `expires_at = now + TTL`, append audit `proposed`. Return `{status:"needs_confirmation"}` with `how_to_confirm` = `HOW_TO_CONFIRM` (confirm) or `HOW_TO_CONFIRM_CONSOLE_ONLY` (high).

### 3.3 confirm_action(action_id, actor)

1. Sweep expired (§3.6).
2. Atomic claim: `UPDATE pending_actions SET status='confirmed', decided_by=$actor, decided_at=now() WHERE id=$1 AND status='pending' AND expires_at > now() RETURNING *`.
3. If 0 rows: read the row. Missing → `NOT_FOUND {entity:"pending_action"}`. `executed` → return the stored executed result with `idempotent_replay: true` (**exactly-once, idempotent on repeat**). `expired` → `ACTION_EXPIRED`. `rejected`/`failed` → `ACTION_NOT_PENDING {status}`.
4. If the row's `risk` is `high` and `actor.kind !== "console"` → release the claim (set back to `pending`, no audit) and return `HIGH_RISK_CONSOLE_ONLY`.
5. Re-plan from the stored `input` with the *current* database. Compare `canonicalJson(newPreview.changes)` with `canonicalJson(storedPreview.changes)`. Different → `status='failed'`, `error={code:"STALE_PREVIEW"}`, audit `failed`, return `STALE_PREVIEW` with `details.new_preview`. The user re-proposes.
6. Execute inside the same transaction; on success `status='executed'`, `executed_at`, `result`; audit `executed` with the original `input` and the result. Return `{status:"executed", idempotent_replay:false}`.
7. Execution throws → `status='failed'`, `error`, audit `failed`; the domain changes are rolled back (the row and audit updates are re-applied in a fresh transaction so the failure is recorded).

Steps 2–7 run under `SELECT pg_advisory_xact_lock(7743)` (the audit lock, §7.4) so two confirmers of the same action cannot both execute.

### 3.4 reject_action(action_id, actor, reason?)

Claim `pending→rejected` with `decided_by/decided_at`; audit `rejected` with `{reason}`. Repeat on an already-rejected row returns the same `rejected` result with `idempotent_replay: true`. On `executed` → `ACTION_NOT_PENDING {status:"executed"}`.

### 3.5 Console parity

The console's Approve/Reject buttons call `runTool("confirm_action"|"reject_action", …, CONSOLE_ACTOR)`; the console's CRUD forms call `runTool(<mutating tool>, …, CONSOLE_ACTOR)`. When a console mutation returns `needs_confirmation`, the page renders the **confirmation card** with the preview and Approve/Reject — the same `pending_actions` row the assistant would have created. There is no other write path.

### 3.6 Expiry sweep

`sweepExpired(tx)`: `UPDATE pending_actions SET status='expired', decided_at=now(), decided_by=SWEEPER_ACTOR WHERE status='pending' AND expires_at <= now() RETURNING id, tool, input` and one audit `expired` row per swept action. Called at the start of propose, confirm, reject, `list_pending_actions`, and the console `/`, `/pending` pages. There is no timer.

### 3.7 JSON shapes (exact)

All mutating tools return the guard envelope in `structuredContent`; the tool-specific `result` is documented per tool in `docs/TOOLS.md`.

**executed**
```json
{
  "status": "executed",
  "tool": "add_shopping_item",
  "action_id": "3d6f9a2e-8c41-4b1a-9f0e-5a7b6c8d9e0f",
  "risk": "low",
  "preview": {
    "summary": "Add 'Milk' (2 L) to the shopping list under Dairy",
    "changes": [
      { "entity": "shopping_item", "id": null, "op": "create", "label": "Milk",
        "before": null, "after": { "name": "Milk", "qty": "2 L", "category": "Dairy", "checked": false },
        "line": "shopping item 'Milk' 2 L (Dairy): new" }
    ],
    "warnings": []
  },
  "result": { "item": { "id": "a1b2c3d4-…", "name": "Milk", "qty": "2 L", "category": "Dairy", "checked": false, "checked_at": null } },
  "executed_at": "2026-10-05T08:00:12.301Z",
  "idempotent_replay": false,
  "spoken": "Added milk, 2 litres, to the shopping list."
}
```

**needs_confirmation**
```json
{
  "status": "needs_confirmation",
  "tool": "mark_bill_paid",
  "action_id": "7f3d2a9c-5b1e-4c8a-9d6f-1e2b3c4d5e6f",
  "risk": "confirm",
  "preview": {
    "summary": "Mark bill 'Electricity' (3,000 PKR, due 2026-10-05) as paid",
    "changes": [
      { "entity": "bill", "id": "c1a2b3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "op": "update", "label": "Electricity",
        "before": { "status": "overdue", "paid_at": null },
        "after": { "status": "paid", "paid_at": "2026-10-05T08:01:30.250Z" },
        "line": "bill 'Electricity' 3,000 PKR due 2026-10-05: status overdue → paid" },
      { "entity": "bill", "id": null, "op": "create", "label": "Electricity",
        "before": null, "after": { "name": "Electricity", "amount": 3000, "currency": "PKR", "due_date": "2026-11-05", "status": "due" },
        "line": "bill 'Electricity' 3,000 PKR due 2026-11-05: new (monthly recurrence)" }
    ],
    "warnings": ["This bill recurs monthly; the next one will be created for 2026-11-05."]
  },
  "expires_at": "2026-10-05T08:10:00.000Z",
  "how_to_confirm": "Call confirm_action with the action_id, or approve it in the Housewarden console.",
  "spoken": "Marking Electricity, 3,000 rupees, as paid needs your approval. Say yes to confirm, or approve it in the console within 10 minutes."
}
```

**dry_run**
```json
{
  "status": "dry_run",
  "tool": "clear_shopping_list",
  "risk": "confirm",
  "preview": { "summary": "Remove 3 checked items from the shopping list", "changes": [ "…" ], "warnings": [] },
  "would_require_confirmation": true,
  "spoken": "This would remove 3 checked items. It would need your approval."
}
```

**rejected** (from `reject_action`)
```json
{
  "status": "rejected",
  "tool": "run_routine",
  "action_id": "…",
  "preview": { "…": "…" },
  "reason": "Not tonight",
  "rejected_at": "2026-10-05T08:03:00.000Z",
  "idempotent_replay": false,
  "spoken": "Okay, I won't run the bedtime routine."
}
```

**error** (any tool; the MCP result carries `isError: true`)
```json
{ "error": { "code": "ACTION_EXPIRED", "message": "That request expired at 08:10. Ask again and I'll prepare a fresh preview.", "details": { "action_id": "…", "expires_at": "2026-10-05T08:10:00.000Z" } } }
```

### 3.8 Error codes

| Code | When | HTTP/MCP |
|---|---|---|
| `VALIDATION` | Input fails a domain rule the schema cannot express (date in the past for a reminder, unknown currency) | tool error |
| `NOT_FOUND` | A reference (member, bill, chore, item, device, routine, reminder, pending_action) matched nothing; `details.entity`, `details.ref` | tool error |
| `AMBIGUOUS_REF` | A name matched more than one entity; `details.candidates: [{id,label}]` | tool error |
| `ALREADY_DONE` | Bill already paid, chore already done, item already checked, reminder already cancelled | tool error |
| `ACTION_NOT_PENDING` | confirm/reject on a row whose status is not pending; `details.status` | tool error |
| `ACTION_EXPIRED` | confirm on an expired row | tool error |
| `STALE_PREVIEW` | State changed between proposal and approval; `details.new_preview` | tool error |
| `HIGH_RISK_CONSOLE_ONLY` | confirm_action on a `high` action from a non-console actor | tool error |
| `POLICY_INVARIANT` | set_policy tried to lower `set_policy` below confirm, or to change a read tool | tool error |
| `HOUSEHOLD_EMPTY` | No household row yet | tool error |
| `UNSUPPORTED_STATE` | Device state patch invalid for the device kind | tool error |
| `ROUTINE_STEP_INVALID` | A routine step references an unsupported tool or bad input | tool error |
| `UNAUTHORIZED` | Missing/invalid bearer token | HTTP 401 |
| `FORBIDDEN_ORIGIN` | Origin header present and not allow-listed | HTTP 403 |
| `NOT_CONFIGURED` | `HOUSEWARDEN_TOKEN` unset | HTTP 503 |
| `INTERNAL` | Anything else; message is generic | tool error |

Input-schema failures are answered by the SDK itself (`isError: true`, text
"Input validation error: …") before the handler runs; `VALIDATION` is only for
rules zod cannot check.

## 4. Policies and risk

`resolvePolicy(tool, scope, member_id)` picks the first match:

1. `policies` row `(tool, scope, member_id)`
2. `policies` row `(tool, "", member_id)`
3. `policies` row `(tool, scope, NULL)`
4. `policies` row `(tool, "", NULL)`
5. `BUILTIN_SCOPED_POLICIES` `(tool, scope)` — today only `set_device_state` / `lock` → `confirm`
6. `DEFAULT_RISK[tool]`

Defaults (`TOOL_CATALOGUE` in `lib/contracts.ts`): reads → `read`; adds/updates/completions → `low`; `mark_bill_paid`, `clear_shopping_list`, `run_routine`, `add_member`, `set_device_state` for locks → `confirm`; `set_policy` → `high`.

Meaning of the levels:

- `read` — never guarded (read tools only; a policy cannot assign it to a mutating tool).
- `low` — executes immediately, audited.
- `confirm` — queued; a person approves in the console **or** the assistant calls `confirm_action` after the user says yes.
- `high` — queued; **only the console** can approve. `confirm_action` returns `HIGH_RISK_CONSOLE_ONLY`. This is why `set_policy` defaults to `high`: an assistant must not be able to lower the guard and then approve its own change in the same conversation.

`policyScope` values: `set_device_state` → the device kind; `run_routine` → the routine name (lower-cased); everything else `""`. Per-member overrides let a household make, for example, `set_device_state` `high` for a child.

## 5. Idempotency and exactly-once

- `idempotency_key` is scoped to `(household, tool)`. The first call creates the row; every later call with the same key returns that row's outcome without planning or writing.
- `confirm_action` is idempotent: the second call on an executed row returns the stored result with `idempotent_replay: true`. The claim UPDATE (`WHERE status='pending'`) plus the advisory lock guarantee the `execute` closure runs at most once per action.
- Routine steps run inside one transaction: a failing step rolls back all steps and the action becomes `failed`.

## 6. Time

- `ctx.now` is captured once per call and used for `at`, `expires_at`, `paid_at`, `checked_at`, previews and audit rows.
- "Today" = `now` converted to the household timezone, date part. Overdue and `days_until_due` use it. Implement with `Intl.DateTimeFormat(…, { timeZone })` parts — no timezone library.
- TTL = `HOUSEWARDEN_CONFIRM_TTL_SECONDS` (default 600). `expires_at` is stored, never recomputed.

## 7. Audit hash chain

### 7.1 Row body and hash

```
body   = { seq, at, actor, event, tool, action_id, input, result, prev_hash }
hash   = sha256_hex( prev_hash + canonicalJson(body) )
row 1  : prev_hash = "0"×64 (GENESIS_HASH)
row n  : prev_hash = hash of row n-1
```

`at` is the ISO string with milliseconds (`Date.toISOString()`), `seq` a JSON
number, `action_id` a string or `null`, `input` an object, `result` an object
or `null`. `canonicalJson` is exported from `lib/contracts.ts` and defined as:
keys sorted (UTF-16 code-unit order), `undefined` properties dropped, no
whitespace, strings and numbers exactly as `JSON.stringify`, `Date` →
`toISOString()`. `lib/audit.ts` must use that export, not a copy.

### 7.2 Appending

```sql
BEGIN;
SELECT pg_advisory_xact_lock(7743);                      -- serialises appenders
SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1; -- may be empty
-- seq := last.seq + 1 (or 1), prev_hash := last.hash (or GENESIS_HASH)
INSERT INTO audit_log (seq, at, actor, event, tool, action_id, input, result, prev_hash, hash) VALUES (…);
COMMIT;
```

The guard opens the transaction, takes the lock once, and performs the domain
writes and the audit append inside it; `appendAudit(tx, body)` assumes the
lock is held.

### 7.3 Verifying

`verifyAuditChain(db)` reads all rows ordered by `seq` and checks, in order: `seq === previous.seq + 1` (else `seq_gap`), `row.prev_hash === previous.hash` (else `prev_hash_mismatch`), `row.hash === sha256(prev_hash + canonicalJson(body))` (else `hash_mismatch`). Returns `ChainVerification`. The console dashboard and `/audit` show "Chain intact · N rows" or "Chain broken at #k".

Note on timestamps: `at` is read back as a `Date` from both drivers; converting with `toISOString()` reproduces the written string because it was written with millisecond precision and `timestamptz` keeps microseconds.

### 7.4 Worked example (real values)

Row 1 body:

```json
{"seq":1,"at":"2026-10-05T08:00:00.000Z","actor":{"kind":"assistant","id":"mcp","label":"Assistant"},"event":"proposed","tool":"mark_bill_paid","action_id":"7f3d2a9c-5b1e-4c8a-9d6f-1e2b3c4d5e6f","input":{"bill":"Electricity"},"result":{"status":"needs_confirmation","risk":"confirm","preview":{"summary":"Mark bill 'Electricity' (3,000 PKR, due 2026-10-05) as paid","changes":[{"entity":"bill","id":"c1a2b3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d","op":"update","label":"Electricity","before":{"status":"overdue","paid_at":null},"after":{"status":"paid","paid_at":"2026-10-05T08:01:30.250Z"},"line":"bill 'Electricity' 3,000 PKR due 2026-10-05: status overdue → paid"}]}},"prev_hash":"0000000000000000000000000000000000000000000000000000000000000000"}
```

canonicalJson(row 1 body) — note the sorted keys:

```
{"action_id":"7f3d2a9c-5b1e-4c8a-9d6f-1e2b3c4d5e6f","actor":{"id":"mcp","kind":"assistant","label":"Assistant"},"at":"2026-10-05T08:00:00.000Z","event":"proposed","input":{"bill":"Electricity"},"prev_hash":"0000000000000000000000000000000000000000000000000000000000000000","result":{"preview":{"changes":[{"after":{"paid_at":"2026-10-05T08:01:30.250Z","status":"paid"},"before":{"paid_at":null,"status":"overdue"},"entity":"bill","id":"c1a2b3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d","label":"Electricity","line":"bill 'Electricity' 3,000 PKR due 2026-10-05: status overdue → paid","op":"update"}],"summary":"Mark bill 'Electricity' (3,000 PKR, due 2026-10-05) as paid"},"risk":"confirm","status":"needs_confirmation"},"seq":1,"tool":"mark_bill_paid"}
```

```
hash1 = sha256("0"×64 + canonical1)
      = 8d13d950decfe210ea4ac9d033262b26096837c291842609440352aa39434165
```

Row 2 body: `seq 2`, `at "2026-10-05T08:01:30.250Z"`, actor `{"kind":"console","id":"admin","label":"Console"}`, event `executed`, same tool/action_id/input, `result` = `{"status":"executed","risk":"confirm","preview":<same preview>,"result":{"bill":{"id":"c1a2b3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d","name":"Electricity","status":"paid","paid_at":"2026-10-05T08:01:30.250Z"}}}`, `prev_hash` = hash1.

```
hash2 = sha256(hash1 + canonical2)
      = eed2dd5826b2531bfd9d168b9277fa7f58d6f365b1114c44c07281b542f44e73
```

Unit vectors for `canonicalJson` (`tests/core/audit.test.ts` must assert these):

| input | canonical | sha256(canonical) |
|---|---|---|
| `{}` | `{}` | `44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a` |
| `{b:1, a:{d:null, c:[1,"x",true]}}` | `{"a":{"c":[1,"x",true],"d":null},"b":1}` | `217d5b489f15468544b928d539ccec3ae0a956c4c1ee42ea520b8073badc223a` |
| `{a:undefined, b:2}` | `{"b":2}` | `0ab1a6d394cd30195f0642b67ae1180c375ffadf5dd7f39c390668b5fdb6da93` |
| `{s:"héllo → ✓"}` | `{"s":"héllo → ✓"}` | `37e36a63a8d61e87c74b3aa145f3a81cf611a11f2166f93229601ced04d59ddc` |
| `{d:new Date("2026-10-05T08:01:30.250Z")}` | `{"d":"2026-10-05T08:01:30.250Z"}` | `61dd9f1e76090f721742e1582cc2f41954672e82bf90aa5e274d28dfd10856c0` |

## 8. Auth and Origin

Order of checks in `app/api/mcp/route.ts` for every method (GET, POST, DELETE):

1. **Configuration**: if `HOUSEWARDEN_TOKEN` is unset or shorter than 16 chars → `503` `{"jsonrpc":"2.0","id":null,"error":{"code":-32004,"message":"Server not configured: set HOUSEWARDEN_TOKEN"}}`. Never fall open.
2. **Origin**: `Origin` header absent → allowed (non-browser clients). Present → must equal (case-insensitive scheme+host, exact port) one entry of `HOUSEWARDEN_ALLOWED_ORIGINS` (comma-separated full origins, e.g. `https://console.example.com,http://localhost:3000`). Otherwise `403` `{"jsonrpc":"2.0","id":null,"error":{"code":-32003,"message":"Origin not allowed"}}`. The empty default allow-list means every browser origin is refused. (The SDK's `originValidationResponse` compares hostnames only; we compare full origins, so we do not use it.)
3. **Bearer**: `Authorization: Bearer <token>`. Compare with `HOUSEWARDEN_TOKEN` in constant time: `timingSafeEqual(sha256(presented), sha256(expected))` — hashing first gives equal-length buffers without leaking length. Missing or wrong → `401` with `WWW-Authenticate: Bearer realm="housewarden"` and body `{"jsonrpc":"2.0","id":null,"error":{"code":-32001,"message":"Unauthorized"}}`.
4. Hand off to `createMcpHandler(...)` from `mcp-handler`. It serves the 2026-07-28 revision natively and 2025-era Streamable HTTP via the SDK's stateless fallback (POST JSON-RPC, `Accept: application/json, text/event-stream`, 202 for notifications, `MCP-Protocol-Version` checked, GET/DELETE → 405).

`mcp-handler`'s `withMcpAuth` is not used: it advertises an OAuth resource-metadata URL we do not serve. Our wrapper is 30 lines in `lib/mcp/auth.ts` and `lib/mcp/origin.ts`, and both are unit-tested.

Actor for MCP calls is always `ASSISTANT_ACTOR`; `input.member` names the person on whose behalf the assistant acts.

**Console session**: `/login` posts the admin secret to a server action; compared constant-time as above with `HOUSEWARDEN_ADMIN_SECRET`. On success, cookie `hw_session` = `hmac_sha256(secret, "housewarden-console-v1")` hex, `httpOnly`, `sameSite=lax`, `path=/`, `secure` when `HOUSEWARDEN_COOKIE_SECURE=1`, max-age 7 days. Every `(console)` page and every server action calls `requireConsoleSession()` which recomputes the HMAC and compares constant-time; pages redirect to `/login?next=…`, actions throw. Failed login sleeps 300 ms and shows one neutral message. `/logout` clears the cookie. Secrets are never logged and never rendered; `/settings` shows only `hw_…` + length.

## 9. Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `HOUSEWARDEN_DB` | `pglite` (or `pg` when `DATABASE_URL` is set and this is unset) | Storage adapter |
| `HOUSEWARDEN_DATA_DIR` | `.data/pglite` | PGlite data dir; `memory://` = ephemeral (tests) |
| `DATABASE_URL` | — | Postgres URL for the `pg` adapter; `?sslmode=require` honoured |
| `HOUSEWARDEN_PG_SSL` | `auto` | `auto` (from URL), `require`, `disable`, `no-verify` (`rejectUnauthorized:false`) |
| `HOUSEWARDEN_TOKEN` | — (required for MCP) | Bearer token; ≥ 16 chars |
| `HOUSEWARDEN_ADMIN_SECRET` | — (required for console) | Console login secret; ≥ 8 chars |
| `HOUSEWARDEN_ALLOWED_ORIGINS` | `` (empty) | Comma-separated full origins allowed to send an `Origin` header |
| `HOUSEWARDEN_CONFIRM_TTL_SECONDS` | `600` | Pending action lifetime |
| `HOUSEWARDEN_MCP_APP` | on (unset) | `0` (also `false`, `off`, `no`) switches off the `ui://housewarden/pending` resource and the `_meta.ui` on the guard tools |
| `HOUSEWARDEN_PUBLIC_URL` | derived from request | Shown on `/settings` as the endpoint URL |
| `HOUSEWARDEN_COOKIE_SECURE` | `0` | `1` sets the `Secure` flag on the console cookie |
| `HOUSEWARDEN_TIMEZONE` | `Asia/Karachi` | Timezone for a household created by the seed |
| `HOUSEWARDEN_CURRENCY` | `PKR` | Currency for a household created by the seed |
| `PORT` | `3000` | Next.js port; e2e uses 3123 |

`lib/env.ts` parses these once (zod), exposes a typed `env()` and never prints
secret values. `npm run dev` creates `.env.local` with random `HOUSEWARDEN_TOKEN`
and `HOUSEWARDEN_ADMIN_SECRET` when missing and prints them once (§13).

## 10. Storage

### 10.1 Interface

`lib/contracts.ts` → `Db`:

```ts
interface Queryable { query<T>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }> }
interface Db extends Queryable {
  kind: "pglite" | "pg";
  exec(sql: string): Promise<void>;                      // multi-statement, no params (migrations)
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
```

`lib/db.ts` exports `getDb(): Promise<Db>` — a process-wide singleton stored on
`globalThis` (survives Next dev HMR; PGlite is single-connection and a second
instance on the same data dir fails), which applies migrations on first use —
and `createDb(options)` for tests and scripts, plus `closeDb()`.

### 10.2 Adapters and normalisation

| | `lib/db/pglite.ts` | `lib/db/pg.ts` |
|---|---|---|
| Construction | `PGlite.create(dataDir)`; `memory://` → `new PGlite()` | `new Pool({ connectionString, ssl })` |
| `query` | `db.query(sql, params)` → `{rows, rowCount: affectedRows ?? rows.length}` | `pool.query(sql, params)` → `{rows, rowCount ?? rows.length}` |
| `exec` | `db.exec(sql)` | `client.query(sql)` (no params ⇒ multi-statement allowed) |
| `transaction` | `db.transaction(tx => fn(tx))` | `client = await pool.connect(); BEGIN … COMMIT/ROLLBACK; release` |
| int8 (OID 20) | already number | `types.setTypeParser(20, Number)` (values are far below 2^53) |
| date (OID 1082) | `parsers: { 1082: v => v }` → `"YYYY-MM-DD"` | `types.setTypeParser(1082, v => v)` |
| timestamptz | `Date` | `Date` |
| jsonb | object | object |

Both adapters must pass the same `tests/core/db.test.ts` contract suite (the pg
variant is skipped unless `DATABASE_URL_TEST` is set). Placeholders are `$1…$n`
everywhere; string interpolation into SQL is forbidden.

### 10.3 Migrations

`db/migrations/NNNN_name.sql`, applied by `lib/db/migrate.ts` on first `getDb()`
and by `npm run migrate`: read `schema_migrations`, for each file with a
higher version, `exec` the file and insert `(version, name)` inside one
transaction (PGlite runs `exec` inside `transaction`; pg uses one client with
`BEGIN`). Files are idempotent so a partially applied 0001 can be re-run. New
migrations are additive only; never edit 0001 after it ships.

### 10.4 Seed

`lib/seed.ts` → `seedDemo(db, actor)`: refuses when a household exists
(`ALREADY_DONE`), otherwise inserts in one transaction and appends one audit
row `seeded` with `input: {}` and `result: {counts}`. Used by `npm run seed`
and by the console "Load demo data" button. Data (dates relative to *today* in
the household timezone):

- Household "Ali family", PKR, `HOUSEWARDEN_TIMEZONE`.
- Members: Abid (adult), Rabia (adult), Anabiya (child), Adlan (child). No PINs.
- Bills: Electricity 3,000 monthly, **due 5 days ago, status overdue**; Gas 1,800 monthly due in 4 days; Internet 2,500 monthly due in 12 days; School fees 24,000 monthly due in 9 days; Car insurance 38,000 yearly due in 60 days.
- Chores: Take out the bins (Adlan, weekly, due today), Water the plants (Anabiya, daily, due today), Wash the car (Abid, monthly, due in 3 days), Sort the recycling (Rabia, weekly, due in 2 days).
- Shopping: Milk 2 L (Dairy), Eggs 12 (Dairy), Rice 5 kg (Pantry), Dish soap 1 (Household, checked), Apples 1 kg (Fruit).
- Reminders: "Call the electrician" tomorrow 10:00; "Pay school fees" in 8 days 09:00.
- Budget: 6 entries across Groceries, Fuel, School, Household in the current month, and 3 in the previous month.
- Devices: "Front door" lock `{locked: true}`; "Living room" thermostat `{mode: "cool", target_c: 24}`.
- Routine "bedtime": set Front door `{locked: true}`; set Living room `{mode: "cool", target_c: 26}`; add reminder "Check the stove is off" at 22:30 today.
- Policies: `set_device_state` scope `lock` member Adlan → `high` (a child cannot unlock the door without a person approving).

## 11. MCP server surface

### 11.1 Registration

`lib/tools/registry.ts` exports `TOOLS: readonly ToolDefinition[]` (31 entries,
order = `TOOL_CATALOGUE`). `lib/mcp/register.ts` → `registerTools(server: McpServer)` loops it:

```ts
server.registerTool(def.name, {
  title: def.title,
  description: def.description,
  inputSchema: def.inputSchema,                                   // zod v4 object — full z.object, not a raw shape
  outputSchema: def.kind === "mutating" ? guardResultSchema(def.resultSchema) : def.outputSchema,
  annotations: def.annotations ?? defaultAnnotations(def),        // readOnlyHint for reads, destructiveHint/idempotentHint per TOOLS.md
  ...(mcpAppEnabled && GUARD_UI_TOOLS.has(def.name) ? { _meta: { ui: { resourceUri: MCP_APP_RESOURCE_URI } } } : {}),
}, async (args, ctx) => toCallToolResult(await runTool(def.name, args, ASSISTANT_ACTOR)));
```

`toCallToolResult`: ok → `{ content: [{type:"text", text: spoken}], structuredContent: output }`; error → `{ content: [{type:"text", text: spoken}], structuredContent: toolError, isError: true }`. The SDK skips output-schema validation when `isError` is true, so the error object need not match the tool's schema. `mcp-handler` builds a fresh `McpServer` per request, so registration must stay cheap: schemas are module-level constants, nothing is computed inside `registerTools`.

`createMcpHandler(registerTools, { serverInfo: MCP_SERVER_INFO, instructions: SERVER_INSTRUCTIONS, capabilities: { tools: {} , ...(mcpAppEnabled ? { resources: {} } : {}) } })`.

`SERVER_INSTRUCTIONS` (lib/mcp/instructions.ts), spoken-assistant oriented:

> Housewarden manages one household. Reads are free. Every tool that changes something returns either `executed` or `needs_confirmation`. When you get `needs_confirmation`, read the `spoken` line to the user, wait for an explicit yes, then call `confirm_action` with the `action_id`; if they say no, call `reject_action`. Never call `confirm_action` without the user's yes in this conversation. Some actions can only be approved in the console; say so. Use `dry_run: true` when the user asks what would happen. Refer to people, bills, chores and devices by name.

### 11.2 Protocol eras

The endpoint serves the 2026-07-28 revision natively and 2025-11-25 (and
earlier 2025) Streamable HTTP through the SDK's stateless fallback. The e2e
harness connects twice: `versionNegotiation: { mode: "legacy" }` (plain 2025
`initialize`) and `{ mode: "auto" }` (probe → 2026 envelope). Both must list 31
tools and call `get_household_summary`.

### 11.3 MCP App (feature-flagged)

On by default; `HOUSEWARDEN_MCP_APP=0` (also `false`, `off`, `no`) switches it off and `isMcpAppEnabled()` in `lib/mcpapp/register.ts` is the only reader of the flag. When on:

- `server.registerResource("pending-approvals", MCP_APP_RESOURCE_URI, { title: "Pending approvals", mimeType: MCP_APP_MIME_TYPE, _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } } }, async uri => ({ contents: [{ uri: uri.href, mimeType: MCP_APP_MIME_TYPE, text: html, _meta: { ui: { prefersBorder: true } } }] }))` where `html` is `ui/pending.html`, read from disk once per process and cached by `lib/mcpapp/html.ts` (no external assets, no CDN; `next.config.ts` traces the file into the standalone build with `outputFileTracingIncludes`).
- `list_pending_actions`, `confirm_action`, `reject_action` carry `_meta: { ui: { resourceUri: "ui://housewarden/pending" } }`.
- `ui/pending.html` is dependency-free: on load it posts `ui/initialize`, renders `ui/notifications/tool-result` payloads (the `structuredContent` of `list_pending_actions`), and its Approve/Reject buttons send `tools/call` requests for `confirm_action` / `reject_action` over `postMessage`, then re-call `list_pending_actions`. It renders the same confirmation-card pattern as the console (docs/DESIGN.md).
- `GET /api/mcp/ui` serves the same HTML with `text/html` for browser preview (flag on, no auth; it contains no data).
- Hosts that ignore `_meta.ui` see ordinary tools; hosts without `resources` never list the resource. Nothing else changes.

## 12. Console information architecture

All routes live under `app/(console)/` except `/login`. The layout renders the
sidebar (mobile: top bar + sheet), the pending badge (count of `pending`), and
the chain status pill; it calls `requireConsoleSession()`. Every page is a
server component that reads through `lib/domain` read functions (the same
functions the read tools use) and mutates only through server actions in
`app/actions/*.ts`, each of which calls `runTool(..., CONSOLE_ACTOR)`.

| Route | Shows | Server actions (file → function → tool) |
|---|---|---|
| `/login` | Secret field, one neutral error, product name | `auth.ts` → `login(prev, formData)` (no tool; sets cookie), `logout()` |
| `/` | Six tiles: Bills due (overdue count in warn tone), Chores open, Shopping to buy, Reminders next 24 h, Pending approvals, Audit chain (intact/broken, rows). "Today" list: overdue + due-today bills, chores due today, reminders today. Empty household → hero with "Load demo data". | `settings.ts` → `loadDemoData()` (seed; no tool) |
| `/pending` | Pending confirmation cards (risk chip, tool title, who asked, expires-in, summary, change lines, warnings, Approve/Reject). Below: last 20 decided actions with outcome chips. | `guard.ts` → `approveAction(id)` → `confirm_action`; `rejectAction(id, reason)` → `reject_action` |
| `/audit` | Table: #, time, actor, event chip, tool, action (link), hash prefix; row expands to input/result JSON. "Verify chain" button → result banner. Pagination by `?before=seq` (50 rows). | `guard.ts` → `verifyAudit()` → `verify_audit_chain` |
| `/bills` | Rows sorted by due date: name, amount, due (relative), status chip, recurrence. Add form. Row action "Mark paid". | `bills.ts` → `addBill(form)` → `add_bill`; `updateBill(id, form)` → `update_bill`; `markBillPaid(id)` → `mark_bill_paid` (renders confirmation card on `needs_confirmation`) |
| `/chores` | Open chores grouped by due (overdue/today/later/unscheduled) with assignee; done chores collapsed. Add form; assign select; Complete; "Rotate chores". | `chores.ts` → `addChore`, `assignChore`, `completeChore`, `rotateChores` |
| `/shopping` | Unchecked items grouped by category, checked items greyed below. Add form (name, qty, category). Check-off per row. "Clear checked" / "Clear all". | `shopping.ts` → `addShoppingItem`, `checkOffItem`, `clearList(includeUnchecked)` (confirmation card) |
| `/reminders` | Upcoming reminders (scheduled), then done/cancelled collapsed. Add form (text, datetime-local + household tz shown, member). Cancel per row. | `reminders.ts` → `addReminder`, `cancelReminder` |
| `/budget` | Month picker (`?month=YYYY-MM`), total, by-category bars (plain divs, no chart lib), entries list, add-expense form. | `budget.ts` → `recordExpense` |
| `/devices` | One tile per device with its state controls (lock: toggle → confirmation card; thermostat: mode + target; light: on/brightness; plug: on). Routines section with "Run" per routine (confirmation card) and the step list. | `devices.ts` → `setDeviceState(id, patch)` → `set_device_state`; `runRoutine(id)` → `run_routine` |
| `/settings` | Policies table (tool, scope, member, risk, source) with an inline risk select → `set_policy` (high → console-approval card, allowed since the console is the approver). Token hint. MCP endpoint URL + copy button (the only client component beyond forms). Allowed origins list. Storage kind, version, "Load demo data" when empty. | `settings.ts` → `setPolicy(form)` → `set_policy`; `loadDemoData()` |

Confirmation-card flow in the console: a mutating action that returns
`needs_confirmation` redirects to the same page with `?confirm=<action_id>`;
the page loads the pending action and renders the card at the top; Approve →
`approveAction` → redirect without the param + flash "Done: <summary>"; Reject
→ flash "Not done". `ActionState` returned by every action: `{ ok: boolean;
status?: "executed" | "needs_confirmation" | "rejected" | "error"; action_id?:
string; message: string }` for `useActionState`.

Design rules (palette, type, spacing, the three components, copy voice) are in
`docs/DESIGN.md`. Empty and error states are mandatory on every route.

## 13. Scripts (behaviour contract; implemented by the docs+scripts agent)

| Script | Behaviour |
|---|---|
| `npm run dev` | `tsx scripts/dev.ts`: ensure `.env.local` has `HOUSEWARDEN_TOKEN` and `HOUSEWARDEN_ADMIN_SECRET` (generate 32-byte hex, print once); ensure `.data/`; run migrations; if the household is empty, ask "Load the demo household? (Y/n)" (non-TTY → yes) and seed; then `next dev`. |
| `npm run migrate` | Apply pending migrations, print the applied list. |
| `npm run seed` | Seed the demo household; exits 1 with a clear message if one exists (`--force` drops and re-seeds on PGlite only). |
| `npm run test` | `vitest run` (unit + integration on in-memory PGlite). |
| `npm run typecheck` | `next typegen && tsc --noEmit`. |
| `npm run e2e` | `tsx tests/e2e/protocol.e2e.ts`: start `next dev` on a free port (3123 preferred) with a temp data dir and known token; prove `HOUSEWARDEN_TOKEN` unset → 503; wait for `/api/mcp` to answer 401; then with `@modelcontextprotocol/client` + `StreamableHTTPClientTransport`: initialize (legacy and auto) → tools/list = 31, every tool with input and output schema → `get_household_summary` → `add_shopping_item` (executed) → same call with the same `idempotency_key` (idempotent_replay) → `mark_bill_paid` with `dry_run` (nothing queued or audited) → `mark_bill_paid` (needs_confirmation) → prove nothing was written (bill unpaid, action pending, audit `proposed` only) → `confirm_action` (executed) → `confirm_action` again (idempotent_replay, audit unchanged) → `clear_shopping_list` then `reject_action` (never runs) → `verify_audit_chain` (intact) → raw fetch: `Origin: http://evil.test` → 403, allow-listed Origin → 200, missing and wrong bearer → 401, GET → 405, unsupported `MCP-Protocol-Version` → 400. Print a pass/fail table; exit code = failures. Always kill the server it started. `BASE_URL` + `HOUSEWARDEN_TOKEN` target a running server instead. *(docs+scripts agent, 2026-09-14: file name and check list corrected to what ships.)* |
| `npm run demo:client` | `tsx scripts/demo-client.ts`: narrated terminal walkthrough of §14 against a running server (URL and token from env), with pauses, used in the video. |

## 14. Demo storyline (the video's four steps)

1. **Ask for a summary.** "Alexa, ask Housewarden how the house is doing." → `get_household_summary` → spoken: "One bill is overdue: Electricity, 3,000 rupees, due five days ago. Two chores are due today and there are four things to buy. Nothing is waiting for approval."
2. **Mark the overdue bill paid.** "Mark the electricity bill as paid." → `mark_bill_paid {bill:"Electricity"}` → `needs_confirmation` with the preview (status overdue → paid; next month's bill will be created) → spoken: "Marking Electricity, 3,000 rupees, as paid needs your approval…"
3. **The guard asks; approve in the console.** The pending badge lights up; `/pending` shows the confirmation card with the two change lines and the warning; the person taps Approve. (Alternative shown as a caption: saying "yes" makes the assistant call `confirm_action`.)
4. **Audit verified.** `/audit` shows rows `proposed` → `executed` for the same action id, actor Assistant then Console, and "Verify chain" reports "Chain intact · 14 rows". The narrator asks "Is the audit log intact?" → `verify_audit_chain` → "Yes. Fourteen entries, chain intact."

Bonus beat if time allows: "Unlock the front door" as Adlan → `high` → "This one needs a person to approve it in the console."

## 15. Non-goals and decisions taken

- No elicitation / `inputRequired` for confirmations: the record of what was approved must live server-side and be approvable from the console, and voice hosts may not support elicitation.
- No sessions, no SSE resumption: serving is stateless; the pending action *is* the session.
- No timers: expiry is swept on access.
- No third-party UI or data libraries in the console.
- `@supabase/supabase-js` is in `package.json` from the scaffold and unused; the docs+scripts agent removes it.
