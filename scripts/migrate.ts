/**
 * npm run migrate — apply pending SQL migrations and print what is applied.
 *
 * lib/db's getDb() applies db/migrations/*.sql idempotently on first use
 * (schema_migrations records each file), so this script opens the configured
 * database, lets that happen, then lists the table and flags any file on disk
 * that is still missing from it.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { describeStorage, loadDotEnvLocal } from "./_env";

interface MigrationRow extends Record<string, unknown> {
  version: number;
  name: string;
  applied_at: Date;
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const storage = describeStorage();
  console.log(`Housewarden migrate — ${storage.label}`);

  const { getDb, closeDb } = await import("@/lib/db");
  const db = await getDb();
  try {
    const { rows } = await db.query<MigrationRow>(
      "SELECT version, name, applied_at FROM schema_migrations ORDER BY version",
    );
    const onDisk = readdirSync(path.join(process.cwd(), "db", "migrations"))
      .filter((f) => /^\d{4}_.+\.sql$/.test(f))
      .sort();
    const applied = new Set(rows.map((r) => r.version));

    console.log(`Applied migrations (${rows.length}):`);
    for (const row of rows) {
      const at = row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at);
      console.log(`  ${String(row.version).padStart(4, "0")}  ${row.name.padEnd(24)}  ${at}`);
    }
    const missing = onDisk.filter((f) => !applied.has(Number(f.slice(0, 4))));
    if (missing.length > 0) {
      console.error(`Not recorded in schema_migrations: ${missing.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log("Schema is up to date.");
    }
  } finally {
    await closeDb();
  }
}

main().catch((err: unknown) => {
  console.error(`migrate failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
