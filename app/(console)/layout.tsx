import Link from "next/link";
import type { ReactNode } from "react";
import { verifyAuditChain } from "@/lib/audit";
import { loadConsole } from "@/lib/console/data";
import { countPendingActions } from "@/lib/domain";
import { buttonClass } from "@/components/Button";
import { Nav, PendingBadge } from "@/components/Nav";

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-md font-semibold text-ink">
      <svg aria-hidden="true" viewBox="0 0 32 32" width="24" height="24" className="shrink-0">
        <rect width="32" height="32" rx="7" fill="var(--accent)" />
        <path d="M8 24V8h3.4v6.3h9.2V8H24v16h-3.4v-6.7h-9.2V24z" fill="var(--accent-ink)" />
      </svg>
      Housewarden
    </Link>
  );
}

/**
 * Every console route: the session check, the sidebar (phone: top bar and a
 * plain <details> sheet), the pending badge and the chain status pill.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const ctx = await loadConsole();
  const [pendingCount, chain] = await Promise.all([
    ctx.household ? countPendingActions(ctx.db, ctx.household.id, ctx.now) : Promise.resolve(0),
    verifyAuditChain(ctx.db, { now: ctx.now }),
  ]);
  const nav = <Nav pendingCount={pendingCount} chain={chain} householdName={ctx.household?.name ?? null} />;

  return (
    <div className="lg:flex lg:min-h-screen">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-bg px-4 lg:hidden">
        <Brand />
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <Link href="/pending" className="flex items-center gap-1 rounded-md text-sm text-ink-2">
              Pending <PendingBadge count={pendingCount} />
            </Link>
          )}
          <details className="nav-menu">
            <summary className={buttonClass("secondary", "sm")} aria-label="Menu">
              <span className="when-closed">Menu</span>
              <span className="when-open">Close</span>
            </summary>
            <div className="fixed inset-x-0 top-14 bottom-0 z-40 overflow-y-auto bg-bg px-4 py-4">{nav}</div>
          </details>
        </div>
      </header>

      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:gap-6 lg:border-r lg:border-border lg:bg-surface-2 lg:px-4 lg:py-6">
        <Brand />
        <div className="flex min-h-0 flex-1 flex-col">{nav}</div>
      </aside>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
    </div>
  );
}
