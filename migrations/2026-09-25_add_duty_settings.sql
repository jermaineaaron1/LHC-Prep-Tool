-- Migration: let a PIC decide who Auto-Suggest may pick for each duty, and
-- how often, without waiting for a code change.
--
-- WHY
-- Those answers already existed -- TEAM_ROLE_CONFIG named the people for a
-- handful of duties per service type, ROLE_NOT_APPLICABLE said which duties a
-- Contemporary service skips, and the twice-a-month rotation limit was the
-- literal 2 in a sort comparator. All three were in Index.html, which means
-- every one of them was a deploy. A PIC who wanted one more name on the
-- Traditional pianist list had to ask for a release.
--
-- SHAPE
-- One row per duty per service type. service_type is 'traditional',
-- 'contemporary', or 'all' for duties that do not vary between them; the app
-- reads the specific row first and falls back to 'all'.
--
-- Every column is nullable on purpose. A row says only what the PIC changed:
--   people      null  -- no restriction, the whole category is eligible
--               [..]  -- ONLY these people, and a cell stays blank if none
--                        of them are free. Chosen over "prefer these" so that
--                        Auto-Suggest can never volunteer someone a PIC did
--                        not approve for that duty.
--   monthly_cap null  -- use the built-in soft limit
--   applies     null  -- the duty runs on this service type
-- so an empty table behaves exactly as the hardcoded values did, and a row is
-- only ever a deliberate departure from them.
--
-- Safe to re-run, and safe to apply while people are using the app: until it
-- lands, getDutySettings() fails and the app keeps the built-in behaviour.

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

-- The settings screen reads the whole table at once and Auto-Suggest reads it
-- per duty, so both want it small and fully scanned rather than indexed. No
-- index beyond the primary key.

-- The app reaches Supabase with the anon key, exactly as it does for the
-- roster itself, so this table needs the same open policy the others have.
-- Without it the table reads as empty through the app and every PIC's saved
-- setting silently does nothing.
ALTER TABLE roster_duty_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roster_duty_settings_all ON roster_duty_settings;
CREATE POLICY roster_duty_settings_all ON roster_duty_settings
  FOR ALL USING (true) WITH CHECK (true);
