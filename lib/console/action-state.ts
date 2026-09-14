/**
 * The shape every console form action returns for useActionState. Pure: no
 * server imports, so client form components can import it.
 */
export interface ActionState {
  ok: boolean;
  status?: "executed" | "needs_confirmation" | "rejected" | "error";
  action_id?: string;
  message: string;
  /** The submitted string fields, so a form can keep what was typed after an error. */
  fields?: Record<string, string>;
  /** Changes on every failure so the form can re-key its fields. */
  nonce?: number;
}

export const IDLE_STATE: ActionState = { ok: true, message: "" };

export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;
