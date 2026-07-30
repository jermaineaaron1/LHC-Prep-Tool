import type { SongNote } from './types';

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
}

export interface AudioNoteDetectionResult {
  notes: SongNote[];
  diagnostics: AudioNoteDetectionDiagnostics;
}

/**
 * Extract a monophonic sung melody from a decoded AudioBuffer.
 *
 * This intentionally targets one unaccompanied voice. It uses normalized
 * autocorrelation, median pitch smoothing and short-gap joining before
 * returning normal editable SongNote events. The browser never uploads the
 * recording for analysis.
 */
export async function detectVocalNotes(buffer: AudioBuffer, options: AudioNoteDetectionOptions): Promise<AudioNoteDetectionResult> {
  // 2048 samples gives roughly 23 ms half-window timing error at 44.1 kHz,
  // while still carrying enough periods to resolve the supported Bass E2.
  const frameSize = nearestPowerOfTwo(options.frameSize ?? 2048);
  const hopSize = Math.max(128, Math.min(frameSize, options.hopSize ?? 512));
  const minDuration = Math.max(.04, options.minNoteSeconds ?? .065);
  const minConfidence = Math.max(.5, Math.min(.95, options.minConfidence ?? .64));
  const samples = monoSamples(buffer);
  const frames: PitchFrame[] = [];
  let rejectedOutOfRangeFrames = 0;

  for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
    const frame = samples.subarray(offset, offset + frameSize);
    // Analyse an octave beyond the destination lane first. This is deliberate:
    // clamping an out-of-range pitch to a lane boundary creates convincing but
    // false C4/A5 notes. We measure the real fundamental and reject it instead.
    const pitch = autocorrelate(frame, buffer.sampleRate, midiToHz(Math.max(24, options.minMidi - 12)), midiToHz(Math.min(108, options.maxMidi + 12)));
    const measuredMidi = pitch.hz > 0 && pitch.confidence >= minConfidence ? hzToMidi(pitch.hz) : null;
    const inRange = measuredMidi !== null && measuredMidi >= options.minMidi - .48 && measuredMidi <= options.maxMidi + .48;
    if (measuredMidi !== null && !inRange) rejectedOutOfRangeFrames += 1;
    frames.push({ time: (offset + frameSize / 2) / buffer.sampleRate, midi: inRange ? measuredMidi : null, confidence: pitch.confidence });
    if (frames.length % 180 === 0) await yieldToBrowser();
  }

  const smoothed = medianSmooth(frames);
  const events: Array<{ midi: number; start: number; end: number; confidence: number[]; cents: number[] }> = [];
  const frameSeconds = hopSize / buffer.sampleRate;
  for (const frame of smoothed) {
    const previous = events.at(-1);
    if (frame.midi === null) continue;
    const roundedMidi = Math.round(frame.midi);
    const contiguous = previous && frame.time <= previous.end + frameSeconds * 2.1;
    const samePitch = previous && roundedMidi === previous.midi;
    if (contiguous && samePitch) {
      previous.end = frame.time + frameSeconds / 2;
      previous.confidence.push(frame.confidence);
      previous.cents.push((frame.midi - roundedMidi) * 100);
    } else {
      events.push({ midi: roundedMidi, start: Math.max(0, frame.time - frameSeconds / 2), end: frame.time + frameSeconds / 2, confidence: [frame.confidence], cents: [(frame.midi - roundedMidi) * 100] });
    }
  }

  // Join tiny dropouts and reject clicks/breath noise. A real pitch change is
  // preserved even when the next note begins immediately.
  const joined: typeof events = [];
  for (const event of events) {
    const previous = joined.at(-1);
    if (previous && previous.midi === event.midi && event.start - previous.end <= frameSeconds * 3.2) {
      previous.end = event.end;
      previous.confidence.push(...event.confidence);
      previous.cents.push(...event.cents);
    } else joined.push({ ...event, confidence: [...event.confidence], cents: [...event.cents] });
  }

  const timelineOffset = Math.max(0, options.timelineOffset ?? 0);
  const accepted = joined.filter(event => event.end - event.start >= minDuration && average(event.confidence) >= minConfidence);
  const notes = accepted.map(event => ({
      id: `vocal-${crypto.randomUUID()}`,
      part: options.part,
      midi: event.midi,
      start: round(timelineOffset + event.start),
      end: round(timelineOffset + event.end),
      lyric: '',
      velocity: 100,
    }));
  const acceptedFrames = smoothed.filter((frame): frame is PitchFrame & { midi: number } => frame.midi !== null);
  return {
    notes,
    diagnostics: {
      durationSeconds: buffer.duration,
      analyzedFrames: frames.length,
      voicedFrames: acceptedFrames.length,
      rejectedOutOfRangeFrames,
      averageConfidence: average(accepted.flatMap(event => event.confidence)),
      averagePitchDriftCents: average(accepted.flatMap(event => event.cents.map(value => Math.abs(value)))),
      lowestMidi: notes.length ? Math.min(...notes.map(note => note.midi)) : null,
      highestMidi: notes.length ? Math.max(...notes.map(note => note.midi)) : null,
    },
  };
}

