import type { Db, Queryable } from "@/lib/contracts";

/** A transaction handle that can also run multi-statement SQL (migrations). */
export interface TxQueryable extends Queryable {
  exec(sql: string): Promise<void>;
}

/**
 * The Db every core module receives. It narrows `transaction` so the callback
 * gets a TxQueryable; consumers that only know `Db` see the contract shape.
 */
export interface CoreDb extends Db {
  transaction<T>(fn: (tx: TxQueryable) => Promise<T>): Promise<T>;
}

/** Driver-neutral parameter normalisation: undefined → null, Date → ISO, objects/arrays → JSON text. */
export function normaliseParams(params: readonly unknown[] | undefined): unknown[] {
  if (!params) return [];
  return params.map((p) => {
    if (p === undefined) return null;
    if (p instanceof Date) return p.toISOString();
    if (p !== null && typeof p === "object") return JSON.stringify(p);
    return p;
  });
}
