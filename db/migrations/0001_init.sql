-- Housewarden — migration 0001: initial schema.
--
-- Dialect: PostgreSQL (runs unchanged on PGlite 0.5 / Postgres 18 and on node-postgres 8).
-- Idempotent: every statement is CREATE ... IF NOT EXISTS / CREATE OR REPLACE, so
-- re-running it on an already-migrated database is a no-op. The runner still
-- records it in schema_migrations and skips it next time.
--
-- Conventions
--   * ids are uuid v4 generated in-database (gen_random_uuid() is core in PG13+).
--   * money is stored as integer minor units (amount_minor bigint) — never numeric —
--     so both drivers return the same JS type after adapter normalisation.
--   * enumerations are text + CHECK; the allowed values mirror lib/contracts.ts.
--   * timestamps are timestamptz; calendar dates are date.
--   * jsonb columns hold shapes defined in lib/contracts.ts (Actor, Preview, ...).

-- ---------------------------------------------------------------------------
-- schema_migrations: what has been applied. The runner inserts (version, name)
-- after each file succeeds, inside the same transaction as the file.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     integer      PRIMARY KEY,
  name        text         NOT NULL,
  applied_at  timestamptz  NOT NULL DEFAULT now()
);
COMMENT ON TABLE schema_migrations IS 'Applied migration files, keyed by their numeric prefix.';

-- ---------------------------------------------------------------------------
-- household: exactly one row per deployment (singleton enforced by a constant
-- column with a unique index).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS household (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text         NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  currency    text         NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  timezone    text         NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
  singleton   boolean      NOT NULL DEFAULT true CHECK (singleton),
  created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS household_singleton ON household (singleton);
COMMENT ON TABLE household IS 'The one household this deployment serves. Empty table = "load demo data" state.';
COMMENT ON COLUMN household.timezone IS 'IANA zone used to compute "today" for due dates.';

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS members (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid         NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name          text         NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  role          text         NOT NULL CHECK (role IN ('adult', 'child')),
  pin_hash      text         CHECK (pin_hash IS NULL OR pin_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS members_household_name ON members (household_id, lower(name));
COMMENT ON COLUMN members.pin_hash IS 'sha256(hex) of "<member id>:<pin>"; null when the member has no PIN. Never store the PIN.';

-- ---------------------------------------------------------------------------
-- bills
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bills (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid         NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name          text         NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  amount_minor  bigint       NOT NULL CHECK (amount_minor >= 0),
  currency      text         NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  due_date      date         NOT NULL,
  recurrence    text         NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'monthly', 'yearly')),
  status        text         NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'paid', 'overdue')),
  paid_at       timestamptz,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT bills_paid_consistency CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS bills_household_status_due ON bills (household_id, status, due_date);
COMMENT ON COLUMN bills.status IS 'Stored status. Reads report "overdue" for any "due" bill whose due_date is before today in the household timezone.';
COMMENT ON COLUMN bills.amount_minor IS 'Integer minor units (paisa, cents). amount = amount_minor / 100.';

