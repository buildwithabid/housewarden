/**
 * npm run seed — load the demo household ("Ali family").
 *
 * Refuses when a household already exists. `--force` drops the PGlite data
 * directory and seeds again (PGlite only: on Postgres, reset the database
 * yourself).
 */
import { rmSync } from "node:fs";
import { DEFAULTS, HousewardenError, SEED_ACTOR } from "@/lib/contracts";
import { describeStorage, loadDotEnvLocal } from "./_env";

function formatCounts(result: unknown): string[] {
  if (typeof result !== "object" || result === null) return [];
  const counts = (result as { counts?: unknown }).counts;
  if (typeof counts !== "object" || counts === null) return [];
  return Object.entries(counts as Record<string, unknown>).map(([k, v]) => `  ${k.padEnd(16)} ${String(v)}`);
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const force = process.argv.includes("--force");
  const storage = describeStorage();
  console.log(`Housewarden seed — ${storage.label}`);

  const { getDb, closeDb } = await import("@/lib/db");
  const { seedDemo } = await import("@/lib/seed");

  let db = await getDb();
  const existing = await db.query("SELECT name FROM household LIMIT 1");
  if (existing.rowCount > 0) {
    const name = String(existing.rows[0].name);
    if (!force) {
      await closeDb();
      console.error(`A household already exists ("${name}"). Nothing changed.`);
      console.error("Run `npm run seed -- --force` to wipe the PGlite data directory and seed again.");
      process.exit(1);
    }
    if (storage.kind !== "pglite" || !storage.dataDir || storage.dataDir === DEFAULTS.DATA_DIR_MEMORY) {
      await closeDb();
      console.error("--force only works with the PGlite adapter on a data directory.");
      process.exit(1);
    }
    await closeDb();
    rmSync(storage.dataDir, { recursive: true, force: true });
    console.log(`Removed ${storage.dataDir}`);
    db = await getDb();
  }

  try {
    const result: unknown = await seedDemo(db, SEED_ACTOR);
    console.log("Loaded the demo household:");
    const lines = formatCounts(result);
    if (lines.length > 0) console.log(lines.join("\n"));
    console.log("Open the console and sign in with HOUSEWARDEN_ADMIN_SECRET from .env.local.");
  } catch (err) {
    if (err instanceof HousewardenError) {
      console.error(`${err.code}: ${err.message}`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    await closeDb();
  }
}

main().catch((err: unknown) => {
  console.error(`seed failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
