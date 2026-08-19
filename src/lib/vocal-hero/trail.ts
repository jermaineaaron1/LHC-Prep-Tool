'use client';

/**
 * What the singer actually sang, kept alongside what was written.
 *
 * These lived inside the DOM lane, which is why that whole component survived
 * long after nothing rendered it: four files imported three helpers out of a
 * two-hundred-line renderer nobody used.
 */

/** One sample of what the singer sang, in song time. */
export interface TrailSample { t: number; hz: number }

/** The longest stretch of singing a lane will ever draw. */
const TRAIL_MEMORY_SEC = 4;

/**
 * Record a sample, and forget anything older than a lane can show.
 *
 * Mutates the array it is given: this runs on every microphone sample, and a
 * fresh array each time would be a steady drip of work for the collector on the
 * one thread that has to stay smooth.
 */
export function pushTrail(trail: TrailSample[], songTime: number, hz: number): void {
  trail.push({ t: songTime, hz });
  const cutoff = songTime - TRAIL_MEMORY_SEC;
  let drop = 0;
  while (drop < trail.length && trail[drop].t < cutoff) drop++;
  if (drop) trail.splice(0, drop);
}

/** Starting again must not leave the last attempt's line on screen. */
export function clearTrail(trail: TrailSample[]): void {
  trail.length = 0;
}
