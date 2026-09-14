import type { Metadata } from "next";
import { checkOffItem, clearList } from "@/app/actions/shopping";
import type { ShoppingItem } from "@/lib/contracts";
import { loadConsole, withHousehold } from "@/lib/console/data";
import { fmtInstant } from "@/lib/console/format";
import { readQuery, type SearchParams } from "@/lib/console/page";
import { listShopping } from "@/lib/domain";
import { ConfirmSlot } from "@/components/ConfirmSlot";
import { EmptyState } from "@/components/EmptyState";
import { Flash } from "@/components/Flash";
import { ShoppingForm } from "@/components/forms";
import { List, ListRow } from "@/components/ListRow";
import { NoHousehold } from "@/components/NoHousehold";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata: Metadata = { title: "Shopping list" };

export default async function ShoppingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [ctx, q] = await Promise.all([loadConsole("/shopping"), readQuery(searchParams)]);
  const h = withHousehold(ctx);
  if (!h) {
    return (
      <>
        <PageHeader title="Shopping list" />
        <NoHousehold />
      </>
    );
  }

  const items = await listShopping(h.db, h.household.id, true);
  const toBuy = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);
  const byCategory = new Map<string, ShoppingItem[]>();
  for (const item of toBuy) {
    const key = item.category ?? "Other";
    byCategory.set(key, [...(byCategory.get(key) ?? []), item]);
  }
  const categories = [...new Set(items.map((i) => i.category).filter((c): c is string => c !== null))].sort();

  return (
    <>
      <PageHeader
        title="Shopping list"
        description="Check items off as you buy them. Clearing the list asks for approval because it deletes."
        action={
          <>
            <form action={clearList}>
              <input type="hidden" name="include_unchecked" value="false" />
              <SubmitButton variant="secondary" pendingLabel="Proposing…" disabled={checked.length === 0}>
                Clear checked
              </SubmitButton>
            </form>
            <form action={clearList}>
              <input type="hidden" name="include_unchecked" value="true" />
              <SubmitButton variant="danger-secondary" pendingLabel="Proposing…" disabled={items.length === 0}>
                Clear all
              </SubmitButton>
            </form>
          </>
        }
      />
      <Flash message={q.flash} tone={q.tone} />
      <ConfirmSlot id={q.confirm} ctx={h} returnTo="/shopping" />

      {toBuy.length === 0 ? (
        <div className="mb-8">
          <EmptyState title="Nothing to buy" body="The list is clear. Add what you need below, or ask the assistant to add it for you." />
        </div>
      ) : (
        [...byCategory.entries()].map(([category, list]) => (
          <Section key={category} id={`cat-${category.toLowerCase().replace(/\s+/g, "-")}`} title={category} count={list.length}>
            <List>
              {list.map((item) => (
                <ListRow
                  key={item.id}
                  title={item.name}
                  meta={[item.qty]}
                  trailing={
                    <form action={checkOffItem}>
                      <input type="hidden" name="item" value={item.id} />
                      <SubmitButton size="sm" variant="secondary" pendingLabel="Checking…">
                        Check off
                      </SubmitButton>
                    </form>
                  }
                />
              ))}
            </List>
          </Section>
        ))
      )}

      <Section id="add-item" title="Add an item">
        <div className="rounded-lg border border-border bg-surface p-4 md:p-6">
          <ShoppingForm categories={categories} />
        </div>
      </Section>

      {checked.length > 0 && (
        <Section id="checked" title="Checked" count={checked.length}>
          <List>
            {checked.map((item) => (
              <ListRow key={item.id} muted title={item.name} meta={[item.qty, item.category ?? "Other", item.checked_at ? `checked ${fmtInstant(item.checked_at, h.household.timezone, h.today)}` : "checked"]} chip={{ label: "checked", tone: "accent" }} />
            ))}
          </List>
        </Section>
      )}
    </>
  );
}
