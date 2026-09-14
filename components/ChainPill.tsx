import Link from "next/link";
import type { ChainVerification } from "@/lib/contracts";
import { plural } from "@/lib/console/format";
import { Chip } from "./Chip";

/** "Chain intact · 14 rows" or "Chain broken at #k" — colour and words together (docs/DESIGN.md §6). */
export function ChainPill({ chain, className = "" }: { chain: ChainVerification; className?: string }) {
  return (
    <Link href="/audit" className={`inline-flex ${className}`} title="Open the audit log">
      <Chip tone={chain.intact ? "accent" : "danger"}>
        {chain.intact ? `Chain intact · ${plural(chain.rows, "row")}` : `Chain broken at #${chain.first_bad_seq ?? "?"}`}
      </Chip>
    </Link>
  );
}
