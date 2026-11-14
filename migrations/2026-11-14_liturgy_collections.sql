-- Service collections beyond the Liturgy page's fixed list (2026-11-14).
--
-- The Liturgy Library's Services page lists the services the app has always
-- known (OCCASIONS in Index.html: the Sundays, the church year, the rites).
-- The operator asked for "Create Service Collection" -- All Souls' Day, a
-- training, a guest speaker -- so a collection somebody adds lives here, and
-- the page adds it to that list when it loads. A library item files under it
-- exactly as under a built-in one: liturgy_items.occasion_id = this id.
--
-- Nothing is deleted from here by the app.
--
-- RLS matching the rest of the app (public anon access, tighten if auth is
-- added). Run in the Supabase SQL editor as postgres. Until it is run, the
-- Services page says so and Create is refused.

create table if not exists public.liturgy_collections (
  id           text primary key,              -- 'col-all-souls-day-mhx3k2'
  label        text not null,                 -- "All Souls' Day"
  description  text,
  colour       text,                          -- green / purple / red / white / blue / black, or null
  icon         text,                          -- a Font Awesome name, 'fa-dove'
  created_at   timestamptz not null default now()
);

alter table public.liturgy_collections enable row level security;

drop policy if exists "anon_all_liturgy_collections" on public.liturgy_collections;
create policy "anon_all_liturgy_collections"
  on public.liturgy_collections for all
  using (true)
  with check (true);
