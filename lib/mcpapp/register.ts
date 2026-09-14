import type { McpServer, RegisteredTool } from "@modelcontextprotocol/server";
import { ENV, MCP_APP_MIME_TYPE, MCP_APP_RESOURCE_URI, type ToolName } from "@/lib/contracts";
import { pendingAppHtml } from "./html";

/**
 * MCP Apps extension (SEP-1865, specification 2026-01-26) for Housewarden.
 *
 * Feature-flagged by HOUSEWARDEN_MCP_APP: any value other than 0/false/off/no
 * (including unset) enables it. When enabled, `registerMcpApp` registers the
 * `ui://housewarden/pending` resource (the confirmation-card app in
 * ui/pending.html) and links the three guard tools to it through `_meta.ui`.
 * Hosts that do not implement the extension see an ordinary resource and
 * ordinary tools; nothing else changes. See docs/MCP_APP.md for the spec quotes.
 */

/** Extension identifier hosts advertise under `capabilities.extensions`. */
export const MCP_APP_EXTENSION_ID = "io.modelcontextprotocol/ui";
/** Protocol version the app sends in `ui/initialize`. */
export const MCP_APP_PROTOCOL_VERSION = "2026-01-26";
/** Resource name shown by hosts in `resources/list`. */
export const MCP_APP_RESOURCE_NAME = "pending-approvals";

const GUARD_UI_TOOL_NAMES = ["list_pending_actions", "confirm_action", "reject_action"] as const satisfies readonly ToolName[];

/** The tools whose results render as the pending-approvals app. */
export const GUARD_UI_TOOLS: ReadonlySet<string> = new Set<string>(GUARD_UI_TOOL_NAMES);

const DISABLED_VALUES = new Set(["0", "false", "off", "no"]);

/** True unless HOUSEWARDEN_MCP_APP is set to 0, false, off or no. */
export function isMcpAppEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const raw = env[ENV.MCP_APP];
  if (raw === undefined) return true;
  return !DISABLED_VALUES.has(raw.trim().toLowerCase());
}

/**
 * `_meta` for a tool that renders as the app. `ui.resourceUri` is the key in
 * the 2026-01-26 specification; `ui/resourceUri` is the earlier flat key that
 * the reference `registerAppTool` helper still populates alongside it.
 */
export interface McpAppToolMeta {
  ui: { resourceUri: string };
  "ui/resourceUri": string;
}

export const MCP_APP_TOOL_META: McpAppToolMeta = {
  ui: { resourceUri: MCP_APP_RESOURCE_URI },
  "ui/resourceUri": MCP_APP_RESOURCE_URI,
};

/**
 * `_meta.ui` for the resource: no network access, rendered with the host's
 * border so the card reads as Housewarden's own surface inside the chat.
 */
export const MCP_APP_RESOURCE_META = {
  ui: {
    prefersBorder: true,
    csp: { connectDomains: [] as string[], resourceDomains: [] as string[] },
  },
};

/**
 * Spread into a `registerTool` config: `{ ...guardToolUiMeta(def.name) }`.
 * Empty unless the flag is on and the tool is one of GUARD_UI_TOOLS, so it is
 * safe to spread for every tool.
 */
export function guardToolUiMeta(name: string): { _meta: McpAppToolMeta } | Record<never, never> {
  return isMcpAppEnabled() && GUARD_UI_TOOLS.has(name) ? { _meta: MCP_APP_TOOL_META } : {};
}

export interface McpAppRegistration {
  enabled: boolean;
  resourceUri: string;
  /** Guard tools whose `_meta` was attached through the handles passed in. */
  toolsLinked: string[];
}

/**
 * Registers the MCP App on a server built for one request.
 *
 * - No-op (returns `enabled: false`) when the flag is off.
 * - Registers `ui://housewarden/pending` with mimeType `text/html;profile=mcp-app`.
 *   The SDK adds the `resources` capability itself on the first registered
 *   resource, so the caller does not need to declare it.
 * - When `tools` (name → handle returned by `server.registerTool`) is given,
 *   attaches `_meta.ui.resourceUri` to the guard tools among them through the
 *   public `RegisteredTool.update()` API. Callers that build their tool config
 *   inline can spread `guardToolUiMeta(name)` instead; both produce the same
 *   `tools/list` entry.
 *
 * Call it once per McpServer instance, after the tools are registered.
 */
export function registerMcpApp(
  server: McpServer,
  tools?: Iterable<readonly [string, RegisteredTool]>,
): McpAppRegistration {
  if (!isMcpAppEnabled()) return { enabled: false, resourceUri: MCP_APP_RESOURCE_URI, toolsLinked: [] };

  server.registerResource(
    MCP_APP_RESOURCE_NAME,
    MCP_APP_RESOURCE_URI,
    {
      title: "Pending approvals",
      description:
        "Housewarden's confirmation cards: what the assistant proposed, what would change, and Approve / Reject. Rendered by hosts that support MCP Apps.",
      mimeType: MCP_APP_MIME_TYPE,
      _meta: MCP_APP_RESOURCE_META,
    },
    async () => ({
      contents: [
        {
          uri: MCP_APP_RESOURCE_URI,
          mimeType: MCP_APP_MIME_TYPE,
          text: pendingAppHtml(),
          _meta: MCP_APP_RESOURCE_META,
        },
      ],
    }),
  );

  const toolsLinked: string[] = [];
  if (tools) {
    for (const [name, tool] of tools) {
      if (!GUARD_UI_TOOLS.has(name)) continue;
      tool.update({ _meta: { ...(tool._meta ?? {}), ...MCP_APP_TOOL_META } });
      toolsLinked.push(name);
    }
  }
  return { enabled: true, resourceUri: MCP_APP_RESOURCE_URI, toolsLinked };
}
