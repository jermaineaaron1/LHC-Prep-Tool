-- The parts of the band a reader plays or sings, kept with their name.
--
-- Layers > "Drawings meant for" in the Songbook's reading view says which
-- parts a reader plays or sings (Guitar, Singers...), and so which drawings
-- meant for one part they are shown (song_marks.part). Until this it was
-- kept on the device alone (localStorage lhc_sbm_parts): on a new phone,
-- giving your name brought your own drawings back but not your parts, so
-- drawings other people had made for your part stayed hidden until you
-- ticked them again.
--
-- One row per drawer. owner is the name folded to lower case with single
-- spaces, exactly as song_marks.owner is, so the same name on another device
-- is the same row; owner_name is the name as they wrote it; parts the part
-- ids (leader, vocals, guitar, bass, keys, drums).
--
-- Nobody signs in to this app: like the rest of layers this is about what
-- the app SHOWS, not a lock. Every row can be read and written through the
-- app's key, like the rest of the data. Until this is run the parts stay on
-- each device, as before, and the app says so.
--
-- RLS matching the rest of the app (public anon access; tighten if auth is
-- added). Without the policies the table reads as EMPTY through the anon
-- key. Run in the Supabase SQL editor as postgres.

create table if not exists public.drawer_prefs (
  owner       text primary key,                   -- the drawer's name, folded
  owner_name  text,                               -- ...as they wrote it
  parts       text[] not null default '{}',       -- what they play or sing
  updated_at  timestamptz not null default now()
);

alter table public.drawer_prefs enable row level security;

grant select, insert, update on public.drawer_prefs to anon, authenticated;

drop policy if exists "anon_select_drawer_prefs" on public.drawer_prefs;
create policy "anon_select_drawer_prefs"
  on public.drawer_prefs for select
  using (true);

drop policy if exists "anon_insert_drawer_prefs" on public.drawer_prefs;
create policy "anon_insert_drawer_prefs"
  on public.drawer_prefs for insert
  with check (true);

drop policy if exists "anon_update_drawer_prefs" on public.drawer_prefs;
create policy "anon_update_drawer_prefs"
  on public.drawer_prefs for update
  using (true)
  with check (true);
