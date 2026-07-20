import type { SatbPart, Song, SongNote } from './types';

const FALLBACK_RANGES = [
  [260, 1050], // Soprano
  [175, 700],  // Alto
  [130, 525],  // Tenor
  [80, 330],   // Bass
] as const;

/**
 * Bridges the legacy single-melody `game_notes` column with the newer note
 * timeline. Unassigned legacy notes are intentionally marked -1 so every
 * selected voice can use the melody guide until a proper SATB arrangement is
 * authored, without pretending that cloned notes are real harmonies.
 */
export function playableNotes(song: Song): SongNote[] {
  if (song.notes?.length) return song.notes;
  return (song.game_notes ?? []).map((note, index) => ({
    id: `legacy-${song.id}-${index}`,
    part: -1,
    midi: note.m,
    start: note.start,
    end: note.start + note.dur,
    lyric: note.l ?? '',
    velocity: 100,
  }));
}

export function playablePart(song: Song, partIndex: number): SatbPart {
  const existing = song.parts?.[partIndex];
  if (existing) return existing;
  const [rangeMin, rangeMax] = FALLBACK_RANGES[partIndex] ?? FALLBACK_RANGES[0];
  return {
    name: (['Soprano', 'Alto', 'Tenor', 'Bass'][partIndex] ?? 'Soprano') as SatbPart['name'],
    rangeMin,
    rangeMax,
    curve: [],
    aiGen: false,
    edits: 0,
  };
}

export function isGuideMelody(notes: SongNote[]): boolean {
  return notes.length > 0 && notes.every(note => note.part === -1);
}
