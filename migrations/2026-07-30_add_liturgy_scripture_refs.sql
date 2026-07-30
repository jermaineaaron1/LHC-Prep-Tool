-- Migration: add optional scripture cross-reference list to liturgy_items table
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jypzhumcdifxnazexdcu/sql/new
--
-- Part of the Liturgy page's "Sacred Library" redesign -- lets a liturgy item
-- (e.g. a meditation, exegetical note, or reading) carry one or more Bible
-- references (e.g. ["Jn 3:16", "Rom 10:9"]) shown as chips in the item's
-- detail panel. Purely additive:
--   - Nullable JSONB array column, no default that rewrites existing rows.
--   - Existing SELECT * / INSERT / UPDATE statements against `liturgy_items`
--     are unaffected; only new code that explicitly reads/writes
--     `scripture_refs` will ever see it.
--   - IMPORTANT: run this BEFORE deploying the frontend change that adds
--     `scripture_refs` to the item row-mapping (SBQ_LITURGY._itemToRow /
--     _rowToItem in Index.html) -- Supabase's REST API rejects an entire
--     insert/update if the payload references a column that doesn't exist
--     yet, so deploying the frontend first would break ALL liturgy item
--     saves, not just ones using this new field.
--
-- Safe to re-run (IF NOT EXISTS).
ALTER TABLE liturgy_items
  ADD COLUMN IF NOT EXISTS scripture_refs JSONB;

COMMENT ON COLUMN liturgy_items.scripture_refs IS
  'Optional array of Bible reference strings (e.g. ["Jn 3:16","Rom 10:9"]) for the Sacred Library detail panel''s scripture cross-reference display. Populated via the existing Bible Browser or typed manually; does not affect content, slides, or projection.';
