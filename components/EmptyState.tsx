import type { ReactNode } from "react";

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center md:px-6 md:py-10">
      <h2 className="text-lg">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
