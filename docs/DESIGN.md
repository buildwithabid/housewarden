# Housewarden console — visual identity: "Hearth"

The console is the human half of the guard. It exists so a person can see
exactly what an assistant is about to change and say yes or no. The design
therefore optimises for one thing: **reading a proposed change correctly in
under five seconds, on a phone, at night.** Everything else is secondary.

Identity name: **Hearth** — warm paper ground, ink text, one green accent that
means "safe / verified", amber for "needs you", red for "stop". No gradients,
no shadows (one exception below), no illustrations, no emoji.

## 1. Palette (hex tokens)

Declare as CSS custom properties in `app/globals.css`, map them into Tailwind v4
with `@theme inline`, and switch on `prefers-color-scheme` plus a
`data-theme` attribute so the viewer's choice wins.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F6F4EE` | `#14130F` | page ground |
| `--surface` | `#FFFFFF` | `#1E1C18` | tiles, cards, rows |
| `--surface-2` | `#EFECE4` | `#26241F` | nav, table header, inset panels |
| `--border` | `#DCD8CE` | `#36332C` | 1px lines everywhere |
| `--ink` | `#1B1A17` | `#ECE9E1` | primary text |
| `--ink-2` | `#57544C` | `#B6B2A7` | secondary text, labels |
| `--ink-3` | `#8A867B` | `#807C72` | meta, placeholders, disabled |
| `--accent` | `#1E6B4F` | `#5CC49A` | primary button, "executed", "chain intact", links |
| `--accent-ink` | `#FFFFFF` | `#0F1F19` | text on accent |
| `--accent-soft` | `#DDEFE6` | `#1C3A2E` | success chips, selected row |
| `--warn` | `#A15A00` | `#E9A24C` | "needs confirmation", overdue-soon, pending badge |
| `--warn-soft` | `#FBEBD3` | `#3B2A12` | warn chips, confirmation card header |
| `--danger` | `#A32D2D` | `#F08585` | overdue, high risk, chain broken, reject |
| `--danger-soft` | `#F7DEDE` | `#3F1D1D` | danger chips |
| `--info` | `#2C5C9A` | `#7FAAE8` | low-risk chip, neutral highlights |
| `--info-soft` | `#DCE7F6` | `#1B2C45` | info chips |
| `--focus` | `#1E6B4F` | `#5CC49A` | 2px focus ring (always visible on `:focus-visible`) |

Semantic mapping (never pick colours ad hoc):

| Meaning | Token |
|---|---|
| Risk `read` | ink-3 chip |
| Risk `low` | info chip |
| Risk `confirm` | warn chip |
| Risk `high` | danger chip |
| Status `executed`, chain intact, bill paid, chore done | accent chip |
| Status `pending`, bill due ≤ 3 days | warn chip |
| Status `rejected`, `expired`, `failed`, bill overdue, chain broken | danger chip (expired/rejected use ink-3 text on danger-soft) |
| Diff line `before` | ink-3, strikethrough only for deletes |
| Diff line `after` | ink, with `→` in ink-2 |

Contrast: every text token on its ground meets WCAG AA (ink-3 on surface is 4.6:1 light / 4.5:1 dark; use it for 14px+ only).

## 2. Type

Two families from Google Fonts through `next/font/google` (self-hosted at build, no runtime request):

```ts
// app/layout.tsx
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
```

- **Instrument Sans** (variable) for everything. Weights: 400 body, 500 labels and buttons, 600 headings. Never 700.
- **JetBrains Mono** for ids, hashes, amounts in tables, and JSON. Use `font-variant-numeric: tabular-nums` on amount columns.
- Fallback stacks: `ui-sans-serif, system-ui, sans-serif` and `ui-monospace, SFMono-Regular, Menlo, monospace`.

Scale (rem, line-height): `xs 0.75/1rem` meta · `sm 0.875/1.25rem` body-dense, table cells · `base 1/1.5rem` body · `lg 1.125/1.625rem` card summary · `xl 1.375/1.75rem` page title · `2xl 1.75/2.125rem` dashboard tile value. Page titles are `xl` 600; there is exactly one `h1` per page. Letter-spacing is default everywhere except tile values (`-0.01em`).

## 3. Spacing, radius, layout

- Spacing scale (Tailwind units): `1=4px 2=8 3=12 4=16 5=20 6=24 8=32 10=40 12=48 16=64`. Component padding is 4 (16px) on phone, 6 (24px) from `md`. Section gaps are 8. Never use odd values.
- Radius: `rounded-md` 6px for inputs, buttons and chips; `rounded-lg` 10px for tiles and rows; `rounded-xl` 14px for the confirmation card.
- Borders: 1px `--border` on every surface. No shadows, except the confirmation card: `0 1px 2px rgb(0 0 0 / 0.06), 0 8px 24px rgb(0 0 0 / 0.08)` (dark: `/0.4`, `/0.5`) so it visibly sits above the page.
- Layout: max content width `72rem` centred; sidebar `15rem` from `lg`; on phones a 56px top bar with the product name, the pending badge and a menu button that opens a full-height nav sheet (plain `<details>`/`<dialog>`, no JS library). Body gutter 16px at every width. Tables scroll horizontally inside their own container; the page never does.
- Touch targets ≥ 44×44px. Primary action is always the right-most button on desktop and full-width on phones.
- Motion: none, except 150ms `transition-colors` on interactive elements and the flash notice's 200ms fade. Respect `prefers-reduced-motion` by removing both.

## 4. The three component patterns

Components live in `components/` as server components unless noted; props are plain data from `lib/contracts.ts` types.

### 4.1 Tile (`components/Tile.tsx`)

Dashboard and device summary unit.

