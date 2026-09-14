import { pendingAppHtml } from "@/lib/mcpapp/html";
import { isMcpAppEnabled } from "@/lib/mcpapp/register";

/**
 * Browser preview of the MCP App (docs/SPEC.md §11.3): the same HTML a host
 * receives from `resources/read ui://housewarden/pending`, served as a page.
 * No auth because it contains no data; outside a host it shows an explanatory
 * notice, and `?demo` renders the cards with sample data. 404 when the flag
 * is off.
 *
 * The CSP mirrors the default an MCP Apps host applies when the resource
 * declares no domains, so the preview behaves like the real sandbox.
 */
const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function GET(): Response {
  if (!isMcpAppEnabled()) {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(pendingAppHtml(), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": PREVIEW_CSP,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
