/**
 * The MCP endpoint (docs/SPEC.md §8 and §11): Streamable HTTP, spec
 * 2025-11-25 via the SDK's stateless fallback and 2026-07-28 natively, both
 * from mcp-handler. Every request passes the configuration, Origin and
 * bearer checks in lib/mcp/auth.ts before it reaches the protocol layer.
 *
 * No GET is exported: serving is stateless, so Next answers 405 (the SDK
 * would answer the same). The MCP App preview lives at /api/mcp/ui.
 */
import { createMcpHandler } from "mcp-handler";
import { MCP_SERVER_INFO } from "@/lib/contracts";
import { withHousewardenAuth } from "@/lib/mcp/auth";
import { SERVER_INSTRUCTIONS } from "@/lib/mcp/instructions";
import { registerTools } from "@/lib/mcp/register";
import { registerMcpApp } from "@/lib/mcpapp/register";
import pkg from "@/package.json";

export const runtime = "nodejs";

const mcp = createMcpHandler(
  (server) => {
    registerMcpApp(server, registerTools(server));
  },
  {
    serverInfo: { name: MCP_SERVER_INFO.name, version: pkg.version },
    instructions: SERVER_INSTRUCTIONS,
    capabilities: { tools: {} },
  },
);

const guarded = withHousewardenAuth(mcp);

export async function POST(request: Request): Promise<Response> {
  return guarded(request);
}

/** 2025-era session teardown; stateless serving answers 405 after the auth checks. */
export async function DELETE(request: Request): Promise<Response> {
  return guarded(request);
}
