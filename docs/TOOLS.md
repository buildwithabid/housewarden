# Housewarden — tool catalogue

31 tools: 12 read, 17 mutating, 2 guard. Names, kinds and default risks are
the `TOOL_CATALOGUE` in `lib/contracts.ts`; shapes below are normative for
`lib/tools/*` (implementation) and `lib/domain/*` (plans). Descriptions are
written for a voice assistant: sentence one says what the tool does, sentence
two says what it needs.

Conventions used in every table:

- **ref** — a string that is either the entity's uuid or its display name/title, matched case-insensitively and exactly (`EntityRefSchema`). More than one match → `AMBIGUOUS_REF`; none → `NOT_FOUND`.
- **instant** — ISO-8601 with offset, e.g. `2026-10-05T22:30:00+05:00` (`IsoInstantSchema`).
- **date** — `YYYY-MM-DD` in the household timezone.
- **amount** — number in major units, ≤ 2 decimals (`AmountSchema`). Output money is `{ amount, currency, amount_formatted }`.
- Every **mutating** tool also accepts the base fields `dry_run` (boolean, default false), `idempotency_key` (string, optional) and `member` (ref, optional: who is asking) — see `MutatingInputBaseSchema` — and returns the guard envelope (`docs/SPEC.md` §3.7) whose `result` field is the shape listed under "Result".
- Every tool's `content[0].text` is the `spoken` line. Errors return `isError: true` with `structuredContent.error` (`docs/SPEC.md` §3.8).
- Annotations: read tools `readOnlyHint: true`; every mutating tool `openWorldHint: false`; `destructiveHint: true` on `clear_shopping_list`, `cancel_reminder`, `reject_action`; `idempotentHint: true` on `confirm_action`, `reject_action`, `check_off_shopping_item`, `complete_chore`, `mark_bill_paid`.

DTOs referenced (Member, Bill, Chore, ShoppingItem, Reminder, BudgetEntry, Device, Routine, Policy, PendingAction, AuditRow, ChainVerification) are defined in `lib/contracts.ts`.

---

## Read tools

### 1. `list_members` — risk `read`

Lists the people in the household with their roles. Needs nothing.

| Input | Type | Notes |
|---|---|---|
| — | | |

| Output | Type |
|---|---|
| `members` | `Member[]` (ordered by created_at) |

```json
// call
{ "name": "list_members", "arguments": {} }
// structuredContent
{ "members": [
  { "id": "6f1c…", "name": "Abid", "role": "adult", "has_pin": false, "created_at": "2026-09-13T10:00:00.000Z" },
  { "id": "9a2d…", "name": "Rabia", "role": "adult", "has_pin": false, "created_at": "2026-09-13T10:00:00.000Z" },
  { "id": "c3e4…", "name": "Anabiya", "role": "child", "has_pin": false, "created_at": "2026-09-13T10:00:00.000Z" },
  { "id": "d4f5…", "name": "Adlan", "role": "child", "has_pin": false, "created_at": "2026-09-13T10:00:00.000Z" } ] }
// spoken
"Four people: Abid and Rabia, and the children Anabiya and Adlan."
```

### 2. `get_household_summary` — risk `read`

Gives a spoken-ready overview of what is due, overdue, waiting for approval and whether the audit log is intact. Needs nothing.

| Output | Type |
|---|---|
| `household` | `{ name, currency, timezone, today: date }` |
| `counts` | `{ members, bills_due, bills_overdue, chores_open, chores_due_today, shopping_to_buy, reminders_next_24h, pending_confirmations }` (integers) |
| `overdue_bills` | `Bill[]` |
| `due_today` | `{ bills: Bill[], chores: Chore[], reminders: Reminder[] }` |
| `devices` | `Device[]` |
| `audit` | `{ rows, chain_intact: boolean, last_hash }` |