function monoSamples(buffer: AudioBuffer) {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    for (let index = 0; index < mono.length; index += 1) mono[index] += input[index] / buffer.numberOfChannels;
  }
  return mono;
}

function medianSmooth(frames: PitchFrame[]) {
  return frames.map((frame, index) => {
    if (frame.midi === null) return frame;
    const neighbours = frames.slice(Math.max(0, index - 2), index + 3).map(item => item.midi).filter((midi): midi is number => midi !== null).sort((a, b) => a - b);
    if (neighbours.length < 2) return frame;
    return { ...frame, midi: median(neighbours) };
  });
}

function autocorrelate(input: Float32Array, sampleRate: number, minHz: number, maxHz: number) {
  let rms = 0;
  let mean = 0;
  for (let index = 0; index < input.length; index += 1) mean += input[index];
  mean /= input.length;
  for (let index = 0; index < input.length; index += 1) { const value = input[index] - mean; rms += value * value; }
  rms = Math.sqrt(rms / input.length);
  if (rms < .008) return { hz: 0, confidence: 0 };

  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(input.length - 2, Math.ceil(sampleRate / minHz));
  const correlations = new Float32Array(maxLag + 2);
  let bestLag = -1;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let numerator = 0;
    let left = 0;
    let right = 0;
    for (let index = 0; index < input.length - lag; index += 1) {
      const a = input[index] - mean;
      const b = input[index + lag] - mean;
      numerator += a * b;
      left += a * a;
      right += b * b;
    }
    const correlation = numerator / Math.max(1e-9, Math.sqrt(left * right));
    correlations[lag] = correlation;
    if (correlation > best) { best = correlation; bestLag = lag; }
  }
  if (bestLag < 0 || best < .55) return { hz: 0, confidence: 0 };

  const threshold = Math.max(.64, best * .9);
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    if (correlations[lag] >= threshold && correlations[lag] >= correlations[lag - 1] && correlations[lag] > correlations[lag + 1]) {
      bestLag = lag;
      best = correlations[lag];
      break;
    }
  }
  const y0 = correlations[Math.max(minLag, bestLag - 1)];
  const y1 = correlations[bestLag];
  const y2 = correlations[Math.min(maxLag, bestLag + 1)];
  const denominator = 2 * (2 * y1 - y2 - y0);
  const refinedLag = Math.abs(denominator) < 1e-9 ? bestLag : bestLag + (y2 - y0) / denominator;
  return { hz: sampleRate / refinedLag, confidence: Math.max(0, Math.min(1, best)) };
}

function midiToHz(midi: number) { return 440 * 2 ** ((midi - 69) / 12); }
function hzToMidi(hz: number) { return 69 + 12 * Math.log2(hz / 440); }
function nearestPowerOfTwo(value: number) { return 2 ** Math.round(Math.log2(Math.max(256, value))); }
function average(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function median(values: number[]) { const middle = Math.floor(values.length / 2); return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2; }
function round(value: number) { return Math.round(value * 10000) / 10000; }
function yieldToBrowser() { return new Promise<void>(resolve => setTimeout(resolve, 0)); }
