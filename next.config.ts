import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosting: `next build` emits .next/standalone with a minimal server.js
  // and only the node_modules it needs; `npm run start` still works unchanged.
  output: "standalone",
  // PGlite ships a WASM Postgres and resolves its own assets at runtime; it must
  // be required natively on the server, not bundled. `pg` is already on Next's
  // built-in external list.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
