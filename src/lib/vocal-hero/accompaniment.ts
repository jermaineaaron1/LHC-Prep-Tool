'use client';

// The band that reads the score, not just the grid.
//
// Instrument instructions live ON the singing notes, like tempo marks: an
// instruction at a note takes effect from that note's bar and PLAYS UNTIL
// the next instruction or an explicit stop. The song's saved styles are the
// opening default. The band also follows the music's own expression — its
// loudness tracks the choir's dynamics and hairpins bar by bar, its clock is
// the same warp the singers get (so it broadens through a ritardando and
// waits through a fermata with the chord ringing across the pause), and the
// final chord is left to ring. All of the EVENT BUILDING is pure and tested;
// only the last inch touches WebAudio.

import { parseChord } from './chords';
import { interpretMarks } from './performMarks';
import type { BandClip, BandTimbre, BandTrack, SongNote } from './types';
import {
  playBassTone, playCajonBass, playCajonSlap, playCajonTick, playGuitarPluck,
  playHat, playKick, playPianoNote, playSnare, playStrum, playTom,
} from './voiceSynth';

export type { BandClip, BandTimbre, BandTrack };

export interface BandBar { start: number; end: number; beatCount: number }
export interface ChordAt { at: number; symbol: string }

export type InstrumentStyleId =
  | 'off'
  | 'gtr-down' | 'gtr-folk' | 'gtr-8ths' | 'gtr-arp' | 'gtr-travis' | 'gtr-solo'
  | 'pno-chords' | 'pno-arp'
  | 'bass-walk'
  | 'melody-gtr' | 'melody-pno'
  | 'custom';
export type DrumStyleId = 'off' | 'drum-kit' | 'drum-drive' | 'cajon-groove' | 'cajon-sway' | 'custom';

export const INSTRUMENT_STYLES: Array<{ id: InstrumentStyleId; label: string }> = [
  { id: 'off', label: '— No instrument' },
  { id: 'gtr-down', label: '🎸 Guitar · downstrums' },
  { id: 'gtr-folk', label: '🎸 Guitar · folk strum (D D-U -U D-U)' },
  { id: 'gtr-8ths', label: '🎸 Guitar · driving eighths' },
  { id: 'gtr-arp', label: '🎸 Guitar · fingerpicked arpeggio' },
  { id: 'gtr-travis', label: '🎸 Guitar · Travis picking' },
  { id: 'gtr-solo', label: '🎸 Guitar · solo line over the changes' },
  { id: 'pno-chords', label: '🎹 Piano · held chords' },
  { id: 'pno-arp', label: '🎹 Piano · flowing arpeggio' },
  { id: 'bass-walk', label: '🎸 Bass · walking line' },
  { id: 'melody-gtr', label: '🎸 Guitar · double the melody' },
  { id: 'melody-pno', label: '🎹 Piano · double the melody' },
  { id: 'custom', label: '✍ Custom · your written-out line' },
];

export const DRUM_STYLES: Array<{ id: DrumStyleId; label: string }> = [
  { id: 'off', label: '— No drums' },
  { id: 'drum-kit', label: '🥁 Kit · straight' },
  { id: 'drum-drive', label: '🥁 Kit · driving' },
  { id: 'cajon-groove', label: '🪘 Cajon · groove' },
  { id: 'cajon-sway', label: '🪘 Cajon · sway (waltz-friendly)' },
  { id: 'custom', label: '✍ Custom · your written-out tab' },
];

export type BandEventKind =
  | 'strum-down' | 'strum-up' | 'pluck' | 'keys' | 'bass'
  | 'kick' | 'snare' | 'hat' | 'tom-low' | 'tom-high'
  | 'cajon-bass' | 'cajon-slap' | 'cajon-tick';

export interface BandEvent {
  id: string;
  /** Performance time when a warp is supplied, written time otherwise. */
  at: number;
  kind: BandEventKind;
  midis?: number[];
  sustain?: number;
  level?: number;
  /** The expression-following factor: the choir's dynamics at this moment. */
  gain?: number;
  /** Slide target (midi): the pluck bends into this pitch as it rings —
   *  written in the tab as e3>g3. */
  slideTo?: number;
  /** Which instrument voice renders this event: real plucked strings,
   *  the piano, or the bass. Unset falls back to the kind's default. */
  timbre?: BandTimbre;
}

type PatternStep = { beat: number; kind: BandEventKind; degree?: number; octave?: number; level?: number; sustain?: number };

