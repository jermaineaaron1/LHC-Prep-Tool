-- Migration: add roster.pending_confirmation + roster_member_meta.team
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jypzhumcdifxnazexdcu/sql/new
--
-- Part of the Roster monthly auto-fill feature. Two independent additive
-- columns:
--   1. roster.pending_confirmation -- true for any cell the auto-fill wrote
--      that a PIC hasn't reviewed yet. Rendered as a persistent yellow
--      highlight visible to any viewer until a PIC explicitly confirms --
--      not just a local/session marker.
--   2. roster_member_meta.team -- 'traditional' | 'contemporary' | 'both' |
--      NULL. Which team a person belongs to, independent of role. NULL
--      means "not yet categorized" -- the auto-fill treats that as eligible
--      for either team and flags it, so incomplete team data never
--      silently blocks a role from filling.
--
-- Per-date service type needs NO new column -- it's a normal roster row
-- with role_id='service_type' in the SAME roster table, reusing the
-- existing save/load path exactly like the 'liturgical' day/color row
-- already does (already shipped and verified in a prior deploy step).
--
-- Safe to re-run. Both roster and roster_member_meta already have working
-- anon RLS policies (USING true / WITH CHECK true) covering all columns --
-- confirmed by existing phone/email/day/color/name writes succeeding today
-- -- so no new policy or grant is needed for these two new columns.
ALTER TABLE roster ADD COLUMN IF NOT EXISTS pending_confirmation BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE roster_member_meta ADD COLUMN IF NOT EXISTS team TEXT;

CREATE INDEX IF NOT EXISTS roster_pending_confirmation_idx
  ON roster (month, year) WHERE pending_confirmation = true;

-- ============================================================
-- Done! After running, open the Worship Roster and Enablers modal -- no
-- visible change yet (the columns aren't wired into the UI until the next
-- deploy step), but confirm no errors appear when the roster loads/saves.
-- ============================================================
