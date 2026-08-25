'use client';

import React, { useMemo, useRef, useState } from 'react';
import type { SongNote } from '@/lib/vocal-hero/types';
import { accidentalMark, durationToSymbols, inferKeySignature, signatureAlteration, spellPitch, staffStep, type Accidental } from '@/lib/vocal-hero/notation';

// The score as an EDITING surface, not just a view. Soprano and alto share
// the treble staff, tenor and bass the bass staff, engraved white-on-dark.
// The editor's three tools all work here: Select drags a head (vertically by
// staff position — diatonic, the way a pencil moves on paper — and
// horizontally by beat), Draw clicks a note onto a staff at the palette's
// value, Erase removes what it touches.
//
// The playback cursor is deliberately NOT part of the engraving: the score
// body is memoised and only the thin cursor layer re-renders per frame —
// re-engraving four hundred SVG elements sixty times a second was the lag.

export interface ScoreBar { start: number; end: number; beatCount: number; numerator: number; denominator: number; number: number }
export type ScoreTool = 'select' | 'draw' | 'erase';

const GAP = 7;
const STEP = GAP / 2;
const BEAT_W = 36;
const BAR_PAD = 16;
const MARGIN_LEFT = 78;
const SYSTEM_W = 1120;
const TREBLE_MID = 66;
const BASS_MID = 152;
const LYRIC_Y = 110;
const SYSTEM_H = 214;

const FLAT_STEPS_TREBLE = [0, 3, -1, 2, -2, 1, -3];
const SHARP_STEPS_TREBLE = [4, 1, 5, 2, -1, 3, 0];
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

type Glyph = {
  id: string; part: number; x: number; y: number; step: number;
  value: number; dotted: boolean; tieFrom?: { x: number; y: number };
  mark: string | null; lyric: string; clefMid: number; system: number; midi: number;
};

export type DragPreview = { id: string; dSteps: number; dx: number } | null;

/** Diatonic step (relative to a clef's middle line) -> midi, spelled by the key. */
function stepToMidi(step: number, clef: 'treble' | 'bass', signature: number): number {
  const middleIndex = clef === 'treble' ? LETTERS.indexOf('B') + 4 * 7 : LETTERS.indexOf('D') + 3 * 7;
  const index = middleIndex + step;
  const letter = LETTERS[((index % 7) + 7) % 7];
  const octave = Math.floor(index / 7);
  return LETTER_PC[LETTERS.indexOf(letter)] + signatureAlteration(letter, signature) + 12 * (octave + 1);
}

