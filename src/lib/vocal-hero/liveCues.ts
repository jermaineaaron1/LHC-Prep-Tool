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
  const rawDetectedMidi = hzToMidi(pitchHz);
  const detected = pitchHz > 0 ? midiNoteName(rawDetectedMidi) : '—';
  const target = targetMidi === null ? '—' : midiNoteName(targetMidi);
  if (targetMidi === null) return { target, detected, cents: null, detectedCents: null, semitoneDifference: null, difference: 'Waiting for target', state: 'waiting' as const, label: 'WAIT FOR YOUR NOTE', instruction: 'Listen for the next entrance' };
  if (pitchHz <= 0) return { target, detected, cents: null, detectedCents: null, semitoneDifference: null, difference: 'No voice detected', state: 'silent' as const, label: `SING ${target}`, instruction: 'Your note is at the strike line' };
  const nearestDetectedMidi = Math.round(rawDetectedMidi);
  const semitoneDifference = nearestDetectedMidi - Math.round(targetMidi);
  const difference = semitoneDifference === 0
    ? 'Same note as target'
    : `${Math.abs(semitoneDifference)} semitone${Math.abs(semitoneDifference) === 1 ? '' : 's'} ${semitoneDifference > 0 ? 'above' : 'below'} target`;
  const nearestDetectedHz = 440 * 2 ** ((nearestDetectedMidi - 69) / 12);
  const detectedCents = Math.round(1200 * Math.log2(pitchHz / nearestDetectedHz));
  const cents = Math.round(1200 * Math.log2(pitchHz / (440 * 2 ** ((targetMidi - 69) / 12))));
  const shared = { target, detected, cents, detectedCents, semitoneDifference, difference };
  if (Math.abs(cents) <= 50) return { ...shared, state: 'correct' as const, label: 'ON PITCH', instruction: `Hold ${target}` };
  if (cents < 0) return { ...shared, state: 'low' as const, label: 'TOO LOW', instruction: `Sing higher toward ${target} ↑` };
  return { ...shared, state: 'high' as const, label: 'TOO HIGH', instruction: `Sing lower toward ${target} ↓` };
}

export function karaokeCue(song: Song, notes: SongNote[], partIndex: number, elapsed: number): KaraokeCue {
  const hasAuthoredSatb = notes.some(note => note.part >= 0);
  // Note lyrics are the sole gameplay source. For authored SATB arrangements
  // the chosen voice never borrows a phrase or lyric from another part.
  const events = lyricEvents(notes.filter(note => hasAuthoredSatb ? note.part === partIndex : note.part === partIndex || note.part === -1));
  if (!events.length) return { text: 'Instrumental — listen for your entrance', progress: 0, currentLyric: '', nextText: '', waiting: true };
  const phrases = phraseGroups(events, song);
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

/**
 * Group note lyrics into the line the singer should be reading.
 *
 * This used to be one musical measure's worth of words, so at a slow tempo the
 * screen showed a word or two at a time and the singer had no idea what was
 * coming. The arranger's own phrasing existed all along — the editor's
 * timedLyricsFromNotes() writes song.timed_lyrics and the Gameplay Lyrics
 * dialog sets how long a phrase runs — and gameplay simply never read any of
 * it.
 *
 * Authored phrases win when they exist, so what the arranger sees in the
 * dialog is what the singer gets. Otherwise the same rule the editor applies
 * is applied here, which keeps songs that predate the dialog working.
 */
function phraseGroups(events: LyricEvent[], song: Song): LyricEvent[][] {
  const authored = [...(song.timed_lyrics ?? [])]
    .filter(section => section.primary?.trim())
    .sort((a, b) => a.start - b.start);

  if (authored.length) {
    const groups: LyricEvent[][] = authored.map(() => []);
    const orphans: LyricEvent[] = [];
    for (const event of events) {
      // A small tolerance: a phrase's stored bounds come from the notes it was
      // built from, and a note edited since may sit a fraction outside them.
      const index = authored.findIndex(section => event.start >= section.start - .25 && event.start < section.end + .25);
      if (index >= 0) groups[index].push(event); else orphans.push(event);
    }
    const filled = groups.filter(group => group.length);
    // Notes added after the phrases were written would otherwise vanish from
    // the display entirely, which is worse than showing them on their own.
    if (filled.length && orphans.length < events.length / 2) {
      return [...filled, ...splitIntoPhrases(orphans, song)].sort((a, b) => a[0].start - b[0].start);
    }
  }
  return splitIntoPhrases(events, song);
}

/** The editor's rule, kept identical on purpose: break on a real gap, on the
 * punctuation that ends a line, or once a phrase has run long enough to be
 * unreadable in one glance. */
function splitIntoPhrases(events: LyricEvent[], song: Song): LyricEvent[][] {
  if (!events.length) return [];
  const maxTargets = Math.max(2, song.backing_track_settings?.karaoke_lyrics?.targets_per_phrase ?? 10);
  const phrases: LyricEvent[][] = [];
  let phrase: LyricEvent[] = [];
  for (const event of events) {
    const previous = phrase[phrase.length - 1];
    // A trailing hyphen means the word is not finished, so the line cannot end
    // there however long it has run.
    const runLong = previous && phrase.length >= maxTargets && !/[-–—]$/.test(previous.lyric);
    if (previous && (event.start - previous.end > 1.15 || /[.!?;:]$/.test(previous.lyric) || runLong)) {
      phrases.push(phrase);
      phrase = [];
    }
    phrase.push(event);
  }
  if (phrase.length) phrases.push(phrase);
  return phrases;
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
