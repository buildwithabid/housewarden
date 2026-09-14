"use client";

import { useEffect, useState } from "react";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * "Expires in mm:ss" for a pending action. Renders the static fallback on the
 * server (and without JavaScript), then ticks once mounted. At zero it marks
 * itself expired so the card can grey out.
 */
export function Countdown({ expiresAt, fallback }: { expiresAt: string; fallback: string }) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const target = new Date(expiresAt).getTime();
    const tick = () => setLeft(Math.max(0, Math.floor((target - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  const expired = left === 0;
  return (
    <span className="tabular font-mono text-sm" aria-live="polite" data-expired={expired ? "true" : undefined}>
      {left === null ? fallback : expired ? "Expired — ask again" : `Expires in ${pad(Math.floor(left / 60))}:${pad(left % 60)}`}
    </span>
  );
}
