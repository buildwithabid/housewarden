"use client";

/**
 * The console's add forms. Client components only so useActionState can show
 * an error next to the form and keep what was typed; every submission goes to
 * a server action in app/actions/* that runs the tool through the guard.
 */
import { addBill } from "@/app/actions/bills";
import { recordExpense } from "@/app/actions/budget";
import { addChore } from "@/app/actions/chores";
import { addReminder } from "@/app/actions/reminders";
import { setPolicy } from "@/app/actions/settings";
import { addShoppingItem } from "@/app/actions/shopping";
import { ActionForm } from "./ActionForm";
import { Field } from "./Field";
import { SubmitButton } from "./SubmitButton";

export interface MemberOption {
  id: string;
  name: string;
}

function MemberSelect({
  id,
  name,
  members,
  defaultValue,
  anyLabel,
}: {
  id: string;
  name: string;
  members: MemberOption[];
  defaultValue?: string;
  anyLabel: string;
}) {
  return (
    <select id={id} name={name} className="input" defaultValue={defaultValue ?? ""}>
      <option value="">{anyLabel}</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
}

export function BillForm({ currency, today }: { currency: string; today: string }) {
  return (
    <ActionForm action={addBill} ariaLabel="Add bill" submit={<SubmitButton pendingLabel="Adding…">Add bill</SubmitButton>}>
      {(state) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="bill-name" className="sm:col-span-2">
            <input id="bill-name" name="name" className="input" required maxLength={100} placeholder="Water" defaultValue={state.fields?.name ?? ""} />
          </Field>
          <Field label={`Amount (${currency})`} htmlFor="bill-amount">
            <input id="bill-amount" name="amount" className="input tabular" type="number" inputMode="decimal" min="0" step="0.01" required placeholder="900" defaultValue={state.fields?.amount ?? ""} />
          </Field>
          <Field label="Due date" htmlFor="bill-due">
            <input id="bill-due" name="due_date" className="input" type="date" required defaultValue={state.fields?.due_date ?? today} />
          </Field>
          <Field label="Repeats" htmlFor="bill-recurrence">
            <select id="bill-recurrence" name="recurrence" className="input" defaultValue={state.fields?.recurrence ?? "monthly"}>
              <option value="none">Does not repeat</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </Field>
          <Field label="Currency" htmlFor="bill-currency" hint="Three-letter code.">
            <input id="bill-currency" name="currency" className="input font-mono uppercase" maxLength={3} minLength={3} defaultValue={state.fields?.currency ?? currency} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ChoreForm({ members }: { members: MemberOption[] }) {
  return (
    <ActionForm action={addChore} ariaLabel="Add chore" submit={<SubmitButton pendingLabel="Adding…">Add chore</SubmitButton>}>
      {(state) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="chore-title" className="sm:col-span-2">
            <input id="chore-title" name="title" className="input" required maxLength={200} placeholder="Clean the fridge" defaultValue={state.fields?.title ?? ""} />
          </Field>
          <Field label="Assign to" htmlFor="chore-member">
            <MemberSelect id="chore-member" name="assign_to" members={members} defaultValue={state.fields?.assign_to} anyLabel="Nobody yet" />
          </Field>
          <Field label="Repeats" htmlFor="chore-cadence">
            <select id="chore-cadence" name="cadence" className="input" defaultValue={state.fields?.cadence ?? "once"}>
              <option value="once">Once</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </Field>
          <Field label="Due date" htmlFor="chore-due" hint="Leave empty for no date.">
            <input id="chore-due" name="due_date" className="input" type="date" defaultValue={state.fields?.due_date ?? ""} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ShoppingForm({ categories }: { categories: string[] }) {
  return (
    <ActionForm action={addShoppingItem} ariaLabel="Add shopping item" submit={<SubmitButton pendingLabel="Adding…">Add item</SubmitButton>}>
      {(state) => (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Item" htmlFor="item-name">
            <input id="item-name" name="name" className="input" required maxLength={100} placeholder="Bread" defaultValue={state.fields?.name ?? ""} />
          </Field>
          <Field label="Quantity" htmlFor="item-qty">
            <input id="item-qty" name="qty" className="input" maxLength={40} placeholder="1" defaultValue={state.fields?.qty ?? ""} />
          </Field>
          <Field label="Category" htmlFor="item-category">
            <input id="item-category" name="category" className="input" maxLength={60} list="shopping-categories" placeholder="Bakery" defaultValue={state.fields?.category ?? ""} />
            <datalist id="shopping-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ReminderForm({ members, timeZone, defaultAt }: { members: MemberOption[]; timeZone: string; defaultAt: string }) {
  return (
    <ActionForm action={addReminder} ariaLabel="Add reminder" submit={<SubmitButton pendingLabel="Adding…">Add reminder</SubmitButton>}>
      {(state) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reminder" htmlFor="reminder-text" className="sm:col-span-2">
            <input id="reminder-text" name="text" className="input" required maxLength={300} placeholder="Call the plumber" defaultValue={state.fields?.text ?? ""} />
          </Field>
          <Field label="When" htmlFor="reminder-at" hint={`Times are in ${timeZone}.`}>
            <input id="reminder-at" name="at" className="input" type="datetime-local" required defaultValue={state.fields?.at ?? defaultAt} />
          </Field>
          <Field label="For" htmlFor="reminder-member">
            <MemberSelect id="reminder-member" name="for_member" members={members} defaultValue={state.fields?.for_member} anyLabel="Everyone" />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function ExpenseForm({
  members,
  categories,
  currency,
  timeZone,
  month,
}: {
  members: MemberOption[];
  categories: string[];
  currency: string;
  timeZone: string;
  month: string;
}) {
  return (
    <ActionForm action={recordExpense} ariaLabel="Record expense" submit={<SubmitButton pendingLabel="Recording…">Record expense</SubmitButton>}>
      {(state) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="month" value={month} />
          <Field label={`Amount (${currency})`} htmlFor="expense-amount">
            <input id="expense-amount" name="amount" className="input tabular" type="number" inputMode="decimal" min="0" step="0.01" required placeholder="1450" defaultValue={state.fields?.amount ?? ""} />
          </Field>
          <Field label="Category" htmlFor="expense-category">
            <input id="expense-category" name="category" className="input" required maxLength={60} list="expense-categories" placeholder="Groceries" defaultValue={state.fields?.category ?? ""} />
            <datalist id="expense-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Note" htmlFor="expense-note" className="sm:col-span-2">
            <input id="expense-note" name="note" className="input" maxLength={300} placeholder="Where or what" defaultValue={state.fields?.note ?? ""} />
          </Field>
          <Field label="Paid by" htmlFor="expense-member">
            <MemberSelect id="expense-member" name="paid_by" members={members} defaultValue={state.fields?.paid_by} anyLabel="Not recorded" />
          </Field>
          <Field label="When" htmlFor="expense-at" hint={`Leave empty for now. Times are in ${timeZone}.`}>
            <input id="expense-at" name="occurred_at" className="input" type="datetime-local" defaultValue={state.fields?.occurred_at ?? ""} />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}

export function PolicyForm({ tools, members }: { tools: { name: string; title: string }[]; members: MemberOption[] }) {
  return (
    <ActionForm action={setPolicy} ariaLabel="Add rule" submit={<SubmitButton pendingLabel="Proposing…">Propose rule</SubmitButton>}>
      {(state) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tool" htmlFor="policy-tool">
            <select id="policy-tool" name="tool_name" className="input" defaultValue={state.fields?.tool_name ?? tools[0]?.name ?? ""}>
              {tools.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.title} · {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Risk" htmlFor="policy-risk">
            <select id="policy-risk" name="risk" className="input" defaultValue={state.fields?.risk ?? "confirm"}>
              <option value="low">Low · runs without asking</option>
              <option value="confirm">Confirm · a person or a yes</option>
              <option value="high">High · console only</option>
            </select>
          </Field>
          <Field label="Scope" htmlFor="policy-scope" hint="Optional. For Set device state use the kind: lock, thermostat, light or plug. For Run routine, the routine name.">
            <input id="policy-scope" name="scope" className="input font-mono" maxLength={60} placeholder="lock" defaultValue={state.fields?.scope ?? ""} />
          </Field>
          <Field label="Applies to" htmlFor="policy-member">
            <MemberSelect id="policy-member" name="for_member" members={members} defaultValue={state.fields?.for_member} anyLabel="Everyone" />
          </Field>
        </div>
      )}
    </ActionForm>
  );
}
