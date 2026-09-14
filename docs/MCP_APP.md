# Housewarden MCP App — pending approvals inside the assistant

Housewarden's guard queues risky actions until a person approves them. Hosts
that implement the **MCP Apps** extension can show that queue as
Housewarden's own confirmation cards inside the chat, with Approve and Reject
buttons that call the same `confirm_action` / `reject_action` tools the
assistant and the console use. Hosts that do not implement the extension see
ordinary tools and an ordinary resource; nothing changes for them.

- Specification: SEP-1865, revision **2026-01-26** —
  <https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx>
  (site: <https://apps.extensions.modelcontextprotocol.io/>).
- Reference SDK (`@modelcontextprotocol/ext-apps`, not a dependency here):
  `src/server/index.ts`, `src/app.ts`, `src/message-transport.ts`, `src/constants.ts`.
- Housewarden implementation: `lib/mcpapp/register.ts`, `lib/mcpapp/html.ts`,
  `ui/pending.html`, `app/api/mcp/ui/route.ts`, tests in `tests/mcpapp/`.

## 1. Switch

| Variable | Effect |
|---|---|
| `HOUSEWARDEN_MCP_APP` unset, `1`, anything else | App on: `ui://housewarden/pending` is registered and the three guard tools carry `_meta.ui.resourceUri`. |
| `HOUSEWARDEN_MCP_APP=0` (or `false`, `off`, `no`) | App off: no resource, no `_meta`, `GET /api/mcp/ui` is 404. |

`isMcpAppEnabled()` in `lib/mcpapp/register.ts` is the single reader of the flag.

## 2. What the specification requires, and where Housewarden does it

Quotes are from the 2026-01-26 specification unless marked otherwise.

| Requirement (quoted) | Housewarden |
|---|---|
| UI resources "MUST use the `ui://` URI scheme to distinguish UI resources from other MCP resource types." | `MCP_APP_RESOURCE_URI = "ui://housewarden/pending"` (`lib/contracts.ts`), registered by `registerMcpApp`. |
| `mimeType` "SHOULD be `text/html;profile=mcp-app` for HTML-based UIs in the initial MVP." | `MCP_APP_MIME_TYPE = "text/html;profile=mcp-app"` on the resource listing and on every `resources/read` content. Same value as `RESOURCE_MIME_TYPE` in the reference SDK's `constants.ts`. |
| Tool → UI link: the tool's `_meta` carries `"ui": { "resourceUri": "ui://weather-server/dashboard-template" }` (spec example). | `MCP_APP_TOOL_META = { ui: { resourceUri }, "ui/resourceUri": resourceUri }` attached to `list_pending_actions`, `confirm_action`, `reject_action`. The flat `ui/resourceUri` key (`RESOURCE_URI_META_KEY` in the reference SDK) is the pre-2026-01-26 spelling; the reference `registerAppTool` populates both, so we do too. |
| `resources/read` returns `contents[]` with `uri`, `mimeType`, `text` and `_meta.ui` (`csp`, `prefersBorder`) (spec example). | The read callback returns exactly that, with `csp: { connectDomains: [], resourceDomains: [] }` and `prefersBorder: true`. |
| "Host MUST use `resources/read` to fetch the referenced resource URI." "Servers MAY omit UI-only resources from `resources/list`." | Housewarden lists it as well (discoverable, harmless). |
| CSP: when no domains are declared the host applies `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'none'`. "Host MAY further restrict but MUST NOT allow undeclared domains." | `ui/pending.html` inlines all CSS and JS and never fetches; `tests/mcpapp/register.test.ts` asserts there is no external `src`, `<link>`, `@import`, `fetch`, or `https://` reference. The preview route sends the same CSP so a browser shows what a host would. |
| Capability negotiation: "Clients advertise MCP Apps support in the initialize request using the extension identifier `io.modelcontextprotocol/ui`" with `mimeTypes` (REQUIRED). "Servers SHOULD check client capabilities before registering UI-enabled tools." | Housewarden serves stateless per-request servers (`mcp-handler`), so client capabilities are not known at registration time. We register unconditionally, which the spec allows: "If host does not support MCP Apps, tool behaves as standard tool (text-only fallback)". Every guard tool already returns a spoken `content[0].text` and `structuredContent`, so the fallback is complete. `MCP_APP_EXTENSION_ID` is exported for a host-capability check if a stateful transport is ever used. |
| "Servers SHOULD provide text-only fallback behavior for all UI-enabled tools" | See above; the tools are unchanged. |

Server SDK facts the implementation relies on (`@modelcontextprotocol/server` 2.0, from `dist/*.d.mts` and the runtime):

- `McpServer.registerTool(name, { …, _meta?: Record<string, unknown> }, cb)` and `RegisteredTool.update({ _meta })` are public; `update` only sends `notifications/tools/list_changed` when a transport is connected, so it is safe inside `createMcpHandler`'s per-request initializer.
- `McpServer.registerResource(name, uri, ResourceMetadata & { cacheHint? }, cb)` where `ResourceMetadata = Omit<Resource, 'uri' | 'name'>` and `Resource._meta` is an open object; `TextResourceContents._meta` likewise. The first registered resource makes the SDK call `registerCapabilities({ resources: { listChanged: true } })`, so no `capabilities.resources` needs to be declared by hand.
- `mcp-handler` creates `new McpServer(serverInfo, options)`, awaits the initializer, then connects — registration always happens before connect.

## 3. The host ↔ app bridge (what `ui/pending.html` does)

"UI iframes communicate with hosts using standard MCP JSON-RPC protocol" over
`postMessage`; the reference transport posts with
`this.eventTarget.postMessage(message, '*')` to `window.parent` and drops any
incoming event whose `event.source` is not that window. The app does the same
(`event.source !== window.parent` → ignore), and ignores anything that is not
`jsonrpc: "2.0"`.

Sequence, with the exact method names and parameter shapes from
`spec.types.ts`:

```
App → Host   request       ui/initialize            { appInfo: { name, version }, appCapabilities: {}, protocolVersion: "2026-01-26" }
Host → App   result                                 { protocolVersion, hostInfo, hostCapabilities, hostContext: { theme?, … } }
App → Host   notification  ui/notifications/initialized   {}
             ("Host MUST NOT send any request or notification to the View before it receives an initialized notification.")
Host → App   notification  ui/notifications/tool-input    { arguments }          (the call the app is attached to)
Host → App   notification  ui/notifications/tool-result   CallToolResult         (params ARE the CallToolResult: content, structuredContent, isError)
App → Host   request       tools/call               { name: "confirm_action" | "reject_action" | "list_pending_actions", arguments }
Host → App   result                                 CallToolResult
App → Host   notification  ui/notifications/size-changed  { width, height }      ("The View SHOULD send this notification when rendered content body size changes")
Host → App   notification  ui/notifications/host-context-changed  Partial<HostContext>   (theme follows the host)
Host → App   request       ui/resource-teardown     {}  → app answers {} 
```

Behaviour on top of the bridge:

1. After `initialized`, the app waits 1.5 s for a `tool-result` (the host
   attached it to a `list_pending_actions` / `confirm_action` /
   `reject_action` call). If none arrives it calls `list_pending_actions`
   itself, so the resource also works when a host opens it directly.
2. A `tool-result` whose `structuredContent.actions` is an array is rendered
   as cards (`PendingAction[]` from `lib/contracts.ts`). A result whose
   `structuredContent.status` is `executed` / `rejected` (the host ran a guard
   tool for the model) shows the "Done: …" / "Not done: …" flash and re-reads
   the list. `isError` results show `structuredContent.error.message`.
3. Approve → `tools/call confirm_action { action_id }`; Reject →
   `tools/call reject_action { action_id }`; then the list is re-read. The
   host executes these as the assistant, so a `high`-risk action cannot be
   approved here (the guard answers `HIGH_RISK_CONSOLE_ONLY`); the card says so
   and disables Approve while still allowing Reject. This is the guard working,
   not a limitation of the app.
4. States: loading, list, empty ("Nothing waiting"), error (one sentence with
   what to do), expired (countdown reaches 0:00 → "Expired — ask again",
   buttons removed), terminal (executed / rejected / expired / failed shown
   without buttons and with an outcome chip).
5. Design: the confirmation card from `docs/DESIGN.md` §4.3 with the Hearth
   tokens (light and dark, `data-theme` set from `hostContext.theme`), 44 px
   targets, visible focus ring, `aria-live` flash, reduced-motion respected.
   Fonts are the system stacks because the sandbox cannot load Google Fonts.

## 4. Wiring it into the server

`registerMcpApp(server, tools?)` must run inside the `createMcpHandler`
initializer, after the tools are registered:

```ts
// app/api/mcp/route.ts (tools agent) — inside createMcpHandler(async (server) => { … })
registerMcpApp(server, registerTools(server)); // if registerTools returns Map<name, RegisteredTool>
// or, when the tool configs are built inline (docs/SPEC.md §11.1):
//   server.registerTool(def.name, { …, ...guardToolUiMeta(def.name) }, handler)  and then  registerMcpApp(server);
```

Both paths produce the same `tools/list` entry. Nothing else is required:
no capability declaration, no extra route, no change to `tools/list` or
`resources/list` for hosts that ignore `_meta.ui`.

## 5. Trying it

- Browser preview: `GET /api/mcp/ui` (flag on) serves the page; add `?demo`
  to see two sample cards (a `confirm` bill payment and a `high` door unlock)
  driven by an in-page stub — no host, no data.
- Real host: the `ext-apps` repository ships `basic-host`
  (`http://localhost:8080` after `npm run dev` there); point it at
  `http://localhost:3000/api/mcp` with the bearer token, call
  `list_pending_actions`, and the cards render.
- Automated: `npx vitest run tests/mcpapp` exercises `resources/list`,
  `resources/read`, `tools/list` `_meta`, the flag-off path and the preview
  route over an in-memory MCP client.

## 6. Known limits

- Stateless serving means the server cannot honour "check client capabilities
  before registering UI-enabled tools"; the text-only fallback the spec asks
  for is always present instead.
- `ui/pending.html` is read from `process.cwd()/ui/pending.html`, so
  `next.config.ts` lists it under `outputFileTracingIncludes` for the
  `output: "standalone"` build; a hand-rolled deployment must ship the `ui/`
  folder next to the server.
- `ui/update-model-context` and `ui/message` are not used: a decision is
  already visible to the model through the next tool result, and injecting
  chat messages from a card felt wrong for a safety surface.
