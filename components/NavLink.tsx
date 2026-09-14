"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** A sidebar link that knows when it is the current page and closes the phone nav sheet when tapped. */
export function NavLink({ href, children, badge }: { href: string; children: ReactNode; badge?: ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}
      className={`flex min-h-11 items-center justify-between gap-2 rounded-md px-3 transition-colors ${
        active ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-surface-2"
      }`}
    >
      <span>{children}</span>
      {badge}
    </Link>
  );
}
