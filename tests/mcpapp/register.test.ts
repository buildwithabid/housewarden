import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { InMemoryTransport, McpServer, type RegisteredTool } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { ENV, MCP_APP_MIME_TYPE, MCP_APP_RESOURCE_URI } from "@/lib/contracts";
import { GET } from "@/app/api/mcp/ui/route";
import { pendingAppHtml } from "@/lib/mcpapp/html";
import {
  GUARD_UI_TOOLS,
  MCP_APP_PROTOCOL_VERSION,
  guardToolUiMeta,
  isMcpAppEnabled,
  registerMcpApp,
} from "@/lib/mcpapp/register";

const EMPTY_LIST = { actions: [] as unknown[], pending_count: 0 };

/** Registers two stand-in tools the way the tools agent will, returning their handles. */
function registerStandInTools(server: McpServer): Map<string, RegisteredTool> {
  const handles = new Map<string, RegisteredTool>();
  handles.set(
    "list_pending_actions",
    server.registerTool(
      "list_pending_actions",
      {
        title: "List pending actions",
        inputSchema: z.object({}),
        outputSchema: z.object({ actions: z.array(z.unknown()), pending_count: z.number() }),
      },
      async () => ({ content: [{ type: "text", text: "Nothing is waiting." }], structuredContent: EMPTY_LIST }),
    ),
  );
  handles.set(
    "add_bill",
    server.registerTool(
      "add_bill",
      { title: "Add bill", inputSchema: z.object({ name: z.string() }) },
      async () => ({ content: [{ type: "text", text: "Added." }] }),
    ),
  );
  return handles;
}

async function connectedPair(setup: (server: McpServer) => void) {
  const server = new McpServer({ name: "housewarden-test", version: "0.0.0" });
  setup(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-host", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

const originalFlag = process.env[ENV.MCP_APP];

afterEach(() => {
  if (originalFlag === undefined) delete process.env[ENV.MCP_APP];
  else process.env[ENV.MCP_APP] = originalFlag;
});

describe("isMcpAppEnabled", () => {
  it("is on unless the flag says off", () => {
    expect(isMcpAppEnabled({})).toBe(true);
    expect(isMcpAppEnabled({ HOUSEWARDEN_MCP_APP: "1" })).toBe(true);
    expect(isMcpAppEnabled({ HOUSEWARDEN_MCP_APP: "yes" })).toBe(true);
    for (const off of ["0", "false", "off", "no", " OFF "]) {
      expect(isMcpAppEnabled({ HOUSEWARDEN_MCP_APP: off })).toBe(false);
    }
  });
});

describe("registerMcpApp (flag on)", () => {
  it("lists and reads ui://housewarden/pending with the MCP Apps mime type and _meta.ui", async () => {
    delete process.env[ENV.MCP_APP];
    let registration: ReturnType<typeof registerMcpApp> | undefined;
    const { client } = await connectedPair((server) => {
      registration = registerMcpApp(server, registerStandInTools(server));
    });

    expect(registration).toEqual({
      enabled: true,
      resourceUri: MCP_APP_RESOURCE_URI,
      toolsLinked: ["list_pending_actions"],
    });
    expect(client.getServerCapabilities()?.resources).toBeDefined();

    const listed = await client.listResources();
    const resource = listed.resources.find((r) => r.uri === MCP_APP_RESOURCE_URI);
    expect(resource).toBeDefined();
    expect(resource?.mimeType).toBe(MCP_APP_MIME_TYPE);
    expect(resource?.mimeType).toBe("text/html;profile=mcp-app");
    expect(resource?._meta).toMatchObject({ ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } });

    const read = await client.readResource({ uri: MCP_APP_RESOURCE_URI });
    expect(read.contents).toHaveLength(1);
    const content = read.contents[0];
    expect(content.uri).toBe(MCP_APP_RESOURCE_URI);
    expect(content.mimeType).toBe(MCP_APP_MIME_TYPE);
    expect(content._meta).toMatchObject({ ui: { prefersBorder: true } });
    expect("text" in content && content.text).toBe(pendingAppHtml());
  });

  it("links the guard tools through _meta.ui.resourceUri and leaves other tools alone", async () => {
    delete process.env[ENV.MCP_APP];
    const { client } = await connectedPair((server) => {
      registerMcpApp(server, registerStandInTools(server));
    });
    const { tools } = await client.listTools();
    const guard = tools.find((t) => t.name === "list_pending_actions");
    const plain = tools.find((t) => t.name === "add_bill");
    expect(guard?._meta).toEqual({
      ui: { resourceUri: MCP_APP_RESOURCE_URI },
      "ui/resourceUri": MCP_APP_RESOURCE_URI,
    });
    expect(plain?._meta).toBeUndefined();
    // tools/list still works end to end and the linked tool still runs.
    const result = await client.callTool({ name: "list_pending_actions", arguments: {} });
    expect(result.structuredContent).toEqual(EMPTY_LIST);
  });

  it("guardToolUiMeta spreads the same _meta for the three guard tools only", () => {
    delete process.env[ENV.MCP_APP];
    expect([...GUARD_UI_TOOLS].sort()).toEqual(["confirm_action", "list_pending_actions", "reject_action"]);
    for (const name of GUARD_UI_TOOLS) {
      expect(guardToolUiMeta(name)).toEqual({
        _meta: { ui: { resourceUri: MCP_APP_RESOURCE_URI }, "ui/resourceUri": MCP_APP_RESOURCE_URI },
      });
    }
    expect(guardToolUiMeta("add_bill")).toEqual({});
    expect(guardToolUiMeta("mark_bill_paid")).toEqual({});
  });
});

describe("registerMcpApp (flag off)", () => {
  it("registers nothing and never breaks tools/list", async () => {
    process.env[ENV.MCP_APP] = "0";
    let registration: ReturnType<typeof registerMcpApp> | undefined;
    const { client } = await connectedPair((server) => {
      registration = registerMcpApp(server, registerStandInTools(server));
    });
    expect(registration?.enabled).toBe(false);
    expect(registration?.toolsLinked).toEqual([]);
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["add_bill", "list_pending_actions"]);
    expect(tools.every((t) => t._meta === undefined)).toBe(true);
    expect(guardToolUiMeta("confirm_action")).toEqual({});
  });
});

