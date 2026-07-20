'use client';

import { PitchEngine } from './pitchEngine';
import type { SatbPart, SongNote } from './types';

export type Difficulty = 'easy' | 'medium' | 'hard';

export const CENT_TOLERANCE: Record<Difficulty, number> = {
  easy: 100,
  medium: 50,
  hard: 25,
};

const ONSET_WINDOW_SEC = 0.35;
const NOTE_MAX_POINTS = 30;
const WEIGHTS = { onset: 0.25, hold: 0.35, pitch: 0.4 };

export interface NoteScoreResult {
  noteId: string;
  onset: number;
  hold: number;
  pitch: number;
  points: number;
}

export interface ScoreEngineOptions {
  part: SatbPart;
  partIndex: number;
  notes?: SongNote[];
  songDuration: number;
  playerId: string;
  sessionId: string;
  difficulty?: Difficulty;
  flushIntervalMs?: number;
  onScoreUpdate: (delta: number, total: number) => void;
  onNoteResult?: (result: NoteScoreResult) => void;
}

interface ActiveNote {
  note: SongNote;
  onsetCaptured: boolean;
  onsetDelaySec: number | null;
  voicedSec: number;
  inTuneSec: number;
}

/**
 * Scores the local microphone only. A note is resolved after its target window
 * has passed, using onset, sustained voicing and pitch accuracy. This keeps the
 * strike-line experience fair without uploading raw audio.
 */
export class ScoreEngine {
  private total = 0;
  private pending: number[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly opts: Required<ScoreEngineOptions>;
  private readonly noteList: SongNote[];
  private cursor = 0;
  private current: ActiveNote | null = null;
  private lastSampleSec = 0;
  private attempted = 0;
  private hit = 0;

  constructor(options: ScoreEngineOptions) {
    this.opts = {
      difficulty: 'medium',
      flushIntervalMs: 1000,
      notes: [],
      onNoteResult: () => {},
      ...options,
    };
    this.noteList = this.opts.notes
      .filter(note => note.part === this.opts.partIndex)
      .slice()
      .sort((a, b) => a.start - b.start);
  }

  start() {
    if (!this.flushTimer) this.flushTimer = setInterval(() => void this.flush(), this.opts.flushIntervalMs);
  }

  async stop() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    if (this.current) this.resolve(this.current.note);
    await this.flush();
  }

  get currentTotal() { return this.total; }
  get stats() { return { attempted: this.attempted, hit: this.hit, accuracy: this.attempted ? Math.round(this.hit / this.attempted * 100) : 0 }; }

  scorePitch(playerHz: number, elapsedSec: number): number {
    if (!this.noteList.length) return this.scoreLegacyCurve(playerHz, elapsedSec);
    const dt = Math.min(Math.max(elapsedSec - this.lastSampleSec, 0), 0.25);
    this.lastSampleSec = elapsedSec;
    let awarded = 0;

    while (this.cursor < this.noteList.length && this.noteList[this.cursor].end <= elapsedSec) {
      awarded += this.resolve(this.noteList[this.cursor]);
      this.cursor += 1;
    }
    const candidate = this.noteList[this.cursor];
    if (!candidate || elapsedSec < candidate.start - ONSET_WINDOW_SEC) return awarded;

    if (!this.current || this.current.note.id !== candidate.id) {
      this.current = { note: candidate, onsetCaptured: false, onsetDelaySec: null, voicedSec: 0, inTuneSec: 0 };
    }
    const targetHz = PitchEngine.midiToHz(candidate.midi);
    const voiced = playerHz > 0;
    const inTune = voiced && Math.abs(PitchEngine.centsDiff(playerHz, targetHz)) <= CENT_TOLERANCE[this.opts.difficulty];
    if (!this.current.onsetCaptured && voiced) {
      this.current.onsetCaptured = true;
      this.current.onsetDelaySec = elapsedSec - candidate.start;
    }
    if (elapsedSec >= candidate.start && elapsedSec < candidate.end && voiced) {
      this.current.voicedSec += dt;
      if (inTune) this.current.inTuneSec += dt;
    }
    return awarded;
  }

  targetNormAt(elapsedSec: number): number {
    const active = this.noteList.find(note => elapsedSec >= note.start && elapsedSec < note.end);
    if (active) return PitchEngine.normalise(PitchEngine.midiToHz(active.midi), this.opts.part.rangeMin, this.opts.part.rangeMax);
    const curve = this.opts.part.curve;
    if (!curve?.length) return 0;
    const raw = Math.min(elapsedSec / this.opts.songDuration, 1) * (curve.length - 1);
    const low = Math.floor(raw), high = Math.min(low + 1, curve.length - 1);
    return curve[low] * (1 - (raw - low)) + curve[high] * (raw - low);
  }

  private resolve(note: SongNote): number {
    const tracking = this.current?.note.id === note.id ? this.current : null;
    this.current = null;
    this.attempted += 1;
    if (!tracking) {
      this.opts.onNoteResult({ noteId: note.id, onset: 0, hold: 0, pitch: 0, points: 0 });
      return 0;
    }
    const duration = Math.max(note.end - note.start, 0.0001);
    const onset = tracking.onsetCaptured && tracking.onsetDelaySec !== null
      ? clamp01(1 - Math.abs(tracking.onsetDelaySec) / ONSET_WINDOW_SEC) : 0;
    const hold = clamp01(tracking.voicedSec / duration);
    const pitch = tracking.voicedSec ? clamp01(tracking.inTuneSec / tracking.voicedSec) : 0;
    const points = Math.round((WEIGHTS.onset * onset + WEIGHTS.hold * hold + WEIGHTS.pitch * pitch) * NOTE_MAX_POINTS);
    if (points > 0) {
      this.total += points;
      this.pending.push(points);
      this.hit += 1;
      this.opts.onScoreUpdate(points, this.total);
    }
    this.opts.onNoteResult({ noteId: note.id, onset, hold, pitch, points });
    return points;
  }

  private scoreLegacyCurve(playerHz: number, elapsedSec: number): number {
    if (playerHz <= 0) return 0;
    const target = this.targetNormAt(elapsedSec);
    const hz = PitchEngine.denormalise(target, this.opts.part.rangeMin, this.opts.part.rangeMax);
    const cents = Math.abs(PitchEngine.centsDiff(playerHz, hz));
    const points = cents >= CENT_TOLERANCE[this.opts.difficulty] ? 0 : Math.round(10 * (1 - cents / CENT_TOLERANCE[this.opts.difficulty]));
    if (points) { this.total += points; this.pending.push(points); this.opts.onScoreUpdate(points, this.total); }
    return points;
  }

  private async flush() {
    if (!this.pending.length) return;
    const delta = this.pending.reduce((total, value) => total + value, 0);
    this.pending = [];
    try {
      await fetch('/api/score', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: this.opts.playerId, sessionId: this.opts.sessionId, delta }),
      });
    } catch {
      this.pending.unshift(delta);
    }
  }
}

function clamp01(value: number) { return Math.min(1, Math.max(0, value)); }
