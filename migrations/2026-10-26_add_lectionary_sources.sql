-- Migration: add lectionary_sources, the record of which document the
-- readings were imported from.
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jypzhumcdifxnazexdcu/sql/new
--
-- WHY A NEW TABLE IS NEEDED
-- The Readings page can now import a whole lectionary PDF at once, filling
-- many Sundays from one document, and the request that came with it was to
-- "see what file it's reading from". That is a fact about the import, not
-- about any one reading, and there is nowhere to put it:
--
--   `roster` holds one row per role per date, value being the reference
--   itself. There is no column for provenance and adding one would widen
--   the table every other feature reads.
--
--   `lectionary_readings` is a passage-text cache keyed by date. Its one
--   row is left over from a bug (see below) and it is keyed wrongly for
--   this -- a source covers many dates, not one.
--
--   `liturgy_occasion_data` is per-occasion planning notes. Squatting a
--   reserved occasion id in it would work and would be a lie to the next
--   person who reads that table.
--
-- So: one row per uploaded document, holding the file, when it arrived,
-- which service dates it supplied, and what it said for each of them.
--
-- WHAT IT DOES NOT DO
-- It is not where readings live. Readings are roster rows -- role ids
-- reading1/psalm/reading2/gospel -- and the import writes them there
-- through SBQ_READINGS.setReference, the same path the manual Bible Browser
-- picker uses. This table is only the receipt. Deleting every row in it
-- loses no readings; the Readings page would just stop naming its source.
--
-- (The bug referred to above: "Auto-Fill from Bulletin" used to save into
-- lectionary_readings, which nothing reads back, so the references vanished
-- on reload. Fixed separately. This table exists so that the new import
-- does not repeat the trick of writing somewhere nobody looks -- the app
-- degrades to hiding the source chip if this table is absent, and still
-- saves the readings.)
--
-- RLS
-- Enabling RLS WITHOUT a policy is worse than leaving it off: Supabase
-- denies everything by default, so the table would read as EMPTY through
-- the anon key and the source chip would silently never appear. That is
-- what happened to lectionary_readings in July. So this runs in a
-- transaction: if the policy or the grant cannot be created, the ENABLE is
-- rolled back and the table is left unprotected rather than unreadable.
--
-- This does not make the data safer today -- every table in this project
-- already accepts reads and writes from the anon key, which is embedded in
-- the page. It makes this table consistent with the others and leaves a
-- place to tighten once there is authentication.
--
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS lectionary_sources (
  id            text PRIMARY KEY,
  file_name     text NOT NULL,
  file_url      text NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  -- The ISO service dates this document supplied, as ["2026-11-01", ...].
  -- Stored rather than recomputed: the readings themselves carry no
  -- provenance, so once the import has run there is no other way to say
  -- how many Sundays this file accounted for.
  service_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What the document actually said, as
  --   { "2026-11-01": { "reading1": "...", "psalm": "...",
  --                     "reading2": "...", "gospel": "..." }, ... }
  --
  -- Kept so "reset these readings to the lectionary" is answerable. Without
  -- it the only record of the import is which dates it touched, and a
  -- reading edited by hand could never be put back without uploading the
  -- PDF again. It is a snapshot of the document, NOT the live readings:
  -- the roster is those, and this is what the file said on the day it was
  -- read.
  readings      jsonb NOT NULL DEFAULT '{}'::jsonb,
  note          text
);

-- The Readings page asks for the newest source, and only that.
CREATE INDEX IF NOT EXISTS lectionary_sources_uploaded_at_idx
  ON lectionary_sources (uploaded_at DESC);

ALTER TABLE lectionary_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_lectionary_sources" ON lectionary_sources;

CREATE POLICY "anon_all_lectionary_sources"
  ON lectionary_sources FOR ALL
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON lectionary_sources TO anon;

COMMIT;

-- ============================================================
-- Done. Now CHECK IT, because the failure mode is silent -- a table with
-- RLS on and no working policy reads as empty rather than erroring:
--
--   1. node tools/verify-lectionary-sources.js
--      It reads the table through the anon key, writes one row, reads it
--      back and deletes it. It touches nothing else.
--
--   2. Or in the app: Liturgy -> Readings -> Import lectionary, upload a
--      PDF. After saving, the header should name the file. If the readings
--      save but no source chip appears, the policy did not apply --
--      re-run this file.
--
--   3. Supabase dashboard -> Advisors -> Security Advisor -> Refresh.
--      No new "RLS Disabled in Public" error should appear.
-- ============================================================
