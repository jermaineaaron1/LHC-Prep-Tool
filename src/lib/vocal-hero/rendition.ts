'use client';

// The rendition layer: a choir presentation is not a pile of notes, it is a
// SHAPE — the same verse sung three ways, a key lift for the last one, a
// breath between sections. The builder edits that shape as cards; this file
// compiles the cards back into the flat notes the game engine already plays,
// so the engine does not change at all.

import type { SongNote, TimedLyricSection } from './types';

export interface RenditionSection {
  id: string;
  name: string;
  /** Words shown on the card so the user picks by lyric, not by seconds. */
  words: string;
  start: number;
  end: number;
}

export interface RenditionCard {
  id: string;
  sectionId: string;
  /** 'satb' keeps the written voices (filtered by `voices`); 'unison' puts
   *  every singer on the melody — the engine's own part -1 concept. */
  mode: 'satb' | 'unison';
  /** Which written voices sing, S A T B. Ignored in unison mode. */
  voices: [boolean, boolean, boolean, boolean];
  /** Semitones up or down — the classic last-verse lift is +1 or +2. */
  transpose: number;
  /** 1 = as written, 0.9 = broader, 1.1 = brighter. */
  tempoFactor: number;
  dynamics: 'soft' | 'medium' | 'full';
}

/** One pass as it landed in compiled time — the strip and the score share it. */
export interface CompiledPass {
  cardId: string;
  index: number;
  start: number;
  end: number;
  /** The stretched bar length inside this pass, seconds. */
  barLength: number;
}

export interface CompiledRendition {
  notes: SongNote[];
  timedLyrics: TimedLyricSection[];
  duration: number;
  passes: CompiledPass[];
  /** The bar grid the compilation was laid on — every pass starts exactly on
   *  one of these barlines, so the engraving never has to split a chord over
   *  a misplaced boundary. */
  bars: Array<{ start: number; end: number; beatCount: number; numerator: number; denominator: number; number: number }>;
  /** Tempo map for the editor: base tempo at 0 plus a change wherever a pass
   *  runs broader or brighter than written. */
  tempoEvents: Array<{ at: number; bpm: number }>;
}

const DYNAMIC_VELOCITY = { soft: 64, medium: 88, full: 108 } as const;

/** Sections a song naturally offers: the whole verse, plus each lyric line. */
export function deriveSections(notes: SongNote[], lyrics: TimedLyricSection[]): RenditionSection[] {
  if (!notes.length) return [];
  const first = Math.min(...notes.map(note => note.start));
  const last = Math.max(...notes.map(note => note.end));
  const sections: RenditionSection[] = [{
    id: 'whole', name: 'Whole verse',
    words: lyrics.map(line => line.primary).join(' ').slice(0, 80) || 'the full song',
    start: first, end: last,
  }];
  lyrics.forEach((line, index) => {
    const next = lyrics[index + 1];
    sections.push({
      id: `line-${index}`, name: `Line ${index + 1}`,
      words: line.primary,
      start: index === 0 ? first : line.start,
      // A line owns the time up to the next line's entry, so held phrase-end
      // notes are not cut off at the lyric row's printed end.
      end: next ? next.start : last,
    });
  });
  return sections;
}

export function defaultCard(sectionId = 'whole'): RenditionCard {
  return { id: `card-${crypto.randomUUID()}`, sectionId, mode: 'satb', voices: [true, true, true, true], transpose: 0, tempoFactor: 1, dynamics: 'medium' };
}

/**
 * Cards -> a flat, playable song. Each card copies its section's notes with
 * the card's key, tempo and dynamics applied, laid end to end. Unison cards
 * emit the melody as part -1, which every lane in the game already knows how
 * to sing.
 *
 * Everything is BAR-ALIGNED: each section is treated as the whole bars it
 * occupies, the lead-in and the breath between passes are whole bars, and a
 * broader or brighter pass simply has longer or shorter bars of its own.
 * A fixed 0.8-second breath used to sit between passes, which pushed every
 * later pass off the bar grid — the score then split every held chord over
 * a barline into tied pairs, and the page read as duplicated clutter.
 */