```json
{ "name": "get_household_summary", "arguments": {} }
→ { "household": { "name": "Ali family", "currency": "PKR", "timezone": "Asia/Karachi", "today": "2026-10-05" },
    "counts": { "members": 4, "bills_due": 4, "bills_overdue": 1, "chores_open": 4, "chores_due_today": 2, "shopping_to_buy": 4, "reminders_next_24h": 1, "pending_confirmations": 0 },
    "overdue_bills": [ { "id": "c1a2…", "name": "Electricity", "amount": 3000, "currency": "PKR", "amount_formatted": "3,000 PKR", "due_date": "2026-09-30", "recurrence": "monthly", "status": "overdue", "paid_at": null, "days_until_due": -5 } ],
    "due_today": { "bills": [], "chores": [ "…" ], "reminders": [] },
    "devices": [ "…" ],
    "audit": { "rows": 12, "chain_intact": true, "last_hash": "8d13…4165" } }
spoken: "One bill is overdue: Electricity, 3,000 rupees, due five days ago. Two chores are due today and there are four things to buy. Nothing is waiting for approval."
```

### 3. `list_bills` — risk `read`

Lists bills, unpaid ones by default, soonest first. Optionally needs a status filter.

| Input | Type | Notes |
|---|---|---|
| `status` | `"unpaid" \| "due" \| "overdue" \| "paid" \| "all"` | default `"unpaid"` (= due + overdue) |

| Output | Type |
|---|---|
| `bills` | `Bill[]` |
| `totals_due` | `{ currency, amount, amount_formatted }[]` — one per currency among unpaid bills |

```json
{ "name": "list_bills", "arguments": { "status": "unpaid" } }
→ { "bills": [ { "…Electricity overdue…" }, { "id": "…", "name": "Gas", "amount": 1800, "currency": "PKR", "amount_formatted": "1,800 PKR", "due_date": "2026-10-09", "recurrence": "monthly", "status": "due", "paid_at": null, "days_until_due": 4 } ],
    "totals_due": [ { "currency": "PKR", "amount": 31300, "amount_formatted": "31,300 PKR" } ] }
spoken: "Five bills are unpaid, 31,300 rupees in total. Electricity is overdue; Gas is due in four days."
```

### 4. `get_bill` — risk `read`

Reads one bill in detail. Needs the bill name or id.

| Input | Type |
|---|---|
| `bill` | ref |

| Output | Type |
|---|---|
| `bill` | `Bill` |

```json
{ "name": "get_bill", "arguments": { "bill": "Internet" } }
→ { "bill": { "id": "…", "name": "Internet", "amount": 2500, "currency": "PKR", "amount_formatted": "2,500 PKR", "due_date": "2026-10-17", "recurrence": "monthly", "status": "due", "paid_at": null, "days_until_due": 12 } }
spoken: "Internet: 2,500 rupees, due in 12 days, repeats monthly."
```

### 5. `list_chores` — risk `read`

Lists chores, open ones by default, with who they are assigned to. Optionally needs a status filter or a member.

| Input | Type | Notes |
|---|---|---|
| `status` | `"open" \| "done" \| "all"` | default `"open"` |
| `member` | ref | only chores assigned to this member |

| Output | Type |
|---|---|
| `chores` | `Chore[]` (open first, then by due date) |

```json
{ "name": "list_chores", "arguments": { "member": "Adlan" } }
→ { "chores": [ { "id": "…", "title": "Take out the bins", "assigned_member": { "id": "d4f5…", "name": "Adlan" }, "cadence": "weekly", "due_date": "2026-10-05", "status": "open", "completed_at": null } ] }
spoken: "Adlan has one open chore: take out the bins, due today."
```

### 6. `list_shopping` — risk `read`

Lists what is still to buy, grouped by category. Optionally includes checked-off items.

| Input | Type | Notes |
|---|---|---|
| `include_checked` | boolean | default false |

| Output | Type |
|---|---|
| `items` | `ShoppingItem[]` (category, then name) |
| `to_buy` | integer — unchecked count |

```json
{ "name": "list_shopping", "arguments": {} }
→ { "items": [ { "id": "…", "name": "Eggs", "qty": "12", "category": "Dairy", "checked": false, "checked_at": null }, { "…Milk…" }, { "…Apples…" }, { "…Rice…" } ], "to_buy": 4 }
spoken: "Four things to buy: eggs and milk, apples, and rice."
```

### 7. `list_reminders` — risk `read`

Lists upcoming reminders, soonest first. Optionally needs a status, a member, or a time window in hours.

