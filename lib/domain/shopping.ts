import { z } from "zod";
import {
  EntityRefSchema,
  HousewardenError,
  MutatingInputBaseSchema,
  ShoppingItemSchema,
  type MutationPlan,
  type Queryable,
  type ShoppingItem,
  type ToolContext,
} from "@/lib/contracts";
import { numberWord } from "@/lib/time";
import { iso, joinSpoken, matchRef, plural } from "./shared";

interface ShoppingRow extends Record<string, unknown> {
  id: string;
  name: string;
  qty: string;
  category: string | null;
  checked: boolean;
  checked_at: Date | null;
}

const ITEM_COLUMNS = "id, name, qty, category, checked, checked_at";

function rowToItem(row: ShoppingRow): ShoppingItem {
  return { id: row.id, name: row.name, qty: row.qty, category: row.category, checked: row.checked, checked_at: iso(row.checked_at) };
}

/** Items by category then name; unchecked only unless includeChecked. */
export async function listShopping(db: Queryable, householdId: string, includeChecked = false): Promise<ShoppingItem[]> {
  const res = await db.query<ShoppingRow>(
    `SELECT ${ITEM_COLUMNS} FROM shopping_items WHERE household_id = $1 ${includeChecked ? "" : "AND checked = false"}
     ORDER BY checked, category NULLS LAST, name`,
    [householdId],
  );
  return res.rows.map(rowToItem);
}

export async function countToBuy(db: Queryable, householdId: string): Promise<number> {
  const res = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM shopping_items WHERE household_id = $1 AND checked = false", [
    householdId,
  ]);
  return res.rows[0]?.n ?? 0;
}

export async function getShoppingItemById(db: Queryable, householdId: string, id: string): Promise<ShoppingItem | null> {
  const res = await db.query<ShoppingRow>(`SELECT ${ITEM_COLUMNS} FROM shopping_items WHERE household_id = $1 AND id = $2::uuid`, [
    householdId,
    id,
  ]);
  return res.rows[0] ? rowToItem(res.rows[0]) : null;
}

/** Resolves an item by id or name; when a name matches several, the unchecked one wins. */
export async function findShoppingItem(db: Queryable, householdId: string, ref: string): Promise<ShoppingItem> {
  const items = await listShopping(db, householdId, true);
  return matchRef(items, ref, {
    entity: "shopping_item",
    label: (i) => i.name,
    prefer: (i) => !i.checked,
    notFound: (r) => {
      const toBuy = items.filter((i) => !i.checked).map((i) => i.name);
      return toBuy.length
        ? `I couldn't find ${r} on the shopping list. Still to buy: ${joinSpoken(toBuy)}.`
        : `I couldn't find ${r} on the shopping list; the list is empty.`;
    },
  });
}

export interface NewShoppingItem {
  name: string;
  qty?: string;
  category?: string | null;
  checked?: boolean;
  checked_at?: Date | null;
}

export async function insertShoppingItem(tx: Queryable, householdId: string, input: NewShoppingItem): Promise<ShoppingItem> {
  const checkedAt = input.checked ? (input.checked_at ?? new Date()) : null;
  const res = await tx.query<ShoppingRow>(
    `INSERT INTO shopping_items (household_id, name, qty, category, checked, checked_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6::timestamptz) RETURNING ${ITEM_COLUMNS}`,
    [householdId, input.name, input.qty ?? "1", input.category ?? null, Boolean(input.checked), checkedAt],
  );
  return rowToItem(res.rows[0]);
}

function spokenItem(item: { name: string; qty: string }): string {
  return item.qty === "1" ? item.name.toLowerCase() : `${item.name.toLowerCase()}, ${item.qty}`;
}

// ---------------------------------------------------------------------------
// add_shopping_item
// ---------------------------------------------------------------------------

export const AddShoppingItemInputSchema = MutatingInputBaseSchema.extend({
  name: z.string().trim().min(1).max(100).describe("The item, e.g. Milk."),
  qty: z.string().trim().min(1).max(40).default("1").describe('Quantity as spoken: "1", "2 kg", "3 packs".'),
  category: z.string().trim().min(1).max(60).optional().describe("Aisle or group, e.g. Dairy."),
});
export type AddShoppingItemInput = z.output<typeof AddShoppingItemInputSchema>;
export const AddShoppingItemResultSchema = z.object({ item: ShoppingItemSchema });
export type AddShoppingItemResult = z.output<typeof AddShoppingItemResultSchema>;

export async function planAddShoppingItem(input: AddShoppingItemInput, ctx: ToolContext): Promise<MutationPlan<AddShoppingItemResult>> {
  const items = await listShopping(ctx.db, ctx.household.id, false);
  const clash = items.find((i) => i.name.toLowerCase() === input.name.toLowerCase());
  if (clash) {
    throw new HousewardenError("ALREADY_DONE", `${clash.name} is already on the list (${clash.qty}).`, {
      entity: "shopping_item",
      id: clash.id,
      qty: clash.qty,
    });
  }
  const category = input.category ?? null;
  return {
    preview: {
      summary: `Add '${input.name}' (${input.qty}) to the shopping list${category ? ` under ${category}` : ""}`,
      changes: [
        {
          entity: "shopping_item",
          id: null,
          op: "create",
          label: input.name,
          before: null,
          after: { name: input.name, qty: input.qty, category, checked: false },
          line: `shopping item '${input.name}' ${input.qty}${category ? ` (${category})` : ""}: new`,
        },
      ],
      warnings: [],
    },
    spoken: `add ${spokenItem(input)} to the shopping list`,
    policyScope: "",
    async execute(tx) {
      const item = await insertShoppingItem(tx, ctx.household.id, { name: input.name, qty: input.qty, category });
      return { output: { item }, spoken: `Added ${spokenItem(item)} to the shopping list.` };
    },
  };
}

