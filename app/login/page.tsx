import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readQuery, type SearchParams } from "@/lib/console/page";
import { consoleConfigured, hasConsoleSession } from "@/lib/console/session";
import { safeNext } from "@/lib/console/url";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const q = await readQuery(searchParams);
  const next = safeNext(q.get("next"));
  if (await hasConsoleSession()) redirect(next);
  const configured = consoleConfigured();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <svg aria-hidden="true" viewBox="0 0 32 32" width="28" height="28">
          <rect width="32" height="32" rx="7" fill="var(--accent)" />
          <path d="M8 24V8h3.4v6.3h9.2V8H24v16h-3.4v-6.7h-9.2V24z" fill="var(--accent-ink)" />
        </svg>
        <span className="font-semibold text-ink">Housewarden</span>
      </div>
      <h1 className="text-xl">Sign in</h1>
      <p className="mt-1 mb-6 text-sm text-ink-2">The console is where a person approves what the assistant proposes. Enter the secret set on the server.</p>
      {!configured && (
        <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          The console isn’t configured yet. Set HOUSEWARDEN_ADMIN_SECRET (8 or more characters) in .env.local and restart the server.
        </p>
      )}
      <div className="rounded-lg border border-border bg-surface p-4 md:p-6">
        <LoginForm next={next} configured={configured} />
      </div>
    </main>
  );
}
