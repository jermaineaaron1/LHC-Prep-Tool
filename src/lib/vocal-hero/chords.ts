'use client';

// Chord symbols the way a guitarist writes them, parsed into the notes a
// keyboard would play. Pure, so the reading of "F#m7/E" is a tested fact.

export interface ParsedChord {
  /** Sounding midi notes, voiced around the octave below middle C. */
  midis: number[];
  /** The root's pitch class 0-11, for transposition. */
  rootPc: number;
  bassPc: number | null;
}

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Order is the parser: the most specific writing must be read before the
// prefix it contains — maj before m, 7sus before 7, dim7 before dim.
const QUALITIES: Array<[RegExp, number[]]> = [
  [/^maj9/i, [0, 4, 7, 11, 14]],
  [/^maj7/i, [0, 4, 7, 11]],
  [/^maj/i, [0, 4, 7]],
  [/^m7b5/i, [0, 3, 6, 10]],
  [/^m9/, [0, 3, 7, 10, 14]],
  [/^m(in)?7/, [0, 3, 7, 10]],
  [/^m(in)?6/, [0, 3, 7, 9]],
  [/^m(in)?/, [0, 3, 7]],
  [/^dim7/i, [0, 3, 6, 9]],
  [/^dim/i, [0, 3, 6]],
  [/^aug|^\+/, [0, 4, 8]],
  [/^7sus4?/, [0, 5, 7, 10]],
  [/^sus2/i, [0, 2, 7]],
  [/^sus4?/i, [0, 5, 7]],
  [/^add9/i, [0, 4, 7, 14]],
  [/^69/, [0, 4, 7, 9, 14]],
  [/^6/, [0, 4, 7, 9]],
  [/^9/, [0, 4, 7, 10, 14]],
  [/^7/, [0, 4, 7, 10]],
  [/^5/, [0, 7]],
];

function pitchClassOf(token: string): number | null {
  const match = token.match(/^([A-Ga-g])([#♯b♭]?)/);
  if (!match) return null;
  let pc = LETTER_PC[match[1].toUpperCase()];
  if (match[2] === '#' || match[2] === '♯') pc += 1;
  if (match[2] === 'b' || match[2] === '♭') pc -= 1;
  return ((pc % 12) + 12) % 12;
}

export function parseChord(symbol: string): ParsedChord | null {
  const trimmed = symbol.trim();
  if (!trimmed) return null;
  const [main, slash] = trimmed.split('/');
  const rootPc = pitchClassOf(main);
  if (rootPc === null) return null;
  const rest = main.replace(/^[A-Ga-g][#♯b♭]?/, '');
  let intervals = [0, 4, 7];
  for (const [pattern, tones] of QUALITIES) {
    if (pattern.test(rest)) { intervals = tones; break; }
  }
  const bassPc = slash !== undefined ? pitchClassOf(slash) : null;
  // Voice the chord in the octave below middle C, bass an octave under that.
  const rootMidi = 48 + rootPc;
  const midis = intervals.map(interval => rootMidi + interval);
  if (bassPc !== null) midis.unshift(36 + bassPc);
  else midis.unshift(36 + rootPc);
  return { midis, rootPc, bassPc };
}

/** Move a symbol's letters by semitones, keeping the rest of the writing:
 *  "F#m7/E" up two is "G#m7/F#". Sharps for sharp keys' habit; simple. */
export function transposeChordSymbol(symbol: string, semitones: number): string {
  const shiftToken = (token: string) => {
    const pc = pitchClassOf(token);
    if (pc === null) return token;
    const next = ((pc + semitones) % 12 + 12) % 12;
    const useFlat = /[b♭]/.test(token);
    return (useFlat ? NAMES_FLAT : NAMES_SHARP)[next] + token.replace(/^[A-Ga-g][#♯b♭]?/, '');
  };
  const [main, slash] = symbol.split('/');
  return slash !== undefined ? `${shiftToken(main)}/${shiftToken(slash)}` : shiftToken(main);
}