// ---------------------------------------------------------------------------
// check_off_shopping_item
// ---------------------------------------------------------------------------

export const CheckOffShoppingItemInputSchema = MutatingInputBaseSchema.extend({
  item: EntityRefSchema.describe("The item's name or id."),
});
export type CheckOffShoppingItemInput = z.output<typeof CheckOffShoppingItemInputSchema>;
export const CheckOffShoppingItemResultSchema = z.object({ item: ShoppingItemSchema });
export type CheckOffShoppingItemResult = z.output<typeof CheckOffShoppingItemResultSchema>;

export async function planCheckOffShoppingItem(
  input: CheckOffShoppingItemInput,
  ctx: ToolContext,
): Promise<MutationPlan<CheckOffShoppingItemResult>> {
  const item = await findShoppingItem(ctx.db, ctx.household.id, input.item);
  if (item.checked) {
    throw new HousewardenError("ALREADY_DONE", `${item.name} is already checked off.`, { entity: "shopping_item", id: item.id });
  }
  return {
    preview: {
      summary: `Check off '${item.name}' (${item.qty})`,
      changes: [
        {
          entity: "shopping_item",
          id: item.id,
          op: "update",
          label: item.name,
          before: { checked: false },
          after: { checked: true },
          line: `shopping item '${item.name}' ${item.qty}: checked false → true`,
        },
      ],
      warnings: [],
    },
    spoken: `check ${item.name.toLowerCase()} off the shopping list`,
    policyScope: "",
    async execute(tx, execCtx) {
      const res = await tx.query<ShoppingRow>(
        `UPDATE shopping_items SET checked = true, checked_at = $2::timestamptz WHERE id = $1::uuid RETURNING ${ITEM_COLUMNS}`,
        [item.id, execCtx.now],
      );
      const left = await countToBuy(tx, ctx.household.id);
      return {
        output: { item: rowToItem(res.rows[0]) },
        spoken: `${item.name} checked off. ${left === 0 ? "Nothing left to buy." : `${numberWord(left)} ${plural(left, "thing")} left.`}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// clear_shopping_list
// ---------------------------------------------------------------------------

export const ClearShoppingListInputSchema = MutatingInputBaseSchema.extend({
  include_unchecked: z.boolean().default(false).describe("Also remove items not yet bought."),
});
export type ClearShoppingListInput = z.output<typeof ClearShoppingListInputSchema>;
export const ClearShoppingListResultSchema = z.object({ removed: z.number().int(), removed_items: z.array(ShoppingItemSchema) });
export type ClearShoppingListResult = z.output<typeof ClearShoppingListResultSchema>;

export async function planClearShoppingList(input: ClearShoppingListInput, ctx: ToolContext): Promise<MutationPlan<ClearShoppingListResult>> {
  const all = await listShopping(ctx.db, ctx.household.id, true);
  const targets = input.include_unchecked ? all : all.filter((i) => i.checked);
  if (targets.length === 0) {
    throw new HousewardenError(
      "ALREADY_DONE",
      input.include_unchecked ? "The shopping list is already empty." : "There are no checked-off items to clear.",
    );
  }
  const unchecked = targets.filter((i) => !i.checked).length;
  const n = targets.length;
  const summary = input.include_unchecked
    ? `Remove all ${n} ${plural(n, "item")} from the shopping list${unchecked ? ` (${unchecked} not yet bought)` : ""}`
    : `Remove ${n} checked ${plural(n, "item")} from the shopping list`;
  const clause = input.include_unchecked
    ? `clear all ${numberWord(n)} ${plural(n, "item")} from the shopping list${unchecked ? `, including ${numberWord(unchecked)} you haven't bought` : ""}`
    : `remove ${numberWord(n)} checked ${plural(n, "item")} from the shopping list`;
  return {
    preview: {
      summary,
      changes: targets.map((i) => ({
        entity: "shopping_item",
        id: i.id,
        op: "delete",
        label: i.name,
        before: { name: i.name, qty: i.qty, category: i.category, checked: i.checked },
        after: null,
        line: `shopping item '${i.name}' ${i.qty}${i.category ? ` (${i.category})` : ""}: removed${i.checked ? "" : " (not bought)"}`,
      })),
      warnings: unchecked ? [`${unchecked} of these ${plural(unchecked, "item has", "items have")} not been bought.`] : [],
    },
    spoken: clause,
    policyScope: "",
    async execute(tx) {
      const ids = targets.map((i) => i.id);
      const res = await tx.query<ShoppingRow>(
        `DELETE FROM shopping_items WHERE household_id = $1::uuid AND id = ANY($2::uuid[]) RETURNING ${ITEM_COLUMNS}`,
        [ctx.household.id, `{${ids.join(",")}}`],
      );
      const removed = res.rows.map(rowToItem);
      return { output: { removed: removed.length, removed_items: removed }, spoken: `Removed ${numberWord(removed.length)} ${plural(removed.length, "item")} from the shopping list.` };
    },
  };
}
