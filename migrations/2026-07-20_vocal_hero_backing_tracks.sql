-- Vocal Hero backing-track metadata and Storage bucket.
-- Review and run manually in the Supabase SQL Editor before enabling production uploads.
-- The bucket is public-read so every connected player can retrieve the shared backing track.
-- Writes are never opened to anon users: the app requests a short-lived signed upload URL
-- from the server-side service-role route.

alter table public.vh_songs
  add column if not exists backing_media_url text,
  add column if not exists backing_media_kind text check (backing_media_kind in ('audio', 'video')),
  add column if not exists backing_track_settings jsonb not null default '{
    "volume": 1,
    "speed": 1,
    "timeline_offset": 0,
    "trim_start": 0,
    "trim_end": null,
    "loop_start": 0,
    "loop_end": null,
    "loop_enabled": false,
    "skip_regions": [],
    "split_markers": [],
    "media_duration": null,
    "effect": "none"
  }'::jsonb;

insert into storage.buckets (id, name, public)
values ('vocal-hero-media', 'vocal-hero-media', true)
on conflict (id) do update set public = true;
