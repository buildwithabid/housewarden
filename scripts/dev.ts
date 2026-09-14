/**
 * npm run dev — zero-setup development server.
 *
 * 1. Makes sure .env.local has HOUSEWARDEN_TOKEN and HOUSEWARDEN_ADMIN_SECRET
 *    (generates them once and prints them).
 * 2. Opens the database (PGlite by default), which applies migrations.
 * 3. If the household is empty, offers to load the demo family.
 * 4. Closes the database (PGlite allows one connection) and starts `next dev`,
 *    passing through any extra arguments such as `-p 4000`.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { DEFAULTS, MCP_ENDPOINT_PATH, SEED_ACTOR } from "@/lib/contracts";
import { box, describeStorage, ensureSecrets, loadDotEnvLocal } from "./_env";

function portFromArgs(args: string[]): number {
  for (let i = 0; i < args.length; i += 1) {
    if ((args[i] === "-p" || args[i] === "--port") && args[i + 1]) return Number(args[i + 1]);
    const inline = /^--port=(\d+)$/.exec(args[i]);
    if (inline) return Number(inline[1]);
  }
  return Number(process.env.PORT) || 3000;
}

async function askYes(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function prepareDatabase(): Promise<void> {
  const storage = describeStorage();
  if (storage.kind === "pglite" && storage.dataDir && storage.dataDir !== DEFAULTS.DATA_DIR_MEMORY) {
    mkdirSync(storage.dataDir, { recursive: true });
  }
  const { getDb, closeDb } = await import("@/lib/db");
  const db = await getDb();
  try {
    const existing = await db.query("SELECT name FROM household LIMIT 1");
    if (existing.rowCount > 0) {
      console.log(`Household: ${String(existing.rows[0].name)} (${storage.label})`);
      return;
    }
    console.log(`Database ready (${storage.label}). No household yet.`);
    if (await askYes("Load the demo household (Ali family)? (Y/n) ")) {
      const { seedDemo } = await import("@/lib/seed");
      await seedDemo(db, SEED_ACTOR);
      console.log("Loaded the Ali family: 4 members, 5 bills, chores, shopping, two devices, one routine.");
    } else {
      console.log("Skipped. Use the console's \"Load demo data\" button or `npm run seed` later.");
    }
  } finally {
    await closeDb();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  loadDotEnvLocal();
  const generated = ensureSecrets();
  const port = portFromArgs(args);
  const origin = `http://localhost:${port}`;

  if (generated.length > 0) {
    console.log(
      box("Housewarden — first start: secrets written to .env.local", [
        ...generated.map((g) => `${g.key}=${g.value}`),
        "",
        `Console login:  ${origin}/login  (use HOUSEWARDEN_ADMIN_SECRET)`,
        `MCP endpoint:   ${origin}${MCP_ENDPOINT_PATH}  (Authorization: Bearer <HOUSEWARDEN_TOKEN>)`,
        "Shown once. Rotate by editing .env.local and restarting.",
      ]),
    );
  } else {
    console.log(`Console ${origin}/login · MCP endpoint ${origin}${MCP_ENDPOINT_PATH} (token in .env.local)`);
  }

  await prepareDatabase();

  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", ...args], { stdio: "inherit", env: process.env });
  const forward = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  child.on("exit", (code, signal) => {
    // Exit with the child's status. Re-raising the signal on ourselves would be
    // swallowed by the forwarding handlers above and leave this process hanging.
    process.exit(signal ? 128 + (os.constants.signals[signal] ?? 0) : (code ?? 0));
  });
}

main().catch((err: unknown) => {
  console.error(`dev failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
