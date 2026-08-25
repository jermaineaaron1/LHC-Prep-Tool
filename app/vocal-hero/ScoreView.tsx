'use client';

import React, { useMemo, useRef, useState } from 'react';
import type { SongNote } from '@/lib/vocal-hero/types';
import { accidentalMark, durationToSymbols, inferKeySignature, signatureAlteration, spellPitch, staffStep, type Accidental } from '@/lib/vocal-hero/notation';

// The OPEN choral score, as the approved redesign draws it: every voice on
// its own staff — soprano and alto in treble, tenor in the octave-G clef
// (written an octave above sounding, so tenor lines sit on the staff instead
// of drowning in ledger lines), bass in bass clef. Lyrics ride under the
// soprano staff, the line everyone follows. One staff per voice also makes
// editing unambiguous: the staff you touch IS the voice you're writing.
//
// Interaction is one mode, as the mockup insists: click a head to select,
// drag it (vertically by staff position — diatonic — horizontally by beat),
// click empty staff space to enter a note at the palette's value, press
// Delete to remove. The playback cursor is a separate layer driven by its
// own animation frame; the engraving never re-renders for playback.

export interface ScoreBar { start: number; end: number; beatCount: number; numerator: number; denominator: number; number: number }
export type ScoreTool = 'select' | 'draw' | 'erase';

const GAP = 7;
const STEP = GAP / 2;
const BEAT_W = 36;
const BAR_PAD = 16;
const MARGIN_LEFT = 78;
const SYSTEM_W = 1120;
const STAFF_MIDS = [56, 132, 208, 284];
const LYRIC_Y = 96;
const SYSTEM_H = 342;
const VOICE_COLOURS = ['#ff60bc', '#a965ff', '#22d3ee', '#ffbd45'];

type StaffClef = 'treble' | 'treble8' | 'bass';
const STAFF_CLEFS: StaffClef[] = ['treble', 'treble', 'treble8', 'bass'];
const staffOfPart = (part: number) => part < 0 ? 0 : Math.min(3, Math.max(0, part));

const FLAT_STEPS_TREBLE = [0, 3, -1, 2, -2, 1, -3];
const SHARP_STEPS_TREBLE = [4, 1, 5, 2, -1, 3, 0];
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

/** Written staff step for a sounding pitch on a given clef. */
function stepOnClef(midi: number, signature: number, clef: StaffClef): number {
  const pitch = spellPitch(midi, signature);
  if (clef === 'bass') return staffStep(pitch, 'bass');
  const treble = staffStep(pitch, 'treble');
  return clef === 'treble8' ? treble + 7 : treble;
}

/** Sounding midi for a written staff step on a clef, spelled by the key. */
function stepToMidi(step: number, clef: StaffClef, signature: number): number {
  const writtenStep = clef === 'treble8' ? step - 7 : step;
  const base = clef === 'bass' ? ['D', 3] as const : ['B', 4] as const;
  const middleIndex = LETTERS.indexOf(base[0]) + base[1] * 7;
  const index = middleIndex + writtenStep;
  const letter = LETTERS[((index % 7) + 7) % 7];
  const octave = Math.floor(index / 7);
  return LETTER_PC[LETTERS.indexOf(letter)] + signatureAlteration(letter, signature) + 12 * (octave + 1);
}

type Glyph = {
  id: string; part: number; x: number; y: number; step: number;
  value: number; dotted: boolean; tieFrom?: { x: number; y: number };
  mark: string | null; lyric: string; staff: number; system: number; midi: number;
  /** For beaming: which bar and beat this symbol starts in. */
  barNumber: number; beat: number;
  /** Set when the symbol belongs to a beam group: the stem direction the
   *  group agreed on, and the y the stems all reach. */
  beam?: { up: boolean; y: number };
};

type Beam = { system: number; x1: number; x2: number; y: number; up: boolean; double: boolean };

export type DragPreview = { id: string; dSteps: number; dx: number } | null;

