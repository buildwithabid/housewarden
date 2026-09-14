import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosting: `next build` emits .next/standalone with a minimal server.js
  // and only the node_modules it needs (`node .next/standalone/server.js`);
  // `npm run start` still serves a full checkout, with a note from Next.
  output: "standalone",
  // PGlite ships a WASM Postgres and resolves its own assets at runtime; it must
  // be required natively on the server, not bundled. `pg` is already on Next's
  // built-in external list.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Files read from process.cwd() at runtime, not imported, so the standalone
  // tracer cannot see them: the SQL migrations (every route opens the Db) and
  // the MCP App document (lib/mcpapp/html.ts). Keys are picomatch globs
  // matched with `contains`, so "/api/mcp" covers /api/mcp and /api/mcp/ui.
  outputFileTracingIncludes: {
    "/**": ["./db/migrations/*.sql"],
    "/api/mcp": ["./ui/pending.html"],
  },
};

export default nextConfig;
