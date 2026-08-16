'use client';

// Two jobs an arranger does constantly, neither of which the editor could do:
// putting a line of words onto the notes that carry it, and writing a harmony
// part from a line that already exists.

import type { SongNote } from './types';

// ── Words onto notes ───────────────────────────────────────────────────────

/**
 * Split a typed line into the fragments that sit on individual notes.
 *
 * Hyphens inside a word mark where it breaks across notes, and the hyphen
 * stays on the leading fragment — "mer-cies" becomes "mer-" then "cies". That
 * is the same convention the gameplay display already reads when it rejoins
 * syllables into a word, so what is typed here is what the singer sees.
 *
 * An underscore leaves a note deliberately empty, which is how a syllable is
 * held across several notes.
 */
export function splitIntoSyllables(line: string): string[] {
  const syllables: string[] = [];
  for (const word of line.trim().split(/\s+/).filter(Boolean)) {
    if (word === '_') { syllables.push(''); continue; }
    // Keep the hyphen with the fragment before it, and never emit an empty
    // fragment from a leading, trailing or doubled hyphen.
    const parts = word.split(/(?<=[-–—])/).filter(part => part.replace(/[-–—]/g, '').length || part.length > 1);
    for (const part of parts) syllables.push(part);
  }
  return syllables;
}

export interface SpreadResult {
  /** Note id → the lyric it should carry. */
  assignments: Record<string, string>;
  syllables: number;
  notes: number;
  /** Syllables with no note left to carry them. */
  leftover: string[];
  /** Notes past the end of the line, which are cleared. */
  cleared: number;
}

/**
 * Lay a line across notes in time order, one fragment per note.
 *
 * Deliberately reports a mismatch rather than guessing: too many syllables for
 * the notes available almost always means the line and the melody disagree,
 * and silently dropping words would hide that.
 */
export function spreadLyricsAcrossNotes(line: string, notes: SongNote[]): SpreadResult {
  const syllables = splitIntoSyllables(line);
  const ordered = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const assignments: Record<string, string> = {};
  ordered.forEach((note, index) => { assignments[note.id] = syllables[index] ?? ''; });
  return {
    assignments,
    syllables: syllables.length,
    notes: ordered.length,
    leftover: syllables.slice(ordered.length),
    cleared: Math.max(0, ordered.length - syllables.length),
  };
}

// ── Melody into another voice ──────────────────────────────────────────────

export const HARMONY_INTERVALS: Array<{ semitones: number; label: string }> = [
  { semitones: -12, label: 'Octave below' },
  { semitones: -7, label: 'Fifth below' },
  { semitones: -5, label: 'Fourth below' },
  { semitones: -4, label: 'Major third below' },
  { semitones: -3, label: 'Minor third below' },
  { semitones: 3, label: 'Minor third above' },
  { semitones: 4, label: 'Major third above' },
  { semitones: 5, label: 'Fourth above' },
  { semitones: 7, label: 'Fifth above' },
  { semitones: 12, label: 'Octave above' },
];

export interface HarmonyResult {
  /** The target voice's notes after the copy. */
  notes: SongNote[];
  copied: number;
  /** Existing notes in the target that the copy replaced. */
  replaced: number;
}

/**
 * Copy a line into another voice at a fixed interval, keeping the words and
 * the timing.
 *
 * The shift is chromatic — every note moves by the same number of semitones.
 * That is a correct parallel harmony and a fine starting point, but it is not
 * a diatonic one: notes that should follow the key will need adjusting by ear.
 * Saying so is the caller's job, and it does say so.
 *
 * Only the target notes overlapping the copied span are replaced, so a
 * harmony written for one section leaves the rest of that voice alone.
 */
export function harmoniseInto(
  source: SongNote[],
  target: SongNote[],
  toPart: number,
  semitones: number,
  makeId: () => string,
): HarmonyResult {
  const ordered = [...source].sort((a, b) => a.start - b.start);
  if (!ordered.length) return { notes: target, copied: 0, replaced: 0 };

  const from = ordered[0].start;
  const to = Math.max(...ordered.map(note => note.end));
  const kept = target.filter(note => note.end <= from + .0001 || note.start >= to - .0001);
  const replaced = target.length - kept.length;

  const copies = ordered.map(note => ({
    ...note,
    id: makeId(),
    part: toPart,
    midi: Math.max(0, Math.min(127, note.midi + semitones)),
    // Expression belongs to the take it was captured from, not to a copy of it
    // in another voice, where it would claim a performance that never happened.
    expression: undefined,
  }));

  return {
    notes: [...kept, ...copies].sort((a, b) => a.start - b.start || a.midi - b.midi),
    copied: copies.length,
    replaced,
  };
}
