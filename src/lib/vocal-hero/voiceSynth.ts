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


// ── the mix bus ────────────────────────────────────────────────────────────
// Every synthesized sound used to hit the destination raw, so the band was
// a pile of soloists. One shared bus per AudioContext: gentle compression
// glues the levels, and a small synthesized room (1.1s of shaped noise as
// the impulse) puts voices and instruments in the same space.

const busCache = new WeakMap<AudioContext, GainNode>();

function roomImpulse(context: AudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index++) {
      data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, decay);
    }
  }
  return buffer;
}

export function mixBus(context: AudioContext): AudioNode {
  const cached = busCache.get(context);
  if (cached) return cached;
  const input = context.createGain();
  input.gain.value = 1;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 18;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.18;
  const dry = context.createGain();
  dry.gain.value = 1;
  const wet = context.createGain();
  wet.gain.value = 0.16;
  try {
    const room = context.createConvolver();
    room.buffer = roomImpulse(context, 1.1, 2.4);
    input.connect(room);
    room.connect(wet);
    wet.connect(compressor);
  } catch { /* a runtime without ConvolverNode still gets the glue */ }
  input.connect(dry);
  dry.connect(compressor);
  compressor.connect(context.destination);   // the ONE line that goes to the hardware
  busCache.set(context, input);
  return input;
}

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

/** A sung note. Returns a stop function, like the piano tone does.
 *  `glideToMidi` bends the tail of the note into the next pitch — the
 *  portamento a marked slide asks for. */
