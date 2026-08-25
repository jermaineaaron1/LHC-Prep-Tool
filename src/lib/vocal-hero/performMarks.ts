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

import type { SongNote, TempoMarkKind } from './types';

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

/** The tempo landscape the marks describe: piecewise-linear speed factors
 *  (1 = as written), one segment per region between tempo marks. rit ramps
 *  to 70% of the prevailing speed, accel to 130%, a tempo restores 1, and
 *  Allegro is a brisk constant 1.25 — and the music KEEPS a ramp's arrival
 *  speed until told otherwise, exactly as players would. */
export interface TempoSegment { from: number; to: number; f1: number; f2: number }

export function tempoSegments(notes: SongNote[], until: number): TempoSegment[] {
  const markers: Array<{ at: number; kind: TempoMarkKind }> = [];
  for (const note of notes) {
    if (!note.marks?.tempo) continue;
    if (markers.some(marker => Math.abs(marker.at - note.start) < 0.1)) continue;  // one mark per moment, whichever voice carries it
    markers.push({ at: note.start, kind: note.marks.tempo });
  }
  markers.sort((a, b) => a.at - b.at);
  if (!markers.length) return [];
  const segments: TempoSegment[] = [];
  let prevailing = 1;
  if (markers[0].at > 0.001) segments.push({ from: 0, to: markers[0].at, f1: 1, f2: 1 });
  markers.forEach((marker, index) => {
    const to = markers[index + 1]?.at ?? Math.max(until, marker.at + 0.001);
    let f1 = prevailing, f2 = prevailing;
    if (marker.kind === 'rit') { f1 = prevailing; f2 = Math.max(0.5, prevailing * 0.7); }
    else if (marker.kind === 'accel') { f1 = prevailing; f2 = Math.min(1.6, prevailing * 1.3); }
    else if (marker.kind === 'atempo') { f1 = 1; f2 = 1; }
    else if (marker.kind === 'allegro') { f1 = 1.25; f2 = 1.25; }
    segments.push({ from: marker.at, to, f1, f2 });
    prevailing = f2;
  });
  return segments;
}

/** Score time and performance time as one sampled, invertible table: tempo
 *  ramps integrate continuously, fermata holds insert their pauses, and both
 *  directions are a binary search away. Null when the marks change nothing —
 *  callers can skip all arithmetic. */
export interface WarpTable { score: number[]; perf: number[] }

export function buildWarpTable(notes: SongNote[], until: number): WarpTable | null {
  const { holds } = interpretMarks(notes);
  const segments = tempoSegments(notes, until);
  const flat = segments.every(segment => Math.abs(segment.f1 - 1) < 1e-6 && Math.abs(segment.f2 - 1) < 1e-6);
  if (!holds.length && (!segments.length || flat)) return null;
  const factorAt = (time: number) => {
    for (const segment of segments) {
      if (time >= segment.from - 1e-9 && time < segment.to) {
        const t = (time - segment.from) / Math.max(1e-9, segment.to - segment.from);
        return segment.f1 + (segment.f2 - segment.f1) * t;
      }
    }
    return segments.length && time >= segments[segments.length - 1].to ? segments[segments.length - 1].f2 : 1;
  };
  const score: number[] = [0];
  const perf: number[] = [0];
  const step = 0.05;
  let accumulated = 0;
  let holdIndex = 0;
  for (let time = step; time <= until + step; time += step) {
    const mid = time - step / 2;
    accumulated += step / Math.max(0.25, factorAt(mid));
    while (holdIndex < holds.length && holds[holdIndex].at <= time + 1e-9) {
      // land a point exactly at the hold, then jump: everything at or after
      // the pause arrives later, and the plateau inverts to a standing cursor
      const at = holds[holdIndex].at;
      const partial = accumulated - (time - at) / Math.max(0.25, factorAt(mid));
      score.push(at); perf.push(partial);
      score.push(at); perf.push(partial + holds[holdIndex].extra);
      accumulated += holds[holdIndex].extra;
      holdIndex += 1;
    }
    score.push(time); perf.push(accumulated);
  }
  return { score, perf };
}

const lookup = (from: number[], to: number[], value: number): number => {
  if (value <= from[0]) return to[0];
  let low = 0, high = from.length - 1;
  if (value >= from[high]) return to[high] + (value - from[high]);
  while (high - low > 1) { const mid = (low + high) >> 1; if (from[mid] <= value) low = mid; else high = mid; }
  const spanFrom = from[high] - from[low];
  if (spanFrom < 1e-9) return to[low];
  return to[low] + (to[high] - to[low]) * ((value - from[low]) / spanFrom);
};

/** Score time -> performance time through the table. */
export function tableWarp(table: WarpTable, time: number): number { return lookup(table.score, table.perf, time); }
/** Performance time -> score time; a fermata's plateau maps to its moment. */
export function tableUnwarp(table: WarpTable, performance: number): number { return lookup(table.perf, table.score, performance); }

/** Remap the notes into performance time, for surfaces that run on the
 *  literal clock (game rounds, practice): ritardando genuinely broadens the
 *  bars, accelerando tightens them, a fermata's note lasts through its
 *  pause, and every voice agrees because it is one table. */
export function applyPerformanceTiming(notes: SongNote[]): SongNote[] {
  const until = notes.length ? Math.max(...notes.map(note => note.end)) + 1 : 1;
  const table = buildWarpTable(notes, until);
  if (!table) return notes;
  const { holds } = interpretMarks(notes);
  const ms = (value: number) => Math.round(value * 1000) / 1000;
  return notes.map(note => {
    const start = tableWarp(table, note.start);
    let end = tableWarp(table, note.end);
    // The table's plateau already lands AFTER the pause at the hold's exact
    // moment; this only catches a note whose stored end sits a few ms shy of
    // it, so that note still sustains through the hold.
    const hold = holds.find(item => Math.abs(item.at - note.end) < 0.12);
    if (hold) end = tableWarp(table, hold.at);
    return { ...note, start: ms(start), end: ms(end) };
  });
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
