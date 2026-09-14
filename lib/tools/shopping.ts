/**
 * list_shopping, add_shopping_item, check_off_shopping_item, clear_shopping_list.
 */
import { z } from "zod";
import { ShoppingItemSchema, defineMutatingTool, defineReadTool, type ShoppingItem } from "@/lib/contracts";
import {
  AddShoppingItemInputSchema,
  AddShoppingItemResultSchema,
  CheckOffShoppingItemInputSchema,
  CheckOffShoppingItemResultSchema,
  ClearShoppingListInputSchema,
  ClearShoppingListResultSchema,
  joinSpoken,
  listShopping,
  planAddShoppingItem,
  planCheckOffShoppingItem,
  planClearShoppingList,
} from "@/lib/domain";
import { READ_ANNOTATIONS, catalogueTitle, defaultRiskOf, mutatingAnnotations } from "./context";
import { countOf, sentence, truncateList } from "./spoken";

export function spokenShopping(items: readonly ShoppingItem[], includeChecked: boolean): string {
  const toBuy = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);
  const head =
    toBuy.length === 0
      ? "Nothing to buy; the list is clear."
      : sentence(`${countOf(toBuy.length, "thing")} to buy: ${joinSpoken(truncateList(toBuy.map((i) => i.name.toLowerCase()), 6))}`);
  if (!includeChecked || checked.length === 0) return head;
  return `${head} ${sentence(`${countOf(checked.length, "item")} already checked off`)}`;
}

export const listShoppingTool = defineReadTool({
  kind: "read",
  name: "list_shopping",
  title: catalogueTitle("list_shopping"),
  description: "Lists what is still to buy, grouped by category. Optionally includes checked-off items.",
  inputSchema: z.object({
    include_checked: z.boolean().default(false).describe("Also list items already checked off."),
  }),
  outputSchema: z.object({ items: z.array(ShoppingItemSchema), to_buy: z.number().int() }),
  annotations: READ_ANNOTATIONS,
  async run(input, ctx) {
    const items = await listShopping(ctx.db, ctx.household.id, input.include_checked);
    const to_buy = items.filter((i) => !i.checked).length;
    return { output: { items, to_buy }, spoken: spokenShopping(items, input.include_checked) };
  },
});

export const addShoppingItemTool = defineMutatingTool({
  kind: "mutating",
  name: "add_shopping_item",
  title: catalogueTitle("add_shopping_item"),
  description: "Adds an item to the shopping list with a quantity and category. Needs the item name.",
  inputSchema: AddShoppingItemInputSchema,
  resultSchema: AddShoppingItemResultSchema,
  defaultRisk: defaultRiskOf("add_shopping_item"),
  annotations: mutatingAnnotations({ destructive: false }),
  plan: planAddShoppingItem,
});

export const checkOffShoppingItemTool = defineMutatingTool({
  kind: "mutating",
  name: "check_off_shopping_item",
  title: catalogueTitle("check_off_shopping_item"),
  description: "Checks an item off the shopping list. Needs the item name or id.",
  inputSchema: CheckOffShoppingItemInputSchema,
  resultSchema: CheckOffShoppingItemResultSchema,
  defaultRisk: defaultRiskOf("check_off_shopping_item"),
  annotations: mutatingAnnotations({ idempotent: true }),
  plan: planCheckOffShoppingItem,
});

export const clearShoppingListTool = defineMutatingTool({
  kind: "mutating",
  name: "clear_shopping_list",
  title: catalogueTitle("clear_shopping_list"),
  description: "Removes checked-off items from the shopping list, or everything if asked. Optionally needs include_unchecked.",
  inputSchema: ClearShoppingListInputSchema,
  resultSchema: ClearShoppingListResultSchema,
  defaultRisk: defaultRiskOf("clear_shopping_list"),
  annotations: mutatingAnnotations({ destructive: true }),
  plan: planClearShoppingList,
});
