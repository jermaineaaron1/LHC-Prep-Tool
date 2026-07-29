import type { Song, SongNote } from './types';

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export interface KaraokeCue {
  text: string;
  progress: number;
  currentLyric: string;
  nextText: string;
  waiting: boolean;
}

interface LyricEvent {
  lyric: string;
  start: number;
  end: number;
}

interface DisplayEvent extends LyricEvent {
  charStart: number;
  charEnd: number;
}

export function midiNoteName(midi: number) {
  const rounded = Math.round(midi);
  return `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

export function hzToMidi(hz: number) {
  return hz > 0 ? 69 + 12 * Math.log2(hz / 440) : 0;
}

export function livePitchFeedback(targetMidi: number | null, pitchHz: number) {
  const detectedMidi = hzToMidi(pitchHz);
  const detected = pitchHz > 0 ? midiNoteName(detectedMidi) : '—';
  const target = targetMidi === null ? '—' : midiNoteName(targetMidi);
  if (targetMidi === null) return { target, detected, cents: null, state: 'waiting' as const, label: 'WAIT FOR YOUR NOTE', instruction: 'Listen for the next entrance' };
  if (pitchHz <= 0) return { target, detected, cents: null, state: 'silent' as const, label: `SING ${target}`, instruction: 'Your note is at the strike line' };
  const cents = Math.round(1200 * Math.log2(pitchHz / (440 * 2 ** ((targetMidi - 69) / 12))));
  if (Math.abs(cents) <= 50) return { target, detected, cents, state: 'correct' as const, label: 'ON PITCH', instruction: `Hold ${target}` };
  if (cents < 0) return { target, detected, cents, state: 'low' as const, label: 'TOO LOW', instruction: `Sing higher toward ${target} ↑` };
  return { target, detected, cents, state: 'high' as const, label: 'TOO HIGH', instruction: `Sing lower toward ${target} ↓` };
}

export function karaokeCue(song: Song, notes: SongNote[], partIndex: number, elapsed: number): KaraokeCue {
  const timedLyrics = [...(song.timed_lyrics ?? [])]
    .filter(section => section.primary?.trim())
    .sort((a, b) => a.start - b.start);
  const authoredPhrases = phraseLikeTimedLyrics(timedLyrics) ? timedLyrics : legacyPhrases(song);
  if (authoredPhrases.length) return timedPhraseCue(authoredPhrases, elapsed);

  // Pick one granular lyric source for the whole performance. Never switch
  // sources after refresh or after the final timed entry has elapsed.
  const timedEvents = !phraseLikeTimedLyrics(timedLyrics)
    ? timedLyrics.map(section => ({ lyric: section.primary.trim(), start: section.start, end: section.end }))
    : [];
  const voiceEvents = lyricEvents(notes.filter(note => note.part === partIndex || note.part === -1));
  const legacyEvents = (song.game_notes ?? []).filter(note => note.l?.trim()).map(note => ({ lyric: note.l!.trim(), start: note.start, end: note.start + note.dur }));
  const allEvents = mergeEvents([...lyricEvents(notes), ...legacyEvents]);
  const noteEvents = voiceEvents.length >= allEvents.length - 2 ? voiceEvents : allEvents;
  const events = timedEvents.length ? mergeEvents(timedEvents) : noteEvents;
  if (!events.length) return { text: 'Instrumental — listen for your entrance', progress: 0, currentLyric: '', nextText: '', waiting: true };
  const phraseSize = clampInteger(song.backing_track_settings?.karaoke_lyrics?.targets_per_phrase, 4, 20, 10);
  const phrases = phraseEvents(events, phraseSize);
  let phraseIndex = phrases.findIndex(phrase => elapsed >= phrase[0].start - .35 && elapsed <= phrase[phrase.length - 1].end + .8);
  if (phraseIndex < 0) phraseIndex = phrases.findIndex(phrase => phrase[0].start > elapsed);
  if (phraseIndex < 0) phraseIndex = phrases.length - 1;
  const phrase = phrases[phraseIndex] ?? phrases.find(candidate => candidate[0].start > elapsed) ?? phrases[phrases.length - 1];
  const display = displayPhrase(phrase);
  let highlightedChars = 0;
  let currentLyric = '';
  for (const event of display.events) {
    if (elapsed >= event.end) highlightedChars = event.charEnd;
    else if (elapsed >= event.start) {
      const fraction = clamp((elapsed - event.start) / Math.max(.04, event.end - event.start));
      highlightedChars = event.charStart + (event.charEnd - event.charStart) * fraction;
      currentLyric = event.lyric;
      break;
    } else break;
  }
  return {
    text: display.text,
    progress: display.text.length ? clamp(highlightedChars / display.text.length) : 0,
    currentLyric,
    nextText: phrases[phraseIndex + 1] ? displayPhrase(phrases[phraseIndex + 1]).text : '',
    waiting: elapsed < phrase[0].start,
  };
}

function phraseLikeTimedLyrics(sections: Array<{ primary: string }>) {
  if (!sections.length) return false;
  const phraseCount = sections.filter(section => section.primary.trim().split(/\s+/).length >= 3).length;
  return phraseCount >= Math.max(1, Math.ceil(sections.length * .6));
}

function timedPhraseCue(timed: Array<{ primary: string; start: number; end: number }>, elapsed: number): KaraokeCue {
  let index = timed.findIndex(section => elapsed >= section.start && elapsed < section.end);
  if (index < 0) index = timed.findIndex(section => section.start > elapsed);
  if (index < 0) index = timed.length - 1;
  const active = timed[Math.max(0, index)];
  const duration = Math.max(.01, active.end - active.start);
  return {
    text: active.primary.trim(),
    progress: clamp((elapsed - active.start) / duration),
    currentLyric: active.primary.trim(),
    nextText: timed[index + 1]?.primary?.trim() ?? '',
    waiting: elapsed < active.start,
  };
}

function lyricEvents(notes: SongNote[]): LyricEvent[] {
  const result: LyricEvent[] = [];
  for (const note of [...notes].filter(note => note.lyric?.trim()).sort((a, b) => a.start - b.start || a.part - b.part)) {
    const lyric = note.lyric.trim();
    const existing = result.find(event => Math.abs(event.start - note.start) <= .07);
    if (existing) {
      existing.end = Math.max(existing.end, note.end);
      if (lyric.length > existing.lyric.length) existing.lyric = lyric;
    } else result.push({ lyric, start: note.start, end: note.end });
  }
  return result;
}

function mergeEvents(events: LyricEvent[]) {
  const result: LyricEvent[] = [];
  for (const event of [...events].sort((a, b) => a.start - b.start)) {
    const existing = result.find(candidate => Math.abs(candidate.start - event.start) <= .07);
    if (existing) {
      existing.end = Math.max(existing.end, event.end);
      if (event.lyric.length > existing.lyric.length) existing.lyric = event.lyric;
    } else result.push({ ...event });
  }
  return result;
}

function legacyPhrases(song: Song) {
  const phrases: Array<{ primary: string; translation: string; start: number; end: number }> = [];
  for (const note of [...(song.game_notes ?? [])].filter(note => note.phrase?.trim()).sort((a, b) => a.start - b.start)) {
    const text = note.phrase!.trim();
    const previous = phrases[phrases.length - 1];
    if (previous && previous.primary === text && note.start <= previous.end + 1.5) previous.end = Math.max(previous.end, note.start + note.dur);
    else phrases.push({ primary: text, translation: '', start: note.start, end: note.start + note.dur });
  }
  return phrases;
}

function phraseEvents(events: LyricEvent[], maxTargets: number) {
  const phrases: LyricEvent[][] = [];
  let phrase: LyricEvent[] = [];
  for (const event of events) {
    const previous = phrase[phrase.length - 1];
    const reachedTargetLimit = previous && phrase.length >= maxTargets && !/[-\u2013\u2014]$/.test(previous.lyric);
    if (previous && (event.start - previous.end > 1.15 || /[.!?;:]$/.test(previous.lyric) || reachedTargetLimit)) {
      phrases.push(phrase);
      phrase = [];
    }
    phrase.push(event);
  }
  if (phrase.length) phrases.push(phrase);
  return phrases;
}

function displayPhrase(events: LyricEvent[]) {
  let text = '';
  let joinNext = false;
  const displayEvents: DisplayEvent[] = [];
  for (const event of events) {
    const rawLyric = event.lyric.trim();
    const joinsPrevious = joinNext || /^[-\u2013\u2014]/.test(rawLyric);
    if (!joinsPrevious && text) text += ' ';
    const charStart = text.length;
    const lyric = rawLyric.replace(/^[-\u2013\u2014]+|[-\u2013\u2014]+$/g, '');
    text += lyric;
    displayEvents.push({ ...event, lyric, charStart, charEnd: text.length });
    joinNext = /[-\u2013\u2014]$/.test(rawLyric);
  }
  return { text, events: displayEvents };
}

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }
function clampInteger(value: number | undefined, min: number, max: number, fallback: number) {
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value! : fallback)));
}
