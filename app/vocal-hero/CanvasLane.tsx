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

    // Deterministic from the index, so the field is the same field every
    // frame and only its position moves.
    const dust = Array.from({ length: 80 }, (_, i) => {
      const r = (n: number) => { const v = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return v - Math.floor(v); };
      return { x: r(1), y: r(2), size: .5 + r(3) * 1.7, speed: .3 + r(4) * 1.2, blink: .5 + r(5) * 1.9, phase: r(6) * 6.283 };
    });

    let frame = 0;
    const draw = () => {
      const p = propsRef.current;
      const position = p.getPosition();
      const look = p.lookAheadSeconds;
      const { low, high } = p.bounds;
      const cursorX = width * CURSOR;

      context.clearRect(0, 0, width, drawHeight);

      // ---- the stage
      //
      // A flat slab of navy read as a spreadsheet with dots on it. The music
      // arrives from the right, so the light does too: the road is darkest
      // where notes enter and brightest where they are sung, which gives the
      // eye somewhere to be without drawing anything that moves.
      const bg = context.createLinearGradient(0, 0, width, drawHeight);
      bg.addColorStop(0, '#0b1430');
      bg.addColorStop(.35, '#070d20');
      bg.addColorStop(1, '#04060f');
      context.fillStyle = bg;
      context.fillRect(0, 0, width, drawHeight);
      // ---- the aurora
      //
      // One veil was a smudge. Three, in different colours, on different
      // clocks, ADDED to one another rather than painted over -- that is what
      // makes light look like light: where two veils cross they brighten, and
      // the crossing wanders because no two share a period. Still dim enough
      // that a notehead is the brightest thing on the screen, which is the
      // only rule this background has to obey.
      const seconds = Date.now() / 1000;
      const veils = [
        { hue: colour,    cx: .30 + .24 * Math.sin(seconds / 11),       cy: .32 + .22 * Math.cos(seconds / 13),       spread: .80, alpha: .17 },
        { hue: '#22d3ee', cx: .72 + .22 * Math.sin(seconds / 9 + 2.1),  cy: .64 + .24 * Math.cos(seconds / 15 + 1.3), spread: .66, alpha: .13 },
        { hue: '#a855f7', cx: .52 + .28 * Math.cos(seconds / 17 + 4.2), cy: .44 + .26 * Math.sin(seconds / 12 + 3.1), spread: .92, alpha: .12 },
      ];
      context.save();
      context.globalCompositeOperation = 'lighter';
      for (const veil of veils) {
        const cx = width * veil.cx, cy = drawHeight * veil.cy;
        const veilGlow = context.createRadialGradient(cx, cy, 4, cx, cy, Math.max(width, drawHeight) * veil.spread);
        veilGlow.addColorStop(0, withAlpha(veil.hue, veil.alpha));
        veilGlow.addColorStop(.5, withAlpha(veil.hue, veil.alpha * .34));
        veilGlow.addColorStop(1, 'rgba(0,0,0,0)');
        context.fillStyle = veilGlow;
        context.fillRect(0, 0, width, drawHeight);
      }
      // Dust, drifting with the music. Depth costs eighty rectangles.
      for (const speck of dust) {
        const travelled = (speck.x * width - seconds * speck.speed * 9) % (width + 24);
        const px = travelled < 0 ? travelled + width + 24 : travelled;
        const twinkle = .3 + .7 * (.5 + .5 * Math.sin(seconds * speck.blink + speck.phase));
        // Faded out as it approaches the strike line, so the last stretch
        // before a note is judged is clean glass.
        const nearTheReading = Math.max(0, Math.min(1, (px - cursorX) / (width * .45)));
        context.fillStyle = withAlpha('#dbeafe', .16 * twinkle * nearTheReading);
        context.fillRect(px, speck.y * drawHeight, speck.size, speck.size);
      }
      // A horizon under it all, in the voice's own colour.
      const horizon = context.createLinearGradient(0, drawHeight * .72, 0, drawHeight);
      horizon.addColorStop(0, 'rgba(0,0,0,0)');
      horizon.addColorStop(1, withAlpha(colour, .12));
      context.fillStyle = horizon;
      context.fillRect(0, drawHeight * .72, width, drawHeight * .28);
      context.restore();
      // ---- the arena
      //
      // The notes travel right to left, so the distance is to the RIGHT: that
      // is where the road goes away to, and where the lights of a hall would
      // be. Lanes fan out from a vanishing point on the right edge and widen
      // as they come toward the singer, which is the whole trick -- the pitch
      // rows stay exactly where they were, perfectly linear and readable,
      // while everything BEHIND them says depth.
      const vanishX = width * 0.995, vanishY = drawHeight * 0.5;
      context.save();
      context.globalCompositeOperation = 'lighter';
      // Where the reading happens: from the strike line out to about half
      // way. Nothing decorative may live here.
      const clearOf = cursorX + (width - cursorX) * 0.46;
      for (let lane = -3; lane <= 3; lane++) {
        const spread = lane * drawHeight * 0.33;
        const fan = context.createLinearGradient(vanishX, vanishY, clearOf, vanishY + spread * 0.5);
        fan.addColorStop(0, withAlpha(colour, .13));
        fan.addColorStop(.6, withAlpha(colour, .04));
        fan.addColorStop(1, 'rgba(0,0,0,0)');
        context.strokeStyle = fan;
        context.lineWidth = lane === 0 ? 1.3 : .9;
        context.beginPath();
        context.moveTo(vanishX, vanishY);
        context.lineTo(clearOf, vanishY + spread * 0.5);
        context.stroke();
      }
      // Rungs across the road, compressing toward the distance and sliding
      // with the music, so the floor reads as travelling rather than sitting.
      const sweep = (position % 1) / 1;
      for (let rung = 0; rung < 9; rung++) {
        const depth = (rung + sweep) / 9;             // 0 near the singer, 1 far away
        const eased = Math.pow(depth, 2.4);
        const rx = vanishX - (vanishX - clearOf) * (1 - eased);
        const half = drawHeight * 0.3 * (1 - eased);
        context.strokeStyle = withAlpha(colour, .1 * (1 - depth));
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(rx, vanishY - half);
        context.lineTo(rx, vanishY + half);
        context.stroke();
      }
      // The hall beyond the road: lights, out of focus.
      for (const speck of dust) {
        // The roof of the hall only: the top tenth, and only out in the
        // distance. Lights the size of a notehead sitting on the staff were
        // not atmosphere, they were smudges on the glass.
        if (speck.y > .1) continue;
        const bx = clearOf + (width - clearOf) * speck.x;
        const by = drawHeight * speck.y * 1.6;
        const flare = 1.2 + speck.size * 1.4;
        const pulse = .45 + .55 * (.5 + .5 * Math.sin(seconds * speck.blink * .7 + speck.phase));
        const bokeh = context.createRadialGradient(bx, by, 0, bx, by, flare * 3);
        bokeh.addColorStop(0, withAlpha(speck.phase > 3 ? '#f0abfc' : '#67e8f9', .3 * pulse));
        bokeh.addColorStop(1, 'rgba(0,0,0,0)');
        context.fillStyle = bokeh;
        context.fillRect(bx - flare * 3, by - flare * 3, flare * 6, flare * 6);
      }
      context.restore();
      // And a vignette to hold the light in the middle, so the staff rows at
      // the edges stay readable instead of washing out.
      const vignette = context.createRadialGradient(
        width * .5, drawHeight * .5, Math.min(width, drawHeight) * .22,
        width * .5, drawHeight * .5, Math.max(width, drawHeight) * .78);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(2,4,12,.6)');
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, drawHeight);

      // ---- the road
      //
      // Time is DEPTH. A note's distance is how long until it is sung, and the
      // whole lane is drawn through one perspective divide.
      //
      // The near plane is the strike line, and that is what makes this safe:
      // at distance zero the scale is exactly 1, so a note being sung sits on
      // precisely the row it always did, and the pitch tabs down the left stay
      // true to the pixel. Only the FUTURE compresses, where a singer needs the
      // shape of the line coming and not a semitone measured by eye.
      // Chosen together so the far end of the look-ahead lands just inside
      // the right edge and the near end is exactly the strike line. A deeper
      // divide than this crushed every note into the last fifth of the lane
      // and none of them ever grew.
      const VP_X = width * 1.5;
      const VP_Y = drawHeight * 0.46;
      const DEPTH = 1.5;
      /** 1 at the strike line, smaller into the distance, larger as a sung note
       *  flies past the singer. Capped, or a note just behind the line would
       *  scale to infinity. */
      const scaleAt = (distance: number) => distance >= 0
        ? 1 / (1 + distance * DEPTH)
        : Math.min(1.8, 1 - distance * 2.6);
      const project = (time: number, midi: number) => {
        const k = scaleAt((time - position) / look);
        const flat = yForMidi(midi, low, high, drawHeight);
        return { x: VP_X - (VP_X - cursorX) * k, y: VP_Y + (flat - VP_Y) * k, k };
      };

      // Semitone rows, with the octaves picked out: a singer reads position
      // against these far faster than against a bare gradient. The names are
      // drawn later, over the notes, so nothing scrolls across them.
      const rowPx = (drawHeight - 20) / Math.max(1, high - low);
      for (let midi = Math.ceil(low); midi <= high; midi++) {
        const y = yForMidi(midi, low, high, drawHeight);
        const isOctave = ((midi % 12) + 12) % 12 === 0;
        // Each row is now a rail running away to the vanishing point. It leaves
        // the near plane at exactly the height it always had.
        const near = project(position - look * .22, midi);
        const far = project(position + look, midi);
        const rail = context.createLinearGradient(near.x, near.y, far.x, far.y);
        rail.addColorStop(0, isOctave ? 'rgba(148, 217, 255, .3)' : 'rgba(255,255,255,.1)');
        rail.addColorStop(1, isOctave ? 'rgba(148, 217, 255, .05)' : 'rgba(255,255,255,.015)');
        context.strokeStyle = rail;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(near.x, near.y);
        context.lineTo(far.x, far.y);
        context.stroke();
        void y;
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
        // The lit row narrows with the road, so it reads as a lane on the floor
        // rather than a stripe painted on the glass.
        const band = Math.max(9, rowPx * .92);
        const near = project(position - look * .22, aimed.midi);
        const far = project(position + look, aimed.midi);
        context.fillStyle = withAlpha(colour, .1);
        context.beginPath();
        context.moveTo(near.x, near.y - band * near.k / 2);
        context.lineTo(far.x, far.y - band * far.k / 2);
        context.lineTo(far.x, far.y + band * far.k / 2);
        context.lineTo(near.x, near.y + band * near.k / 2);
        context.closePath();
        context.fill();
      }

      // ---- notes
      // Already narrowed to this voice and sorted, so this is a time window on a
      // quarter of the notes rather than a part check across all of them.
      const visible = p.laneNotes.filter(note => note.end >= position - 1.2 && note.start <= position + look);

      for (const note of visible) {
        // Near end and far end, each with its own scale: a note is a slab lying
        // on the road, wider and taller at the end closest to being sung.
        const head = project(note.start, note.midi);
        const tail = project(note.end, note.midi);
        const x = head.x;
        const endX = tail.x;
        const y = head.y;
        const w = Math.max(6, endX - x - 2);
        // A note must never be taller than the row it sits in. The old floor of
        // 7px ignored the row entirely, so on a phone -- where eighteen
        // semitones can share 117px, a row every 5.4px -- neighbouring notes
        // were drawn overlapping and the line read as one smear of colour.
        // Thirteen pixels was a hard ceiling: hand the lane twice the height
        // and the notes stayed exactly as small, which is why the last three
        // passes at "bolder" changed the colour of things and never the size.
        // Now it takes nearly the whole row it is given.
        const h = Math.max(5, Math.min(34, rowPx * 0.95) * head.k);
        const tailH = Math.max(4, Math.min(34, rowPx * 0.95) * tail.k);
        const past = note.end <= position;
        const active = position >= note.start && position < note.end;
        const hit = p.hitNotes?.[note.id];

        // Approaching notes brighten as they near the line, so the eye is drawn
        // to what has to be sung next rather than to the whole road at once.
        const nearness = Math.max(0, Math.min(1, 1 - (note.start - position) / look));
        context.save();
        if (past) context.globalAlpha = hit ? .85 : .32;

        if (active || (!past && nearness > .45)) {
          context.shadowColor = withAlpha(colour, .95);
          context.shadowBlur = active ? 34 : 10 + nearness * 18;
        }
        const body = past ? (hit ? '#65d6a4' : '#44566d') : colour;
        // A lozenge with a light on it: bright lip along the top, the body
        // beneath, a darker floor. Three stops instead of two is the whole
        // difference between a painted rectangle and something with a shape.
        const gradient = context.createLinearGradient(x, y - h / 2, x, y + h / 2);
        void w;
        gradient.addColorStop(0, withAlpha('#ffffff', past ? .35 : .72));
        gradient.addColorStop(.42, withAlpha(body, 1));
        gradient.addColorStop(1, withAlpha(body, .6));
        context.fillStyle = gradient;
        // The slab itself: four corners, two of them further away.
        const slab = () => {
          context.beginPath();
          context.moveTo(x, y - h / 2);
          context.lineTo(endX, tail.y - tailH / 2);
          context.lineTo(endX, tail.y + tailH / 2);
          context.lineTo(x, y + h / 2);
          context.closePath();
        };
        context.lineJoin = 'round';
        slab();
        context.fill();
        // The rim: a hot bright edge all the way round, brightest on the note
        // about to be sung. It is the whole difference between a coloured
        // shape and a lit object, and it is what the reference had that this
        // did not.
        context.strokeStyle = past ? withAlpha('#ffffff', .16) : withAlpha('#ffffff', .45 + nearness * .45);
        context.lineWidth = past ? 1 : Math.max(1, 2 * head.k);
        slab();
        context.stroke();

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
          slab();
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
          slab();
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
          const cap = Math.min(15, Math.floor(h - 1));
          if (cap < 6) { context.restore(); continue; }
          const name = midiNoteName(note.midi);
          const wanted = note.lyric ? [name + ' ' + note.lyric, name, note.lyric] : [name];
          let label = '', size = 0;
          for (const candidate of wanted) {
            for (const px of [15, 14, 13, 12, 11, 10, 9, 8].filter(px => px <= cap)) {
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
          const at = project(sample.t, hzToMidi(sample.hz));
          if (!drawing) { context.moveTo(at.x, at.y); drawing = true; } else context.lineTo(at.x, at.y);
        }
        // Twice, so it has a core: a wide soft glow and a hot thin line
        // through the middle of it. That is what makes a drawn stroke look lit
        // rather than merely coloured.
        context.strokeStyle = 'rgba(56, 189, 248, .45)';
        context.shadowColor = 'rgba(56, 189, 248, .9)';
        context.shadowBlur = 16;
        context.lineWidth = 6;
        context.stroke();
        context.strokeStyle = 'rgba(224, 252, 255, .95)';
        context.shadowBlur = 6;
        context.lineWidth = 2;
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
      const gutter = 40;
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
        if (placed.some(other => Math.abs(other - y) < 15)) continue;
        placed.push(y);
        const isAimed = aimed?.midi === midi;
        const isOctave = ((midi % 12) + 12) % 12 === 0;
        // A tab with a point on it, aimed down the road at the note it names.
        // Loose text floating over a moving background was the one part of
        // this lane that still looked like a spreadsheet.
        const half = isAimed ? 12 : 10;
        context.beginPath();
        context.moveTo(1, y - half);
        context.lineTo(gutter - 9, y - half);
        context.lineTo(gutter - 1, y);
        context.lineTo(gutter - 9, y + half);
        context.lineTo(1, y + half);
        context.closePath();
        context.fillStyle = isAimed ? withAlpha(colour, .3) : 'rgba(10, 18, 36, .8)';
        context.fill();
        context.strokeStyle = isAimed ? withAlpha(colour, .95)
          : isOctave ? 'rgba(148, 217, 255, .4)' : 'rgba(148, 163, 184, .22)';
        context.lineWidth = isAimed ? 1.5 : 1;
        context.stroke();
        context.font = isAimed ? '800 13px ui-sans-serif, system-ui' : '700 11px ui-sans-serif, system-ui';
        context.fillStyle = isAimed ? '#ffffff'
          : isOctave ? 'rgba(186, 230, 253, .9)' : 'rgba(203, 213, 225, .72)';
        context.fillText(midiNoteName(midi), 5, y + 4);
      }

      // ---- the strike line, drawn last so nothing covers it
      //
      // It breathes: a sung note is being judged HERE, every moment, and a
      // line that pulses says so without a word of explanation. Faster while
      // a note is actually under it.
      const singing = Boolean(aimed && position >= aimed.start && position < aimed.end);
      const beat = 0.5 + 0.5 * Math.sin(Date.now() / (singing ? 150 : 420));
      const flare = context.createLinearGradient(cursorX - 44, 0, cursorX + 14, 0);
      flare.addColorStop(0, 'rgba(246,198,91,0)');
      flare.addColorStop(.75, `rgba(246,198,91,${(.10 + .10 * beat).toFixed(3)})`);
      flare.addColorStop(1, `rgba(255,236,170,${(.26 + .16 * beat).toFixed(3)})`);
      context.fillStyle = flare;
      context.fillRect(cursorX - 44, 0, 58, drawHeight);
      context.fillStyle = '#fff3c4';
      context.shadowColor = '#f6c65b';
      context.shadowBlur = 16 + 14 * beat;
      context.fillRect(cursorX - 1.5, 0, 3, drawHeight);
      // Caps top and bottom, so the line reads as a built thing rather than a
      // stray stroke.
      context.fillStyle = '#f6c65b';
      context.fillRect(cursorX - 5, 0, 10, 3);
      context.fillRect(cursorX - 5, drawHeight - 3, 10, 3);
      context.shadowBlur = 0;
      // A microphone sitting at the foot of the beam: this is the spot the
      // singing is measured at, and a picture says it faster than a label.
      const puckY = drawHeight - 13;
      context.beginPath();
      context.ellipse(cursorX, puckY, 15, 9, 0, 0, Math.PI * 2);
      context.fillStyle = 'rgba(8, 14, 30, .9)';
      context.fill();
      context.strokeStyle = withAlpha('#f6c65b', .8);
      context.lineWidth = 1.2;
      context.stroke();
      context.fillStyle = '#ffe9a8';
      roundRect(context, cursorX - 2, puckY - 5.5, 4, 7, 2);
      context.fill();
      context.beginPath();
      context.arc(cursorX, puckY - 1, 4.6, 0.15 * Math.PI, 0.85 * Math.PI);
      context.strokeStyle = '#ffe9a8';
      context.lineWidth = 1.2;
      context.stroke();
      context.fillRect(cursorX - .7, puckY + 3.5, 1.4, 3);

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
        // A halo that swells when the pitch is right: the loudest thing the
        // lane can say without words is "that one -- hold it".
        const onTarget = aimed ? Math.abs(hzToMidi(hz) - aimed.midi) < 0.6 : false;
        const halo = context.createRadialGradient(cursorX, y, 2, cursorX, y, onTarget ? 30 : 18);
        halo.addColorStop(0, withAlpha(onTarget ? '#86efac' : colour, onTarget ? .55 : .3));
        halo.addColorStop(1, 'rgba(0,0,0,0)');
        context.fillStyle = halo;
        context.fillRect(cursorX - 32, y - 32, 64, 64);
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
