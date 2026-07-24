-- Migration: add calendar_sync_events, the Google Calendar push-sync mapping table
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/jypzhumcdifxnazexdcu/sql/new
--
-- Backs the Google Calendar "push" integration (Phase 3 of the roster calendar
-- work): one row per duty-slot that has ever been synced to Google Calendar,
-- tracking which Google event corresponds to which (month, year, role_id,
-- service_date) roster cell so a re-sync PATCHes the same event instead of
-- creating a duplicate. The unique key intentionally matches roster's own
-- upsert conflict target (month, year, role_id, service_date) -- this table
-- is a 1:1 shadow of roster, one Google Calendar event per duty-slot (not
-- one event per person), so reassigning a cell from person A to person B
-- reuses the same google_event_id and just patches its attendee.
--
-- Safe to re-run (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS calendar_sync_events (
  id               BIGSERIAL   PRIMARY KEY,
  role_id          TEXT        NOT NULL,
  service_date     TEXT        NOT NULL,   -- "Mon D", matches roster.service_date exactly
  month            INTEGER     NOT NULL,   -- matches roster.month (0-indexed)
  year             INTEGER     NOT NULL,
  google_event_id  TEXT,                   -- null until first successful Google Calendar create
  assigned_name    TEXT        NOT NULL DEFAULT '',   -- roster.value as of the last successful sync
  attendee_email   TEXT,                   -- email actually used for the invite; null = no email on file
  sync_status      TEXT        NOT NULL DEFAULT 'pending', -- 'synced' | 'no_email' | 'name_not_found' | 'error'
  last_error       TEXT,
  last_synced_at   TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT calendar_sync_events_unique UNIQUE (month, year, role_id, service_date)
);

CREATE INDEX IF NOT EXISTS calendar_sync_events_month_year_idx ON calendar_sync_events (month, year);
CREATE INDEX IF NOT EXISTS calendar_sync_events_status_idx ON calendar_sync_events (sync_status) WHERE sync_status <> 'synced';

COMMENT ON TABLE calendar_sync_events IS
  'Maps roster duty-slots to their pushed Google Calendar event IDs. Written only by server-side API routes (service-role key) -- the browser has no reason to read or write this table directly, unlike every other table in this app.';

-- ============================================================
-- ROW LEVEL SECURITY -- deliberately NOT the "anon: full access" pattern
-- used by every other migration in this app. This table is pure
-- sync-plumbing state written by the calendar-sync/calendar-reconcile
-- API routes using the Supabase service-role key, which bypasses RLS
-- entirely -- so no anon policy is needed or granted here.
-- ============================================================
ALTER TABLE calendar_sync_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Done! After running, no visible change in the app yet -- this table is
-- only used once the /api/calendar-sync and /api/calendar-reconcile routes
-- are deployed with valid Google credentials.
-- ============================================================
