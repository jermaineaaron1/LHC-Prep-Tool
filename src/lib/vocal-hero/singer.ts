'use client';

// The AI demo singer. A neural Piper voice (@diffusionstudio/vits-web, MIT;
// voices MIT from rhasspy/piper) PRONOUNCES each lyric entirely in the
// browser, and every syllable is then retuned to the written pitch and
// stretched to the note's length with a granular overlap-add — so the
// preview sings the actual words at the actual notes. The first use
// downloads the voice once (~60 MB) into browser storage (OPFS); after
// that it works offline. Nothing ever leaves the device.

import { mixBus } from './voiceSynth';
import type { SongNote } from './types';

/** A mixed demo choir: a female voice carries soprano and alto, a male
 *  voice tenor and bass — both from the same recording family so they
 *  blend like siblings. */
export const SINGER_VOICES = {
  female: 'en_US-hfc_female-medium',
  male: 'en_US-hfc_male-medium',
} as const;
export type SingerVoiceKind = keyof typeof SINGER_VOICES;
export const voiceKindForPart = (part: number): SingerVoiceKind => (part <= 1 ? 'female' : 'male');

type Vits = typeof import('@diffusionstudio/vits-web');
let vitsModule: Promise<Vits> | null = null;
function engine(): Promise<Vits> {
  if (!vitsModule) vitsModule = import('@diffusionstudio/vits-web');
  return vitsModule;
}

/** Are these voices already in browser storage? (No download needed.) */
export async function singerVoiceReady(kinds: SingerVoiceKind[]): Promise<boolean> {
  try {
    const tts = await engine();
    const list = await tts.stored();
    return kinds.every(kind => list.includes(SINGER_VOICES[kind]));
  } catch { return false; }
}

/** Fetch the voice models into OPFS, reporting per-voice 0..100. */
export async function downloadSingerVoice(kinds: SingerVoiceKind[], onProgress?: (label: string, pct: number) => void): Promise<void> {
  const tts = await engine();
  const stored = await tts.stored();
  for (const kind of kinds) {
    if (stored.includes(SINGER_VOICES[kind])) continue;
    await tts.download(SINGER_VOICES[kind], (progress: { loaded: number; total: number }) => {
      if (onProgress && progress.total > 0) onProgress(kind, Math.round((progress.loaded / progress.total) * 100));
    });
  }
}

// ── syllable analysis ──────────────────────────────────────────────────────

export interface Syllable {
  data: Float32Array;
  sampleRate: number;
  /** median voiced pitch of the spoken word, Hz */
  f0: number;
  /** sample where the voiced vowel core begins (after the consonant) */
  voicedStart: number;
  /** sample where the voiced core ends (before trailing fade/consonant) */
  voicedEnd: number;
}

function frameRms(data: Float32Array, start: number, length: number): number {
  let sum = 0;
  const end = Math.min(data.length, start + length);
  for (let index = start; index < end; index++) sum += data[index] * data[index];
  return Math.sqrt(sum / Math.max(1, end - start));
}

/** Median autocorrelation pitch over the voiced middle of the clip. */
/** Autocorrelation loves picking DOUBLE the period (an octave low), which
 *  spaces the pitch marks two glottal pulses apart and roughens the voice.
 *  If half or a third of the winning lag scores nearly as well, the shorter
 *  lag is the true period — take it. */
function preferShortLag(data: Float32Array, center: number, win: number, minLag: number, bestLag: number, best: number): number {
  if (bestLag <= 0 || best <= 0) return bestLag;
  for (const divisor of [3, 2]) {
    const lag = Math.round(bestLag / divisor);
    if (lag < minLag) continue;
    let corr = 0, norm = 0;
    for (let index = 0; index < win; index += 2) {
      corr += data[center + index] * data[center + index + lag];
      norm += data[center + index] * data[center + index];
    }
    const score = norm > 1e-6 ? corr / norm : 0;
    if (score > best * 0.9) return lag;
  }
  return bestLag;
}

