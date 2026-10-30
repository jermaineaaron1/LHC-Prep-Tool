-- A practice take of a whole SECTION -- "Verse 1", "1st Chorus" -- rather
-- than of one line or of the whole song.
--
-- A take is attached to a line by line_id, and a take with no line_id has
-- been a run-through of the whole song. Nothing on the row could say
-- "this is the whole of Verse 1", so neither the recorder nor the cutter
-- could make one. This column is the name of the section a take is of,
-- exactly as the section is named in song_voice_lines.section for that
-- song (the app matches it case-insensitively), and null for every take
-- that is not a section take.
--
-- Additive: existing rows keep working as they are, and the policies on
-- the table are unchanged. Run in the Supabase SQL editor as postgres.

alter table public.song_recordings
  add column if not exists section text null;

comment on column public.song_recordings.section is
  'The section this take is the whole of ("Verse 1"), as named in song_voice_lines.section; null for a line take or a run-through.';
