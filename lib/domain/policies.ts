import { z } from "zod";
import {
  BUILTIN_SCOPED_POLICIES,
  DEFAULT_RISK,
  EntityRefSchema,
  HousewardenError,
  MUTATING_TOOL_NAMES,
  MutatingInputBaseSchema,
  PolicySchema,
  RiskSchema,
  SET_POLICY_MINIMUM_RISK,
  TOOL_CATALOGUE,
  ToolNameSchema,
  compareRisk,
  type Member,
  type MemberRef,
  type MutationPlan,
  type Policy,
  type Queryable,
  type Risk,
  type ToolContext,
  type ToolName,
} from "@/lib/contracts";
import { findMember } from "./members";

interface PolicyRow extends Record<string, unknown> {
  id: string;
  tool_name: string;
  scope: string;
  member_id: string | null;
  member_name: string | null;
  risk: Risk;
}

const POLICY_SELECT = `
  SELECT p.id, p.tool_name, p.scope, p.member_id, m.name AS member_name, p.risk
  FROM policies p LEFT JOIN members m ON m.id = p.member_id
  WHERE p.household_id = $1`;

export interface ResolvedPolicy extends Policy {
  /** The policies row that matched, when source is "household". */
  row_id: string | null;
}

function builtinFor(tool: ToolName, scope: string): ResolvedPolicy {
  const scoped = BUILTIN_SCOPED_POLICIES.find((p) => p.tool_name === tool && p.scope === scope);
  return {
    tool_name: tool,
    scope: scoped ? scoped.scope : "",
    member: null,
    risk: scoped ? scoped.risk : DEFAULT_RISK[tool],
    source: "builtin",
    row_id: null,
  };
}

/**
 * First match wins (docs/SPEC.md §4):
 *   1. row (tool, scope, member)  2. row (tool, "", member)
 *   3. row (tool, scope, null)    4. row (tool, "", null)
 *   5. BUILTIN_SCOPED_POLICIES    6. DEFAULT_RISK[tool]
 */
export async function resolvePolicy(
  db: Queryable,
  householdId: string,
  tool: ToolName,
  scope: string,
  memberId: string | null,
): Promise<ResolvedPolicy> {
  const res = await db.query<PolicyRow>(
    `${POLICY_SELECT} AND p.tool_name = $2 AND p.scope IN ($3, '') AND (p.member_id IS NULL OR p.member_id = $4::uuid)`,
    [householdId, tool, scope, memberId],
  );
  const rows = res.rows;
  const pick = (s: string, m: string | null) => rows.find((r) => r.scope === s && r.member_id === m);
  const match =
    (memberId ? (pick(scope, memberId) ?? pick("", memberId)) : undefined) ?? pick(scope, null) ?? pick("", null);
  if (match) {
    return {
      tool_name: tool,
      scope: match.scope,
      member: match.member_id && match.member_name ? { id: match.member_id, name: match.member_name } : null,
      risk: match.risk,
      source: "household",
      row_id: match.id,
    };
  }
  return builtinFor(tool, scope);
}

/** The effective policy table: one builtin row per mutating tool (plus scoped builtins) and every household row. */
export async function listPolicies(db: Queryable, householdId: string): Promise<Policy[]> {
  const res = await db.query<PolicyRow>(`${POLICY_SELECT} ORDER BY p.tool_name, p.scope, m.name NULLS FIRST`, [householdId]);
  const household: Policy[] = res.rows.map((r) => ({
    tool_name: r.tool_name,
    scope: r.scope,
    member: r.member_id && r.member_name ? { id: r.member_id, name: r.member_name } : null,
    risk: r.risk,
    source: "household",
  }));
  const overridden = new Set(household.filter((p) => p.member === null).map((p) => `${p.tool_name}|${p.scope}`));
  const builtins: Policy[] = [];
  for (const entry of TOOL_CATALOGUE) {
    if (entry.kind !== "mutating") continue;
    if (!overridden.has(`${entry.name}|`)) {
      builtins.push({ tool_name: entry.name, scope: "", member: null, risk: entry.risk, source: "builtin" });
    }
    for (const scoped of BUILTIN_SCOPED_POLICIES) {
      if (scoped.tool_name === entry.name && !overridden.has(`${scoped.tool_name}|${scoped.scope}`)) {
        builtins.push({ tool_name: scoped.tool_name, scope: scoped.scope, member: null, risk: scoped.risk, source: "builtin" });
      }
    }
  }
  return [...builtins, ...household];
}

export interface PolicyUpsert {
  tool_name: ToolName;
  scope: string;
  member_id: string | null;
  risk: Risk;
}

