'use client';

// How the expression marks PLAY, kept pure so a machine can check it: the
// engraving says what the page means, this says what the performance does.
//
// - Hairpins ramp loudness note by note from the span's first velocity to its
//   target (the end note's own dynamic when it has one, otherwise a musical
//   guess of louder/softer).
// - A slur plays legato: every note under the arc except the last reaches the
//   next note's start with no articulation gap.
// - A fermata holds TIME ITSELF: the held note sustains longer and everything
//   after it — in every voice — arrives later. Holds at the same moment in
//   different voices are one hold, the way a choir breathes together.

import type { SongNote } from './types';

export interface PerformanceHold { at: number; extra: number }

export interface MarkPerformance {
  /** Effective velocity per note id, where a hairpin overrides the stored one. */
  velocity: Map<string, number>;
  /** Notes played connected to their successor (under a slur, except its last). */
  legato: Set<string>;
  /** The next same-voice note start, for legato lengths. */
  nextStart: Map<string, number>;
  /** Fermata holds, in score-time order. */
  holds: PerformanceHold[];
}

export function interpretMarks(all: SongNote[]): MarkPerformance {
  const velocity = new Map<string, number>();
  const legato = new Set<string>();
  const nextStart = new Map<string, number>();
  const byPart = new Map<number, SongNote[]>();
  for (const note of all) {
    const list = byPart.get(note.part) ?? [];
    list.push(note);
    byPart.set(note.part, list);
  }
  for (const list of byPart.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 0; i + 1 < list.length; i++) nextStart.set(list[i].id, list[i + 1].start);

    let pin: { index: number; kind: 'cresc' | 'decresc' } | null = null;
    let inSlur = false;
    list.forEach((note, index) => {
      if (note.marks?.hairpin === 'cresc' || note.marks?.hairpin === 'decresc') pin = { index, kind: note.marks.hairpin };
      else if (note.marks?.hairpin === 'end' && pin) {
        const from = list[pin.index];
        const target = note.marks?.dynamic
          ? note.velocity
          : Math.max(30, Math.min(120, Math.round(from.velocity * (pin.kind === 'cresc' ? 1.6 : 0.55))));
        const spanStart = from.start, spanEnd = note.start;
        for (let i = pin.index; i <= index; i++) {
          const t = spanEnd > spanStart ? (list[i].start - spanStart) / (spanEnd - spanStart) : 1;
          velocity.set(list[i].id, Math.round(from.velocity + (target - from.velocity) * Math.max(0, Math.min(1, t))));
        }
        pin = null;
      }
      if (note.marks?.slur === 'start') inSlur = true;
      if (inSlur && note.marks?.slur !== 'end' && index < list.length - 1) legato.add(note.id);
      if (note.marks?.slur === 'end') inSlur = false;
    });
  }

  const holds: PerformanceHold[] = [];
  for (const note of all) {
    if (!note.marks?.fermata) continue;
    const extra = Math.max(0.45, Math.min(2.5, (note.end - note.start) * 0.9));
    const shared = holds.find(hold => Math.abs(hold.at - note.end) < 0.12);
    if (shared) { shared.extra = Math.max(shared.extra, extra); shared.at = Math.max(shared.at, note.end); }
    else holds.push({ at: note.end, extra });
  }
  holds.sort((a, b) => a.at - b.at);
  return { velocity, legato, nextStart, holds };
}

/** Score time -> performance time: everything after a hold arrives later. */
export function warpTime(holds: PerformanceHold[], time: number): number {
  return holds.reduce((total, hold) => total + (time > hold.at + 0.001 ? hold.extra : 0), time);
}

/** Bake the fermata holds into the notes themselves, for surfaces that run
 *  on the literal clock (game rounds, practice): the held note becomes
 *  longer, notes spanning the moment sustain through it, and everything
 *  after arrives later — so lanes, scoring windows, live lyrics and the
 *  review all honour the pause with no clock arithmetic anywhere. */
export function applyFermataHolds(notes: SongNote[]): SongNote[] {
  const { holds } = interpretMarks(notes);
  if (!holds.length) return notes;
  const ms = (value: number) => Math.round(value * 1000) / 1000;
  return notes.map(note => {
    let shift = 0, extend = 0;
    for (const hold of holds) {
      if (note.start >= hold.at - 0.001) shift += hold.extra;   // starting AT the pause means waiting through it
      else if (Math.abs(note.end - hold.at) < 0.12 || (note.start < hold.at - 0.001 && note.end > hold.at + 0.001)) extend += hold.extra;
    }
    if (!shift && !extend) return note;
    return { ...note, start: ms(note.start + shift), end: ms(note.end + shift + extend) };
  });
}

/** Performance time -> score time. During a hold the score stands still at
 *  the held moment — which is exactly what the playback cursor should do. */
export function unwarpTime(holds: PerformanceHold[], performance: number): number {
  let offset = 0;
  for (const hold of holds) {
    const holdBegins = hold.at + offset;
    if (performance <= holdBegins) break;
    if (performance <= holdBegins + hold.extra) return hold.at;
    offset += hold.extra;
  }
  return performance - offset;
}
