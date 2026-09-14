import type { Metadata } from "next";
import { LinkButton } from "@/components/Button";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10 text-center">
      <h1 className="text-xl">There’s nothing at this address</h1>
      <p className="mt-2 text-sm text-ink-2">The page may have moved, or the link was mistyped.</p>
      <div className="mt-6 flex justify-center">
        <LinkButton href="/" variant="primary">
          Go to the dashboard
        </LinkButton>
      </div>
    </main>
  );
}
