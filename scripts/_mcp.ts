/**
 * Thin wrapper around @modelcontextprotocol/client for the demo walkthrough
 * and the e2e harness: connect to a Housewarden endpoint over Streamable HTTP
 * with a bearer token, call a tool, and hand back the spoken line plus the
 * structured content.
 */
import { Client, StreamableHTTPClientTransport, type VersionNegotiationMode } from "@modelcontextprotocol/client";
import { MCP_SERVER_INFO } from "@/lib/contracts";

export interface ConnectOptions {
  /** Full endpoint URL, e.g. http://localhost:3000/api/mcp */
  url: string;
  token: string;
  /** "legacy" = plain 2025-11-25 handshake (default); "auto" = probe for 2026-07-28. */
  mode?: VersionNegotiationMode;
  clientName?: string;
}

export interface ToolReply {
  name: string;
  isError: boolean;
  /** content[0].text — the line a voice assistant would read aloud. */
  text: string;
  /** structuredContent when it is an object, else {}. */
  data: Record<string, unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function connectHousewarden(opts: ConnectOptions): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(opts.url), {
    authProvider: { token: async () => opts.token },
  });
  const client = new Client(
    { name: opts.clientName ?? "housewarden-client", version: MCP_SERVER_INFO.version },
    { versionNegotiation: { mode: opts.mode ?? "legacy" } },
  );
  await client.connect(transport);
  return client;
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolReply> {
  const result = await client.callTool({ name, arguments: args });
  let text = "";
  for (const block of result.content) {
    if (block.type === "text") {
      text = block.text;
      break;
    }
  }
  const data = isRecord(result.structuredContent) ? result.structuredContent : {};
  return { name, isError: result.isError === true, text, data };
}

/** Reads a dotted path from a reply's structured content: get(data, "counts.bills_overdue"). */
export function get(data: unknown, dotted: string): unknown {
  let cur: unknown = data;
  for (const key of dotted.split(".")) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Formats a tool error envelope ({ error: { code, message } }) for humans. */
export function describeError(data: Record<string, unknown>, fallback: string): string {
  const err = get(data, "error");
  if (isRecord(err) && typeof err.code === "string" && typeof err.message === "string") {
    return `${err.code}: ${err.message}`;
  }
  return fallback;
}
