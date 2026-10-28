-- A choir part is whatever the choir calls it.
--
-- song_voice_lines.part was checked against ('women', 'men', 'both'). That
-- was right for a two-part carol and wrong for everything else a church
-- choir actually sings: Women 1 and Women 2 against the men, a descant over
-- the top, a solo line, Soprano / Alto / Tenor / Bass.
--
-- Asked for directly: "if I want to add Women 1 or Women 2, I just want to
-- type it in [ ] to make my own section with whatever name I want."
--
-- WHAT STAYS TRUE
-- 'both' keeps its meaning. It is not a lane -- it is a moment everybody
-- sings, written once, spanning whatever lanes the song has. 'women' and
-- 'men' keep theirs too: they carry the chip wording, the two colours and
-- the W:/M: shorthand in the editor. Any other value is a part somebody
-- named, displayed as typed and coloured by whichever family its name
-- falls into (lhcVoiceLines.partFamily, which tests "women" BEFORE "men"
-- because the first word contains the second).
--
-- WHY A CHECK IS NOT REPLACED WITH A LONGER LIST
-- Any list is the same bug again with more names in it. The constraint that
-- matters is not which names exist but that a part is not blank, because a
-- row with no part cannot be placed in any lane and would vanish from the
-- page without an error.

ALTER TABLE song_voice_lines DROP CONSTRAINT IF EXISTS song_voice_lines_part_chk;

-- Not blank, and not unbounded. 40 characters is a label on a chip.
ALTER TABLE song_voice_lines ADD  CONSTRAINT song_voice_lines_part_chk
  CHECK (length(btrim(part)) BETWEEN 1 AND 40);

-- One literal, deliberately. This was written as several adjacent strings
-- across newlines, which Postgres does concatenate -- and which, if it had
-- tripped on anything, would have failed the whole script inside the SQL
-- editor's transaction and rolled the two ALTERs above back with it. The
-- migration would then look like it had run and have changed nothing.
COMMENT ON COLUMN song_voice_lines.part IS 'Free text. both = a unison moment, not a lane. women and men are the two canonical lanes and carry the colours and the editor shorthand. Anything else is a part the choir named ("Women 1", "Descant"), rendered as typed, lanes stacked in order of first appearance.';

-- Verify as postgres, not through the anon key: a table reached with no RLS
-- policy reads as empty and every check below would pass on nothing.
--
--   SELECT DISTINCT part FROM song_voice_lines ORDER BY part;
--   -- expect: both, men, women  (plus any the choir has since named)
--
-- Rollback. Only safe while every part is still one of the three: with a
-- named part anywhere this fails, which is the point -- it refuses rather
-- than deleting somebody's arrangement.
--
--   ALTER TABLE song_voice_lines DROP CONSTRAINT IF EXISTS song_voice_lines_part_chk;
--   ALTER TABLE song_voice_lines ADD  CONSTRAINT song_voice_lines_part_chk
--     CHECK (part IN ('women', 'men', 'both'));
