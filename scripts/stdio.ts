/**
 * Stdio entry point: `npm run stdio` (= `tsx scripts/stdio.ts`).
 *
 * Housewarden's main transport is Streamable HTTP (app/api/mcp). Hosts and
 * directories that can only launch a stdio server (Claude Desktop, mcp-proxy,
 * Glama's build check) use this file instead. It serves the SAME server: the
 * same 31 tools from lib/tools/registry.ts, the same guard, the same audit
 * chain, the same instructions. There is no HTTP hop and no bearer token,
 * because the client is the process that started us.
 *
 * stdout carries JSON-RPC only; anything else goes to stderr.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { MCP_SERVER_INFO } from "@/lib/contracts";
import { SERVER_INSTRUCTIONS } from "@/lib/mcp/instructions";
import { registerTools } from "@/lib/mcp/register";
import { registerMcpApp } from "@/lib/mcpapp/register";
import pkg from "@/package.json";

// A stray console.log from any dependency would corrupt the protocol stream.
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);

serveStdio(
  () => {
    const server = new McpServer(
      { name: MCP_SERVER_INFO.name, version: pkg.version },
      { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
    );
    registerMcpApp(server, registerTools(server));
    return server;
  },
  { onerror: (error) => console.error(`[housewarden-stdio] ${error.message}`) },
);
