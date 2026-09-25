-- Both 25 Sep migrations in one paste. Safe to re-run.
-- Source: 2026-09-25_add_duty_settings.sql + 2026-09-25_add_duty_pairings.sql


CREATE TABLE IF NOT EXISTS roster_duty_settings (
  role_id      TEXT NOT NULL,
  service_type TEXT NOT NULL DEFAULT 'all',
  people       JSONB,
  monthly_cap  INTEGER,
  applies      BOOLEAN,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  updated_by   TEXT,
  PRIMARY KEY (role_id, service_type)
);

ALTER TABLE roster_duty_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roster_duty_settings_all ON roster_duty_settings;
CREATE POLICY roster_duty_settings_all ON roster_duty_settings
  FOR ALL USING (true) WITH CHECK (true);


CREATE TABLE IF NOT EXISTS roster_duty_pairings (
  id           BIGSERIAL PRIMARY KEY,
  when_role    TEXT NOT NULL,
  when_person  TEXT NOT NULL,
  service_type TEXT NOT NULL DEFAULT 'all',
  then_role    TEXT NOT NULL,
  then_people  JSONB NOT NULL,
  strict       BOOLEAN NOT NULL DEFAULT false,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  updated_by   TEXT
);

CREATE INDEX IF NOT EXISTS roster_duty_pairings_then_idx
  ON roster_duty_pairings (then_role, service_type);

CREATE UNIQUE INDEX IF NOT EXISTS roster_duty_pairings_unique_idx
  ON roster_duty_pairings (when_role, when_person, service_type, then_role);

ALTER TABLE roster_duty_pairings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roster_duty_pairings_all ON roster_duty_pairings;
CREATE POLICY roster_duty_pairings_all ON roster_duty_pairings
  FOR ALL USING (true) WITH CHECK (true);