| Input | Type | Notes |
|---|---|---|
| `status` | `"scheduled" \| "done" \| "cancelled" \| "all"` | default `"scheduled"` |
| `member` | ref | |
| `within_hours` | integer 1–8760 | only reminders before now + N hours |

| Output | Type |
|---|---|
| `reminders` | `Reminder[]` |

```json
{ "name": "list_reminders", "arguments": { "within_hours": 24 } }
→ { "reminders": [ { "id": "…", "text": "Call the electrician", "at": "2026-10-06T05:00:00.000Z", "member": { "id": "6f1c…", "name": "Abid" }, "status": "scheduled" } ] }
spoken: "One reminder in the next day: call the electrician, tomorrow at 10."
```

### 8. `list_devices` — risk `read`

Lists the smart-home devices with their current state, and the routines that can be run. Needs nothing.

| Output | Type |
|---|---|
| `devices` | `Device[]` |
| `routines` | `Routine[]` |

```json
{ "name": "list_devices", "arguments": {} }
→ { "devices": [ { "id": "…", "name": "Front door", "kind": "lock", "state": { "locked": true }, "updated_at": "…" }, { "id": "…", "name": "Living room", "kind": "thermostat", "state": { "mode": "cool", "target_c": 24 }, "updated_at": "…" } ],
    "routines": [ { "id": "…", "name": "bedtime", "steps": [ { "tool": "set_device_state", "input": { "device": "Front door", "state": { "locked": true } } }, { "tool": "set_device_state", "input": { "device": "Living room", "state": { "mode": "cool", "target_c": 26 } } }, { "tool": "add_reminder", "input": { "text": "Check the stove is off", "at": "22:30" } } ] } ] }
spoken: "The front door is locked and the living room is cooling to 24 degrees. One routine is available: bedtime."
```

### 9. `get_budget_summary` — risk `read`

Summarises spending for a month by category, with the previous month for comparison. Optionally needs the month as YYYY-MM.

| Input | Type | Notes |
|---|---|---|
| `month` | `YYYY-MM` | default: current month in the household timezone |

| Output | Type |
|---|---|
| `month` | `YYYY-MM` |
| `currency` | string |
| `total` | `{ amount, amount_formatted }` |
| `by_category` | `{ category, amount, amount_formatted, share }[]` (share 0–1, largest first) |
| `entries` | `BudgetEntry[]` (newest first, max 50) |
| `bills_paid` | `{ count, amount, amount_formatted }` — bills with `paid_at` in the month |
| `previous_month` | `{ month, total: { amount, amount_formatted } }` |

```json
{ "name": "get_budget_summary", "arguments": { "month": "2026-10" } }
→ { "month": "2026-10", "currency": "PKR", "total": { "amount": 21450, "amount_formatted": "21,450 PKR" },
    "by_category": [ { "category": "Groceries", "amount": 9800, "amount_formatted": "9,800 PKR", "share": 0.457 }, "…" ],
    "entries": [ "…" ], "bills_paid": { "count": 1, "amount": 3000, "amount_formatted": "3,000 PKR" },
    "previous_month": { "month": "2026-09", "total": { "amount": 18200, "amount_formatted": "18,200 PKR" } } }
spoken: "October so far: 21,450 rupees, mostly groceries. That is 3,250 more than September at this point."
```

### 10. `list_pending_actions` — risk `read`

Lists actions waiting for approval, with what each would change and when it expires. Optionally needs a status filter.

| Input | Type | Notes |
|---|---|---|
| `status` | `"pending" \| "all"` | default `"pending"` |
| `limit` | integer 1–100 | default 20 |

| Output | Type |
|---|---|
| `actions` | `PendingAction[]` (newest first) |
| `pending_count` | integer |

```json
{ "name": "list_pending_actions", "arguments": {} }
→ { "actions": [ { "id": "7f3d…", "tool": "mark_bill_paid", "input": { "bill": "Electricity" }, "preview": { "summary": "Mark bill 'Electricity' (3,000 PKR, due 2026-09-30) as paid", "changes": [ "…" ], "warnings": [ "…" ] }, "risk": "confirm", "status": "pending", "created_by": { "kind": "assistant", "id": "mcp", "label": "Assistant" }, "created_at": "…", "expires_at": "…", "decided_by": null, "decided_at": null, "executed_at": null, "result": null, "error": null, "idempotency_key": null } ], "pending_count": 1 }
spoken: "One action is waiting: mark Electricity as paid. It expires in eight minutes."
```

