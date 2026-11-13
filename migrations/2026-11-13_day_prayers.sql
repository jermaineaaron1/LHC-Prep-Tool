-- The Prayer of the Day, one row per service date.
--
-- Imported from the church's own document (Readings > Import prayers), which
-- lists a prayer under each service date, and edited by hand from the same
-- page. Three places read it for their date: the Liturgy Builder and LCD
-- Projection put it into an upcoming order's "Prayer of the Day" slides, and
-- the Sunday bulletin prints it.
--
-- It is NOT a roster row. The readings are (CLAUDE.md gotcha 5) because each
-- is a short reference somebody picks per service, edited in the roster grid
-- alongside the duties. A prayer is a paragraph of prose; in the grid it
-- would be a cell nobody could read, and nothing in the roster wants it.
--
-- `service_key` is the date the way the Readings page keys a service:
-- 'YYYY-MM-DD', with '|pm' on the end for an evening service on a day that
-- has a morning one too (the Watchnight). Text, so it sorts and compares as
-- a date does, and one row per service by construction.
--
-- RLS matching the rest of the app (public anon access, tighten if auth is
-- added). Run in the Supabase SQL editor as postgres. Until it is run the
-- app says so where the prayers would be, and nothing is saved.

create table if not exists public.day_prayers (
  service_key  text primary key,            -- '2026-11-15', '2026-12-31|pm'
  prayer       text not null,               -- the words, as the document has them
  occasion     text,                        -- the day's name, if the document gives one
  source_file  text,                        -- the document it came from, or null if typed
  source_url   text,
  updated_at   timestamptz not null default now()
);

alter table public.day_prayers enable row level security;

drop policy if exists "anon_all_day_prayers" on public.day_prayers;
create policy "anon_all_day_prayers"
  on public.day_prayers for all
  using (true)
  with check (true);
