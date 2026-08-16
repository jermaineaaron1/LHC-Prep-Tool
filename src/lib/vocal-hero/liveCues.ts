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
  // Each stable lyric phrase is one musical measure. A 4/4 measure therefore
  // presents all note lyrics beginning within its four beats at the same time.
  const phrases = measurePhraseEvents(events, song);
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

function measurePhraseEvents(events: LyricEvent[], song: Song) {
  const end = Math.max(song.duration || 0, ...events.map(event => event.end), 1);
  const measures = musicalMeasures(song, end + 1);
  const grouped = new Map<number, LyricEvent[]>();
  for (const event of events) {
    const found = measures.findIndex(measure => event.start >= measure.start - .0001 && event.start < measure.end - .0001);
    const index = found < 0 ? measures.length - 1 : found;
    const group = grouped.get(index) ?? [];
    group.push(event);
    grouped.set(index, group);
  }
  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => group.sort((a, b) => a.start - b.start || a.end - b.end));
}

function musicalMeasures(song: Song, end: number) {
  const timeline = song.backing_track_settings?.musical_timeline;
  const tempos = [...(timeline?.tempo_changes ?? [{ at: 0, bpm: song.bpm || 120 }])].sort((a, b) => a.at - b.at);
  const meters = [...(timeline?.meter_changes ?? [{ at: 0, numerator: song.time_sig || 4, denominator: 4 }])].sort((a, b) => a.at - b.at);
  const changes = [...new Set([0, end, ...tempos.map(item => item.at), ...meters.map(item => item.at)].filter(value => value >= 0 && value <= end))].sort((a, b) => a - b);
  const result: Array<{ start: number; end: number }> = [];
  for (let segment = 0; segment < changes.length - 1; segment += 1) {
    const segmentStart = changes[segment];
    const segmentEnd = changes[segment + 1];
    const tempo = tempos.filter(item => item.at <= segmentStart + .0001).at(-1)?.bpm ?? 120;
    const meter = meters.filter(item => item.at <= segmentStart + .0001).at(-1) ?? { numerator: 4, denominator: 4 };
    const measureSeconds = (60 / Math.max(20, tempo)) * (4 / Math.max(1, meter.denominator)) * Math.max(1, meter.numerator);
    for (let start = segmentStart; start < segmentEnd - .0001; start += measureSeconds) result.push({ start, end: Math.min(segmentEnd, start + measureSeconds) });
  }
  return result.length ? result : [{ start: 0, end }];
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
