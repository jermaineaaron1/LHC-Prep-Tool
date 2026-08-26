'use client';

// The groove brain: read the harmony OUT of the singing, then dictate an
// arrangement over it. Two pure pieces:
//
// - inferChords: each bar's sounding pitch classes, duration-weighted, are
//   scored against candidate triads and sevenths; the bass note votes for
//   its root. What the four voices already spell becomes the chord symbols
//   a guitarist would write.
// - planGroove: a vibe template turned into concrete dictation — band
//   instructions at section boundaries, singer dynamics that build, and a
//   fermata on the final note. Everything it returns is ordinary marks and
//   chords, so applying it is one undoable edit.

import type { NoteMarks, SongNote, DynamicMark } from './types';
import type { BandBar, ChordAt } from './accompaniment';

const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

interface Candidate { quality: string; tones: number[]; weight: number }
const CANDIDATES: Candidate[] = [
  { quality: '', tones: [0, 4, 7], weight: 1 },
  { quality: 'm', tones: [0, 3, 7], weight: 1 },
  { quality: '7', tones: [0, 4, 7, 10], weight: 0.92 },
  { quality: 'm7', tones: [0, 3, 7, 10], weight: 0.92 },
  { quality: 'maj7', tones: [0, 4, 7, 11], weight: 0.88 },
  { quality: 'dim', tones: [0, 3, 6], weight: 0.8 },
  { quality: 'sus4', tones: [0, 5, 7], weight: 0.75 },
];

/** Read the chord out of each bar's sounding notes. Emits a symbol only
 *  where the harmony CHANGES, the way a lead sheet is written. */
export function inferChords(notes: SongNote[], bars: BandBar[], useFlats: boolean): ChordAt[] {
  const chords: ChordAt[] = [];
  let previous = '';
  for (const bar of bars) {
    const sounding = notes.filter(note => note.start < bar.end - 0.02 && note.end > bar.start + 0.02);
    if (!sounding.length) continue;
    // duration-weighted pitch-class histogram inside the bar
    const weight = new Array(12).fill(0);
    let bassMidi = Infinity;
    for (const note of sounding) {
      const overlap = Math.min(note.end, bar.end) - Math.max(note.start, bar.start);
      weight[((note.midi % 12) + 12) % 12] += overlap;
      if (note.midi < bassMidi && note.start < bar.start + (bar.end - bar.start) / 2) bassMidi = note.midi;
    }
    const total = weight.reduce((sum, value) => sum + value, 0);
    if (total <= 0) continue;
    const bassPc = bassMidi === Infinity ? -1 : ((bassMidi % 12) + 12) % 12;
    let best = { score: -1, symbol: '' };
    for (let root = 0; root < 12; root++) {
      for (const candidate of CANDIDATES) {
        const tones = candidate.tones.map(tone => (root + tone) % 12);
        const covered = tones.reduce((sum, pc) => sum + weight[pc], 0);
        const outside = total - covered;
        let score = (covered - outside * 0.9) / total * candidate.weight;
        if (root === bassPc) score += 0.22;               // the bass votes for its root
        else if (tones.includes(bassPc)) score += 0.06;   // an inversion is plausible
        if (score > best.score) {
          const name = (useFlats ? NAMES_FLAT : NAMES_SHARP)[root] + candidate.quality;
          best = { score, symbol: name };
        }
      }
    }
    if (best.symbol && best.symbol !== previous) {
      chords.push({ at: Math.round(bar.start * 1000) / 1000, symbol: best.symbol });
      previous = best.symbol;
    }
  }
  return chords;
}

export interface GrooveVibe {
  id: string;
  label: string;
  intro: { instrument: string; drums: string };
  main: { instrument: string; drums: string };
  final: { instrument: string; drums: string };
  dynamics: [DynamicMark, DynamicMark, DynamicMark];
}

