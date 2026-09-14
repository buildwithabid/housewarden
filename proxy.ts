/**
 * First line of console protection: any request for a console route (and any
 * server-action POST to one) without a valid session cookie is sent to
 * /login, remembering where it was going. Pages and actions repeat the check
 * themselves (lib/console/session.ts); this only makes the redirect cheap and
 * early. The MCP endpoint under /api is not a console route and is guarded by
 * its own bearer check.
 */
import { NextResponse, type NextRequest } from "next/server";
import { CONSOLE_SESSION_COOKIE } from "@/lib/contracts";
import { env } from "@/lib/env";
import { cookieMatchesSecret } from "@/lib/console/session-core";
import { safeNext } from "@/lib/console/url";

export function proxy(request: NextRequest) {
  const cookie = request.cookies.get(CONSOLE_SESSION_COOKIE)?.value;
  if (cookieMatchesSecret(cookie, env().adminSecret)) return NextResponse.next();

  const login = new URL("/login", request.url);
  const next = safeNext(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (next !== "/") login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the MCP API, Next internals, the login/logout routes and static files.
  matcher: ["/((?!api|_next|login|logout|icon\\.svg|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
