import { describe, expect, it } from "vitest";
import { JSONRPC_ERROR_FORBIDDEN_ORIGIN, JSONRPC_ERROR_NOT_CONFIGURED, JSONRPC_ERROR_UNAUTHORIZED } from "@/lib/contracts";
import { bearerMatches, extractBearer, isTokenConfigured, readAuthConfig, withHousewardenAuth, type AuthConfig } from "@/lib/mcp/auth";
import { isOriginAllowed, normaliseOrigin } from "@/lib/mcp/origin";

const TOKEN = "hw_test_token_0123456789abcdef";
const ENDPOINT = "http://127.0.0.1:3123/api/mcp";

function guard(config: Partial<AuthConfig> = {}) {
  let calls = 0;
  const handler = withHousewardenAuth(
    async () => {
      calls += 1;
      return new Response("ok", { status: 200 });
    },
    () => ({ token: TOKEN, allowedOrigins: [], ...config }),
  );
  return { handler, calls: () => calls };
}

function request(headers: Record<string, string> = {}, method = "POST"): Request {
  return new Request(ENDPOINT, { method, headers, body: method === "POST" ? "{}" : undefined });
}

async function body(res: Response): Promise<{ code: number; message: string }> {
  const json = (await res.json()) as { jsonrpc: string; id: null; error: { code: number; message: string } };
  expect(json.jsonrpc).toBe("2.0");
  expect(json.id).toBeNull();
  return json.error;
}

describe("withHousewardenAuth", () => {
  it("answers 503 and never runs the handler when the token is unset, empty or too short", async () => {
    for (const token of [null, "", "   ", "short-token"]) {
      const g = guard({ token });
      const res = await g.handler(request({ authorization: `Bearer ${TOKEN}` }));
      expect(res.status, String(token)).toBe(503);
      expect((await body(res)).code).toBe(JSONRPC_ERROR_NOT_CONFIGURED);
      expect(g.calls()).toBe(0);
    }
    expect(isTokenConfigured("0123456789abcdef")).toBe(true);
    expect(isTokenConfigured("0123456789abcde")).toBe(false);
  });

  it("answers 401 with a Bearer challenge when the bearer is missing", async () => {
    const g = guard();
    const res = await g.handler(request());
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer realm="housewarden"');
    expect((await body(res)).code).toBe(JSONRPC_ERROR_UNAUTHORIZED);
    expect(g.calls()).toBe(0);
  });

  it("answers 401 when the bearer is wrong, whatever its length or scheme", async () => {
    const g = guard();
    for (const header of [`Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(0, -1)}`, "Bearer nope", `Basic ${TOKEN}`, TOKEN, `bearer${TOKEN}`]) {
      const res = await g.handler(request({ authorization: header }));
      expect(res.status, header).toBe(401);
      expect(res.headers.get("www-authenticate") ?? "").toMatch(/^Bearer realm="housewarden"/);
    }
    expect(g.calls()).toBe(0);
  });

  it("lets a correct bearer through (case-insensitive scheme) and rejects the wrong one in constant time", async () => {
    const g = guard();
    expect((await g.handler(request({ authorization: `Bearer ${TOKEN}` }))).status).toBe(200);
    expect((await g.handler(request({ authorization: `bearer ${TOKEN}` }))).status).toBe(200);
    expect(g.calls()).toBe(2);
    expect(bearerMatches(TOKEN, TOKEN)).toBe(true);
    expect(bearerMatches("a", TOKEN)).toBe(false);
    expect(bearerMatches(null, TOKEN)).toBe(false);
    expect(extractBearer("Bearer abc")).toBe("abc");
    expect(extractBearer("Token abc")).toBeNull();
    expect(extractBearer(null)).toBeNull();
  });

  it("checks the Origin before the bearer: present and unlisted is 403, absent is allowed", async () => {
    const g = guard({ allowedOrigins: ["http://localhost:3123"] });
    const evil = await g.handler(request({ authorization: `Bearer ${TOKEN}`, origin: "https://evil.example" }));
    expect(evil.status).toBe(403);
    expect((await body(evil)).code).toBe(JSONRPC_ERROR_FORBIDDEN_ORIGIN);
    // Origin is refused even with no bearer, and before the 401.
    expect((await g.handler(request({ origin: "https://evil.example" }))).status).toBe(403);
    expect(g.calls()).toBe(0);
    expect((await g.handler(request({ authorization: `Bearer ${TOKEN}`, origin: "http://localhost:3123" }))).status).toBe(200);
    expect((await g.handler(request({ authorization: `Bearer ${TOKEN}`, origin: "HTTP://LocalHost:3123" }))).status).toBe(200);
    expect((await g.handler(request({ authorization: `Bearer ${TOKEN}` }))).status).toBe(200);
    expect(g.calls()).toBe(3);
  });

  it("with the default empty allow-list every browser origin is refused", async () => {
    const g = guard();
    expect((await g.handler(request({ authorization: `Bearer ${TOKEN}`, origin: "http://localhost:3000" }))).status).toBe(403);
    expect((await g.handler(request({ authorization: `Bearer ${TOKEN}`, origin: "null" }))).status).toBe(403);
  });

  it("applies the same checks to DELETE", async () => {
    const g = guard();
    expect((await g.handler(request({}, "DELETE"))).status).toBe(401);
    expect((await g.handler(request({ authorization: `Bearer ${TOKEN}` }, "DELETE"))).status).toBe(200);
  });

  it("reads the configured token and allow-list from the environment", () => {
    const config = readAuthConfig();
    expect(config.token).toBe(process.env.HOUSEWARDEN_TOKEN);
    expect(Array.isArray(config.allowedOrigins)).toBe(true);
  });
});

describe("origin matching", () => {
  it("compares full origins: scheme and host case-insensitively, port exactly, default ports folded", () => {
    expect(normaliseOrigin("HTTPS://Console.Example.com:443")).toBe("https://console.example.com");
    expect(normaliseOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(normaliseOrigin("not a url")).toBeNull();
    expect(normaliseOrigin("null")).toBeNull();
    const allowed = ["https://console.example.com", "http://localhost:3000"];
    expect(isOriginAllowed(null, allowed)).toBe(true);
    expect(isOriginAllowed("https://console.example.com", allowed)).toBe(true);
    expect(isOriginAllowed("https://console.example.com:443", allowed)).toBe(true);
    expect(isOriginAllowed("https://console.example.com:8443", allowed)).toBe(false);
    expect(isOriginAllowed("http://console.example.com", allowed)).toBe(false);
    expect(isOriginAllowed("http://localhost:3001", allowed)).toBe(false);
    expect(isOriginAllowed("https://evil.example", allowed)).toBe(false);
    expect(isOriginAllowed("https://evil.example", [])).toBe(false);
  });
});