export function playVoiceTone(
  context: AudioContext,
  note: SongNote,
  startAt: number,
  length: number,
  glideToMidi?: number,
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
  master.connect(mixBus(context));

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
    const detuned = frequency * Math.pow(2, cents / 1200);
    oscillator.frequency.value = detuned;
    if (glideToMidi !== undefined) {
      // Portamento: hold the written pitch, then bend through the last
      // stretch of the note into the next pitch — a singer's slide.
      const target = 440 * Math.pow(2, (glideToMidi - 69) / 12) * Math.pow(2, cents / 1200);
      const bend = Math.min(0.22, Math.max(0.08, audible * 0.45));
      oscillator.frequency.setValueAtTime(detuned, Math.max(startAt, releaseAt - bend));
      oscillator.frequency.exponentialRampToValueAtTime(target, releaseAt);
    }
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

/** A REAL plucked string: Karplus–Strong. A burst of noise excites a tuned
 *  delay-line loop whose damping filter eats the highs the way a vibrating
 *  string does — the classic algorithm, far closer to a guitar than any
 *  oscillator. `glideTo` bends the string by retuning the loop. */
export function playGuitarPluck(context: AudioContext, midi: number, startAt: number, length: number, level = 0.05, glideTo?: number): void {
  const frequency = 440 * Math.pow(2, (midi - 69) / 12);
  const period = 1 / frequency;
  const ring = Math.max(0.35, Math.min(2.4, length * 1.15));
  const burstSamples = Math.max(4, Math.round(context.sampleRate * period));
  const buffer = context.createBuffer(1, burstSamples, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < burstSamples; index++) data[index] = (Math.random() * 2 - 1) * (1 - 0.35 * (index / burstSamples));
  const burst = context.createBufferSource();
  burst.buffer = buffer;
  const string = context.createDelay(1);
  string.delayTime.value = period;
  if (glideTo !== undefined) {
    const target = 1 / (440 * Math.pow(2, (glideTo - 69) / 12));
    string.delayTime.setValueAtTime(period, startAt + Math.min(0.1, length * 0.25));
    string.delayTime.linearRampToValueAtTime(target, startAt + Math.max(0.22, length * 0.9));
  }
  const damping = context.createBiquadFilter();
  damping.type = 'lowpass';
  damping.frequency.value = Math.min(8500, 1600 + frequency * 5);
  const feedback = context.createGain();
  feedback.gain.setValueAtTime(Math.pow(0.001, period / ring), startAt);
  feedback.gain.setValueAtTime(0, startAt + ring + 0.35);
  const out = context.createGain();
  out.gain.setValueAtTime(level * 2.4, startAt);
  out.gain.setValueAtTime(level * 2.4, startAt + Math.max(0.08, Math.min(length, ring)));
  out.gain.exponentialRampToValueAtTime(0.0001, startAt + Math.max(0.08, Math.min(length, ring)) + 0.3);
  burst.connect(string);
  string.connect(damping);
  damping.connect(feedback);
  feedback.connect(string);
  damping.connect(out);
  out.connect(mixBus(context));
  burst.start(startAt);
  burst.stop(startAt + burstSamples / context.sampleRate + 0.01);
  // the loop never empties on its own — cut it loose once it is silent
  const untilMs = Math.max(80, (startAt + ring + 0.8 - context.currentTime) * 1000);
  setTimeout(() => { try { feedback.disconnect(); damping.disconnect(); string.disconnect(); out.disconnect(); } catch { /* context closed */ } }, untilMs);
}

/** A piano tone: stretched partials with per-partial decay, a felt-hammer
 *  thump at the onset, and a two-stage release — additive, not sampled,
 *  but it reads as a piano where the old triangle read as a toy. */
export function playPianoNote(context: AudioContext, midi: number, startAt: number, length: number, level = 0.06): void {
  const fundamental = 440 * Math.pow(2, (midi - 69) / 12);
  const hold = Math.max(0.25, length);
  const out = context.createGain();
  out.gain.setValueAtTime(0.0001, startAt);
  out.gain.exponentialRampToValueAtTime(level, startAt + 0.006);
  out.gain.setTargetAtTime(level * 0.35, startAt + 0.01, 0.35);
  out.gain.setValueAtTime(level * 0.35 + 0.0001, startAt + hold);
  out.gain.exponentialRampToValueAtTime(0.0001, startAt + hold + 0.3);
  out.connect(mixBus(context));
  const PARTIALS: Array<[number, number]> = [[1, 1], [2, 0.34], [3, 0.16], [4, 0.07], [5, 0.035]];
  const oscillators: OscillatorNode[] = [];
  for (const [n, amplitude] of PARTIALS) {
    const partial = context.createOscillator();
    partial.type = 'sine';
    partial.frequency.value = fundamental * n * (1 + 0.0007 * n * n);   // string stiffness stretch
    const weight = context.createGain();
    weight.gain.setValueAtTime(amplitude, startAt);
    weight.gain.setTargetAtTime(amplitude * 0.12, startAt + 0.02, 0.9 / n);   // highs die first
    partial.connect(weight);
    weight.connect(out);
    oscillators.push(partial);
  }
  // the hammer: a felt thump, 7ms of band-passed noise
  const thumpSamples = Math.round(context.sampleRate * 0.007);
  const thump = context.createBuffer(1, thumpSamples, context.sampleRate);
  const thumpData = thump.getChannelData(0);
  for (let index = 0; index < thumpSamples; index++) thumpData[index] = (Math.random() * 2 - 1) * (1 - index / thumpSamples);
  const hammer = context.createBufferSource();
  hammer.buffer = thump;
  const hammerBand = context.createBiquadFilter();
  hammerBand.type = 'bandpass';
  hammerBand.frequency.value = Math.min(3400, fundamental * 3.5);
  hammerBand.Q.value = 0.8;
  const hammerGain = context.createGain();
  hammerGain.gain.value = level * 3.2;
  hammer.connect(hammerBand);
  hammerBand.connect(hammerGain);
  hammerGain.connect(mixBus(context));
  oscillators.forEach(node => { node.start(startAt); node.stop(startAt + hold + 0.4); });
  hammer.start(startAt);
}

/** A plucked chord tone — the accompaniment's guitar/piano middle ground.
 *  `glideTo` slides the pitch into a target note over the pluck's ring —
 *  the written tab's e3>g3. */
export function playPluck(context: AudioContext, midi: number, startAt: number, length: number, level = 0.05, glideTo?: number): void {
  const frequency = 440 * Math.pow(2, (midi - 69) / 12);
  const oscillator = context.createOscillator();
  oscillator.type = 'triangle';
  oscillator.frequency.value = frequency;
  const bright = context.createOscillator();
  bright.type = 'sawtooth';
  bright.frequency.value = frequency;
  if (glideTo !== undefined) {
    const target = 440 * Math.pow(2, (glideTo - 69) / 12);
    const from = startAt + Math.min(0.1, length * 0.25);
    const to = startAt + Math.max(0.22, length * 0.9);
    [oscillator, bright].forEach(node => {
      node.frequency.setValueAtTime(frequency, from);
      node.frequency.exponentialRampToValueAtTime(target, to);
    });
  }
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
  gain.connect(mixBus(context));
  [oscillator, bright].forEach(node => { node.start(startAt); node.stop(startAt + Math.max(0.3, length) + 0.1); });
}

/** A strummed chord: real Karplus–Strong strings rolled in sequence. Down
 *  begins on the low strings; up answers lighter from the top three. */
export function playStrum(context: AudioContext, midis: number[], startAt: number, direction: 'down' | 'up', sustain: number, level = 0.05): void {
  const strings = direction === 'down' ? midis : [...midis].slice(-3).reverse();
  const gap = direction === 'down' ? 0.014 : 0.01;
  const each = direction === 'down' ? level : level * 0.6;
  strings.forEach((midi, index) => playGuitarPluck(context, midi, startAt + index * gap, sustain, each));
}

// ── the kit ────────────────────────────────────────────────────────────────

function noiseBuffer(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate * 0.3, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
  return buffer;
}

/** The kick, in three layers a real drum has: the SUB (a pitch-diving sine
 *  with a slight overshoot), the BEATER CLICK (3ms of high-passed noise),
 *  and the shell KNOCK (a short low-mid triangle). */
export function playKick(context: AudioContext, startAt: number, level = 0.16): void {
  const sub = context.createOscillator();
  sub.frequency.setValueAtTime(118, startAt);
  sub.frequency.exponentialRampToValueAtTime(44, startAt + 0.085);
  const subGain = context.createGain();
  subGain.gain.setValueAtTime(level, startAt);
  subGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.34);
  sub.connect(subGain);
  subGain.connect(mixBus(context));
  const knock = context.createOscillator();
  knock.type = 'triangle';
  knock.frequency.value = 178;
  const knockGain = context.createGain();
  knockGain.gain.setValueAtTime(level * 0.55, startAt);
  knockGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.045);
  knock.connect(knockGain);
  knockGain.connect(mixBus(context));
  const click = context.createBufferSource();
  click.buffer = noiseBuffer(context);
  const clickHigh = context.createBiquadFilter();
  clickHigh.type = 'highpass';
  clickHigh.frequency.value = 3200;
  const clickGain = context.createGain();
  clickGain.gain.setValueAtTime(level * 0.8, startAt);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.012);
  click.connect(clickHigh);
  clickHigh.connect(clickGain);
  clickGain.connect(mixBus(context));
  sub.start(startAt); sub.stop(startAt + 0.4);
  knock.start(startAt); knock.stop(startAt + 0.07);
  click.start(startAt); click.stop(startAt + 0.03);
}

