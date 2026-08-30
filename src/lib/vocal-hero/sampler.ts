'use client';

// Sampled instruments: real recorded notes instead of synthesis.
//
// - PIANO: a 22-note subset of the Salamander Grand Piano (Alexander Holm,
//   CC-BY-3.0 — credited in the README), anchored every minor third A1–C7.
// - GUITAR: a 12-note subset of the VSCO2 Community Edition acoustic guitar
//   (CC0/public domain, via the tonejs-instruments collection), anchored
//   every minor third E2–D5. Slides bend the RECORDING by ramping its
//   playback rate — a genuine finger slide on a real string.
// - BASS: a 10-note subset of the FluidR3 upright bass (MIT, per-note files
//   via gleitz/midi-js-soundfonts), anchored every minor third E1–G3.
// - DRUMS: FluidR3 kit one-shots (kick, snare, closed hat, two toms) from
//   the same soundfont's percussion bank.
//
// FluidR3's files are mastered far quieter than the Salamander/VSCO2 ones
// (the hat peaks near -34 dBFS), so those sets carry `normalize`: at decode
// time the true peak is measured once and a makeup gain rides every play.
//
// Pitch-shifting never exceeds a semitone either way, which keeps it
// inaudible. Loading is fully asynchronous: fetches are shared module-wide,
// decodes are per-AudioContext, and until an anchor is decoded the
// synthesized voice stands in — the band is never silent while it warms.

import { mixBus, playBassTone, playGuitarPluck, playHat, playKick, playPianoNote, playSnare, playTom, playVoiceTone } from './voiceSynth';
import type { SongNote } from './types';

interface SampleSet { folder: string; anchors: Array<{ name: string; midi: number }>; normalize?: boolean; sustain?: boolean }

/** The FluidR3 sustained voices are 3.13s recordings chopped off at full
 *  volume - no decay at all. Played straight, any note longer than the
 *  recording fell silent partway and the abrupt end clicked. Marking a set
 *  `sustain` loops its steady middle instead, so a held note rings for as
 *  long as it is written. */
function holdSustain(source: AudioBufferSourceNode, buffer: AudioBuffer): void {
  const end = Math.max(0.2, buffer.duration - 0.06);
  const start = Math.min(end - 0.15, Math.max(0.35, buffer.duration * 0.28));
  if (end - start < 0.12) return;   // too short to loop cleanly; leave it alone
  source.loop = true;
  source.loopStart = start;
  source.loopEnd = end;
}

const SETS: Record<'piano' | 'guitar' | 'bass' | 'egtr' | 'strings' | 'pad' | 'brass' | 'choir', SampleSet> = {
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
  bass: {
    folder: 'bass',
    normalize: true,
    anchors: [
      { name: 'E1', midi: 28 }, { name: 'G1', midi: 31 }, { name: 'Bb1', midi: 34 }, { name: 'Db2', midi: 37 },
      { name: 'E2', midi: 40 }, { name: 'G2', midi: 43 }, { name: 'Bb2', midi: 46 }, { name: 'Db3', midi: 49 },
      { name: 'E3', midi: 52 }, { name: 'G3', midi: 55 },
    ],
  },
  egtr: {
    folder: 'egtr',
    normalize: true,
    anchors: [
      { name: 'E2', midi: 40 }, { name: 'G2', midi: 43 }, { name: 'Bb2', midi: 46 }, { name: 'Db3', midi: 49 },
      { name: 'E3', midi: 52 }, { name: 'G3', midi: 55 }, { name: 'Bb3', midi: 58 }, { name: 'Db4', midi: 61 },
      { name: 'E4', midi: 64 }, { name: 'G4', midi: 67 }, { name: 'B4', midi: 71 }, { name: 'D5', midi: 74 },
    ],
  },
  strings: {
    folder: 'strings',
    normalize: true,
    sustain: true,
    anchors: [
      { name: 'C3', midi: 48 }, { name: 'Eb3', midi: 51 }, { name: 'Gb3', midi: 54 }, { name: 'A3', midi: 57 },
      { name: 'C4', midi: 60 }, { name: 'Eb4', midi: 63 }, { name: 'Gb4', midi: 66 }, { name: 'A4', midi: 69 },
      { name: 'C5', midi: 72 }, { name: 'Eb5', midi: 75 }, { name: 'Gb5', midi: 78 }, { name: 'A5', midi: 81 },
      { name: 'C6', midi: 84 },
    ],
  },
  pad: {
    folder: 'pad',
    normalize: true,
    sustain: true,
    anchors: [
      { name: 'C3', midi: 48 }, { name: 'Eb3', midi: 51 }, { name: 'Gb3', midi: 54 }, { name: 'A3', midi: 57 },
      { name: 'C4', midi: 60 }, { name: 'Eb4', midi: 63 }, { name: 'Gb4', midi: 66 }, { name: 'A4', midi: 69 },
      { name: 'C5', midi: 72 }, { name: 'Eb5', midi: 75 }, { name: 'Gb5', midi: 78 }, { name: 'A5', midi: 81 },
      { name: 'C6', midi: 84 },
    ],
  },
  brass: {
    folder: 'brass',
    normalize: true,
    sustain: true,
    anchors: [
      { name: 'A2', midi: 45 }, { name: 'C3', midi: 48 }, { name: 'Eb3', midi: 51 }, { name: 'Gb3', midi: 54 },
      { name: 'A3', midi: 57 }, { name: 'C4', midi: 60 }, { name: 'Eb4', midi: 63 }, { name: 'Gb4', midi: 66 },
      { name: 'A4', midi: 69 }, { name: 'C5', midi: 72 },
    ],
  },
  // Real recorded choir "aah" sustains — human voices for every part, from
  // the bass's low E to above the soprano's top line.
  choir: {
    folder: 'choir',
    normalize: true,
    sustain: true,
    anchors: [
      { name: 'E2', midi: 40 }, { name: 'G2', midi: 43 }, { name: 'Bb2', midi: 46 }, { name: 'Db3', midi: 49 },
      { name: 'E3', midi: 52 }, { name: 'G3', midi: 55 }, { name: 'Bb3', midi: 58 }, { name: 'Db4', midi: 61 },
      { name: 'E4', midi: 64 }, { name: 'G4', midi: 67 }, { name: 'B4', midi: 71 }, { name: 'D5', midi: 74 },
      { name: 'F5', midi: 77 }, { name: 'Ab5', midi: 80 }, { name: 'C6', midi: 84 },
    ],
  },
};

