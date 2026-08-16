'use client';

import { useEffect, useRef, useState } from 'react';

// The shape of the recording, drawn under the clips at the same scale as the
// note grid. With live instruments a bar line is a guess and the waveform is
// the truth: an arranger can see where the phrase actually starts and put the
// note there, instead of trusting a grid the players never followed.

/** Peaks per second of audio. Fine enough to show an attack at high zoom,
 * coarse enough that a five-minute track stays a few hundred kilobytes. */
const PEAKS_PER_SECOND = 200;

type Peaks = { min: Float32Array; max: Float32Array; duration: number };

// Decoding is slow and the editor re-renders constantly, so a track is decoded
// once per URL for the life of the page.
const cache = new Map<string, Promise<Peaks | null>>();

async function loadPeaks(url: string): Promise<Peaks | null> {
  const existing = cache.get(url);
  if (existing) return existing;

  const pending = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const bytes = await response.arrayBuffer();
      const context = new AudioContext();
      try {
        const decoded = await context.decodeAudioData(bytes);
        const buckets = Math.max(1, Math.ceil(decoded.duration * PEAKS_PER_SECOND));
        const min = new Float32Array(buckets);
        const max = new Float32Array(buckets);
        const samplesPerBucket = decoded.length / buckets;
        // Mixing to mono by taking the extremes across channels: the point is
        // to show where sound is, not to reproduce a stereo image.
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
          const data = decoded.getChannelData(channel);
          for (let bucket = 0; bucket < buckets; bucket++) {
            const from = Math.floor(bucket * samplesPerBucket);
            const to = Math.min(data.length, Math.floor((bucket + 1) * samplesPerBucket));
            let low = channel === 0 ? 0 : min[bucket];
            let high = channel === 0 ? 0 : max[bucket];
            for (let i = from; i < to; i++) {
              const value = data[i];
              if (value < low) low = value;
              if (value > high) high = value;
            }
            min[bucket] = low;
            max[bucket] = high;
          }
        }
        return { min, max, duration: decoded.duration };
      } finally {
        await context.close().catch(() => undefined);
      }
    } catch {
      // A track hosted somewhere that refuses cross-origin reads cannot be
      // drawn. That is a missing nicety, not a broken editor, so it fails quiet.
      return null;
    }
  })();

  cache.set(url, pending);
  return pending;
}

/**
 * One clip's slice of the waveform. `sourceStart`/`sourceEnd` are positions in
 * the underlying file, so a trimmed or repeated clip draws the part of the
 * recording it actually plays.
 */
export function WaveformStrip({ url, sourceStart, sourceEnd, width, height, colour }: {
  url: string;
  sourceStart: number;
  sourceEnd: number;
  width: number;
  height: number;
  colour: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [peaks, setPeaks] = useState<Peaks | null>(null);

  useEffect(() => {
    let live = true;
    void loadPeaks(url).then(result => { if (live) setPeaks(result); });
    return () => { live = false; };
  }, [url]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || width <= 0 || height <= 0) return;
    const ratio = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    const context = canvas.getContext('2d');
    if (!context) return;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = colour;

    const middle = height / 2;
    const from = Math.max(0, sourceStart) * PEAKS_PER_SECOND;
    const span = Math.max(.001, sourceEnd - sourceStart) * PEAKS_PER_SECOND;

    for (let x = 0; x < width; x++) {
      // Every bucket under this pixel, so a transient survives being zoomed out
      // rather than being missed between samples.
      const start = Math.floor(from + (x / width) * span);
      const end = Math.max(start + 1, Math.floor(from + ((x + 1) / width) * span));
      let low = 0, high = 0;
      for (let bucket = start; bucket < end && bucket < peaks.min.length; bucket++) {
        if (peaks.min[bucket] < low) low = peaks.min[bucket];
        if (peaks.max[bucket] > high) high = peaks.max[bucket];
      }
      const top = middle - high * middle;
      const bottom = middle - low * middle;
      context.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }, [peaks, sourceStart, sourceEnd, width, height, colour]);

  if (!peaks) return null;
  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}
