import type { FlashTone } from "@/lib/console/url";

const TONES: Record<FlashTone, string> = {
  accent: "border-accent/30 bg-accent-soft text-accent",
  warn: "border-warn/30 bg-warn-soft text-warn",
  danger: "border-danger/30 bg-danger-soft text-danger",
  neutral: "border-border bg-surface-2 text-ink",
};

/** The notice a redirect leaves behind in `?flash=` and `?tone=`. */
export function Flash({ message, tone = "neutral" }: { message?: string; tone?: FlashTone }) {
  if (!message) return null;
  return (
    <div aria-live="polite" className="mb-4">
      <p className={`flash rounded-lg border px-4 py-3 text-sm ${TONES[tone]}`}>{message}</p>
    </div>
  );
}
