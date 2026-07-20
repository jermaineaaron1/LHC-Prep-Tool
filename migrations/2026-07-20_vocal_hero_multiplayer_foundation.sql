-- Vocal Hero multiplayer foundation — review and run manually in Supabase SQL Editor.
-- This is additive only: no existing tables, columns, policies, or scores are removed.

alter table vh_game_sessions
  add column if not exists playback_starts_at timestamptz,
  add column if not exists countdown_seconds integer not null default 5,
  add column if not exists lead_in_seconds integer not null default 2;

alter table vh_session_players
  add column if not exists is_spectator boolean not null default false,
  add column if not exists ready_at timestamptz,
  add column if not exists mic_status text not null default 'unknown',
  add column if not exists last_seen_at timestamptz;

create table if not exists vh_player_round_stats (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references vh_game_sessions(id) on delete cascade,
  player_id uuid not null references vh_session_players(id) on delete cascade,
  score integer not null default 0,
  accuracy integer not null default 0,
  notes_attempted integer not null default 0,
  notes_hit integer not null default 0,
  timing_offset_ms integer,
  updated_at timestamptz not null default now(),
  unique(session_id, player_id)
);

create table if not exists vh_session_part_scores (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references vh_game_sessions(id) on delete cascade,
  part_index integer not null check (part_index between 0 and 3),
  active_players integer not null default 0,
  normalized_score numeric not null default 0,
  normalized_accuracy numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique(session_id, part_index)
);

-- Averages, not sums, keep a section with ten singers from winning purely on size.
create or replace function vh_upsert_player_round_stats(
  p_session_id uuid, p_player_id uuid, p_score integer, p_accuracy integer,
  p_notes_attempted integer, p_notes_hit integer, p_timing_offset_ms integer default null
) returns void language plpgsql as $$
begin
  insert into vh_player_round_stats (
    session_id, player_id, score, accuracy, notes_attempted, notes_hit, timing_offset_ms, updated_at
  ) values (
    p_session_id, p_player_id, p_score, p_accuracy, p_notes_attempted, p_notes_hit, p_timing_offset_ms, now()
  ) on conflict (session_id, player_id) do update set
    score = excluded.score, accuracy = excluded.accuracy,
    notes_attempted = excluded.notes_attempted, notes_hit = excluded.notes_hit,
    timing_offset_ms = excluded.timing_offset_ms, updated_at = now();

  insert into vh_session_part_scores (
    session_id, part_index, active_players, normalized_score, normalized_accuracy, updated_at
  )
  select sp.session_id, sp.part_index,
    count(*) filter (where prs.notes_attempted > 0),
    coalesce(avg(prs.score) filter (where prs.notes_attempted > 0), 0),
    coalesce(avg(prs.accuracy) filter (where prs.notes_attempted > 0), 0), now()
  from vh_session_players sp
  left join vh_player_round_stats prs on prs.session_id = sp.session_id and prs.player_id = sp.id
  where sp.session_id = p_session_id and sp.is_spectator = false
  group by sp.session_id, sp.part_index
  on conflict (session_id, part_index) do update set
    active_players = excluded.active_players, normalized_score = excluded.normalized_score,
    normalized_accuracy = excluded.normalized_accuracy, updated_at = now();
end;
$$;

alter table vh_player_round_stats enable row level security;
alter table vh_session_part_scores enable row level security;
drop policy if exists vh_player_round_stats_public_all on vh_player_round_stats;
create policy vh_player_round_stats_public_all on vh_player_round_stats for all using (true) with check (true);
drop policy if exists vh_session_part_scores_public_all on vh_session_part_scores;
create policy vh_session_part_scores_public_all on vh_session_part_scores for all using (true) with check (true);

do $$ begin alter publication supabase_realtime add table vh_game_sessions; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table vh_player_round_stats; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table vh_session_part_scores; exception when duplicate_object then null; end $$;