export async function upsertPolicy(tx: Queryable, householdId: string, input: PolicyUpsert): Promise<string> {
  const existing = await tx.query<{ id: string }>(
    `SELECT id FROM policies WHERE household_id = $1 AND tool_name = $2 AND scope = $3
       AND COALESCE(member_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [householdId, input.tool_name, input.scope, input.member_id],
  );
  if (existing.rows[0]) {
    await tx.query(`UPDATE policies SET risk = $2 WHERE id = $1::uuid`, [existing.rows[0].id, input.risk]);
    return existing.rows[0].id;
  }
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO policies (household_id, tool_name, scope, member_id, risk) VALUES ($1::uuid, $2, $3, $4::uuid, $5) RETURNING id`,
    [householdId, input.tool_name, input.scope, input.member_id, input.risk],
  );
  return inserted.rows[0].id;
}

// ---------------------------------------------------------------------------
// set_policy
// ---------------------------------------------------------------------------

export const SetPolicyInputSchema = MutatingInputBaseSchema.extend({
  tool_name: ToolNameSchema.describe("The mutating tool the rule applies to."),
  scope: z.string().trim().max(60).default("").describe('Sub-scope, e.g. "lock" for set_device_state; "" for the whole tool.'),
  for_member: EntityRefSchema.nullable().default(null).describe("Member name or id, or null for everyone."),
  risk: RiskSchema.exclude(["read"]).describe("low (no approval), confirm (ask), or high (console only)."),
});
export type SetPolicyInput = z.output<typeof SetPolicyInputSchema>;
export const SetPolicyResultSchema = z.object({ policy: PolicySchema, previous: PolicySchema });
export type SetPolicyResult = z.output<typeof SetPolicyResultSchema>;

function toolTitle(tool: ToolName): string {
  return TOOL_CATALOGUE.find((t) => t.name === tool)?.title ?? tool;
}

function riskPhrase(risk: Risk): string {
  switch (risk) {
    case "low":
      return "no approval";
    case "confirm":
      return "your approval";
    case "high":
      return "approval in the console";
    case "read":
      return "nothing";
  }
}

export async function planSetPolicy(input: SetPolicyInput, ctx: ToolContext): Promise<MutationPlan<SetPolicyResult>> {
  if (!MUTATING_TOOL_NAMES.includes(input.tool_name)) {
    throw new HousewardenError("POLICY_INVARIANT", `${input.tool_name} never changes anything, so it has no approval rule.`, {
      tool_name: input.tool_name,
    });
  }
  if (input.tool_name === "set_policy" && compareRisk(input.risk, SET_POLICY_MINIMUM_RISK) < 0) {
    throw new HousewardenError("POLICY_INVARIANT", `set_policy can never go below ${SET_POLICY_MINIMUM_RISK}; that would switch the guard off.`, {
      tool_name: input.tool_name,
      minimum: SET_POLICY_MINIMUM_RISK,
    });
  }
  const member: Member | null = input.for_member ? await findMember(ctx.db, ctx.household.id, input.for_member) : null;
  const memberRef: MemberRef | null = member ? { id: member.id, name: member.name } : null;
  const previous = await resolvePolicy(ctx.db, ctx.household.id, input.tool_name, input.scope, member?.id ?? null);
  const exact =
    previous.source === "household" && previous.scope === input.scope && (previous.member?.id ?? null) === (member?.id ?? null);
  if (exact && previous.risk === input.risk) {
    throw new HousewardenError("ALREADY_DONE", `${toolTitle(input.tool_name)} already needs ${riskPhrase(input.risk)}${member ? ` for ${member.name}` : ""}.`);
  }
  const label = `${input.tool_name}${input.scope ? `/${input.scope}` : ""}${member ? ` for ${member.name}` : ""}`;
  const title = toolTitle(input.tool_name).toLowerCase();
  const previousPolicy: Policy = { tool_name: previous.tool_name, scope: previous.scope, member: previous.member, risk: previous.risk, source: previous.source };
  return {
    preview: {
      summary: `Set policy for ${label}: ${previous.risk} → ${input.risk}`,
      changes: [
        {
          entity: "policy",
          id: exact ? previous.row_id : null,
          op: "update",
          label,
          before: { risk: previous.risk, source: previous.source },
          after: { risk: input.risk, source: "household" },
          line: `policy '${label}': risk ${previous.risk} → ${input.risk}`,
        },
      ],
      warnings: input.risk === "low" ? [`${toolTitle(input.tool_name)} will run without asking${member ? ` when ${member.name} asks` : ""}.`] : [],
    },
    spoken: `change the rule for ${title} so it needs ${riskPhrase(input.risk)}${member ? ` for ${member.name}` : ""}`,
    policyScope: "",
    async execute(tx) {
      await upsertPolicy(tx, ctx.household.id, { tool_name: input.tool_name, scope: input.scope, member_id: member?.id ?? null, risk: input.risk });
      const policy: Policy = { tool_name: input.tool_name, scope: input.scope, member: memberRef, risk: input.risk, source: "household" };
      return {
        output: { policy, previous: previousPolicy },
        spoken: `${toolTitle(input.tool_name)} now needs ${riskPhrase(input.risk)}${member ? ` for ${member.name}` : ""}.`,
      };
    },
  };
}
