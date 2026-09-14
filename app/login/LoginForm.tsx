"use client";

import { login } from "@/app/actions/auth";
import { ActionForm } from "@/components/ActionForm";
import { Field } from "@/components/Field";
import { SubmitButton } from "@/components/SubmitButton";

export function LoginForm({ next, configured }: { next: string; configured: boolean }) {
  return (
    <ActionForm action={login} ariaLabel="Sign in" submit={<SubmitButton pendingLabel="Checking…" className="w-full">Sign in</SubmitButton>}>
      {() => (
        <>
          <input type="hidden" name="next" value={next} />
          <Field label="Console secret" htmlFor="secret" hint="HOUSEWARDEN_ADMIN_SECRET from the server’s .env.local.">
            <input id="secret" name="secret" type="password" className="input" autoComplete="current-password" autoFocus required disabled={!configured} />
          </Field>
        </>
      )}
    </ActionForm>
  );
}