/** The snare: a tuned SHELL (two detuned triangles), the SNAPPY (bright
 *  high-passed noise with a fast fall), and the wire BED (band-passed
 *  noise around 1.1kHz) — the three sounds a snare actually makes. */
export function playSnare(context: AudioContext, startAt: number, level = 0.09): void {
  for (const [frequency, amount, decay] of [[185, 0.5, 0.07], [330, 0.28, 0.05]] as Array<[number, number, number]>) {
    const shell = context.createOscillator();
    shell.type = 'triangle';
    shell.frequency.value = frequency;
    const shellGain = context.createGain();
    shellGain.gain.setValueAtTime(level * amount, startAt);
    shellGain.gain.exponentialRampToValueAtTime(0.0001, startAt + decay);
    shell.connect(shellGain);
    shellGain.connect(mixBus(context));
    shell.start(startAt); shell.stop(startAt + decay + 0.03);
  }
  const snappy = context.createBufferSource();
  snappy.buffer = noiseBuffer(context);
  const snappyHigh = context.createBiquadFilter();
  snappyHigh.type = 'highpass';
  snappyHigh.frequency.value = 2600;
  const snappyGain = context.createGain();
  snappyGain.gain.setValueAtTime(level * 0.95, startAt);
  snappyGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.15);
  snappy.connect(snappyHigh);
  snappyHigh.connect(snappyGain);
  snappyGain.connect(mixBus(context));
  snappy.start(startAt); snappy.stop(startAt + 0.19);
  const bed = context.createBufferSource();
  bed.buffer = noiseBuffer(context);
  const bedBand = context.createBiquadFilter();
  bedBand.type = 'bandpass';
  bedBand.frequency.value = 1100;
  bedBand.Q.value = 0.9;
  const bedGain = context.createGain();
  bedGain.gain.setValueAtTime(level * 0.6, startAt);
  bedGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.09);
  bed.connect(bedBand);
  bedBand.connect(bedGain);
  bedGain.connect(mixBus(context));
  bed.start(startAt); bed.stop(startAt + 0.12);
}

/** The hi-hat: six square oscillators at the classic inharmonic ratios,
 *  band-passed high and shaped with a 35ms bite — metal, not static. */
export function playHat(context: AudioContext, startAt: number, level = 0.035): void {
  const band = context.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 10000;
  band.Q.value = 0.9;
  const high = context.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 7200;
  const gain = context.createGain();
  gain.gain.setValueAtTime(level, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.035);
  band.connect(high);
  high.connect(gain);
  gain.connect(mixBus(context));
  for (const frequency of [526, 800, 842, 948, 1174, 1690]) {
    const metal = context.createOscillator();
    metal.type = 'square';
    metal.frequency.value = frequency;
    metal.connect(band);
    metal.start(startAt);
    metal.stop(startAt + 0.06);
  }
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
  gain.connect(mixBus(context));
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
  gain.connect(mixBus(context));
  source.start(startAt);
  source.stop(startAt + 0.12);
}

