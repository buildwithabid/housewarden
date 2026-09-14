import type { ReactNode } from "react";
import type { ChipTone } from "@/lib/console/format";

const TONES: Record<ChipTone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  "danger-muted": "bg-danger-soft text-ink-3",
};

export function Chip({ tone = "neutral", children, className = "" }: { tone?: ChipTone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}
