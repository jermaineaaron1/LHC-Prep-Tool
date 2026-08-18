import type { SongNote } from './types';

// Where a note lands on the highway. Kept apart from the renderer so it can be
// tested without a canvas, and so the DOM lane and the canvas lane cannot drift
// apart while both exist.

const VOICE_RANGES = [
  { low: 60, high: 81 }, { low: 53, high: 74 }, { low: 48, high: 67 }, { low: 40, high: 64 },
];

/** Where the strike line sits, as a fraction of the width. */
export const CURSOR = 0.13;

/** The pitch window a lane shows, widened so nothing sits on the very edge. */
export function laneBounds(notes: SongNote[], partIndex: number): { low: number; high: number } {
  const pitches = notes.filter(note => note.part === partIndex || note.part === -1).map(note => note.midi);
  const fallback = VOICE_RANGES[partIndex] ?? VOICE_RANGES[0];
  if (!pitches.length) return fallback;
  let low = Math.min(...pitches) - 2;
  let high = Math.max(...pitches) + 2;
  // A part that barely moves would otherwise be drawn as one fat band across
  // the middle of the screen.
  if (high - low < 12) { const middle = (high + low) / 2; low = middle - 6; high = middle + 6; }
  return { low, high };
}

/** Horizontal position of a song time, in pixels. */
export function xForTime(time: number, position: number, lookAhead: number, width: number): number {
  return width * CURSOR + ((time - position) / lookAhead) * width * (1 - CURSOR);
}

/** Vertical centre of a pitch, in pixels. Higher notes sit higher. */
export function yForMidi(midi: number, low: number, high: number, height: number, pad = 10): number {
  const span = Math.max(1, high - low);
  return height - pad - ((midi - low) / span) * (height - pad * 2);
}
