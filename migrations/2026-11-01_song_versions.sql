-- Versions of a song: the way a service sings it -- its key, its own words
-- and chords when they were changed, and the remarks drawn on it in the
-- Worship Songbook's reading view -- kept WITH THE SONG, so a later service
-- can sing it that way again.
--
-- Every song also has its Standard version, which needs no row here: the
-- song's own key and words, and the drawn remarks that carry no version
-- (song_marks.version_id is null -- every remark drawn before this change).
--
-- Which version a service sings is kept on its copy of the song
-- (order_items.customizations.versionId; empty or missing = Standard).
-- Choosing a version copies its key and words onto that copy -- the words
-- exactly as the service that saved it had them, so the two show the same
-- -- and its drawn remarks are read from song_marks by version_id, so they
-- are shared by every service singing that version and by nobody else.
--
-- RLS matching the rest of the app (public anon access, tighten if auth is
-- added). Run in the Supabase SQL editor as postgres. The app probes for
-- both changes and offers Versions only once both are there.

create table if not exists public.song_versions (
  id               uuid primary key default gen_random_uuid(),
  song_id          text not null,                -- the song (songs.id)
  name             text not null,
  transpose_steps  integer not null default 0,   -- semitones from the song's own key
  lyrics           text,                         -- its words and chords as the service had them
  rich_lyrics      text,                         -- and as the songbook drew them; both null = the song's own
  made_from        text,                         -- the order it was first saved from
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_song_versions_song on public.song_versions (song_id);

alter table public.song_versions enable row level security;

drop policy if exists "anon_all_song_versions" on public.song_versions;
create policy "anon_all_song_versions"
  on public.song_versions for all
  using (true)
  with check (true);

-- A drawn remark belongs to one version of its song; null is Standard.
-- Deleting a version deletes its remarks with it.
alter table public.song_marks
  add column if not exists version_id uuid references public.song_versions (id) on delete cascade;

create index if not exists idx_song_marks_version on public.song_marks (version_id);
