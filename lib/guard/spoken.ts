/**
 * Spoken lines for the guard envelope. Planners provide an infinitive clause
 * ("mark Electricity, 3,000 rupees, as paid"); the guard wraps it for the
 * outcome so every tool sounds the same at the confirmation step.
 */
import type { Risk } from "@/lib/contracts";
import { lowerFirst } from "@/lib/domain/shared";

export function spokenDuration(seconds: number): string {
  if (seconds < 120) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} minutes`;
  return `${Math.round(minutes / 60)} hours`;
}

export function spokenNeedsConfirmation(clause: string, risk: Risk, ttlSeconds: number): string {
  if (risk === "high") return `I can ${clause}, but a person needs to approve it in the Housewarden console.`;
  return `I can ${clause}, but it needs your approval. Say yes to confirm, or approve it in the console within ${spokenDuration(ttlSeconds)}.`;
}

export function spokenDryRun(clause: string, risk: Risk): string {
  const tail =
    risk === "high"
      ? "a person would need to approve it in the console."
      : risk === "confirm"
        ? "it would need your approval."
        : "it would go ahead without approval.";
  return `Nothing was changed. I would ${clause}; ${tail}`;
}

export function spokenRejected(summary: string): string {
  return `Okay, I won't go ahead with that: ${lowerFirst(summary)}.`;
}

export function spokenReplayExecuted(summary: string): string {
  return `That was already done: ${lowerFirst(summary)}.`;
}

export function spokenReplayRejected(summary: string): string {
  return `That was already declined: ${lowerFirst(summary)}.`;
}

export function spokenReplayPending(summary: string, expiresAt: Date, now: Date): string {
  const left = Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 1000));
  return `${summary} is still waiting for approval; it expires in ${spokenDuration(left)}. Say yes to confirm, or approve it in the console.`;
}
