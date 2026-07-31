import type { SongNote, VocalExpressionPoint, VocalNoteExpression } from './types';

export interface AudioNoteDetectionOptions {
  part: number;
  timelineOffset?: number;
  minMidi: number;
  maxMidi: number;
  minNoteSeconds?: number;
  frameSize?: number;
  hopSize?: number;
  minConfidence?: number;
}

interface PitchFrame {
  time: number;
  midi: number | null;
  confidence: number;
  rms: number;
}

interface VocalEvent {
  midi: number;
  frames: Array<PitchFrame & { midi: number }>;
  start: number;
  end: number;
  startedAfterSilence: boolean;
  endedIntoSilence: boolean;
}

export interface AudioNoteDetectionDiagnostics {
  durationSeconds: number;
  analyzedFrames: number;
  voicedFrames: number;
  rejectedOutOfRangeFrames: number;
  averageConfidence: number;
  averagePitchDriftCents: number;
  lowestMidi: number | null;
  highestMidi: number | null;
  timingResolutionMs: number;
  detectedNoiseFloor: number;
  expressiveNotes: number;
  algorithm: 'YIN-CMNDF';
}

export interface AudioNoteDetectionResult {
  notes: SongNote[];
  diagnostics: AudioNoteDetectionDiagnostics;
}

/**
 * High-resolution, browser-local transcription for one unaccompanied singer.
 *
 * Pitch uses YIN's cumulative mean-normalized difference function rather than
 * a raw autocorrelation peak. The analysis signal is anti-aliased down to
 * 12 kHz, which retains the full SATB range while making dense 10.7 ms hops
 * practical. A hysteretic note segmenter prevents normal vibrato from being
 * misread as a run of semitones. Exact continuous pitch, dynamics, vibrato,
 * attack, and release data remain attached to each editable SongNote.
 */