// The kit is one-shots, not pitches: each strike plays its recording
// through at its natural length.
const DRUM_SET: SampleSet = { folder: 'drums', normalize: true, anchors: [] };
const DRUM_FILES = { kick: 'C2', snare: 'D2', hat: 'Gb2', 'tom-low': 'A2', 'tom-high': 'D3' } as const;
export type SampledDrum = keyof typeof DRUM_FILES;

const fetched = new Map<string, Promise<ArrayBuffer | null>>();
// One decode for the whole session: an AudioBuffer is not tied to the
// context that decoded it, so every AudioContext the app opens — and the
// editor opens a fresh one per play — shares these. Before this was
// per-context, every single play re-decoded all 34 files and the first
// notes of every preview lost the race to synthesis.
const decoded = new Map<string, AudioBuffer>();
const decodingNow = new Map<string, Promise<void>>();
// Decode-time makeup gain for `normalize` sets: 1.0 would leave FluidR3's
// quiet masters inaudible next to the piano.
const makeup = new Map<string, number>();

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
  for (const name of Object.values(DRUM_FILES)) void fetchSample(DRUM_SET, name);
}
export const preloadInstruments = preloadPiano;

function ensureDecoded(context: AudioContext, set: SampleSet, name: string): Promise<void> {
  const key = sampleKey(set, name);
  if (decoded.has(key)) return Promise.resolve();
  const pending = decodingNow.get(key);
  if (pending) return pending;
  const job = (async () => {
    const raw = await fetchSample(set, name);
    if (!raw) return;
    try {
      // decodeAudioData detaches its input — decode a copy, keep the original.
      const buffer = await context.decodeAudioData(raw.slice(0));
      decoded.set(key, buffer);
      if (set.normalize) {
        let peak = 0;
        const data = buffer.getChannelData(0);
        for (let index = 0; index < data.length; index++) { const amp = Math.abs(data[index]); if (amp > peak) peak = amp; }
        makeup.set(key, Math.min(10, 0.9 / Math.max(0.02, peak)));
      }
    } catch { /* an undecodable sample keeps the synth fallback */ }
  })();
  decodingNow.set(key, job);
  return job;
}

/** Decode every anchor for this context ahead of playback. Idempotent. */
export function warmPiano(context: AudioContext): void {
  for (const set of Object.values(SETS)) for (const anchor of set.anchors) void ensureDecoded(context, set, anchor.name);
  for (const name of Object.values(DRUM_FILES)) void ensureDecoded(context, DRUM_SET, name);
}
export const warmInstruments = warmPiano;

