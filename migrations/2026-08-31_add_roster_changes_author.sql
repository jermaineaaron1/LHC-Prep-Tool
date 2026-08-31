-- Migration: record WHO made each roster change.
--
-- WHY
-- roster_changes has always stored what changed and when, but never by whom.
-- When two PICs edit the same Sunday, the roster can only say "someone else
-- changed this" -- which is exactly the moment a name would settle it.
--
-- The app sends changed_by optimistically and retries without it if this
-- migration has not been applied yet, so it is safe to deploy the app first
-- and run this whenever. Applying it simply makes the author stick.
--
-- Safe to re-run.

ALTER TABLE roster_changes ADD COLUMN IF NOT EXISTS changed_by TEXT;

-- The conflict prompt reads the recent history for one cell: role + date,
-- newest first. Without this it is a sequential scan of the whole log on every
-- conflicting cell.
CREATE INDEX IF NOT EXISTS roster_changes_cell_recent_idx
  ON roster_changes (role_id, service_date, changed_at DESC);

-- Existing rows keep changed_by NULL. That is deliberate: they were written
-- before anyone was recorded, and inventing an author for them would be worse
-- than admitting we do not know. The UI shows "someone" for those.
