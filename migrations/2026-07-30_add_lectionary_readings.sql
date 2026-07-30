-- Migration: create lectionary_readings table
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jypzhumcdifxnazexdcu/sql/new
--
-- Part of the Liturgy page's "Lectionary Reading" redesign (Phase 3a) -- lets
-- the app store a set of Bible readings assigned to a specific calendar date
-- (e.g. "1st Reading", "Psalm", "2nd Reading", "Gospel" for July 6, 2025),
-- entered manually via the existing Bible Browser rather than auto-filled
-- from a standard lectionary calendar (no such dataset is built this pass).
--
-- Brand new table -- nothing existing queries it, so this is safe to run at
-- any time relative to other deploys. The one ordering rule that DOES matter:
-- run this BEFORE deploying the frontend code that reads/writes
-- lectionary_readings (SBQ_LECTIONARY in Index.html) -- Supabase's REST API
-- returns a "relation does not exist" error for any query against a table
-- that hasn't been created yet, so the new Lectionary Reading home view would
-- fail to load its readings (though it would not affect any other, unrelated
-- feature, since this is an isolated new table).
--
-- Safe to re-run (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS lectionary_readings (
  reading_date   DATE PRIMARY KEY,
  season_label   TEXT,
  slots          JSONB NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE lectionary_readings IS
  'One row per calendar date with assigned Bible readings. `slots` is a JSONB array of {label, book, reference, translation, passageText, verseCount} objects (1-4 typical: 1st Reading/Psalm/2nd Reading/Gospel), cached from the Bible Browser fetch at save time.';
