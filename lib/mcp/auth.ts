/**
 * The HTTP guard in front of the MCP handler (docs/SPEC.md §8):
 *
 *   1. HOUSEWARDEN_TOKEN unset, empty or shorter than 16 chars → 503 (never fall open)
 *   2. Origin present and not allow-listed → 403 (absent Origin is allowed)
 *   3. Authorization: Bearer <token> missing or wrong → 401 + WWW-Authenticate
 *
 * The bearer is compared with timingSafeEqual over SHA-256 digests, which
 * gives equal-length buffers without leaking the token length. Nothing here
 * logs; the token never leaves this module.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import {
  BEARER_REALM,
  JSONRPC_ERROR_FORBIDDEN_ORIGIN,
  JSONRPC_ERROR_NOT_CONFIGURED,
  JSONRPC_ERROR_UNAUTHORIZED,
} from "@/lib/contracts";
import { env } from "@/lib/env";
import { isOriginAllowed } from "./origin";

export const MIN_TOKEN_LENGTH = 16;

export interface AuthConfig {
  /** The expected bearer token; null or too short means "not configured". */
  token: string | null;
  allowedOrigins: readonly string[];
}

export type AuthConfigSource = () => AuthConfig;

/** Reads the environment on every request; a broken environment counts as not configured rather than throwing. */
export function readAuthConfig(): AuthConfig {
  try {
    const e = env();
    return { token: e.token, allowedOrigins: e.allowedOrigins };
  } catch {
    return { token: null, allowedOrigins: [] };
  }
}

export function isTokenConfigured(token: string | null | undefined): token is string {
  return typeof token === "string" && token.trim().length >= MIN_TOKEN_LENGTH;
}

/** The token from an Authorization header, or null when it is not a bearer credential. */
export function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time comparison of a presented bearer with the expected token. */
export function bearerMatches(presented: string | null, expected: string): boolean {
  if (presented === null) return false;
  return timingSafeEqual(digest(presented), digest(expected));
}

export function jsonRpcErrorResponse(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

export const NOT_CONFIGURED_MESSAGE = "Server not configured: set HOUSEWARDEN_TOKEN";
export const FORBIDDEN_ORIGIN_MESSAGE = "Origin not allowed";
export const UNAUTHORIZED_MESSAGE = "Unauthorized";

/** Wraps a web-standard handler with the configuration, Origin and bearer checks, in that order. */
export function withHousewardenAuth(
  handler: (request: Request) => Promise<Response> | Response,
  config: AuthConfigSource = readAuthConfig,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const { token, allowedOrigins } = config();
    if (!isTokenConfigured(token)) {
      return jsonRpcErrorResponse(503, JSONRPC_ERROR_NOT_CONFIGURED, NOT_CONFIGURED_MESSAGE);
    }
    if (!isOriginAllowed(request.headers.get("origin"), allowedOrigins)) {
      return jsonRpcErrorResponse(403, JSONRPC_ERROR_FORBIDDEN_ORIGIN, FORBIDDEN_ORIGIN_MESSAGE);
    }
    const presented = extractBearer(request.headers.get("authorization"));
    if (!bearerMatches(presented, token.trim())) {
      const challenge = presented === null ? `Bearer realm="${BEARER_REALM}"` : `Bearer realm="${BEARER_REALM}", error="invalid_token"`;
      return jsonRpcErrorResponse(401, JSONRPC_ERROR_UNAUTHORIZED, UNAUTHORIZED_MESSAGE, { "www-authenticate": challenge });
    }
    return handler(request);
  };
}
