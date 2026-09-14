import { loadDemoData } from "@/app/actions/settings";
import { EmptyState } from "./EmptyState";
import { SubmitButton } from "./SubmitButton";

export function LoadDemoButton({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <form action={loadDemoData}>
      <SubmitButton pendingLabel="Loading…" size={size}>
        Load demo data
      </SubmitButton>
    </form>
  );
}

/** Every page shows this until a household exists (docs/DESIGN.md §5). */
export function NoHousehold({ body }: { body?: string }) {
  return (
    <EmptyState
      title="No household yet"
      body={body ?? "Load the demo family to see how Housewarden works. Everything it adds can be changed, marked done or paid, and every change is recorded."}
      action={<LoadDemoButton />}
    />
  );
}
