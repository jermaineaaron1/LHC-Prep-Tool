'use client';

import type { SongNote } from '@/lib/vocal-hero/types';
import { hzToMidi, livePitchFeedback, midiNoteName } from '@/lib/vocal-hero/liveCues';

/** A run of consecutive voiced samples that all stood in the same relation to
 * the written note. `idle` is singing where nothing is written — between
 * phrases, or holding past the end of a note. That is not a wrong pitch, and
 * coloured as one it would flick amber at the end of every note. */
type TrailState = 'on' | 'off' | 'idle';
interface TrailSegment { points: string; state: TrailState }

/** How far from the written note still counts as "on it", for colouring only.
 * Scoring has its own tolerance; this is what the eye reads as correct. */
const TRAIL_IN_TUNE_CENTS = 50;
/** A gap longer than this is a breath or a rest, not a line to draw through. */
const TRAIL_GAP_SEC = 0.12;

function buildTrail(
  trail: TrailSample[] | undefined,
  elapsed: number,
  trailSeconds: number,
  lookAheadSeconds: number,
  cursor: number,
  trackWidth: number,
  partNotes: SongNote[],
  clampY: (midi: number) => number,
): TrailSegment[] {
  if (!trail?.length) return [];
  const segments: TrailSegment[] = [];
  let points: string[] = [];
  let segmentState: TrailState = 'idle';
  let previousT = -Infinity;

  const flush = () => {
    // A lone point draws nothing as a polyline, and two identical points draw
    // nothing either; both are noise rather than a line worth showing.
    if (points.length >= 2) segments.push({ points: points.join(' '), state: segmentState });
    points = [];
  };

  for (const sample of trail) {
    if (sample.hz <= 0 || sample.t < elapsed - trailSeconds || sample.t > elapsed) { flush(); previousT = -Infinity; continue; }
    const midi = hzToMidi(sample.hz);
    const note = partNotes.find(candidate => sample.t >= candidate.start && sample.t < candidate.end);
    const state: TrailState = !note ? 'idle'
      : Math.abs((midi - note.midi) * 100) <= TRAIL_IN_TUNE_CENTS ? 'on' : 'off';
    // Break the line where the voice stopped, and where it crossed between
    // being on the note and off it, so each stretch carries its own colour.
    if (sample.t - previousT > TRAIL_GAP_SEC || (points.length && state !== segmentState)) {
      const carry = points.length ? points[points.length - 1] : null;
      flush();
      // Carry the last point into the new segment so the line stays unbroken
      // across a colour change.
      if (carry && sample.t - previousT <= TRAIL_GAP_SEC) points.push(carry);
    }
    segmentState = state;
    const x = cursor + ((sample.t - elapsed) / lookAheadSeconds) * trackWidth;
    if (x >= 0) points.push(`${x.toFixed(2)},${clampY(midi).toFixed(1)}`);
    previousT = sample.t;
  }
  flush();
  return segments;
}

const VOICE_RANGES = [
  { low: 60, high: 81 }, // Soprano C4-A5
  { low: 53, high: 74 }, // Alto F3-D5
  { low: 48, high: 67 }, // Tenor C3-G4
  { low: 40, high: 64 }, // Bass E2-E4
];

/** One sample of what the singer actually sang, in song time. */
export interface TrailSample { t: number; hz: number }

/** Longest stretch of singing the lane will ever draw. */
const TRAIL_MEMORY_SEC = 4;

/**
 * Record a sample, and forget anything older than the lane can show. Mutates
 * the array it is given: this runs on every microphone sample, and a fresh
 * array each time would be a steady drip of work for the collector on the one
 * thread that has to stay smooth.
 */
export function pushTrail(trail: TrailSample[], songTime: number, hz: number): void {
  trail.push({ t: songTime, hz });
  const cutoff = songTime - TRAIL_MEMORY_SEC;
  let drop = 0;
  while (drop < trail.length && trail[drop].t < cutoff) drop++;
  if (drop) trail.splice(0, drop);
}

/** Starting a new round must not leave the previous round's line on screen. */
export function clearTrail(trail: TrailSample[]): void {
  trail.length = 0;
}

