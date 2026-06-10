-- Add game_notes column to vh_songs for the Vocal Hero piano-roll game format
-- Notes format: [{m: midiNumber, start: seconds, dur: seconds, l: lyric, phrase: string}]
alter table vh_songs
  add column if not exists game_notes jsonb default '[]'::jsonb;
