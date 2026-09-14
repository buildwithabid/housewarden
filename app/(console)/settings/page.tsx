import type { Metadata } from "next";
import type { ReactNode } from "react";
import { setPolicyInline } from "@/app/actions/settings";
import { DEFAULTS, MCP_SERVER_INFO, TOOL_CATALOGUE, type Policy } from "@/lib/contracts";
import { loadConsole } from "@/lib/console/data";
import { mcpEndpointUrl } from "@/lib/console/endpoint";
import { riskLabel, riskTone, toolTitle } from "@/lib/console/format";
import { readQuery, type SearchParams } from "@/lib/console/page";
import { listMembers, listPolicies } from "@/lib/domain";
import { env } from "@/lib/env";
import { Chip } from "@/components/Chip";
import { ConfirmSlot } from "@/components/ConfirmSlot";
import { CopyButton } from "@/components/CopyButton";
import { Flash } from "@/components/Flash";
import { PolicyForm } from "@/components/forms";
import { LoadDemoButton } from "@/components/NoHousehold";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { SubmitButton } from "@/components/SubmitButton";
import { withHousehold } from "@/lib/console/data";

export const metadata: Metadata = { title: "Settings" };

/** Never the token itself: the conventional prefix when present, otherwise a mask (docs/SPEC.md §8). */
function tokenHint(token: string): string {
  return token.startsWith("hw_") ? "hw_…" : "••••…";
}

const MUTATING_TOOLS = TOOL_CATALOGUE.filter((t) => t.kind === "mutating").map((t) => ({ name: t.name, title: t.title }));

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="shrink-0 text-sm text-ink-2 sm:w-40">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

