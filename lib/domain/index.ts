/**
 * Domain layer: read functions shared by the console pages and the read
 * tools, plus the plan builders the guard runs for every mutating tool.
 * Nothing here writes outside a MutationPlan.execute or a seed/insert helper
 * called from inside the guard or the seed transaction.
 */
export * from "./household";
export * from "./members";
export * from "./bills";
export * from "./chores";
export * from "./shopping";
export * from "./reminders";
export * from "./budget";
export * from "./devices";
export * from "./policies";
export * from "./pending";
export * from "./summary";
export { isUuid, joinSpoken, lowerFirst, upperFirst, plural, matchRef, jsonEqual } from "./shared";
