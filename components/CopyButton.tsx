"use client";

import { useState } from "react";
import { Button } from "./Button";

/** Copies `text` to the clipboard; without JavaScript the text next to it is still selectable. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 2000);
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={copy} aria-live="polite">
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : label}
    </Button>
  );
}