/** Resolves once every sample is decoded for this context (failures count as
 *  done — a missing file must never hold playback hostage). Preview code
 *  AWAITS this before scheduling: scheduling picks sample-or-synth at call
 *  time, so scheduling a whole preview the same tick the context was born
 *  meant the samples always lost the race and the whole band fell back. */
export function samplesReady(context: AudioContext): Promise<void> {
  const jobs: Array<Promise<void>> = [];
  for (const set of Object.values(SETS)) for (const anchor of set.anchors) jobs.push(ensureDecoded(context, set, anchor.name));
  for (const name of Object.values(DRUM_FILES)) jobs.push(ensureDecoded(context, DRUM_SET, name));
  return Promise.all(jobs).then(() => undefined);
}

function nearestAnchor(set: SampleSet, midi: number): { name: string; midi: number } {
  let best = set.anchors[0];
  for (const anchor of set.anchors) if (Math.abs(anchor.midi - midi) < Math.abs(best.midi - midi)) best = anchor;
  return best;
}

function playSampled(context: AudioContext, set: SampleSet, midi: number, startAt: number, length: number, peak: number, releaseTail: number, glideTo?: number): boolean {
  const anchor = nearestAnchor(set, midi);
  // Beyond the recorded range the shift stops being a shift and becomes a
  // smear (a low piano slowed 7 semitones) or a chipmunk (a tab note above
  // the guitar's top string sped ×2.2). The synthesized voice handles any
  // pitch — let it, past ±3 semitones from the nearest recording.
  if (Math.abs(midi - anchor.midi) > 3) return false;
  const key = sampleKey(set, anchor.name);
  const buffer = decoded.get(key);
  if (!buffer) { void ensureDecoded(context, set, anchor.name); return false; }
  // The musical level is already capped below 1 by the caller; the makeup
  // then lifts the quiet master to that intended amplitude. Clamping AFTER
  // the makeup would silently undo the lift itself.
  if (set.normalize) peak = peak * (makeup.get(key) ?? 1);
  const source = context.createBufferSource();
  source.buffer = buffer;
  const rate = Math.pow(2, (midi - anchor.midi) / 12);
  source.playbackRate.value = rate;
  if (set.sustain) holdSustain(source, buffer);
  else {
    // A decaying recording still runs out; hold no longer than it actually
    // plays for at this pitch, so the note fades instead of stopping dead.
    const playable = buffer.duration / rate;
    length = Math.min(length, Math.max(0.08, playable - releaseTail - 0.02));
  }
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
 *  the recording itself. The VSCO2 recordings run hot next to the
 *  Salamander piano — ×2.6 (not the piano's ×4.2) lands the same written
 *  level at the same loudness on either instrument, and within a whisker
 *  of the synthesized string, so the engine switching mid-song is a change
 *  of tone, not a jump in volume. */
export function playGuitar(context: AudioContext, midi: number, startAt: number, length: number, level = 0.05, glideTo?: number): void {
  if (!playSampled(context, SETS.guitar, midi, startAt, length, Math.min(0.9, level * 2.6), 0.3, glideTo)) {
    playGuitarPluck(context, midi, startAt, length, level, glideTo);
  }
}

/** The clean electric guitar. Sampled when ready, the acoustic pluck synth
 *  stands in while it warms; slides bend the recording like the acoustic. */
export function playElectric(context: AudioContext, midi: number, startAt: number, length: number, level = 0.05, glideTo?: number): void {
  if (!playSampled(context, SETS.egtr, midi, startAt, length, Math.min(0.9, level * 1.8), 0.35, glideTo)) {
    playGuitarPluck(context, midi, startAt, length, level, glideTo);
  }
}

/** The sustained section voices — string ensemble, warm pad, brass section.
 *  Real recorded sustains; a quiet piano stands in while they warm so the
 *  band is never silent. Multipliers are lab-calibrated against the piano's
 *  loudness at the same written level. */
export function playEnsemble(context: AudioContext, kind: 'strings' | 'pad' | 'brass', midi: number, startAt: number, length: number, level = 0.05): void {
  const gain = kind === 'brass' ? 0.85 : kind === 'strings' ? 0.7 : 0.35;
  if (!playSampled(context, SETS[kind], midi, startAt, length, Math.min(0.9, level * gain), 0.5)) {
    playPianoNote(context, midi, startAt, length, level * 0.6);
  }
}

const CHOIR_GAIN = 0.7;

/** The sung preview voice: a REAL recorded choir "aah" at the note's pitch,
 *  with the formant synth standing in while the recording warms. Drop-in for
 *  playVoiceTone — same signature, same velocity-to-level law, and the
 *  returned stopper silences the voice early (the note audition needs it). */
export function playVoice(context: AudioContext, note: SongNote, startAt: number, length: number, glideTo?: number): () => void {
  const anchor = nearestAnchor(SETS.choir, note.midi);
  if (Math.abs(note.midi - anchor.midi) > 3) return playVoiceTone(context, note, startAt, length, glideTo);
  const key = sampleKey(SETS.choir, anchor.name);
  const buffer = decoded.get(key);
  if (!buffer) { void ensureDecoded(context, SETS.choir, anchor.name); return playVoiceTone(context, note, startAt, length, glideTo); }
  const level = Math.max(0.02, Math.min(0.11, note.velocity / 1250));
  const source = context.createBufferSource();
  source.buffer = buffer;
  const rate = Math.pow(2, (note.midi - anchor.midi) / 12);
  source.playbackRate.value = rate;
  holdSustain(source, buffer);
  if (glideTo !== undefined) {
    // The sung portamento bends the RECORDING, like the guitar's slide.
    const targetRate = Math.pow(2, (glideTo - anchor.midi) / 12);
    source.playbackRate.setValueAtTime(rate, startAt + Math.min(0.1, length * 0.25));
    source.playbackRate.linearRampToValueAtTime(targetRate, startAt + Math.max(0.22, length * 0.9));
  }
  const gain = context.createGain();
  const peak = Math.min(0.9, level * CHOIR_GAIN) * (makeup.get(key) ?? 1);
  const hold = Math.max(0.25, length);
  gain.gain.setValueAtTime(peak, startAt);
  gain.gain.setValueAtTime(peak, startAt + hold);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + hold + 0.3);
  source.connect(gain);
  gain.connect(mixBus(context));
  source.start(startAt);
  source.stop(startAt + hold + 0.45);
  return () => {
    const now = context.currentTime;
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      source.stop(now + 0.1);
    } catch { /* already stopped */ }
  };
}