export function playCajonTick(context: AudioContext, startAt: number, level = 0.025): void {
  playHat(context, startAt, level);
}

/** Piano-ish key tone: rounder than the pluck, sustains while held. */
export function playKeyTone(context: AudioContext, midi: number, startAt: number, length: number, level = 0.05): void {
  const frequency = 440 * Math.pow(2, (midi - 69) / 12);
  const main = context.createOscillator();
  main.type = 'triangle';
  main.frequency.value = frequency;
  const colour = context.createOscillator();
  colour.type = 'sine';
  colour.frequency.value = frequency * 2;
  const colourGain = context.createGain();
  colourGain.gain.setValueAtTime(0.25, startAt);
  colourGain.gain.exponentialRampToValueAtTime(0.03, startAt + 0.5);
  const gain = context.createGain();
  const hold = Math.max(0.25, length);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(level, startAt + 0.015);
  gain.gain.setValueAtTime(level * 0.8, Math.max(startAt + 0.02, startAt + hold - 0.15));
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + hold + 0.2);
  main.connect(gain);
  colour.connect(colourGain);
  colourGain.connect(gain);
  gain.connect(mixBus(context));
  [main, colour].forEach(node => { node.start(startAt); node.stop(startAt + hold + 0.3); });
}

/** Toms, for written-out drum tabs: pitched skins between kick and snare. */
/** A tom with a head and a stick: the diving fundamental, a second
 *  harmonic for the head's ring, and a short attack of filtered noise. */
export function playTom(context: AudioContext, startAt: number, high: boolean, level = 0.11): void {
  const fundamental = context.createOscillator();
  fundamental.frequency.setValueAtTime(high ? 224 : 152, startAt);
  fundamental.frequency.exponentialRampToValueAtTime(high ? 148 : 92, startAt + 0.11);
  const fundamentalGain = context.createGain();
  fundamentalGain.gain.setValueAtTime(level, startAt);
  fundamentalGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.32);
  fundamental.connect(fundamentalGain);
  fundamentalGain.connect(mixBus(context));
  const ring = context.createOscillator();
  ring.type = 'triangle';
  ring.frequency.setValueAtTime((high ? 224 : 152) * 1.9, startAt);
  ring.frequency.exponentialRampToValueAtTime((high ? 148 : 92) * 1.9, startAt + 0.11);
  const ringGain = context.createGain();
  ringGain.gain.setValueAtTime(level * 0.3, startAt);
  ringGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.14);
  ring.connect(ringGain);
  ringGain.connect(mixBus(context));
  const stick = context.createBufferSource();
  stick.buffer = noiseBuffer(context);
  const stickBand = context.createBiquadFilter();
  stickBand.type = 'bandpass';
  stickBand.frequency.value = 2100;
  stickBand.Q.value = 1;
  const stickGain = context.createGain();
  stickGain.gain.setValueAtTime(level * 0.5, startAt);
  stickGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.02);
  stick.connect(stickBand);
  stickBand.connect(stickGain);
  stickGain.connect(mixBus(context));
  fundamental.start(startAt); fundamental.stop(startAt + 0.36);
  ring.start(startAt); ring.stop(startAt + 0.18);
  stick.start(startAt); stick.stop(startAt + 0.04);
}

/** An upright-ish bass: warm fundamental, a whisper of octave, long body. */
export function playBassTone(context: AudioContext, midi: number, startAt: number, length: number, level = 0.09): void {
  const frequency = 440 * Math.pow(2, (midi - 69) / 12);
  const main = context.createOscillator();
  main.type = 'sine';
  main.frequency.value = frequency;
  const body = context.createOscillator();
  body.type = 'triangle';
  body.frequency.value = frequency * 2;
  const bodyGain = context.createGain();
  bodyGain.gain.setValueAtTime(0.22, startAt);
  bodyGain.gain.exponentialRampToValueAtTime(0.04, startAt + 0.4);
  const gain = context.createGain();
  const hold = Math.max(0.2, length);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(level, startAt + 0.02);
  gain.gain.setValueAtTime(level * 0.85, Math.max(startAt + 0.03, startAt + hold - 0.12));
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + hold + 0.15);
  main.connect(gain);
  body.connect(bodyGain);
  bodyGain.connect(gain);
  gain.connect(mixBus(context));
  [main, body].forEach(node => { node.start(startAt); node.stop(startAt + hold + 0.25); });
}
