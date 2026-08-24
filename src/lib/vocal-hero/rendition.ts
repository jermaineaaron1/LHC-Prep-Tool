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

export interface CompiledRendition {
  notes: SongNote[];
  timedLyrics: TimedLyricSection[];
  duration: number;
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
 * the card's key, tempo and dynamics applied, laid end to end with a breath
 * between sections. Unison cards emit the melody as part -1, which every
 * lane in the game already knows how to sing.
 */
export function compileRendition(
  sourceNotes: SongNote[],
  sourceLyrics: TimedLyricSection[],
  sections: RenditionSection[],
  cards: RenditionCard[],
  options: { lead?: number; breath?: number } = {},
): CompiledRendition {
  const lead = options.lead ?? 2;
  const breath = options.breath ?? 0.8;
  const byId = new Map(sections.map(section => [section.id, section]));
  const round = (value: number) => Math.round(value * 1000) / 1000;

  const notes: SongNote[] = [];
  const lyrics: TimedLyricSection[] = [];
  let cursor = lead;
  cards.forEach((card, cardIndex) => {
    const section = byId.get(card.sectionId);
    if (!section) return;
    const speed = Math.max(0.5, Math.min(2, card.tempoFactor));
    const stretch = 1 / speed;
    const melodyOnly = card.mode === 'unison';
    const inRange = sourceNotes.filter(note => note.start >= section.start - .001 && note.start < section.end - .001);
    for (const note of inRange) {
      const isMelody = note.part === 0 || note.part === -1;
      if (melodyOnly && !isMelody) continue;
      if (!melodyOnly && note.part >= 0 && !card.voices[note.part]) continue;
      const start = cursor + (note.start - section.start) * stretch;
      const end = cursor + (Math.min(note.end, section.end) - section.start) * stretch;
      notes.push({
        ...note,
        id: `rend-${cardIndex}-${note.id}`,
        part: melodyOnly ? -1 : note.part,
        midi: note.midi + card.transpose,
        start: round(start), end: round(Math.max(end, start + .05)),
        velocity: DYNAMIC_VELOCITY[card.dynamics],
      });
    }
    for (const line of sourceLyrics) {
      if (line.start >= section.end - .001 || line.end <= section.start + .001) continue;
      const start = cursor + (Math.max(line.start, section.start) - section.start) * stretch;
      const end = cursor + (Math.min(line.end, section.end) - section.start) * stretch;
      lyrics.push({ ...line, start: round(start), end: round(end) });
    }
    cursor += (section.end - section.start) * stretch + breath;
  });
  notes.sort((a, b) => a.start - b.start || a.part - b.part);
  const duration = Math.ceil((notes.length ? Math.max(...notes.map(note => note.end)) : lead) + 1);
  return { notes, timedLyrics: lyrics, duration };
}

/** A one-line description of a card, for the notice after applying. */
export function describeCard(card: RenditionCard, section: RenditionSection | undefined): string {
  const voiceNames = ['S', 'A', 'T', 'B'];
  const who = card.mode === 'unison' ? 'unison' : card.voices.every(Boolean) ? 'SATB' : card.voices.map((on, i) => on ? voiceNames[i] : '').filter(Boolean).join('') || 'no voices';
  const key = card.transpose ? ` ${card.transpose > 0 ? '+' : ''}${card.transpose}` : '';
  const tempo = card.tempoFactor !== 1 ? ` ${Math.round(card.tempoFactor * 100)}%` : '';
  return `${section?.name ?? '?'} · ${who}${key}${tempo} · ${card.dynamics}`;
}