// Patterns are authored across a four-beat bar and clipped to the bar's real
// beat count, so 2/4 takes the front half and 3/4 the front three beats.
const INSTRUMENT_PATTERNS: Partial<Record<InstrumentStyleId, PatternStep[]>> = {
  'gtr-down': [0, 1, 2, 3].map(beat => ({ beat, kind: 'strum-down' as const })),
  'gtr-folk': [
    { beat: 0, kind: 'strum-down' }, { beat: 1, kind: 'strum-down' }, { beat: 1.5, kind: 'strum-up' },
    { beat: 2.5, kind: 'strum-up' }, { beat: 3, kind: 'strum-down' }, { beat: 3.5, kind: 'strum-up' },
  ],
  'gtr-8ths': [0, 1, 2, 3].flatMap(beat => [
    { beat, kind: 'strum-down' as const }, { beat: beat + 0.5, kind: 'strum-up' as const, level: 0.03 },
  ]),
  'gtr-arp': [
    { beat: 0, kind: 'pluck', degree: -1 }, { beat: 0.5, kind: 'pluck', degree: 0 },
    { beat: 1, kind: 'pluck', degree: 1 }, { beat: 1.5, kind: 'pluck', degree: 2 },
    { beat: 2, kind: 'pluck', degree: 1 }, { beat: 2.5, kind: 'pluck', degree: 2, octave: 1 },
    { beat: 3, kind: 'pluck', degree: 1 }, { beat: 3.5, kind: 'pluck', degree: 0 },
  ],
  'gtr-travis': [
    { beat: 0, kind: 'pluck', degree: -1 }, { beat: 0.5, kind: 'pluck', degree: 2 },
    { beat: 1, kind: 'pluck', degree: 1 }, { beat: 1.5, kind: 'pluck', degree: 2 },
    { beat: 2, kind: 'pluck', degree: -1 }, { beat: 2.5, kind: 'pluck', degree: 1 },
    { beat: 3, kind: 'pluck', degree: 2 }, { beat: 3.5, kind: 'pluck', degree: 0, octave: 1 },
  ],
  'gtr-solo': [
    { beat: 0, kind: 'pluck', degree: 0, octave: 1 }, { beat: 0.5, kind: 'pluck', degree: 1, octave: 1 },
    { beat: 1, kind: 'pluck', degree: 2, octave: 1 }, { beat: 1.5, kind: 'pluck', degree: 0, octave: 2 },
    { beat: 2, kind: 'pluck', degree: 2, octave: 1 }, { beat: 2.5, kind: 'pluck', degree: 1, octave: 1 },
    { beat: 3, kind: 'pluck', degree: 2, octave: 1 }, { beat: 3.5, kind: 'pluck', degree: 1, octave: 1 },
  ],
  // Piano: the left hand holds the bar down, the right answers on the half.
  'pno-chords': [
    { beat: 0, kind: 'keys', sustain: 4 }, { beat: 2, kind: 'keys', level: 0.035, sustain: 2 },
  ],
  'pno-arp': [
    { beat: 0, kind: 'keys', degree: -1 }, { beat: 0.5, kind: 'keys', degree: 0 },
    { beat: 1, kind: 'keys', degree: 1 }, { beat: 1.5, kind: 'keys', degree: 2 },
    { beat: 2, kind: 'keys', degree: 0, octave: 1 }, { beat: 2.5, kind: 'keys', degree: 2 },
    { beat: 3, kind: 'keys', degree: 1 }, { beat: 3.5, kind: 'keys', degree: 0 },
  ],
};

