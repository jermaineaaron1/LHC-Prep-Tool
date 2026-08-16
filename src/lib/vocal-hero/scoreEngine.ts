'use client';

import { PitchEngine } from './pitchEngine';
import type { SatbPart, SongNote } from './types';

export type Difficulty = 'easy' | 'medium' | 'hard';

export const CENT_TOLERANCE: Record<Difficulty, number> = {
  easy: 100,
  medium: 50,
  hard: 25,
};

// An entrance within ONSET_PERFECT_SEC is simply on time; timing credit then
// slides to nothing at ONSET_WINDOW_SEC. The old single 0.35s window was a
// pass/fail gate on the WHOLE note, so a singer 0.36s late scored zero while
// holding perfect pitch for two-thirds of it. Late is worth less than
// early-and-accurate; it is not worth nothing.
const ONSET_PERFECT_SEC = 0.15;
const ONSET_WINDOW_SEC = 0.7;
// Within this the singer is on the note; credit then tapers to zero at the
// difficulty's tolerance. Previously anything inside the tolerance scored
// identically, so 45 cents flat — audibly flat, exactly what practice is for —
// looked the same as dead centre, and 51 cents looked the same as silence.
const PITCH_PERFECT_CENTS = 20;
const NOTE_MAX_POINTS = 30;
const WEIGHTS = { onset: 0.2, hold: 0.3, pitch: 0.5 };

export interface NoteScoreResult {
  noteId: string;
  onset: number;
  hold: number;
  pitch: number;
  points: number;
  /** Whole octaves the singer sat away from the written note, signed: -1 is an
   * octave below. The note still scores — the octave is reported so a singer
   * can be TOLD, rather than silently marked perfect for singing a different
   * line to the one in front of them. */
  octaveShift: number;
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
  /** Seconds weighted by how close to the centre of the note they were, so a
   * held-but-flat note and a held-and-centred one no longer look alike. */
  accurateSec: number;
  /** Seconds spent an octave out, and which way, counted only while otherwise
   * on the note. */
  octaveOutSec: number;
  octaveOutShift: number;
}

/**
 * Scores the local microphone only. A note is resolved after its target window
 * has passed, using onset, sustained voicing and pitch accuracy. This keeps the
 * strike-line experience fair without uploading raw audio.
 */
