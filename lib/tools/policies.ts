/**
 * set_policy — the only tool that changes how much the guard asks; high risk by default.
 */
import { defineMutatingTool } from "@/lib/contracts";
import { SetPolicyInputSchema, SetPolicyResultSchema, planSetPolicy } from "@/lib/domain";
import { catalogueTitle, defaultRiskOf, mutatingAnnotations } from "./context";

export const setPolicyTool = defineMutatingTool({
  kind: "mutating",
  name: "set_policy",
  title: catalogueTitle("set_policy"),
  description: "Changes how much confirmation a tool needs, for everyone or for one member. Needs the tool name and the new risk level.",
  inputSchema: SetPolicyInputSchema,
  resultSchema: SetPolicyResultSchema,
  defaultRisk: defaultRiskOf("set_policy"),
  annotations: mutatingAnnotations(),
  plan: planSetPolicy,
});
