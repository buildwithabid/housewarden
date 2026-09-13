import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WASM Postgres and resolves its own assets at runtime; it must
  // be required natively on the server, not bundled. `pg` is already on Next's
  // built-in external list.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