export function compileRendition(
  sourceNotes: SongNote[],
  sourceLyrics: TimedLyricSection[],
  sections: RenditionSection[],
  cards: RenditionCard[],
  options: { bpm?: number; beatsPerBar?: number; leadBars?: number; breathBars?: number } = {},
): CompiledRendition {
  const bpm = Math.max(20, options.bpm ?? 90);
  const beatsPerBar = Math.max(1, Math.round(options.beatsPerBar ?? 4));
  const leadBars = Math.max(0, Math.round(options.leadBars ?? 2));
  const breathBars = Math.max(0, Math.round(options.breathBars ?? 1));
  const beat = 60 / bpm;
  const barLen = beat * beatsPerBar;
  const byId = new Map(sections.map(section => [section.id, section]));
  const round = (value: number) => Math.round(value * 1000) / 1000;

  const notes: SongNote[] = [];
  const lyrics: TimedLyricSection[] = [];
  const passes: CompiledPass[] = [];
  const bars: CompiledRendition['bars'] = [];
  const tempoEvents: CompiledRendition['tempoEvents'] = [{ at: 0, bpm: Math.round(bpm) }];
  const pushBars = (from: number, count: number, length: number) => {
    for (let index = 0; index < count; index++) bars.push({
      start: round(from + index * length), end: round(from + (index + 1) * length),
      beatCount: beatsPerBar, numerator: beatsPerBar, denominator: 4, number: bars.length,
    });
  };

  const live = cards.map(card => ({ card, section: byId.get(card.sectionId) })).filter((item): item is { card: RenditionCard; section: RenditionSection } => Boolean(item.section));
  let cursor = 0;
  if (live.length && leadBars) {
    // The count-in breathes at the first pass's tempo, so the pickup feels right.
    const firstBpm = Math.round(bpm * Math.max(0.5, Math.min(2, live[0].card.tempoFactor)) * 10000) / 10000;
    const firstStretch = bpm / firstBpm;
    pushBars(0, leadBars, barLen * firstStretch);
    cursor = leadBars * barLen * firstStretch;
  }
  live.forEach(({ card, section }, order) => {
    const cardIndex = cards.indexOf(card);
    const speed = Math.max(0.5, Math.min(2, card.tempoFactor));
    // The pass's bpm is the single source of truth for its grid: the bar
    // length, the note placement AND the tempo map all derive from the same
    // rounded figure. Rounding the bpm independently of the bars (92 × 0.85
    // announced as 78 while the bars ran at 78.2) drifted 4 ms per bar and
    // split every held note a dozen bars in.
    const passBpm = Math.round(bpm * speed * 10000) / 10000;
    const stretch = bpm / passBpm;
    const passBarLen = barLen * stretch;
    // The pass owns the whole bars its section occupies — a phrase that ends
    // mid-bar keeps its bar of air, so the next pass still starts on a barline.
    const windowStart = Math.floor(section.start / barLen + 1e-6) * barLen;
    const barCount = Math.max(1, Math.ceil((section.end - windowStart) / barLen - 1e-6));
    // The first pass's tempo owns time zero, so the count-in bars agree with
    // the grid; later passes change tempo exactly on their opening barline.
    if (order === 0) tempoEvents[0] = { at: 0, bpm: passBpm };
    else if (tempoEvents.at(-1)!.bpm !== passBpm) tempoEvents.push({ at: round(cursor), bpm: passBpm });
    pushBars(cursor, barCount, passBarLen);
    const passStart = cursor;
    const melodyOnly = card.mode === 'unison';
    const inRange = sourceNotes.filter(note => note.start >= section.start - .001 && note.start < section.end - .001);
    for (const note of inRange) {
      const isMelody = note.part === 0 || note.part === -1;
      if (melodyOnly && !isMelody) continue;
      if (!melodyOnly && note.part >= 0 && !card.voices[note.part]) continue;
      const start = cursor + (note.start - windowStart) * stretch;
      const end = cursor + (Math.min(note.end, section.end) - windowStart) * stretch;
      notes.push({
        ...note,
        id: `rend-${cardIndex}-${order}-${note.id}`,
        part: melodyOnly ? -1 : note.part,
        midi: note.midi + card.transpose,
        start: round(start), end: round(Math.max(end, start + .05)),
        velocity: DYNAMIC_VELOCITY[card.dynamics],
      });
    }
    for (const line of sourceLyrics) {
      if (line.start >= section.end - .001 || line.end <= section.start + .001) continue;
      const start = cursor + (Math.max(line.start, windowStart) - windowStart) * stretch;
      const end = cursor + (Math.min(line.end, section.end) - windowStart) * stretch;
      lyrics.push({ ...line, start: round(start), end: round(end) });
    }
    cursor += barCount * passBarLen;
    passes.push({ cardId: card.id, index: order, start: round(passStart), end: round(cursor), barLength: round(passBarLen) });
    if (order < live.length - 1 && breathBars) {
      pushBars(cursor, breathBars, passBarLen);
      cursor += breathBars * passBarLen;
    }
  });
  notes.sort((a, b) => a.start - b.start || a.part - b.part);
  const duration = Math.ceil((notes.length ? Math.max(...notes.map(note => note.end)) : cursor) + 1);
  return { notes, timedLyrics: lyrics, duration, passes, bars, tempoEvents };
}

/** A one-line description of a card, for the notice after applying. */
export function describeCard(card: RenditionCard, section: RenditionSection | undefined): string {
  const voiceNames = ['S', 'A', 'T', 'B'];
  const who = card.mode === 'unison' ? 'unison' : card.voices.every(Boolean) ? 'SATB' : card.voices.map((on, i) => on ? voiceNames[i] : '').filter(Boolean).join('') || 'no voices';
  const key = card.transpose ? ` ${card.transpose > 0 ? '+' : ''}${card.transpose}` : '';
  const tempo = card.tempoFactor !== 1 ? ` ${Math.round(card.tempoFactor * 100)}%` : '';
  return `${section?.name ?? '?'} · ${who}${key}${tempo} · ${card.dynamics}`;
}
