-- What people add to a past service's memory (2026-11-14).
--
-- The Liturgy Library's Memories page shows EVERY past service by itself,
-- built from what is already kept: its order (songs, slides, liturgy), the
-- roster (the day, its colour, the readings, who served) and anything filed
-- under it. "Add Memory" gives one service a few words and photographs, and
-- that is all this table holds: one row per service, keyed as the Readings
-- page keys a service ('YYYY-MM-DD', with '|pm' on the end for an evening).
--
-- photos is a list of { url, path, name, at }: the files themselves are in
-- the 'Liturgy Files' storage bucket under memories/<service key>/. The app
-- makes each one smaller on the device (1600px, JPEG) before uploading it.
--
-- RLS matching the rest of the app (public anon access, tighten if auth is
-- added). Run in the Supabase SQL editor as postgres. Until it is run, the
-- Memories page still shows every past service, and says that descriptions
-- and photographs need this.

create table if not exists public.service_memories (
  service_key  text primary key,                  -- '2026-11-08', '2026-12-31|pm'
  order_id     text,                              -- the order it was, when there was one (no foreign key: deleting an order keeps its memory)
  occasion_id  text,                              -- set only to file it under a service other than the day's own
  title        text,                              -- null: the liturgical day's name
  description  text,
  photos       jsonb not null default '[]'::jsonb,
  updated_at   timestamptz not null default now()
);

alter table public.service_memories enable row level security;

drop policy if exists "anon_all_service_memories" on public.service_memories;
create policy "anon_all_service_memories"
  on public.service_memories for all
  using (true)
  with check (true);