export const GROOVE_VIBES: GrooveVibe[] = [
  { id: 'rock', label: 'Rock', intro: { instrument: 'bass-walk', drums: 'off' }, main: { instrument: 'gtr-8ths', drums: 'drum-kit' }, final: { instrument: 'gtr-8ths', drums: 'drum-drive' }, dynamics: ['mp', 'mf', 'f'] },
  { id: 'acoustic', label: 'Acoustic', intro: { instrument: 'gtr-arp', drums: 'off' }, main: { instrument: 'gtr-folk', drums: 'cajon-groove' }, final: { instrument: 'gtr-8ths', drums: 'cajon-groove' }, dynamics: ['p', 'mp', 'mf'] },
  { id: 'gospel', label: 'Gospel', intro: { instrument: 'pno-chords', drums: 'off' }, main: { instrument: 'pno-arp', drums: 'cajon-groove' }, final: { instrument: 'pno-chords', drums: 'drum-kit' }, dynamics: ['mp', 'mf', 'ff'] },
  { id: 'ballad', label: 'Ballad', intro: { instrument: 'pno-arp', drums: 'off' }, main: { instrument: 'pno-chords', drums: 'cajon-sway' }, final: { instrument: 'gtr-arp', drums: 'cajon-groove' }, dynamics: ['pp', 'mp', 'mf'] },
];

export const DYNAMIC_VELOCITY: Record<DynamicMark, number> = { pp: 40, p: 55, mp: 70, mf: 85, f: 100, ff: 115 };

export interface GroovePlan {
  vibe: GrooveVibe;
  /** Chord symbols — only when the song had none. */
  chords: ChordAt[] | null;
  /** marks patches by note id (band instructions, dynamics, the fermata). */
  markPatches: Array<{ noteId: string; marks: Partial<NoteMarks>; velocity?: number }>;
  summary: string;
}

/** Dictate an arrangement: three sections (opening, main, finale), each with
 *  its band and its singer dynamic, and a fermata on the last note. */
export function planGroove(
  notes: SongNote[],
  bars: BandBar[],
  existingChords: ChordAt[],
  useFlats: boolean,
  vibe: GrooveVibe,
): GroovePlan | null {
  const melody = notes.filter(note => note.part === 0 || note.part === -1).sort((a, b) => a.start - b.start);
  if (!melody.length) return null;
  const first = melody[0].start;
  const last = Math.max(...notes.map(note => note.end));
  const span = last - first;
  const mainAt = first + span * 0.25;
  const finalAt = first + span * 0.7;
  const anchor = (time: number) => melody.find(note => note.start >= time - 0.01) ?? melody[melody.length - 1];
  const opening = anchor(first);
  const main = anchor(mainAt);
  const finale = anchor(finalAt);
  if (main.id === opening.id || finale.id === main.id) return null;   // too short to sectionize

  const markPatches: GroovePlan['markPatches'] = [];
  const stamp = (note: SongNote, section: { instrument: string; drums: string }, dynamic: DynamicMark) => {
    markPatches.push({ noteId: note.id, marks: { band: { instrument: section.instrument, drums: section.drums }, dynamic }, velocity: DYNAMIC_VELOCITY[dynamic] });
  };
  stamp(opening, vibe.intro, vibe.dynamics[0]);
  stamp(main, vibe.main, vibe.dynamics[1]);
  stamp(finale, vibe.final, vibe.dynamics[2]);
  const lastNote = melody[melody.length - 1];
  if (lastNote.id !== finale.id) markPatches.push({ noteId: lastNote.id, marks: { fermata: true } });

  const chords = existingChords.length ? null : inferChords(notes, bars.filter(bar => bar.end > first && bar.start < last), useFlats);
  const summary = `${vibe.label}: opens ${vibe.dynamics[0]} with ${describe(vibe.intro)}, builds ${vibe.dynamics[1]} into ${describe(vibe.main)}, finishes ${vibe.dynamics[2]} with ${describe(vibe.final)} and a held final note`
    + (chords ? `, over ${chords.length} chords read from the voices` : '');
  return { vibe, chords, markPatches, summary };
}

function describe(section: { instrument: string; drums: string }): string {
  const inst = section.instrument === 'off' ? 'voices alone' : section.instrument.replace('gtr-', 'guitar ').replace('pno-', 'piano ').replace('bass-walk', 'walking bass');
  return section.drums === 'off' ? inst : `${inst} and ${section.drums.replace('drum-', '').replace('cajon-', 'cajon ')}`;
}