-- ---------------------------------------------------------------------------
-- chores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chores (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        uuid         NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  title               text         NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  assigned_member_id  uuid         REFERENCES members(id) ON DELETE SET NULL,
  cadence             text         NOT NULL DEFAULT 'once' CHECK (cadence IN ('once', 'daily', 'weekly', 'monthly')),
  due_date            date,
  status              text         NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  completed_at        timestamptz,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT chores_done_consistency CHECK ((status = 'done') = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS chores_household_status_due ON chores (household_id, status, due_date);
CREATE INDEX IF NOT EXISTS chores_member ON chores (assigned_member_id);

-- ---------------------------------------------------------------------------
-- shopping_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shopping_items (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid         NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name          text         NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  qty           text         NOT NULL DEFAULT '1' CHECK (length(qty) BETWEEN 1 AND 40),
  category      text         CHECK (category IS NULL OR length(category) BETWEEN 1 AND 60),
  checked       boolean      NOT NULL DEFAULT false,
  checked_at    timestamptz,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT shopping_checked_consistency CHECK (checked = (checked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS shopping_household_checked ON shopping_items (household_id, checked, created_at);
COMMENT ON COLUMN shopping_items.qty IS 'Quantity as spoken: "1", "2 kg", "3 packs". Free text on purpose.';

-- ---------------------------------------------------------------------------
-- reminders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reminders (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid         NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  text          text         NOT NULL CHECK (length(text) BETWEEN 1 AND 300),
  at            timestamptz  NOT NULL,
  member_id     uuid         REFERENCES members(id) ON DELETE SET NULL,
  status        text         NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'cancelled')),
  created_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reminders_household_status_at ON reminders (household_id, status, at);

-- ---------------------------------------------------------------------------
-- budget_entries (expenses recorded by record_expense)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget_entries (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid         NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  amount_minor  bigint       NOT NULL CHECK (amount_minor >= 0),
  currency      text         NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  category      text         NOT NULL CHECK (length(category) BETWEEN 1 AND 60),
  note          text         CHECK (note IS NULL OR length(note) <= 300),
  member_id     uuid         REFERENCES members(id) ON DELETE SET NULL,
  occurred_at   timestamptz  NOT NULL DEFAULT now(),
  created_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS budget_household_occurred ON budget_entries (household_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS budget_household_category ON budget_entries (household_id, category);

-- ---------------------------------------------------------------------------
-- devices (simulated smart home)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid         NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name          text         NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  kind          text         NOT NULL CHECK (kind IN ('lock', 'thermostat', 'light', 'plug')),
  state         jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS devices_household_name ON devices (household_id, lower(name));
COMMENT ON COLUMN devices.state IS 'Per kind: lock {locked}, thermostat {mode, target_c}, light {on, brightness?}, plug {on}. Validated in lib/domain/devices.ts.';

-- ---------------------------------------------------------------------------
-- routines
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routines (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid         NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  name          text         NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  steps         jsonb        NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(steps) = 'array'),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS routines_household_name ON routines (household_id, lower(name));
COMMENT ON COLUMN routines.steps IS 'Array of {tool, input}; tool must be one of ROUTINE_STEP_TOOLS in lib/contracts.ts.';

-- ---------------------------------------------------------------------------
-- policies: risk overrides. scope '' = whole tool; member_id null = everyone.
-- Built-in defaults live in lib/contracts.ts and apply when no row matches.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS policies (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid         NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  tool_name     text         NOT NULL CHECK (length(tool_name) BETWEEN 1 AND 60),
  scope         text         NOT NULL DEFAULT '' CHECK (length(scope) <= 60),
  member_id     uuid         REFERENCES members(id) ON DELETE CASCADE,
  risk          text         NOT NULL CHECK (risk IN ('read', 'low', 'confirm', 'high')),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS policies_unique
  ON policies (household_id, tool_name, scope, COALESCE(member_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------------------
-- pending_actions: one row per guarded proposal, including those executed
-- immediately (status 'executed' from the start) so idempotency keys and the
-- console history have one home.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pending_actions (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     uuid         NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  tool             text         NOT NULL CHECK (length(tool) BETWEEN 1 AND 60),
  input            jsonb        NOT NULL,
  preview          jsonb        NOT NULL,
  risk             text         NOT NULL CHECK (risk IN ('read', 'low', 'confirm', 'high')),
  status           text         NOT NULL CHECK (status IN ('pending', 'confirmed', 'executed', 'rejected', 'expired', 'failed')),
  created_by       jsonb        NOT NULL,
  member_id        uuid         REFERENCES members(id) ON DELETE SET NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  expires_at       timestamptz  NOT NULL,
  decided_by       jsonb,
  decided_at       timestamptz,
  executed_at      timestamptz,
  result           jsonb,
  error            jsonb,
  idempotency_key  text         CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200)
);
CREATE INDEX IF NOT EXISTS pending_actions_status_expires ON pending_actions (household_id, status, expires_at);
CREATE INDEX IF NOT EXISTS pending_actions_created ON pending_actions (household_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS pending_actions_idempotency
  ON pending_actions (household_id, tool, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON COLUMN pending_actions.created_by IS 'Actor json (lib/contracts.ts ActorSchema).';
COMMENT ON COLUMN pending_actions.preview IS 'Preview json computed at proposal time; re-planned and compared at confirm time.';

-- ---------------------------------------------------------------------------
-- audit_log: append-only, hash-chained.
--   hash = sha256(prev_hash || canonicalJson({seq, at, actor, event, tool, action_id, input, result, prev_hash}))
--   row 1 has prev_hash = 64 zeros. seq is assigned by the appender under
--   pg_advisory_xact_lock(7743) so the chain has no gaps.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  seq         bigint       PRIMARY KEY CHECK (seq >= 1),
  at          timestamptz  NOT NULL,
  actor       jsonb        NOT NULL,
  event       text         NOT NULL CHECK (event IN ('proposed', 'executed', 'rejected', 'expired', 'failed', 'seeded')),
  tool        text         NOT NULL CHECK (length(tool) BETWEEN 1 AND 60),
  action_id   uuid,
  input       jsonb        NOT NULL,
  result      jsonb,
  prev_hash   text         NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  hash        text         NOT NULL UNIQUE CHECK (hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS audit_log_action ON audit_log (action_id);
CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log (at DESC);
COMMENT ON TABLE audit_log IS 'Append-only. UPDATE and DELETE are refused by trigger; verify_audit_chain() recomputes every hash.';

CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- ---------------------------------------------------------------------------
-- updated_at maintenance for the mutable tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS bills_touch ON bills;
CREATE TRIGGER bills_touch BEFORE UPDATE ON bills FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS chores_touch ON chores;
CREATE TRIGGER chores_touch BEFORE UPDATE ON chores FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS devices_touch ON devices;
CREATE TRIGGER devices_touch BEFORE UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS routines_touch ON routines;
CREATE TRIGGER routines_touch BEFORE UPDATE ON routines FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS policies_touch ON policies;
CREATE TRIGGER policies_touch BEFORE UPDATE ON policies FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
