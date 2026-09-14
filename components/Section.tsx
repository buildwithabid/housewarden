import type { ReactNode } from "react";

export function Section({
  id,
  title,
  count,
  action,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id={id} className="text-base">
          {title}
          {count !== undefined && <span className="ml-2 text-sm font-normal text-ink-3">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
