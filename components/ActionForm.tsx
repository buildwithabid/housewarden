"use client";

import { useActionState, type ReactNode } from "react";
import { IDLE_STATE, type ActionState, type FormAction } from "@/lib/console/action-state";

/**
 * A form bound to a console server action. Success redirects (the action
 * decides where); failure returns an ActionState whose message shows inline
 * and whose `fields` let the inputs keep what was typed.
 */
export function ActionForm({
  action,
  children,
  submit,
  className = "",
  ariaLabel,
}: {
  action: FormAction;
  children: (state: ActionState) => ReactNode;
  submit: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const [state, formAction] = useActionState(action, IDLE_STATE);
  return (
    <form action={formAction} key={state.nonce ?? 0} className={className} aria-label={ariaLabel}>
      {children(state)}
      {!state.ok && state.message && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {state.message}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">{submit}</div>
    </form>
  );
}