export async function detectVocalNotes(buffer: AudioBuffer, options: AudioNoteDetectionOptions): Promise<AudioNoteDetectionResult> {
  const original = monoSamples(buffer);
  const analysisRate = Math.min(buffer.sampleRate, 12000);
  const samples = resampleByAveraging(original, buffer.sampleRate, analysisRate);
  const frameSize = nearestPowerOfTwo(options.frameSize ?? 1024);
  const hopSize = Math.max(64, Math.min(frameSize / 2, options.hopSize ?? 128));
  const frameSeconds = hopSize / analysisRate;
  // Pitch frames need a long window for Bass E2, but their center alone is a
  // poor onset marker. Search slightly beyond half a frame to recover the
  // envelope edge with a 4 ms energy window.
  const boundarySearchRadius = frameSize / analysisRate / 2 + frameSeconds * 2;
  const minDuration = Math.max(.025, options.minNoteSeconds ?? .045);
  const minConfidence = clamp(options.minConfidence ?? .76, .55, .98);
  const noiseFloor = estimateNoiseFloor(samples, analysisRate);
  const voicedThreshold = Math.max(.0035, noiseFloor * 2.6);
  const frames: PitchFrame[] = [];
  let rejectedOutOfRangeFrames = 0;

  for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
    const frame = samples.subarray(offset, offset + frameSize);
    const pitch = yinPitch(
      frame,
      analysisRate,
      midiToHz(Math.max(24, options.minMidi - 8)),
      midiToHz(Math.min(108, options.maxMidi + 8)),
      voicedThreshold,
    );
    const measuredMidi = pitch.hz > 0 && pitch.confidence >= minConfidence ? hzToMidi(pitch.hz) : null;
    const inRange = measuredMidi !== null && measuredMidi >= options.minMidi - .5 && measuredMidi <= options.maxMidi + .5;
    if (measuredMidi !== null && !inRange) rejectedOutOfRangeFrames += 1;
    frames.push({
      time: (offset + frameSize / 2) / analysisRate,
      midi: inRange ? measuredMidi : null,
      confidence: pitch.confidence,
      rms: pitch.rms,
    });
    if (frames.length % 240 === 0) await yieldToBrowser();
  }

  const smoothed = smoothPitchFrames(frames);
  const peakRms = percentile(smoothed.filter(frame => frame.midi !== null).map(frame => frame.rms), .95) || .1;
  const events = segmentNotes(smoothed, frameSeconds);
  const accepted = events.filter(event => event.end - event.start >= minDuration && average(event.frames.map(frame => frame.confidence)) >= minConfidence);
  const refinedBoundaries = refineEventBoundaries(accepted, samples, analysisRate, boundarySearchRadius, voicedThreshold);
  const timelineOffset = Math.max(0, options.timelineOffset ?? 0);

  const notes = accepted.map((event, eventIndex) => {
    const refinedStart = refinedBoundaries[eventIndex].start;
    const refinedEnd = refinedBoundaries[eventIndex].end;
    const start = Math.max(0, Math.min(refinedStart, refinedEnd - .001));
    const end = Math.max(start + .001, refinedEnd);
    const expression = buildExpression(event, start, end, peakRms);
    const averageLevel = average(expression.contour.map(point => point.level));
    return {
      id: `vocal-${crypto.randomUUID()}`,
      part: options.part,
      midi: event.midi,
      start: round(timelineOffset + start),
      end: round(timelineOffset + end),
      lyric: '',
      velocity: Math.round(clamp(24 + averageLevel * 103, 1, 127)),
      expression,
    } satisfies SongNote;
  });

  return {
    notes,
    diagnostics: {
      durationSeconds: buffer.duration,
      analyzedFrames: frames.length,
      voicedFrames: smoothed.filter(frame => frame.midi !== null).length,
      rejectedOutOfRangeFrames,
      averageConfidence: average(accepted.flatMap(event => event.frames.map(frame => frame.confidence))),
      averagePitchDriftCents: average(notes.map(note => Math.abs(note.expression?.mean_cents ?? 0))),
      lowestMidi: notes.length ? Math.min(...notes.map(note => note.midi)) : null,
      highestMidi: notes.length ? Math.max(...notes.map(note => note.midi)) : null,
      timingResolutionMs: frameSeconds * 1000,
      detectedNoiseFloor: noiseFloor,
      expressiveNotes: notes.filter(note => (note.expression?.vibrato_rate_hz ?? 0) > 0 || (note.expression?.pitch_spread_cents ?? 0) >= 12).length,
      algorithm: 'YIN-CMNDF',
    },
  };
}

function refineEventBoundaries(events: VocalEvent[], samples: Float32Array, sampleRate: number, radius: number, threshold: number) {
  const boundaries = events.map(event => ({
    start: event.startedAfterSilence ? refineEnergyBoundary(samples, sampleRate, event.start, radius, threshold, 'start') : event.start,
    end: event.endedIntoSilence ? refineEnergyBoundary(samples, sampleRate, event.end, radius, threshold, 'end') : event.end,
  }));
  for (let index = 0; index < events.length - 1; index += 1) {
    const center = (events[index].end + events[index + 1].start) / 2;
    const gap = findEnergyGap(samples, sampleRate, center, radius, threshold);
    if (!gap) continue;
    boundaries[index].end = gap.start;
    boundaries[index + 1].start = gap.end;
  }
  return boundaries;
}

