-- =====================================================================
-- 2026-08-18 — Partial restore of "Away in Manger" (song_1767451889865)
-- =====================================================================
--
-- WHAT HAPPENED
-- -------------
-- While reverting a test value on `display_style`, I called the app's
-- SBQ_SONGS.update() with a PARTIAL payload: {id, title, display_style}.
-- That function rebuilds the WHOLE row through songToRow(), which defaults
-- every field it is not handed — arrays to [], strings to ''. So the write
-- blanked every other column on this one row.
--
-- Blast radius: exactly ONE row. All 50 other songs were re-checked field by
-- field and are untouched.
--
-- Lost, and NOT recoverable from any backup I hold:
--   lyrics (it had chords, and transposed from D), theme, tempo, style,
--   season, scripture, artist, use_count, last_used, date_added, last_edited
--
-- Recoverable, and restored below from verified sources:
--   attachments  — the 2026-08-17 unpack migration (literal, reviewed values)
--   youtube      — same migration (deduplicated pair)
--   key          — 'D', recorded by an Add-to-Order probe that read the live
--                  row on 2026-08-17 ("Key: D (Original)")
--
-- The code defect behind this is fixed in the same commit: SBQ_SONGS gains
-- updateFields(id, patch), which writes only the columns handed to it, and
-- the two partial-payload call sites now use it. One of those two (the
-- "Add Media" flow, which passed no title at all) is PRE-EXISTING on master
-- and would have blanked a song for any user who added a media link to one.
--
-- SAFETY
-- ------
-- * Single transaction, single row, guarded by id.
-- * Restores only the three columns named. It does NOT invent lyrics or
--   metadata — those stay empty until recovered from a real source or
--   re-entered.
-- * Re-runnable: writing the same values twice is a no-op in effect.
--
-- BEFORE YOU RUN THIS, TRY A REAL BACKUP FIRST
-- --------------------------------------------
-- A full restore beats this partial one. Two places to look:
--   1. Supabase Dashboard -> Database -> Backups. If a backup predates
--      2026-08-18, recover this single row's lyrics/theme/key from it.
--   2. The legacy Google Sheets `Songs` sheet from the Apps Script era —
--      this song's id (song_1767451889865) originated there, so the sheet
--      should still carry its lyrics and metadata.
-- If either yields the row, restore from that and skip this file.
-- =====================================================================

BEGIN;

UPDATE songs
SET attachments = $json$[
  {"url":"https://drive.google.com/file/d/15WuTTYdtXK2KJnoVMCRWjVBsISg_Lc8F/view?usp=drive_link","name":"Google Drive File","ext":"file","icon":"fa-google-drive"},
  {"url":"https://docs.google.com/document/d/1LsM05phNJjTbfEUgusFhFUY2uFrFgajc/edit?usp=drive_link&ouid=106958184850014570488&rtpof=true&sd=true","name":"Google Doc","ext":"gdoc","icon":"fa-file-word"},
  {"url":"https://docs.google.com/document/d/1FqWhmFz6wzWbftqXpcpWKaPi28Q6TVBQkZKvlFRaqDA/edit?usp=drive_link","name":"Google Doc","ext":"gdoc","icon":"fa-file-word"},
  {"url":"https://docs.google.com/document/d/1tl6yP-YcskR1sYJFGw2GkFB6Q6_GGiKN/edit?usp=sharing&ouid=106958184850014570488&rtpof=true&sd=true","name":"Google Doc","ext":"gdoc","icon":"fa-file-word"},
  {"url":"https://docs.google.com/document/d/1k74Gkz0wjNbj116T6HZ95gWoO7X5YcUu/edit","name":"Google Doc","ext":"gdoc","icon":"fa-file-word"}
]$json$::jsonb,
    youtube = $json$[
  "https://www.youtube.com/watch?v=3dxzdsfJp2s",
  "https://www.youtube.com/watch?v=GjtYtBGrP6Y"
]$json$::jsonb,
    key = 'D'
WHERE id = 'song_1767451889865';

-- Verification: expect att_count 5, yt_count 2, key 'D'.
-- lyrics_len will read 0 — that is the part this file cannot restore.
SELECT id,
       title,
       key,
       jsonb_array_length(attachments) AS att_count,
       jsonb_array_length(youtube)     AS yt_count,
       length(coalesce(lyrics, ''))    AS lyrics_len
FROM songs
WHERE id = 'song_1767451889865';

COMMIT;
