'use client';

// The preview that SINGS. A piano tone tells a singer where the note is;
// it does not tell them what a held choir "ah" feels like. This is classic
// formant synthesis: a bright source (two detuned saws) shaped by three
// bandpass filters sitting where a singer's vowel resonances sit, with
// vibrato that arrives after the onset the way a trained voice's does.
// The vowel comes from the note's own lyric, so "Gloria" opens on "oh"
// and closes on "ah". Also here: a small synthesized kit (kick, snare,
// hat) and a plucked chord for the guitar/piano accompaniment.

import type { SongNote } from './types';

// F1/F2/F3 in Hz for the sung vowels, mid register.
const VOWELS: Record<string, [number, number, number]> = {
  a: [700, 1220, 2600],
  e: [530, 1840, 2480],
  i: [320, 2200, 2900],
  o: [500, 1000, 2600],
  u: [325, 700, 2530],
};

// The same vowel sits differently in different voices: sopranos ring
// brighter, basses darker.
const REGISTER_SCALE = [1.1, 1.05, 0.95, 0.88];

export function vowelOf(lyric: string | undefined): [number, number, number] {
  const letters = (lyric ?? '').toLowerCase().replace(/[^a-z]/g, '');
  for (let index = letters.length - 1; index >= 0; index--) {
    const letter = letters[index] === 'y' ? 'i' : letters[index];
    if (VOWELS[letter]) return VOWELS[letter];
  }
  return VOWELS.a;
}

/** A sung note. Returns a stop function, like the piano tone does. */
export function playVoiceTone(
  context: AudioContext,
  note: SongNote,
  startAt: number,
  length: number,
): () => void {
  const frequency = 440 * Math.pow(2, (note.midi - 69) / 12);
  const gainLevel = Math.max(0.02, Math.min(0.11, note.velocity / 1250));
  const audible = Math.max(0.06, length);
  const releaseAt = startAt + audible;
  const scale = REGISTER_SCALE[note.part >= 0 && note.part <= 3 ? note.part : 0];
  const formants = vowelOf(note.lyric).map(f => f * scale);

  const master = context.createGain();
  master.gain.setValueAtTime(0.0001, startAt);
  master.gain.exponentialRampToValueAtTime(gainLevel, startAt + Math.min(0.08, audible * 0.3));
  master.gain.setValueAtTime(gainLevel, Math.max(startAt, releaseAt - 0.1));
  master.gain.exponentialRampToValueAtTime(0.0001, releaseAt + 0.12);
  master.connect(context.destination);

  // gentle top-end rolloff so the saws read as breath, not buzz
  const shelf = context.createBiquadFilter();
  shelf.type = 'lowpass';
  shelf.frequency.value = 4200;
  shelf.Q.value = 0.5;
  shelf.connect(master);

  const source = context.createGain();
  source.gain.value = 1;
  const weights = [1, 0.45, 0.22];
  formants.forEach((formant, index) => {
    const band = context.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = Math.min(formant, 5200);
    band.Q.value = 9;
    const weight = context.createGain();
    weight.gain.value = weights[index] ?? 0.2;
    source.connect(band);
    band.connect(weight);
    weight.connect(shelf);
  });

  const oscillators = [0, 7].map(cents => {
    const oscillator = context.createOscillator();
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = frequency * Math.pow(2, cents / 1200);
    oscillator.connect(source);
    return oscillator;
  });

  // vibrato: none at the onset, blooming to ~14 cents after a quarter second
  const vibrato = context.createOscillator();
  vibrato.frequency.value = 5.2;
  const vibratoDepth = context.createGain();
  vibratoDepth.gain.setValueAtTime(0, startAt);
  vibratoDepth.gain.linearRampToValueAtTime(frequency * 0.008, startAt + Math.min(0.35, audible));
  vibrato.connect(vibratoDepth);
  oscillators.forEach(oscillator => vibratoDepth.connect(oscillator.frequency));

  const nodes = [...oscillators, vibrato];
  nodes.forEach(node => { node.start(startAt); node.stop(releaseAt + 0.2); });
  return () => {
    try { master.gain.cancelScheduledValues(context.currentTime); master.gain.setTargetAtTime(0.0001, context.currentTime, 0.03); } catch { /* closing */ }
    nodes.forEach(node => { try { node.stop(context.currentTime + 0.1); } catch { /* already stopped */ } });
  };
}