### 11. `get_audit_log` — risk `read`

Reads the tamper-evident audit log, newest first. Optionally needs a limit, a starting point, or an action id.

| Input | Type | Notes |
|---|---|---|
| `limit` | integer 1–200 | default 20 |
| `before_seq` | integer | rows with seq < this (pagination) |
| `action_id` | uuid | only rows for this action |

| Output | Type |
|---|---|
| `rows` | `AuditRow[]` |
| `total_rows` | integer |
| `chain_head` | `{ seq, hash }` |

```json
{ "name": "get_audit_log", "arguments": { "action_id": "7f3d2a9c-5b1e-4c8a-9d6f-1e2b3c4d5e6f" } }
→ { "rows": [ { "seq": 2, "at": "2026-10-05T08:01:30.250Z", "actor": { "kind": "console", "id": "admin", "label": "Console" }, "event": "executed", "tool": "mark_bill_paid", "action_id": "7f3d…", "input": { "bill": "Electricity" }, "result": { "…" }, "prev_hash": "8d13…4165", "hash": "eed2…4e73" },
             { "seq": 1, "…event…": "proposed", "…" } ],
    "total_rows": 2, "chain_head": { "seq": 2, "hash": "eed2dd58…" } }
spoken: "Two entries for that action: proposed by the assistant, then executed from the console."
```

### 12. `verify_audit_chain` — risk `read`

Recomputes every hash in the audit log and reports whether the chain is intact. Needs nothing.

| Output | Type |
|---|---|
| (root) | `ChainVerification` — `{ intact, rows, last_seq, last_hash, checked_at, first_bad_seq, reason }` |

```json
{ "name": "verify_audit_chain", "arguments": {} }
→ { "intact": true, "rows": 14, "last_seq": 14, "last_hash": "…", "checked_at": "2026-10-05T08:05:00.000Z", "first_bad_seq": null, "reason": null }
spoken: "Yes. Fourteen entries, chain intact."
```

---

## Mutating tools (all through the guard)

Each accepts `dry_run`, `idempotency_key`, `member` in addition to the fields listed. "Result" is the `result` field inside the `executed` envelope. Examples show the envelope once (tool 16) and only `result` elsewhere.

### 13. `add_member` — risk `confirm`

Adds a person to the household as an adult or a child. Needs a name and a role; a 4–8 digit PIN is optional.

| Input | Type | Notes |
|---|---|---|
| `name` | string 1–100 | unique, case-insensitive |
| `role` | `"adult" \| "child"` | |
| `pin` | string, 4–8 digits | stored hashed |

Result: `{ member: Member }`. Preview: one `create` change on `member`. `ALREADY_DONE` if the name exists.

```json
{ "name": "add_member", "arguments": { "name": "Munazza", "role": "adult" } }
→ needs_confirmation; after approval result: { "member": { "id": "…", "name": "Munazza", "role": "adult", "has_pin": false, "created_at": "…" } }
spoken (proposal): "Adding Munazza as an adult needs your approval."
```

### 14. `add_bill` — risk `low`

Adds a bill with an amount and due date, optionally recurring. Needs the name, amount and due date.

| Input | Type | Notes |
|---|---|---|
| `name` | string 1–100 | |
| `amount` | amount | |
| `currency` | ISO-4217 | default household currency |
| `due_date` | date | |
| `recurrence` | `"none" \| "monthly" \| "yearly"` | default `"none"` |

Result: `{ bill: Bill }`.

```json
{ "name": "add_bill", "arguments": { "name": "Water", "amount": 900, "due_date": "2026-10-20", "recurrence": "monthly" } }
→ result: { "bill": { "id": "…", "name": "Water", "amount": 900, "currency": "PKR", "amount_formatted": "900 PKR", "due_date": "2026-10-20", "recurrence": "monthly", "status": "due", "paid_at": null, "days_until_due": 15 } }
spoken: "Added Water, 900 rupees, due on the 20th, monthly."
```

