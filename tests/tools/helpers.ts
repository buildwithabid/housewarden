/**
 * Test support for the MCP surface: an in-memory PGlite seeded with the demo
 * household and installed as the process singleton (runTool resolves the
 * database through getDb), plus an SDK client wired to a Housewarden server
 * over an in-memory transport — no network, no next dev.
 */
import { InMemoryTransport, McpServer, type RegisteredTool } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { MCP_SERVER_INFO, SEED_ACTOR, type Household } from "@/lib/contracts";
import { createDb, setDb, type CoreDb } from "@/lib/db";
import { SERVER_INSTRUCTIONS } from "@/lib/mcp/instructions";
import { registerTools } from "@/lib/mcp/register";
import { registerMcpApp } from "@/lib/mcpapp/register";
import { seedDemo } from "@/lib/seed";

export interface SeededDb {
  db: CoreDb;
  household: Household;
  close(): Promise<void>;
}

/** A fresh in-memory database seeded with the Ali family and installed as the singleton. */
export async function openSeededDb(now: Date = new Date()): Promise<SeededDb> {
  const db = await createDb({ kind: "pglite", dataDir: "memory://" });
  setDb(db);
  const { household } = await seedDemo(db, SEED_ACTOR, { now, timezone: "Asia/Karachi", currency: "PKR" });
  return {
    db,
    household,
    async close() {
      setDb(null);
      await db.close();
    },
  };
}

export interface ConnectedPair {
  client: Client;
  server: McpServer;
  handles: Map<string, RegisteredTool>;
  close(): Promise<void>;
}

/** The same registration the route performs, on an in-memory transport. */
export async function connectHousewarden(): Promise<ConnectedPair> {
  const server = new McpServer({ name: MCP_SERVER_INFO.name, version: MCP_SERVER_INFO.version }, { instructions: SERVER_INSTRUCTIONS });
  const handles = registerTools(server);
  registerMcpApp(server, handles);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "housewarden-tools-test", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    server,
    handles,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

export interface ToolReply {
  isError: boolean;
  /** content[0].text — the spoken line. */
  text: string;
  data: Record<string, unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolReply> {
  const result = await client.callTool({ name, arguments: args });
  const first = result.content[0];
  const text = first && first.type === "text" ? first.text : "";
  return { isError: result.isError === true, text, data: isRecord(result.structuredContent) ? result.structuredContent : {} };
}

/** Reads a dotted path from structured content; numeric segments index arrays. */
export function get(data: unknown, dotted: string): unknown {
  let cur: unknown = data;
  for (const key of dotted.split(".")) {
    if (Array.isArray(cur) && /^\d+$/.test(key)) cur = cur[Number(key)];
    else if (isRecord(cur)) cur = cur[key];
    else return undefined;
  }
  return cur;
}