export class ScoreEngine {
  private total = 0;
  private pending: number[] = [];
  private flushing = false;
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
      .filter(note => note.part === this.opts.partIndex || note.part === -1)
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
    await this.flush(true);
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
      this.current = {
        note: candidate, onsetCaptured: false, onsetDelaySec: null,
        voicedSec: 0, inTuneSec: 0, accurateSec: 0, octaveOutSec: 0, octaveOutShift: 0,
      };
    }
    const targetHz = PitchEngine.midiToHz(candidate.midi);
    const voiced = playerHz > 0;
    const alignedPlayerHz = voiced ? PitchEngine.alignOctaveToTarget(playerHz, candidate.midi) : 0;
    const cents = voiced ? Math.abs(PitchEngine.centsDiff(alignedPlayerHz, targetHz)) : Infinity;
    const tolerance = CENT_TOLERANCE[this.opts.difficulty];
    const inTune = cents <= tolerance;
    // How well, not just whether. Full credit while inside PITCH_PERFECT_CENTS,
    // sliding to zero at the tolerance edge.
    // The perfect band cannot be most of the tolerance, or the taper has no
    // room to work: on hard, a fixed 20 cents left only 5 cents of slope and
    // the scoring went back to being effectively pass/fail.
    const perfect = Math.min(PITCH_PERFECT_CENTS, tolerance * 0.4);
    const accuracy = inTune
      ? clamp01((tolerance - Math.max(cents, perfect)) / Math.max(1, tolerance - perfect))
      : 0;
    // Room noise or a loud backing track must not count as the singer's
    // entrance. Capture onset only once the expected pitch is present.
    if (!this.current.onsetCaptured && inTune) {
      this.current.onsetCaptured = true;
      this.current.onsetDelaySec = elapsedSec - candidate.start;
    }
    if (elapsedSec >= candidate.start && elapsedSec < candidate.end && voiced) {
      this.current.voicedSec += dt;
      if (inTune) {
        this.current.inTuneSec += dt;
        this.current.accurateSec += dt * accuracy;
        const shift = PitchEngine.octaveShift(playerHz, candidate.midi);
        if (shift !== 0) { this.current.octaveOutSec += dt; this.current.octaveOutShift = shift; }
      }
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
      this.opts.onNoteResult({ noteId: note.id, onset: 0, hold: 0, pitch: 0, points: 0, octaveShift: 0 });
      return 0;
    }
    const duration = Math.max(note.end - note.start, 0.0001);
    const onset = tracking.onsetCaptured && tracking.onsetDelaySec !== null
      ? clamp01((ONSET_WINDOW_SEC - Math.max(0, Math.abs(tracking.onsetDelaySec) - ONSET_PERFECT_SEC))
                / (ONSET_WINDOW_SEC - ONSET_PERFECT_SEC))
      : 0;
    // Hold counts time spent ON the note, not time spent making a sound. That
    // is what keeps "hum through the whole bar" from earning anything, which
    // is the job the old pass/fail gate was doing — without the gate's habit
    // of throwing away an otherwise good note for a late entrance.
    const hold = clamp01(tracking.inTuneSec / duration);
    const pitch = tracking.inTuneSec ? clamp01(tracking.accurateSec / tracking.inTuneSec) : 0;
    const points = Math.round(
      (WEIGHTS.onset * onset + WEIGHTS.hold * hold + WEIGHTS.pitch * pitch) * NOTE_MAX_POINTS
    );
    // A note counts as hit once the singer actually found it, rather than only
    // when the entrance was also punctual.
    const found = hold > 0 && pitch > 0;
    if (points > 0) {
      this.total += points;
      this.pending.push(points);
      this.opts.onScoreUpdate(points, this.total);
    }
    if (found) this.hit += 1;
    // Report the octave only when the singer spent most of the note there, so
    // one stray frame of harmonic confusion is not announced as a mistake.
    const octaveShift = tracking.octaveOutSec > tracking.inTuneSec / 2 ? tracking.octaveOutShift : 0;
    this.opts.onNoteResult({ noteId: note.id, onset, hold, pitch, points, octaveShift });
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

  /**
   * Send the points banked since the last send. Anything not accepted is put
   * back for the next tick — the singer earned it, and losing it quietly is
   * worse than sending it a second late.
   *
   * @param final the last send of the round. Nothing runs after it, so the
   *   usual "retry on the next tick" is not available and it retries here.
   */
  private async flush(final = false): Promise<void> {
    // setInterval does not wait for the previous call to finish. Two flushes
    // overlapping would each take a share of the pending points and re-queue
    // them independently on failure.
    if (this.flushing || !this.pending.length) return;
    this.flushing = true;
    const delta = this.pending.reduce((total, value) => total + value, 0);
    this.pending = [];
    try {
      const response = await fetch('/api/score', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: this.opts.playerId, sessionId: this.opts.sessionId, delta }),
      });
      // A non-2xx answer used to count as success, so a server error threw the
      // singer's points away without a word. 5xx and 429 are worth another go;
      // a 4xx means this request will never be accepted however often it is
      // repeated, so it is reported once rather than retried forever.
      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) throw new Error('HTTP ' + response.status);
        console.warn('[VocalHero] /api/score rejected ' + delta + ' point(s): HTTP ' + response.status);
      }
    } catch (cause) {
      this.pending.unshift(delta);
      if (final) {
        // One more attempt, since there is no next tick to catch it.
        try {
          const retry = await fetch('/api/score', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId: this.opts.playerId, sessionId: this.opts.sessionId, delta }),
          });
          if (!retry.ok) throw new Error('HTTP ' + retry.status);
          this.pending = [];
        } catch {
          console.warn('[VocalHero] ' + delta + ' point(s) could not be sent at the end of the round: ' +
            (cause instanceof Error ? cause.message : String(cause)));
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}

function clamp01(value: number) { return Math.min(1, Math.max(0, value)); }