### 15. `update_bill` — risk `low`

Changes a bill's name, amount, currency, due date or recurrence. Needs the bill and at least one field to change.

| Input | Type |
|---|---|
| `bill` | ref |
| `name`, `amount`, `currency`, `due_date`, `recurrence` | as in add_bill, all optional (≥ 1 required) |

Result: `{ bill: Bill }`. Preview `before`/`after` list only the changed fields. `ALREADY_DONE` if the bill is paid (paid bills are immutable).

```json
{ "name": "update_bill", "arguments": { "bill": "Gas", "amount": 2100 } }
→ result: { "bill": { "…", "amount": 2100, "amount_formatted": "2,100 PKR" } }
spoken: "Gas is now 2,100 rupees."
```

### 16. `mark_bill_paid` — risk `confirm`

Marks a bill as paid and, if it recurs, creates the next one. Needs the bill name or id.

| Input | Type | Notes |
|---|---|---|
| `bill` | ref | |
| `paid_at` | instant | default now |

Result: `{ bill: Bill, next_bill: Bill | null }`. Preview: `update` on the bill (`status`, `paid_at`) and, when recurring, a `create` for the next occurrence plus a warning. `ALREADY_DONE` if already paid.

```json
{ "name": "mark_bill_paid", "arguments": { "bill": "Electricity" } }
→ structuredContent:
{ "status": "needs_confirmation", "tool": "mark_bill_paid", "action_id": "7f3d2a9c-5b1e-4c8a-9d6f-1e2b3c4d5e6f", "risk": "confirm",
  "preview": { "summary": "Mark bill 'Electricity' (3,000 PKR, due 2026-09-30) as paid",
    "changes": [
      { "entity": "bill", "id": "c1a2…", "op": "update", "label": "Electricity", "before": { "status": "overdue", "paid_at": null }, "after": { "status": "paid", "paid_at": "2026-10-05T08:01:30.250Z" }, "line": "bill 'Electricity' 3,000 PKR due 2026-09-30: status overdue → paid" },
      { "entity": "bill", "id": null, "op": "create", "label": "Electricity", "before": null, "after": { "name": "Electricity", "amount": 3000, "currency": "PKR", "due_date": "2026-10-30", "status": "due" }, "line": "bill 'Electricity' 3,000 PKR due 2026-10-30: new (monthly recurrence)" } ],
    "warnings": [ "This bill recurs monthly; the next one will be created for 2026-10-30." ] },
  "expires_at": "2026-10-05T08:11:30.250Z",
  "how_to_confirm": "Call confirm_action with the action_id, or approve it in the Housewarden console.",
  "spoken": "Marking Electricity, 3,000 rupees, as paid needs your approval. Say yes to confirm, or approve it in the console within 10 minutes." }
// after confirm_action:
{ "status": "executed", "…", "result": { "bill": { "…status…": "paid" }, "next_bill": { "…due_date…": "2026-10-30" } }, "idempotent_replay": false, "spoken": "Electricity is marked paid. The next one is due on 30 October." }
```

### 17. `add_chore` — risk `low`

Adds a chore, optionally assigned to someone and repeating. Needs a title.

| Input | Type | Notes |
|---|---|---|
| `title` | string 1–200 | |
| `assign_to` | ref | member |
| `cadence` | `"once" \| "daily" \| "weekly" \| "monthly"` | default `"once"` |
| `due_date` | date | |

Result: `{ chore: Chore }`.

```json
{ "name": "add_chore", "arguments": { "title": "Clean the fridge", "assign_to": "Rabia", "due_date": "2026-10-07" } }
→ result: { "chore": { "id": "…", "title": "Clean the fridge", "assigned_member": { "id": "9a2d…", "name": "Rabia" }, "cadence": "once", "due_date": "2026-10-07", "status": "open", "completed_at": null } }
spoken: "Added: clean the fridge, for Rabia, due Wednesday."
```

### 18. `assign_chore` — risk `low`

Assigns a chore to a member, or unassigns it. Needs the chore and the member (or null).

