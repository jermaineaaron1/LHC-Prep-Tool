import type { SatbPart, Song, SongNote } from './types';

const FALLBACK_RANGES = [
  [260, 1050], // Soprano
  [175, 700],  // Alto
  [130, 525],  // Tenor
  [80, 330],   // Bass
] as const;

/**
 * Bridges the legacy `game_notes` column with the newer note timeline. Legacy
 * data is frequently exported as piano chords: several MIDI notes at exactly
 * the same lyric position. We reduce each onset to its upper melody note so a
 * singer sees one target per lyric instead of a stack of chord tones.
 *
 * The resulting -1 part is a shared melody guide. It must never be rendered as
 * four cloned SATB parts: true SATB lanes require an authored arrangement.
 */
export function playableNotes(song: Song): SongNote[] {
  if (song.notes?.length) return song.notes;
  const chordGroups: Array<Array<NonNullable<Song['game_notes']>[number]>> = [];
  for (const note of [...(song.game_notes ?? [])].sort((a, b) => a.start - b.start || b.m - a.m)) {
    const current = chordGroups[chordGroups.length - 1];
    // MIDI imports can have a few milliseconds of jitter. Treat those notes as
    // one chord/lyric rather than three separate singable targets.
    if (current && Math.abs(current[0].start - note.start) <= 0.06) current.push(note);
    else chordGroups.push([note]);
  }
  return chordGroups.map((chord, index) => {
    const melody = chord.reduce((highest, note) => note.m > highest.m ? note : highest);
    const lyric = chord.find(note => note.l?.trim())?.l ?? '';
    return {
      id: `legacy-${song.id}-${index}`,
      part: -1,
      midi: melody.m,
      start: Math.min(...chord.map(note => note.start)),
      end: Math.max(...chord.map(note => note.start + note.dur)),
      lyric,
      velocity: 100,
    };
  });
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
