'use client';

// The sampled piano: real recorded notes instead of synthesis. The samples
// are a 22-note subset of the Salamander Grand Piano (Alexander Holm,
// CC-BY-3.0 — credited in the README), anchored every minor third from
// A1 to C7 and pitch-shifted at most a semitone either way, which keeps
// the shift inaudible. Loading is fully asynchronous: fetches are shared
// module-wide, decodes are per-AudioContext, and until a note's anchor is
// decoded the additive playPianoNote stands in — the piano is never silent
// while it warms up.

import { mixBus, playPianoNote } from './voiceSynth';

const ANCHORS: Array<{ name: string; midi: number }> = [
  { name: 'A1', midi: 33 }, { name: 'C2', midi: 36 }, { name: 'Ds2', midi: 39 }, { name: 'Fs2', midi: 42 },
  { name: 'A2', midi: 45 }, { name: 'C3', midi: 48 }, { name: 'Ds3', midi: 51 }, { name: 'Fs3', midi: 54 },
  { name: 'A3', midi: 57 }, { name: 'C4', midi: 60 }, { name: 'Ds4', midi: 63 }, { name: 'Fs4', midi: 66 },
  { name: 'A4', midi: 69 }, { name: 'C5', midi: 72 }, { name: 'Ds5', midi: 75 }, { name: 'Fs5', midi: 78 },
  { name: 'A5', midi: 81 }, { name: 'C6', midi: 84 }, { name: 'Ds6', midi: 87 }, { name: 'Fs6', midi: 90 },
  { name: 'A6', midi: 93 }, { name: 'C7', midi: 96 },
];

const fetched = new Map<string, Promise<ArrayBuffer | null>>();
const decodedBuffers = new WeakMap<AudioContext, Map<string, AudioBuffer>>();
const decodingNow = new WeakMap<AudioContext, Set<string>>();

function fetchSample(name: string): Promise<ArrayBuffer | null> {
  if (!fetched.has(name)) {
    fetched.set(name, fetch(`/samples/piano/${name}.mp3`)
      .then(response => response.ok ? response.arrayBuffer() : null)
      .catch(() => null));
  }
  return fetched.get(name)!;
}

/** Start the downloads early — call on editor/game mount. Idempotent. */
export function preloadPiano(): void {
  for (const anchor of ANCHORS) void fetchSample(anchor.name);
}

async function ensureDecoded(context: AudioContext, name: string): Promise<void> {
  let buffers = decodedBuffers.get(context);
  if (!buffers) { buffers = new Map(); decodedBuffers.set(context, buffers); }
  if (buffers.has(name)) return;
  let busy = decodingNow.get(context);
  if (!busy) { busy = new Set(); decodingNow.set(context, busy); }
  if (busy.has(name)) return;
  busy.add(name);
  const raw = await fetchSample(name);
  if (!raw) return;
  try {
    // decodeAudioData detaches its input — decode a copy, keep the original.
    const buffer = await context.decodeAudioData(raw.slice(0));
    buffers.set(name, buffer);
  } catch { /* an undecodable sample keeps the synth fallback */ }
}

/** Decode every anchor for this context ahead of playback. Idempotent. */
export function warmPiano(context: AudioContext): void {
  for (const anchor of ANCHORS) void ensureDecoded(context, anchor.name);
}

function nearestAnchor(midi: number): { name: string; midi: number } {
  let best = ANCHORS[0];
  for (const anchor of ANCHORS) if (Math.abs(anchor.midi - midi) < Math.abs(best.midi - midi)) best = anchor;
  return best;
}

/** The piano. Sampled when the anchor is decoded, additive until then. */
export function playPiano(context: AudioContext, midi: number, startAt: number, length: number, level = 0.06): void {
  const anchor = nearestAnchor(midi);
  const buffer = decodedBuffers.get(context)?.get(anchor.name);
  if (!buffer) {
    void ensureDecoded(context, anchor.name);
    playPianoNote(context, midi, startAt, length, level);
    return;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = Math.pow(2, (midi - anchor.midi) / 12);
  const gain = context.createGain();
  const hold = Math.max(0.25, length);
  const peak = Math.min(0.9, level * 4.2);   // recorded notes sit quieter than raw oscillators
  gain.gain.setValueAtTime(peak, startAt);
  gain.gain.setValueAtTime(peak, startAt + hold);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + hold + 0.4);
  source.connect(gain);
  gain.connect(mixBus(context));
  source.start(startAt);
  source.stop(startAt + hold + 0.55);
}
