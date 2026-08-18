'use client';

/**
 * The playhead.
 *
 * Until now song time was DERIVED: wall clock minus the round's scheduled start.
 * That is exactly right for a shared round -- every device computes the same
 * number without talking to the others -- but it means there is nothing to move.
 * You cannot loop eight bars, slow a passage to seventy per cent, or drop back
 * four seconds and try again, because there is no playhead to put anywhere. The
 * clock simply advances.
 *
 * A transport owns a position instead of inferring one. Everything that used to
 * read `songElapsed` reads `sample().position`, and gains looping, rate and
 * seeking for free.
 *
 * It holds an ANCHOR -- a wall-clock instant paired with the song position at
 * that instant -- and derives the rest. Re-anchoring on every change is what
 * keeps a rate change from retroactively rewriting where the singer already was,
 * and what stops rounding error accumulating across a long practice session.
 */

export interface LoopRegion { start: number; end: number }

export interface TransportSample {
  /** Song time in seconds. */
  position: number;
  /** How many times the loop has come round. Consumers that cache per-note
   *  state -- the scorer, the guide player -- reset when this changes. */
  lap: number;
  playing: boolean;
}

/** Below this a loop is a stutter rather than a phrase to practise. */
export const MIN_LOOP_SECONDS = 0.5;

export class Transport {
  private anchorWall = 0;
  private anchorPosition = 0;
  private anchorLap = 0;
  private playing = false;
  private rate = 1;
  private loop: LoopRegion | null = null;

  constructor(options: { rate?: number; loop?: LoopRegion | null; position?: number } = {}) {
    this.rate = clampRate(options.rate ?? 1);
    this.loop = normaliseLoop(options.loop ?? null);
    this.anchorPosition = options.position ?? 0;
  }

  get isPlaying(): boolean { return this.playing; }
  get currentRate(): number { return this.rate; }
  get loopRegion(): LoopRegion | null { return this.loop; }

  /**
   * Where the playhead is at a given wall-clock instant, and which lap.
   *
   * Pure: calling it does not advance anything, so it is safe from a render, a
   * scheduler and a scoring loop in the same frame -- all three see one answer.
   */
  sample(nowMs: number): TransportSample {
    if (!this.playing) return { position: this.anchorPosition, lap: this.anchorLap, playing: false };

    const raw = this.anchorPosition + ((nowMs - this.anchorWall) / 1000) * this.rate;
    const loop = this.loop;
    if (!loop || raw < loop.end) return { position: raw, lap: this.anchorLap, playing: true };

    // Wrapping by modulo rather than by subtracting once: a backgrounded tab can
    // return after several laps have gone by, and a single subtraction would
    // leave the playhead somewhere past the loop, still ahead of the music.
    const length = loop.end - loop.start;
    const past = raw - loop.start;
    const laps = Math.floor(past / length);
    return { position: loop.start + (past - laps * length), lap: this.anchorLap + laps, playing: true };
  }

  play(nowMs: number): void {
    if (this.playing) return;
    this.anchorWall = nowMs;
    this.playing = true;
  }

  pause(nowMs: number): void {
    if (!this.playing) return;
    const { position, lap } = this.sample(nowMs);
    this.anchorPosition = position;
    this.anchorLap = lap;
    this.playing = false;
  }

  /** Move the playhead. Keeps playing if it was playing. */
  seek(position: number, nowMs: number): void {
    const { lap } = this.sample(nowMs);
    this.anchorPosition = Math.max(0, position);
    this.anchorLap = lap;
    this.anchorWall = nowMs;
  }

  /**
   * Change speed without moving the singer.
   *
   * Re-anchoring first is the whole point: without it, the new rate would be
   * applied to the time already elapsed and the playhead would jump backwards or
   * forwards the moment someone chose 70%.
   */
  setRate(rate: number, nowMs: number): void {
    const { position, lap } = this.sample(nowMs);
    this.anchorPosition = position;
    this.anchorLap = lap;
    this.anchorWall = nowMs;
    this.rate = clampRate(rate);
  }

  /**
   * Set or clear the loop.
   *
   * If the playhead is outside a newly set loop it is moved to the start:
   * choosing a phrase to practise and then hearing something else would be a
   * puzzle, not a feature.
   */
  setLoop(region: LoopRegion | null, nowMs: number): void {
    const { position, lap } = this.sample(nowMs);
    const next = normaliseLoop(region);
    this.anchorPosition = next && (position < next.start || position >= next.end) ? next.start : position;
    this.anchorLap = lap;
    this.anchorWall = nowMs;
    this.loop = next;
  }
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  // Below about a third the tone falls apart and a singer cannot phrase to it;
  // above 1.5 the lane moves faster than anyone can read.
  return Math.min(1.5, Math.max(0.35, rate));
}

function normaliseLoop(region: LoopRegion | null): LoopRegion | null {
  if (!region) return null;
  const start = Math.max(0, Math.min(region.start, region.end));
  const end = Math.max(region.start, region.end);
  if (end - start < MIN_LOOP_SECONDS) return null;
  return { start, end };
}

/**
 * The phrase around a position, for a one-tap "loop this bit".
 *
 * Practising is done in phrases, not in seconds, so the region snaps to the
 * gaps between sung notes rather than to a stopwatch. A singer who wants "that
 * awkward run" should get the run, not four seconds containing most of it.
 */
export function phraseAround(
  notes: Array<{ start: number; end: number }>,
  position: number,
  options: { gap?: number; minimum?: number } = {}
): LoopRegion | null {
  const gap = options.gap ?? 0.7;
  // Only a floor against a stutter-length loop, never a target: a real phrase
  // of 1.8s must come back as 1.8s, not be stretched into the silence after
  // it. Anything shorter than this is padded, since half a second of music
  // on repeat is not practice.
  const minimum = options.minimum ?? 1.2;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  if (!sorted.length) return null;

  // Walk out from the position to the silences on either side.
  let start = sorted[0].start;
  let end = sorted[sorted.length - 1].end;
  let previousEnd = sorted[0].end;

  for (let i = 1; i < sorted.length; i++) {
    const note = sorted[i];
    if (note.start - previousEnd >= gap) {
      if (previousEnd <= position) start = note.start;
      else if (note.start > position) { end = previousEnd; break; }
    }
    previousEnd = Math.max(previousEnd, note.end);
  }

  if (end - start < minimum) end = start + minimum;
  return normaliseLoop({ start, end });
}