function estimateF0(data: Float32Array, sampleRate: number, from: number, to: number): number {
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 70);
  const win = Math.min(2048, maxLag * 3);
  const estimates: number[] = [];
  for (let center = from; center + win + maxLag < to; center += Math.floor(win / 2)) {
    let bestLag = 0, best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0, norm = 0;
      for (let index = 0; index < win; index += 2) {
        corr += data[center + index] * data[center + index + lag];
        norm += data[center + index] * data[center + index];
      }
      const score = norm > 1e-6 ? corr / norm : 0;
      if (score > best) { best = score; bestLag = lag; }
    }
    bestLag = preferShortLag(data, center, win, minLag, bestLag, best);
    if (bestLag > 0 && best > 0.35) estimates.push(sampleRate / bestLag);
  }
  if (!estimates.length) return 190;
  estimates.sort((a, b) => a - b);
  return estimates[Math.floor(estimates.length / 2)];
}

export function analyzeSyllable(data: Float32Array, sampleRate: number): Syllable {
  const frame = Math.floor(sampleRate * 0.01);
  const frames: number[] = [];
  for (let start = 0; start < data.length; start += frame) frames.push(frameRms(data, start, frame));
  const peak = Math.max(...frames, 1e-6);
  let first = frames.findIndex(value => value > peak * 0.3);
  if (first < 0) first = 0;
  let last = frames.length - 1;
  while (last > first && frames[last] < peak * 0.16) last--;
  const voicedStart = first * frame;
  const voicedEnd = Math.max(voicedStart + frame * 4, (last + 1) * frame);
  const f0 = estimateF0(data, sampleRate, voicedStart, Math.min(voicedEnd, data.length));
  return { data, sampleRate, f0, voicedStart, voicedEnd: Math.min(voicedEnd, data.length) };
}

// ── the retune: pitch to the note, stretch to its length ───────────────────

const midiHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** f0 at one spot, for the per-grain pitch track. */
function localF0(data: Float32Array, sampleRate: number, center: number, fallback: number): number {
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 70);
  const win = Math.min(1024, maxLag * 2);
  if (center + win + maxLag >= data.length || center < 0) return fallback;
  let bestLag = 0, best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0, norm = 0;
    for (let index = 0; index < win; index += 2) {
      corr += data[center + index] * data[center + index + lag];
      norm += data[center + index] * data[center + index];
    }
    const score = norm > 1e-6 ? corr / norm : 0;
    if (score > best) { best = score; bestLag = lag; }
  }
  bestLag = preferShortLag(data, center, win, minLag, bestLag, best);
  return bestLag > 0 && best > 0.3 ? sampleRate / bestLag : fallback;
}

/** Glottal pitch marks across the voiced region — one per period, sitting
 *  on the waveform's local peak so every grain is cut at the same phase. */
function pitchMarks(data: Float32Array, sampleRate: number, from: number, to: number, fallback: number): number[] {
  const marks: number[] = [];
  let period = sampleRate / localF0(data, sampleRate, from, fallback);
  let best = from, bestValue = -1;
  for (let index = from; index < Math.min(to, from + Math.ceil(period)); index++) {
    const amp = Math.abs(data[index]);
    if (amp > bestValue) { bestValue = amp; best = index; }
  }
  marks.push(best);
  while (marks[marks.length - 1] + period * 1.6 < to) {
    const last = marks[marks.length - 1];
    period = sampleRate / localF0(data, sampleRate, last, fallback);
    const center = last + period;
    const win = Math.max(2, Math.floor(period * 0.3));
    let mark = Math.round(center), markValue = -1;
    for (let index = Math.max(last + 2, Math.floor(center - win)); index < Math.min(to, Math.ceil(center + win)); index++) {
      const amp = Math.abs(data[index]);
      if (amp > markValue) { markValue = amp; mark = index; }
    }
    marks.push(mark);
  }
  return marks;
}

/** TD-PSOLA: period-length grains are cut at the pitch marks and laid back
 *  down at the TARGET pitch's spacing — never resampled, so the voice's
 *  formants (the shape of the throat) stay exactly where the speaker put
 *  them. That is the difference between a chipmunked shift and the same
 *  person singing the note. A slow vibrato blooms after the onset, grain
 *  levels even toward the vowel's median, and the word's CLOSING consonant
 *  is carried across so 'grace' keeps its s. `withAttack` keeps the spoken
 *  onset; a melisma skips it. `withCoda` marks the word's last note. */
