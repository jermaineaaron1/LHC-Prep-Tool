-- Remarks DRAWN on a song in the Worship Songbook's reading view: a ring
-- round a word, an arrow, a breath mark -- quicker than typing, and seen
-- by everyone who opens the song.
--
-- One row per stroke. A stroke is kept against an ANCHOR -- one moment of
-- the choir score ("s:Verse 1|3") or one line of the lyrics ("l:12") -- as
-- fractions of that anchor's box, so it lands on the same words on a phone
-- held either way and on a desk, where the same anchor sits somewhere else
-- and is another size. The app probes for this table once and offers
-- nothing until it exists.
--
-- RLS matching the rest of the app (public anon access, tighten if auth is
-- added). Run in the Supabase SQL editor as postgres.

create table if not exists public.song_marks (
  id          uuid primary key default gen_random_uuid(),
  song_id     text not null,                    -- the song, as in song_recordings
  anchor      text not null,                    -- "s:<section>|<n>" or "l:<n>"
  tool        text not null default 'pen',
  colour      text not null default '#111827',
  width       real not null default 4,          -- the pen, in CSS pixels
  points      jsonb not null,                   -- [[fx, fy], ...] of the anchor's box
  created_at  timestamptz not null default now()
);

create index if not exists idx_song_marks_song on public.song_marks (song_id);

alter table public.song_marks enable row level security;

drop policy if exists "anon_all_song_marks" on public.song_marks;
create policy "anon_all_song_marks"
  on public.song_marks for all
  using (true)
  with check (true);
