'use client';

// The pure half of the score view: everything about turning midi notes into
// engraved marks that can be computed without touching a canvas. Kept apart
// from the renderer so a musician-visible rule — "that should be an E-flat,
// not a D-sharp" — is testable as a function.

export type Accidental = -1 | 0 | 1;

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
// Order in which sharps/flats appear in a key signature.
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Pitch classes of the major scale implied by a signature (-7 flats..+7 sharps). */
function scalePitchClasses(signature: number): Set<number> {
  const tonic = ((signature >= 0 ? 7 * signature : 5 * -signature) % 12 + 12) % 12;
  return new Set([0, 2, 4, 5, 7, 9, 11].map(step => (tonic + step) % 12));
}

/**
 * The signature that spells this music with the fewest accidental marks.
 * Ties break toward the emptier signature, so ambiguous content lands on the
 * plainer page. Minor keys come out as their relative major, which is the
 * same set of lines-and-spaces — exactly what the reader needs.
 */
export function inferKeySignature(midis: number[]): number {
  let best = 0, bestCost = Infinity;
  for (let signature = -7; signature <= 7; signature++) {
    const scale = scalePitchClasses(signature);
    const cost = midis.reduce((sum, midi) => sum + (scale.has(((midi % 12) + 12) % 12) ? 0 : 1), 0);
    if (cost < bestCost || (cost === bestCost && Math.abs(signature) < Math.abs(best))) { best = signature; bestCost = cost; }
  }
  return best;
}

/** What the signature says each letter carries by default. */
export function signatureAlteration(letter: string, signature: number): Accidental {
  if (signature > 0) return SHARP_ORDER.indexOf(letter) < signature ? 1 : 0;
  if (signature < 0) return FLAT_ORDER.indexOf(letter) < -signature ? -1 : 0;
  return 0;
}

export interface SpelledPitch {
  letter: typeof LETTERS[number];
  octave: number;
  /** The sounding alteration of this note (-1 flat, 0 natural, +1 sharp). */
  alteration: Accidental;
}

/**
 * Spell a midi number in a key: diatonic notes take the letter the signature
 * gives them; chromatic notes are spelled flat-side in flat keys and
 * sharp-side otherwise.
 */
export function spellPitch(midi: number, signature: number): SpelledPitch {
  const pc = ((midi % 12) + 12) % 12;
  // First preference: a letter whose signature-default alteration lands on pc.
  for (let i = 0; i < 7; i++) {
    const letter = LETTERS[i];
    const alt = signatureAlteration(letter, signature);
    if ((LETTER_PC[i] + alt + 12) % 12 === pc) {
      const octave = Math.floor((midi - alt) / 12) - 1;
      return { letter, octave, alteration: alt };
    }
  }
  // Chromatic: flat keys spell downward, sharp keys upward.
  const useFlat = signature < 0;
  for (let i = 0; i < 7; i++) {
    const alt: Accidental = useFlat ? -1 : 1;
    if ((LETTER_PC[i] + alt + 12) % 12 === pc) {
      const octave = Math.floor((midi - alt) / 12) - 1;
      return { letter: LETTERS[i], octave, alteration: alt };
    }
  }
  const i = LETTER_PC.indexOf(pc);
  return { letter: LETTERS[i], octave: Math.floor(midi / 12) - 1, alteration: 0 };
}

/** Diatonic steps above the staff's middle line (B4 treble, D3 bass). */
export function staffStep(pitch: SpelledPitch, clef: 'treble' | 'bass'): number {
  const index = LETTERS.indexOf(pitch.letter) + pitch.octave * 7;
  const middle = clef === 'treble' ? LETTERS.indexOf('B') + 4 * 7 : LETTERS.indexOf('D') + 3 * 7;
  return index - middle;
}

export interface NoteSymbol {
  /** In beats: 4 whole, 2 half, 1 quarter, .5 eighth, .25 sixteenth. */
  value: number;
  dotted: boolean;
  /** Tied to the NEXT symbol in the list. */
  tiedToNext: boolean;
}

const PLAIN: Array<{ beats: number; value: number; dotted: boolean }> = [
  { beats: 4, value: 4, dotted: false }, { beats: 3, value: 2, dotted: true },
  { beats: 2, value: 2, dotted: false }, { beats: 1.5, value: 1, dotted: true },
  { beats: 1, value: 1, dotted: false }, { beats: 0.75, value: 0.5, dotted: true },
  { beats: 0.5, value: 0.5, dotted: false }, { beats: 0.25, value: 0.25, dotted: false },
];

/**
 * A duration in beats -> the tied chain of printable values. Durations come
 * from live data with articulation gaps (a quarter is stored ~0.96 beats), so
 * the input is first snapped to the nearest printable total.
 */
/** Snap a lived duration (articulation gap included) to its musical total. */
export function snapBeats(rawBeats: number): number {
  const printable = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10, 12, 16];
  return printable.reduce((best, value) => Math.abs(value - rawBeats) < Math.abs(best - rawBeats) ? value : best, 0.25);
}

export function durationToSymbols(rawBeats: number): NoteSymbol[] {
  // Snap to MUSICAL totals, not to any quarter-beat multiple: a stored whole
  // note arrives as ~3.84 beats (articulation gap included), and the nearest
  // 0.25-grid value is 3.75 — which would print as a tied chain of three
  // glyphs. The nearest note-shaped total is 4: one whole note.
  const beats = snapBeats(rawBeats);
  const out: NoteSymbol[] = [];
  let remaining = Math.max(0.25, beats);
  while (remaining > 0.001) {
    const fit = PLAIN.find(item => item.beats <= remaining + 0.001) ?? PLAIN[PLAIN.length - 1];
    out.push({ value: fit.value, dotted: fit.dotted, tiedToNext: false });
    remaining -= fit.beats;
  }
  for (let i = 0; i + 1 < out.length; i++) out[i].tiedToNext = true;
  return out;
}

/** The accidental MARK to print, given what the bar has already said. */
export function accidentalMark(
  pitch: SpelledPitch,
  signature: number,
  barState: Map<string, Accidental>,
): '♯' | '♭' | '♮' | null {
  const key = `${pitch.letter}${pitch.octave}`;
  const inherited = barState.has(key) ? barState.get(key)! : signatureAlteration(pitch.letter, signature);
  if (inherited === pitch.alteration) return null;
  barState.set(key, pitch.alteration);
  return pitch.alteration === 1 ? '♯' : pitch.alteration === -1 ? '♭' : '♮';
}
