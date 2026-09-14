"use client";

import Link from "next/link";
import { Button, buttonClass } from "@/components/Button";

/** The route error boundary: one sentence that says what to do (docs/DESIGN.md §5). */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10 text-center">
      <h1 className="text-xl">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-2">
        Couldn’t load this page. If it keeps happening, the database is the usual cause: check DATABASE_URL or the .data directory and reload.
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-ink-3">ref {error.digest}</p>}
      <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
        <Button variant="primary" onClick={() => reset()}>
          Try again
        </Button>
        <Link href="/" className={buttonClass("secondary")}>
          Go to the dashboard
        </Link>
      </div>
    </main>
  );
}