export function renderSyllableAtPitch(syllable: Syllable, midi: number, seconds: number, withAttack: boolean, withCoda = true): Float32Array {
  const { data, sampleRate, f0, voicedStart, voicedEnd } = syllable;
  const targetHz = midiHz(midi);
  const total = Math.max(16, Math.round(seconds * sampleRate));
  const out = new Float32Array(total);

  // consonant head, verbatim (it is noise — shifting it helps nothing)
  const headLen = withAttack ? Math.min(voicedStart, Math.floor(sampleRate * 0.11), total) : 0;
  for (let index = 0; index < headLen; index++) out[index] = data[index];

  // the word's ending, reserved at the tail of the note
  const codaSrcLen = withCoda ? Math.min(data.length - voicedEnd, Math.floor(sampleRate * 0.18)) : 0;
  const codaLen = Math.min(codaSrcLen, Math.floor(total * 0.35));

  const bodyOutStart = headLen;
  const bodyOutEnd = total - codaLen;
  const marks = pitchMarks(data, sampleRate, voicedStart, voicedEnd, f0);
  const midRms = frameRms(data, voicedStart + Math.floor((voicedEnd - voicedStart) * 0.2),
    Math.min(voicedEnd - voicedStart, Math.floor(sampleRate * 0.08))) || 0.05;

  if (marks.length >= 4) {
    // loop inside the vowel's steady middle, in MARK space
    const markFrom = Math.floor(marks.length * 0.15);
    const markTo = Math.max(markFrom + 2, Math.floor(marks.length * 0.8));
    const markSpan = markTo - markFrom;
    const sourcePeriod = sampleRate / f0;
    let outCursor = bodyOutStart;
    let travel = 0;   // in source marks; saunters so long notes do not race
    while (outCursor < bodyOutEnd) {
      const tSec = (outCursor - bodyOutStart) / sampleRate;
      const vibratoDepth = Math.min(1, Math.max(0, (tSec - 0.22) / 0.3)) * 16;   // cents
      const vibrato = Math.pow(2, (vibratoDepth * Math.sin(2 * Math.PI * 5.3 * tSec)) / 1200);
      const targetPeriod = sampleRate / (targetHz * vibrato);
      const cycle = Math.floor(travel / markSpan);
      const within = travel % markSpan;
      const markIndex = Math.max(0, Math.min(marks.length - 1,
        Math.floor(markFrom + (cycle % 2 === 0 ? within : markSpan - within))));
      const mark = marks[markIndex];
      const prev = marks[Math.max(0, markIndex - 1)];
      const next = marks[Math.min(marks.length - 1, markIndex + 1)];
      const half = Math.max(8, Math.min(Math.floor(sampleRate * 0.02),
        Math.floor(Math.max(mark - prev, next - mark))));
      const grainRms = frameRms(data, mark - half, half * 2) || midRms;
      const even = Math.max(0.6, Math.min(1.8, midRms / grainRms));
      // grains repeat at the target period; amplitude compensates for how
      // densely they overlap so pitch does not change loudness
      const grainGain = Math.max(0.35, Math.min(1.2, (0.95 * targetPeriod) / half)) * even;
      const center = Math.round(outCursor);
      for (let k = -half; k < half; k++) {
        const outIndex = center + k;
        if (outIndex < 0 || outIndex >= bodyOutEnd) continue;
        const sourceIndex = mark + k;
        if (sourceIndex < 0 || sourceIndex >= data.length) continue;
        const hann = 0.5 + 0.5 * Math.cos((Math.PI * k) / half);
        out[outIndex] += data[sourceIndex] * hann * grainGain;
      }
      outCursor += targetPeriod;
      travel += 0.55 * (targetPeriod / Math.max(8, sourcePeriod));
    }
  } else {
    // too little voiced material to mark — copy what there is
    for (let index = bodyOutStart; index < bodyOutEnd; index++) {
      const sourceIndex = voicedStart + ((index - bodyOutStart) % Math.max(1, voicedEnd - voicedStart));
      out[index] = data[sourceIndex] ?? 0;
    }
  }

  // the closing consonant, unshifted, crossfaded in over 20ms
  if (codaLen > 0) {
    const fade = Math.min(Math.floor(sampleRate * 0.02), codaLen);
    for (let index = 0; index < codaLen; index++) {
      const outIndex = bodyOutEnd + index;
      const mix = index < fade ? index / fade : 1;
      out[outIndex] = out[outIndex] * (1 - mix) + data[voicedEnd + index] * mix;
    }
  }

  // 25ms edges so scheduled notes never click
  const edge = Math.min(Math.floor(sampleRate * 0.025), Math.floor(total / 3));
  for (let index = 0; index < edge; index++) {
    const gainIn = index / edge;
    if (headLen === 0) out[index] *= gainIn;
    out[total - 1 - index] *= gainIn;
  }
  // keep peaks civil
  let peak = 0;
  for (let index = 0; index < total; index++) { const a = Math.abs(out[index]); if (a > peak) peak = a; }
  if (peak > 0.9) { const scale = 0.9 / peak; for (let index = 0; index < total; index++) out[index] *= scale; }
  return out;
}

