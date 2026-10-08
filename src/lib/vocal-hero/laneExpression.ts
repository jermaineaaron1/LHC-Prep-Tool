import type { DynamicMark, SongNote } from './types';

// What the lane needs in order to DRAW the music, as opposed to play it.
//
// performMarks.ts already says what the marks do to a performance: how loud,
// how long, how connected. None of that is shape on a screen. A slur has to
// become an arc between two x positions, a rest long enough to breathe in has
// to become something the singer sees coming, and a dynamic has to become a
// thickness. That is this file.
//
// It sits out here rather than inside the renderer for the same reason
// laneGeometry does: so both can be checked without a canvas, and so the lane
// and anything else that draws notes cannot drift apart.

/** A slur arc, as indices into the lane's own note list. */
export interface SlurSpan { from: number; to: number }

/** A gap long enough to breathe in. */
export interface BreathPoint { at: number; length: number }

/** One sample of what was sung, already converted to a pitch. */
export interface SungSample { t: number; midi: number }

/**
 * The shortest rest a singer would actually breathe in.
 *
 * Below this a gap is articulation — the space around a staccato note, the
 * join between two syllables — and marking it would litter the lane with
 * breaths nobody takes.
 */
export const BREATH_MIN_GAP = 0.45;

/** How far off a note still counts as hitting it, in semitones. */
export const TUNE_TOLERANCE = 0.6;

/**
 * Slack for comparing against a threshold.
 *
 * Both thresholds here are crossed by values that arithmetic has already
 * touched, and binary floating point does not land on the round numbers the
 * arranger typed: a rest written as 0.45s comes out of `start - end` as
 * 0.44999999999999996, and a pitch 0.6 semitones sharp reads as
 * 0.6000000000000014. Without this, a mark sitting exactly on its threshold
 * falls on the wrong side of it, and the functions quietly disagree with the
 * documentation above them.
 */
const EPSILON = 1e-9;

/**
 * Pair slur starts with their ends, in time order.
 *
 * A mark that never closes, and a close with nothing open, are both dropped
 * rather than guessed at. An unclosed slur is the likelier of the two — it is
 * what deleting the last note of a phrase leaves behind — and guessing would
 * draw one arc from there to the end of the song.
 */
export function slurSpans(laneNotes: SongNote[]): SlurSpan[] {
  const spans: SlurSpan[] = [];
  let open = -1;
  laneNotes.forEach((note, index) => {
    // A second 'start' before the first has closed takes over. Nothing in the
    // editor can produce nested arcs, so the alternative is to draw an arc
    // whose beginning the arranger has already replaced.
    if (note.marks?.slur === 'start') { open = index; return; }
    if (note.marks?.slur === 'end' && open >= 0) { spans.push({ from: open, to: index }); open = -1; }
  });
  return spans;
}

/**
 * Where the line lets go long enough to breathe.
 *
 * Measured between consecutive notes of this lane only. Overlapping notes —
 * which divisi writing produces — give a negative gap and are simply not a
 * breath.
 */
export function breathPoints(laneNotes: SongNote[], minGap = BREATH_MIN_GAP): BreathPoint[] {
  const points: BreathPoint[] = [];
  for (let index = 1; index < laneNotes.length; index++) {
    const gap = laneNotes[index].start - laneNotes[index - 1].end;
    if (gap >= minGap - EPSILON) points.push({ at: laneNotes[index - 1].end + gap / 2, length: gap });
  }
  return points;
}

/**
 * The dynamics worth printing: the first one, and every later one that
 * changes. Printing `pp` under eight consecutive pp notes tells a singer
 * nothing they did not already know from the first.
 */
export function dynamicMarkers(laneNotes: SongNote[]): Map<string, DynamicMark> {
  const markers = new Map<string, DynamicMark>();
  let standing: DynamicMark | null = null;
  for (const note of laneNotes) {
    const mark = note.marks?.dynamic;
    if (!mark || mark === standing) continue;
    standing = mark;
    markers.set(note.id, mark);
  }
  return markers;
}

/**
 * How thick to draw a note, in pixels: loud is heavy, quiet is a thread.
 *
 * Never taller than the row it sits in. On a phone eighteen semitones can
 * share 117px — a row every 5.4px — and a bar that outgrows its row turns the
 * whole line into one smear of colour, which is the bug the old fixed 13px
 * ceiling was put there to stop. The floors keep a pp note visible at all.
 */
export function noteThickness(velocity: number, rowPx: number): number {
  const loud = Math.max(0, Math.min(1, (velocity - 36) / 84));
  const thin = Math.max(3, Math.min(11, rowPx * 0.5));
  const thick = Math.max(5, Math.min(18, rowPx * 0.95));
  return thin + (thick - thin) * loud;
}

/**
 * Octave-forgiving pitch match — the same courtesy the score engine extends,
 * and the rule the lane has always used to paint the green proof.
 */
export function inTune(midi: number, targetMidi: number, tolerance = TUNE_TOLERANCE): boolean {
  const raw = Math.abs(midi - targetMidi) % 12;
  return Math.min(raw, 12 - raw) <= tolerance + EPSILON;
}

/**
 * The share of a note that was actually sung in tune, 0–1.
 *
 * This is the lane's OWN verdict, for practice, where nothing is scoring the
 * round and so there is no `hitNotes` to read. In a scored round the engine's
 * verdict wins; this only ever decides how warmly to word it.
 *
 * Samples arrive only while a pitch is locked, so silence is absent rather
 * than zero — which is why this counts samples rather than measuring time.
 */
export function sungFraction(samples: SungSample[], start: number, end: number, targetMidi: number): number {
  let total = 0, good = 0;
  for (const sample of samples) {
    if (sample.t < start) continue;
    if (sample.t > end) break;
    total++;
    if (inTune(sample.midi, targetMidi)) good++;
  }
  return total ? good / total : 0;
}

/**
 * How far the voice sits from the written note, in cents, folded to the
 * nearest octave.
 *
 * Folding matches what the rest of the app already does: the green proof and
 * the score engine both forgive an octave, and an alto practising a soprano
 * line an octave down is in tune, not 1200 cents flat. Being in the wrong
 * octave is still worth saying, and the lane says it separately.
 */
export function centsFromTarget(midi: number, targetMidi: number): number {
  const semitones = midi - targetMidi;
  return Math.round((semitones - 12 * Math.round(semitones / 12)) * 100);
}
