-- Migration: enable RLS on liturgy_occasion_data, with the project's policy
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jypzhumcdifxnazexdcu/sql/new
--
-- WHY
-- The Security Advisor reports one error: "RLS Disabled in Public" on
-- public.liturgy_occasion_data. Every other table in this project enables row
-- level security and then adds an anon policy (see add_roster_table.sql,
-- fix_orders_supabase.sql, 2026-08-01_fix_lectionary_readings_rls.sql). This
-- one was created without that step, so it is the only table where RLS is off
-- altogether.
--
-- WHAT THIS DOES AND DOES NOT DO
-- It does NOT make the data safer today. Measured 2026-10-05: every table in
-- this project already accepts reads and writes from the anon key, which is
-- embedded in the page and therefore public. This table is no more exposed
-- than the rest.
--
-- What it does is make the table consistent with the others, and leave a place
-- to tighten later. A table with RLS disabled cannot be restricted by any
-- policy at all; a table with RLS enabled and a permissive policy can be
-- narrowed by editing that one policy. It also clears the advisor error, so
-- the next genuine error is visible instead of being lost beside a known one.
--
-- The real fix for public write access is authentication, which is a separate
-- and much larger piece of work.
--
-- THE RISK THIS AVOIDS
-- Enabling RLS WITHOUT a policy is worse than leaving it off: Supabase denies
-- everything by default, so the table would read as EMPTY through the app and
-- the Liturgy planning notes would silently vanish from the screen. That is
-- exactly what happened to lectionary_readings in July (see that migration).
-- So this runs in a transaction: if the policy or the grant cannot be created,
-- the ENABLE is rolled back too and the table is left exactly as it is now.
--
-- WHAT IS IN THE TABLE
-- 5 rows as of 2026-10-05, one per occasion (palm-sunday, maundy-thursday,
-- good-friday, pentecost, ordinary-traditional), each holding that occasion's
-- planning notes and special-element checklists.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE liturgy_occasion_data ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_liturgy_occasion_data" ON liturgy_occasion_data;

CREATE POLICY "anon_all_liturgy_occasion_data"
  ON liturgy_occasion_data FOR ALL
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON liturgy_occasion_data TO anon;

COMMIT;

-- ============================================================
-- Done. Now CHECK IT, because the failure mode is silent:
--
--   1. Open the app, go to Liturgy, and open any occasion (Good Friday has
--      the most notes). The planning notes and the special-elements
--      checklist must still be there. If the page is suddenly empty, the
--      policy did not apply -- re-run this file.
--
--   2. Edit a note and reload. It must persist.
--
--   3. Or run tools/verify-liturgy-occasion-rls.js, which reads the table
--      through the anon key, writes a round-trip to one row and restores it.
--
--   4. Supabase dashboard -> Advisors -> Security Advisor -> Refresh.
--      "RLS Disabled in Public" should be gone and Errors should read 0.
-- ============================================================