function PolicyRow({ policy, key_ }: { policy: Policy; key_: string }) {
  const isSetPolicy = policy.tool_name === "set_policy";
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2">
        <span className="font-medium text-ink">{toolTitle(policy.tool_name)}</span>
        <span className="block font-mono text-xs text-ink-3">{policy.tool_name}</span>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-ink-2">{policy.scope || <span className="text-ink-3">any</span>}</td>
      <td className="px-3 py-2 text-ink-2">{policy.member ? policy.member.name : "everyone"}</td>
      <td className="px-3 py-2">
        <Chip tone={riskTone(policy.risk)}>{riskLabel(policy.risk)}</Chip>
      </td>
      <td className="px-3 py-2">
        <Chip tone={policy.source === "household" ? "info" : "neutral"}>{policy.source}</Chip>
      </td>
      <td className="px-3 py-2">
        <form action={setPolicyInline} className="flex items-center gap-2">
          <input type="hidden" name="tool_name" value={policy.tool_name} />
          <input type="hidden" name="scope" value={policy.scope} />
          <input type="hidden" name="for_member" value={policy.member?.id ?? ""} />
          <label className="sr-only" htmlFor={`risk-${key_}`}>
            New risk for {policy.tool_name}
          </label>
          <select id={`risk-${key_}`} name="risk" className="input min-h-11 w-28 py-1 text-sm" defaultValue={policy.risk}>
            {!isSetPolicy && <option value="low">low</option>}
            <option value="confirm">confirm</option>
            <option value="high">high</option>
          </select>
          <SubmitButton size="sm" variant="secondary" pendingLabel="Proposing…">
            Change
          </SubmitButton>
        </form>
      </td>
    </tr>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [ctx, q, endpoint] = await Promise.all([loadConsole("/settings"), readQuery(searchParams), mcpEndpointUrl()]);
  const h = withHousehold(ctx);
  const e = env();
  const [policies, members] = h ? await Promise.all([listPolicies(h.db, h.household.id), listMembers(h.db, h.household.id)]) : [[], []];

  return (
    <>
      <PageHeader title="Settings" description="Approval rules, the MCP endpoint an assistant connects to, and where the data lives." />
      <Flash message={q.flash} tone={q.tone} />
      {h && <ConfirmSlot id={q.confirm} ctx={h} returnTo="/settings" />}

      <Section id="policies" title="Approval rules" count={policies.length}>
        <p className="mb-3 text-sm text-ink-2">
          What each tool needs before it runs: <Chip tone="info">low risk</Chip> runs at once, <Chip tone="warn">confirm</Chip> waits for a person here or a
          spoken yes, <Chip tone="danger">high risk</Chip> waits for this console only. Changing a rule is itself high risk, so every change lands here as a
          card for you to approve; the assistant can propose one but never approve it.
        </p>
        {!h ? (
          <div className="rounded-lg border border-border bg-surface p-4 md:p-6">
            <p className="text-sm text-ink-2">Rules apply to a household. Load the demo data to start.</p>
            <div className="mt-3">
              <LoadDemoButton size="sm" />
            </div>
          </div>
        ) : (
          <>
            <div className="relative overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-[44rem] text-sm">
                <thead className="bg-surface-2 text-left text-xs text-ink-2">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Tool</th>
                    <th scope="col" className="px-3 py-2 font-medium">Scope</th>
                    <th scope="col" className="px-3 py-2 font-medium">Applies to</th>
                    <th scope="col" className="px-3 py-2 font-medium">Risk</th>
                    <th scope="col" className="px-3 py-2 font-medium">Source</th>
                    <th scope="col" className="px-3 py-2 font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map((p) => {
                    const key = `${p.tool_name}|${p.scope}|${p.member?.id ?? ""}`;
                    return <PolicyRow key={key} key_={key.replace(/[^a-z0-9]/gi, "-")} policy={p} />;
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 rounded-lg border border-border bg-surface p-4 md:p-6">
              <h3 className="mb-3 text-base">Add a rule</h3>
              <PolicyForm tools={MUTATING_TOOLS} members={members.map((m) => ({ id: m.id, name: m.name }))} />
            </div>
          </>
        )}
      </Section>

      <Section id="mcp" title="MCP endpoint">
        <div className="rounded-lg border border-border bg-surface px-4 md:px-6">
          <dl className="divide-y divide-border">
            <Row label="Endpoint URL">
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-md bg-surface-2 px-2 py-1 font-mono text-sm break-all">{endpoint}</code>
                <CopyButton text={endpoint} />
              </div>
              <p className="mt-1 text-xs text-ink-3">Streamable HTTP, MCP 2025-11-25 and later. Connect with the token below as a bearer token.</p>
            </Row>
            <Row label="Token">
              {e.token ? (
                <>
                  <code className="rounded-md bg-surface-2 px-2 py-1 font-mono text-xs">{tokenHint(e.token)}</code> {e.token.length} characters. Shown once at first start;
                  rotate by editing <code className="font-mono text-xs">.env.local</code> and restarting.
                </>
              ) : (
                <span className="text-danger">Not set. The endpoint answers 503 until HOUSEWARDEN_TOKEN (16 or more characters) is set.</span>
              )}
            </Row>
            <Row label="Allowed origins">
              {e.allowedOrigins.length === 0 ? (
                <>
                  None. Requests with an <code className="font-mono text-xs">Origin</code> header are refused; non-browser clients (no Origin) are fine. Set
                  HOUSEWARDEN_ALLOWED_ORIGINS to allow a browser host.
                </>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {e.allowedOrigins.map((o) => (
                    <li key={o}>
                      <code className="rounded-md bg-surface-2 px-2 py-1 font-mono text-xs">{o}</code>
                    </li>
                  ))}
                </ul>
              )}
            </Row>
            <Row label="Confirmation window">{Math.round(e.confirmTtlSeconds / 60)} minutes before a pending action expires.</Row>
            <Row label="MCP App">{e.mcpApp ? "On: hosts that support MCP Apps get the pending-approvals view inline." : "Off (HOUSEWARDEN_MCP_APP=0). Remove that setting to serve the pending-approvals view to hosts that support MCP Apps."}</Row>
          </dl>
        </div>
      </Section>

      <Section id="storage" title="Storage and household">
        <div className="rounded-lg border border-border bg-surface px-4 md:px-6">
          <dl className="divide-y divide-border">
            <Row label="Storage">{e.db === "pg" ? "Postgres via DATABASE_URL" : `Embedded PGlite at ${e.dataDir === DEFAULTS.DATA_DIR_MEMORY ? "memory (ephemeral)" : e.dataDir}`}</Row>
            <Row label="Household">
              {h ? (
                `${h.household.name} · ${h.household.currency} · ${h.household.timezone}`
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span>None yet.</span>
                  <LoadDemoButton size="sm" />
                </div>
              )}
            </Row>
            <Row label="Version">
              {MCP_SERVER_INFO.title} {MCP_SERVER_INFO.version}
            </Row>
          </dl>
        </div>
      </Section>
    </>
  );
}
