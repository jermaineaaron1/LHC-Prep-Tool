-- Migration: add roster_name_merge_dismissals table
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jypzhumcdifxnazexdcu/sql/new
--
-- Part of the "merge duplicate person records" feature in the Enablers
-- modal's new Duplicates tab. When a PIC reviews a suggested near-duplicate
-- name pair (e.g. "Cheng Jun Hao" vs "Cheng Junn Hau") and confirms they are
-- actually two different real people, that decision is stored here so the
-- pair never resurfaces as a suggestion again. Purely additive -- no
-- existing table, column, or query is touched; only the new Duplicates-tab
-- code reads/writes this table.
--
-- Both name_*_norm columns are populated by the app using the same
-- _nameNorm() logic already used elsewhere in Index.html
-- (.trim().replace(/\s+/g,' ').toLowerCase()), with name_a_norm always the
-- alphabetically-smaller of the two normalized strings -- this lets a single
-- UNIQUE constraint catch the pair regardless of scan order.
--
-- No ordering dependency on the frontend deploy (unlike some earlier
-- migrations in this project): this is new UI reading a new table, so
-- deploying the frontend first just means the Duplicates tab briefly errors
-- on "relation does not exist" for that one tab (caught gracefully, same as
-- other optional Supabase calls in this file) -- not a global save failure.
--
-- Safe to re-run (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS roster_name_merge_dismissals (
  id           BIGSERIAL   PRIMARY KEY,
  name_a_norm  TEXT        NOT NULL,
  name_b_norm  TEXT        NOT NULL,
  name_a       TEXT        NOT NULL,
  name_b       TEXT        NOT NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT roster_name_merge_dismissals_unique UNIQUE (name_a_norm, name_b_norm)
);

CREATE INDEX IF NOT EXISTS roster_name_merge_dismissals_lookup_idx
  ON roster_name_merge_dismissals (name_a_norm, name_b_norm);

ALTER TABLE roster_name_merge_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_roster_name_merge_dismissals" ON roster_name_merge_dismissals;

CREATE POLICY "anon_all_roster_name_merge_dismissals"
  ON roster_name_merge_dismissals FOR ALL
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON roster_name_merge_dismissals TO anon;
GRANT USAGE, SELECT ON SEQUENCE roster_name_merge_dismissals_id_seq TO anon;

-- ============================================================
-- Done! After running, open the Enablers modal -> Duplicates tab and verify:
-- 1. No "relation does not exist" errors in the browser console
-- 2. Clicking "Not a duplicate" on a suggested pair removes it and it does
--    not reappear after closing/reopening the modal
-- ============================================================
