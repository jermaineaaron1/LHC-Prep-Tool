-- Migration: the Media Tray's drawer travels with the file
-- Run this in your Supabase SQL Editor.
--
-- lhc_backgrounds shares the INDEX of the media library so every user's Media
-- Tray shows the same files (the files themselves are already in Storage).
-- It carried no drawer, so a row read back on another device had no category
-- and _lcdItemCategory() answered 'background' for all of them -- a shared
-- PowerPoint would have landed in Backgrounds, the one drawer that cannot
-- render it.
--
-- Documents were never written here at all (see _sbSaveBackgroundToSupabase),
-- so nothing is mis-filed today; this column is what lets them start being
-- shared without landing in the wrong drawer.
--
-- Safe to run twice. Existing rows stay NULL, which reads as 'background' --
-- exactly what they were before this column existed.

ALTER TABLE lhc_backgrounds ADD COLUMN IF NOT EXISTS category TEXT;

-- The app writes 'background' | 'presentation' | 'announcement'; anything else
-- (including NULL) is read as 'background'. Not a CHECK constraint: a client
-- running an older build must never have its upsert refused by a value this
-- column did not expect, because the file would then be shared with nobody.
COMMENT ON COLUMN lhc_backgrounds.category IS
  'Media Tray drawer: background | presentation | announcement. NULL reads as background.';
