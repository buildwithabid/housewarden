import { z } from "zod";
import {
  ChoreCadenceSchema,
  ChoreSchema,
  EntityRefSchema,
  HousewardenError,
  IsoDateSchema,
  MemberRefSchema,
  MutatingInputBaseSchema,
  type Change,
  type Chore,
  type ChoreCadence,
  type ChoreStatus,
  type Member,
  type MemberRef,
  type MutationPlan,
  type Queryable,
  type ToolContext,
} from "@/lib/contracts";
import { addDays, addMonths, spokenDate, todayInZone } from "@/lib/time";
import { findMember, listMembers } from "./members";
import { iso, joinSpoken, lowerFirst, matchRef, plural } from "./shared";

interface ChoreRow extends Record<string, unknown> {
  id: string;
  title: string;
  assigned_member_id: string | null;
  assigned_member_name: string | null;
  cadence: ChoreCadence;
  due_date: string | null;
  status: ChoreStatus;
  completed_at: Date | null;
}

const CHORE_SELECT = `
  SELECT c.id, c.title, c.assigned_member_id, m.name AS assigned_member_name, c.cadence, c.due_date, c.status, c.completed_at
  FROM chores c LEFT JOIN members m ON m.id = c.assigned_member_id
  WHERE c.household_id = $1`;

const CHORE_ORDER = `ORDER BY (c.status = 'done'), c.due_date NULLS LAST, c.title`;

function rowToChore(row: ChoreRow): Chore {
  return {
    id: row.id,
    title: row.title,
    assigned_member:
      row.assigned_member_id && row.assigned_member_name ? { id: row.assigned_member_id, name: row.assigned_member_name } : null,
    cadence: row.cadence,
    due_date: row.due_date,
    status: row.status,
    completed_at: iso(row.completed_at),
  };
}

export type ChoreFilter = "open" | "done" | "all";

export interface ListChoresOptions {
  status?: ChoreFilter;
  memberId?: string;
}

/** Chores, open first then by due date. */
export async function listChores(db: Queryable, householdId: string, options: ListChoresOptions = {}): Promise<Chore[]> {
  const params: unknown[] = [householdId];
  const clauses: string[] = [];
  const status = options.status ?? "open";
  if (status !== "all") {
    params.push(status);
    clauses.push(`c.status = $${params.length}`);
  }
  if (options.memberId) {
    params.push(options.memberId);
    clauses.push(`c.assigned_member_id = $${params.length}::uuid`);
  }
  const where = clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
  const res = await db.query<ChoreRow>(`${CHORE_SELECT}${where} ${CHORE_ORDER}`, params);
  return res.rows.map(rowToChore);
}

export async function getChoreById(db: Queryable, householdId: string, id: string): Promise<Chore | null> {
  const res = await db.query<ChoreRow>(`${CHORE_SELECT} AND c.id = $2::uuid`, [householdId, id]);
  return res.rows[0] ? rowToChore(res.rows[0]) : null;
}

/** Resolves a chore by id or title; when a title matches several, the open one wins. */
export async function findChore(db: Queryable, householdId: string, ref: string): Promise<Chore> {
  const chores = await listChores(db, householdId, { status: "all" });
  return matchRef(chores, ref, {
    entity: "chore",
    label: (c) => c.title,
    prefer: (c) => c.status === "open",
    notFound: (r) => {
      const open = chores.filter((c) => c.status === "open").map((c) => c.title);
      return open.length
        ? `I couldn't find a chore called ${r}. The open chores are ${joinSpoken(open)}.`
        : `I couldn't find a chore called ${r}; there are no open chores.`;
    },
  });
}

export interface NewChore {
  title: string;
  assigned_member_id?: string | null;
  cadence: ChoreCadence;
  due_date?: string | null;
}

