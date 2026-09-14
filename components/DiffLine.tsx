import type { Change } from "@/lib/contracts";
import { describeChange } from "@/lib/console/diff";

/** One change of a preview: entity · label · before → after (docs/DESIGN.md §4.3). */
export function DiffLine({ change, timeZone }: { change: Change; timeZone: string }) {
  const d = describeChange(change, timeZone);
  return (
    <li className="diff-line py-1.5" title={d.line}>
      <div className="flex items-baseline gap-2 md:contents">
        <span className="font-mono text-xs text-ink-3">{d.entity}</span>
        <span className={`font-medium ${d.op === "delete" ? "text-ink-3 line-through" : "text-ink"}`}>{d.label}</span>
      </div>
      <span className="text-sm text-ink">
        {d.op === "create" && <span className="font-medium text-accent">new</span>}
        {d.op === "delete" && <span className="font-medium text-danger">removed</span>}
        {d.parts.map((p, i) => (
          <span key={p.key}>
            {(i > 0 || d.op !== "update") && <span className="text-ink-3"> · </span>}
            <span className="text-ink-2">{p.key}</span>{" "}
            {d.op === "update" ? (
              <>
                <span className="text-ink-3">{p.before ?? "—"}</span>
                <span className="text-ink-2"> → </span>
                <span>{p.after ?? "—"}</span>
              </>
            ) : d.op === "create" ? (
              <span>{p.after ?? "—"}</span>
            ) : (
              <span className="text-ink-3">{p.before ?? "—"}</span>
            )}
          </span>
        ))}
      </span>
    </li>
  );
}
