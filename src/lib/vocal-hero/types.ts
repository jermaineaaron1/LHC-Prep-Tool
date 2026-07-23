export interface SatbPart {
  name: 'Soprano' | 'Alto' | 'Tenor' | 'Bass';
  rangeMin: number;   // Hz
  rangeMax: number;   // Hz
  curve: number[];    // normalised 0–1, length = 24 keyframes
  aiGen: boolean;
  edits: number;
}

export interface TimedLyricSection {
  primary: string;
  translation: string;
  start: number;      // seconds
  end: number;        // seconds
  // Per-part normalized pitch 0-1: [soprano, alto, tenor, bass]
  // When present, overrides the parts[i].curve keyframe for this time range
  pitches?: [number, number, number, number];
}

export interface SongNote {
  id: string;
  part: number;      // 0=Soprano 1=Alto 2=Tenor 3=Bass -1=unassigned
  midi: number;      // MIDI note number (60=C4)
  start: number;     // seconds
  end: number;       // seconds
  lyric: string;     // syllable / word
  velocity: number;  // 0-127 (dynamics)
}

export interface BackingTrackClip {
  id: string;
  /** In-point in the uploaded audio/video file, in seconds. */
  source_start: number;
  /** Out-point in the uploaded audio/video file, in seconds. */
  source_end: number;
  /** Position of this clip on the shared SATB timeline, in seconds. */
  timeline_start: number;
}

export interface MusicalTimelineSettings {
  tempo_changes: Array<{ at: number; bpm: number }>;
  meter_changes: Array<{ at: number; numerator: number; denominator: number }>;
  key_changes: Array<{ at: number; tonic: string; mode: string }>;
  /** Fine placement grid. Triplet denominators (6/12/24/48) and 64/96 PPQN-style resolutions are supported. */
  snap_division?: 1 | 2 | 3 | 4 | 6 | 8 | 12 | 16 | 24 | 32 | 48 | 64 | 96 | 128 | 192;
  /** Default duration for newly drawn notes. Kept separate from the placement grid so mixed rhythms remain possible. */
  snap_value?: RhythmicNoteValue;
}

export type RhythmicNoteValue =
  | 'whole' | 'dotted-whole' | 'double-dotted-whole'
  | 'half' | 'dotted-half' | 'double-dotted-half' | 'half-triplet'
  | 'quarter' | 'dotted-quarter' | 'double-dotted-quarter' | 'quarter-triplet'
  | 'eighth' | 'dotted-eighth' | 'double-dotted-eighth' | 'eighth-triplet'
  | 'sixteenth' | 'dotted-sixteenth' | 'double-dotted-sixteenth' | 'sixteenth-triplet'
  | 'thirty-second' | 'dotted-thirty-second' | 'double-dotted-thirty-second' | 'thirty-second-triplet';

export interface BackingTrackSettings {
  volume: number;
  speed: number;
  /** Seconds to nudge the backing track relative to arrangement time. */
  timeline_offset: number;
  trim_start: number;
  trim_end: number | null;
  loop_start: number;
  loop_end: number | null;
  loop_enabled: boolean;
  skip_regions: Array<{ start: number; end: number }>;
  split_markers: number[];
  /** Non-destructive timeline edits. Empty/missing means one legacy trim clip. */
  clips?: BackingTrackClip[];
  media_duration?: number | null;
  effect: 'none' | 'warm' | 'bright';
  /** Musical ruler events stored with the arrangement for backwards-compatible mixed metre/key songs. */
  musical_timeline?: MusicalTimelineSettings;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  arranged_by: string;
  prim_lang: string;
  trans_lang: string;
  duration: number;   // seconds
  tags: string;
  status: 'draft' | 'processing' | 'ready' | 'error';
  parts: SatbPart[];
  timed_lyrics: TimedLyricSection[];
  notes?: SongNote[];     // DAW-style note events (replaces/augments timed_lyrics)
  game_notes?: Array<{ m: number; start: number; dur: number; l?: string; phrase?: string }>;
  pipeline_log: string;
  yt_url: string;
  audio_url?: string;     // direct audio URL for gameplay (MP3 in Supabase Storage)
  backing_media_url?: string;
  backing_media_kind?: 'audio' | 'video';
  backing_track_settings?: BackingTrackSettings;
  bpm?: number;
  time_sig?: number;
  created_at: string;
}

export interface GameSession {
  id: string;
  room_code: string;
  song_id: string;
  status: 'lobby' | 'playing' | 'ended';
  host_id: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  /** Absolute, server-issued playback time shared by every connected device. */
  playback_starts_at?: string | null;
  countdown_seconds?: number;
  lead_in_seconds?: number;
  paused?: boolean;
  restart_seq?: number;
}

export interface SessionPlayer {
  id: string;
  session_id: string;
  player_name: string;
  part_index: number;   // 0=Soprano, 1=Alto, 2=Tenor, 3=Bass
  score: number;
  accuracy: number;
  joined_at: string;
  is_spectator?: boolean;
  ready_at?: string | null;
  mic_status?: 'unknown' | 'ready' | 'blocked' | 'noisy';
  last_seen_at?: string | null;
}

export type SessionPhase = 'lobby' | 'countdown' | 'lead-in' | 'playing' | 'ended';

export interface SectionScore {
  part_index: number;
  active_players: number;
  score: number;
  accuracy: number;
  rank?: number;
}

export interface PlayerRoundStats {
  session_id: string;
  player_id: string;
  score: number;
  accuracy: number;
  notes_attempted: number;
  notes_hit: number;
  timing_offset_ms?: number;
}

export interface ScoreEvent {
  id: string;
  session_id: string;
  player_id: string;
  delta: number;
  ts: string;
}

export interface HighScore {
  id: string;
  song_id: string;
  part_index: number;
  player_name: string;
  score: number;
  achieved_at: string;
}

export interface PitchSample {
  frequency: number;  // Hz, 0 = silence
  timestamp: number;  // seconds
  confidence: number; // 0–1
}

export interface ScoreBatch {
  playerId: string;
  sessionId: string;
  deltas: number[];
  timestamp: number;
}