describe("ui/pending.html", () => {
  const html = pendingAppHtml();

  it("is self-contained: no external scripts, styles, fonts or fetches", () => {
    expect(html.toLowerCase().startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import\b/i);
    expect(html).not.toMatch(/url\(\s*['"]?https?:/i);
    expect(html).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket\(/);
    expect(html).not.toMatch(/https?:\/\//i);
  });

  it("speaks the MCP Apps bridge and the three guard tools", () => {
    for (const needle of [
      `"${MCP_APP_PROTOCOL_VERSION}"`,
      '"ui/initialize"',
      '"ui/notifications/initialized"',
      '"ui/notifications/tool-result"',
      '"ui/notifications/tool-input"',
      '"ui/notifications/tool-cancelled"',
      '"ui/notifications/host-context-changed"',
      '"ui/notifications/size-changed"',
      '"ui/resource-teardown"',
      '"tools/call"',
      "list_pending_actions",
      "confirm_action",
      "reject_action",
      "event.source !== window.parent",
    ]) {
      expect(html, needle).toContain(needle);
    }
  });

  it("carries the design tokens and the empty-state copy", () => {
    expect(html).toContain("--accent: #1E6B4F");
    expect(html).toContain("--accent: #5CC49A");
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain("Nothing waiting");
    expect(html).toContain("prefers-reduced-motion");
  });
});

describe("GET /api/mcp/ui", () => {
  it("serves the app as text/html with a sandbox-like CSP when the flag is on", async () => {
    delete process.env[ENV.MCP_APP];
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe(pendingAppHtml());
  });

  it("is 404 when the flag is off", async () => {
    process.env[ENV.MCP_APP] = "0";
    const res = GET();
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("<script");
  });
});
