-- Migration: give songbook projections their own tables
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jypzhumcdifxnazexdcu/sql/new
--
-- WHY
-- Everything a songbook's projection knows -- the saved versions, their
-- slides, their backgrounds, which one is active -- has been living inside
-- orders.template, a single JSON column that also carries the inbox, the
-- fonts, the section layout and the cleared sections. Every writer of that
-- column rewrites the whole of it, so ANY of them getting it wrong takes the
-- projection work with it. That is not hypothetical: SBQ.patchInbox merged
-- from a variable nothing ever assigned and reduced the column to {_inbox},
-- and a standalone songbook never wrote the column at all. Both are fixed,
-- but the shape stays dangerous while one blob holds unrelated things.
--
-- These tables give each saved version its own row. A version can then be
-- written, read and deleted on its own, and no unrelated save can flatten it.
--
-- WHAT IT DOES NOT DO
-- Purely additive. No existing table or column is touched, and nothing is
-- removed from orders.template -- the app keeps mirroring versions there as a
-- backup, so rolling the frontend back loses nothing. Before this migration
-- runs the app simply keeps using the template exactly as it does today
-- (every call is wrapped and a missing table is treated as "not available"),
-- so there is no ordering dependency with the deploy.
--
-- owner_id is orders.id, including the 'standalone_<songbookId>' rows that
-- back songbooks created from Song Finder. Deliberately NOT a foreign key:
-- a standalone songbook's orders row is created lazily, only once it has
-- something worth keeping, and an FK would refuse the version row until then.
-- The app deletes these rows itself when an order is deleted.
--
-- Safe to re-run (IF NOT EXISTS).

-- ── One row per saved version ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projection_versions (
  id         TEXT        PRIMARY KEY,          -- client-generated, e.g. 'pv_1786704731128'
  owner_id   TEXT        NOT NULL,             -- orders.id, incl. 'standalone_<sbId>'
  name       TEXT        NOT NULL,
  deck       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER     NOT NULL DEFAULT 0,   -- the order they appear in the Project menu
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS projection_versions_owner_idx
  ON projection_versions (owner_id, sort_order);

ALTER TABLE projection_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_projection_versions" ON projection_versions;

CREATE POLICY "anon_all_projection_versions"
  ON projection_versions FOR ALL
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON projection_versions TO anon;

-- ── One row per songbook: which projection is active, plus the draft ──────
-- The unnamed working draft lives here too. It is the one piece of projection
-- state that is not a saved version, and it deserves the same protection.
CREATE TABLE IF NOT EXISTS projection_settings (
  owner_id   TEXT        PRIMARY KEY,          -- orders.id, incl. 'standalone_<sbId>'
  source     TEXT,                             -- 'asis' | 'draft' | <projection_versions.id>
  lcd_source TEXT,                             -- NULL = LCD follows the songbook's choice
  draft_deck JSONB       NOT NULL DEFAULT '{}'::jsonb,
  draft_base TEXT,                             -- version the draft was copied from, if any
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE projection_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_projection_settings" ON projection_settings;

CREATE POLICY "anon_all_projection_settings"
  ON projection_settings FOR ALL
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON projection_settings TO anon;

-- ============================================================
-- Done. The app imports what is already in orders.template the first time it
-- opens each songbook after this runs, so existing versions move across on
-- their own -- nothing to do by hand.
--
-- To verify:
-- 1. Open a songbook that has saved versions, then run:
--      SELECT owner_id, name, sort_order FROM projection_versions ORDER BY owner_id, sort_order;
--    Its versions should be listed.
-- 2. Save a new version in Project mode and re-run the query -- it appears
--    immediately, without waiting for the order's own autosave.
-- 3. Reload the app, reopen the songbook, and check the Project menu still
--    lists every version with the right slides and backgrounds.
-- ============================================================