export function ScoreView({ notes, bars, getPlayhead, selectedIds, tool, onSelectNote, onAddNote, onEraseNote, onDragCommit }: {
  notes: SongNote[]; bars: ScoreBar[];
  /** Read per frame by the cursor layer only — the engraving never re-renders for playback. */
  getPlayhead: () => number | null;
  selectedIds: string[]; tool: ScoreTool;
  onSelectNote: (id: string, part: number) => void;
  onAddNote: (staff: 'treble' | 'bass', time: number, midi: number) => void;
  onEraseNote: (id: string) => void;
  onDragCommit: (id: string, changes: { midi: number; start: number; end: number }) => void;
}) {
  const layout = useMemo(() => buildLayout(notes, bars), [notes, bars]);
  const [drag, setDrag] = useState<DragPreview>(null);
  const dragRef = useRef<{ id: string; note: SongNote; step: number; clef: 'treble' | 'bass'; originX: number; originY: number; secondsPerPx: number; moved: boolean } | null>(null);

  function beginDrag(event: React.PointerEvent, glyph: Glyph) {
    if (tool === 'erase') { onEraseNote(glyph.id); return; }
    onSelectNote(glyph.id, glyph.part);
    if (tool !== 'select') return;
    const note = notes.find(item => item.id === glyph.id);
    const bar = layout.barAt(note?.start ?? 0);
    if (!note || !bar) return;
    dragRef.current = {
      id: glyph.id, note, step: glyph.step, clef: glyph.clefMid === TREBLE_MID ? 'treble' : 'bass',
      originX: event.clientX, originY: event.clientY,
      secondsPerPx: (bar.end - bar.start) / (bar.width - BAR_PAD), moved: false,
    };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }
  function moveDrag(event: React.PointerEvent) {
    const active = dragRef.current;
    if (!active) return;
    const dSteps = Math.round((active.originY - event.clientY) / STEP);
    const dx = event.clientX - active.originX;
    if (!active.moved && Math.abs(dSteps) < 1 && Math.abs(dx) < 4) return;
    active.moved = true;
    setDrag({ id: active.id, dSteps, dx });
  }
  function endDrag() {
    const active = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!active || !active.moved) return;
    const preview = drag && drag.id === active.id ? drag : null;
    if (!preview) return;
    const newStep = active.step + preview.dSteps;
    const midi = preview.dSteps === 0 ? active.note.midi : stepToMidi(newStep, active.clef, layout.signature);
    const dTime = preview.dx * active.secondsPerPx;
    const start = Math.max(0, active.note.start + dTime);
    onDragCommit(active.id, { midi, start, end: start + (active.note.end - active.note.start) });
  }

  function staffClick(event: React.MouseEvent<SVGSVGElement>) {
    if (tool !== 'draw') return;
    if ((event.target as Element).closest('[data-glyph]')) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left - 12;
    const y = event.clientY - bounds.top;
    const system = Math.floor((y - 12) / SYSTEM_H);
    const yIn = y - 12 - system * SYSTEM_H;
    const clef: 'treble' | 'bass' | null =
      yIn > TREBLE_MID - 5 * GAP && yIn < TREBLE_MID + 5 * GAP ? 'treble'
      : yIn > BASS_MID - 5 * GAP && yIn < BASS_MID + 5 * GAP ? 'bass' : null;
    if (!clef) return;
    const time = layout.xyToTime(system, x);
    if (time === null) return;
    const step = Math.round(((clef === 'treble' ? TREBLE_MID : BASS_MID) - yIn) / STEP);
    onAddNote(clef, time, stepToMidi(step, clef, layout.signature));
  }

  return <div className="vh-editor-scrollbars relative h-full overflow-auto px-4 py-4">
    <ScoreBody layout={layout} selectedIds={selectedIds} drag={drag} tool={tool}
      onGlyphDown={beginDrag} onMove={moveDrag} onUp={endDrag} onStaffClick={staffClick} />
    <CursorLayer layout={layout} getPlayhead={getPlayhead} />
  </div>;
}

/** The engraving. Re-renders only when the music, the selection or an active
 *  drag changes — never for the playback cursor. */