/** DOM pitch highway with one mathematically exact row per MIDI semitone. */
export function SatbLane({
  partIndex, partName, colour, elapsed, notes, pitchHz, playerCount, hitNotes = {}, compact = false,
  lookAheadSeconds = compact ? 5 : 10, showLyrics = !compact, trail, trailSeconds = 2.5,
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
  lookAheadSeconds?: number;
  showLyrics?: boolean;
  trail?: TrailSample[];
  trailSeconds?: number;
}) {
  const partNotes = notes.filter(note => note.part === partIndex || note.part === -1).sort((a, b) => a.start - b.start);
  const pitches = partNotes.map(note => note.midi);
  const fallback = VOICE_RANGES[partIndex] ?? { low: 48, high: 72 };
  let low = pitches.length ? Math.floor(Math.min(...pitches)) - 1 : fallback.low;
  let high = pitches.length ? Math.ceil(Math.max(...pitches)) + 1 : fallback.high;
  if (high - low < 12) { const middle = Math.round((high + low) / 2); low = middle - 6; high = middle + 6; }

  const pitchRows = Array.from({ length: high - low + 1 }, (_, index) => high - index);
  const rowHeight = compact ? 7 : 11;
  const headerHeight = compact ? 0 : 40;
  const gridPadding = compact ? 5 : 7;
  const laneHeight = headerHeight + pitchRows.length * rowHeight + gridPadding * 2;
  const cursor = 13;
  const trackWidth = 87;
  const yFor = (midi: number) => headerHeight + gridPadding + (high - midi + .5) * rowHeight;
  const visible = partNotes.filter(note => note.end >= elapsed - .6 && note.start <= elapsed + lookAheadSeconds);
  const target = partNotes.find(note => elapsed >= note.start && elapsed < note.end) ?? null;
  const next = partNotes.find(note => note.start > elapsed) ?? null;
  const displayPitchHz = pitchHz;
  const pitchY = displayPitchHz && displayPitchHz > 0
    ? Math.max(headerHeight + gridPadding, Math.min(laneHeight - gridPadding, yFor(hzToMidi(displayPitchHz))))
    : null;
  // The trail: the last couple of seconds of the singer's own pitch, drawn on
  // the same grid as the notes. A dot at the strike line says whether they are
  // right at this instant; it cannot show a scoop up into a note, a slow slide
  // flat across a long hold, or a wobble. Those are the things a singer has to
  // see before they can correct them.
  const clampY = (midi: number) => Math.max(headerHeight + gridPadding, Math.min(laneHeight - gridPadding, yFor(midi)));
  const trailSegments = buildTrail(trail, elapsed, trailSeconds, lookAheadSeconds, cursor, trackWidth, partNotes, clampY);

  const feedback = livePitchFeedback(target?.midi ?? null, pitchHz ?? 0);
  const timingLabel = target ? 'ON TIME' : next && next.start - elapsed <= .8 ? `GET READY · ${(next.start - elapsed).toFixed(1)}s` : 'WAIT';
  const feedbackColour = feedback.state === 'correct' ? '#6ee7b7' : feedback.state === 'high' || feedback.state === 'low' || feedback.state === 'octave' ? '#fbbf24' : '#94a3b8';

  return <section className="flex overflow-hidden rounded-2xl border border-white/10 bg-[#08111f]" style={{ height: laneHeight }} aria-label={`${partName} pitch lane`}>
    <div className="flex w-24 shrink-0 flex-col items-center justify-center border-r border-white/10 px-2" style={{ background: `${colour}18` }}>
      <strong className={compact ? 'text-base' : 'text-xl'} style={{ color: colour }}>{partName[0]}</strong>
      <span className="text-[10px] font-semibold uppercase tracking-[.16em]" style={{ color: colour }}>{partName}</span>
      {playerCount !== undefined && <span className="mt-1 text-xs text-slate-300">{playerCount} singers</span>}
    </div>
    <div className="relative min-w-0 flex-1 overflow-hidden bg-[#08111f]">
      {pitchRows.map((midi, index) => {
        const sharp = [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
        return <div key={midi} className={`pointer-events-none absolute left-0 right-0 border-t ${midi % 12 === 0 ? 'border-cyan-200/25' : 'border-white/[.07]'} ${sharp ? 'bg-black/20' : 'bg-white/[.015]'}`} style={{ top: headerHeight + gridPadding + index * rowHeight, height: rowHeight }}>
          <span className={`absolute left-0 z-10 flex h-full w-12 items-center justify-end border-r pr-1 font-mono font-black ${sharp ? 'border-slate-500/30 bg-[#050916] text-[8px] text-slate-400' : 'border-slate-200/20 bg-[#dbe8f4] text-[9px] text-[#122033]'}`}>{midiNoteName(midi)}</span>
        </div>;
      })}
      {trailSegments.length > 0 && <svg
        className="pointer-events-none absolute inset-0 z-[15] h-full w-full"
        viewBox={`0 0 100 ${laneHeight}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {trailSegments.map((segment, index) => <polyline
          key={index}
          points={segment.points}
          fill="none"
          // Without this the stroke is stretched by the same non-uniform scale
          // as the coordinates, and a 2px line becomes a smear.
          vectorEffect="non-scaling-stroke"
          stroke={segment.state === 'on' ? '#6ee7b7' : segment.state === 'off' ? '#fbbf24' : '#64748b'}
          strokeWidth={compact ? 1.5 : 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={segment.state === 'idle' ? .5 : segment.state === 'on' ? .95 : .8}
        />)}
      </svg>}
      <div className="absolute inset-y-0 z-20 w-[3px] bg-[#f6c65b] shadow-[0_0_14px_#f6c65b]" style={{ left: `${cursor}%` }} aria-label="Strike line" />
      <div className="absolute inset-y-0 border-l border-dashed border-white/10" style={{ left: '50%' }} />
      {!compact && <div className="absolute inset-x-0 top-0 z-30 grid h-10 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-white/10 bg-[#07101f]/95 px-3 pl-[14%] text-[10px] font-black uppercase tracking-[.13em]"><span style={{ color: feedbackColour }}>{feedback.label}<small className="ml-2 hidden font-medium normal-case tracking-normal text-slate-400 lg:inline">{feedback.instruction}</small></span><span className="hidden rounded-full border border-cyan-300/20 bg-cyan-300/[.06] px-3 py-1 text-[11px] tracking-normal text-white sm:inline-flex"><small className="mr-1 text-[8px] text-slate-500">YOU</small><b className="text-cyan-200">{feedback.detected}</b><span className="mx-2 text-slate-600">→</span><small className="mr-1 text-[8px] text-slate-500">TARGET</small><b>{feedback.target}</b></span><span className={`text-right ${target ? 'text-emerald-300' : 'text-amber-300'}`}>{timingLabel}</span></div>}
      {visible.map(note => {
        const left = cursor + ((note.start - elapsed) / lookAheadSeconds) * trackWidth;
        const width = Math.max(.35, ((note.end - note.start) / lookAheadSeconds) * trackWidth - .35);
        const past = note.end <= elapsed;
        const result = hitNotes[note.id];
        const fill = past ? (result ? '#65d6a4' : '#44566d') : colour;
        const active = target?.id === note.id;
        return <div key={note.id} title={`${midiNoteName(note.midi)} · ${note.lyric || 'no lyric'} · ${note.start.toFixed(2)}–${note.end.toFixed(2)}s`} className="absolute z-10 flex min-w-[4px] items-center overflow-hidden rounded border px-1 text-[10px] font-black text-[#07111d]" style={{ left: `${left}%`, top: yFor(note.midi), width: `${width}%`, height: Math.max(5, rowHeight - 2), transform: 'translateY(-50%)', background: fill, borderColor: active ? '#fff' : `${fill}bb`, boxShadow: active ? `0 0 0 2px #fff,0 0 20px ${fill}` : `0 0 10px ${fill}66`, opacity: past && !result ? .45 : 1 }}>
          {width > 2.5 && <span className="shrink-0">{midiNoteName(note.midi)}</span>}{showLyrics && width > 11 && note.lyric && <span className="ml-1 truncate border-l border-black/25 pl-1">{note.lyric}</span>}
        </div>;
      })}
      {pitchY !== null && <div className="absolute z-30 h-4 w-4 rounded-full border-2 border-white bg-[#07111d]" style={{ left: `calc(${cursor}% - 7px)`, top: pitchY, transform: 'translateY(-50%)', boxShadow: `0 0 18px ${colour}` }} aria-label="Detected pitch" />}
      {!partNotes.length && <p className="absolute inset-0 grid place-items-center text-xs text-slate-500">No playable notes in this song</p>}
      <div className="absolute bottom-1 right-3 text-[9px] font-semibold uppercase tracking-[.14em] text-slate-500">next {lookAheadSeconds}s</div>
    </div>
  </section>;
}
