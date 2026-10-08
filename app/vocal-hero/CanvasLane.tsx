'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { SongNote } from '@/lib/vocal-hero/types';
import { hzToMidi, midiNoteName } from '@/lib/vocal-hero/liveCues';
import type { TrailSample } from '@/lib/vocal-hero/trail';
import { interpretMarks } from '@/lib/vocal-hero/performMarks';
import { CURSOR, laneBounds, xForTime, yForMidi } from '@/lib/vocal-hero/laneGeometry';
import {
  breathPoints, centsFromTarget, dynamicMarkers, inTune, noteThickness, slurSpans, sungFraction,
} from '@/lib/vocal-hero/laneExpression';

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
//
// WHAT IT DRAWS, AND WHY IT CHANGED
//
// It used to draw a piano roll: every note an identical pill at an identical
// thickness, and the singer's own voice a 2.5px line. That was a chart of the
// music rather than a picture of it, and the reason was not the renderer --
// it was that the renderer only ever read `midi`, `start`, `end` and `lyric`.
// The song already carried dynamics, hairpins, slurs and fermatas on every
// note, and none of it reached the screen.
//
// So: thickness is the dynamic, the gaps long enough to breathe in say so,
// slurred notes are joined by their arc, and the voice is a ribbon whose width
// is how loudly it is being sung and whose colour is whether it is in tune.
// The pure part of that -- which notes pair, which gaps are breaths, how thick
// a velocity draws -- lives in laneExpression.ts so it can be tested.

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** A note that has just gone under the strike line, and how it went. */
interface Flare { id: string; midi: number; at: number; good: boolean; fraction: number }

/** The lane's memory of this run: what it has already judged, and what is
 *  still flaring. Reset on a new song, a new part, or a jump backwards. */
interface RunState { judged: Record<string, boolean>; flares: Flare[]; streak: number; lastPosition: number }