const ScoreBody = React.memo(function ScoreBody({ layout, selectedIds, drag, tool, onGlyphDown, onMove, onUp, onStaffClick }: {
  layout: Layout; selectedIds: string[]; drag: DragPreview; tool: ScoreTool;
  onGlyphDown: (event: React.PointerEvent, glyph: Glyph) => void;
  onMove: (event: React.PointerEvent) => void;
  onUp: () => void;
  onStaffClick: (event: React.MouseEvent<SVGSVGElement>) => void;
}) {
  const selected = new Set(selectedIds);
  return <svg width={SYSTEM_W + 24} height={layout.systems * SYSTEM_H + 24} className="select-none"
    onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onClick={onStaffClick}
    style={{ cursor: tool === 'draw' ? 'crosshair' : undefined }}>
    {Array.from({ length: layout.systems }, (_, system) => {
      const top = system * SYSTEM_H;
      return <g key={system} transform={`translate(12 ${top + 12})`}>
        {[TREBLE_MID, BASS_MID].map(mid => [-2, -1, 0, 1, 2].map(line =>
          <line key={`${mid}-${line}`} x1={0} x2={layout.systemWidth(system)} y1={mid + line * GAP} y2={mid + line * GAP} stroke="#ffffff55" strokeWidth={1} />))}
        <line x1={0} x2={0} y1={TREBLE_MID - 2 * GAP} y2={BASS_MID + 2 * GAP} stroke="#ffffffaa" strokeWidth={1.4} />
        <text x={4} y={TREBLE_MID + 2 * GAP - 2} fontSize={46} fill="#ffffffd8" fontFamily="'Segoe UI Symbol','Noto Music',serif">𝄞</text>
        <text x={4} y={BASS_MID + 2} fontSize={38} fill="#ffffffd8" fontFamily="'Segoe UI Symbol','Noto Music',serif">𝄢</text>
        {layout.signatureGlyphs.map((glyph, i) => <g key={i}>
          <text x={34 + glyph.index * 7} y={TREBLE_MID - (glyph.trebleStep * STEP) + 4} fontSize={15} fill="#ffffffd8">{glyph.mark}</text>
          <text x={34 + glyph.index * 7} y={BASS_MID - ((glyph.trebleStep - 2) * STEP) + 4} fontSize={15} fill="#ffffffd8">{glyph.mark}</text>
        </g>)}
        {system === 0 && <g fontSize={15} fontWeight={800} fill="#ffffffd8" textAnchor="middle">
          <text x={66} y={TREBLE_MID - GAP + 5}>{layout.meter[0]}</text><text x={66} y={TREBLE_MID + GAP + 5}>{layout.meter[1]}</text>
          <text x={66} y={BASS_MID - GAP + 5}>{layout.meter[0]}</text><text x={66} y={BASS_MID + GAP + 5}>{layout.meter[1]}</text>
        </g>}
        {layout.barlines.filter(b => b.system === system).map((b, i) =>
          <g key={i}>
            <line x1={b.x} x2={b.x} y1={TREBLE_MID - 2 * GAP} y2={TREBLE_MID + 2 * GAP} stroke="#ffffff70" strokeWidth={1} />
            <line x1={b.x} x2={b.x} y1={BASS_MID - 2 * GAP} y2={BASS_MID + 2 * GAP} stroke="#ffffff70" strokeWidth={1} />
            <text x={b.x + 3} y={TREBLE_MID - 2 * GAP - 6} fontSize={9} fill="#ffffff50">{b.number}</text>
          </g>)}
      </g>;
    })}
    {layout.glyphs.map(glyph => {
      const top = glyph.system * SYSTEM_H + 12;
      const isSelected = selected.has(glyph.id);
      const dragging = drag && drag.id === glyph.id ? drag : null;
      const colour = dragging ? '#22d3ee' : isSelected ? '#ec4899' : '#ffffff';
      const gy = glyph.y - (dragging ? dragging.dSteps * STEP : 0);
      const gx = glyph.x + (dragging ? dragging.dx : 0);
      const stemUp = glyph.part === 0 || glyph.part === 2 || glyph.part === -1;
      const stemX = gx + (stemUp ? 4.4 : -4.4);
      const previewStep = glyph.step + (dragging ? dragging.dSteps : 0);
      const ledger: number[] = [];
      for (let line = 6; line <= Math.abs(previewStep); line += 2) ledger.push(previewStep > 0 ? line : -line);
      return <g key={`${glyph.id}-${glyph.x}`} data-glyph transform={`translate(12 ${top})`}
        onPointerDown={event => onGlyphDown(event, glyph)}
        style={{ cursor: tool === 'erase' ? 'not-allowed' : 'pointer' }}>
        {ledger.map(step => <line key={step} x1={gx - 8} x2={gx + 8} y1={glyph.clefMid - step * STEP} y2={glyph.clefMid - step * STEP} stroke="#ffffff55" strokeWidth={1} />)}
        {glyph.mark && !dragging && <text x={gx - 15} y={gy + 4.5} fontSize={13} fill={colour}>{glyph.mark}</text>}
        <ellipse cx={gx} cy={gy} rx={4.8} ry={3.5} transform={`rotate(-14 ${gx} ${gy})`}
          fill={glyph.value >= 2 ? 'transparent' : colour} stroke={colour} strokeWidth={glyph.value >= 2 ? 1.6 : 1} />
        {glyph.value < 4 && <line x1={stemX} x2={stemX} y1={gy} y2={gy + (stemUp ? -26 : 26)} stroke={colour} strokeWidth={1.1} />}
        {glyph.value <= 0.5 && <path d={stemUp
          ? `M ${stemX} ${gy - 26} c 6 4, 9 8, 6 16`
          : `M ${stemX} ${gy + 26} c 6 -4, 9 -8, 6 -16`} stroke={colour} strokeWidth={1.4} fill="none" />}
        {glyph.value <= 0.25 && <path d={stemUp
          ? `M ${stemX} ${gy - 20} c 6 4, 9 8, 6 16`
          : `M ${stemX} ${gy + 20} c 6 -4, 9 -8, 6 -16`} stroke={colour} strokeWidth={1.4} fill="none" />}
        {glyph.dotted && <circle cx={gx + 8.5} cy={glyph.step % 2 === 0 ? gy - STEP : gy} r={1.7} fill={colour} />}
        {glyph.tieFrom && glyph.tieFrom.x < glyph.x && !dragging &&
          <path d={`M ${glyph.tieFrom.x + 5} ${glyph.tieFrom.y + 6} Q ${(glyph.tieFrom.x + glyph.x) / 2} ${glyph.tieFrom.y + 12}, ${glyph.x - 5} ${glyph.y + 6}`} stroke={colour} strokeWidth={1.1} fill="none" />}
        {glyph.lyric && <text x={glyph.x} y={LYRIC_Y} fontSize={10.5} fill={isSelected ? '#ec4899' : '#cbd5e1'} textAnchor="middle">{glyph.lyric}</text>}
      </g>;
    })}
  </svg>;
});