| Input | Type |
|---|---|
| `chore` | ref |
| `assign_to` | ref \| null |

Result: `{ chore: Chore }`.

```json
{ "name": "assign_chore", "arguments": { "chore": "Wash the car", "assign_to": "Adlan" } }
→ result: { "chore": { "…", "assigned_member": { "id": "d4f5…", "name": "Adlan" } } }
spoken: "Wash the car is now Adlan's."
```

### 19. `complete_chore` — risk `low`

Marks a chore done and, if it repeats, schedules the next one. Needs the chore.

| Input | Type |
|---|---|
| `chore` | ref |

Result: `{ chore: Chore, next_chore: Chore | null }`. `ALREADY_DONE` if done.

```json
{ "name": "complete_chore", "arguments": { "chore": "Take out the bins" } }
→ result: { "chore": { "…status…": "done", "completed_at": "…" }, "next_chore": { "…due_date…": "2026-10-12" } }
spoken: "Bins done. Next time is Monday the 12th."
```

### 20. `rotate_chores` — risk `low`

Rotates every open, assigned chore to the next member in the household order. Needs nothing.

Result: `{ rotated: { chore: Chore, from: MemberRef, to: MemberRef }[] }`. Preview: one `update` per chore. Unassigned chores are untouched; an empty rotation is `ALREADY_DONE`.

```json
{ "name": "rotate_chores", "arguments": { "dry_run": true } }
→ { "status": "dry_run", "risk": "low", "would_require_confirmation": false, "preview": { "summary": "Rotate 4 chores to the next member", "changes": [ { "entity": "chore", "id": "…", "op": "update", "label": "Take out the bins", "before": { "assigned_member": "Adlan" }, "after": { "assigned_member": "Abid" }, "line": "chore 'Take out the bins': Adlan → Abid" }, "…" ], "warnings": [] }, "spoken": "This would move four chores along: the bins would go to Abid, the plants to Rabia, the car to Anabiya and the recycling to Adlan." }
```

### 21. `add_shopping_item` — risk `low`

Adds an item to the shopping list with a quantity and category. Needs the item name.

| Input | Type | Notes |
|---|---|---|
| `name` | string 1–100 | |
| `qty` | string 1–40 | default `"1"` |
| `category` | string 1–60 | |

Result: `{ item: ShoppingItem }`. `ALREADY_DONE` if an unchecked item with that name exists (message includes its qty).

```json
{ "name": "add_shopping_item", "arguments": { "name": "Milk", "qty": "2 L", "category": "Dairy" } }
→ result: { "item": { "id": "…", "name": "Milk", "qty": "2 L", "category": "Dairy", "checked": false, "checked_at": null } }
spoken: "Added milk, 2 litres, to the shopping list."
```

### 22. `check_off_shopping_item` — risk `low`

Checks an item off the shopping list. Needs the item name or id.

| Input | Type |
|---|---|
| `item` | ref |

Result: `{ item: ShoppingItem }`. `ALREADY_DONE` if checked.

```json
{ "name": "check_off_shopping_item", "arguments": { "item": "Eggs" } }
→ result: { "item": { "…checked…": true, "checked_at": "…" } }
spoken: "Eggs checked off. Three things left."
```

### 23. `clear_shopping_list` — risk `confirm`

Removes checked-off items from the shopping list, or everything if asked. Optionally needs `include_unchecked`.

| Input | Type | Notes |
|---|---|---|
| `include_unchecked` | boolean | default false |

Result: `{ removed: number, removed_items: ShoppingItem[] }`. Preview: one `delete` change per item. `ALREADY_DONE` when nothing would be removed.

```json
{ "name": "clear_shopping_list", "arguments": { "include_unchecked": true } }
→ needs_confirmation; preview.summary "Remove all 5 items from the shopping list (4 not yet bought)"; warnings ["4 of these items have not been bought."]
spoken: "Clearing all five items, including four you haven't bought, needs your approval."
```

### 24. `add_reminder` — risk `low`

Adds a reminder at a specific time, optionally for one member. Needs the text and the time with timezone offset.

| Input | Type | Notes |
|---|---|---|
| `text` | string 1–300 | |
| `at` | instant | must be in the future (`VALIDATION` otherwise) |
| `for_member` | ref | |

