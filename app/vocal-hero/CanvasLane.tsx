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
  lookAheadSeconds = 7, height = 260, partName, showLyrics = true, playerCount, fill = false,
  readout = null,
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
  /** The note being sung and the note being aimed at, shown in the lane's own
   *  header. Portrait has no room for the big readout panel below the lane --
   *  it was the row that fell off the bottom of the screen -- and the header is
   *  a row that already exists and cannot be clipped while the lane is on
   *  screen at all. */
  readout?: { detected: string; target: string; hint: string; tone: 'good' | 'warn' | 'idle' } | null;
  /** Fill the parent's height instead of taking a fixed one. The portrait
   *  layout is a no-scroll column, and the lane is the row that absorbs
   *  whatever the others leave -- a fixed height cannot express that. The
   *  ResizeObserver below already tracks the box, so nothing else changes. */
  fill?: boolean;
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
      // against these far faster than against a bare gradient. The names are
      // drawn later, over the notes, so nothing scrolls across them.
      const rowPx = (drawHeight - 20) / Math.max(1, high - low);
      for (let midi = Math.ceil(low); midi <= high; midi++) {
        const y = yForMidi(midi, low, high, drawHeight);
        const isOctave = ((midi % 12) + 12) % 12 === 0;
        context.strokeStyle = isOctave ? 'rgba(148, 217, 255, .16)' : 'rgba(255,255,255,.045)';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(0, Math.round(y) + .5);
        context.lineTo(width, Math.round(y) + .5);
        context.stroke();
      }

      // ---- the row being aimed at
      //
      // "Which line am I singing?" is the question the graph exists to answer,
      // and until now it answered it only by position between two labels an
      // octave apart. The note under the playhead -- or the next one, in the
      // rest before an entrance -- gets its whole row lit.
      const aimed = p.laneNotes.find(note => position >= note.start && position < note.end)
        ?? p.laneNotes.find(note => note.start >= position) ?? null;
      if (aimed) {
        const aimY = yForMidi(aimed.midi, low, high, drawHeight);
        const band = Math.max(9, rowPx * .92);
        context.fillStyle = withAlpha(colour, .09);
        context.fillRect(0, aimY - band / 2, width, band);
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
        // A note must never be taller than the row it sits in. The old floor of
        // 7px ignored the row entirely, so on a phone -- where eighteen
        // semitones can share 117px, a row every 5.4px -- neighbouring notes
        // were drawn overlapping and the line read as one smear of colour.
        const h = Math.max(4, Math.min(13, rowPx * 0.82));
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

        // ---- the green proof
        // Exactly the stretch of this note the singer has hit so far turns
        // green — the portion, not the whole bar, so a note released early
        // keeps a green head and an unfilled tail. Matching is octave-
        // forgiving, the same courtesy the score engine extends.
        const sung = p.trail;
        if (sung?.length && note.start <= position) {
          const upTo = Math.min(position, note.end);
          context.shadowBlur = 0;
          context.globalAlpha = past ? .9 : 1;
          const run = context.createLinearGradient(x, y - h / 2, x, y + h / 2);
          run.addColorStop(0, 'rgba(74, 222, 128, .98)');
          run.addColorStop(1, 'rgba(16, 185, 129, .85)');
          context.save();
          roundRect(context, x, y - h / 2, w, h, Math.min(6, h / 2));
          context.clip();
          context.fillStyle = run;
          let runStart = -1, lastGood = -1;
          const paint = (from: number, to: number) => {
            if (to - from < 0.045) return;
            const x1 = xForTime(from, position, look, width);
            const x2 = xForTime(Math.min(to + 0.03, note.end), position, look, width);
            if (x2 - x1 >= 2) context.fillRect(x1, y - h / 2, x2 - x1, h);
          };
          for (const sample of sung) {
            if (sample.t < note.start) continue;
            if (sample.t > upTo) break;
            let good = false;
            if (sample.hz > 0) {
              const raw = Math.abs(hzToMidi(sample.hz) - note.midi) % 12;
              good = Math.min(raw, 12 - raw) <= 0.6;
            }
            if (good) { if (runStart < 0) runStart = sample.t; lastGood = sample.t; }
            else if (runStart >= 0 && sample.t - lastGood > 0.09) { paint(runStart, lastGood); runStart = -1; }
          }
          if (runStart >= 0) paint(runStart, lastGood);
          context.restore();
        }

        if (active) {
          context.shadowBlur = 0;
          context.strokeStyle = '#ffffff';
          context.lineWidth = 2;
          roundRect(context, x, y - h / 2, w, h, Math.min(6, h / 2));
          context.stroke();
        }
        context.restore();

        // ---- the word, and the note it is sung on
        //
        // The old rule drew a lyric only on notes wider than 26px and then
        // squeezed it into the pill. On a phone the pills are 11-36px, so seven
        // notes in nine carried no label at all and the two that did were a
        // smear. The label is now CHOSEN to fit rather than crushed to fit:
        // the note name and the word where both belong, the name alone when
        // they do not -- which is the thing a singer most needs and the thing
        // the lane never used to say.
        if (p.showLyrics && h >= 7) {
          const room = w - 7;
          const cap = Math.min(11, Math.floor(h + 1));
          const name = midiNoteName(note.midi);
          const wanted = note.lyric ? [name + ' ' + note.lyric, name, note.lyric] : [name];
          let label = '', size = 0;
          for (const candidate of wanted) {
            for (const px of [11, 10, 9, 8].filter(px => px <= cap)) {
              context.font = `700 ${px}px ui-sans-serif, system-ui`;
              if (context.measureText(candidate).width <= room) { label = candidate; size = px; break; }
            }
            if (label) break;
          }
          if (label) {
            context.font = `700 ${size}px ui-sans-serif, system-ui`;
            context.fillStyle = past && !hit ? 'rgba(226,232,240,.7)' : 'rgba(7,17,29,.92)';
            context.fillText(label, x + 4, y + size / 2 - 1);
          }
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

      // ---- the pitch ruler
      //
      // Two octave labels told a singer almost nothing: a note three rows under
      // C5 is an A, and nobody should have to count rows to find that out. Now
      // every row the height can carry is named, over a fade so the notes
      // running underneath stay visible, and the row being aimed at is named
      // brightly whether or not it was its turn to be labelled.
      const gutter = 32;
      const fade = context.createLinearGradient(0, 0, gutter, 0);
      fade.addColorStop(0, 'rgba(4, 9, 20, .94)');
      fade.addColorStop(.65, 'rgba(4, 9, 20, .82)');
      fade.addColorStop(1, 'rgba(4, 9, 20, 0)');
      context.fillStyle = fade;
      context.fillRect(0, 0, gutter, drawHeight);
      // One name per row while they are far enough apart to read; every second
      // or third row when the lane is short.
      const nameStep = rowPx >= 12 ? 1 : rowPx >= 7 ? 2 : rowPx >= 4.6 ? 3 : 12;
      const wanted: number[] = [];
      // Offered first, so that on a lane too short for two labels this is the
      // one that gets the space: it is the note the singer is on.
      if (aimed && aimed.midi >= low && aimed.midi <= high) wanted.push(aimed.midi);
      for (let midi = Math.ceil(low); midi <= high; midi++) {
        if (((midi % 12) + 12) % 12 === 0 || (midi - Math.ceil(low)) % nameStep === 0) wanted.push(midi);
      }
      const placed: number[] = [];
      for (const midi of wanted) {
        const y = yForMidi(midi, low, high, drawHeight);
        // A name is worth nothing printed over another one. Below this gap the
        // pass simply draws fewer of them.
        if (placed.some(other => Math.abs(other - y) < 11)) continue;
        placed.push(y);
        const isAimed = aimed?.midi === midi;
        const isOctave = ((midi % 12) + 12) % 12 === 0;
        context.font = isAimed ? '800 11px ui-sans-serif, system-ui' : '700 9px ui-sans-serif, system-ui';
        context.fillStyle = isAimed ? withAlpha(colour, .95)
          : isOctave ? 'rgba(148, 217, 255, .72)' : 'rgba(203, 213, 225, .45)';
        context.fillText(midiNoteName(midi), 4, y + 3);
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
    // Nearly empty on purpose: the loop lives for the lifetime of the lane and
    // reads everything current through propsRef, because re-creating it on a
    // prop change is what would make the animation stutter. `fill` is the one
    // exception -- it swaps the box between a fixed height and flex-1, and the
    // canvas was measured before the swap. The ResizeObserver alone proved not
    // to catch that transition reliably, so the loop restarts once, at a moment
    // when the layout is changing anyway.
  }, [colour, fill]);

  return <section className={'overflow-hidden rounded-2xl border border-white/10 bg-[#08111f]' + (fill ? ' flex h-full min-h-0 flex-col' : '')} aria-label={`${partName ?? 'Pitch'} lane`}>
    {partName && <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5">
      <span className="shrink-0 text-[11px] font-black uppercase tracking-[.16em]" style={{ color: colour }}>{partName}</span>
      {readout
        ? <span className="flex min-w-0 items-baseline gap-1.5">
            <b className="text-[13px] font-black text-cyan-200">{readout.detected}</b>
            <span className={'truncate text-[9px] font-black uppercase tracking-[.1em] ' + (readout.tone === 'good' ? 'text-emerald-300' : readout.tone === 'warn' ? 'text-amber-300' : 'text-slate-500')}>{readout.hint}</span>
            <b className="text-[13px] font-black text-white">{readout.target}</b>
          </span>
        : <span className="text-[9px] uppercase tracking-[.14em] text-slate-500">{playerCount === undefined ? '' : playerCount + ' singing · '}next {lookAheadSeconds}s</span>}
    </div>}
    <div ref={boxRef} style={fill ? undefined : { height }} className={'relative w-full' + (fill ? ' min-h-0 flex-1' : '')}><canvas ref={canvasRef} className="block" /></div>
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
