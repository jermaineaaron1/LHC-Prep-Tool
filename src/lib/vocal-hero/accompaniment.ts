'use client';

// The band: guitar and drums/cajon patterns compiled into a flat list of
// timed events, then scheduled the way the guide tones are — a lookahead
// player fed the song clock, each event fired once. The EVENT BUILDING is
// pure, so what a folk strum does to a 2/4 bar is a tested fact; only the
// last inch touches WebAudio.

import { parseChord } from './chords';
import type { SongNote } from './types';
import {
  playCajonBass, playCajonSlap, playCajonTick,
  playHat, playKick, playPluck, playSnare, playStrum,
} from './voiceSynth';

export interface BandBar { start: number; end: number; beatCount: number }
export interface ChordAt { at: number; symbol: string }

export type GuitarStyleId = 'off' | 'gtr-down' | 'gtr-folk' | 'gtr-8ths' | 'gtr-arp' | 'gtr-travis' | 'gtr-solo';
export type DrumStyleId = 'off' | 'drum-kit' | 'drum-drive' | 'cajon-groove' | 'cajon-sway';

export const GUITAR_STYLES: Array<{ id: GuitarStyleId; label: string }> = [
  { id: 'off', label: 'No guitar' },
  { id: 'gtr-down', label: 'Downstrums — one per beat' },
  { id: 'gtr-folk', label: 'Folk strum — D D-U -U D-U' },
  { id: 'gtr-8ths', label: 'Driving eighths — D-U throughout' },
  { id: 'gtr-arp', label: 'Fingerpicked — rolling arpeggio' },
  { id: 'gtr-travis', label: 'Travis picking — alternating bass' },
  { id: 'gtr-solo', label: 'Solo line — a lead over the changes' },
];

export const DRUM_STYLES: Array<{ id: DrumStyleId; label: string }> = [
  { id: 'off', label: 'No drums' },
  { id: 'drum-kit', label: 'Kit — straight' },
  { id: 'drum-drive', label: 'Kit — driving' },
  { id: 'cajon-groove', label: 'Cajon — groove' },
  { id: 'cajon-sway', label: 'Cajon — sway (waltz-friendly)' },
];

export type BandEventKind =
  | 'strum-down' | 'strum-up' | 'pluck'
  | 'kick' | 'snare' | 'hat'
  | 'cajon-bass' | 'cajon-slap' | 'cajon-tick';

export interface BandEvent {
  id: string;
  /** In the caller's time — pass warped times and the band obeys every
   *  ritardando and fermata. */
  at: number;
  kind: BandEventKind;
  /** For strums and plucks: the sounding midi notes. */
  midis?: number[];
  sustain?: number;
  level?: number;
}

// Patterns are authored across a four-beat bar in { beat, kind, degree } and
// clipped to the bar's real beat count, so 2/4 takes the front half and 3/4
// the front three beats. `degree` indexes the chord's tones for picking;
// negative means the bass note.
type PatternStep = { beat: number; kind: BandEventKind; degree?: number; octave?: number; level?: number; sustain?: number };

const GUITAR_PATTERNS: Record<Exclude<GuitarStyleId, 'off'>, PatternStep[]> = {
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
  // The lead noodles the chord upward and turns round at the top; an octave
  // up from the accompaniment register, and it varies by bar so it walks
  // rather than loops.
  'gtr-solo': [
    { beat: 0, kind: 'pluck', degree: 0, octave: 1 }, { beat: 0.5, kind: 'pluck', degree: 1, octave: 1 },
    { beat: 1, kind: 'pluck', degree: 2, octave: 1 }, { beat: 1.5, kind: 'pluck', degree: 0, octave: 2 },
    { beat: 2, kind: 'pluck', degree: 2, octave: 1 }, { beat: 2.5, kind: 'pluck', degree: 1, octave: 1 },
    { beat: 3, kind: 'pluck', degree: 2, octave: 1 }, { beat: 3.5, kind: 'pluck', degree: 1, octave: 1 },
  ],
};

const DRUM_PATTERNS: Record<Exclude<DrumStyleId, 'off'>, PatternStep[]> = {
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

export function buildBandEvents(options: {
  bars: BandBar[];
  chords: ChordAt[];
  guitar: GuitarStyleId;
  drums: DrumStyleId;
  /** Stop where the music stops — no band through the empty padding bars. */
  until: number;
  transpose?: number;
  warp?: (time: number) => number;
}): BandEvent[] {
  const { bars, chords, guitar, drums, until } = options;
  const transpose = options.transpose ?? 0;
  const warp = options.warp ?? ((time: number) => time);
  const sorted = [...chords].sort((a, b) => a.at - b.at);
  const events: BandEvent[] = [];
  let solowalk = 0;
  for (const bar of bars) {
    if (bar.start >= until - 0.05) break;
    const beatLen = (bar.end - bar.start) / bar.beatCount;
    if (guitar !== 'off') {
      for (const step of GUITAR_PATTERNS[guitar]) {
        if (step.beat >= bar.beatCount - 0.01) continue;
        const time = bar.start + step.beat * beatLen;
        if (time >= until) continue;
        const tones = chordTonesAt(sorted, time, transpose);
        if (!tones) continue;
        const upper = tones.midis.slice(1);
        let midis: number[];
        if (step.kind === 'pluck') {
          // Vary the solo's turn so it walks bar to bar instead of looping.
          const degree = step.degree === -1 ? -1 : ((step.degree ?? 0) + (guitar === 'gtr-solo' ? solowalk : 0)) % upper.length;
          midis = [degree === -1 ? tones.bass : upper[degree] + 12 * (step.octave ?? 0)];
        } else midis = tones.midis;
        events.push({
          id: `g-${bar.start.toFixed(3)}-${step.beat}`,
          at: warp(time), kind: step.kind, midis,
          sustain: step.sustain ?? Math.max(0.35, beatLen * (step.kind === 'pluck' ? 1.6 : 1.9)),
          level: step.level,
        });
      }
      if (guitar === 'gtr-solo') solowalk = (solowalk + 1) % 3;
    }
    if (drums !== 'off') {
      for (const step of DRUM_PATTERNS[drums]) {
        if (step.beat >= bar.beatCount - 0.01) continue;
        const time = bar.start + step.beat * beatLen;
        if (time >= until) continue;
        events.push({ id: `d-${bar.start.toFixed(3)}-${step.beat}-${step.kind}`, at: warp(time), kind: step.kind, level: step.level });
      }
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

export function playBandEvent(context: AudioContext, event: BandEvent, when: number): void {
  switch (event.kind) {
    case 'strum-down': playStrum(context, event.midis ?? [], when, 'down', event.sustain ?? 1, event.level ?? 0.045); break;
    case 'strum-up': playStrum(context, event.midis ?? [], when, 'up', event.sustain ?? 0.8, event.level ?? 0.04); break;
    case 'pluck': (event.midis ?? []).forEach(midi => playPluck(context, midi, when, event.sustain ?? 0.9, event.level ?? 0.05)); break;
    case 'kick': playKick(context, when, event.level ?? 0.16); break;
    case 'snare': playSnare(context, when, event.level ?? 0.09); break;
    case 'hat': playHat(context, when, event.level ?? 0.035); break;
    case 'cajon-bass': playCajonBass(context, when, event.level ?? 0.13); break;
    case 'cajon-slap': playCajonSlap(context, when, event.level ?? 0.07); break;
    case 'cajon-tick': playCajonTick(context, when, event.level ?? 0.025); break;
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
