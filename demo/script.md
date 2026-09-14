# Demo video — shot list and captions

`demo/housewarden-demo.mp4` · 2:27 (147 s) · 1280×720 · H.264 yuv420p 30 fps · silent AAC track · faststart · burned-in English captions, no narration.

Everything on screen is live: the console runs in a same-origin iframe under the caption bar, and the terminal panel replays a real `@modelcontextprotocol/client` session (Streamable HTTP, MCP 2026-07-28) line by line. The recording script also asserts every step (26 checks), so a video can only be produced from a run in which the storyline actually worked.

## Timeline

| Time | Layout | On screen | Caption (burned in) |
|---|---|---|---|
| 0:00–0:06 | Title card | "Housewarden — Every household action: previewed, confirmed, audited." While the card is up, the console logs in and presses **Load demo data** behind it. | A home assistant is about to be handed real actions. |
| 0:06–0:16 | Console | Dashboard: Ali family, 5 bills (1 overdue), 4 chores, pending —, audit chain 1 row · chain intact; sidebar "Household: Ali family · Chain intact · 1 row". | A home assistant is about to be handed real actions. Housewarden shows what will change, asks, and keeps a tamper-evident record. |
| 0:16–0:20 | Terminal | `connected to housewarden 0.1.0 · protocol 2026-07-28 · 31 tools` | **Live demo** — An MCP client connects over Streamable HTTP with a bearer token — the way Alexa+ talks to a self-hosted server. |
| 0:20–0:29 | Terminal | **Step 1** — You: "Alexa, ask Housewarden how the house is doing." → `get_household_summary {}` → counts line → Alexa: "One bill is overdue: Electricity, 3,000 rupees, due five days ago. Two chores are due today and there are four things to buy. Nothing is waiting for approval." | **Step 1 of 4** — Ask for a summary. Reads are free: no confirmation, no side effects, one spoken sentence. |
| 0:29–0:40 | Terminal | **Step 2** — You: "Mark the electricity bill as paid." → `mark_bill_paid {"bill":"Electricity"}` → `needs_confirmation · risk confirm · expires … · nothing written yet`, the two change lines, the recurrence warning, `how_to_confirm`, Alexa: "I can mark Electricity, 3,000 rupees, as paid and create the next one, due on 9 October, but it needs your approval. Say yes to confirm, or approve it in the console within 10 minutes." | **Step 2 of 4** — A money-moving action. The guard plans it, previews every change and asks. Nothing has been written. |
| 0:40–0:49 | Split | `/pending` in the console: badge "Pending 1", the confirmation card (status overdue → paid, new bill due 9 Oct, warning), **Approve** pressed, flash "Done: Mark bill 'Electricity' … as paid", badge cleared. | **Step 3 of 4** — A person approves on /pending. Same preview, same guard — the console has no privileged path around it. |
| 0:49–0:56 | Split | Terminal: `confirm_action {"action_id":…}` → `executed · idempotent_replay true · ran exactly once` → Alexa: "That was already done: mark bill 'Electricity' … as paid." | **Step 3 of 4** — The assistant's own confirm_action finds it already approved: executed once, replayed — never twice. |
| 0:56–1:12 | Split | `/audit`: rows #3 executed (Console), #2 proposed (Assistant), #1 seeded; **Verify chain** → "Chain intact · 3 rows · checked …". Terminal: **Step 4** — You: "Is the audit log intact?" → `verify_audit_chain {}` → `intact true · 3 rows · head …` → Alexa: "Yes. Three entries, chain intact." | **Step 4 of 4** — The audit log: every row is hashed over the one before it. Verify chain recomputes every hash from the first row. |
| 1:12–1:21 | Terminal | **Bonus** — You: "Unlock the front door." → `set_device_state {"device":"Front door","state":{"locked":false}}` → `needs_confirmation · risk confirm`, change line `locked → unlocked`, Alexa: "I can unlock the front door, but it needs your approval…" | **One more** — A second guarded action: unlocking the front door. Locks are confirm-risk; for a child the policy makes it high-risk — console only. |
| 1:21–1:34 | Split | `/pending`: card "Unlock 'Front door'" (locked yes → no), **Approve**, flash "Done: Unlock 'Front door'"; terminal `confirm_action` → `executed · idempotent_replay true` → Alexa: "That was already done: unlock 'Front door'." | **One more** — The same card, the same Approve. Then the assistant's confirm_action completes the loop. |
| 1:34–1:40 | Console | Dashboard: bills "none overdue", Front door **Unlocked**, audit chain 5 rows · chain intact. | Paid, unlocked, approved by a person, and every step in a chain that still verifies. |
| 1:40–2:19 | Slide | "How it is built": six points revealed one by one beside the 90-second quickstart. | **How it is built** — (1) One guard on every write: propose, preview, policy, then execute — or wait for a person. (2) A tamper-evident record: each audit row is hashed over the previous one and the whole chain is re-verified on demand. (3) Streamable HTTP with MCP 2026-07-28 via SDK v2, and the 2025-11-25 handshake for today's hosts. (4) 31 tools, every one with a schema in, a schema out and a sentence to speak. (5) An MCP App resource so a capable host shows Housewarden's own approval card in the conversation. (6) Self-hosted in 90 seconds on any Node host — embedded Postgres, secrets generated, demo family loaded. |
| 2:19–2:27 | Slide | Repo card: github.com/buildwithabid/housewarden · MIT licensed · self-hosted · zero setup · Alexa+ track · Open Source mini challenge. | Open source, MIT. github.com/buildwithabid/housewarden |

## How it was made

1. Build and start the app with a fresh database: `npm run build`, then `HOUSEWARDEN_DB=pglite HOUSEWARDEN_DATA_DIR=<fresh dir> HOUSEWARDEN_TOKEN=… HOUSEWARDEN_ADMIN_SECRET=… HOUSEWARDEN_ALLOWED_ORIGINS=http://localhost:3124 PORT=3124 npm run start`.
2. Verify the storyline without capture: `HOUSEWARDEN_URL=http://localhost:3124 HOUSEWARDEN_TOKEN=… HOUSEWARDEN_ADMIN_SECRET=… PLAYWRIGHT_DIR=<node_modules with playwright> node demo/record.mjs --check` (26 assertions; the run pays the overdue bill, so restart on a fresh database before recording).
3. Record: the same command without `--check`. `demo/record.mjs` serves `demo/stage.html` on the console's origin through a Playwright route, logs in, loads the demo data, drives the console iframe and the MCP client, and captures every changed frame through the Chrome DevTools screencast with its exact timestamp into `demo/raw/frames/` (git-ignored), writing `list.txt` (an ffmpeg concat list with per-frame durations), `demo/raw/marks.json` (caption timings) and `demo/thumbnail.png` (1280×720, the pending-card moment).
4. Assemble (from `demo/raw/frames/`):

   ```bash
   ffmpeg -y -f concat -safe 0 -i list.txt \
     -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
     -vf "fps=30,format=yuv420p" -c:v libx264 -preset medium -crf 20 -tune stillimage \
     -c:a aac -b:a 64k -shortest -movflags +faststart ../../housewarden-demo.mp4
   ```

5. Check: `ffprobe -show_entries format=duration demo/housewarden-demo.mp4` must be under 180 s (this cut: 147.07 s).

Playwright's built-in `recordVideo` was tried first and dropped: on a mostly static page its frame timestamps drift by several seconds against wall-clock, so holds came out shorter or longer than scripted. The screencast capture keeps the captions and the page in exact sync.
