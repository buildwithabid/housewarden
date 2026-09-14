/**
 * app/api/mcp/route.ts driven with Request objects — no network. The
 * bearer token comes from the vitest environment (HOUSEWARDEN_TOKEN).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as route from "@/app/api/mcp/route";
import { JSONRPC_ERROR_FORBIDDEN_ORIGIN, JSONRPC_ERROR_UNAUTHORIZED, MCP_SERVER_INFO, TOOL_NAMES } from "@/lib/contracts";
import { get, openSeededDb, type SeededDb } from "./helpers";

const ENDPOINT = "http://127.0.0.1:3123/api/mcp";
const TOKEN = process.env.HOUSEWARDEN_TOKEN ?? "";

interface RpcOptions {
  token?: string;
  origin?: string;
  headers?: Record<string, string>;
  method?: "POST" | "DELETE";
}

async function rpc(body: Record<string, unknown> | null, opts: RpcOptions = {}) {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    ...(body ? { "content-type": "application/json" } : {}),
    ...(opts.token !== undefined ? { authorization: `Bearer ${opts.token}` } : {}),
    ...(opts.origin ? { origin: opts.origin } : {}),
    ...(opts.headers ?? {}),
  };
  const request = new Request(ENDPOINT, {
    method: opts.method ?? "POST",
    headers,
    body: body ? JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }) : undefined,
  });
  const res = opts.method === "DELETE" ? await route.DELETE(request) : await route.POST(request);
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  let json: unknown = null;
  if (contentType.includes("text/event-stream")) {
    const data = text.split("\n").find((line) => line.startsWith("data:"));
    if (data) json = JSON.parse(data.slice(5).trim());
  } else {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, headers: res.headers, json, text };
}

const initialize = {
  method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "route-test", version: "0.0.0" } },
};

describe("POST /api/mcp", () => {
  let seeded: SeededDb;
  beforeAll(async () => {
    seeded = await openSeededDb();
  });
  afterAll(async () => {
    await seeded.close();
  });

  it("does not export GET (Next answers 405; the UI lives at /api/mcp/ui)", () => {
    expect("GET" in route).toBe(false);
    expect(typeof route.POST).toBe("function");
    expect(typeof route.DELETE).toBe("function");
    expect(route.runtime).toBe("nodejs");
  });

  it("initialize with the 2025-11-25 handshake: server name, tools capability, instructions", async () => {
    const res = await rpc(initialize, { token: TOKEN });
    expect(res.status).toBe(200);
    expect(get(res.json, "result.serverInfo.name")).toBe(MCP_SERVER_INFO.name);
    expect(get(res.json, "result.serverInfo.version")).toMatch(/^\d+\.\d+\.\d+/);
    expect(get(res.json, "result.capabilities.tools")).toBeDefined();
    expect(String(get(res.json, "result.instructions"))).toContain("confirm_action");
  });

  it("tools/list: 31 tools with readOnlyHint on the reads", async () => {
    const res = await rpc({ method: "tools/list", params: {} }, { token: TOKEN });
    expect(res.status).toBe(200);
    const tools = get(res.json, "result.tools") as { name: string; annotations?: { readOnlyHint?: boolean } }[];
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools.find((t) => t.name === "list_members")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "add_bill")?.annotations?.readOnlyHint).toBe(false);
  });

  it("tools/call runs a read through runTool", async () => {
    const res = await rpc({ method: "tools/call", params: { name: "get_household_summary", arguments: {} } }, { token: TOKEN });
    expect(res.status).toBe(200);
    expect(get(res.json, "result.structuredContent.household.name")).toBe("Ali family");
    expect(String(get(res.json, "result.content.0.text"))).toContain("overdue");
  });

  it("missing bearer → 401 with WWW-Authenticate; wrong bearer → 401", async () => {
    const missing = await rpc(initialize);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toMatch(/^Bearer realm="housewarden"/);
    expect(get(missing.json, "error.code")).toBe(JSONRPC_ERROR_UNAUTHORIZED);
    const wrong = await rpc(initialize, { token: `${TOKEN}-wrong` });
    expect(wrong.status).toBe(401);
  });

  it("Origin present and unlisted → 403, before the protocol layer", async () => {
    const res = await rpc(initialize, { token: TOKEN, origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(get(res.json, "error.code")).toBe(JSONRPC_ERROR_FORBIDDEN_ORIGIN);
  });

  it("DELETE is guarded, then answered 405 by stateless serving", async () => {
    expect((await rpc(null, { method: "DELETE" })).status).toBe(401);
    expect((await rpc(null, { method: "DELETE", token: TOKEN })).status).toBe(405);
  });

  it("unsupported MCP-Protocol-Version → 400", async () => {
    const res = await rpc({ method: "tools/list", params: {} }, { token: TOKEN, headers: { "mcp-protocol-version": "1999-01-01" } });
    expect(res.status).toBe(400);
  });
});