export async function insertChore(tx: Queryable, householdId: string, input: NewChore): Promise<Chore> {
  const res = await tx.query<{ id: string }>(
    `INSERT INTO chores (household_id, title, assigned_member_id, cadence, due_date)
     VALUES ($1::uuid, $2, $3::uuid, $4, $5::date) RETURNING id`,
    [householdId, input.title, input.assigned_member_id ?? null, input.cadence, input.due_date ?? null],
  );
  const chore = await getChoreById(tx, householdId, res.rows[0].id);
  if (!chore) throw new HousewardenError("INTERNAL", "Chore vanished after insert");
  return chore;
}

function nextChoreDate(cadence: ChoreCadence, from: string): string | null {
  switch (cadence) {
    case "daily":
      return addDays(from, 1);
    case "weekly":
      return addDays(from, 7);
    case "monthly":
      return addMonths(from, 1);
    case "once":
      return null;
  }
}

function assigneeName(m: MemberRef | null): string {
  return m ? m.name : "unassigned";
}

// ---------------------------------------------------------------------------
// add_chore
// ---------------------------------------------------------------------------

export const AddChoreInputSchema = MutatingInputBaseSchema.extend({
  title: z.string().trim().min(1).max(200).describe("What needs doing, e.g. Take out the bins."),
  assign_to: EntityRefSchema.optional().describe("Member name or id to assign it to."),
  cadence: ChoreCadenceSchema.default("once").describe("once, daily, weekly or monthly."),
  due_date: IsoDateSchema.optional().describe("YYYY-MM-DD in the household timezone."),
});
export type AddChoreInput = z.output<typeof AddChoreInputSchema>;
export const AddChoreResultSchema = z.object({ chore: ChoreSchema });
export type AddChoreResult = z.output<typeof AddChoreResultSchema>;

export async function planAddChore(input: AddChoreInput, ctx: ToolContext): Promise<MutationPlan<AddChoreResult>> {
  const today = todayInZone(ctx.now, ctx.household.timezone);
  const member: Member | null = input.assign_to ? await findMember(ctx.db, ctx.household.id, input.assign_to) : null;
  const dueSpoken = input.due_date ? `, due ${spokenDate(input.due_date, today)}` : "";
  const forSpoken = member ? `, for ${member.name}` : "";
  return {
    preview: {
      summary: `Add chore '${input.title}'${member ? ` for ${member.name}` : ""}${input.due_date ? ` due ${input.due_date}` : ""}${input.cadence === "once" ? "" : ` (${input.cadence})`}`,
      changes: [
        {
          entity: "chore",
          id: null,
          op: "create",
          label: input.title,
          before: null,
          after: { title: input.title, assigned_member: member ? member.name : null, cadence: input.cadence, due_date: input.due_date ?? null, status: "open" },
          line: `chore '${input.title}' (${input.cadence}${input.due_date ? `, due ${input.due_date}` : ""}): new, ${member ? member.name : "unassigned"}`,
        },
      ],
      warnings: [],
    },
    spoken: `add the chore ${lowerFirst(input.title)}${forSpoken}${dueSpoken}`,
    policyScope: "",
    async execute(tx) {
      const chore = await insertChore(tx, ctx.household.id, {
        title: input.title,
        assigned_member_id: member?.id ?? null,
        cadence: input.cadence,
        due_date: input.due_date ?? null,
      });
      return { output: { chore }, spoken: `Added: ${lowerFirst(chore.title)}${forSpoken}${dueSpoken}.` };
    },
  };
}

// ---------------------------------------------------------------------------
// assign_chore
// ---------------------------------------------------------------------------

export const AssignChoreInputSchema = MutatingInputBaseSchema.extend({
  chore: EntityRefSchema.describe("The chore's title or id."),
  assign_to: EntityRefSchema.nullable().describe("Member name or id, or null to unassign."),
});
export type AssignChoreInput = z.output<typeof AssignChoreInputSchema>;
export const AssignChoreResultSchema = z.object({ chore: ChoreSchema });
export type AssignChoreResult = z.output<typeof AssignChoreResultSchema>;

