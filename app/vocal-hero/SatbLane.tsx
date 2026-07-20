'use client';

import { useEffect, useRef } from 'react';
import type { SongNote } from '@/lib/vocal-hero/types';

const DEFAULT_RANGE = [36, 84];

function hzToMidi(hz: number) { return 69 + 12 * Math.log2(hz / 440); }

export function SatbLane({
  partIndex, partName, colour, elapsed, notes, pitchHz, playerCount, hitNotes = {}, compact = false,
}: {
  partIndex: number;
  partName: string;
  colour: string;
  elapsed: number;
  notes: SongNote[];
  pitchHz?: number;
  playerCount?: number;
  hitNotes?: Record<string, boolean>;
  compact?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const paint = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.clientWidth || !canvas.clientHeight) return;
    const ratio = Math.min(devicePixelRatio, 2);
    const width = canvas.width = canvas.clientWidth * ratio;
    const height = canvas.height = canvas.clientHeight * ratio;
    ctx.scale(ratio, ratio);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.fillStyle = '#08111f'; ctx.fillRect(0, 0, w, h);
    for (let i = 1; i < 6; i += 1) {
      ctx.strokeStyle = i % 2 ? '#18304a' : '#10243a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, h / 6 * i); ctx.lineTo(w, h / 6 * i); ctx.stroke();
    }
    const partNotes = notes.filter(note => note.part === partIndex || note.part === -1);
    const pitches = partNotes.map(note => note.midi);
    let low = pitches.length ? Math.min(...pitches) - 2 : DEFAULT_RANGE[0];
    let high = pitches.length ? Math.max(...pitches) + 2 : DEFAULT_RANGE[1];
    if (high - low < 12) { const middle = (high + low) / 2; low = middle - 6; high = middle + 6; }
    const cursor = w * 0.12;
    const pxPerSecond = w * 0.88 / 8;
    const noteHeight = Math.max(compact ? 13 : 20, h * .22);
    const yFor = (midi: number) => h - ((midi - low) / (high - low)) * (h - noteHeight) - noteHeight / 2;
    for (const note of partNotes) {
      const x = cursor + (note.start - elapsed) * pxPerSecond;
      const end = cursor + (note.end - elapsed) * pxPerSecond;
      if (end < 0 || x > w) continue;
      const past = note.end <= elapsed;
      const result = hitNotes[note.id];
      ctx.save();
      ctx.fillStyle = past ? (result ? '#65d6a4' : '#33445a') : `${colour}${elapsed >= note.start ? 'ff' : '92'}`;
      ctx.shadowColor = past ? (result ? '#65d6a4' : 'transparent') : colour;
      ctx.shadowBlur = elapsed >= note.start && !past ? 16 : 4;
      roundRect(ctx, Math.max(0, x), Math.max(2, yFor(note.midi)), Math.max(4, end - x - 3), noteHeight, 7);
      ctx.fill(); ctx.restore();
      if (note.lyric && end - x > 30 && !compact) {
        ctx.fillStyle = '#f8fbff'; ctx.font = '600 12px system-ui';
        ctx.fillText(note.lyric, Math.max(0, x) + 7, Math.max(2, yFor(note.midi)) + noteHeight - 6);
      }
    }
    ctx.save(); ctx.strokeStyle = '#f6c65b'; ctx.shadowColor = '#f6c65b'; ctx.shadowBlur = 18; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(cursor, 0); ctx.lineTo(cursor, h); ctx.stroke(); ctx.restore();
    if (pitchHz && pitchHz > 0) {
      const y = Math.max(8, Math.min(h - 8, yFor(hzToMidi(pitchHz)) + noteHeight / 2));
      ctx.save(); ctx.fillStyle = '#ffffff'; ctx.shadowColor = colour; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(cursor, y, compact ? 7 : 10, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    void width; void height;
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [colour, compact, elapsed, hitNotes, notes, partIndex, pitchHz]);

  return (
    <section className={`flex overflow-hidden rounded-2xl border border-white/10 bg-[#08111f] ${compact ? 'h-[64px]' : 'h-[92px]'}`} aria-label={`${partName} pitch lane`}>
      <div className="flex w-20 shrink-0 flex-col items-center justify-center border-r border-white/10 px-2" style={{ background: `${colour}18` }}>
        <strong className="text-lg" style={{ color: colour }}>{partName[0]}</strong>
        <span className="text-[10px] font-semibold uppercase tracking-[.16em]" style={{ color: colour }}>{partName}</span>
        {playerCount !== undefined && <span className="mt-1 text-xs text-slate-300">{playerCount} singers</span>}
      </div>
      <canvas ref={ref} className="block h-full min-w-0 flex-1 bg-[#08111f]" />
    </section>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y + r, r); ctx.closePath();
}