/** The raw material for a choir note, for callers that run their own audio
 *  graph (the round guide has its own master level and reset semantics).
 *  Null while the nearest recording is still warming. */
export function choirVoiceFor(context: AudioContext, midi: number): { buffer: AudioBuffer; playbackRate: number; makeup: number; applyLoop: (source: AudioBufferSourceNode) => void } | null {
  const anchor = nearestAnchor(SETS.choir, midi);
  if (Math.abs(midi - anchor.midi) > 3) return null;
  const key = sampleKey(SETS.choir, anchor.name);
  const buffer = decoded.get(key);
  if (!buffer) { void ensureDecoded(context, SETS.choir, anchor.name); return null; }
  return { buffer, playbackRate: Math.pow(2, (midi - anchor.midi) / 12), makeup: makeup.get(key) ?? 1, applyLoop: source => holdSustain(source, buffer) };
}

/** The upright bass. Sampled when ready, the sine-and-triangle synth until
 *  then. The multiplier is calibrated so the recording lands at the same
 *  loudness the synth did for the same written level. */
export function playBass(context: AudioContext, midi: number, startAt: number, length: number, level = 0.09): void {
  if (!playSampled(context, SETS.bass, midi, startAt, length, Math.min(0.9, level * 2.8), 0.25)) {
    playBassTone(context, midi, startAt, length, level);
  }
}

const DRUM_SYNTH: Record<SampledDrum, (context: AudioContext, startAt: number, level: number) => void> = {
  kick: playKick,
  snare: playSnare,
  hat: playHat,
  'tom-low': (context, startAt, level) => playTom(context, startAt, false, level),
  'tom-high': (context, startAt, level) => playTom(context, startAt, true, level),
};
// Per-strike calibration: each one-shot lands at the loudness its synthesized
// stand-in had for the same written level, so the kit switching engines
// mid-song never changes the mix.
const DRUM_GAIN: Record<SampledDrum, number> = { kick: 1.13, snare: 0.92, hat: 1.77, 'tom-low': 1.27, 'tom-high': 1.4 };

/** One kit strike. The recording plays through at its natural length. */
export function playDrum(context: AudioContext, kind: SampledDrum, startAt: number, level: number): void {
  const key = sampleKey(DRUM_SET, DRUM_FILES[kind]);
  const buffer = decoded.get(key);
  if (!buffer) { void ensureDecoded(context, DRUM_SET, DRUM_FILES[kind]); DRUM_SYNTH[kind](context, startAt, level); return; }
  const source = context.createBufferSource();
  source.buffer = buffer;
  const gain = context.createGain();
  gain.gain.value = Math.min(1, level * DRUM_GAIN[kind]) * (makeup.get(key) ?? 1);
  source.connect(gain);
  gain.connect(mixBus(context));
  source.start(startAt);
}
