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

/** Why the microphone could not be opened. "blocked" is the only one a singer
 *  can fix by changing their mind; the rest need a different window, a
 *  different URL, or another app closed, and telling someone to "allow the
 *  microphone" when the API is not even present sends them hunting through
 *  settings that will never contain the answer. */
export type MicFailure = 'blocked' | 'insecure' | 'unsupported' | 'notfound' | 'busy' | 'unknown';

export class MicError extends Error {
  constructor(readonly reason: MicFailure, message: string) { super(message); this.name = 'MicError'; }
}

/** Turn whatever getUserMedia rejected with into one of the reasons above.
 *  The DOMException names are the standard ones; browsers differ in which they
 *  choose, so several map onto the same outcome. */
function classify(cause: unknown): MicError {
  const name = (cause as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError': case 'SecurityError': case 'PermissionDeniedError':
      return new MicError('blocked', 'Microphone permission was refused for this window.');
    case 'NotFoundError': case 'DevicesNotFoundError': case 'OverconstrainedError':
      return new MicError('notfound', 'No microphone was offered by this device.');
    case 'NotReadableError': case 'TrackStartError': case 'AbortError':
      return new MicError('busy', 'The microphone is held by another app.');
    default:
      return new MicError('unknown', (cause as Error | null)?.message || 'The microphone could not be opened.');
  }
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
  /** Loudness of the last frame, 0-1. Exposed so a caller can show that sound
   *  is arriving even when no pitch has locked -- without it, a dead input and
   *  a singer resting look identical. */
  private lastLevel = 0;
  /** A silent tap to the destination. See the note where it is built. */
  private sink: GainNode | null = null;
  /** Some devices deliver nothing at all with voice processing switched off. */
  private relaxed = false;
  private silentFrames = 0;
  private recovering = false;

  // Scratch space for the analysis, allocated once. The detector runs on every
  // animation frame; allocating these per frame handed the garbage collector a
  // steady drip of work on the one thread that has to stay smooth.
  private coarse:      Float32Array | null = null;  // decimated signal
  private coarseSq:    Float64Array | null = null;  // prefix sums of squares
  private fullSq:      Float64Array | null = null;
  private coarseCorr:  Float32Array | null = null;
  private fineCorr:    Float32Array | null = null;  // full-rate refinement window
  private decimation = 1;

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

  async start(relaxed = false): Promise<void> {
    if (this.context) return; // already running
    this.relaxed = relaxed;

    // Voice processing can buffer a phone microphone by hundreds of
    // milliseconds, which is counterproductive for an on-beat pitch game -- so
    // it is asked for off. But some devices hand back a silent or unusable
    // stream when all of it is disabled, and a game that hears nothing is worse
    // than one that hears late. `relaxed` is the fallback the loop falls back
    // to, letting the browser choose.
    // Reaching straight through `navigator.mediaDevices` is how this used to
    // read, and on a phone that is where it fell over rather than where it
    // reported a problem. The object is ABSENT -- not empty, absent -- in an
    // insecure context and in some installed app shells, so the old line threw
    // a TypeError about reading a property of undefined. That was caught by the
    // caller's bare `catch` and shown as "microphone blocked", sending the
    // singer to a permission screen where everything already said Allow.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      throw new MicError('insecure', 'Microphones are only available over HTTPS.');
    }
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new MicError('unsupported', 'This window offers no microphone API. Open the app in the browser instead.');
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: relaxed ? true : {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl:  false,
          channelCount: 1,
        },
      });
    } catch (cause) {
      throw classify(cause);
    }

    this.context  = new AudioContext({ latencyHint: 'interactive' });

    // A context created AFTER an await is no longer inside the user gesture that
    // began this call, and mobile browsers start such a context suspended. A
    // suspended context's AnalyserNode returns pure silence, so the microphone
    // light is on, getUserMedia has succeeded, the stream is live -- and every
    // frame reads zero. Desktop is lenient about the same policy, which is why
    // this only ever showed up on phones.
    if (this.context.state === 'suspended') {
      try { await this.context.resume(); } catch { /* surfaced through isSuspended */ }
    }
    // Mobile also suspends a context whenever the page goes to the background,
    // and does not resume it on return.
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize        = this.opts.bufferSize;
    this.analyser.smoothingTimeConstant = 0; // we do our own smoothing

    this.source = this.context.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);

    // An analyser alone is a dead end: several mobile browsers do not PULL
    // audio through a graph with no path to the destination, so the analyser
    // reads silence for ever while the microphone light stays on and the stream
    // is live. Desktop pulls it regardless, which is why this only ever showed
    // up on phones. The gain is zero, so nothing is heard -- the connection
    // exists solely to make the graph run.
    this.sink = this.context.createGain();
    this.sink.gain.value = 0;
    this.analyser.connect(this.sink);
    this.sink.connect(this.context.destination);

    this.buffer    = new Float32Array(this.opts.bufferSize) as Float32Array<ArrayBuffer>;
    this.startTime = this.context.currentTime;
    this.allocate(this.context.sampleRate);

    this.loop();
  }

  /** Size the analysis scratch space for this device's sample rate. */
  private allocate(sampleRate: number): void {
    const size = this.opts.bufferSize;
    // Decimate for the coarse pass only as far as the highest note in the lane
    // still leaves a well-shaped period to find a peak in. Twelve samples per
    // cycle: at eight, a 370 Hz note on a 22 kHz device came out an octave low,
    // because box-averaging that hard smears the waveform until the peak at
    // double the period looks like the better match. A lane's own range decides
    // this, so a bass lane — which costs the most, its long periods meaning the
    // most lags to search — still decimates hardest.
    this.decimation = Math.max(1, Math.min(8, Math.floor(sampleRate / (12 * this.opts.maxHz))));
    const coarseSize = Math.floor(size / this.decimation);
    this.coarse     = new Float32Array(coarseSize);
    this.coarseSq   = new Float64Array(coarseSize + 1);
    this.fullSq     = new Float64Array(size + 1);
    this.coarseCorr = new Float32Array(coarseSize + 2);
    this.fineCorr   = new Float32Array(2 * this.decimation + 4);
  }

  /** Wake a context the browser suspended. Safe to call from a tap. */
  async resume(): Promise<void> {
    if (this.context?.state === 'suspended') {
      try { await this.context.resume(); } catch { /* nothing more to try */ }
    }
  }

  /** True when audio is being BLOCKED rather than merely quiet. */
  get isSuspended(): boolean {
    return this.context?.state === 'suspended';
  }

  /** True once the strict constraints were abandoned for the browser's own. */
  get usingFallbackInput(): boolean {
    return this.relaxed;
  }

  /**
   * Start again, letting the browser pick its own capture settings.
   *
   * Called automatically when a running context delivers nothing but silence,
   * because on the devices where that happens the singer has no way to know and
   * nothing they can do about it.
   */
  private async recover(): Promise<void> {
    if (this.recovering || this.relaxed) return;
    this.recovering = true;
    const onPitch = this.opts.onPitch;
    this.stop();
    try { await this.start(true); } catch { /* nothing further to try */ }
    void onPitch;
    this.recovering = false;
  }

  /** Loudness of the most recent frame, 0-1. */
  get level(): number {
    return this.lastLevel;
  }

  /** What rate this device actually gave us. Phones vary, and the analysis
   *  is sized from it, so it is worth being able to see. */
  get sampleRate(): number {
    return this.context?.sampleRate ?? 0;
  }

  private onVisibility = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') void this.resume();
  };

  stop(): void {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.animFrame !== null) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    this.source?.disconnect();
    this.sink?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    this.context?.close();
    this.context  = null;
    this.analyser = null;
    this.source   = null;
    this.sink     = null;
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
      this.smoothedHz = PitchEngine.smoothStep(this.smoothedHz, hz, this.opts.smoothing);
    } else {
      // Decay smoothly toward silence
      this.smoothedHz = this.smoothedHz * 0.7;
      if (this.smoothedHz < this.opts.minHz) this.smoothedHz = 0;
    }

    // A context that is running and yet delivers pure digital silence for a
    // second and a half is not a quiet singer; it is a capture path this device
    // will not honour. Try once with the browser's own settings.
    if (this.lastLevel < 0.00005) {
      if (++this.silentFrames === 90 && !this.relaxed && !this.recovering) void this.recover();
    } else this.silentFrames = 0;

    this.opts.onPitch({
      frequency:  this.smoothedHz,
      timestamp:  this.context.currentTime - this.startTime,
      confidence: hz > 0 ? confidence : 0,
      level:      this.lastLevel,
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
    if (!this.coarse || !this.coarseSq || !this.fullSq || !this.coarseCorr) this.allocate(sampleRate);
    const coarse = this.coarse!, coarseSq = this.coarseSq!, fullSq = this.fullSq!, corr = this.coarseCorr!;

    // Lag bounds that correspond to our Hz range
    const minLag = Math.max(1, Math.floor(sampleRate / maxHz));
    const maxLag = Math.min(Math.ceil(sampleRate / minHz), SIZE - 1);
    if (minLag >= maxLag) return { hz: 0, confidence: 0 };

    // RMS gate — reject silence. The prefix sums of squares are built in the
    // same pass, since they are the same numbers added up.
    fullSq[0] = 0;
    for (let i = 0; i < SIZE; i++) fullSq[i + 1] = fullSq[i] + buf[i] * buf[i];
    const rms = Math.sqrt(fullSq[SIZE] / SIZE);
    this.lastLevel = rms;
    // A floor against a dead line, nothing more. It used to sit at 0.01, which
    // measured out as a cliff: detection was exact to the cent down to 0.0103
    // and returned NOTHING below it. A phone held at arm's length with automatic
    // gain switched off -- which this engine asks for, to keep the latency down
    // -- delivers less than that from a singer who is not shouting, and every
    // one of those frames was thrown away as if it were silence.
    //
    // Nothing is lost by lowering it, because the RMS gate was never what
    // rejected noise: pure noise is refused by the correlation floor below at
    // every level, right up to an RMS of 0.116. This only has to reject a
    // disconnected microphone.
    if (rms < 0.002) return { hz: 0, confidence: 0 };

    // The normalised autocorrelation is
    //   r[lag] = Σ buf[i]·buf[i+lag] / sqrt( Σ buf[i]² · Σ buf[i+lag]² )
    // and the two sums in the denominator are just windows of the prefix sums
    // above — O(1) each instead of a second and third pass over the buffer.
    // Only the dot product genuinely needs the inner loop.
    //
    // Even so, searching every lag at the full sample rate is what made this
    // cost 2–3 ms a frame, i.e. more than a phone can spare 60 times a second.
    // So the search runs twice: a coarse pass over a decimated copy to find
    // WHICH period we are on, then a handful of full-rate lags around it to
    // find it exactly. Coarse costs work/decimation², and the refinement keeps
    // full pitch resolution, so the accuracy the singer sees is unchanged.

    const decim = this.decimation;
    const coarseSize = Math.floor(SIZE / decim);
    if (decim > 1) {
      // Box-average rather than picking every nth sample: cheap, and it keeps
      // energy above the new Nyquist from folding back as a false low pitch.
      for (let i = 0; i < coarseSize; i++) {
        let sum = 0;
        const base = i * decim;
        for (let k = 0; k < decim; k++) sum += buf[base + k];
        coarse[i] = sum / decim;
      }
    } else {
      coarse.set(buf.subarray(0, coarseSize));
    }
    coarseSq[0] = 0;
    for (let i = 0; i < coarseSize; i++) coarseSq[i + 1] = coarseSq[i] + coarse[i] * coarse[i];

    const minLagC = Math.max(1, Math.floor(minLag / decim));
    const maxLagC = Math.min(Math.ceil(maxLag / decim), coarseSize - 2);
    if (minLagC >= maxLagC) return { hz: 0, confidence: 0 };

    let bestLagC = -1;
    let bestCorrC = -1;
    for (let lag = minLagC; lag <= maxLagC; lag++) {
      const n = coarseSize - lag;
      let num = 0;
      for (let i = 0; i < n; i++) num += coarse[i] * coarse[i + lag];
      const d1 = coarseSq[n];
      const d2 = coarseSq[n + lag] - coarseSq[lag];
      const denom = Math.sqrt(d1 * d2);
      const value = denom > 0 ? num / denom : 0;
      corr[lag] = value;
      if (value > bestCorrC) { bestCorrC = value; bestLagC = lag; }
    }

    if (bestLagC < 1 || bestCorrC < 0) return { hz: 0, confidence: 0 };

    // The largest correlation is often a second/third multiple of the true
    // period. Prefer the first strong local peak so a singer is not reported
    // one or two octaves too low. The relative threshold still tolerates
    // breathy voices whose fundamental is weaker than an overtone.
    // The scan starts AT the shortest lag, not one past it. The highest note a
    // lane accepts has its true period sitting on that very first lag, and
    // skipping it meant the scan could only find the peak at double the
    // period — reporting the top of a soprano's range an octave low. The old
    // full-rate grid was fine enough that the true peak landed past its own
    // first lag, so it escaped this by resolution rather than by design.
    const strongPeak = Math.max(0.72, bestCorrC * 0.9);
    for (let lag = minLagC; lag < maxLagC; lag++) {
      const left = lag > minLagC ? corr[lag - 1] : -1;
      if (corr[lag] >= strongPeak && corr[lag] >= left && corr[lag] > corr[lag + 1]) {
        bestLagC = lag;
        bestCorrC = corr[lag];
        break;
      }
    }

    // Refine at the full sample rate. The window is one coarse step either
    // side, which is exactly the uncertainty the decimation introduced, plus
    // one lag of margin so the parabolic fit below has real neighbours rather
    // than the edge of the search.
    const centre = bestLagC * decim;
    const lo = Math.max(minLag, centre - decim - 1);
    const hi = Math.min(maxLag, centre + decim + 1);

    const fine = this.fineCorr!;
    let bestLag = -1;
    let bestCorr = -1;
    for (let lag = lo; lag <= hi; lag++) {
      const n = SIZE - lag;
      let num = 0;
      for (let i = 0; i < n; i++) num += buf[i] * buf[i + lag];
      const d1 = fullSq[n];
      const d2 = fullSq[n + lag] - fullSq[lag];
      const denom = Math.sqrt(d1 * d2);
      const value = denom > 0 ? num / denom : 0;
      fine[lag - lo] = value;
      if (value > bestCorr) { bestCorr = value; bestLag = lag; }
    }

    // A voiced frame correlates with itself strongly — every genuine case
    // measured, including breathy and noisy ones, sits above 0.99. A weak best
    // match means there is no period here to find, typically a voice singing
    // outside the lane whose harmonics scatter a low peak across the range.
    // Reporting that as a pitch is worse than reporting nothing. The floor sits
    // well below the thresholds callers apply, so it cannot suppress a reading
    // they would have used.
    if (bestLag < 1 || bestCorr < 0.5) return { hz: 0, confidence: 0 };

    // Sub-sample refinement. Both neighbours have to be real measurements: at
    // the edge of the window the old code passed the peak value itself, which
    // quietly biased the interpolation toward the edge.
    const index = bestLag - lo;
    const refined = (bestLag > lo && bestLag < hi)
      ? parabolicPeak(fine[index - 1], bestCorr, fine[index + 1], bestLag)
      : bestLag;

    // Half a semitone of slack at each end. The bound is a search limit, not a
    // musical judgement: a note sitting exactly on the lane's top edge lands a
    // hair outside it once interpolated, and rejecting that made the highest
    // note a lane accepts disappear rather than register.
    const hz = sampleRate / refined;
    if (hz < minHz / 1.03 || hz > maxHz * 1.03) return { hz: 0, confidence: 0 };

    return { hz, confidence: Math.max(0, Math.min(1, bestCorr)) };
  }

  // ── Static helpers ────────────────────────────────────────────────────────

  /** A deliberate leap rather than wobble within a note. Vibrato and the small
   * scoops around a sustained pitch stay well inside a whole tone; a minor third
   * in one frame is a singer moving to a different note. */
  static readonly LEAP_CENTS = 250;

  /**
   * One step of the pitch smoother.
   *
   * Two things the old averaging got wrong, both of which cost the singer marks
   * rather than merely looking odd:
   *
   * Averaging in HERTZ is not averaging in pitch. Hz is exponential in pitch, so
   * the same filter settles faster falling than rising -- an ascending phrase
   * was reported flat for longer than a descending one was reported sharp, and
   * every reading in between sat at the wrong musical distance. Averaging the
   * LOG of the frequency makes a semitone a semitone in either direction.
   *
   * And a smoother has no business smoothing a LEAP. Gliding from one note to
   * the next drew a portamento nobody sang, and worse, delayed arrival at the
   * new note by several frames -- landing after the onset window had opened, so
   * a clean entry scored as a late one. A jump beyond a whole tone is taken at
   * once; only movement small enough to be wobble is filtered.
   */
  static smoothStep(previousHz: number, hz: number, smoothing: number): number {
    if (hz <= 0) return 0;
    if (previousHz <= 0) return hz;
    const cents = 1200 * Math.log2(hz / previousHz);
    if (Math.abs(cents) >= PitchEngine.LEAP_CENTS) return hz;
    const factor = Math.min(Math.max(1 - smoothing, 0), 1);
    return previousHz * Math.pow(2, (cents * factor) / 1200);
  }

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

  /** What kind of window this is, and what the microphone is allowed to do in
   *  it. An installed PWA is a SEPARATE permission scope from the browser that
   *  installed it: granting the microphone in Chrome grants nothing to the app
   *  on the home screen, and a singer who has already said yes once will
   *  reasonably insist the permission is on. This is what tells the two apart.
   *
   *  `permission` is best-effort -- Safari does not implement the microphone
   *  permission name and rejects the query, which is itself worth reporting. */
  static async environment(): Promise<{
    secure: boolean; hasMediaDevices: boolean; standalone: boolean; permission: string;
  }> {
    const standalone = typeof window !== 'undefined'
      && (window.matchMedia?.('(display-mode: standalone)').matches === true
        || window.matchMedia?.('(display-mode: fullscreen)').matches === true
        // iOS home-screen web clips predate display-mode and report this instead.
        || (navigator as unknown as { standalone?: boolean }).standalone === true);
    let permission = 'unknown';
    try {
      const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
      if (status) permission = status.state;
    } catch { permission = 'unsupported'; }
    return {
      secure: typeof window === 'undefined' || window.isSecureContext,
      hasMediaDevices: Boolean(navigator?.mediaDevices?.getUserMedia),
      standalone,
      permission,
    };
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
