/**
 * list_members, add_member.
 */
import { z } from "zod";
import { MemberSchema, defineMutatingTool, defineReadTool, type Member } from "@/lib/contracts";
import { AddMemberInputSchema, AddMemberResultSchema, joinSpoken, listMembers, planAddMember, plural, upperFirst } from "@/lib/domain";
import { numberWord } from "@/lib/time";
import { READ_ANNOTATIONS, catalogueTitle, defaultRiskOf, mutatingAnnotations } from "./context";

export function spokenMembers(members: readonly Member[]): string {
  if (members.length === 0) return "No one is in the household yet.";
  const adults = members.filter((m) => m.role === "adult").map((m) => m.name);
  const children = members.filter((m) => m.role === "child").map((m) => m.name);
  const head = `${upperFirst(numberWord(members.length))} ${plural(members.length, "person", "people")}: `;
  const kids = `the ${plural(children.length, "child", "children")} ${joinSpoken(children)}`;
  if (children.length === 0) return `${head}${joinSpoken(adults)}.`;
  if (adults.length === 0) return `${head}${kids}.`;
  return `${head}${joinSpoken(adults)}, and ${kids}.`;
}

export const listMembersTool = defineReadTool({
  kind: "read",
  name: "list_members",
  title: catalogueTitle("list_members"),
  description: "Lists the people in the household with their roles. Needs nothing.",
  inputSchema: z.object({}),
  outputSchema: z.object({ members: z.array(MemberSchema) }),
  annotations: READ_ANNOTATIONS,
  async run(_input, ctx) {
    const members = await listMembers(ctx.db, ctx.household.id);
    return { output: { members }, spoken: spokenMembers(members) };
  },
});

export const addMemberTool = defineMutatingTool({
  kind: "mutating",
  name: "add_member",
  title: catalogueTitle("add_member"),
  description: "Adds a person to the household as an adult or a child. Needs a name and a role; a 4–8 digit PIN is optional.",
  inputSchema: AddMemberInputSchema,
  resultSchema: AddMemberResultSchema,
  defaultRisk: defaultRiskOf("add_member"),
  annotations: mutatingAnnotations({ destructive: false }),
  plan: planAddMember,
});
