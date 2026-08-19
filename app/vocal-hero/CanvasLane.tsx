'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { SongNote } from '@/lib/vocal-hero/types';
import { hzToMidi, midiNoteName } from '@/lib/vocal-hero/liveCues';
import type { TrailSample } from '@/lib/vocal-hero/trail';
import { CURSOR, laneBounds, xForTime, yForMidi } from '@/lib/vocal-hero/laneGeometry';

// The highway, drawn rather than laid out.
//
// The DOM lane it replaces re-rendered React sixty times a second and built a
// div per visible note, which is why the phone had to throttle itself to thirty
// frames and why nothing could glow, trail or flare. Worse, the whole page went
// with it: `elapsed` was React state, so every lane, the lyrics and the
// scoreboard rebuilt on every frame with no memoisation anywhere.
//
// This reads the playhead from a REF inside its own animation loop. React never
// re-renders for movement -- it renders once, and the canvas takes over. The
// parent is then free to update its own text at whatever rate suits reading,
// which is nowhere near sixty.

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function CanvasLane({
  notes, partIndex, colour, getPosition, getPitchHz, getLevel, trail, hitNotes,
  lookAheadSeconds = 7, height = 260, partName, showLyrics = true, playerCount,
}: {
  notes: SongNote[];
  partIndex: number;
  colour: string;
  /** Read every frame. Keeping the playhead out of React state is the point. */
  getPosition: () => number;
  getPitchHz?: () => number;
  /** Input loudness, 0-1. Drawn on the lane so a singer can see the app is
   *  hearing them even in the moments before a pitch locks. */
  getLevel?: () => number;
  trail?: TrailSample[];
  hitNotes?: Record<string, boolean>;
  lookAheadSeconds?: number;
  height?: number;
  partName?: string;
  showLyrics?: boolean;
  /** How many singers are on this part, shown in the header during a round. */
  playerCount?: number;
}) {
  // Both of these used to be recomputed on every frame of every lane, which on
  // the largest song in the library came to 47ms of pure bookkeeping per second
  // of drawing -- about 5% of a core spent deciding things that cannot change
  // between frames, since the notes do not move. Measured at 12.7ms once hoisted.
  const bounds = useMemo(() => laneBounds(notes, partIndex), [notes, partIndex]);
  const laneNotes = useMemo(
    () => notes.filter(note => note.part === partIndex || note.part === -1).sort((a, b) => a.start - b.start),
    [notes, partIndex]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // The draw loop must not be torn down and rebuilt when a prop changes, or a
  // re-render would stutter the animation. It reads the latest props from here.
  const propsRef = useRef({ bounds, laneNotes, colour, getPosition, getPitchHz, getLevel, trail, hitNotes, lookAheadSeconds, showLyrics });
  propsRef.current = { bounds, laneNotes, colour, getPosition, getPitchHz, getLevel, trail, hitNotes, lookAheadSeconds, showLyrics };

  useEffect(() => {
    const canvas = canvasRef.current, box = boxRef.current;
    if (!canvas || !box) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let width = 0, drawHeight = 0;
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = box.getBoundingClientRect();
      width = Math.max(1, rect.width);
      drawHeight = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(drawHeight * ratio);
      canvas.style.width = width + 'px';
      canvas.style.height = drawHeight + 'px';
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(box);

    let frame = 0;
    const draw = () => {
      const p = propsRef.current;
      const position = p.getPosition();
      const look = p.lookAheadSeconds;
      const { low, high } = p.bounds;
      const cursorX = width * CURSOR;

      context.clearRect(0, 0, width, drawHeight);

      // ---- the road
      const bg = context.createLinearGradient(0, 0, 0, drawHeight);
      bg.addColorStop(0, '#070d1c');
      bg.addColorStop(1, '#04070f');
      context.fillStyle = bg;
      context.fillRect(0, 0, width, drawHeight);

      // Semitone rows, with the octaves picked out: a singer reads position
      // against these far faster than against a bare gradient.
      for (let midi = Math.ceil(low); midi <= high; midi++) {
        const y = yForMidi(midi, low, high, drawHeight);
        const isOctave = ((midi % 12) + 12) % 12 === 0;
        context.strokeStyle = isOctave ? 'rgba(148, 217, 255, .16)' : 'rgba(255,255,255,.045)';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(0, Math.round(y) + .5);
        context.lineTo(width, Math.round(y) + .5);
        context.stroke();
        if (isOctave) {
          context.fillStyle = 'rgba(148, 217, 255, .45)';
          context.font = '10px ui-sans-serif, system-ui';
          context.fillText(midiNoteName(midi), 4, y - 3);
        }
      }

      // ---- notes
      // Already narrowed to this voice and sorted, so this is a time window on a
      // quarter of the notes rather than a part check across all of them.
      const visible = p.laneNotes.filter(note => note.end >= position - 1.2 && note.start <= position + look);

      for (const note of visible) {
        const x = xForTime(note.start, position, look, width);
        const endX = xForTime(note.end, position, look, width);
        const y = yForMidi(note.midi, low, high, drawHeight);
        const w = Math.max(6, endX - x - 2);
        const h = Math.max(7, (drawHeight / Math.max(12, high - low)) * 0.72);
        const past = note.end <= position;
        const active = position >= note.start && position < note.end;
        const hit = p.hitNotes?.[note.id];

        // Approaching notes brighten as they near the line, so the eye is drawn
        // to what has to be sung next rather than to the whole road at once.
        const nearness = Math.max(0, Math.min(1, 1 - (note.start - position) / look));
        context.save();
        if (past) context.globalAlpha = hit ? .85 : .32;

        if (active || (!past && nearness > .6)) {
          context.shadowColor = withAlpha(colour, .9);
          context.shadowBlur = active ? 26 : 14;
        }
        const body = past ? (hit ? '#65d6a4' : '#44566d') : colour;
        const gradient = context.createLinearGradient(x, y - h / 2, x, y + h / 2);
        gradient.addColorStop(0, withAlpha(body, 1));
        gradient.addColorStop(1, withAlpha(body, .72));
        context.fillStyle = gradient;
        roundRect(context, x, y - h / 2, w, h, Math.min(6, h / 2));
        context.fill();

        if (active) {
          context.shadowBlur = 0;
          context.strokeStyle = '#ffffff';
          context.lineWidth = 2;
          roundRect(context, x, y - h / 2, w, h, Math.min(6, h / 2));
          context.stroke();
        }
        context.restore();

        if (p.showLyrics && note.lyric && w > 26) {
          context.fillStyle = 'rgba(7,17,29,.92)';
          context.font = '700 11px ui-sans-serif, system-ui';
          context.fillText(note.lyric, x + 5, y + 4, w - 8);
        }
      }

      // ---- what the singer actually sang
      const samples = p.trail;
      if (samples?.length) {
        context.lineWidth = 2.5;
        context.lineJoin = 'round';
        context.lineCap = 'round';
        let drawing = false;
        context.beginPath();
        for (const sample of samples) {
          if (sample.hz <= 0 || sample.t < position - 2.5 || sample.t > position) { drawing = false; continue; }
          const x = xForTime(sample.t, position, look, width);
          const y = yForMidi(hzToMidi(sample.hz), low, high, drawHeight);
          if (!drawing) { context.moveTo(x, y); drawing = true; } else context.lineTo(x, y);
        }
        context.strokeStyle = 'rgba(110, 231, 183, .85)';
        context.shadowColor = 'rgba(110, 231, 183, .5)';
        context.shadowBlur = 8;
        context.stroke();
        context.shadowBlur = 0;
      }

      // ---- the strike line, drawn last so nothing covers it
      const flare = context.createLinearGradient(cursorX - 30, 0, cursorX + 8, 0);
      flare.addColorStop(0, 'rgba(246,198,91,0)');
      flare.addColorStop(1, 'rgba(246,198,91,.20)');
      context.fillStyle = flare;
      context.fillRect(cursorX - 30, 0, 38, drawHeight);
      context.fillStyle = '#f6c65b';
      context.shadowColor = '#f6c65b';
      context.shadowBlur = 16;
      context.fillRect(cursorX - 1.5, 0, 3, drawHeight);
      context.shadowBlur = 0;

      // ---- the voice, on the line where it belongs
      //
      // Three states, drawn differently, because a singer needs to tell them
      // apart at a glance while singing: a locked pitch, sound arriving without
      // a pitch yet, and nothing reaching the app at all.
      const hz = p.getPitchHz?.() ?? 0;
      const level = p.getLevel?.() ?? 0;
      const hearing = level > 0.002;

      if (hz > 0) {
        const y = Math.max(8, Math.min(drawHeight - 8, yForMidi(hzToMidi(hz), low, high, drawHeight)));
        context.beginPath();
        context.arc(cursorX, y, 7, 0, Math.PI * 2);
        context.fillStyle = '#07111d';
        context.strokeStyle = '#ffffff';
        context.lineWidth = 2.5;
        context.shadowColor = withAlpha(colour, .95);
        context.shadowBlur = 18;
        context.fill();
        context.stroke();
        context.shadowBlur = 0;
        // The note being sung, written beside the dot: the singer should never
        // have to look away from the lane to find out what they are on.
        const name = midiNoteName(Math.round(hzToMidi(hz)));
        context.font = '700 12px ui-sans-serif, system-ui';
        const textWidth = context.measureText(name).width;
        context.fillStyle = 'rgba(4, 9, 20, .8)';
        roundRect(context, cursorX + 12, y - 10, textWidth + 10, 20, 5);
        context.fill();
        context.fillStyle = '#ffffff';
        context.fillText(name, cursorX + 17, y + 4);
      } else if (hearing) {
        // Sound is arriving but nothing has locked. A pulse says "heard, still
        // deciding" rather than leaving the lane looking dead.
        const pulse = 7 + Math.sin(Date.now() / 140) * 2.5;
        context.beginPath();
        context.arc(cursorX, drawHeight / 2, pulse, 0, Math.PI * 2);
        context.strokeStyle = 'rgba(251, 191, 36, .8)';
        context.lineWidth = 2;
        context.stroke();
      }

      // ---- the input meter, always visible
      //
      // Without it, "the app cannot hear me" and "I am not singing" look
      // identical, which is exactly how a silent microphone went unnoticed.
      const meterHeight = drawHeight - 16;
      const filled = Math.min(1, level * 45) * meterHeight;
      context.fillStyle = 'rgba(255,255,255,.07)';
      roundRect(context, width - 9, 8, 4, meterHeight, 2);
      context.fill();
      if (filled > 1) {
        context.fillStyle = hz > 0 ? 'rgba(110, 231, 183, .95)' : 'rgba(251, 191, 36, .9)';
        roundRect(context, width - 9, 8 + (meterHeight - filled), 4, filled, 2);
        context.fill();
      }

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
    // Deliberately empty: the loop lives for the lifetime of the lane and reads
    // everything current through propsRef. Re-creating it on a prop change is
    // what would make the animation stutter.
  }, [colour]);

  return <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#08111f]" aria-label={`${partName ?? 'Pitch'} lane`}>
    {partName && <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
      <span className="text-[11px] font-black uppercase tracking-[.16em]" style={{ color: colour }}>{partName}</span>
      <span className="text-[9px] uppercase tracking-[.14em] text-slate-500">{playerCount === undefined ? '' : playerCount + ' singing · '}next {lookAheadSeconds}s</span>
    </div>}
    <div ref={boxRef} style={{ height }} className="relative w-full"><canvas ref={canvasRef} className="block" /></div>
  </section>;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}
