import Link from "next/link";

export type TileTone = "neutral" | "accent" | "warn" | "danger";

const HINT: Record<TileTone, string> = {
  neutral: "text-ink-2",
  accent: "text-accent",
  warn: "text-warn",
  danger: "text-danger",
};

const EDGE: Record<TileTone, string> = {
  neutral: "",
  accent: "border-l-[3px] border-l-accent",
  warn: "border-l-[3px] border-l-warn",
  danger: "border-l-[3px] border-l-danger",
};

/** Dashboard and device summary unit (docs/DESIGN.md §4.1). */
export function Tile({
  label,
  value,
  hint,
  tone = "neutral",
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: TileTone;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase text-ink-2">{label}</p>
      <p className={`tile-value mt-1 text-2xl ${value === "—" ? "text-ink-3" : "text-ink"}`}>{value}</p>
      {hint && <p className={`mt-1 text-sm ${HINT[tone]}`}>{hint}</p>}
    </>
  );
  const base = `block min-w-0 rounded-lg border border-border bg-surface p-4 md:p-6 ${EDGE[tone]}`;
  if (href) {
    return (
      <Link href={href} className={`${base} transition-colors hover:bg-surface-2`}>
        {body}
      </Link>
    );
  }
  return <div className={base}>{body}</div>;
}
