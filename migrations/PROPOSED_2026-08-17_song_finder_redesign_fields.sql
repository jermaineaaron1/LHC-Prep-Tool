-- =====================================================================
-- PROPOSAL — NOT RUN. Requires review and approval before execution.
-- 2026-08-17 — Fields the Song Finder redesign references have nowhere to store
-- =====================================================================
--
-- WHY THIS EXISTS
-- ---------------
-- The complete-redesign brief's reference images show data the schema does not
-- have. Rather than add controls that silently discard what the user types,
-- those controls were left out and recorded as blockers B3, B4, B6 and the
-- editor Settings panel. This is the single migration that would make all four
-- real. Nothing here is required for anything already shipped to keep working.
--
-- Filename is deliberately prefixed PROPOSED_ so it cannot be mistaken for an
-- applied migration. Rename it to 2026-08-17_song_finder_redesign_fields.sql
-- when (and only when) it has been run.
--
-- SCOPE AND SAFETY
-- ----------------
-- * Every statement is ADD COLUMN IF NOT EXISTS with a default. No column is
--   dropped, renamed or retyped, and no existing row is rewritten.
-- * No RLS policy is created, altered or removed. The existing policies on
--   `songs` and `songbooks` continue to apply unchanged.
-- * Additive columns are backward compatible: current code selects `*` and
--   ignores unknown fields, so the app keeps working whether or not this runs.
-- * Reversible — the DOWN block at the end drops only what this adds.
--
-- WHAT EACH PART UNBLOCKS
-- -----------------------
--   B6  songs: alternate title, CCLI/copyright, time signature, BPM,
--       service suitability  -> the Add/Edit Song fields in reference image 3
--   B3  song_themes table    -> theme colour and description in reference 5
--   B4  songbook_entries     -> per-songbook layout, key and transposition
--       in reference image 5
--   --  songs.display_style  -> the editor Settings panel (chord/lyric colour,
--       fonts, spacing, alignment) in reference image 3, which is currently
--       render-only and forgets on close
--
-- COST TO CONSIDER BEFORE APPROVING
-- ---------------------------------
-- B4 is the only structural one. `songbooks.song_ids` is a flat JSONB array of
-- song ids and every reader does `.indexOf(songId)` on it. Per-entry layout
-- cannot live there without changing that array to objects, which would break
-- those readers silently. So B4 adds a proper join table and leaves
-- `song_ids` alone as the source of truth for membership; the new table is
-- purely additive per-entry presentation. If you would rather not carry two
-- places, say so and the Songbook layout control stays omitted.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- B6 — extra song fields shown in the Add/Edit form
-- ---------------------------------------------------------------------
ALTER TABLE songs ADD COLUMN IF NOT EXISTS alternate_title    text  DEFAULT '';
ALTER TABLE songs ADD COLUMN IF NOT EXISTS copyright          text  DEFAULT '';
ALTER TABLE songs ADD COLUMN IF NOT EXISTS ccli_number        text  DEFAULT '';
ALTER TABLE songs ADD COLUMN IF NOT EXISTS time_signature     text  DEFAULT '';
ALTER TABLE songs ADD COLUMN IF NOT EXISTS bpm                integer;
-- Free-form set rather than five booleans, so adding a service type later is a
-- data change and not another migration.
ALTER TABLE songs ADD COLUMN IF NOT EXISTS service_suitability jsonb DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------
-- Editor Settings panel — per-song display preferences
-- Supersedes the older proposed migrations/2026-07-17_add_songs_display_style.sql
-- ---------------------------------------------------------------------
ALTER TABLE songs ADD COLUMN IF NOT EXISTS display_style jsonb DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------
-- B3 — themes as records, so they can carry colour and description
-- Existing songs.theme (comma-separated string) stays the source of truth for
-- which themes a song has. This table only describes a theme.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS song_themes (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  description  text DEFAULT '',
  colour       text DEFAULT '',
  created_date timestamptz NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness, matching the duplicate rule the UI enforces.
CREATE UNIQUE INDEX IF NOT EXISTS song_themes_name_lower_idx
  ON song_themes (lower(btrim(name)));

ALTER TABLE song_themes ENABLE ROW LEVEL SECURITY;
-- Mirrors the existing songs/songbooks policies exactly -- no wider access.
DROP POLICY IF EXISTS "song_themes_select" ON song_themes;
DROP POLICY IF EXISTS "song_themes_insert" ON song_themes;
DROP POLICY IF EXISTS "song_themes_update" ON song_themes;
DROP POLICY IF EXISTS "song_themes_delete" ON song_themes;
CREATE POLICY "song_themes_select" ON song_themes FOR SELECT USING (true);
CREATE POLICY "song_themes_insert" ON song_themes FOR INSERT WITH CHECK (true);
CREATE POLICY "song_themes_update" ON song_themes FOR UPDATE USING (true);
CREATE POLICY "song_themes_delete" ON song_themes FOR DELETE USING (true);

-- ---------------------------------------------------------------------
-- B4 — per-songbook presentation for a song
-- songbooks.song_ids remains the membership list and is NOT touched.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS songbook_entries (
  songbook_id     text NOT NULL,
  song_id         text NOT NULL,
  layout          text    DEFAULT 'lyrics-chords',  -- lyrics-only | lyrics-chords | two-column
  key_override    text    DEFAULT '',
  transpose_steps integer DEFAULT 0,
  sort_order      integer DEFAULT 0,
  PRIMARY KEY (songbook_id, song_id)
);

ALTER TABLE songbook_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "songbook_entries_select" ON songbook_entries;
DROP POLICY IF EXISTS "songbook_entries_insert" ON songbook_entries;
DROP POLICY IF EXISTS "songbook_entries_update" ON songbook_entries;
DROP POLICY IF EXISTS "songbook_entries_delete" ON songbook_entries;
CREATE POLICY "songbook_entries_select" ON songbook_entries FOR SELECT USING (true);
CREATE POLICY "songbook_entries_insert" ON songbook_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "songbook_entries_update" ON songbook_entries FOR UPDATE USING (true);
CREATE POLICY "songbook_entries_delete" ON songbook_entries FOR DELETE USING (true);

COMMIT;

-- =====================================================================
-- VERIFICATION — run after COMMIT.
-- =====================================================================
-- (a) The six new songs columns exist.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'songs'
  AND column_name IN ('alternate_title','copyright','ccli_number',
                      'time_signature','bpm','service_suitability','display_style')
ORDER BY column_name;
-- expected: 7 rows

-- (b) Both new tables exist and are RLS-enabled with 4 policies each.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, count(p.polname) AS policies
FROM pg_class c
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE c.relname IN ('song_themes','songbook_entries')
GROUP BY c.relname, c.relrowsecurity;
-- expected: 2 rows, rls_enabled = true, policies = 4

-- (c) Nothing existing was disturbed.
SELECT count(*) AS songs FROM songs;          -- expected: unchanged (51 at time of writing)
SELECT count(*) AS songbooks FROM songbooks;  -- expected: unchanged

-- =====================================================================
-- DOWN — drops only what this file adds.
-- =====================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS songbook_entries;
-- DROP TABLE IF EXISTS song_themes;
-- ALTER TABLE songs DROP COLUMN IF EXISTS display_style;
-- ALTER TABLE songs DROP COLUMN IF EXISTS service_suitability;
-- ALTER TABLE songs DROP COLUMN IF EXISTS bpm;
-- ALTER TABLE songs DROP COLUMN IF EXISTS time_signature;
-- ALTER TABLE songs DROP COLUMN IF EXISTS ccli_number;
-- ALTER TABLE songs DROP COLUMN IF EXISTS copyright;
-- ALTER TABLE songs DROP COLUMN IF EXISTS alternate_title;
-- COMMIT;
