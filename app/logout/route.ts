/**
 * /logout (docs/SPEC.md §8): clears the console session cookie and sends the
 * browser to /login. The sidebar's Sign out button posts a server action that
 * does the same; this route exists so a plain link or a client without the
 * action id can sign out too.
 */
import { NextResponse } from "next/server";
import { CONSOLE_SESSION_COOKIE } from "@/lib/contracts";
import { env } from "@/lib/env";

function signOut(request: Request): NextResponse {
  const res = NextResponse.redirect(new URL("/login", request.url), 303);
  res.cookies.set(CONSOLE_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: env().cookieSecure,
    maxAge: 0,
  });
  return res;
}

export function POST(request: Request): NextResponse {
  return signOut(request);
}

export function GET(request: Request): NextResponse {
  return signOut(request);
}