/** The one thing that moves during playback. An absolutely positioned line,
 *  driven by its own animation frame — the engraving under it never renders. */
function CursorLayer({ layout, getPlayhead }: { layout: Layout; getPlayhead: () => number | null }) {
  const lineRef = useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    let frame = 0;
    const tick = () => {
      const line = lineRef.current;
      if (line) {
        const time = getPlayhead();
        const at = time !== null ? layout.timeToXY(time) : null;
        if (at) {
          line.style.display = 'block';
          line.style.transform = `translate(${at.x + 12 + 16}px, ${at.system * SYSTEM_H + 12 + TREBLE_MID - 3 * GAP + 16}px)`;
        } else line.style.display = 'none';
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [layout, getPlayhead]);
  return <div ref={lineRef} className="pointer-events-none absolute left-0 top-0 w-0.5 rounded bg-cyan-300/80"
    style={{ height: BASS_MID - TREBLE_MID + 6 * GAP, display: 'none' }} />;
}

type Layout = ReturnType<typeof buildLayout>;

function buildLayout(notes: SongNote[], rawBars: ScoreBar[]) {
  const offset = notes.length ? Math.min(...notes.map(note => note.start)) : 0;
  const bars = rawBars.map(bar => ({ ...bar, start: bar.start + offset, end: bar.end + offset }));
  const signature = inferKeySignature(notes.map(note => note.midi));
  const mark = signature > 0 ? '♯' : '♭';
  const steps = signature > 0 ? SHARP_STEPS_TREBLE : FLAT_STEPS_TREBLE;
  const signatureGlyphs = Array.from({ length: Math.abs(signature) }, (_, index) => ({ index, mark, trebleStep: steps[index] }));

  const usable = SYSTEM_W - MARGIN_LEFT - 12;
  type PlacedBar = ScoreBar & { system: number; x: number; width: number };
  const placed: PlacedBar[] = [];
  let system = 0, x = MARGIN_LEFT;
  for (const bar of bars) {
    const width = bar.beatCount * BEAT_W + BAR_PAD;
    if (x + width > MARGIN_LEFT + usable && x > MARGIN_LEFT) { system += 1; x = MARGIN_LEFT; }
    placed.push({ ...bar, system, x, width });
    x += width;
  }
  const systems = (placed.at(-1)?.system ?? 0) + 1;
  const barlines = placed.map(bar => ({ system: bar.system, x: bar.x + bar.width, number: bar.number + 1 }));
  const barAt = (time: number) => placed.find(item => time + 0.01 >= item.start && time + 0.01 < item.end) ?? placed.at(-1);
  const timeToXY = (time: number) => {
    const bar = barAt(time);
    if (!bar) return null;
    const frac = Math.max(0, Math.min(1, (time - bar.start) / Math.max(0.001, bar.end - bar.start)));
    return { system: bar.system, x: bar.x + 6 + frac * (bar.width - BAR_PAD) };
  };
  const xyToTime = (systemIndex: number, x: number) => {
    const bar = placed.find(item => item.system === systemIndex && x >= item.x && x < item.x + item.width);
    if (!bar) return null;
    const frac = Math.max(0, Math.min(1, (x - bar.x - 6) / Math.max(1, bar.width - BAR_PAD)));
    return bar.start + frac * (bar.end - bar.start);
  };
  const systemWidth = (index: number) => {
    const last = placed.filter(bar => bar.system === index).at(-1);
    return last ? last.x + last.width : SYSTEM_W - 12;
  };

  const glyphs: Glyph[] = [];
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.part - b.part);
  const barStates = new Map<string, Map<string, Accidental>>();
  for (const note of sorted) {
    const clef = note.part >= 2 ? 'bass' : 'treble';
    const clefMid = clef === 'bass' ? BASS_MID : TREBLE_MID;
    const pitch = spellPitch(note.midi, signature);
    const step = staffStep(pitch, clef);
    let spanStart = note.start;
    let previous: { x: number; y: number } | null = null;
    let first = true;
    while (spanStart < note.end - 0.001) {
      const probe = spanStart + 0.01;
      const bar = placed.find(item => probe >= item.start && probe < item.end) ?? placed.at(-1);
      if (!bar) break;
      const spanEnd = Math.min(note.end, bar.end);
      if (spanEnd - spanStart < 0.04) { spanStart = spanEnd; continue; }
      const beatLen = (bar.end - bar.start) / bar.beatCount;
      const symbols = durationToSymbols((spanEnd - spanStart) / beatLen);
      let symbolTime = spanStart;
      const state = barStates.get(`${bar.number}-${clef}`) ?? new Map<string, Accidental>();
      barStates.set(`${bar.number}-${clef}`, state);
      for (const symbol of symbols) {
        const position = timeToXY(symbolTime)!;
        const y = clefMid - step * STEP;
        glyphs.push({
          id: note.id, part: note.part, x: position.x, y, step, midi: note.midi,
          value: symbol.value, dotted: symbol.dotted,
          tieFrom: previous ?? undefined,
          mark: first ? accidentalMark(pitch, signature, state) : null,
          lyric: first && (note.part === 0 || note.part === -1) ? note.lyric ?? '' : '',
          clefMid, system: position.system,
        });
        previous = { x: position.x, y };
        first = false;
        symbolTime += symbol.value * (symbol.dotted ? 1.5 : 1) * beatLen;
      }
      spanStart = spanEnd;
    }
  }
  const byMoment = new Map<string, Glyph[]>();
  for (const glyph of glyphs) {
    const key = `${Math.round(glyph.x)}-${glyph.clefMid}`;
    const list = byMoment.get(key) ?? [];
    list.push(glyph); byMoment.set(key, list);
  }
  for (const list of byMoment.values()) {
    if (list.length < 2) continue;
    for (const a of list) for (const b of list) {
      if (a === b || Math.abs(a.step - b.step) > 1) continue;
      const down = [a, b].find(g => g.part === 1 || g.part === 3);
      if (down && a.step !== b.step) down.x -= 8;
    }
  }
  const meter: [number, number] = [bars[0]?.numerator ?? 4, bars[0]?.denominator ?? 4];
  return { glyphs, systems, barlines, signatureGlyphs, meter, signature, timeToXY, xyToTime, barAt, systemWidth };
}
