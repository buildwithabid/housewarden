/**
 * The MCP endpoint URL shown on /settings: HOUSEWARDEN_PUBLIC_URL when set,
 * otherwise derived from the request (behind a proxy, from x-forwarded-*).
 */
import { headers } from "next/headers";
import { MCP_ENDPOINT_PATH } from "@/lib/contracts";
import { env } from "@/lib/env";

export async function consoleOrigin(): Promise<string> {
  const configured = env().publicUrl;
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

export async function mcpEndpointUrl(): Promise<string> {
  return `${await consoleOrigin()}${MCP_ENDPOINT_PATH}`;
}
