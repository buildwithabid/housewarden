import type { ChainVerification } from "@/lib/contracts";
import { logout } from "@/app/actions/auth";
import { ChainPill } from "./ChainPill";
import { Chip } from "./Chip";
import { NavLink } from "./NavLink";
import { SubmitButton } from "./SubmitButton";

const ITEMS: { href: string; label: string }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/pending", label: "Pending" },
  { href: "/audit", label: "Audit" },
  { href: "/bills", label: "Bills" },
  { href: "/chores", label: "Chores" },
  { href: "/shopping", label: "Shopping" },
  { href: "/reminders", label: "Reminders" },
  { href: "/budget", label: "Budget" },
  { href: "/devices", label: "Devices" },
  { href: "/settings", label: "Settings" },
];

export function PendingBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Chip tone="warn" className="tabular">
      {count}
    </Chip>
  );
}

/** The console navigation: used in the desktop sidebar and the phone sheet. */
export function Nav({ pendingCount, chain, householdName }: { pendingCount: number; chain: ChainVerification; householdName: string | null }) {
  return (
    <div className="flex h-full flex-col gap-6">
      <nav aria-label="Console">
        <ul className="flex flex-col gap-0.5">
          {ITEMS.map((item) => (
            <li key={item.href}>
              <NavLink href={item.href} badge={item.href === "/pending" ? <PendingBadge count={pendingCount} /> : undefined}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
        <p className="text-xs text-ink-3">{householdName ? `Household: ${householdName}` : "No household yet"}</p>
        <ChainPill chain={chain} />
        <form action={logout}>
          <SubmitButton variant="secondary" size="sm" pendingLabel="Signing out…" className="w-full">
            Sign out
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
