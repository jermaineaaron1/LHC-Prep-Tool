-- Migration: fix missing RLS policy/grants on lectionary_readings
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jypzhumcdifxnazexdcu/sql/new
--
-- The original migration (2026-07-30_add_lectionary_readings.sql) created
-- this table but never enabled RLS + added an anon policy + granted table
-- privileges, unlike every other table in this project (see
-- add_roster_member_tables.sql, 2026-07-31_add_roster_name_merge_dismissals.sql,
-- etc.). Supabase's project-wide default denies all access to a table with
-- RLS enabled and no policy, so EVERY write to lectionary_readings has been
-- silently failing with "new row violates row-level security policy for
-- table lectionary_readings" -- this affects both the existing manual
-- Bible Browser reading-slot picker AND the new AI-assisted bulletin
-- upload feature, not just one of them.
--
-- Safe to re-run.
ALTER TABLE lectionary_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_lectionary_readings" ON lectionary_readings;

CREATE POLICY "anon_all_lectionary_readings"
  ON lectionary_readings FOR ALL
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON lectionary_readings TO anon;

-- ============================================================
-- Done! After running, open the Liturgy > Lectionary Reading page and
-- verify a reading slot can be saved (manually via the Bible Browser
-- picker, or via Auto-Fill from Bulletin) without a row-level security
-- error in the browser console.
-- ============================================================
