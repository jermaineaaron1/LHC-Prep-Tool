-- Migration: song_recordings
-- Created: 2026-07-04
--
-- Purpose: Store audio recordings made inside the Worship Songbook.
-- Each recording is uploaded to Supabase Storage bucket "songbook-recordings"
-- and its metadata is tracked here.
--
-- Security notes:
--   - RLS is enabled; the public-access policy (matching the rest of this app)
--     allows anon reads and writes. Tighten this if you add auth later.
--   - The storage bucket should be set to PRIVATE (not public) in the dashboard.
--     Pre-signed URLs are used for playback so the files are never publicly listed.
--   - Limit: 10 recordings per (song_id, order_id) pair is enforced in app code.
--     No DB-level check is added to keep the migration simple.
--
-- Manual steps after running this SQL:
--   1. Go to Supabase Dashboard → Storage → New bucket
--   2. Name: songbook-recordings
--   3. Public: OFF (private bucket)
--   4. File size limit: 50 MB (enough for ~50 min of voice at 128kbps)
--   5. Allowed MIME types: audio/webm, audio/ogg, audio/mp4, audio/wav
--
-- Run this in the Supabase SQL Editor. Do not run it more than once.

create table if not exists song_recordings (
  id            uuid primary key default gen_random_uuid(),
  song_id       text not null,           -- matches the song id used in WO module
  order_id      uuid references orders(id) on delete cascade,
  name          text not null default 'Recording',
  storage_path  text not null,           -- path inside the songbook-recordings bucket
  duration_sec  numeric(8,2) default 0,  -- recorded duration in seconds
  created_at    timestamptz default now()
);

-- Index for fast lookup by song inside an order
create index if not exists idx_song_recordings_song
  on song_recordings (order_id, song_id);

-- RLS matching the rest of the app (public anon access, tighten if auth is added)
alter table song_recordings enable row level security;

drop policy if exists "anon_all_song_recordings" on song_recordings;
create policy "anon_all_song_recordings"
  on song_recordings for all
  using (true)
  with check (true);
