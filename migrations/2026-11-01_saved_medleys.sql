-- Saved medleys: medleys kept, to be sung again.
--
-- Every medley saved in the Songbook's medley editor (or the Liturgy
-- Builder's) is kept here: its songs by library id, in the order they are
-- sung, each with the key it was sung in (transpose_steps from the song's
-- own key). One row per sequence of songs -- song_key is their ids joined in
-- order -- so saving the same medley again only brings it back to the top.
-- The editor lists the latest five and, under See more, the rest; Use brings
-- one into the service or songbook open, adding the songs it lacks.
--
-- songs holds [{ songId, title, transposeSteps }].
--
-- RLS matching the rest of the app (public anon access, tighten if auth is
-- added). Run in the Supabase SQL editor as postgres.

create table if not exists public.saved_medleys (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,                 -- "Silent Night → Holy Holy Holy → O Holy Night"
  songs           jsonb not null,
  song_key        text not null,                 -- the songs' library ids, in order, joined by '>'
  made_from       text,                          -- the order or songbook it was last saved from
  made_from_name  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists idx_saved_medleys_song_key on public.saved_medleys (song_key);
create index if not exists idx_saved_medleys_updated on public.saved_medleys (updated_at desc);

alter table public.saved_medleys enable row level security;

drop policy if exists "anon_all_saved_medleys" on public.saved_medleys;
create policy "anon_all_saved_medleys"
  on public.saved_medleys for all
  using (true)
  with check (true);
