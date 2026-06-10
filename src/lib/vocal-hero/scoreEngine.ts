'use client';

// Scoring logic: compares live player pitch against the target SATB curve,
// accumulates deltas, and batches them to Supabase every flushIntervalMs.

import { PitchEngine } from './pitchEngine';
import type { SatbPart } from './types';

export type Difficulty = 'easy' | 'medium' | 'hard';

/** Tolerance in cents for each difficulty level */
export const CENT_TOLERANCE: Record<Difficulty, number> = {
  easy:   100,
  medium:  50,
  hard:    25,
};

/** Maximum points awarded per frame at perfect pitch */
const MAX_DELTA = 10;

export interface ScoreEngineOptions {
  part:            SatbPart;
  songDuration:    number;   // seconds — used to map elapsed time → curve index
  playerId:        string;
  sessionId:       string;
  difficulty?:     Difficulty;
  flushIntervalMs?: number;  // default 500
  onScoreUpdate:   (delta: number, total: number) => void;
}

export class ScoreEngine {
  private total         = 0;
  private pendingDeltas: number[] = [];
  private flushTimer:   ReturnType<typeof setInterval> | null = null;
  private readonly opts: Required<ScoreEngineOptions>;

  constructor(options: ScoreEngineOptions) {
    this.opts = {
      difficulty:      'medium',
      flushIntervalMs: 500,
      ...options,
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), this.opts.flushIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush(); // drain remaining deltas
  }

  reset(): void {
    this.total = 0;
    this.pendingDeltas = [];
  }

  get currentTotal(): number {
    return this.total;
  }

  // ── Scoring ───────────────────────────────────────────────────────────────

  /**
   * Call this on every pitch sample from PitchEngine.
   *
   * @param playerHz   Raw frequency from mic (0 = silence)
   * @param elapsedSec Seconds since song started
   * @returns Points awarded this frame (0–MAX_DELTA)
   */
  scorePitch(playerHz: number, elapsedSec: number): number {
    const { part, songDuration, difficulty } = this.opts;
    const curve = part.curve;

    if (!curve || curve.length === 0) return 0;

    // Map elapsed time → curve index (curve has 24 keyframes over songDuration)
    const progress  = Math.min(elapsedSec / songDuration, 1);
    const rawIndex  = progress * (curve.length - 1);
    const loIdx     = Math.floor(rawIndex);
    const hiIdx     = Math.min(loIdx + 1, curve.length - 1);
    const frac      = rawIndex - loIdx;

    // Interpolate between adjacent keyframes for smoother targets
    const targetNorm = curve[loIdx] * (1 - frac) + curve[hiIdx] * frac;

    if (playerHz <= 0) {
      // Silence — no points, no penalty
      return 0;
    }

    // Convert target norm → Hz for cents comparison
    const targetHz = PitchEngine.denormalise(targetNorm, part.rangeMin, part.rangeMax);
    const cents    = Math.abs(PitchEngine.centsDiff(playerHz, targetHz));
    const tol      = CENT_TOLERANCE[difficulty];

    // Linear score: full points at 0 cents, zero points at tolerance
    const delta = cents >= tol
      ? 0
      : Math.round(MAX_DELTA * (1 - cents / tol));

    if (delta > 0) {
      this.total += delta;
      this.pendingDeltas.push(delta);
      this.opts.onScoreUpdate(delta, this.total);
    }

    return delta;
  }

  /**
   * Returns the target normalised pitch (0–1) at a given elapsed time.
   * Useful for drawing the target line on screen.
   */
  targetNormAt(elapsedSec: number): number {
    const curve = this.opts.part.curve;
    if (!curve || curve.length === 0) return 0;
    const progress = Math.min(elapsedSec / this.opts.songDuration, 1);
    const rawIndex = progress * (curve.length - 1);
    const loIdx    = Math.floor(rawIndex);
    const hiIdx    = Math.min(loIdx + 1, curve.length - 1);
    const frac     = rawIndex - loIdx;
    return curve[loIdx] * (1 - frac) + curve[hiIdx] * frac;
  }

  /**
   * Returns accuracy as a percentage (0–100) based on frames with score > 0.
   * Must be tracked externally — here we provide a helper that takes totals.
   */
  static accuracy(scoredFrames: number, totalFrames: number): number {
    if (totalFrames === 0) return 0;
    return Math.round((scoredFrames / totalFrames) * 100);
  }

  // ── Flush to Supabase ─────────────────────────────────────────────────────

  private async flush(): Promise<void> {
    if (this.pendingDeltas.length === 0) return;

    const batch = [...this.pendingDeltas];
    this.pendingDeltas = [];

    const total = batch.reduce((s, d) => s + d, 0);
    if (total === 0) return;

    try {
      await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId:  this.opts.playerId,
          sessionId: this.opts.sessionId,
          delta:     total,
        }),
      });
    } catch {
      // Non-fatal — score is already tracked locally in this.total
      // Put deltas back so next flush retries them
      this.pendingDeltas.unshift(...batch);
    }
  }
}
