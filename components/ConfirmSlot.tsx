import Link from "next/link";
import type { HouseholdContext } from "@/lib/console/data";
import { loadConfirm, memberNameOf, memberNames } from "@/lib/console/page";
import { listMembers } from "@/lib/domain";
import { ConfirmationCard } from "./ConfirmationCard";

/** Renders the card for `?confirm=<id>` at the top of an entity page, if the id is real. */
export async function ConfirmSlot({ id, ctx, returnTo }: { id: string | undefined; ctx: HouseholdContext; returnTo: string }) {
  const action = await loadConfirm(ctx.db, id, ctx.now);
  if (!action) return null;
  const members = await listMembers(ctx.db, ctx.household.id);
  return (
    <div className="mb-6">
      <ConfirmationCard
        action={action}
        memberName={memberNameOf(action.created_by.member_id, memberNames(members))}
        timeZone={ctx.household.timezone}
        today={ctx.today}
        nowIso={ctx.now.toISOString()}
        returnTo={returnTo}
      />
      {action.status === "pending" && returnTo.split("?")[0] !== "/pending" && (
        <p className="mt-2 text-xs text-ink-3">
          This is waiting with everything else under{" "}
          <Link href="/pending" className="text-accent underline-offset-2 hover:underline">
            Pending approvals
          </Link>
          ; approving there or here is the same.
        </p>
      )}
    </div>
  );
}
