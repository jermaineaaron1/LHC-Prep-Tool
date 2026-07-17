-- Migration: add optional per-song display-appearance override to songs table
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jypzhumcdifxnazexdcu/sql/new
--
-- Adds a font/size/colour override for the Songs page lyrics & chords
-- workspace preview (lyrics and chords styled independently). Purely
-- additive and backward-compatible:
--   - Nullable JSONB column, no default that rewrites existing rows.
--   - Does NOT touch the `lyrics` column or its meaning in any way.
--   - Render-time only: transpose, projection slides, print/PDF, and
--     Songbook rendering all read the plain-text `lyrics` column directly
--     and are unaffected by this column's presence or contents.
--   - Existing SELECT * / INSERT / UPDATE statements against `songs` are
--     unaffected; only new code that explicitly reads `display_style` will
--     ever see it.
--
-- Shape once populated (all keys optional):
--   { "lyricFont": "Georgia, serif", "lyricSize": "16px", "lyricColor": "#1f2933",
--     "chordFont": "Courier New, monospace", "chordSize": "14px", "chordColor": "#991b1b" }
--
-- Safe to re-run (IF NOT EXISTS).
ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS display_style JSONB;

COMMENT ON COLUMN songs.display_style IS
  'Optional per-song lyrics/chords display preferences (font, size, colour) for the Songs workspace preview. Render-time only -- does not affect the lyrics text, transpose, projection, or print/PDF output.';
