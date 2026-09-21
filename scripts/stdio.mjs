#!/usr/bin/env node
// Stdio entry point for Housewarden.
//
// Housewarden serves MCP over Streamable HTTP (app/api/mcp). Hosts and directories that can
// only launch a stdio server (Claude Desktop, Glama's build check, `mcp-proxy`) use this file:
// it starts the production server on a loopback port, waits until the endpoint answers, and
// then bridges stdio <-> HTTP with `mcp-remote`.
//
//   npm run build && node scripts/stdio.mjs
//
// stdout carries JSON-RPC only. Everything the server prints goes to stderr, because a single
// stray line on stdout breaks a stdio client.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.HOUSEWARDEN_STDIO_PORT || "3187";
const url = `http://127.0.0.1:${port}/api/mcp`;

// No configuration needed for stdio use: both secrets are generated when absent, and the
// token never leaves this process tree.
const env = {
  ...process.env,
  HOUSEWARDEN_TOKEN: process.env.HOUSEWARDEN_TOKEN || `hw_${randomBytes(24).toString("hex")}`,
  HOUSEWARDEN_ADMIN_SECRET: process.env.HOUSEWARDEN_ADMIN_SECRET || randomBytes(18).toString("hex"),
  HOUSEWARDEN_DATA_DIR: process.env.HOUSEWARDEN_DATA_DIR || path.join(root, ".data", "pglite"),
  PORT: port,
  HOSTNAME: "127.0.0.1",
};

const log = (msg) => process.stderr.write(`[housewarden-stdio] ${msg}\n`);

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next", { paths: [root] });
const server = spawn(process.execPath, [nextBin, "start", "-p", port, "-H", "127.0.0.1"], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.pipe(process.stderr);
server.stderr.pipe(process.stderr);

let bridge;
const stop = (code) => {
  bridge?.kill();
  server.kill();
  process.exit(code);
};
server.on("exit", (code) => {
  log(`server exited (${code})`);
  stop(code ?? 1);
});
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

async function waitUntilUp(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // GET answers 405 by design (stateless serving); any HTTP answer means the route is live.
      const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(2_000) });
      if (res.status > 0) return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`the server did not answer on ${url} within ${timeoutMs / 1000}s`);
}

try {
  await waitUntilUp();
} catch (err) {
  log(String(err.message || err));
  stop(1);
}
log(`server is up on ${url}; bridging stdio`);

// `mcp-remote` is the bridge. Use an installed binary when there is one (a build step can
// `npm install -g mcp-remote`), otherwise fetch it with npx.
const header = `Authorization: Bearer ${env.HOUSEWARDEN_TOKEN}`;
const bridgeArgs = [url, "--allow-http", "--transport", "http-only", "--header", header];
const useNpx = process.env.HOUSEWARDEN_STDIO_NPX === "1";
bridge = useNpx
  ? spawn("npx", ["-y", "mcp-remote", ...bridgeArgs], { env, stdio: ["inherit", "inherit", "inherit"] })
  : spawn("mcp-remote", bridgeArgs, { env, stdio: ["inherit", "inherit", "inherit"] });
bridge.on("error", (err) => {
  log(`could not start mcp-remote (${err.message}); install it with "npm install -g mcp-remote" or set HOUSEWARDEN_STDIO_NPX=1`);
  stop(1);
});
bridge.on("exit", (code) => stop(code ?? 0));
