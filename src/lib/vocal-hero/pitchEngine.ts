'use client';

// Real-time pitch detection via Web Audio API + autocorrelation.
// Runs in the browser only — never import this on the server.

import type { PitchSample } from './types';

export interface PitchEngineOptions {
  onPitch: (sample: PitchSample) => void;
  /** Size of the FFT / analysis buffer. Must be power of 2. Default: 2048 */
  bufferSize?: number;
  /** Exponential smoothing factor 0–1. Higher = smoother but laggier. Default: 0.8 */
  smoothing?: number;
  /** Minimum confidence 0–1 to emit a non-zero pitch. Default: 0.85 */
  confidenceThreshold?: number;
  /** Minimum frequency to consider (Hz). Default: 70 */
  minHz?: number;
  /** Maximum frequency to consider (Hz). Default: 1100 */
  maxHz?: number;
}

export class PitchEngine {
  private context:  AudioContext | null = null;
  private analyser: AnalyserNode  | null = null;
  private source:   MediaStreamAudioSourceNode | null = null;
  private stream:   MediaStream   | null = null;
  private animFrame: number | null = null;
  private buffer:   Float32Array<ArrayBuffer> | null = null;
  private smoothedHz = 0;
  private startTime  = 0;

  private readonly opts: Required<PitchEngineOptions>;

