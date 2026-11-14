-- A service's plan, one row per entry (2026-11-14).
--
-- The Liturgy Library's service page has Planning Notes, Special Planning and
-- a Checklist, drawn by the operator. Each belongs to one service DATE (the
-- operator chose "each service date": the next service's plan is shown, and an
-- earlier one can be copied forward). Every note, special planning item,
-- checklist task and imported reference is one row here, so two people
-- working on one plan never write over each other.
--
--   kind      'note' | 'special' | 'task' | 'ref'
--   category  'decor', 'banner', 'flowers', 'music', 'presentation', 'guest',
--             'songs', 'media', 'liturgy', 'docs', 'communion', 'followup'
--             (a reference: 'songs' or 'link')
--   status    notes and special items: 'draft' | 'planned' | 'progress' | 'ready'
--   who       who does it (a task, a special item) -- Team Planning went;
--             "the checklist should already mention who does what"
--   note_id   a task made from a note
--   links     [{ url, kind: 'video'|'audio'|'chords'|'link'|'performance'|'note', label }]
--             ('note' links one note to another: url is that note's id)
--   files     [{ url, path, name, size, type, role: 'file'|'performance', at }]
--             in the 'Liturgy Files' bucket under plans/<occasion>/<date>/;
--             the app refuses anything over 50 MB (the operator's choice: a
--             longer performance video is a YouTube or Drive link instead).
--
-- RLS matching the rest of the app (public anon access, tighten if auth is
-- added). Run in the Supabase SQL editor as postgres. Until it is run, the
-- planning tabs say so and nothing is saved.

create table if not exists public.service_plan_items (
  id           text primary key,                    -- 'spi-<time>-<random>'
  occasion_id  text not null,                       -- 'ordinary-contemporary', 'good-friday', ...
  service_key  text not null,                       -- '2026-11-15', '2026-12-31|pm'
  kind         text not null,
  category     text,
  title        text not null default '',
  body         text,
  status       text,
  who          text,
  due          date,
  done         boolean not null default false,
  note_id      text,
  links        jsonb not null default '[]'::jsonb,
  files        jsonb not null default '[]'::jsonb,
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_service_plan_items_occasion on public.service_plan_items (occasion_id, service_key);

alter table public.service_plan_items enable row level security;

drop policy if exists "anon_all_service_plan_items" on public.service_plan_items;
create policy "anon_all_service_plan_items"
  on public.service_plan_items for all
  using (true)
  with check (true);
