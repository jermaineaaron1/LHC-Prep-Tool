'use client';

// Sampled instruments: real recorded notes instead of synthesis.
//
// - PIANO: a 22-note subset of the Salamander Grand Piano (Alexander Holm,
//   CC-BY-3.0 — credited in the README), anchored every minor third A1–C7.
// - GUITAR: a 12-note subset of the VSCO2 Community Edition acoustic guitar
//   (CC0/public domain, via the tonejs-instruments collection), anchored
//   every minor third E2–D5. Slides bend the RECORDING by ramping its
//   playback rate — a genuine finger slide on a real string.
//
// Pitch-shifting never exceeds a semitone either way, which keeps it
// inaudible. Loading is fully asynchronous: fetches are shared module-wide,
// decodes are per-AudioContext, and until an anchor is decoded the
// synthesized voice stands in — the band is never silent while it warms.

import { mixBus, playGuitarPluck, playPianoNote } from './voiceSynth';

interface SampleSet { folder: string; anchors: Array<{ name: string; midi: number }> }

const SETS: Record<'piano' | 'guitar', SampleSet> = {
  piano: {
    folder: 'piano',
    anchors: [
      { name: 'A1', midi: 33 }, { name: 'C2', midi: 36 }, { name: 'Ds2', midi: 39 }, { name: 'Fs2', midi: 42 },
      { name: 'A2', midi: 45 }, { name: 'C3', midi: 48 }, { name: 'Ds3', midi: 51 }, { name: 'Fs3', midi: 54 },
      { name: 'A3', midi: 57 }, { name: 'C4', midi: 60 }, { name: 'Ds4', midi: 63 }, { name: 'Fs4', midi: 66 },
      { name: 'A4', midi: 69 }, { name: 'C5', midi: 72 }, { name: 'Ds5', midi: 75 }, { name: 'Fs5', midi: 78 },
      { name: 'A5', midi: 81 }, { name: 'C6', midi: 84 }, { name: 'Ds6', midi: 87 }, { name: 'Fs6', midi: 90 },
      { name: 'A6', midi: 93 }, { name: 'C7', midi: 96 },
    ],
  },
  guitar: {
    folder: 'guitar',
    anchors: [
      { name: 'E2', midi: 40 }, { name: 'G2', midi: 43 }, { name: 'As2', midi: 46 }, { name: 'Cs3', midi: 49 },
      { name: 'E3', midi: 52 }, { name: 'G3', midi: 55 }, { name: 'As3', midi: 58 }, { name: 'Cs4', midi: 61 },
      { name: 'E4', midi: 64 }, { name: 'G4', midi: 67 }, { name: 'B4', midi: 71 }, { name: 'D5', midi: 74 },
    ],
  },
};

const fetched = new Map<string, Promise<ArrayBuffer | null>>();
const decodedBuffers = new WeakMap<AudioContext, Map<string, AudioBuffer>>();
const decodingNow = new WeakMap<AudioContext, Set<string>>();

function sampleKey(set: SampleSet, name: string): string { return `${set.folder}/${name}`; }

function fetchSample(set: SampleSet, name: string): Promise<ArrayBuffer | null> {
  const key = sampleKey(set, name);
  if (!fetched.has(key)) {
    fetched.set(key, fetch(`/samples/${set.folder}/${name}.mp3`)
      .then(response => response.ok ? response.arrayBuffer() : null)
      .catch(() => null));
  }
  return fetched.get(key)!;
}

/** Start every download early — call on editor/game mount. Idempotent. */
export function preloadPiano(): void {
  for (const set of Object.values(SETS)) for (const anchor of set.anchors) void fetchSample(set, anchor.name);
}
export const preloadInstruments = preloadPiano;

async function ensureDecoded(context: AudioContext, set: SampleSet, name: string): Promise<void> {
  const key = sampleKey(set, name);
  let buffers = decodedBuffers.get(context);
  if (!buffers) { buffers = new Map(); decodedBuffers.set(context, buffers); }
  if (buffers.has(key)) return;
  let busy = decodingNow.get(context);
  if (!busy) { busy = new Set(); decodingNow.set(context, busy); }
  if (busy.has(key)) return;
  busy.add(key);
  const raw = await fetchSample(set, name);
  if (!raw) return;
  try {
    // decodeAudioData detaches its input — decode a copy, keep the original.
    const buffer = await context.decodeAudioData(raw.slice(0));
    buffers.set(key, buffer);
  } catch { /* an undecodable sample keeps the synth fallback */ }
}

/** Decode every anchor for this context ahead of playback. Idempotent. */
export function warmPiano(context: AudioContext): void {
  for (const set of Object.values(SETS)) for (const anchor of set.anchors) void ensureDecoded(context, set, anchor.name);
}
export const warmInstruments = warmPiano;

function nearestAnchor(set: SampleSet, midi: number): { name: string; midi: number } {
  let best = set.anchors[0];
  for (const anchor of set.anchors) if (Math.abs(anchor.midi - midi) < Math.abs(best.midi - midi)) best = anchor;
  return best;
}

function playSampled(context: AudioContext, set: SampleSet, midi: number, startAt: number, length: number, peak: number, releaseTail: number, glideTo?: number): boolean {
  const anchor = nearestAnchor(set, midi);
  const buffer = decodedBuffers.get(context)?.get(sampleKey(set, anchor.name));
  if (!buffer) { void ensureDecoded(context, set, anchor.name); return false; }
  const source = context.createBufferSource();
  source.buffer = buffer;
  const rate = Math.pow(2, (midi - anchor.midi) / 12);
  source.playbackRate.value = rate;
  if (glideTo !== undefined) {
    // A slide bends the RECORDING: ramp the playback rate to the target.
    const targetRate = Math.pow(2, (glideTo - anchor.midi) / 12);
    source.playbackRate.setValueAtTime(rate, startAt + Math.min(0.1, length * 0.25));
    source.playbackRate.linearRampToValueAtTime(targetRate, startAt + Math.max(0.22, length * 0.9));
  }
  const gain = context.createGain();
  const hold = Math.max(0.25, length);
  gain.gain.setValueAtTime(peak, startAt);
  gain.gain.setValueAtTime(peak, startAt + hold);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + hold + releaseTail);
  source.connect(gain);
  gain.connect(mixBus(context));
  source.start(startAt);
  source.stop(startAt + hold + releaseTail + 0.15);
  return true;
}

/** The piano. Sampled when the anchor is decoded, additive until then. */
export function playPiano(context: AudioContext, midi: number, startAt: number, length: number, level = 0.06): void {
  if (!playSampled(context, SETS.piano, midi, startAt, length, Math.min(0.9, level * 4.2), 0.4)) {
    playPianoNote(context, midi, startAt, length, level);
  }
}

/** The guitar. Sampled when ready, Karplus–Strong until then; slides bend
 *  the recording itself. */
export function playGuitar(context: AudioContext, midi: number, startAt: number, length: number, level = 0.05, glideTo?: number): void {
  if (!playSampled(context, SETS.guitar, midi, startAt, length, Math.min(0.9, level * 4.6), 0.3, glideTo)) {
    playGuitarPluck(context, midi, startAt, length, level, glideTo);
  }
}
