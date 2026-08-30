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

export const SINGER_VOICE = 'en_US-hfc_female-medium' as const;

type Vits = typeof import('@diffusionstudio/vits-web');
let vitsModule: Promise<Vits> | null = null;
function engine(): Promise<Vits> {
  if (!vitsModule) vitsModule = import('@diffusionstudio/vits-web');
  return vitsModule;
}

/** Is the voice already in browser storage? (No download prompt needed.) */
export async function singerVoiceReady(): Promise<boolean> {
  try {
    const tts = await engine();
    const list = await tts.stored();
    return list.includes(SINGER_VOICE);
  } catch { return false; }
}

/** Fetch the voice model into OPFS, reporting 0..100. */
export async function downloadSingerVoice(onProgress?: (pct: number) => void): Promise<void> {
  const tts = await engine();
  await tts.download(SINGER_VOICE, (progress: { loaded: number; total: number }) => {
    if (onProgress && progress.total > 0) onProgress(Math.round((progress.loaded / progress.total) * 100));
  });
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
  return bestLag > 0 && best > 0.3 ? sampleRate / bestLag : fallback;
}

/** Granular overlap-add: reads grains from the (looped) voiced core, each
 *  grain retuned by ITS OWN measured pitch — speech falls in pitch as it
 *  speaks, and correcting per grain is what turns intonation into a held
 *  note instead of a wobble. A slow vibrato blooms after the onset, grain
 *  levels are evened toward the vowel's median, and the word's CLOSING
 *  consonant is carried across from the source so 'grace' keeps its s.
 *  `withAttack` keeps the spoken onset; a melisma skips it. `withCoda`
 *  marks the last note of the word. */
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

  const grain = Math.floor(sampleRate * 0.05);
  const hop = Math.floor(grain / 4);              // 75% overlap reads far smoother
  const overlapGain = 2 / 3;                       // Hann at 75% overlap sums to ~1.5
  const bodyIn = Math.max(grain * 2 + 2, voicedEnd - voicedStart);
  const loopFrom = voicedStart + Math.floor(bodyIn * 0.15);
  const loopTo = Math.max(loopFrom + grain + 2, voicedStart + Math.floor(bodyIn * 0.8));
  const loopSpan = loopTo - loopFrom;

  // even out grain loudness toward the vowel's own median
  const midRms = frameRms(data, loopFrom, Math.min(loopSpan, Math.floor(sampleRate * 0.08))) || 0.05;

  const bodyOutStart = headLen;
  const bodyOutEnd = total - codaLen;
  const grains = Math.max(1, Math.ceil((bodyOutEnd - bodyOutStart) / hop) + 1);
  for (let g = 0; g < grains; g++) {
    const outPos = bodyOutStart + g * hop;
    if (outPos >= bodyOutEnd) break;
    const travel = g * hop * 0.55;
    const cycle = Math.floor(travel / loopSpan);
    const within = travel % loopSpan;
    const inCenter = cycle % 2 === 0 ? loopFrom + within : loopTo - within;
    // per-grain pitch: correct THIS grain's spoken pitch to the note, with a
    // vibrato that arrives after a quarter second the way a singer's does
    const tSec = (outPos - bodyOutStart) / sampleRate;
    const vibratoDepth = Math.min(1, Math.max(0, (tSec - 0.22) / 0.3)) * 18; // cents
    const vibrato = Math.pow(2, (vibratoDepth * Math.sin(2 * Math.PI * 5.3 * tSec)) / 1200);
    const grainF0 = localF0(data, sampleRate, Math.floor(inCenter - grain / 2), f0);
    const ratio = Math.max(0.4, Math.min(2.8, (targetHz * vibrato) / grainF0));
    // gentle level evening
    const grainRms = frameRms(data, Math.floor(inCenter - grain / 2), grain) || midRms;
    const even = Math.max(0.6, Math.min(1.8, midRms / grainRms));
    for (let index = 0; index < grain; index++) {
      const outIndex = outPos + index;
      if (outIndex >= bodyOutEnd) break;
      const src = inCenter + (index - grain / 2) * ratio;
      const s0 = Math.floor(src);
      if (s0 < 0 || s0 + 1 >= data.length) continue;
      const frac = src - s0;
      const sample = data[s0] * (1 - frac) + data[s0 + 1] * frac;
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / grain);
      out[outIndex] += sample * hann * overlapGain * even;
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

function speakWord(word: string): Promise<Syllable | null> {
  const key = word.toLowerCase();
  if (!syllableCache.has(key)) {
    syllableCache.set(key, (async () => {
      try {
        const tts = await engine();
        const blob = await tts.predict({ text: word, voiceId: SINGER_VOICE });
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
  context: AudioContext, line: SingerLine[], onStatus?: (message: string) => void,
): Promise<Array<{ at: number; buffer: AudioBuffer } | null>> {
  const words = [...new Set(line.map(note => note.lyric.replace(/[^a-zA-Z']/g, '')).filter(Boolean))];
  let done = 0;
  await Promise.all(words.map(async word => {
    await speakWord(word);
    done++;
    onStatus?.(`Preparing the demo singer… ${done}/${words.length} words`);
  }));
  const out: Array<{ at: number; buffer: AudioBuffer } | null> = [];
  let carried: Syllable | null = null;
  for (let index = 0; index < line.length; index++) {
    const note = line[index];
    const word = note.lyric.replace(/[^a-zA-Z']/g, '');
    const syllable: Syllable | null = word ? await speakWord(word) : carried;
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
