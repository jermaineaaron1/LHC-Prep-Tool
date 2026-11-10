-- The Sunday bulletin: one row per service.
--
-- The bulletin is mostly the roster said another way -- both Sundays' duties
-- and the four readings are read live from `roster` every time it is opened,
-- and are NOT stored here. What is stored is only what somebody types: the
-- prayer of the day, the announcements, the attendance and offering figures,
-- the giving details, the contacts, the theme verse, and the two duties the
-- roster has no role for (Acolyte, Flower Offering).
--
-- Storing the duties too would mean a bulletin quietly disagreeing with the
-- roster the week somebody swapped a reader -- the whole point of the roster
-- is that it is the one place a duty lives (CLAUDE.md gotcha 5).
--
-- `data` holds { v, verse, prayer, notices[], giving, attendance, offering[],
-- contacts[], manual{}, hidden{} }. Every list in it is one the admin can add
-- to or take from, which is why they are arrays and not fixed columns.
--
-- One bulletin per service: `service_date` is the roster's own date string
-- ("Nov 15", with no year -- see CLAUDE.md gotcha 2), so `year` has to be
-- part of the key or two Novembers collide.
--
-- RLS matching the rest of the app (public anon access, tighten if auth is
-- added). Run in the Supabase SQL editor as postgres.

create table if not exists public.bulletins (
  id            uuid primary key default gen_random_uuid(),
  service_date  text not null,                 -- "Nov 15", as the roster writes it
  year          int  not null,
  title         text,                          -- "Sunday Bulletin 15 Nov 2026"
  data          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One bulletin per service, and the upsert the app uses depends on it.
create unique index if not exists idx_bulletins_service
  on public.bulletins (service_date, year);

-- "The most recent few", for the picker.
create index if not exists idx_bulletins_recent
  on public.bulletins (year desc, updated_at desc);

alter table public.bulletins enable row level security;

drop policy if exists "anon_all_bulletins" on public.bulletins;
create policy "anon_all_bulletins"
  on public.bulletins for all
  using (true)
  with check (true);