function findEnergyGap(samples: Float32Array, sampleRate: number, center: number, radius: number, threshold: number) {
  const window = Math.max(16, Math.round(sampleRate * .004));
  const step = Math.max(4, Math.floor(window / 3));
  const from = Math.max(0, Math.floor((center - radius) * sampleRate));
  const to = Math.min(samples.length, Math.ceil((center + radius) * sampleRate));
  const inactive: number[] = [];
  for (let offset = from; offset + window <= to; offset += step) {
    let energy = 0;
    for (let sample = offset; sample < offset + window; sample += 1) energy += samples[sample] ** 2;
    if (Math.sqrt(energy / window) < threshold) inactive.push(offset + window / 2);
  }
  if (!inactive.length) return null;
  const groups: Array<{ start: number; end: number }> = [];
  inactive.forEach(sample => {
    const previous = groups.at(-1);
    if (previous && sample - previous.end <= step * 1.6) previous.end = sample;
    else groups.push({ start: sample, end: sample });
  });
  const candidates = groups
    .filter(group => (group.end - group.start) / sampleRate >= .007)
    .sort((a, b) => Math.abs((a.start + a.end) / 2 / sampleRate - center) - Math.abs((b.start + b.end) / 2 / sampleRate - center));
  const selected = candidates[0];
  return selected ? { start: selected.start / sampleRate, end: selected.end / sampleRate } : null;
}

function segmentNotes(frames: PitchFrame[], frameSeconds: number): VocalEvent[] {
  const events: VocalEvent[] = [];
  const maximumBridge = Math.max(.026, frameSeconds * 2.6);
  const pitchPersistenceFrames = 2;
  let current: VocalEvent | null = null;
  let pending: Array<PitchFrame & { midi: number }> = [];
  let lastVoicedTime = -Infinity;

  const closeCurrent = (end: number, endedIntoSilence: boolean) => {
    if (!current) return;
    current.end = Math.max(current.start + frameSeconds, end);
    current.endedIntoSilence = endedIntoSilence;
    events.push(current);
    current = null;
    pending = [];
  };

  for (const frame of frames) {
    if (frame.midi === null) {
      if (current && frame.time - lastVoicedTime > maximumBridge) closeCurrent(lastVoicedTime + frameSeconds / 2, true);
      continue;
    }
    const voiced = frame as PitchFrame & { midi: number };
    const rounded = Math.round(voiced.midi);
    const followsSilence = frame.time - lastVoicedTime > maximumBridge;
    lastVoicedTime = frame.time;

    if (!current) {
      current = { midi: rounded, frames: [voiced], start: Math.max(0, frame.time - frameSeconds / 2), end: frame.time + frameSeconds / 2, startedAfterSilence: followsSilence, endedIntoSilence: false };
      continue;
    }

    // The .62-semitone boundary plus two-frame persistence preserves quick
    // real notes while preventing ordinary ±30-50 cent vibrato from chattering.
    if (Math.abs(voiced.midi - current.midi) >= .62) {
      const pendingMidi = pending.length ? Math.round(median(pending.map(item => item.midi))) : rounded;
      if (!pending.length || pendingMidi === rounded) pending.push(voiced);
      else pending = [voiced];
      if (pending.length >= pitchPersistenceFrames) {
        const transitionFrames = [...pending];
        const first = transitionFrames[0];
        closeCurrent(Math.max(current.start + frameSeconds, first.time - frameSeconds / 2), false);
        current = { midi: Math.round(median(transitionFrames.map(item => item.midi))), frames: transitionFrames, start: Math.max(0, first.time - frameSeconds / 2), end: voiced.time + frameSeconds / 2, startedAfterSilence: false, endedIntoSilence: false };
        pending = [];
      }
      continue;
    }

    if (pending.length) {
      // A one-frame excursion did not persist long enough to be a singable
      // target. Do not pollute the retained note's tuning/vibrato contour with
      // that likely consonant, octave error, or room-noise transient.
      pending = [];
    }
    current.frames.push(voiced);
    current.end = frame.time + frameSeconds / 2;
  }
  if (current) closeCurrent(Math.min(frames.at(-1)?.time ?? current.end, current.end) + frameSeconds / 2, true);
  return joinMicroDropouts(events, frameSeconds);
}

