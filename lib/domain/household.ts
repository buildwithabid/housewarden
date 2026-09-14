import { HousewardenError, type Household, type Queryable } from "@/lib/contracts";

interface HouseholdRow extends Record<string, unknown> {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  created_at: Date;
}

function rowToHousehold(row: HouseholdRow): Household {
  return { id: row.id, name: row.name, currency: row.currency, timezone: row.timezone, created_at: row.created_at.toISOString() };
}

/** The one household, or null before the seed / first setup. */
export async function getHousehold(db: Queryable): Promise<Household | null> {
  const res = await db.query<HouseholdRow>("SELECT id, name, currency, timezone, created_at FROM household LIMIT 1");
  return res.rows[0] ? rowToHousehold(res.rows[0]) : null;
}

export async function requireHousehold(db: Queryable): Promise<Household> {
  const household = await getHousehold(db);
  if (!household) {
    throw new HousewardenError("HOUSEHOLD_EMPTY", "No household is set up yet. Load the demo data or run the seed first.");
  }
  return household;
}

export interface NewHousehold {
  name: string;
  currency: string;
  timezone: string;
}

export async function createHousehold(tx: Queryable, input: NewHousehold): Promise<Household> {
  const res = await tx.query<HouseholdRow>(
    "INSERT INTO household (name, currency, timezone) VALUES ($1, $2, $3) RETURNING id, name, currency, timezone, created_at",
    [input.name, input.currency, input.timezone],
  );
  return rowToHousehold(res.rows[0]);
}