  constructor(options: PitchEngineOptions) {
    this.opts = {
      bufferSize:          2048,
      smoothing:           0.55,
      confidenceThreshold: 0.85,
      minHz:               70,
      maxHz:               1100,
      ...options,
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.context) return; // already running

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Voice processing can buffer a phone microphone by hundreds of
        // milliseconds. It is counterproductive for an on-beat pitch game.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl:  false,
        channelCount: 1,
      },
    });

    this.context  = new AudioContext({ latencyHint: 'interactive' });
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize        = this.opts.bufferSize;
    this.analyser.smoothingTimeConstant = 0; // we do our own smoothing

    this.source = this.context.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);

    this.buffer    = new Float32Array(this.opts.bufferSize) as Float32Array<ArrayBuffer>;
    this.startTime = this.context.currentTime;

    this.loop();
  }

  stop(): void {
    if (this.animFrame !== null) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    this.source?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    this.context?.close();
    this.context  = null;
    this.analyser = null;
    this.source   = null;
    this.stream   = null;
    this.buffer   = null;
    this.smoothedHz = 0;
  }

  get isRunning(): boolean {
    return this.context !== null;
  }

  // ── Analysis loop ─────────────────────────────────────────────────────────

  private loop = (): void => {
    if (!this.analyser || !this.buffer || !this.context) return;

    this.analyser.getFloatTimeDomainData(this.buffer);

    const { hz, confidence } = this.autocorrelate(this.buffer, this.context.sampleRate);

    // Exponential smoothing — only smooth non-zero pitches
    if (hz > 0 && confidence >= this.opts.confidenceThreshold) {
      this.smoothedHz =
        this.smoothedHz === 0
          ? hz
          : this.opts.smoothing * this.smoothedHz + (1 - this.opts.smoothing) * hz;
    } else {
      // Decay smoothly toward silence
      this.smoothedHz = this.smoothedHz * 0.7;
      if (this.smoothedHz < this.opts.minHz) this.smoothedHz = 0;
    }

    this.opts.onPitch({
      frequency:  this.smoothedHz,
      timestamp:  this.context.currentTime - this.startTime,
      confidence: hz > 0 ? confidence : 0,
    });

    this.animFrame = requestAnimationFrame(this.loop);
  };

  // ── Autocorrelation pitch detection ───────────────────────────────────────
  //
  // Classic normalized autocorrelation (NSDF-lite).
  // Returns { hz, confidence } where confidence is 0–1.
  //
  // Reference: Philip McLeod & Geoff Wyvill "A smarter way to find pitch" (2005)

  private autocorrelate(
    buf: Float32Array<ArrayBuffer>,
    sampleRate: number
  ): { hz: number; confidence: number } {

    const SIZE = buf.length;
    const { minHz, maxHz } = this.opts;

    // Lag bounds that correspond to our Hz range
    const minLag = Math.floor(sampleRate / maxHz);
    const maxLag = Math.ceil(sampleRate / minHz);

    // RMS gate — reject silence
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return { hz: 0, confidence: 0 };

    // Compute normalized autocorrelation for each lag
    // r[lag] = Σ buf[i] * buf[i+lag]  /  sqrt( Σ buf[i]² · Σ buf[i+lag]² )

    let bestLag = -1;
    let bestCorr = -1;
    const correlations = new Float32Array(Math.min(maxLag + 2, SIZE));

    for (let lag = minLag; lag <= maxLag && lag < SIZE; lag++) {
      let num = 0, d1 = 0, d2 = 0;
      const n = SIZE - lag;
      for (let i = 0; i < n; i++) {
        num += buf[i] * buf[i + lag];
        d1  += buf[i] * buf[i];
        d2  += buf[i + lag] * buf[i + lag];
      }
      const denom = Math.sqrt(d1 * d2);
      const corr  = denom > 0 ? num / denom : 0;
      correlations[lag] = corr;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag  = lag;
      }
    }

    if (bestLag < 1 || bestCorr < 0) return { hz: 0, confidence: 0 };

    // The largest correlation is often a second/third multiple of the true
    // period. Prefer the first strong local peak so a singer is not reported
    // one or two octaves too low. The relative threshold still tolerates
    // breathy voices whose fundamental is weaker than an overtone.
    const strongPeak = Math.max(0.72, bestCorr * 0.9);
    for (let lag = minLag + 1; lag < Math.min(maxLag, correlations.length - 1); lag++) {
      if (correlations[lag] >= strongPeak && correlations[lag] >= correlations[lag - 1] && correlations[lag] > correlations[lag + 1]) {
        bestLag = lag;
        bestCorr = correlations[lag];
        break;
      }
    }

    // Sub-sample refinement via parabolic interpolation around best lag
    const refined = parabolicPeak(
      bestLag > 0              ? correlations[bestLag - 1] : bestCorr,
      bestCorr,
      bestLag < correlations.length - 1 ? correlations[bestLag + 1] : bestCorr,
      bestLag,
    );

    const hz = sampleRate / refined;
    if (hz < minHz || hz > maxHz) return { hz: 0, confidence: 0 };

    return { hz, confidence: Math.max(0, Math.min(1, bestCorr)) };
  }

  // Compute autocorrelation at a single lag (used for interpolation)
  private corrAt(buf: Float32Array<ArrayBuffer>, lag: number): number {
    const n = buf.length - lag;
    if (n <= 0) return 0;
    let num = 0, d1 = 0, d2 = 0;
    for (let i = 0; i < n; i++) {
      num += buf[i] * buf[i + lag];
      d1  += buf[i] * buf[i];
      d2  += buf[i + lag] * buf[i + lag];
    }
    const denom = Math.sqrt(d1 * d2);
    return denom > 0 ? num / denom : 0;
  }

  // ── Static helpers ────────────────────────────────────────────────────────

  /**
   * Map a raw Hz frequency to a normalised 0–1 log scale matching the
   * SatbPart.curve values produced by the Python pipeline.
   *
   *   norm = log2(hz / minHz) / log2(maxHz / minHz)
   */
  static normalise(hz: number, rangeMin = 80, rangeMax = 1050): number {
    if (hz <= 0 || hz < rangeMin) return 0;
    const clamped = Math.min(hz, rangeMax);
    return Math.log2(clamped / rangeMin) / Math.log2(rangeMax / rangeMin);
  }

  /**
   * Convert a normalised 0–1 value back to Hz.
   */
  static denormalise(norm: number, rangeMin = 80, rangeMax = 1050): number {
    if (norm <= 0) return 0;
    return rangeMin * Math.pow(rangeMax / rangeMin, Math.min(norm, 1));
  }

  /**
   * Convert Hz to the nearest musical note name (e.g. "A4", "C#3").
   */
  static toNoteName(hz: number): string {
    if (hz <= 0) return '–';
    const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const midi = Math.round(12 * Math.log2(hz / 440) + 69);
    const note = noteNames[((midi % 12) + 12) % 12];
    const octave = Math.floor(midi / 12) - 1;
    return `${note}${octave}`;
  }

  /**
   * Distance in cents between two frequencies.
   * Positive = playerHz is sharp, negative = flat.
   */
  static centsDiff(playerHz: number, targetHz: number): number {
    if (playerHz <= 0 || targetHz <= 0) return 0;
    return 1200 * Math.log2(playerHz / targetHz);
  }

  static midiToHz(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /** Correct the common octave-harmonic error without changing the detected
   * pitch class. This is target-aware and therefore only used while a target
   * note is active, never for the raw microphone readout at rest.
   *
   * The search is deliberately one octave wide. It exists to forgive the
   * DETECTOR, which mistakes a harmonic for the fundamental by exactly one
   * octave — not to forgive the singer. At the ±3 it used to search, someone
   * singing two octaves away from the written line scored a flawless note.
   * What the remaining ±1 absorbs is reported through octaveShift(), so a
   * caller can say "right note, wrong octave" instead of silently calling it
   * perfect. */
  static alignOctaveToTarget(hz: number, targetMidi: number, maxOctaves = 1): number {
    if (hz <= 0) return 0;
    const rawMidi = 12 * Math.log2(hz / 440) + 69;
    let alignedMidi = rawMidi;
    let distance = Math.abs(rawMidi - targetMidi);
    for (let octaves = -maxOctaves; octaves <= maxOctaves; octaves++) {
      const candidate = rawMidi + octaves * 12;
      const candidateDistance = Math.abs(candidate - targetMidi);
      if (candidateDistance < distance) { alignedMidi = candidate; distance = candidateDistance; }
    }
    return PitchEngine.midiToHz(alignedMidi);
  }

  /** Whole octaves the alignment above had to move, signed: -1 means the
   * singer sounded an octave BELOW the written note. 0 means they sang in the
   * written octave. */
  static octaveShift(hz: number, targetMidi: number, maxOctaves = 1): number {
    if (hz <= 0) return 0;
    const rawMidi = 12 * Math.log2(hz / 440) + 69;
    let shift = 0;
    let distance = Math.abs(rawMidi - targetMidi);
    for (let octaves = -maxOctaves; octaves <= maxOctaves; octaves++) {
      const candidateDistance = Math.abs(rawMidi + octaves * 12 - targetMidi);
      if (candidateDistance < distance) { shift = octaves; distance = candidateDistance; }
    }
    // The alignment moved the singer UP to reach the target, so the singer was
    // that many octaves DOWN. Report it from the singer's side.
    return -shift;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Parabolic interpolation to find sub-sample peak location.
 * Given values y0 (lag-1), y1 (lag), y2 (lag+1), returns refined lag.
 */
function parabolicPeak(y0: number, y1: number, y2: number, x1: number): number {
  const denom = 2 * (2 * y1 - y2 - y0);
  if (Math.abs(denom) < 1e-10) return x1;
  return x1 + (y2 - y0) / denom;
}