Result: `{ reminder: Reminder }`.

```json
{ "name": "add_reminder", "arguments": { "text": "Call the electrician", "at": "2026-10-06T10:00:00+05:00", "for_member": "Abid" } }
→ result: { "reminder": { "id": "…", "text": "Call the electrician", "at": "2026-10-06T05:00:00.000Z", "member": { "id": "6f1c…", "name": "Abid" }, "status": "scheduled" } }
spoken: "Reminder set for Abid: call the electrician, tomorrow at 10."
```

### 25. `cancel_reminder` — risk `low`

Cancels a scheduled reminder. Needs the reminder id or its exact text.

| Input | Type |
|---|---|
| `reminder` | ref (id or exact text) |

Result: `{ reminder: Reminder }`. `ALREADY_DONE` if not scheduled.

```json
{ "name": "cancel_reminder", "arguments": { "reminder": "Call the electrician" } }
→ result: { "reminder": { "…status…": "cancelled" } }
spoken: "Cancelled: call the electrician."
```

### 26. `record_expense` — risk `low`

Records money spent in a category for the budget. Needs the amount and category.

| Input | Type | Notes |
|---|---|---|
| `amount` | amount | |
| `currency` | ISO-4217 | default household currency |
| `category` | string 1–60 | |
| `note` | string ≤ 300 | |
| `occurred_at` | instant | default now |
| `paid_by` | ref | member |

Result: `{ entry: BudgetEntry, month_total: { month, amount, amount_formatted } }`.

```json
{ "name": "record_expense", "arguments": { "amount": 1450, "category": "Groceries", "note": "Imtiaz", "paid_by": "Rabia" } }
→ result: { "entry": { "id": "…", "amount": 1450, "currency": "PKR", "amount_formatted": "1,450 PKR", "category": "Groceries", "note": "Imtiaz", "member": { "id": "9a2d…", "name": "Rabia" }, "occurred_at": "…" }, "month_total": { "month": "2026-10", "amount": 22900, "amount_formatted": "22,900 PKR" } }
spoken: "Recorded 1,450 rupees for groceries. October is at 22,900."
```

### 27. `set_device_state` — risk `low` (locks: `confirm`)

Changes a device's state, such as locking a door or setting a thermostat. Needs the device and the fields to change.

| Input | Type | Notes |
|---|---|---|
| `device` | ref | |
| `state` | object | patch merged into the current state; the merged state must validate for the kind (`UNSUPPORTED_STATE`) |

Result: `{ device: Device }`. `policyScope` = device kind. Preview `before`/`after` show only changed keys. `ALREADY_DONE` if nothing changes.

```json
{ "name": "set_device_state", "arguments": { "device": "Front door", "state": { "locked": false }, "member": "Adlan" } }
→ { "status": "needs_confirmation", "risk": "high", "…", "how_to_confirm": "This action is high risk: a person must approve it in the Housewarden console.",
    "preview": { "summary": "Unlock 'Front door'", "changes": [ { "entity": "device", "id": "…", "op": "update", "label": "Front door", "before": { "locked": true }, "after": { "locked": false }, "line": "device 'Front door' (lock): locked → unlocked" } ], "warnings": [ "Adlan is a child; unlocking needs a person to approve it in the console." ] },
    "spoken": "Unlocking the front door for Adlan needs a person to approve it in the console." }
// thermostat, low risk:
{ "name": "set_device_state", "arguments": { "device": "Living room", "state": { "target_c": 22 } } }
→ result: { "device": { "…state…": { "mode": "cool", "target_c": 22 } } }   spoken: "Living room set to 22 degrees."
```

### 28. `run_routine` — risk `confirm`

Runs a saved routine, applying each of its steps together. Needs the routine name.

| Input | Type |
|---|---|
| `routine` | ref |

Result: `{ routine: Routine, steps: { tool, summary, result }[] }`. Preview: the concatenated previews of every step (device changes, reminder creation); `policyScope` = routine name lower-cased. Relative times in steps (`"22:30"`) resolve to today in the household timezone. A step that cannot be planned → `ROUTINE_STEP_INVALID`.