function joinMicroDropouts(events: VocalEvent[], frameSeconds: number) {
  const joined: VocalEvent[] = [];
  for (const event of events) {
    const previous = joined.at(-1);
    if (previous && previous.midi === event.midi && event.start - previous.end <= Math.max(.032, frameSeconds * 3)) {
      previous.end = event.end;
      previous.frames.push(...event.frames);
      previous.endedIntoSilence = event.endedIntoSilence;
    } else joined.push({ ...event, frames: [...event.frames] });
  }
  return joined;
}

function buildExpression(event: VocalEvent, start: number, end: number, peakRms: number): VocalNoteExpression {
  const stride = Math.max(1, Math.ceil(event.frames.length / 72));
  const sampled = event.frames.filter((_, index) => index % stride === 0 || index === event.frames.length - 1);
  const contour: VocalExpressionPoint[] = sampled.map(frame => ({
    offset: round(clamp(frame.time - start, 0, end - start)),
    cents: round(clamp((frame.midi - event.midi) * 100, -200, 200)),
    level: round(clamp(frame.rms / Math.max(.0001, peakRms), 0, 1)),
    confidence: round(clamp(frame.confidence, 0, 1)),
  }));
  const cents = contour.map(point => point.cents);
  const meanCents = average(cents);
  const spread = standardDeviation(cents);
  const vibrato = estimateVibrato(contour, end - start);
  const levels = contour.map(point => point.level);
  const peak = Math.max(...levels, .001);
  const attackPoint = contour.find(point => point.level >= peak * .7)?.offset ?? end - start;
  const attack = attackPoint <= .055 ? 'strong' : attackPoint <= .14 ? 'medium' : 'soft';
  const finalLevel = levels.at(-1) ?? 0;
  const release = event.endedIntoSilence ? (finalLevel >= peak * .48 ? 'cut' : 'natural') : 'held';
  return {
    contour,
    mean_cents: round(meanCents),
    pitch_spread_cents: round(spread),
    vibrato_rate_hz: vibrato.rate,
    vibrato_depth_cents: vibrato.depth,
    attack,
    release,
    source: 'vocal-analysis',
  };
}

function estimateVibrato(points: VocalExpressionPoint[], duration: number) {
  if (duration < .32 || points.length < 8) return { rate: null, depth: 0 };
  const cents = points.map(point => point.cents);
  const radius = Math.max(2, Math.round(points.length * Math.min(.12 / duration, .18)));
  const residual = cents.map((value, index) => value - average(cents.slice(Math.max(0, index - radius), index + radius + 1)));
  const depth = standardDeviation(residual) * Math.SQRT2;
  let crossings = 0;
  for (let index = 1; index < residual.length; index += 1) if (residual[index - 1] <= 0 && residual[index] > 0) crossings += 1;
  const observed = Math.max(.001, points.at(-1)!.offset - points[0].offset);
  const rate = crossings / observed;
  if (depth < 5 || depth > 120 || rate < 3.2 || rate > 9.5) return { rate: null, depth: 0 };
  return { rate: round(rate), depth: round(depth) };
}

function smoothPitchFrames(frames: PitchFrame[]) {
  return frames.map((frame, index) => {
    if (frame.midi === null) return frame;
    const neighbours = frames.slice(Math.max(0, index - 1), index + 2).map(item => item.midi).filter((midi): midi is number => midi !== null).sort((a, b) => a - b);
    if (neighbours.length < 2) return frame;
    return { ...frame, midi: median(neighbours) };
  });
}

