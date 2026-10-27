-- Migration: two voices, and somewhere to hang a recording off.
--
-- WHY
-- The caroling arrangement of "Do You Hear What I Hear" is written on two
-- staves, Women and Men, and for a third of its 63 bars they are not singing
-- the same words. In bars 11-16 the women hold an open "Oh" while the men
-- sing "dancing in the night with a tail as big as a kite". In bars 36-39 the
-- men are out for two bars and come back in on "Do you know what I know".
-- Those overlaps are the entire reason a caroler needs the page.
--
-- songs.lyrics is one text column, and the renderers that read it know three
-- kinds of line: a [Section] header, a chord line, and a lyric line. Two
-- voices singing different words at the same moment has nowhere to go in
-- that. Nor does the songbook's "two column" layout help -- it is CSS
-- column-count, page flow, so it puts the men's half BELOW the women's.
--
-- The other half of this is the recordings. song_recordings already exists
-- and its category picker already offers Soprano, Alto, Tenor and Bass. What
-- it cannot do is attach a take to a LINE, because a line in a text blob is
-- just an offset, and an offset stops meaning anything the moment somebody
-- retypes the verse above it. A row id does not. So line_id goes on
-- song_recordings now, while the table is small and nothing has to be
-- backfilled, even though nothing writes it yet.
--
-- SHAPE
-- One row is one part singing one stretch of bars:
--     <part> sings <text> across bars <bar_start>..<bar_end>
--
-- part is 'women', 'men' or 'both'. 'both' is a unison passage written once
-- rather than twice -- the two staves in this score differ in hyphenation and
-- capitals in several unison bars ("little lamb" against "lit-tle lamb",
-- "King" against "king") and writing those out twice would present engraving
-- noise as two different lines.
--
-- A rest is the ABSENCE of a row. If the women have no row covering bars 4-4
-- and the men do, the women are not singing there. This is why rows are
-- grouped by bar range rather than listed per part: the renderer pairs rows
-- that share (bar_start, bar_end) into one display row and shows a rest for
-- whichever lane is missing.
--
-- bar_start and bar_end are nullable. They are for DISPLAY and for ordering
-- by eye; a two-part song typed in without a score in front of you has no bar
-- numbers, and that is fine. sort_order is what actually fixes the reading
-- order, and id is what a recording attaches to. Neither depends on the bars.
--
-- songs.voice_layout is the flag that says "this song has rows here", so the
-- Songs list does not have to ask this table about every song it draws. It is
-- derived state and the app keeps it in step: set when lines are saved,
-- cleared when the last one is deleted.
--
-- songs.lyrics is still written for every song, including these. It holds a
-- flat rendering generated FROM these rows -- unison lines bare, split lines
-- prefixed "W:" and "M:" -- so projection, the PDF, search, WhatsApp sharing
-- and the songbook's text flow all keep working with no change at all. It is
-- a copy, not the truth; these rows are the truth.
--
-- Safe to re-run. Safe to apply while people are using the app: until it
-- lands, SBQ_VOICE_LINES.forSong() fails its read and every song renders
-- exactly as it does today.

CREATE TABLE IF NOT EXISTS song_voice_lines (
  id         BIGSERIAL PRIMARY KEY,
  song_id    TEXT    NOT NULL,
  part       TEXT    NOT NULL,
  text       TEXT    NOT NULL DEFAULT '',
  bar_start  INTEGER,
  bar_end    INTEGER,
  section    TEXT    NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- A held vowel, not words: the women's "Oh............" under the men's
  -- moving line. The renderer sets it in italics so it does not read as a
  -- lyric somebody forgot to finish typing.
  sustained  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 'both' is deliberately in here. A row that is neither of the two parts nor
-- a unison passage is a typo, and a typo that reaches this column renders as
-- a lane that does not exist and silently disappears from the page.
ALTER TABLE song_voice_lines DROP CONSTRAINT IF EXISTS song_voice_lines_part_chk;
ALTER TABLE song_voice_lines ADD  CONSTRAINT song_voice_lines_part_chk
  CHECK (part IN ('women', 'men', 'both'));

-- A range that runs backwards would place a line before itself in every view
-- that sorts by bar.
ALTER TABLE song_voice_lines DROP CONSTRAINT IF EXISTS song_voice_lines_bars_chk;
ALTER TABLE song_voice_lines ADD  CONSTRAINT song_voice_lines_bars_chk
  CHECK (bar_start IS NULL OR bar_end IS NULL OR bar_end >= bar_start);

-- Every read of this table is "the lines for one song, in order".
CREATE INDEX IF NOT EXISTS song_voice_lines_song_idx
  ON song_voice_lines (song_id, sort_order);

ALTER TABLE song_voice_lines ENABLE ROW LEVEL SECURITY;

-- Same open policy as the rest of the app, which reaches Supabase with the
-- anon key in the page. Without this the table reads as EMPTY through the app
-- -- not as an error -- and a two-part song renders as a song with no words.
DROP POLICY IF EXISTS song_voice_lines_all ON song_voice_lines;
CREATE POLICY song_voice_lines_all ON song_voice_lines
  FOR ALL USING (true) WITH CHECK (true);


-- ---------------------------------------------------------------------
-- The flag on songs, so the list view never has to ask.
-- ---------------------------------------------------------------------
ALTER TABLE songs ADD COLUMN IF NOT EXISTS voice_layout TEXT;

COMMENT ON COLUMN songs.voice_layout IS
  'NULL for an ordinary song. ''two-part'' when song_voice_lines holds its words.';


-- ---------------------------------------------------------------------
-- The anchor a per-voice practice recording will attach to.
--
-- Nullable, and nothing writes it yet: every recording made today is for the
-- whole song, and those stay exactly as they are. ON DELETE SET NULL because
-- retyping a line must not destroy a take somebody sang.
-- ---------------------------------------------------------------------
ALTER TABLE song_recordings ADD COLUMN IF NOT EXISTS line_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'song_recordings_line_fk'
  ) THEN
    ALTER TABLE song_recordings
      ADD CONSTRAINT song_recordings_line_fk
      FOREIGN KEY (line_id) REFERENCES song_voice_lines(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS song_recordings_line_idx
  ON song_recordings (line_id) WHERE line_id IS NOT NULL;


-- ---------------------------------------------------------------------
-- Verify as postgres, not through the app. A table created in the SQL
-- Editor gets RLS with no policy until the block above runs, and the anon
-- key then reads it as empty rather than as an error.
-- ---------------------------------------------------------------------
-- SELECT tablename, policyname, cmd FROM pg_policies
--  WHERE tablename IN ('song_voice_lines');
--
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'song_voice_lines' ORDER BY ordinal_position;
--
-- SELECT COUNT(*) FROM song_voice_lines;

-- Rollback (destroys every two-part arrangement -- the recordings survive,
-- detached, because of the ON DELETE SET NULL above):
-- ALTER TABLE song_recordings DROP CONSTRAINT IF EXISTS song_recordings_line_fk;
-- ALTER TABLE song_recordings DROP COLUMN IF EXISTS line_id;
-- ALTER TABLE songs DROP COLUMN IF EXISTS voice_layout;
-- DROP TABLE IF EXISTS song_voice_lines;