export function ScoreView({ notes, bars, getPlayhead, selectedIds, tool, onSelectNote, onAddNote, onEraseNote, onDragCommit, onLyricChange, signature }: {
  notes: SongNote[]; bars: ScoreBar[];
  getPlayhead: () => number | null;
  selectedIds: string[]; tool: ScoreTool;
  onSelectNote: (id: string, part: number) => void;
  /** part comes from the staff that was clicked — the staff IS the voice. */
  onAddNote: (part: number, time: number, midi: number) => void;
  onEraseNote: (id: string) => void;
  onDragCommit: (id: string, changes: { midi: number; start: number; end: number }) => void;
  onLyricChange: (id: string, lyric: string) => void;
  /** Spell in this key instead of inferring one — a compiled rendition with
   *  a lifted last verse stays spelled in the song's own key, and the lift
   *  wears its honest accidentals. */
  signature?: number;
}) {
  const layout = useMemo(() => buildLayout(notes, bars, signature), [notes, bars, signature]);
  const [drag, setDrag] = useState<DragPreview>(null);
  // Inline lyric editing: double-click a word under the melody (or the empty
  // spot where one belongs), type, Tab to the next note, Enter to finish.
  const [lyricEdit, setLyricEdit] = useState<{ id: string; x: number; system: number; value: string } | null>(null);
  const melodyAnchors = useMemo(() => layout.glyphs
    .filter(g => g.staff === 0 && (g.part === 0 || g.part === -1))
    .filter((g, i, all) => all.findIndex(o => o.id === g.id) === i)
    .sort((a, b) => a.system - b.system || a.x - b.x), [layout]);
  function startLyricEdit(anchor: { id: string; x: number; system: number }) {
    const note = notes.find(n => n.id === anchor.id);
    setLyricEdit({ id: anchor.id, x: anchor.x, system: anchor.system, value: note?.lyric ?? '' });
  }
  function commitLyric(advance: boolean) {
    if (!lyricEdit) return;
    onLyricChange(lyricEdit.id, lyricEdit.value.trim());
    if (!advance) { setLyricEdit(null); return; }
    const index = melodyAnchors.findIndex(a => a.id === lyricEdit.id);
    const next = melodyAnchors[index + 1];
    if (next) startLyricEdit(next); else setLyricEdit(null);
  }
  function lyricBandDoubleClick(event: React.MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left - 12;
    const y = event.clientY - bounds.top;
    const system = Math.floor((y - 12) / SYSTEM_H);
    const yIn = y - 12 - system * SYSTEM_H;
    if (yIn < STAFF_MIDS[0] + 5 * GAP || yIn > LYRIC_Y + 12) return;
    const candidates = melodyAnchors.filter(a => a.system === system);
    if (!candidates.length) return;
    const nearest = candidates.reduce((best, a) => Math.abs(a.x - x) < Math.abs(best.x - x) ? a : best, candidates[0]);
    if (Math.abs(nearest.x - x) > 40) return;
    startLyricEdit(nearest);
  }
  const dragRef = useRef<{ id: string; note: SongNote; step: number; clef: StaffClef; originX: number; originY: number; secondsPerPx: number; moved: boolean } | null>(null);

  function beginDrag(event: React.PointerEvent, glyph: Glyph) {
    if (tool === 'erase') { onEraseNote(glyph.id); return; }
    onSelectNote(glyph.id, glyph.part);
    const note = notes.find(item => item.id === glyph.id);
    const bar = layout.barAt(note?.start ?? 0);
    if (!note || !bar) return;
    dragRef.current = {
      id: glyph.id, note, step: glyph.step, clef: STAFF_CLEFS[glyph.staff],
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
    const midi = preview.dSteps === 0 ? active.note.midi : stepToMidi(active.step + preview.dSteps, active.clef, layout.signature);
    const dTime = preview.dx * active.secondsPerPx;
    const start = Math.max(0, active.note.start + dTime);
    onDragCommit(active.id, { midi, start, end: start + (active.note.end - active.note.start) });
  }

  function staffClick(event: React.MouseEvent<SVGSVGElement>) {
    // One mode: empty staff space enters a note; heads handle themselves.
    if ((event.target as Element).closest('[data-glyph]')) return;
    if (tool === 'erase') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left - 12;
    const y = event.clientY - bounds.top;
    const system = Math.floor((y - 12) / SYSTEM_H);
    const yIn = y - 12 - system * SYSTEM_H;
    const staff = STAFF_MIDS.findIndex(mid => yIn > mid - 5 * GAP && yIn < mid + 5 * GAP);
    if (staff < 0) return;
    const time = layout.xyToTime(system, x);
    if (time === null) return;
    const step = Math.round((STAFF_MIDS[staff] - yIn) / STEP);
    onAddNote(staff, time, stepToMidi(step, STAFF_CLEFS[staff], layout.signature));
  }

  return <div className="vh-editor-scrollbars relative h-full overflow-auto px-4 py-4">
    <ScoreBody layout={layout} selectedIds={selectedIds} drag={drag} tool={tool}
      onGlyphDown={beginDrag} onMove={moveDrag} onUp={endDrag} onStaffClick={staffClick} onDoubleClick={lyricBandDoubleClick} />
    <CursorLayer layout={layout} getPlayhead={getPlayhead} />
    {lyricEdit && <input autoFocus value={lyricEdit.value}
      onChange={event => setLyricEdit(current => current && { ...current, value: event.target.value })}
      onKeyDown={event => {
        if (event.key === 'Tab') { event.preventDefault(); commitLyric(true); }
        else if (event.key === 'Enter') { event.preventDefault(); commitLyric(false); }
        else if (event.key === 'Escape') setLyricEdit(null);
      }}
      onBlur={() => commitLyric(false)}
      aria-label="Lyric for the selected note"
      className="absolute z-20 w-24 rounded border border-fuchsia-300/60 bg-[#100a1f] px-1.5 py-0.5 text-center text-xs text-white shadow-[0_0_18px_#ec489944]"
      style={{ left: lyricEdit.x + 12 + 16 - 48, top: lyricEdit.system * SYSTEM_H + 12 + LYRIC_Y + 16 - 12 }} />}
  </div>;
}

const ScoreBody = React.memo(function ScoreBody({ layout, selectedIds, drag, tool, onGlyphDown, onMove, onUp, onStaffClick, onDoubleClick }: {
  layout: Layout; selectedIds: string[]; drag: DragPreview; tool: ScoreTool;
  onGlyphDown: (event: React.PointerEvent, glyph: Glyph) => void;
  onMove: (event: React.PointerEvent) => void;
  onUp: () => void;
  onStaffClick: (event: React.MouseEvent<SVGSVGElement>) => void;
  onDoubleClick: (event: React.MouseEvent<SVGSVGElement>) => void;
}) {
  const selected = new Set(selectedIds);
  return <svg width={SYSTEM_W + 24} height={layout.systems * SYSTEM_H + 24} className="select-none"
    onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onClick={onStaffClick} onDoubleClick={onDoubleClick}
    style={{ cursor: tool === 'erase' ? 'not-allowed' : 'crosshair' }}>
    {Array.from({ length: layout.systems }, (_, system) => {
      const top = system * SYSTEM_H;
      return <g key={system} transform={`translate(12 ${top + 12})`}>
        {STAFF_MIDS.map(mid => [-2, -1, 0, 1, 2].map(line =>
          <line key={`${mid}-${line}`} x1={0} x2={layout.systemWidth(system)} y1={mid + line * GAP} y2={mid + line * GAP} stroke="#ffffff55" strokeWidth={1} />))}
        <line x1={0} x2={0} y1={STAFF_MIDS[0] - 2 * GAP} y2={STAFF_MIDS[3] + 2 * GAP} stroke="#ffffffaa" strokeWidth={1.6} />
        {STAFF_MIDS.map((mid, staff) => {
          const clef = STAFF_CLEFS[staff];
          return <g key={staff}>
            {clef === 'bass'
              ? <text x={4} y={mid + 2} fontSize={38} fill="#ffffffd8" fontFamily="'Segoe UI Symbol','Noto Music',serif">𝄢</text>
              : <>
                <text x={4} y={mid + 2 * GAP - 2} fontSize={46} fill="#ffffffd8" fontFamily="'Segoe UI Symbol','Noto Music',serif">𝄞</text>
                {clef === 'treble8' && <text x={12} y={mid + 3.4 * GAP} fontSize={11} fontWeight={700} fill="#ffffffb8">8</text>}
              </>}
            {layout.signatureGlyphs.map((glyph, i) =>
              <text key={i} x={34 + glyph.index * 7} y={mid - ((glyph.trebleStep + (clef === 'bass' ? -2 : 0)) * STEP) + 4} fontSize={15} fill="#ffffffd8">{glyph.mark}</text>)}
            {system === 0 && <g fontSize={15} fontWeight={800} fill="#ffffffd8" textAnchor="middle">
              <text x={66} y={mid - GAP + 5}>{layout.meter[0]}</text><text x={66} y={mid + GAP + 5}>{layout.meter[1]}</text>
            </g>}
            <circle cx={-6} cy={mid} r={2.4} fill={VOICE_COLOURS[staff]} />
          </g>;
        })}
        {layout.barlines.filter(b => b.system === system).map((b, i) =>
          <g key={i}>
            {STAFF_MIDS.map(mid => <line key={mid} x1={b.x} x2={b.x} y1={mid - 2 * GAP} y2={mid + 2 * GAP} stroke="#ffffff70" strokeWidth={1} />)}
            <text x={b.x + 3} y={STAFF_MIDS[0] - 2 * GAP - 6} fontSize={9} fill="#ffffff50">{b.number}</text>
          </g>)}
      </g>;
    })}
    {layout.beams.map((beam, i) => <g key={`beam-${i}`} transform={`translate(12 ${beam.system * SYSTEM_H + 12})`}>
      <line x1={beam.x1} x2={beam.x2} y1={beam.y} y2={beam.y} stroke="#ffffff" strokeWidth={3.2} />
      {beam.double && <line x1={beam.x1} x2={beam.x2} y1={beam.y + (beam.up ? 5 : -5)} y2={beam.y + (beam.up ? 5 : -5)} stroke="#ffffff" strokeWidth={3.2} />}
    </g>)}
    {layout.glyphs.map(glyph => {
      const top = glyph.system * SYSTEM_H + 12;
      const isSelected = selected.has(glyph.id);
      const dragging = drag && drag.id === glyph.id ? drag : null;
      const colour = dragging ? '#22d3ee' : isSelected ? '#ec4899' : '#ffffff';
      const gy = glyph.y - (dragging ? dragging.dSteps * STEP : 0);
      const gx = glyph.x + (dragging ? dragging.dx : 0);
      const previewStep = glyph.step + (dragging ? dragging.dSteps : 0);
      // One voice per staff: stems follow the engraving rule — up below the
      // middle line, down on or above it — unless a beam group has already
      // agreed a direction for the whole figure.
      const stemUp = glyph.beam ? glyph.beam.up : previewStep < 0;
      const stemX = gx + (stemUp ? 4.4 : -4.4);
      const stemEndY = glyph.beam && !dragging ? glyph.beam.y : gy + (stemUp ? -26 : 26);
      const mid = STAFF_MIDS[glyph.staff];
      const ledger: number[] = [];
      for (let line = 6; line <= Math.abs(previewStep); line += 2) ledger.push(previewStep > 0 ? line : -line);
      return <g key={`${glyph.id}-${glyph.x}`} data-glyph transform={`translate(12 ${top})`}
        onPointerDown={event => onGlyphDown(event, glyph)}
        style={{ cursor: tool === 'erase' ? 'not-allowed' : 'pointer' }}>
        {ledger.map(step => <line key={step} x1={gx - 8} x2={gx + 8} y1={mid - step * STEP} y2={mid - step * STEP} stroke="#ffffff55" strokeWidth={1} />)}
        {glyph.mark && !dragging && <text x={gx - 15} y={gy + 4.5} fontSize={13} fill={colour}>{glyph.mark}</text>}
        {/* An invisible catch area: the printed head is ~5px, far too small a
            target — clicks meant for the note were landing on "empty staff"
            and writing a new one instead. */}
        <circle cx={gx} cy={gy} r={9} fill="transparent" stroke="none" />
        <ellipse cx={gx} cy={gy} rx={4.8} ry={3.5} transform={`rotate(-14 ${gx} ${gy})`}
          fill={glyph.value >= 2 ? 'transparent' : colour} stroke={colour} strokeWidth={glyph.value >= 2 ? 1.6 : 1} />
        {glyph.value < 4 && <line x1={stemX} x2={stemX} y1={gy} y2={stemEndY} stroke={colour} strokeWidth={1.1} />}
        {glyph.value <= 0.5 && !glyph.beam && <path d={stemUp
          ? `M ${stemX} ${gy - 26} c 6 4, 9 8, 6 16`
          : `M ${stemX} ${gy + 26} c 6 -4, 9 -8, 6 -16`} stroke={colour} strokeWidth={1.4} fill="none" />}
        {glyph.value <= 0.25 && !glyph.beam && <path d={stemUp
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
          line.style.transform = `translate(${at.x + 12 + 16}px, ${at.system * SYSTEM_H + 12 + STAFF_MIDS[0] - 3 * GAP + 16}px)`;
        } else line.style.display = 'none';
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [layout, getPlayhead]);
  return <div ref={lineRef} className="pointer-events-none absolute left-0 top-0 w-0.5 rounded bg-cyan-300/80"
    style={{ height: STAFF_MIDS[3] - STAFF_MIDS[0] + 6 * GAP, display: 'none' }} />;
}

type Layout = ReturnType<typeof buildLayout>;

function buildLayout(notes: SongNote[], rawBars: ScoreBar[], signatureOverride?: number) {
  // The page opens where the music does: whole bars of lead-in silence are
  // dropped, not shifted — shifting the grid under the notes broke any bar
  // list whose lengths vary (a rendition with a broader pass), and it made
  // the printed bar numbers disagree with the entry caret's.
  const offset = notes.length ? Math.min(...notes.map(note => note.start)) : 0;
  const bars = rawBars.filter(bar => bar.end > offset + 0.01);
  const signature = signatureOverride ?? inferKeySignature(notes.map(note => note.midi));
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
  const barAt = (time: number) => {
    if (placed.length && time + 0.01 < placed[0].start) return placed[0];
    return placed.find(item => time + 0.01 >= item.start && time + 0.01 < item.end) ?? placed.at(-1);
  };
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
    const staff = staffOfPart(note.part);
    const clef = STAFF_CLEFS[staff];
    const mid = STAFF_MIDS[staff];
    const pitch = spellPitch(note.midi, signature);
    const step = stepOnClef(note.midi, signature, clef);
    let spanStart = note.start;
    let previous: { x: number; y: number } | null = null;
    let first = true;
    while (spanStart < note.end - 0.001) {
      const probe = spanStart + 0.01;
      const bar = placed.find(item => probe >= item.start && probe < item.end) ?? placed.at(-1);
      if (!bar) break;
      const spanEnd = Math.min(note.end, bar.end);
      // A note past the last bar would pin spanEnd behind spanStart and spin
      // this loop forever — draw what fits and stop.
      if (spanEnd <= spanStart + 0.0001) break;
      if (spanEnd - spanStart < 0.04) { spanStart = spanEnd; continue; }
      const beatLen = (bar.end - bar.start) / bar.beatCount;
      const symbols = durationToSymbols((spanEnd - spanStart) / beatLen);
      let symbolTime = spanStart;
      const state = barStates.get(`${bar.number}-${staff}`) ?? new Map<string, Accidental>();
      barStates.set(`${bar.number}-${staff}`, state);
      for (const symbol of symbols) {
        const position = timeToXY(symbolTime)!;
        const y = mid - step * STEP;
        glyphs.push({
          id: note.id, part: note.part, x: position.x, y, step, midi: note.midi,
          value: symbol.value, dotted: symbol.dotted,
          tieFrom: previous ?? undefined,
          mark: first ? accidentalMark(pitch, signature, state) : null,
          lyric: first && (note.part === 0 || note.part === -1) ? note.lyric ?? '' : '',
          staff, system: position.system,
          barNumber: bar.number, beat: Math.floor((symbolTime - bar.start) / beatLen + 1e-6),
        });
        previous = { x: position.x, y };
        first = false;
        symbolTime += symbol.value * (symbol.dotted ? 1.5 : 1) * beatLen;
      }
      spanStart = spanEnd;
    }
  }
  // Beaming — the rule a reader expects: quavers and semiquavers that share
  // a beat share a beam, flags only for the ones left on their own. Groups
  // never cross a barline or a beat boundary; the group takes one stem
  // direction (the majority's) and a flat beam at the extreme stem end.
  const beams: Beam[] = [];
  const byStaff = new Map<string, Glyph[]>();
  for (const glyph of glyphs) {
    if (glyph.value > 0.5) continue;
    const key = `${glyph.staff}-${glyph.barNumber}-${glyph.beat}`;
    const list = byStaff.get(key) ?? [];
    list.push(glyph); byStaff.set(key, list);
  }
  for (const group of byStaff.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.x - b.x);
    const up = group.filter(g => g.step < 0).length >= group.length / 2;
    const stemLen = 26;
    const y = up
      ? Math.min(...group.map(g => g.y)) - stemLen
      : Math.max(...group.map(g => g.y)) + stemLen;
    for (const glyph of group) glyph.beam = { up, y };
    const x1 = group[0].x + (up ? 4.4 : -4.4);
    const x2 = group[group.length - 1].x + (up ? 4.4 : -4.4);
    beams.push({ system: group[0].system, x1, x2, y, up, double: group.every(g => g.value <= 0.25) });
  }
  const meter: [number, number] = [bars[0]?.numerator ?? 4, bars[0]?.denominator ?? 4];
  return { glyphs, beams, systems, barlines, signatureGlyphs, meter, signature, timeToXY, xyToTime, barAt, systemWidth };
}
