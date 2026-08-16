'use client';

// Round-trip audio latency, measured and remembered per device.
//
// WHY: the singer hears the backing track late (output buffering, and 150-300 ms
// more over Bluetooth) and their voice reaches the analyser late again (input
// buffering). Both push the note they sang perfectly on the beat into the game's
// clock as if it were late. With an onset window of a third of a second, a pair
// of wireless earbuds can make a singer structurally incapable of scoring well
// however accurately they sing.
//
// HOW: play a steady count-in and ask for a clap on each beat. Clicks are
// scheduled on the AudioContext clock and claps are timestamped on that same
// clock, so there is no second clock to disagree. The median offset between
// them is the round trip.
//
// An acoustic loopback -- play a click, hear that same click back -- would need
// no human timing at all, but it can only work through a speaker. Anyone
// wearing the headphones we recommend would measure a path they will not be
// using. Clapping is the method that measures the real one.

export interface LatencyResult {
  /** Median round-trip delay, in seconds. */
  latencySec: number;
  /** Spread between the fastest and slowest clap, in milliseconds. */
  spreadMs: number;
  /** One offset per beat that produced a usable clap, in seconds. */
  offsets: number[];
  /** How many beats were sounded. */
  beats: number;
}

export const LATENCY_KEY = 'vh_latency_ms';

/** A clap this far apart from the rest is a stray noise, not a beat. */
const SPREAD_LIMIT_MS = 90;
/** Beyond this, a "clap" belongs to a different beat or to the room. */
const MATCH_BEFORE = 0.15;
const MATCH_AFTER  = 0.60;
/** Latency outside this range is not a measurement, it is a mistake. */
const MIN_SEC = 0;
const MAX_SEC = 0.6;

// ── Storage ────────────────────────────────────────────────────────────────

export function storedLatencySec(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = Number(window.localStorage.getItem(LATENCY_KEY));
    if (!Number.isFinite(raw)) return 0;
    return clampLatency(raw / 1000);
  } catch {
    return 0;   // private browsing
  }
}

export function rememberLatencySec(seconds: number): void {
  try { window.localStorage.setItem(LATENCY_KEY, String(Math.round(clampLatency(seconds) * 1000))); } catch { /* private browsing */ }
}

export function forgetLatency(): void {
  try { window.localStorage.removeItem(LATENCY_KEY); } catch { /* private browsing */ }
}

export function clampLatency(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.min(MAX_SEC, Math.max(MIN_SEC, seconds));
}

// ── The maths, kept pure so it can be tested without a microphone ──────────

/**
 * Match each click to the clap that answers it. Where a click is heard twice --
 * a speaker's own sound bleeding into the microphone, then the clap -- the
 * later one is the clap, and it is the clap we are timing.
 */
export function offsetsFor(clickTimes: number[], onsetTimes: number[]): number[] {
  const offsets: number[] = [];
  for (const click of clickTimes) {
    const answering = onsetTimes.filter(onset => onset >= click - MATCH_BEFORE && onset <= click + MATCH_AFTER);
    if (!answering.length) continue;
    offsets.push(answering[answering.length - 1] - click);
  }
  return offsets;
}

/** Median rather than mean: one late clap should not drag the answer with it. */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarise(offsets: number[], beats: number): LatencyResult {
  const usable = offsets.filter(offset => offset >= -MATCH_BEFORE && offset <= MATCH_AFTER);
  const latencySec = clampLatency(median(usable));
  const spreadMs = usable.length > 1 ? (Math.max(...usable) - Math.min(...usable)) * 1000 : 0;
  return { latencySec, spreadMs, offsets: usable, beats };
}

/** Enough claps, and consistent enough, to be worth trusting. */
export function isReliable(result: LatencyResult): boolean {
  return result.offsets.length >= 3 && result.spreadMs <= SPREAD_LIMIT_MS;
}

// ── Measurement ────────────────────────────────────────────────────────────

export interface MeasureOptions {
  beats?: number;
  intervalSec?: number;
  /** Called with 1-based beat numbers as they sound, for the countdown. */
  onBeat?: (beat: number) => void;
  signal?: AbortSignal;
}

/**
 * Sound a count-in and listen for a clap on each beat.
 * The first beat is sounded but never counted — nobody is ready for it.
 */
export async function measureLatency(options: MeasureOptions = {}): Promise<LatencyResult> {
  const beats = options.beats ?? 6;
  const interval = options.intervalSec ?? 1;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // Every one of these would fight the measurement: echo cancellation
      // exists precisely to remove a speaker's sound from the microphone, and
      // that sound is half of what we are timing.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });

  const context = new AudioContext({ latencyHint: 'interactive' });
  try {
    // Autoplay policy: a context created outside a user gesture starts
    // suspended, and a suspended context sounds nothing at all.
    if (context.state === 'suspended') await context.resume();

    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    context.createMediaStreamSource(stream).connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);

    const firstBeat = context.currentTime + 1.2;
    const clickTimes: number[] = [];
    for (let beat = 0; beat < beats; beat++) {
      const at = firstBeat + beat * interval;
      clickTimes.push(at);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = beat === 0 ? 1320 : 880;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.5, at + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.08);
      if (options.onBeat) {
        const delayMs = Math.max(0, (at - context.currentTime) * 1000);
        window.setTimeout(() => options.onBeat!(beat + 1), delayMs);
      }
    }

    const onsets = await listenForOnsets(
      context, analyser, buffer,
      firstBeat - MATCH_BEFORE,
      clickTimes[clickTimes.length - 1] + MATCH_AFTER,
      options.signal,
    );

    // The first beat only tells the singer where the pulse is.
    return summarise(offsetsFor(clickTimes.slice(1), onsets), beats - 1);
  } finally {
    stream.getTracks().forEach(track => track.stop());
    await context.close().catch(() => undefined);
  }
}

/**
 * Timestamp the sharp rises in loudness. A clap is a step change against the
 * moment before it, which is a far steadier test across rooms and microphone
 * gains than any fixed volume threshold.
 */
function listenForOnsets(
  context: AudioContext,
  analyser: AnalyserNode,
  buffer: Float32Array,
  fromTime: number,
  untilTime: number,
  signal?: AbortSignal,
): Promise<number[]> {
  return new Promise(resolve => {
    const onsets: number[] = [];
    let baseline = 0;
    let lastOnset = -1;
    let frame = 0;

    const step = () => {
      if (signal?.aborted) { cancelAnimationFrame(frame); resolve(onsets); return; }
      const now = context.currentTime;
      if (now >= untilTime) { cancelAnimationFrame(frame); resolve(onsets); return; }

      analyser.getFloatTimeDomainData(buffer as Float32Array<ArrayBuffer>);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
      const level = Math.sqrt(sum / buffer.length);

      const loudEnough = level > 0.02;
      const stepChange = level > baseline * 3;
      const settled = now - lastOnset > 0.25;   // one clap, not its own echo
      if (now >= fromTime && loudEnough && stepChange && settled) {
        onsets.push(now);
        lastOnset = now;
      }
      // Track quickly upward and slowly downward, so the tail of one clap does
      // not raise the bar for the next.
      baseline = level > baseline ? level * 0.5 + baseline * 0.5 : baseline * 0.92 + level * 0.08;

      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  });
}