/** A plucked chord tone — the accompaniment's guitar/piano middle ground. */
export function playPluck(context: AudioContext, midi: number, startAt: number, length: number, level = 0.05): void {
  const frequency = 440 * Math.pow(2, (midi - 69) / 12);
  const oscillator = context.createOscillator();
  oscillator.type = 'triangle';
  oscillator.frequency.value = frequency;
  const bright = context.createOscillator();
  bright.type = 'sawtooth';
  bright.frequency.value = frequency;
  const brightGain = context.createGain();
  brightGain.gain.setValueAtTime(0.3, startAt);
  brightGain.gain.exponentialRampToValueAtTime(0.02, startAt + 0.35);
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.min(6000, frequency * 6), startAt);
  filter.frequency.exponentialRampToValueAtTime(Math.max(600, frequency * 1.5), startAt + Math.min(0.8, length));
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(level, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + Math.max(0.25, length));
  oscillator.connect(filter);
  bright.connect(brightGain);
  brightGain.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  [oscillator, bright].forEach(node => { node.start(startAt); node.stop(startAt + Math.max(0.3, length) + 0.1); });
}

/** A strummed chord: the pluck rolled across the strings. Down begins on
 *  the low strings; up answers lighter from the top three. */
export function playStrum(context: AudioContext, midis: number[], startAt: number, direction: 'down' | 'up', sustain: number, level = 0.05): void {
  const strings = direction === 'down' ? midis : [...midis].slice(-3).reverse();
  const gap = direction === 'down' ? 0.014 : 0.01;
  const each = direction === 'down' ? level : level * 0.6;
  strings.forEach((midi, index) => playPluck(context, midi, startAt + index * gap, sustain, each));
}

// ── the kit ────────────────────────────────────────────────────────────────

function noiseBuffer(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 0.3, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
  return buffer;
}

export function playKick(context: AudioContext, startAt: number, level = 0.16): void {
  const oscillator = context.createOscillator();
  oscillator.frequency.setValueAtTime(130, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(42, startAt + 0.09);
  const gain = context.createGain();
  gain.gain.setValueAtTime(level, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.24);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + 0.3);
}

export function playSnare(context: AudioContext, startAt: number, level = 0.09): void {
  const source = context.createBufferSource();
  source.buffer = noiseBuffer(context);
  const band = context.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1800;
  band.Q.value = 0.8;
  const gain = context.createGain();
  gain.gain.setValueAtTime(level, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.16);
  source.connect(band);
  band.connect(gain);
  gain.connect(context.destination);
  source.start(startAt);
  source.stop(startAt + 0.2);
}

export function playHat(context: AudioContext, startAt: number, level = 0.035): void {
  const source = context.createBufferSource();
  source.buffer = noiseBuffer(context);
  const high = context.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 6500;
  const gain = context.createGain();
  gain.gain.setValueAtTime(level, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.05);
  source.connect(high);
  high.connect(gain);
  gain.connect(context.destination);
  source.start(startAt);
  source.stop(startAt + 0.08);
}

// ── the cajon ──────────────────────────────────────────────────────────────
// Palm near the centre for the bass tone, fingers at the edge for the slap,
// a knuckle tick to keep the subdivision — woodier and softer than the kit.

export function playCajonBass(context: AudioContext, startAt: number, level = 0.13): void {
  const oscillator = context.createOscillator();
  oscillator.frequency.setValueAtTime(110, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(62, startAt + 0.06);
  const gain = context.createGain();
  gain.gain.setValueAtTime(level, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.14);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + 0.18);
}

export function playCajonSlap(context: AudioContext, startAt: number, level = 0.07): void {
  const source = context.createBufferSource();
  const buffer = context.createBuffer(1, context.sampleRate * 0.12, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
  source.buffer = buffer;
  const crack = context.createBiquadFilter();
  crack.type = 'bandpass';
  crack.frequency.value = 2900;
  crack.Q.value = 1.2;
  const body = context.createBiquadFilter();
  body.type = 'bandpass';
  body.frequency.value = 900;
  body.Q.value = 1;
  const gain = context.createGain();
  gain.gain.setValueAtTime(level, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.09);
  const bodyGain = context.createGain();
  bodyGain.gain.value = 0.4;
  source.connect(crack); crack.connect(gain);
  source.connect(body); body.connect(bodyGain); bodyGain.connect(gain);
  gain.connect(context.destination);
  source.start(startAt);
  source.stop(startAt + 0.12);
}

export function playCajonTick(context: AudioContext, startAt: number, level = 0.025): void {
  playHat(context, startAt, level);
}
