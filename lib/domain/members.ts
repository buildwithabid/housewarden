import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  HousewardenError,
  MemberRoleSchema,
  MemberSchema,
  MutatingInputBaseSchema,
  type Member,
  type MemberRef,
  type MemberRole,
  type MutationPlan,
  type Queryable,
  type ToolContext,
} from "@/lib/contracts";
import { joinSpoken, matchRef } from "./shared";

interface MemberRow extends Record<string, unknown> {
  id: string;
  name: string;
  role: MemberRole;
  pin_hash: string | null;
  created_at: Date;
}

const MEMBER_COLUMNS = "id, name, role, pin_hash, created_at";

function rowToMember(row: MemberRow): Member {
  return { id: row.id, name: row.name, role: row.role, has_pin: row.pin_hash !== null, created_at: row.created_at.toISOString() };
}

export function memberRef(member: Member | null): MemberRef | null {
  return member ? { id: member.id, name: member.name } : null;
}

/** Members in household order (created_at), the order rotate_chores follows. */
export async function listMembers(db: Queryable, householdId: string): Promise<Member[]> {
  const res = await db.query<MemberRow>(
    `SELECT ${MEMBER_COLUMNS} FROM members WHERE household_id = $1 ORDER BY created_at, name`,
    [householdId],
  );
  return res.rows.map(rowToMember);
}

/** Resolves a member by id or name. NOT_FOUND lists the household's members. */
export async function findMember(db: Queryable, householdId: string, ref: string): Promise<Member> {
  const members = await listMembers(db, householdId);
  return matchRef(members, ref, {
    entity: "member",
    label: (m) => m.name,
    notFound: (r) =>
      members.length
        ? `I couldn't find a member called ${r}. The members are ${joinSpoken(members.map((m) => m.name))}.`
        : `I couldn't find a member called ${r}; the household has no members yet.`,
  });
}

/** sha256(hex) of "<member id>:<pin>" — the PIN itself is never stored. */
export function hashPin(memberId: string, pin: string): string {
  return createHash("sha256").update(`${memberId}:${pin}`, "utf8").digest("hex");
}

export interface NewMember {
  name: string;
  role: MemberRole;
  pin?: string | null;
  /** Explicit creation instant (the seed inserts several members in one transaction, where now() is constant). */
  created_at?: Date;
}

export async function insertMember(tx: Queryable, householdId: string, input: NewMember): Promise<Member> {
  const id = randomUUID();
  const pinHash = input.pin ? hashPin(id, input.pin) : null;
  const res = await tx.query<MemberRow>(
    `INSERT INTO members (id, household_id, name, role, pin_hash, created_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, coalesce($6::timestamptz, now()))
     RETURNING ${MEMBER_COLUMNS}`,
    [id, householdId, input.name, input.role, pinHash, input.created_at ?? null],
  );
  return rowToMember(res.rows[0]);
}

// ---------------------------------------------------------------------------
// add_member
// ---------------------------------------------------------------------------

export const AddMemberInputSchema = MutatingInputBaseSchema.extend({
  name: z.string().trim().min(1).max(100).describe("The person's name, unique in the household."),
  role: MemberRoleSchema.describe("adult or child."),
  pin: z
    .string()
    .regex(/^\d{4,8}$/, "4 to 8 digits")
    .optional()
    .describe("Optional 4–8 digit PIN, stored hashed."),
});
export type AddMemberInput = z.output<typeof AddMemberInputSchema>;
export const AddMemberResultSchema = z.object({ member: MemberSchema });
export type AddMemberResult = z.output<typeof AddMemberResultSchema>;

export async function planAddMember(input: AddMemberInput, ctx: ToolContext): Promise<MutationPlan<AddMemberResult>> {
  const existing = await listMembers(ctx.db, ctx.household.id);
  const clash = existing.find((m) => m.name.toLowerCase() === input.name.toLowerCase());
  if (clash) {
    throw new HousewardenError("ALREADY_DONE", `${clash.name} is already a member of the household.`, {
      entity: "member",
      id: clash.id,
    });
  }
  const article = input.role === "adult" ? "an adult" : "a child";
  return {
    preview: {
      summary: `Add member '${input.name}' (${input.role})`,
      changes: [
        {
          entity: "member",
          id: null,
          op: "create",
          label: input.name,
          before: null,
          after: { name: input.name, role: input.role, has_pin: Boolean(input.pin) },
          line: `member '${input.name}' (${input.role}): new${input.pin ? " (with PIN)" : ""}`,
        },
      ],
      warnings: [],
    },
    spoken: `add ${input.name} as ${article}`,
    policyScope: "",
    async execute(tx) {
      const member = await insertMember(tx, ctx.household.id, { name: input.name, role: input.role, pin: input.pin ?? null });
      return { output: { member }, spoken: `Added ${member.name} as ${article}.` };
    },
  };
}
