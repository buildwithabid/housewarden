/**
 * list_chores, add_chore, assign_chore, complete_chore, rotate_chores.
 */
import { z } from "zod";
import { ChoreSchema, EntityRefSchema, defineMutatingTool, defineReadTool, type Chore } from "@/lib/contracts";
import {
  AddChoreInputSchema,
  AddChoreResultSchema,
  AssignChoreInputSchema,
  AssignChoreResultSchema,
  CompleteChoreInputSchema,
  CompleteChoreResultSchema,
  RotateChoresInputSchema,
  RotateChoresResultSchema,
  findMember,
  joinSpoken,
  listChores,
  lowerFirst,
  planAddChore,
  planAssignChore,
  planCompleteChore,
  planRotateChores,
  type ChoreFilter,
} from "@/lib/domain";
import { spokenDate, todayInZone } from "@/lib/time";
import { READ_ANNOTATIONS, catalogueTitle, defaultRiskOf, mutatingAnnotations } from "./context";
import { countOf, sentence, truncateList } from "./spoken";

const CHORE_FILTERS = ["open", "done", "all"] as const satisfies readonly ChoreFilter[];

function chorePhrase(chore: Chore, today: string, withAssignee: boolean): string {
  const due = chore.due_date && chore.status === "open" ? `, due ${spokenDate(chore.due_date, today)}` : "";
  const who = withAssignee && chore.assigned_member ? ` for ${chore.assigned_member.name}` : "";
  return `${lowerFirst(chore.title)}${who}${due}`;
}

export function spokenChores(chores: readonly Chore[], filter: ChoreFilter, memberName: string | null, today: string): string {
  const what = filter === "all" ? "chore" : `${filter} chore`;
  const owner = memberName ? `${memberName} has` : "There are";
  if (chores.length === 0) return `${owner} no ${what}s.`;
  const list = truncateList(
    chores.map((c) => chorePhrase(c, today, memberName === null)),
    4,
  );
  return sentence(`${owner} ${countOf(chores.length, what)}: ${joinSpoken(list)}`);
}

export const listChoresTool = defineReadTool({
  kind: "read",
  name: "list_chores",
  title: catalogueTitle("list_chores"),
  description: "Lists chores, open ones by default, with who they are assigned to. Optionally needs a status filter or a member.",
  inputSchema: z.object({
    status: z.enum(CHORE_FILTERS).default("open").describe("open, done or all."),
    member: EntityRefSchema.optional().describe("Only chores assigned to this member (name or id)."),
  }),
  outputSchema: z.object({ chores: z.array(ChoreSchema) }),
  annotations: READ_ANNOTATIONS,
  async run(input, ctx) {
    const today = todayInZone(ctx.now, ctx.household.timezone);
    const member = input.member ? await findMember(ctx.db, ctx.household.id, input.member) : null;
    const chores = await listChores(ctx.db, ctx.household.id, { status: input.status, memberId: member?.id });
    return { output: { chores }, spoken: spokenChores(chores, input.status, member?.name ?? null, today) };
  },
});

export const addChoreTool = defineMutatingTool({
  kind: "mutating",
  name: "add_chore",
  title: catalogueTitle("add_chore"),
  description: "Adds a chore, optionally assigned to someone and repeating. Needs a title.",
  inputSchema: AddChoreInputSchema,
  resultSchema: AddChoreResultSchema,
  defaultRisk: defaultRiskOf("add_chore"),
  annotations: mutatingAnnotations({ destructive: false }),
  plan: planAddChore,
});

export const assignChoreTool = defineMutatingTool({
  kind: "mutating",
  name: "assign_chore",
  title: catalogueTitle("assign_chore"),
  description: "Assigns a chore to a member, or unassigns it. Needs the chore and the member (or null).",
  inputSchema: AssignChoreInputSchema,
  resultSchema: AssignChoreResultSchema,
  defaultRisk: defaultRiskOf("assign_chore"),
  annotations: mutatingAnnotations(),
  plan: planAssignChore,
});

export const completeChoreTool = defineMutatingTool({
  kind: "mutating",
  name: "complete_chore",
  title: catalogueTitle("complete_chore"),
  description: "Marks a chore done and, if it repeats, schedules the next one. Needs the chore.",
  inputSchema: CompleteChoreInputSchema,
  resultSchema: CompleteChoreResultSchema,
  defaultRisk: defaultRiskOf("complete_chore"),
  annotations: mutatingAnnotations({ idempotent: true }),
  plan: planCompleteChore,
});

export const rotateChoresTool = defineMutatingTool({
  kind: "mutating",
  name: "rotate_chores",
  title: catalogueTitle("rotate_chores"),
  description: "Rotates every open, assigned chore to the next member in the household order. Needs nothing.",
  inputSchema: RotateChoresInputSchema,
  resultSchema: RotateChoresResultSchema,
  defaultRisk: defaultRiskOf("rotate_chores"),
  annotations: mutatingAnnotations(),
  plan: planRotateChores,
});