export async function planAssignChore(input: AssignChoreInput, ctx: ToolContext): Promise<MutationPlan<AssignChoreResult>> {
  const chore = await findChore(ctx.db, ctx.household.id, input.chore);
  const member: Member | null = input.assign_to ? await findMember(ctx.db, ctx.household.id, input.assign_to) : null;
  if ((member?.id ?? null) === (chore.assigned_member?.id ?? null)) {
    throw new HousewardenError(
      "ALREADY_DONE",
      member ? `${chore.title} is already ${member.name}'s.` : `${chore.title} is already unassigned.`,
      { entity: "chore", id: chore.id },
    );
  }
  const from = assigneeName(chore.assigned_member);
  const to = member ? member.name : "unassigned";
  return {
    preview: {
      summary: member ? `Assign chore '${chore.title}' to ${member.name}` : `Unassign chore '${chore.title}'`,
      changes: [
        {
          entity: "chore",
          id: chore.id,
          op: "update",
          label: chore.title,
          before: { assigned_member: chore.assigned_member ? chore.assigned_member.name : null },
          after: { assigned_member: member ? member.name : null },
          line: `chore '${chore.title}': ${from} → ${to}`,
        },
      ],
      warnings: [],
    },
    spoken: member ? `give ${lowerFirst(chore.title)} to ${member.name}` : `unassign ${lowerFirst(chore.title)}`,
    policyScope: "",
    async execute(tx) {
      await tx.query(`UPDATE chores SET assigned_member_id = $2::uuid WHERE id = $1::uuid`, [chore.id, member?.id ?? null]);
      const updated = await getChoreById(tx, ctx.household.id, chore.id);
      if (!updated) throw new HousewardenError("INTERNAL", "Chore vanished during assignment");
      return { output: { chore: updated }, spoken: member ? `${chore.title} is now ${member.name}'s.` : `${chore.title} is now unassigned.` };
    },
  };
}

// ---------------------------------------------------------------------------
// complete_chore
// ---------------------------------------------------------------------------

export const CompleteChoreInputSchema = MutatingInputBaseSchema.extend({
  chore: EntityRefSchema.describe("The chore's title or id."),
});
export type CompleteChoreInput = z.output<typeof CompleteChoreInputSchema>;
export const CompleteChoreResultSchema = z.object({ chore: ChoreSchema, next_chore: ChoreSchema.nullable() });
export type CompleteChoreResult = z.output<typeof CompleteChoreResultSchema>;