const DRUM_PATTERNS: Partial<Record<DrumStyleId, PatternStep[]>> = {
  'drum-kit': [
    { beat: 0, kind: 'kick' }, { beat: 2, kind: 'kick' },
    { beat: 1, kind: 'snare' }, { beat: 3, kind: 'snare' },
    ...[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map(beat => ({ beat, kind: 'hat' as const })),
  ],
  'drum-drive': [
    { beat: 0, kind: 'kick' }, { beat: 2, kind: 'kick' }, { beat: 2.5, kind: 'kick', level: 0.1 },
    { beat: 1, kind: 'snare' }, { beat: 3, kind: 'snare' },
    ...[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map(beat => ({ beat, kind: 'hat' as const, level: 0.045 })),
  ],
  'cajon-groove': [
    { beat: 0, kind: 'cajon-bass' }, { beat: 2.5, kind: 'cajon-bass' },
    { beat: 1, kind: 'cajon-slap' }, { beat: 3, kind: 'cajon-slap' },
    ...[0.5, 1.5, 2, 3.5].map(beat => ({ beat, kind: 'cajon-tick' as const })),
  ],
  'cajon-sway': [
    { beat: 0, kind: 'cajon-bass' },
    { beat: 2, kind: 'cajon-slap' },
    ...[0.5, 1, 1.5, 2.5].map(beat => ({ beat, kind: 'cajon-tick' as const })),
  ],
};

// ── written-out tabs ───────────────────────────────────────────────────────
// The DSL a drummer or guitarist would scribble. One column per EIGHTH.
//
// Drum tab, one lane per line, looped over its length:
//   K: o---o---     kick / bass drum
//   S: --o---o-     snare
//   H: x-x-x-x-     hi-hat
//   T: ------oo     low tom      t: high tom
//   B: o---o---     cajon bass   P: cajon slap   c: cajon tick
// 'x' or 'o' hits, capitals in the SYMBOL position accent (X / O), '-' or
// '.' rests, spaces and bar lines '|' are ignored.
//
// Instrument line: space-separated tokens, one per eighth, looped:
//   e3 g3 b3 e4 ~ - g3 b3
// note names hit, '~' extends the previous note, '-' rests, '|' ignored.

const DRUM_LANES: Record<string, BandEventKind> = {
  // Capital T is the HIGH tom, small t the low — matching the studio grid.
  K: 'kick', S: 'snare', H: 'hat', T: 'tom-high', t: 'tom-low',
  B: 'cajon-bass', P: 'cajon-slap', c: 'cajon-tick',
};

export interface DrumTabHit { eighth: number; kind: BandEventKind; accent: boolean }
export interface ParsedDrumTab { hits: DrumTabHit[]; lengthEighths: number }

export function parseDrumTab(text: string): ParsedDrumTab | null {
  const hits: DrumTabHit[] = [];
  let length = 0;
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.match(/^\s*([KSHTtBPc])\s*:\s*(.+)$/);
    if (!match) continue;
    const kind = DRUM_LANES[match[1]];
    const cells = match[2].replace(/[|\s]/g, '');
    length = Math.max(length, cells.length);
    for (let index = 0; index < cells.length; index++) {
      const cell = cells[index];
      if (cell === '-' || cell === '.') continue;
      hits.push({ eighth: index, kind, accent: cell === 'X' || cell === 'O' });
    }
  }
  if (!hits.length || !length) return null;
  return { hits, lengthEighths: length };
}

const TAB_LETTER_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export interface InstrumentTabNote {
  eighth: number;
  /** Lowest pitch — kept for compatibility; midis carries the whole stack. */
  midi: number;
  /** Every pitch sounding at this eighth — one entry for a single note, a
   *  full voicing for a chord (e3,g3,b3) or a [Em7] symbol token. */
  midis: number[];
  holdEighths: number;
  slideTo?: number;
  accent?: boolean;
  staccato?: boolean;
  /** The chord symbol this stack came from, when it was written as [Sym]. */
  symbol?: string;
}
export interface ParsedInstrumentTab { notes: InstrumentTabNote[]; lengthEighths: number }

function tabTokenMidi(letter: string, accidental: string, octave: string): number {
  let pc = TAB_LETTER_PC[letter];
  if (accidental === '#') pc += 1;
  if (accidental === 'b') pc -= 1;
  return pc + 12 * (parseInt(octave, 10) + 1);
}

/** One written token:
 *    e3            a note        e3>g3   slide into g3 as it rings
 *    e3,g3,b3      a chord       [Em7]   the symbol's own voicing
 *  suffixes: ! accent (louder) · . staccato (short)  — e3! or [Em7].  */
export function parseInstrumentTab(text: string): ParsedInstrumentTab | null {
  const tokens = text.replace(/\|/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const notes: InstrumentTabNote[] = [];
  let index = 0;
  for (let token of tokens) {
    if (token === '-' || token === '.') { index += 1; continue; }
    if (token === '~') { if (notes.length) notes[notes.length - 1].holdEighths += 1; index += 1; continue; }
    let accent = false, staccato = false;
    while (/[!.]$/.test(token) && token.length > 1) {
      if (token.endsWith('!')) accent = true;
      else staccato = true;
      token = token.slice(0, -1);
    }
    const flags = { ...(accent ? { accent: true } : {}), ...(staccato ? { staccato: true } : {}) };
    const symbol = token.match(/^\[(.+)\]$/);
    if (symbol) {
      const parsed = parseChord(symbol[1]);
      if (parsed && parsed.midis.length) notes.push({ eighth: index, midi: parsed.midis[0], midis: parsed.midis, holdEighths: 1, symbol: symbol[1], ...flags });
      index += 1;
      continue;
    }
    const parts = token.toLowerCase().split(',').filter(Boolean);
    const midis: number[] = [];
    let slideTo: number | undefined;
    for (const part of parts) {
      const match = part.match(/^([a-g])([#b]?)(-?\d)(?:>([a-g])([#b]?)(-?\d))?$/);
      if (!match) continue;
      midis.push(tabTokenMidi(match[1], match[2], match[3]));
      if (match[4] && parts.length === 1) slideTo = tabTokenMidi(match[4], match[5], match[6]);
    }
    if (!midis.length) { index += 1; continue; }
    midis.sort((a, b) => a - b);
    notes.push({ eighth: index, midi: midis[0], midis, holdEighths: 1, ...(slideTo !== undefined ? { slideTo } : {}), ...flags });
    index += 1;
  }
  if (!notes.length) return null;
  return { notes, lengthEighths: index };
}

/** Deterministic per-event jitter: a hash of the id spread over ±1, so the
 *  same song humanizes the same way on every device, every play. */
function jitterOf(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) { hash ^= id.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return ((hash >>> 8) % 2001) / 1000 - 1;   // -1 .. +1
}

/** Walk a bass line through a bar: root, chord tones, and a chromatic
 *  approach note aimed at the NEXT chord's root — the classic shape. */
function walkBar(bar: BandBar, tones: { midis: number[]; bass: number }, nextRootPc: number): number[] {
  const clampBass = (midi: number) => { let out = midi; while (out < 38) out += 12; while (out > 55) out -= 12; return out; };
  const root = clampBass(tones.bass);
  const upper = tones.midis.slice(1);
  const third = clampBass(upper[1] ?? root + 4);
  const fifth = clampBass(upper[2] ?? root + 7);
  const target = clampBass(36 + nextRootPc);
  // approach chromatically from whichever side is nearer
  const approach = target + (Math.abs(target - 1 - fifth) <= Math.abs(target + 1 - fifth) ? -1 : 1);
  const steps = [root, third, fifth, clampBass(approach)];
  return steps.slice(0, bar.beatCount);
}

/** The chord sounding at a moment: the last symbol at or before it. */
function chordTonesAt(chords: ChordAt[], time: number, transpose: number): { midis: number[]; bass: number } | null {
  let active: ChordAt | null = null;
  for (const chord of chords) {
    if (chord.at <= time + 0.02) active = chord;
    else break;
  }
  if (!active) return null;
  const parsed = parseChord(active.symbol);
  if (!parsed) return null;
  const midis = parsed.midis.map(midi => midi + transpose);
  return { midis, bass: midis[0] };
}

export interface BandRegion {
  from: number; instrument: InstrumentStyleId; drums: DrumStyleId;
  /** The written part behind a 'custom' style IN THIS REGION — the
   *  instruction's own tab when it carries one, inherited while the field
   *  is untouched, undefined to fall back to the song-wide tab. */
  instrumentTab?: string; drumTab?: string;
}

/** The style timeline: the song's defaults from the top, then every
 *  band instruction found on a note, in time order. 'stop' is a style. */
export function bandRegions(notes: SongNote[], defaults: { instrument: InstrumentStyleId; drums: DrumStyleId }): BandRegion[] {
  const regions: BandRegion[] = [{ from: 0, ...defaults }];
  const marked = notes
    .filter(note => note.marks?.band && (note.marks.band.instrument || note.marks.band.drums))
    .sort((a, b) => a.start - b.start);
  for (const note of marked) {
    const previous = regions[regions.length - 1];
    const instruction = note.marks!.band!;
    const resolve = (value: string | undefined, current: string): string =>
      value === undefined ? current : value === 'stop' ? 'off' : value;
    regions.push({
      from: note.start,
      instrument: resolve(instruction.instrument, previous.instrument) as InstrumentStyleId,
      drums: resolve(instruction.drums, previous.drums) as DrumStyleId,
      // A field the instruction touches takes the instruction's tab (even
      // none); an untouched field keeps carrying the part already playing.
      instrumentTab: instruction.instrument !== undefined ? instruction.instrument_tab : previous.instrumentTab,
      drumTab: instruction.drums !== undefined ? instruction.drum_tab : previous.drumTab,
    });
  }
  return regions;
}

const regionAt = (regions: BandRegion[], time: number): BandRegion => {
  let active = regions[0];
  for (const region of regions) {
    if (region.from <= time + 0.02) active = region;
    else break;
  }
  return active;
};

export function buildBandEvents(options: {
  bars: BandBar[];
  chords: ChordAt[];
  /** The singing itself: instrument instructions ride these notes, the
   *  band's loudness follows their dynamics, and the melody styles double
   *  the part 0 / part -1 line. */
  notes: SongNote[];
  defaults: { instrument: InstrumentStyleId; drums: DrumStyleId };
  /** Stop where the music stops — no band through the empty padding bars. */
  until: number;
  transpose?: number;
  warp?: (time: number) => number;
  /** Hairpin-adjusted velocities by note id (from interpretMarks), so the
   *  band swells and fades WITH the choir. Falls back to stored velocity. */
  effectiveVelocity?: Map<string, number>;
  /** The written-out lines behind the 'custom' styles. */
  customTabs?: { instrument?: string; drums?: string };
  /** DAW-style instrument tracks: clips of written music placed freely on
   *  the song. Each clip plays ONCE from its start in its track's timbre —
   *  clips do not loop and are independent of the style instructions. */
  tracks?: BandTrack[];
  /** ±8ms seeded jitter so the band breathes instead of sounding quantized.
   *  On by default; pass false for grid-exact output (tests, exports). */
  humanize?: boolean;
  /** Two bars of stick clicks in the lead-in before the first entry. On by
   *  default when the lead-in has room. */
  countIn?: boolean;
}): BandEvent[] {
  const { bars, chords, notes, defaults, until } = options;
  const transpose = options.transpose ?? 0;
  const warp = options.warp ?? ((time: number) => time);
  const velocity = options.effectiveVelocity;
  const sortedChords = [...chords].sort((a, b) => a.at - b.at);
  const regions = bandRegions(notes, defaults);
  const melody = notes.filter(note => note.part === 0 || note.part === -1).sort((a, b) => a.start - b.start);

  // The choir's loudness, bar by bar: mean effective velocity of the notes
  // sounding in the bar against the mf baseline of 88. This is what makes a
  // crescendo lift the drums as well as the voices.
  const loudness = (bar: BandBar): number => {
    const sounding = notes.filter(note => note.start < bar.end && note.end > bar.start);
    if (!sounding.length) return 1;
    const mean = sounding.reduce((sum, note) => sum + (velocity?.get(note.id) ?? note.velocity), 0) / sounding.length;
    return Math.max(0.55, Math.min(1.45, mean / 88));
  };

  // Written parts resolve per REGION: an instruction's own tab first, the
  // song-wide tab as the fallback. Parses are memoized by text.
  const parsedInstrumentTabs = new Map<string, ParsedInstrumentTab | null>();
  const parsedDrumTabs = new Map<string, ParsedDrumTab | null>();
  const instrumentTabFor = (region: BandRegion): ParsedInstrumentTab | null => {
    const text = region.instrumentTab ?? options.customTabs?.instrument ?? '';
    if (!text.trim()) return null;
    if (!parsedInstrumentTabs.has(text)) parsedInstrumentTabs.set(text, parseInstrumentTab(text));
    return parsedInstrumentTabs.get(text)!;
  };
  const drumTabFor = (region: BandRegion): ParsedDrumTab | null => {
    const text = region.drumTab ?? options.customTabs?.drums ?? '';
    if (!text.trim()) return null;
    if (!parsedDrumTabs.has(text)) parsedDrumTabs.set(text, parseDrumTab(text));
    return parsedDrumTabs.get(text)!;
  };

  const events: BandEvent[] = [];

  // ---- the count-in: two bars of clicks in the lead-in, so the room
  // breathes together before the first entry. Cajon songs click woodier.
  if (options.countIn !== false && notes.length) {
    const firstEntry = Math.min(...notes.map(note => note.start));
    // A drummer counts right up to the entry — including into a pickup bar.
    // The last two bars that BEGIN before the first note carry the clicks,
    // and every click lands strictly before the singing starts. Songs whose
    // lead-in is too short for at least four clicks get none.
    const countBars = bars.filter(bar => bar.start < firstEntry - 0.05).slice(-2);
    const opening = regionAt(regions, firstEntry + 0.01);
    const bandPlays = opening.instrument !== 'off' || opening.drums !== 'off';
    const tick: BandEventKind = opening.drums.startsWith('cajon') ? 'cajon-tick' : 'hat';
    if (bandPlays && countBars.length) {
      const clicks: BandEvent[] = [];
      countBars.forEach((bar, barIndex) => {
        const beatLen = (bar.end - bar.start) / bar.beatCount;
        const lastBar = barIndex === countBars.length - 1;
        for (let beat = 0; beat < bar.beatCount; beat++) {
          const time = bar.start + beat * beatLen;
          if (time >= firstEntry - 0.05) break;
          clicks.push({ id: `ci-${barIndex}-${beat}`, at: warp(time), kind: tick, level: beat === 0 ? 0.06 : 0.035 });
          // the run-up to the entry doubles into eighths — the classic call-in
          if (lastBar && beat >= bar.beatCount / 2 && time + beatLen / 2 < firstEntry - 0.05) {
            clicks.push({ id: `ci-${barIndex}-${beat}h`, at: warp(time + beatLen / 2), kind: tick, level: 0.03 });
          }
        }
      });
      if (clicks.length >= 4) events.push(...clicks);
    }
  }
  let solowalk = 0;
  // A written part begins where ITS instruction begins: the loop phase
  // resets whenever the active tab text changes, instead of counting
  // eighths from the top of the song (which made a part written for a
  // later section enter mid-pattern).
  let instrumentEighth = 0, activeInstrumentText = '';
  let drumEighth = 0, activeDrumText = '';
  for (const bar of bars) {
    if (bar.start >= until - 0.05) break;
    const beatLen = (bar.end - bar.start) / bar.beatCount;
    // A style change takes effect at the barline: the region active at the
    // bar's first beat governs the whole bar, the way bands actually turn.
    const region = regionAt(regions, bar.start + 0.01);
    const gain = loudness(bar);
    const sustainWarped = (time: number, written: number) => Math.max(0.2, warp(time + written) - warp(time));

    const instrument = region.instrument;
    if (instrument !== 'off' && !instrument.startsWith('melody')) {
      const pattern = INSTRUMENT_PATTERNS[instrument] ?? [];
      for (const step of pattern) {
        if (step.beat >= bar.beatCount - 0.01) continue;
        const time = bar.start + step.beat * beatLen;
        if (time >= until) continue;
        const tones = chordTonesAt(sortedChords, time, transpose);
        if (!tones) continue;
        const upper = tones.midis.slice(1);
        let midis: number[];
        if (step.degree !== undefined) {
          const degree = step.degree === -1 ? -1 : (step.degree + (instrument === 'gtr-solo' ? solowalk : 0)) % upper.length;
          midis = [degree === -1 ? tones.bass : upper[degree] + 12 * (step.octave ?? 0)];
        } else midis = tones.midis;
        let writtenSustain = (step.sustain ?? (step.kind === 'pluck' || step.kind === 'keys' ? 1.6 : 1.9)) * beatLen;
        // A held chord must not smear into the NEXT harmony: block chords
        // release where the chord symbol changes.
        if (step.kind === 'keys' && step.degree === undefined) {
          const nextChange = sortedChords.find(chord => chord.at > time + 0.02);
          if (nextChange) writtenSustain = Math.min(writtenSustain, Math.max(0.3, nextChange.at - time));
        }
        events.push({
          id: `i-${bar.start.toFixed(3)}-${step.beat}`,
          at: warp(time), kind: step.kind, midis,
          sustain: sustainWarped(time, writtenSustain),
          level: step.level, gain,
          timbre: instrument.startsWith('pno') ? 'piano' : 'guitar',
        });
      }
      if (instrument === 'gtr-solo') solowalk = (solowalk + 1) % 3;
    }
    if (instrument === 'bass-walk') {
      const tones = chordTonesAt(sortedChords, bar.start + 0.01, transpose);
      if (tones) {
        const next = sortedChords.find(chord => chord.at > bar.start + 0.02);
        const nextTones = next ? chordTonesAt(sortedChords, next.at + 0.01, transpose) : null;
        const nextRootPc = ((nextTones ?? tones).bass % 12 + 12) % 12;
        const walk = walkBar(bar, tones, nextRootPc);
        walk.forEach((midi, beat) => {
          const time = bar.start + beat * beatLen;
          if (time >= until) return;
          events.push({
            id: `b-${bar.start.toFixed(3)}-${beat}`,
            at: warp(time), kind: 'bass', midis: [midi],
            sustain: sustainWarped(time, beatLen * 0.95), gain,
          });
        });
      }
    }
    const instrumentText = instrument === 'custom' ? (region.instrumentTab ?? options.customTabs?.instrument ?? '') : '';
    if (instrumentText !== activeInstrumentText) { activeInstrumentText = instrumentText; instrumentEighth = 0; }
    const instrumentTab = instrument === 'custom' ? instrumentTabFor(region) : null;
    if (instrument === 'custom' && instrumentTab) {
      const eighthLen = beatLen / 2;
      for (let cell = 0; cell < bar.beatCount * 2; cell++) {
        const position = (instrumentEighth + cell) % instrumentTab.lengthEighths;
        const time = bar.start + cell * eighthLen;
        if (time >= until) continue;
        for (const note of instrumentTab.notes) {
          if (note.eighth !== position) continue;
          const written = note.holdEighths * eighthLen * (note.staccato ? 0.4 : 1.05);
          events.push({
            id: `c-${bar.start.toFixed(3)}-${cell}`,
            at: warp(time), kind: 'pluck', midis: (note.midis ?? [note.midi]).map(midi => midi + transpose),
            sustain: sustainWarped(time, written),
            level: note.accent ? 0.078 : 0.05, gain,
            ...(note.slideTo !== undefined ? { slideTo: note.slideTo + transpose } : {}),
          });
        }
      }
    }
    if (instrument.startsWith('melody')) {
      const kind: BandEventKind = instrument === 'melody-pno' ? 'keys' : 'pluck';
      for (const note of melody) {
        if (note.start < bar.start - 0.01 || note.start >= bar.end - 0.01 || note.start >= until) continue;
        events.push({
          id: `m-${note.id}`,
          at: warp(note.start), kind, midis: [note.midi + transpose],
          timbre: instrument === 'melody-pno' ? 'piano' : 'guitar',
          sustain: sustainWarped(note.start, Math.max(0.2, note.end - note.start)),
          level: 0.045, gain,
        });
      }
    }
    const drumText = region.drums === 'custom' ? (region.drumTab ?? options.customTabs?.drums ?? '') : '';
    if (drumText !== activeDrumText) { activeDrumText = drumText; drumEighth = 0; }
    const drumTab = region.drums === 'custom' ? drumTabFor(region) : null;
    if (region.drums === 'custom' && drumTab) {
      const eighthLen = beatLen / 2;
      for (let cell = 0; cell < bar.beatCount * 2; cell++) {
        const position = (drumEighth + cell) % drumTab.lengthEighths;
        const time = bar.start + cell * eighthLen;
        if (time >= until) continue;
        for (const hit of drumTab.hits) {
          if (hit.eighth !== position) continue;
          events.push({
            id: `dc-${bar.start.toFixed(3)}-${cell}-${hit.kind}`,
            at: warp(time), kind: hit.kind,
            level: hit.accent ? BASE_LEVEL[hit.kind] * 1.5 : undefined, gain,
          });
        }
      }
    } else if (region.drums !== 'off') {
      for (const step of DRUM_PATTERNS[region.drums] ?? []) {
        if (step.beat >= bar.beatCount - 0.01) continue;
        const time = bar.start + step.beat * beatLen;
        if (time >= until) continue;
        events.push({ id: `d-${bar.start.toFixed(3)}-${step.beat}-${step.kind}`, at: warp(time), kind: step.kind, level: step.level, gain });
      }
    }
    instrumentEighth += bar.beatCount * 2;
    drumEighth += bar.beatCount * 2;
  }
  // ---- instrument TRACKS: clips of written music placed freely, each
  // playing once from its start in its track's timbre. Independent of the
  // style instructions above — the DAW layer over the band.
  for (const track of options.tracks ?? []) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      const parsedClip = parseInstrumentTab(clip.tab);
      if (!parsedClip) continue;
      const clipBar = bars.find(bar => clip.start >= bar.start - 0.01 && clip.start < bar.end) ?? bars[0];
      const eighthLen = clipBar ? (clipBar.end - clipBar.start) / (clipBar.beatCount * 2) : 0.25;
      const sustainWarped = (time: number, written: number) => Math.max(0.2, warp(time + written) - warp(time));
      for (const note of parsedClip.notes) {
        const time = clip.start + note.eighth * eighthLen;
        if (time >= until) continue;
        const gainBar = bars.find(bar => time >= bar.start && time < bar.end) ?? clipBar;
        events.push({
          id: `t-${track.id}-${clip.id}-${note.eighth}`,
          at: warp(time),
          kind: track.timbre === 'bass' ? 'bass' : track.timbre === 'piano' ? 'keys' : 'pluck',
          timbre: track.timbre,
          midis: (note.midis ?? [note.midi]).map(midi => midi + transpose),
          sustain: sustainWarped(time, note.holdEighths * eighthLen * (note.staccato ? 0.4 : 1.05)),
          level: (note.accent ? 1.5 : 1) * (track.timbre === 'bass' ? 0.09 : 0.055),
          gain: gainBar ? loudness(gainBar) : 1,
          ...(note.slideTo !== undefined && track.timbre === 'guitar' ? { slideTo: note.slideTo + transpose } : {}),
        });
      }
    }
  }
  // ±8ms of seeded humanity (drums tighter at ±5ms): enough that the strums
  // stop sounding quantized, never enough to read as a timing mistake. The
  // count-in stays machine-crisp — it IS the click.
  if (options.humanize !== false) {
    const DRUMS: BandEventKind[] = ['kick', 'snare', 'hat', 'tom-low', 'tom-high', 'cajon-bass', 'cajon-slap', 'cajon-tick'];
    for (const event of events) {
      if (event.id.startsWith('ci-')) continue;
      const spread = DRUMS.includes(event.kind) ? 0.005 : 0.008;
      event.at = Math.max(0, event.at + jitterOf(event.id) * spread);
    }
  }

  // The last chord is left to ring, the way a band actually finishes.
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.kind === 'strum-down' || event.kind === 'strum-up' || event.kind === 'keys') {
      event.sustain = Math.max(event.sustain ?? 1, 2.5);
      break;
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

const BASE_LEVEL: Record<BandEventKind, number> = {
  'strum-down': 0.045, 'strum-up': 0.04, pluck: 0.05, keys: 0.05, bass: 0.09,
  kick: 0.16, snare: 0.09, hat: 0.035, 'tom-low': 0.11, 'tom-high': 0.1,
  'cajon-bass': 0.13, 'cajon-slap': 0.07, 'cajon-tick': 0.025,
};

export function playBandEvent(context: AudioContext, event: BandEvent, when: number): void {
  const level = (event.level ?? BASE_LEVEL[event.kind]) * (event.gain ?? 1);
  switch (event.kind) {
    case 'strum-down': playStrum(context, event.midis ?? [], when, 'down', event.sustain ?? 1, level); break;
    case 'strum-up': playStrum(context, event.midis ?? [], when, 'up', event.sustain ?? 0.8, level); break;
    case 'pluck':
      if (event.timbre === 'piano') (event.midis ?? []).forEach((midi, index) => playPianoNote(context, midi, when + index * 0.005, event.sustain ?? 0.9, level));
      else if (event.timbre === 'bass') (event.midis ?? []).forEach(midi => playBassTone(context, midi, when, event.sustain ?? 0.9, level));
      else (event.midis ?? []).forEach(midi => playGuitarPluck(context, midi, when, event.sustain ?? 0.9, level, event.slideTo));
      break;
    case 'keys': (event.midis ?? []).forEach((midi, index) => playPianoNote(context, midi, when + index * 0.006, event.sustain ?? 1.2, level)); break;
    case 'bass': (event.midis ?? []).forEach(midi => playBassTone(context, midi, when, event.sustain ?? 0.8, level)); break;
    case 'kick': playKick(context, when, level); break;
    case 'snare': playSnare(context, when, level); break;
    case 'hat': playHat(context, when, level); break;
    case 'tom-low': playTom(context, when, false, level); break;
    case 'tom-high': playTom(context, when, true, level); break;
    case 'cajon-bass': playCajonBass(context, when, level); break;
    case 'cajon-slap': playCajonSlap(context, when, level); break;
    case 'cajon-tick': playCajonTick(context, when, level); break;
  }
}

const LOOKAHEAD = 0.6;

/** The GuidePlayer's twin: hand the audio clock every band event that begins
 *  within the lookahead. Safe to call as often as you like. */
export class BandPlayer {
  private readonly context: AudioContext;
  private scheduled = new Set<string>();
  private events: BandEvent[];

  constructor(context: AudioContext, events: BandEvent[]) {
    this.context = context;
    this.events = events;
  }

  update(songElapsed: number, rate = 1): void {
    const now = this.context.currentTime;
    for (const event of this.events) {
      if (this.scheduled.has(event.id)) continue;
      const delay = event.at - songElapsed;   // in song seconds
      if (delay > LOOKAHEAD) break;
      this.scheduled.add(event.id);
      if (delay < -0.05) continue;   // gone by — count it done, do not fire late
      playBandEvent(this.context, event, now + Math.max(0, delay) / Math.max(0.25, rate));
    }
  }

  reset(): void { this.scheduled.clear(); }
}
