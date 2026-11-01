-- Whose a drawn remark is, and whether anybody else sees it.
--
-- A drawing in the Songbook's reading view (song_marks) is its drawer's own
-- until they share it, so many people can mark up one chord sheet without
-- crowding it for everybody else. Nobody signs in to this app: "who" is a
-- name and a part the reader gives on their device, and owner is that name
-- folded to lower case with single spaces, so the same name on another
-- device is the same person. "Only me" is about what the app SHOWS, not a
-- lock -- every row stays readable through the app's key, like the rest of
-- the data.
--
-- Rows from before this have no owner and stay shared ("Earlier drawings").
-- Until this is run every drawing is everybody's, as it always was, and the
-- Layers button is not shown.
--
-- Run in the Supabase SQL editor as postgres.

alter table public.song_marks add column if not exists owner      text;               -- the drawer's name, folded
alter table public.song_marks add column if not exists owner_name text;               -- ...as they wrote it
alter table public.song_marks add column if not exists part       text;               -- leader | vocals | guitar | bass | keys | drums | other
alter table public.song_marks add column if not exists shared     boolean not null default true;

create index if not exists idx_song_marks_owner on public.song_marks (song_id, owner);