function yinPitch(input: Float32Array, sampleRate: number, minHz: number, maxHz: number, rmsThreshold: number) {
  let mean = 0;
  for (const sample of input) mean += sample;
  mean /= input.length;
  let energy = 0;
  for (const sample of input) energy += (sample - mean) ** 2;
  const rms = Math.sqrt(energy / input.length);
  if (rms < rmsThreshold) return { hz: 0, confidence: 0, rms };

  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(input.length / 2, Math.ceil(sampleRate / minHz));
  const difference = new Float32Array(maxLag + 1);
  const comparisonLength = input.length - maxLag;
  for (let lag = 1; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let index = 0; index < comparisonLength; index += 1) {
      const delta = (input[index] - mean) - (input[index + lag] - mean);
      sum += delta * delta;
    }
    difference[lag] = sum;
  }

  const normalized = new Float32Array(maxLag + 1);
  normalized[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag += 1) {
    running += difference[lag];
    normalized[lag] = running > 0 ? difference[lag] * lag / running : 1;
  }

  let selected = -1;
  const threshold = .14;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    if (normalized[lag] < threshold) {
      while (lag + 1 <= maxLag && normalized[lag + 1] < normalized[lag]) lag += 1;
      selected = lag;
      break;
    }
  }
  if (selected < 0) {
    let best = 1;
    for (let lag = minLag; lag <= maxLag; lag += 1) if (normalized[lag] < best) { best = normalized[lag]; selected = lag; }
    if (selected < 0 || 1 - best < .72) return { hz: 0, confidence: 0, rms };
  }

  const left = normalized[Math.max(minLag, selected - 1)];
  const center = normalized[selected];
  const right = normalized[Math.min(maxLag, selected + 1)];
  const divisor = 2 * (2 * center - right - left);
  const refined = Math.abs(divisor) < 1e-9 ? selected : selected + (right - left) / divisor;
  return { hz: sampleRate / refined, confidence: clamp(1 - center, 0, 1), rms };
}

function refineEnergyBoundary(samples: Float32Array, sampleRate: number, coarse: number, radius: number, threshold: number, edge: 'start' | 'end') {
  const from = Math.max(0, Math.floor((coarse - radius) * sampleRate));
  const to = Math.min(samples.length, Math.ceil((coarse + radius) * sampleRate));
  const window = Math.max(16, Math.round(sampleRate * .004));
  const step = Math.max(4, Math.floor(window / 3));
  const active: number[] = [];
  for (let offset = from; offset + window <= to; offset += step) {
    let energy = 0;
    for (let index = offset; index < offset + window; index += 1) energy += samples[index] ** 2;
    if (Math.sqrt(energy / window) >= threshold) active.push(offset + window / 2);
  }
  if (!active.length) return coarse;
  const sample = edge === 'start' ? active[0] : active.at(-1)!;
  return sample / sampleRate;
}

function estimateNoiseFloor(samples: Float32Array, sampleRate: number) {
  const window = Math.max(64, Math.round(sampleRate * .02));
  const values: number[] = [];
  for (let offset = 0; offset + window <= samples.length; offset += window) {
    let energy = 0;
    for (let index = offset; index < offset + window; index += 1) energy += samples[index] ** 2;
    values.push(Math.sqrt(energy / window));
  }
  return percentile(values, .18);
}

function monoSamples(buffer: AudioBuffer) {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    for (let index = 0; index < mono.length; index += 1) mono[index] += input[index] / buffer.numberOfChannels;
  }
  return mono;
}

function resampleByAveraging(input: Float32Array, sourceRate: number, targetRate: number) {
  if (sourceRate <= targetRate) return input;
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.max(start + 1, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let source = start; source < Math.min(end, input.length); source += 1) sum += input[source];
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

function midiToHz(midi: number) { return 440 * 2 ** ((midi - 69) / 12); }
function hzToMidi(hz: number) { return 69 + 12 * Math.log2(hz / 440); }
function nearestPowerOfTwo(value: number) { return 2 ** Math.round(Math.log2(Math.max(256, value))); }
function average(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function percentile(values: number[], ratio: number) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)))]; }
function standardDeviation(values: number[]) { if (!values.length) return 0; const mean = average(values); return Math.sqrt(average(values.map(value => (value - mean) ** 2))); }
function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }
function round(value: number) { return Math.round(value * 10000) / 10000; }
function yieldToBrowser() { return new Promise<void>(resolve => setTimeout(resolve, 0)); }
