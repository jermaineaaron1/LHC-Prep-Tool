'use client';

// What a round is worth saying about it afterwards.
//
// Every note already produced a timing, pitch and hold figure while the song
// was playing, and all of it was discarded when the round ended: the singer
// got one number and no idea which part of the song produced it. This turns
// that stream into the few statements worth reading — the habit to correct,
// the phrase that fell apart, whether the problem was the notes or the
// entrances.

import type { NoteScoreResult } from './scoreEngine';
import type { SongNote } from './types';

export interface WeakSpot {
  noteId: string;
  lyric: string;
  startSec: number;
  points: number;
  /** The component most responsible, so the advice is specific. */
  worst: 'timing' | 'pitch' | 'hold' | 'missed';
}

export interface RoundReview {
  notes: number;
  found: number;
  points: number;
  maxPoints: number;
  /** 0–1 averages across the notes actually sung. */
  timing: number;
  pitch: number;
  hold: number;
  /** Median signed cents across notes with a reading: negative is flat. */
  centsBias: number;
  /** True when the bias is big enough and consistent enough to name. */
  biasWorthMentioning: boolean;
  octaveNotes: number;
  octaveShift: number;
  weakest: WeakSpot[];
  /** One sentence, the thing to work on next. */
  headline: string;
}

const NOTE_MAX_POINTS = 30;
/** Below this a singer will not perceive the bias, so saying it is noise. */
const BIAS_CENTS = 12;
/** Fewer readings than this and the "consistently" claim is not earned. */
const BIAS_MIN_NOTES = 4;

export function summariseRound(results: NoteScoreResult[], notes: SongNote[]): RoundReview {
  const byId = new Map(notes.map(note => [note.id, note]));
  const sung = results.filter(result => result.hold > 0 || result.pitch > 0);
  const points = results.reduce((total, result) => total + result.points, 0);

  const mean = (pick: (r: NoteScoreResult) => number) =>
    sung.length ? sung.reduce((total, r) => total + pick(r), 0) / sung.length : 0;

  // Only notes the singer actually found carry a meaningful direction; a note
  // they never sang has a bias of zero and would drag the median to nothing.
  const biases = sung.filter(result => result.centsBias !== 0).map(result => result.centsBias);
  const centsBias = median(biases);
  const sameSide = biases.filter(value => Math.sign(value) === Math.sign(centsBias)).length;

  const octave = sung.filter(result => result.octaveShift !== 0);

  const weakest: WeakSpot[] = [...results]
    .sort((a, b) => a.points - b.points)
    .slice(0, 3)
    .filter(result => result.points < NOTE_MAX_POINTS * 0.7)
    .map(result => {
      const note = byId.get(result.noteId);
      const missed = result.hold === 0 && result.pitch === 0;
      const worst: WeakSpot['worst'] = missed ? 'missed'
        : result.pitch <= result.hold && result.pitch <= result.onset ? 'pitch'
        : result.hold <= result.onset ? 'hold'
        : 'timing';
      return {
        noteId: result.noteId,
        lyric: note?.lyric?.trim() || '(no word)',
        startSec: note?.start ?? 0,
        points: result.points,
        worst,
      };
    });

  const review: RoundReview = {
    notes: results.length,
    found: sung.length,
    points,
    maxPoints: results.length * NOTE_MAX_POINTS,
    timing: mean(r => r.onset),
    pitch: mean(r => r.pitch),
    hold: mean(r => r.hold),
    centsBias,
    biasWorthMentioning: biases.length >= BIAS_MIN_NOTES
      && Math.abs(centsBias) >= BIAS_CENTS
      && sameSide >= biases.length * 0.7,
    octaveNotes: octave.length,
    octaveShift: octave.length ? octave[0].octaveShift : 0,
    weakest,
    headline: '',
  };
  review.headline = headlineFor(review);
  return review;
}

/**
 * The single most useful thing to say, chosen in the order a singer would want
 * to hear it: a wrong line first, then a habit, then whichever component of
 * the note is furthest behind.
 */
function headlineFor(review: RoundReview): string {
  if (!review.notes) return 'No notes were scored this round.';
  if (!review.found) return 'Nothing was picked up — check the microphone before the next round.';
  if (review.octaveNotes >= Math.max(2, review.found * 0.3)) {
    return review.octaveShift < 0
      ? 'You sang much of this an octave below the written line.'
      : 'You sang much of this an octave above the written line.';
  }
  if (review.biasWorthMentioning) {
    return review.centsBias < 0
      ? `You sit about ${Math.abs(Math.round(review.centsBias))} cents flat — aim a shade higher into each note.`
      : `You sit about ${Math.round(review.centsBias)} cents sharp — ease down slightly into each note.`;
  }
  if (review.found < review.notes * 0.7) return 'Several notes were missed entirely — the entrances are the thing to drill.';
  const worst = Math.min(review.timing, review.pitch, review.hold);
  if (worst === review.timing && review.timing < 0.7) return 'Your pitch is good; the entrances are arriving late.';
  if (worst === review.hold && review.hold < 0.7) return 'You find the notes but let them go early — hold to the end of each one.';
  if (worst === review.pitch && review.pitch < 0.7) return 'Entrances are solid; the tuning inside each note is what to work on.';
  return 'A clean round — nothing stands out as needing work.';
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** A stretch of the song worth going back to. */
export interface WeakPassage {
  start: number;
  end: number;
  /** Average points per note across the passage. */
  average: number;
  noteCount: number;
  /** The words there, so the offer names something the singer recognises. */
  words: string;
}

/**
 * The phrase that went worst.
 *
 * A round tells a singer their score; it does not tell them where to go back
 * to, and "sing it all again" is not practice. Grouping by the silences gives a
 * musical unit rather than an arbitrary few seconds, and the phrase with the
 * lowest average is the one worth twenty repetitions.
 *
 * Phrases of one note are ignored: a single fluffed entry is a moment, not a
 * passage, and looping it teaches nothing.
 */
export function weakestPassage(
  notes: SongNote[],
  results: NoteScoreResult[],
  partIndex: number,
  gap = 0.7,
): WeakPassage | null {
  const mine = notes
    .filter(note => note.part === partIndex || note.part === -1)
    .sort((a, b) => a.start - b.start);
  if (mine.length < 2) return null;

  const scoreById = new Map(results.map(result => [result.noteId, result.points]));
  // Only judge what was actually attempted: a round abandoned half way through
  // would otherwise always nominate the part nobody reached.
  const attempted = mine.filter(note => scoreById.has(note.id));
  if (attempted.length < 2) return null;

  const phrases: SongNote[][] = [[attempted[0]]];
  for (let i = 1; i < attempted.length; i++) {
    const previous = attempted[i - 1];
    if (attempted[i].start - previous.end >= gap) phrases.push([attempted[i]]);
    else phrases[phrases.length - 1].push(attempted[i]);
  }

  let worst: WeakPassage | null = null;
  for (const phrase of phrases) {
    if (phrase.length < 2) continue;
    const total = phrase.reduce((sum, note) => sum + (scoreById.get(note.id) ?? 0), 0);
    const average = total / phrase.length;
    if (worst && average >= worst.average) continue;
    worst = {
      start: phrase[0].start,
      end: phrase[phrase.length - 1].end,
      average,
      noteCount: phrase.length,
      words: phrase.map(note => note.lyric).filter(Boolean).join(' ').replace(/-\s/g, ''),
    };
  }
  return worst;
}
