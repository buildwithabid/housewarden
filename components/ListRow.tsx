import type { ReactNode } from "react";
import type { ChipTone } from "@/lib/console/format";
import { Chip } from "./Chip";

/** A bordered surface whose rows are separated by 1px lines; no zebra striping. */
export function List({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`divide-y divide-border rounded-lg border border-border bg-surface ${className}`}>{children}</div>;
}

/** One entity row (docs/DESIGN.md §4.2). Rows never navigate on click; only explicit links and buttons act. */
export function ListRow({
  leading,
  title,
  meta = [],
  chip,
  trailing,
  extra,
  muted = false,
}: {
  leading?: ReactNode;
  title: ReactNode;
  meta?: string[];
  chip?: { label: string; tone: ChipTone };
  trailing?: ReactNode;
  /** Rendered under the meta line, e.g. a collapsed inline edit form. */
  extra?: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center md:px-6">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {leading && <div className="shrink-0 pt-0.5">{leading}</div>}
        <div className="min-w-0 flex-1">
          <p className={`font-medium break-words ${muted ? "text-ink-3" : "text-ink"}`}>{title}</p>
          {meta.length > 0 && <p className="mt-0.5 text-sm text-ink-2">{meta.join(" · ")}</p>}
          {extra}
        </div>
      </div>
      {(chip || trailing) && (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {chip && <Chip tone={chip.tone}>{chip.label}</Chip>}
          {trailing}
        </div>
      )}
    </div>
  );
}