export async function planCompleteChore(input: CompleteChoreInput, ctx: ToolContext): Promise<MutationPlan<CompleteChoreResult>> {
  const today = todayInZone(ctx.now, ctx.household.timezone);
  const chore = await findChore(ctx.db, ctx.household.id, input.chore);
  if (chore.status === "done") {
    throw new HousewardenError("ALREADY_DONE", `${chore.title} is already done.`, { entity: "chore", id: chore.id });
  }
  const nextDate = nextChoreDate(chore.cadence, chore.due_date ?? today);
  const changes: Change[] = [
    {
      entity: "chore",
      id: chore.id,
      op: "update",
      label: chore.title,
      before: { status: "open" },
      after: { status: "done" },
      line: `chore '${chore.title}': status open → done`,
    },
  ];
  const warnings: string[] = [];
  if (nextDate) {
    changes.push({
      entity: "chore",
      id: null,
      op: "create",
      label: chore.title,
      before: null,
      after: { title: chore.title, assigned_member: chore.assigned_member?.name ?? null, cadence: chore.cadence, due_date: nextDate, status: "open" },
      line: `chore '${chore.title}' (${chore.cadence}, due ${nextDate}): new, ${assigneeName(chore.assigned_member)}`,
    });
    warnings.push(`This chore repeats ${chore.cadence}; the next one will be scheduled for ${nextDate}.`);
  }
  return {
    preview: { summary: `Mark chore '${chore.title}' as done`, changes, warnings },
    spoken: `mark ${lowerFirst(chore.title)} as done${nextDate ? ` and schedule the next one, due ${spokenDate(nextDate, today)}` : ""}`,
    policyScope: "",
    async execute(tx, execCtx) {
      await tx.query(`UPDATE chores SET status = 'done', completed_at = $2::timestamptz WHERE id = $1::uuid`, [chore.id, execCtx.now]);
      const done = await getChoreById(tx, ctx.household.id, chore.id);
      if (!done) throw new HousewardenError("INTERNAL", "Chore vanished during completion");
      let nextChore: Chore | null = null;
      if (nextDate) {
        nextChore = await insertChore(tx, ctx.household.id, {
          title: chore.title,
          assigned_member_id: chore.assigned_member?.id ?? null,
          cadence: chore.cadence,
          due_date: nextDate,
        });
      }
      return {
        output: { chore: done, next_chore: nextChore },
        spoken: `${chore.title} done.${nextChore?.due_date ? ` Next time is ${spokenDate(nextChore.due_date, today)}.` : ""}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// rotate_chores
// ---------------------------------------------------------------------------

export const RotateChoresInputSchema = MutatingInputBaseSchema.extend({});
export type RotateChoresInput = z.output<typeof RotateChoresInputSchema>;
export const RotateChoresResultSchema = z.object({
  rotated: z.array(z.object({ chore: ChoreSchema, from: MemberRefSchema, to: MemberRefSchema })),
});
export type RotateChoresResult = z.output<typeof RotateChoresResultSchema>;

export async function planRotateChores(_input: RotateChoresInput, ctx: ToolContext): Promise<MutationPlan<RotateChoresResult>> {
  const members = await listMembers(ctx.db, ctx.household.id);
  const open = await listChores(ctx.db, ctx.household.id, { status: "open" });
  const assigned = open.filter((c) => c.assigned_member !== null);
  if (members.length < 2 || assigned.length === 0) {
    throw new HousewardenError(
      "ALREADY_DONE",
      members.length < 2 ? "Rotation needs at least two members." : "No open chores are assigned, so there is nothing to rotate.",
    );
  }
  const moves = assigned.flatMap((chore) => {
    const idx = members.findIndex((m) => m.id === chore.assigned_member?.id);
    if (idx < 0) return [];
    const to = members[(idx + 1) % members.length];
    const from = members[idx];
    return [{ chore, from: { id: from.id, name: from.name }, to: { id: to.id, name: to.name } }];
  });
  if (moves.length === 0) throw new HousewardenError("ALREADY_DONE", "No open chores are assigned to a current member.");
  const spokenMoves = moves.map((m) => `${lowerFirst(m.chore.title)} to ${m.to.name}`);
  return {
    preview: {
      summary: `Rotate ${moves.length} ${plural(moves.length, "chore")} to the next member`,
      changes: moves.map((m) => ({
        entity: "chore",
        id: m.chore.id,
        op: "update",
        label: m.chore.title,
        before: { assigned_member: m.from.name },
        after: { assigned_member: m.to.name },
        line: `chore '${m.chore.title}': ${m.from.name} → ${m.to.name}`,
      })),
      warnings: [],
    },
    spoken: `move ${moves.length} ${plural(moves.length, "chore")} along: ${joinSpoken(spokenMoves)}`,
    policyScope: "",
    async execute(tx) {
      const rotated: RotateChoresResult["rotated"] = [];
      for (const m of moves) {
        await tx.query(`UPDATE chores SET assigned_member_id = $2::uuid WHERE id = $1::uuid`, [m.chore.id, m.to.id]);
        const chore = await getChoreById(tx, ctx.household.id, m.chore.id);
        if (!chore) throw new HousewardenError("INTERNAL", "Chore vanished during rotation");
        rotated.push({ chore, from: m.from, to: m.to });
      }
      return { output: { rotated }, spoken: `Rotated ${rotated.length} ${plural(rotated.length, "chore")}: ${joinSpoken(spokenMoves)}.` };
    },
  };
}