const FLARE_MS = 900;

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

  // The expression layer, hoisted for exactly the same reason. interpretMarks
  // wants every note because hairpins and slurs pair within a part, so it is
  // keyed on the whole list; the rest are this lane's own.
  const velocities = useMemo(() => interpretMarks(notes).velocity, [notes]);
  const slurs = useMemo(() => slurSpans(laneNotes), [laneNotes]);
  const breaths = useMemo(() => breathPoints(laneNotes), [laneNotes]);
  const dynamics = useMemo(() => dynamicMarkers(laneNotes), [laneNotes]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const runRef = useRef<RunState>({ judged: {}, flares: [], streak: 0, lastPosition: 0 });
  // A different song, or a different voice, is a different run. Without this
  // the streak would carry across and notes judged on the old part would stop
  // the new one's from ever being judged at all.
  useEffect(() => { runRef.current = { judged: {}, flares: [], streak: 0, lastPosition: 0 }; }, [laneNotes]);

  // The draw loop must not be torn down and rebuilt when a prop changes, or a
  // re-render would stutter the animation. It reads the latest props from here.
  const propsRef = useRef({
    bounds, laneNotes, colour, getPosition, getPitchHz, getLevel, trail, hitNotes, lookAheadSeconds,
    showLyrics, velocities, slurs, breaths, dynamics,
  });
  propsRef.current = {
    bounds, laneNotes, colour, getPosition, getPitchHz, getLevel, trail, hitNotes, lookAheadSeconds,
    showLyrics, velocities, slurs, breaths, dynamics,
  };

  useEffect(() => {
    const canvas = canvasRef.current, box = boxRef.current;
    if (!canvas || !box) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    // Flares expand and the waiting pulse breathes. Neither carries meaning the
    // stillness does not, so a viewer who has asked for less movement gets the
    // same information without it.
    const calm = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Scratch space for the voice ribbon, reused every frame. The trail holds
    // four seconds of microphone samples, so building a fresh array of points
    // here would hand the collector several thousand objects a second on the
    // one thread that has to stay smooth -- the same reason pushTrail mutates.
    let ribbonX = new Float64Array(1024);
    let ribbonY = new Float64Array(1024);
    let ribbonR = new Float64Array(1024);

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
      const run = runRef.current;
      const position = p.getPosition();
      const look = p.lookAheadSeconds;
      const { low, high } = p.bounds;
      const cursorX = width * CURSOR;
      const now = performance.now();

      // A jump backwards is a seek or a loop lap: the notes ahead have been
      // judged already and must be allowed to be judged again, or a singer
      // repeating a phrase would see the verdict only once. Checked before
      // anything is drawn, so the old lap's flares never survive into the new.
      if (position < run.lastPosition - 0.25) {
        run.judged = {};
        run.flares = [];
        run.streak = 0;
      }
      run.lastPosition = position;

      // How much ornament the box can carry. A lane is 300px on a desktop round
      // and 120px on the choir board, and the difference is not a scale factor:
      // below a certain height a word above a note lands on the note above it.
      const rowPx = (drawHeight - 20) / Math.max(1, high - low);
      const roomy = drawHeight >= 150;
      const midSized = drawHeight >= 108 && rowPx >= 5;

      context.clearRect(0, 0, width, drawHeight);

      // ---- the road
      const bg = context.createLinearGradient(0, 0, 0, drawHeight);
      bg.addColorStop(0, '#0a1020');
      bg.addColorStop(.55, '#070d1a');
      bg.addColorStop(1, '#04070f');
      context.fillStyle = bg;
      context.fillRect(0, 0, width, drawHeight);

      // A pool of light over the part's own tessitura, so the eye has a home
      // on a lane that is mostly empty space.
      const pool = context.createLinearGradient(0, yForMidi(high - 2, low, high, drawHeight), 0, yForMidi(low + 2, low, high, drawHeight));
      pool.addColorStop(0, 'rgba(255,255,255,0)');
      pool.addColorStop(.5, withAlpha(colour, .035));
      pool.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = pool;
      context.fillRect(0, 0, width, drawHeight);

      // Semitone rows, with the octaves picked out: a singer reads position
      // against these far faster than against a bare gradient. The names are
      // drawn later, over the notes, so nothing scrolls across them.
      for (let midi = Math.ceil(low); midi <= high; midi++) {
        const y = yForMidi(midi, low, high, drawHeight);
        const isOctave = ((midi % 12) + 12) % 12 === 0;
        context.strokeStyle = isOctave ? 'rgba(148, 217, 255, .13)' : 'rgba(255,255,255,.035)';
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
      // rest before an entrance -- gets its whole row lit, brightening as the
      // entrance arrives.
      const aimed = p.laneNotes.find(note => position >= note.start && position < note.end)
        ?? p.laneNotes.find(note => note.start >= position) ?? null;
      if (aimed) {
        const aimY = yForMidi(aimed.midi, low, high, drawHeight);
        const arriving = clamp(1 - (aimed.start - position) / 1.6, 0, 1);
        const band = Math.max(12, rowPx * 1.5);
        const beam = context.createLinearGradient(0, aimY - band, 0, aimY + band);
        beam.addColorStop(0, withAlpha(colour, 0));
        beam.addColorStop(.5, withAlpha(colour, .06 + .09 * arriving));
        beam.addColorStop(1, withAlpha(colour, 0));
        context.fillStyle = beam;
        context.fillRect(0, aimY - band, width, band * 2);
      }

      // ---- where to breathe
      //
      // A rest is the one part of a vocal line the old lane drew as nothing at
      // all, which is exactly backwards: the gap before a long phrase is the
      // thing a singer has to plan for.
      for (const breath of p.breaths) {
        if (breath.at < position - 0.5 || breath.at > position + look) continue;
        const x = xForTime(breath.at, position, look, width);
        if (x < 34 || x > width) continue;
        const live = Math.abs(breath.at - position) < 0.5;
        context.save();
        context.strokeStyle = live ? 'rgba(125, 211, 252, .7)' : 'rgba(125, 211, 252, .22)';
        context.setLineDash([3, 5]);
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(x, 14);
        context.lineTo(x, drawHeight - 14);
        context.stroke();
        context.setLineDash([]);
        context.font = `${live ? '700' : '600'} 15px ui-sans-serif, system-ui`;
        context.fillStyle = live ? 'rgba(186, 230, 253, .98)' : 'rgba(125, 211, 252, .45)';
        context.fillText('’', x - 2, 20);
        if (live && roomy) {
          context.font = '700 8.5px ui-sans-serif, system-ui';
          context.fillStyle = 'rgba(125, 211, 252, .85)';
          context.fillText('BREATHE', x + 5, 19);
        }
        context.restore();
      }

      // ---- slurs, drawn under the notes they join so nothing covers a note
      if (midSized) {
        for (const span of p.slurs) {
          const from = p.laneNotes[span.from], to = p.laneNotes[span.to];
          if (!from || !to || to.end < position - 1 || from.start > position + look) continue;
          const x1 = xForTime(from.start, position, look, width);
          const x2 = xForTime(to.end, position, look, width);
          const y1 = yForMidi(from.midi, low, high, drawHeight);
          const y2 = yForMidi(to.midi, low, high, drawHeight);
          const lift = Math.max(11, rowPx * .9);
          context.strokeStyle = 'rgba(226, 232, 240, .34)';
          context.lineWidth = 1.5;
          context.beginPath();
          context.moveTo(x1, y1 - 6);
          context.quadraticCurveTo((x1 + x2) / 2, Math.min(y1, y2) - lift, x2, y2 - 6);
          context.stroke();
        }
      }

      // ---- notes
      // Already narrowed to this voice and sorted, so this is a time window on a
      // quarter of the notes rather than a part check across all of them.
      const visible = p.laneNotes.filter(note => note.end >= position - 1.2 && note.start <= position + look);
      // A word above every note collides with the note a row up as soon as the
      // rows are close together. On a roomy lane they all fit; on a short one
      // only the notes about to be sung are worth the space.
      const labelAll = rowPx >= 11;
      let labelled = 0;
      // Where the last label ended. Notes close together in TIME put their
      // labels on top of each other however few of them there are, which is
      // what a phone's 310px-wide window does to a run of quavers.
      let labelRight = -Infinity;

      for (const note of visible) {
        const x = xForTime(note.start, position, look, width);
        const endX = xForTime(note.end, position, look, width);
        const y = yForMidi(note.midi, low, high, drawHeight);
        const w = Math.max(6, endX - x - 2);
        // Thickness is the dynamic. noteThickness keeps it inside its own row:
        // on a phone eighteen semitones can share 117px, and a bar that
        // outgrows its row turns the line into one smear of colour.
        const h = noteThickness(p.velocities.get(note.id) ?? note.velocity ?? 85, rowPx);
        const past = note.end <= position;
        const active = position >= note.start && position < note.end;

        // The verdict is reached the moment the note goes under the line, and
        // before the note is drawn -- reading it afterwards meant a note that
        // had just finished drew grey for one frame and then turned green.
        //
        // In a scored round the engine's `hitNotes` is the truth and this only
        // decides how warmly to word it. In practice nothing is scoring the
        // run, so the lane judges the note itself from what it heard.
        if (past && run.judged[note.id] === undefined) {
          const heard = (p.trail ?? [])
            .filter(sample => sample.hz > 0 && sample.t >= note.start && sample.t <= note.end)
            .map(sample => ({ t: sample.t, midi: hzToMidi(sample.hz) }));
          const fraction = sungFraction(heard, note.start, note.end, note.midi);
          const good = p.hitNotes?.[note.id] ?? fraction >= 0.5;
          run.judged[note.id] = good;
          run.streak = good ? run.streak + 1 : 0;
          run.flares.push({ id: note.id, midi: note.midi, at: now, good, fraction });
        }
        const hit = p.hitNotes?.[note.id] ?? run.judged[note.id];

        // Approaching notes brighten as they near the line, so the eye is drawn
        // to what has to be sung next rather than to the whole road at once.
        const nearness = clamp(1 - (note.start - position) / look, 0, 1);
        context.save();
        if (past) context.globalAlpha = hit ? .62 : .3;

        const body = past ? (hit ? '#4ade80' : '#44566d') : colour;
        if (!past) {
          context.shadowColor = withAlpha(body, .5 + nearness * .4);
          context.shadowBlur = active ? 24 : 7 + nearness * 15;
        }
        const gradient = context.createLinearGradient(x, y - h / 2, x, y + h / 2);
        gradient.addColorStop(0, withAlpha(body, .58));
        gradient.addColorStop(.42, withAlpha(body, 1));
        gradient.addColorStop(1, withAlpha(body, .64));
        context.fillStyle = gradient;
        roundRect(context, x, y - h / 2, w, h, h / 2);
        context.fill();
        context.shadowBlur = 0;

        // The attack cap: a bright nib on the edge the voice has to land on.
        // The entrance is the half of a note singers actually miss.
        if (!past && w > 5) {
          context.fillStyle = 'rgba(255,255,255,.8)';
          roundRect(context, x, y - h / 2, Math.min(3.5, w), h, Math.min(1.6, h / 2));
          context.fill();
        }

        // ---- the green proof
        // Exactly the stretch of this note the singer has hit so far turns
        // green — the portion, not the whole bar, so a note released early
        // keeps a green head and an unfilled tail. Matching is octave-
        // forgiving, the same courtesy the score engine extends.
        const sung = p.trail;
        if (sung?.length && note.start <= position) {
          const upTo = Math.min(position, note.end);
          context.globalAlpha = past ? .75 : .9;
          const run2 = context.createLinearGradient(x, y - h / 2, x, y + h / 2);
          run2.addColorStop(0, 'rgba(74, 222, 128, .98)');
          run2.addColorStop(1, 'rgba(16, 185, 129, .85)');
          context.save();
          roundRect(context, x, y - h / 2, w, h, h / 2);
          context.clip();
          context.fillStyle = run2;
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
            const good = sample.hz > 0 && inTune(hzToMidi(sample.hz), note.midi);
            if (good) { if (runStart < 0) runStart = sample.t; lastGood = sample.t; }
            else if (runStart >= 0 && sample.t - lastGood > 0.09) { paint(runStart, lastGood); runStart = -1; }
          }
          if (runStart >= 0) paint(runStart, lastGood);
          context.restore();
        }

        if (active) {
          context.globalAlpha = 1;
          context.strokeStyle = 'rgba(255,255,255,.95)';
          context.lineWidth = 1.8;
          roundRect(context, x, y - h / 2, w, h, h / 2);
          context.stroke();
        }
        context.restore();

        // ---- fermata, over the note it holds
        if (note.marks?.fermata && !past && midSized) {
          context.strokeStyle = 'rgba(246, 198, 91, .9)';
          context.lineWidth = 1.6;
          context.beginPath();
          context.arc(x + w / 2, y - h / 2 - 9, 6.5, Math.PI, 0);
          context.stroke();
          context.fillStyle = 'rgba(246, 198, 91, .95)';
          context.beginPath();
          context.arc(x + w / 2, y - h / 2 - 9, 1.8, 0, Math.PI * 2);
          context.fill();
        }

        // ---- the dynamic, printed only where it changes
        const dynamic = p.dynamics.get(note.id);
        if (dynamic && !past && roomy) {
          context.font = 'italic 700 12px Georgia, serif';
          context.fillStyle = 'rgba(246, 198, 91, .85)';
          context.fillText(dynamic, x, y + h / 2 + 14);
        }

        // ---- the word, and the note it is sung on
        //
        // The old rule drew the label INSIDE the pill, so on a phone -- where
        // the pills are 11-36px wide -- seven notes in nine carried no label
        // and the two that did were a smear. Above the bar there is room for
        // the note name AND the syllable, which is what a singer is reading.
        if (p.showLyrics && !past && (labelAll || labelled < 4)) {
          const name = midiNoteName(note.midi);
          const wanted = note.lyric ? [name + ' ' + note.lyric, note.lyric, name] : [name];
          const room = Math.max(w, 46);
          let label = '', size = 0;
          for (const candidate of wanted) {
            for (const px of [11, 10, 9]) {
              context.font = `700 ${px}px ui-sans-serif, system-ui`;
              if (context.measureText(candidate).width <= room) { label = candidate; size = px; break; }
            }
            if (label) break;
          }
          if (label) {
            context.font = `700 ${size}px ui-sans-serif, system-ui`;
            const labelWidth = context.measureText(label).width;
            if (x > labelRight + 6) {
              labelled++;
              labelRight = x + labelWidth;
              const lift = y - h / 2 - (note.marks?.fermata && midSized ? 20 : 6);
              context.fillStyle = active ? 'rgba(255,255,255,.98)' : 'rgba(226, 232, 240, .66)';
              context.fillText(label, x, Math.max(size, lift));
            }
          }
        }
      }

      // ---- what the singer actually sang, as a ribbon
      //
      // A 2.5px line was the whole of the singer's own contribution to the
      // picture. This is the same data, given the weight it deserves: the
      // width is how loudly they are singing and the colour is whether it is
      // the right note, so a swell looks like a swell and going flat is
      // visible before the note ends.
      const heard = p.trail;
      if (heard && heard.length > 1) {
        if (heard.length > ribbonX.length) {
          ribbonX = new Float64Array(heard.length);
          ribbonY = new Float64Array(heard.length);
          ribbonR = new Float64Array(heard.length);
        }
        // One pass with a moving pointer rather than a lookup per sample: at
        // sixty frames a second over a few hundred notes, a per-sample search
        // for the target note was the whole budget.
        const from = position - 2.6;
        const maxWidth = Math.max(2.4, rowPx * .8);
        let count = 0, onPitch = 0, cursor = 0;
        for (const sample of heard) {
          if (sample.hz <= 0 || sample.t < from) continue;
          if (sample.t > position) break;
          while (cursor < p.laneNotes.length && p.laneNotes[cursor].end <= sample.t) cursor++;
          const target = cursor < p.laneNotes.length && sample.t >= p.laneNotes[cursor].start
            ? p.laneNotes[cursor] : null;
          const midi = hzToMidi(sample.hz);
          if (target && inTune(midi, target.midi)) onPitch++;
          const loud = Math.min(1, (sample.level ?? 0) * 45);
          ribbonX[count] = xForTime(sample.t, position, look, width);
          ribbonY[count] = yForMidi(midi, low, high, drawHeight);
          ribbonR[count] = clamp(1.6 + loud * 5.5, 1.6, maxWidth);
          count++;
        }
        if (count > 1) {
          const sweet = onPitch / count >= .6;
          context.beginPath();
          context.moveTo(ribbonX[0], ribbonY[0] - ribbonR[0]);
          for (let i = 1; i < count; i++) context.lineTo(ribbonX[i], ribbonY[i] - ribbonR[i]);
          for (let i = count - 1; i >= 0; i--) context.lineTo(ribbonX[i], ribbonY[i] + ribbonR[i]);
          context.closePath();
          const band = context.createLinearGradient(ribbonX[0], 0, ribbonX[count - 1], 0);
          band.addColorStop(0, 'rgba(110, 231, 183, 0)');
          band.addColorStop(.35, sweet ? 'rgba(74, 222, 128, .4)' : 'rgba(251, 191, 36, .32)');
          band.addColorStop(1, sweet ? 'rgba(134, 239, 172, .9)' : 'rgba(252, 211, 77, .88)');
          context.fillStyle = band;
          context.shadowColor = sweet ? 'rgba(74, 222, 128, .55)' : 'rgba(251, 191, 36, .45)';
          context.shadowBlur = 14;
          context.fill();
          context.shadowBlur = 0;
          // A bright core down the middle: the ribbon says how it sounds, the
          // core keeps the exact pitch readable.
          context.beginPath();
          context.moveTo(ribbonX[0], ribbonY[0]);
          for (let i = 1; i < count; i++) context.lineTo(ribbonX[i], ribbonY[i]);
          context.strokeStyle = sweet ? 'rgba(236, 253, 245, .95)' : 'rgba(255, 251, 235, .9)';
          context.lineWidth = 1.4;
          context.lineCap = 'round';
          context.lineJoin = 'round';
          context.stroke();
        }
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
          : isOctave ? 'rgba(148, 217, 255, .7)' : 'rgba(203, 213, 225, .38)';
        context.fillText(midiNoteName(midi), 4, y + 3);
      }

      // ---- the strike line, drawn last so nothing covers it
      const flareBand = context.createLinearGradient(cursorX - 30, 0, cursorX + 8, 0);
      flareBand.addColorStop(0, 'rgba(246,198,91,0)');
      flareBand.addColorStop(1, 'rgba(246,198,91,.20)');
      context.fillStyle = flareBand;
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
      // `aimed` is the active note, or the next one during a rest. Only the
      // first of those is something to be in tune WITH.
      const target = aimed && position >= aimed.start && position < aimed.end ? aimed : null;
      const cents = hz > 0 && target ? centsFromTarget(hzToMidi(hz), target.midi) : null;
      const locked = cents !== null && Math.abs(cents) <= 50;

      // ---- the cents ladder: fine tuning, where a singer can watch it
      //
      // "On pitch" is a 100-cent-wide verdict, and inside it a choir still
      // sounds sour or sweet. This is the only part of the lane that shows the
      // difference between just inside and dead centre.
      if (roomy && target) {
        const ladderX = cursorX - 21;
        const ladderH = Math.min(92, drawHeight - 44);
        const ladderY = drawHeight / 2 - ladderH / 2;
        context.fillStyle = 'rgba(4, 9, 20, .55)';
        roundRect(context, ladderX - 6, ladderY - 7, 13, ladderH + 14, 6);
        context.fill();
        for (const mark of [-50, -25, 0, 25, 50]) {
          const markY = ladderY + ladderH * (0.5 - mark / 100);
          const centre = mark === 0;
          context.strokeStyle = centre ? 'rgba(246, 198, 91, .7)' : 'rgba(255,255,255,.18)';
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(ladderX - (centre ? 4 : 2), markY);
          context.lineTo(ladderX + (centre ? 4 : 2), markY);
          context.stroke();
        }
        if (cents !== null) {
          const needleY = ladderY + ladderH * (0.5 - clamp(cents, -60, 60) / 100);
          context.fillStyle = locked ? 'rgba(74, 222, 128, .98)' : 'rgba(251, 191, 36, .98)';
          context.beginPath();
          context.arc(ladderX, needleY, 3.5, 0, Math.PI * 2);
          context.fill();
          context.font = '700 9px ui-sans-serif, system-ui';
          context.fillStyle = locked ? 'rgba(134, 239, 172, .9)' : 'rgba(253, 224, 71, .9)';
          context.fillText((cents > 0 ? '+' : '') + cents, ladderX - 11, ladderY - 11);
        }
      }

      if (hz > 0) {
        const y = clamp(yForMidi(hzToMidi(hz), low, high, drawHeight), 9, drawHeight - 9);
        const tint = target ? (locked ? '#4ade80' : '#fbbf24') : colour;
        const halo = Math.min(1, level * 45);
        context.beginPath();
        context.arc(cursorX, y, 9 + halo * 11, 0, Math.PI * 2);
        context.fillStyle = withAlpha(tint, .13);
        context.fill();
        context.beginPath();
        context.arc(cursorX, y, 6.5, 0, Math.PI * 2);
        context.fillStyle = '#07111d';
        context.strokeStyle = tint;
        context.lineWidth = 2.5;
        context.shadowColor = tint;
        context.shadowBlur = 16;
        context.fill();
        context.stroke();
        context.shadowBlur = 0;

        // A tether to the row the singer is meant to be on, while they are not
        // on it. The note name alone says what is wrong; this says which way.
        if (target && !locked) {
          const targetY = yForMidi(target.midi, low, high, drawHeight);
          context.save();
          context.setLineDash([2, 3]);
          context.strokeStyle = 'rgba(251, 191, 36, .55)';
          context.lineWidth = 1.4;
          context.beginPath();
          context.moveTo(cursorX, y);
          context.lineTo(cursorX, targetY);
          context.stroke();
          context.restore();
          if (roomy && Math.abs(y - targetY) > 14) {
            context.font = '800 10px ui-sans-serif, system-ui';
            context.fillStyle = 'rgba(253, 224, 71, .95)';
            context.fillText(y > targetY ? '↑ higher' : '↓ lower', cursorX + 11, (y + targetY) / 2 + 3);
          }
        }
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
        const pulse = calm ? 7 : 7 + Math.sin(Date.now() / 140) * 2.5;
        context.beginPath();
        context.arc(cursorX, drawHeight / 2, pulse, 0, Math.PI * 2);
        context.strokeStyle = 'rgba(251, 191, 36, .8)';
        context.lineWidth = 2;
        context.stroke();
      }

      // ---- what just happened
      //
      // Landing a note used to look exactly like missing one. The ring is the
      // moment of contact and the streak is the reason to keep going; both
      // read the verdict the pass above already reached.
      run.flares = run.flares.filter(flare => now - flare.at < FLARE_MS);
      for (const flare of run.flares) {
        const age = (now - flare.at) / FLARE_MS;
        const y = yForMidi(flare.midi, low, high, drawHeight);
        context.save();
        context.globalAlpha = (1 - age) * .9;
        context.strokeStyle = flare.good ? 'rgba(74, 222, 128, .9)' : 'rgba(248, 113, 113, .8)';
        context.lineWidth = Math.max(.5, 2.5 * (1 - age));
        context.beginPath();
        context.arc(cursorX, y, calm ? 14 : 8 + age * 32, 0, Math.PI * 2);
        context.stroke();
        if (roomy) {
          const word = !flare.good ? 'missed' : flare.fraction >= .9 ? 'perfect' : flare.fraction >= .65 ? 'nice' : 'held';
          context.font = '800 12px ui-sans-serif, system-ui';
          context.fillStyle = flare.good ? 'rgba(134, 239, 172, 1)' : 'rgba(252, 165, 165, 1)';
          // Clear of the note-name badge, which sits at y-10 beside the same
          // line for the same reason. Rising from there, never off the top.
          context.fillText(word, cursorX + 16, Math.max(12, y - 24 - (calm ? 0 : age * 20)));
        }
        context.restore();
      }
      if (run.streak >= 3) {
        const label = run.streak + ' in a row';
        context.font = '800 11px ui-sans-serif, system-ui';
        const labelWidth = context.measureText(label).width;
        context.fillStyle = 'rgba(74, 222, 128, .14)';
        roundRect(context, width - labelWidth - 26, 8, labelWidth + 15, 20, 10);
        context.fill();
        context.fillStyle = 'rgba(134, 239, 172, .95)';
        context.fillText(label, width - labelWidth - 18, 22);
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