```
┌──────────────────────────────┐
│ LABEL (xs, ink-2, uppercase) │
│ 31,300 PKR (2xl, ink)        │
│ 1 overdue (sm, tone colour)  │  ← optional hint line
└──────────────────────────────┘
```

Props: `label`, `value` (string), `hint?`, `tone?: "neutral" | "accent" | "warn" | "danger"` (colours only the hint and a 3px left border in the tone; the value stays ink), `href?` (whole tile is a link, hover = surface-2). Grid: 2 columns on phone, 3 from `md`, 6 from `xl` on the dashboard. Empty value shows `—` in ink-3, never `0` styled as a warning.

### 4.2 List row (`components/ListRow.tsx`)

Every entity list (bills, chores, shopping, reminders, budget entries, audit rows on phone).

```
┌────────────────────────────────────────────────────────────────┐
│ [leading]  Title (base, 500)                        [trailing] │
│            meta · meta · meta (sm, ink-2)           [chip]     │
└────────────────────────────────────────────────────────────────┘
```

Props: `leading?` (a chip or a checkbox form), `title`, `meta: string[]` (joined with ` · `), `chip?: { label, tone }`, `trailing?` (one or two small buttons, each its own `<form action>`), `muted?` (done/checked: ink-3 title, no strikethrough). Rows are separated by 1px borders inside a `rounded-lg` surface; no zebra striping. Rows never navigate on click; only explicit links or buttons act.

### 4.3 Confirmation card (`components/ConfirmationCard.tsx`)

The human half of the guard. Used on `/pending`, inline on any page after a `needs_confirmation` result, and (as static HTML) inside the MCP App.

```
┌────────────────────────────────────────────────────────────────┐ warn-soft header band
│ ● NEEDS YOUR APPROVAL   [confirm]      Expires in 8:12 (mono)  │
│ Mark bill 'Electricity' (3,000 PKR, due 30 Sep) as paid   (lg) │
├────────────────────────────────────────────────────────────────┤
│ Asked by Assistant · for Abid · 2 min ago                 (sm) │
│                                                                │
│ Changes                                              (xs label)│
│  bill  Electricity      status  overdue → paid                 │
│  bill  Electricity      new · 3,000 PKR due 30 Oct (monthly)   │
│                                                                │
│ ⚠ This bill recurs monthly; the next one will be created…      │
│                                                                │
│                              [ Reject ]   [ Approve ]          │
└────────────────────────────────────────────────────────────────┘
```

- Header band: warn-soft (risk `confirm`) or danger-soft (risk `high`, label "NEEDS A PERSON'S APPROVAL"). Countdown is `mm:ss`, updated by a 3-line client component; at 0 the card greys out and shows "Expired — ask again".
- Change lines: three columns (entity in ink-3 mono xs, label 500, diff in ink with the arrow in ink-2). On phones the entity column collapses into the label line.
- Warnings: one per line, prefixed with a text glyph `⚠` in warn.
- Buttons: Approve is the accent primary; Reject is a bordered secondary. Both are `<form action>` server actions with `useFormStatus` "Approving…" text; disabled while pending. After approval the card is replaced by a flash notice "Done: <summary>" in accent-soft; after rejection "Not done: <summary>" in surface-2.
- Terminal states (executed/rejected/expired/failed) render the same card without buttons and with the outcome chip in the header.

Supporting primitives (small, no props explosion): `Chip`, `Button` (`variant: primary | secondary | danger-secondary`, `size: sm | md`), `Field` (label + input + error), `EmptyState` (title, body, optional action), `Flash` (reads `?flash=` and `?tone=`), `PageHeader` (h1 + optional action), `DiffLine`.

## 5. Copy voice

Calm, specific, never cute. The interface speaks like a careful housemate, not a mascot.

- Sentences, not fragments, in body copy; fragments allowed in chips and tile labels.
- Say what will happen, then what happened: "Approve to mark Electricity as paid." → "Electricity is marked paid."
- Name things: "Electricity, 3,000 PKR" not "this bill"; "Assistant asked 2 min ago" not "new request".
- No exclamation marks. No "Oops". No "Awesome". No emoji.
- Numbers: thousands separators, currency code after the number (`3,000 PKR`), dates as `30 Sep` in lists and `30 September 2026` in detail, relative time only for ≤ 7 days.
- Buttons are verbs: Approve, Reject, Add bill, Mark paid, Rotate chores, Clear checked, Verify chain, Load demo data, Sign in, Sign out.
- Empty states (title / body / action):
  - Dashboard, no household: "No household yet" / "Load the demo family to see how Housewarden works, or add your first bill." / Load demo data
  - Pending: "Nothing waiting" / "When the assistant proposes something that needs a person, it appears here with what would change." / —
  - Bills: "No bills" / "Add the ones you pay every month and Housewarden will tell you what's due." / Add bill
  - Audit: "Nothing recorded yet" / "Every change made through Housewarden is written here and chained to the one before it." / —
- Error states: one sentence that says what to do. "That secret didn't match. Try again." / "Couldn't reach the database. Check DATABASE_URL and reload." / "This request expired at 08:10. Ask the assistant again for a fresh preview."
- Security copy is plain: "Token: hw_… (64 characters). Shown once at first start; rotate by editing .env.local."

## 6. Accessibility checklist (blocking)

- Every interactive element is a real `<button>`, `<a>` or `<input>`; every form field has a visible `<label>`.
- Focus ring: `outline: 2px solid var(--focus); outline-offset: 2px` on `:focus-visible`, never removed.
- Colour is never the only signal: chips carry text; diff lines carry the arrow; the chain status carries the word.
- Countdown and flash regions use `aria-live="polite"`.
- Tables have `<th scope="col">`; on phones they become list rows.
- The whole console works with JavaScript disabled except the countdown and the copy button (both degrade to static text).