```json
{ "name": "run_routine", "arguments": { "routine": "bedtime" } }
→ needs_confirmation; preview.summary "Run routine 'bedtime' (3 steps)"; changes: Front door locked → locked (no change), Living room target 24 → 26, reminder 'Check the stove is off' at 22:30 new
spoken: "Bedtime would set the living room to 26 and remind you at 10:30 to check the stove; the door is already locked. Shall I run it?"
```

### 29. `set_policy` — risk `high`

Changes how much confirmation a tool needs, for everyone or for one member. Needs the tool name and the new risk level.

| Input | Type | Notes |
|---|---|---|
| `tool_name` | one of the mutating tool names | read/guard tools → `POLICY_INVARIANT` |
| `scope` | string ≤ 60 | default `""`; e.g. `"lock"` for set_device_state |
| `for_member` | ref \| null | default null (everyone) |
| `risk` | `"low" \| "confirm" \| "high"` | `set_policy` itself cannot go below `confirm` → `POLICY_INVARIANT` |

Result: `{ policy: Policy, previous: Policy }`. Preview: `update` on `policy` with `before.risk`/`after.risk` and the effective source.

```json
{ "name": "set_policy", "arguments": { "tool_name": "clear_shopping_list", "risk": "low" } }
→ { "status": "needs_confirmation", "risk": "high", "how_to_confirm": "This action is high risk: a person must approve it in the Housewarden console.", "…" }
spoken: "Changing the rule for clearing the shopping list needs a person to approve it in the console."
```

---

## Guard tools

### 30. `confirm_action` — risk `low` (not policy-controlled)

Approves a waiting action so it runs exactly once. Needs the action id from a needs_confirmation reply.

| Input | Type |
|---|---|
| `action_id` | uuid |

Output: the `executed` envelope of the original tool (`result` typed as a record). Errors: `NOT_FOUND`, `ACTION_EXPIRED`, `ACTION_NOT_PENDING {status}`, `STALE_PREVIEW {new_preview}`, `HIGH_RISK_CONSOLE_ONLY`. A repeat call on an executed action returns the same envelope with `idempotent_replay: true`.

```json
{ "name": "confirm_action", "arguments": { "action_id": "7f3d2a9c-5b1e-4c8a-9d6f-1e2b3c4d5e6f" } }
→ { "status": "executed", "tool": "mark_bill_paid", "action_id": "7f3d…", "risk": "confirm", "preview": { "…" }, "result": { "bill": { "…" }, "next_bill": { "…" } }, "executed_at": "2026-10-05T08:01:30.250Z", "idempotent_replay": false, "spoken": "Done. Electricity is marked paid; the next one is due on 30 October." }
```

### 31. `reject_action` — risk `low` (not policy-controlled)

Declines a waiting action so it never runs. Needs the action id; a reason is optional.

| Input | Type |
|---|---|
| `action_id` | uuid |
| `reason` | string ≤ 200 |

Output: `RejectedResult` — `{ status: "rejected", tool, action_id, preview, reason, rejected_at, idempotent_replay, spoken }`. Errors: `NOT_FOUND`, `ACTION_NOT_PENDING {status}` (executed/expired/failed).

```json
{ "name": "reject_action", "arguments": { "action_id": "…", "reason": "Not tonight" } }
→ { "status": "rejected", "tool": "run_routine", "action_id": "…", "preview": { "…" }, "reason": "Not tonight", "rejected_at": "…", "idempotent_replay": false, "spoken": "Okay, I won't run the bedtime routine." }
```

---

## Spoken-line rules (every tool)

- One or two sentences, present tense, no ids, no hashes, no JSON.
- Money as "3,000 rupees" (currency name from a small map: PKR→rupees, USD→dollars, GBP→pounds, EUR→euros; otherwise the code).
- Dates relative when within 7 days ("tomorrow", "in four days", "five days ago"), otherwise "on 30 October".
- `needs_confirmation` lines end with what to do: "Say yes to confirm, or approve it in the console within 10 minutes." / "…needs a person to approve it in the console."
- Errors are calm and actionable: "I couldn't find a bill called Watr. The unpaid bills are Electricity, Gas, Internet, School fees and Car insurance."
