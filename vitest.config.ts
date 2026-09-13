import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit and integration tests run against an in-memory PGlite (HOUSEWARDEN_DATA_DIR=memory://).
// The e2e harness (npm run e2e) is a separate tsx script, not a vitest suite.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      HOUSEWARDEN_DB: "pglite",
      HOUSEWARDEN_DATA_DIR: "memory://",
      HOUSEWARDEN_TOKEN: "test-token-not-secret",
      HOUSEWARDEN_ADMIN_SECRET: "test-admin-secret-not-secret",
      HOUSEWARDEN_CONFIRM_TTL_SECONDS: "600",
    },
  },
});
