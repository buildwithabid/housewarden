import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The MCP App document served as `ui://housewarden/pending` and, for browser
 * preview, as `GET /api/mcp/ui`. It is one self-contained HTML file with
 * inlined CSS and JS and no external assets (the host's default CSP is
 * `connect-src 'none'`, so it could not load any).
 *
 * The file is read once per process and cached. mcp-handler builds a fresh
 * McpServer per request, so `registerMcpApp` runs per request and must not
 * touch the disk each time.
 */
export const MCP_APP_HTML_PATH = join(process.cwd(), "ui", "pending.html");

let cached: string | undefined;

export function pendingAppHtml(): string {
  if (cached === undefined) cached = readFileSync(MCP_APP_HTML_PATH, "utf8");
  return cached;
}
