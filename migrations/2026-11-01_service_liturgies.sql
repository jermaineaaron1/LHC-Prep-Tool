-- Service liturgies: a whole order of worship, kept for its occasion.
--
-- The Liturgy Builder saves an order's liturgy -- its sections, the liturgy,
-- readings and text slides in them, its songs and its notes -- against an
-- occasion of the church year (the Liturgy page's occasion ids: 'pentecost',
-- 'christmas-eve', ...) and a year. A later year's order for that occasion
-- uses it whole, changes what it needs, and saves over it or keeps a copy.
--
-- data holds { v, sectionLayout, clearedSections, items, songs, serviceNotes }
-- as the builder had them. order_type is the kind of service it was made
-- for; a section's place in that type's template gives it its reading slots,
-- so the builder uses a liturgy only in an order of the same type.
--
-- RLS matching the rest of the app (public anon access, tighten if auth is
-- added). Run in the Supabase SQL editor as postgres.

create table if not exists public.service_liturgies (
  id           uuid primary key default gen_random_uuid(),
  occasion_id  text not null,                  -- 'pentecost', 'christmas-eve', 'ordinary-traditional', ...
  year         int,                            -- the year it was made for
  title        text not null,                  -- "Pentecost Sunday 2026"
  order_type   text not null default 'traditional',
  data         jsonb not null,
  made_from    text,                           -- the order it was saved from
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_service_liturgies_occasion on public.service_liturgies (occasion_id, year desc);

alter table public.service_liturgies enable row level security;

drop policy if exists "anon_all_service_liturgies" on public.service_liturgies;
create policy "anon_all_service_liturgies"
  on public.service_liturgies for all
  using (true)
  with check (true);