// ── the public face ────────────────────────────────────────────────────────

const syllableCache = new Map<string, Promise<Syllable | null>>();

function speakWord(word: string, kind: SingerVoiceKind): Promise<Syllable | null> {
  const key = kind + ':' + word.toLowerCase();
  if (!syllableCache.has(key)) {
    syllableCache.set(key, (async () => {
      try {
        const tts = await engine();
        const blob = await tts.predict({ text: word, voiceId: SINGER_VOICES[kind] });
        const raw = await blob.arrayBuffer();
        // decode with a throwaway offline context — sample-accurate and quiet
        const scratch = new OfflineAudioContext(1, 8, 22050);
        const decoded = await scratch.decodeAudioData(raw);
        return analyzeSyllable(decoded.getChannelData(0).slice(0), decoded.sampleRate);
      } catch { return null; }
    })());
  }
  return syllableCache.get(key)!;
}

export interface SingerLine { midi: number; at: number; seconds: number; lyric: string }

/** Build one AudioBuffer per note, the words pronounced and retuned. Notes
 *  without a lyric carry the previous word's vowel on (the melisma). */
export async function prepareSingerBuffers(
  context: AudioContext, line: SingerLine[], kind: SingerVoiceKind = 'female', onStatus?: (message: string) => void,
): Promise<Array<{ at: number; buffer: AudioBuffer } | null>> {
  const words = [...new Set(line.map(note => note.lyric.replace(/[^a-zA-Z']/g, '')).filter(Boolean))];
  let done = 0;
  await Promise.all(words.map(async word => {
    await speakWord(word, kind);
    done++;
    onStatus?.(`Preparing the ${kind} voice… ${done}/${words.length} words`);
  }));
  const out: Array<{ at: number; buffer: AudioBuffer } | null> = [];
  let carried: Syllable | null = null;
  for (let index = 0; index < line.length; index++) {
    const note = line[index];
    const word = note.lyric.replace(/[^a-zA-Z']/g, '');
    const syllable: Syllable | null = word ? await speakWord(word, kind) : carried;
    if (word && syllable) carried = syllable;
    if (!syllable) { out.push(null); continue; }
    // the closing consonant belongs to the LAST note of the word: a melisma
    // in the middle keeps the vowel open
    const nextWord = index + 1 < line.length ? line[index + 1].lyric.replace(/[^a-zA-Z']/g, '') : 'end';
    const rendered = renderSyllableAtPitch(syllable, note.midi, note.seconds, Boolean(word), Boolean(nextWord));
    const buffer = context.createBuffer(1, rendered.length, syllable.sampleRate);
    buffer.copyToChannel(rendered as Float32Array<ArrayBuffer>, 0);
    out.push({ at: note.at, buffer });
  }
  return out;
}

/** Schedule a prepared line into the context, through the shared mix bus. */
export function playSingerBuffers(
  context: AudioContext, prepared: Array<{ at: number; buffer: AudioBuffer } | null>, level = 0.9,
): void {
  for (const item of prepared) {
    if (!item) continue;
    const source = context.createBufferSource();
    source.buffer = item.buffer;
    const gain = context.createGain();
    gain.gain.value = level;
    source.connect(gain);
    gain.connect(mixBus(context));
    source.start(item.at);
  }
}
