-- Migration: give projection backgrounds their own table
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jypzhumcdifxnazexdcu/sql/new
--
-- WHY
-- A background the operator uploads is normally a URL in storage, which costs
-- nothing to carry around. But when the upload cannot happen the picture is
-- kept inline as a data: URL, and that is where the trouble started: a saved
-- projection version is a deep copy of the whole deck, so every Save Projection
-- wrote another complete copy of the picture into orders.template, into its own
-- projection_versions row and into the crash journal. Measured on an 8-song
-- songbook with one 4 MB photo: each version's deck was 1203 KB of which
-- 1200 KB was the same picture, and main-thread blocking climbed from 236 ms to
-- 976 ms over four saves. That is the freeze operators reported -- it took "a
-- couple of times" to appear because it grew with each save.
--
-- The decks now hold a reference (#bg:<id>) instead of the bytes, and the bytes
-- live once per songbook. This table is where they live. Keeping them in
-- orders.template instead would only halve the problem: that column is rewritten
-- in FULL on every autosave, so one photo in it means serialising its megabytes
-- on the main thread every couple of seconds while the operator works.
--
-- WHAT IT DOES NOT DO
-- Purely additive. No existing table or column is touched. Before this migration
-- runs the app keeps the pool in orders.template exactly as it does today (every
-- call is wrapped and a missing table is treated as "not available"), so there is
-- no ordering dependency with the deploy. The first time each songbook's
-- projection is opened afterwards, whatever is in its template moves across on
-- its own.
--
-- owner_id is orders.id, including the 'standalone_<songbookId>' rows that back
-- songbooks created from Song Finder. Deliberately NOT a foreign key, for the
-- same reason as projection_versions: a standalone songbook's orders row is
-- created lazily and an FK would refuse the media row until then. The app
-- deletes these rows itself when an order is deleted.
--
-- The primary key is (owner_id, id), not id alone: pool ids are generated on the
-- client per songbook and are only ever unique within one.
--
-- Safe to re-run (IF NOT EXISTS).

-- ── One row per stored picture ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projection_media (
  owner_id   TEXT        NOT NULL,             -- orders.id, incl. 'standalone_<sbId>'
  id         TEXT        NOT NULL,             -- pool id, e.g. 'pmstusqa75f2'
  data       TEXT        NOT NULL,             -- the data: URL itself
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, id)
);

CREATE INDEX IF NOT EXISTS projection_media_owner_idx
  ON projection_media (owner_id);

ALTER TABLE projection_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_projection_media" ON projection_media;

CREATE POLICY "anon_all_projection_media"
  ON projection_media FOR ALL
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON projection_media TO anon;

-- ============================================================
-- Done.
--
-- To verify:
-- 1. Open a songbook, enter Project mode, and set a background from a picture
--    that has to be stored inline (one the upload could not take). Then run:
--      SELECT owner_id, id, length(data) FROM projection_media;
--    One row should appear, and the picture should be at most about 1920x1080 --
--    the app scales anything larger before storing it.
-- 2. Save the projection as a version two or three times, then run:
--      SELECT owner_id, name, pg_column_size(deck) FROM projection_versions;
--    Every deck should be a few KB. Before this change each one carried its own
--    full copy of the picture and ran to around a megabyte.
-- 3. Check orders.template no longer holds the bytes:
--      SELECT id, template ? '_bgPool' FROM orders WHERE id = '<the order>';
--    Should be false once the songbook has been opened since the migration.
-- 4. Delete a saved version that was the only user of a picture, reopen the
--    songbook, and confirm the projection_media row has gone with it.
-- ============================================================
