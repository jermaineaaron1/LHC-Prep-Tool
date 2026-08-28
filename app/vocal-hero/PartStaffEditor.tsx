'use client';

import React, { useMemo } from 'react';
import type { SongNote } from '@/lib/vocal-hero/types';
import { parseChord } from '@/lib/vocal-hero/chords';
import { durationToSymbols } from '@/lib/vocal-hero/notation';

// The Part studio's aligned sections. Everything in this file draws on ONE
// shared time axis: the same left margin, the same pixels per eighth, the
// same number of columns — so the SATB overview, the instrument staff and
// the drum grid sit strictly above one another and a note placed in any of
// them is measurable against the guide lines that run through all three.
//
// Instrument staff interactions:
//   click            toggle a pitch at that eighth — click more pitches in
//                    the same column to STACK A CHORD, click a head again
//                    to remove it
//   Ctrl+click       the sharpened pitch
//   Shift+click      lengthen the note ending just before this eighth (~)
//   right-click      clear the whole eighth back to a rest
//   fx strip (under the staff): click cycles accent (>) → staccato (·) → off
// Chords can also be written as [Em7] in the text — the symbol's own
// voicing appears on the staff with its name above; touching that column
// converts it to the explicit notes.

export const PART_CELL = 44;
export const PART_LEFT = 58;
const STEP = 4.6;
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const PC_NAME = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const PC_LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const PC_SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];
const VOICE_COLOURS = ['#ff60bc', '#a965ff', '#22d3ee', '#ffbd45'];
const VOICE_LABELS = ['S', 'A', 'T', 'B'];

export interface PartCell { midis: number[]; hold: number; slideTo?: number; accent?: boolean; staccato?: boolean; symbol?: string }
type Cell = PartCell;

function tokenMidi(token: string): number | null {
  const match = token.toLowerCase().match(/^([a-g])([#b]?)(-?\d)$/);
  if (!match) return null;
  let pc = LETTER_PC[['c', 'd', 'e', 'f', 'g', 'a', 'b'].indexOf(match[1])];
  if (match[2] === '#') pc += 1;
  if (match[2] === 'b') pc -= 1;
  return pc + 12 * (parseInt(match[3], 10) + 1);
}

export function midiToken(midi: number): string {
  return PC_NAME[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

/** Shared hover machinery: report which eighth the cursor is over, and draw
 *  the glowing rail that every section renders at the same column. */
function columnFromEvent(event: React.MouseEvent<SVGSVGElement>, columns: number): number | null {
  const bounds = event.currentTarget.getBoundingClientRect();
  const column = Math.floor((event.clientX - bounds.left - PART_LEFT) / PART_CELL);
  return column >= 0 && column < columns ? column : null;
}
function HoverRail({ hoverColumn, columns }: { hoverColumn?: number | null; columns: number }) {
  if (hoverColumn === null || hoverColumn === undefined || hoverColumn >= columns) return null;
  return <rect x={PART_LEFT + hoverColumn * PART_CELL} y={0} width={PART_CELL} height="100%" fill="#7dd3fc14" pointerEvents="none" />;
}
export interface StudioReferenceNote { midi: number; part: number; startEighth: number; endEighth: number }

export function parsePartCells(text: string): (Cell | null)[] {
  const tokens = text.replace(/\|/g, ' ').trim().split(/\s+/).filter(Boolean);
  const cells: (Cell | null)[] = [];
  for (let token of tokens) {
    if (token === '~') {
      const last = [...cells].reverse().find(cell => cell);
      if (last) last.hold += 1;
      cells.push(null);
      continue;
    }
    if (token === '-' || token === '.') { cells.push(null); continue; }
    let accent = false, staccato = false;
    while (/[!.]$/.test(token) && token.length > 1) {
      if (token.endsWith('!')) accent = true; else staccato = true;
      token = token.slice(0, -1);
    }
    const flags = { ...(accent ? { accent: true } : {}), ...(staccato ? { staccato: true } : {}) };
    const symbol = token.match(/^\[(.+)\]$/);
    if (symbol) {
      const chord = parseChord(symbol[1]);
      if (chord && chord.midis.length) cells.push({ midis: [...chord.midis].sort((a, b) => a - b), hold: 1, symbol: symbol[1], ...flags });
      else cells.push(null);
      continue;
    }
    const slide = token.split('>');
    const midis = slide[0].split(',').map(tokenMidi).filter((midi): midi is number => midi !== null).sort((a, b) => a - b);
    if (!midis.length) { cells.push(null); continue; }
    const slideTo = midis.length === 1 && slide[1] ? tokenMidi(slide[1]) : null;
    cells.push({ midis, hold: 1, ...(slideTo !== null && slideTo !== undefined ? { slideTo } : {}), ...flags });
  }
  return cells;
}

export function buildPartText(cells: (Cell | null)[]): string {
  const out: string[] = [];
  let skip = 0;
  for (let index = 0; index < cells.length; index++) {
    if (skip > 0) { out.push('~'); skip -= 1; continue; }
    const cell = cells[index];
    if (!cell) { out.push('-'); continue; }
    let token = cell.symbol
      ? `[${cell.symbol}]`
      : cell.midis.map(midiToken).join(',') + (cell.slideTo !== undefined && cell.midis.length === 1 ? '>' + midiToken(cell.slideTo) : '');
    if (cell.accent) token += '!';
    if (cell.staccato) token += '.';
    out.push(token);
    skip = cell.hold - 1;
  }
  while (out.length && out[out.length - 1] === '-') out.pop();
  return out.join(' ');
}

/** Length in eighths of a written line (for the shared column count). */
export function partLengthEighths(text: string): number {
  return parsePartCells(text).length;
}
export function drumLengthEighths(text: string): number {
  return Math.max(0, ...text.split(/\n/).map(line => {
    const match = line.match(/^\s*[KSHTtBPc]\s*:\s*(.*)$/);
    return match ? match[1].replace(/[|\s]/g, '').length : 0;
  }));
}

function midiStep(midi: number, bass: boolean): { step: number; sharp: boolean } {
  const pc = ((midi % 12) + 12) % 12;
  const letterAbs = (Math.floor(midi / 12) - 1) * 7 + PC_LETTER[pc];
  return { step: letterAbs - (bass ? 22 : 34), sharp: PC_SHARP[pc] };
}

function stepMidi(step: number, bass: boolean, sharp: boolean): number {
  const letterAbs = step + (bass ? 22 : 34);
  const letter = ((letterAbs % 7) + 7) % 7;
  const octave = Math.floor(letterAbs / 7);
  return LETTER_PC[letter] + 12 * (octave + 1) + (sharp ? 1 : 0);
}

/** The vertical guide lines all sections share: an eighth is faint, a beat
 *  firmer, a barline strong. Rendered per-svg at identical x positions so
 *  the lines read as continuous rails down the whole studio. */
function GuideLines({ columns, perBar, y1, y2 }: { columns: number; perBar: number; y1: number; y2: number }) {
  return <>{Array.from({ length: columns + 1 }, (_, column) => {
    const x = PART_LEFT + column * PART_CELL;
    const onBar = column % perBar === 0, onBeat = column % 2 === 0;
    return <line key={column} x1={x} x2={x} y1={y1} y2={y2}
      stroke={onBar ? '#7dd3fc55' : onBeat ? '#ffffff26' : '#ffffff12'} strokeWidth={onBar ? 1.4 : 1} />;
  })}</>;
}

export function partWidth(columns: number): number { return PART_LEFT + columns * PART_CELL + 10; }

/** The song itself, on the studio's axis — as WRITTEN NOTATION. Each voice
 *  gets its own five-line staff (S/A treble, T treble sounding an octave
 *  down, B bass) with real noteheads, sharps, ledger lines, hold lines for
 *  duration, and the soprano's lyrics — the reference the instrumentalist
 *  reads bar by bar while writing the part below. */
const OV_STEP = 3.4;
const OV_CLEF: Array<'treble' | 'treble8' | 'bass'> = ['treble', 'treble', 'treble8', 'bass'];
function overviewStep(midi: number, clef: 'treble' | 'treble8' | 'bass'): { step: number; sharp: boolean } {
  const base = midiStep(midi, clef === 'bass');
  return clef === 'treble8' ? { ...base, step: base.step + 7 } : base;
}
export function AlignedVoicesOverview({ notes, chords, from, eighthLen, columns, perBar, hoverColumn, onHoverColumn }: {
  notes: SongNote[]; chords: Array<{ at: number; symbol: string }>;
  from: number; eighthLen: number; columns: number; perBar: number;
  hoverColumn?: number | null; onHoverColumn?: (column: number | null) => void;
}) {
  const until = from + columns * eighthLen;
  const ROW = 62, TOP = 36;
  const height = TOP + 4 * ROW + 18;
  const x = (time: number) => PART_LEFT + (time - from) / eighthLen * PART_CELL;
  const voiceNotes = useMemo(() => notes.filter(note => note.start < until && note.end > from), [notes, from, until]);
  return <svg width={partWidth(columns)} height={height} aria-hidden style={{ display: 'block' }}
    onMouseMove={onHoverColumn ? event => onHoverColumn(columnFromEvent(event, columns)) : undefined}
    onMouseLeave={onHoverColumn ? () => onHoverColumn(null) : undefined}>
    <HoverRail hoverColumn={hoverColumn} columns={columns} />
    <GuideLines columns={columns} perBar={perBar} y1={12} y2={height - 4} />
    {Array.from({ length: columns }, (_, column) => column % 2 === 0 && <text key={column} x={PART_LEFT + column * PART_CELL + 3} y={11} fontSize={9.5} fill="#7dd3fc99">{column % perBar === 0 ? `bar ${Math.floor(column / perBar) + 1}` : `${(column % perBar) / 2 + 1}`}</text>)}
    {chords.filter(chord => chord.at >= from - 0.01 && chord.at < until).map((chord, index) =>
      <text key={index} x={x(chord.at) + 2} y={TOP - 9} fontSize={13} fontWeight={800} fill="#fde68a">{chord.symbol}</text>)}
    {VOICE_LABELS.map((label, part) => {
      const clef = OV_CLEF[part];
      const mid = TOP + part * ROW + 20;
      const own = voiceNotes.filter(note => note.part === part || (part === 0 && note.part === -1));
      return <g key={label}>
        <text x={6} y={mid + 4} fontSize={11} fontWeight={800} fill={VOICE_COLOURS[part]}>{label}</text>
        <text x={20} y={clef === 'bass' ? mid + 1 : mid + 2 * OV_STEP * 2 - 1} fontSize={clef === 'bass' ? 19 : 25} fill="#ffffff90" fontFamily="'Segoe UI Symbol','Noto Music',serif">{clef === 'bass' ? '\u{1D122}' : '\u{1D11E}'}</text>
        {[-2, -1, 0, 1, 2].map(line => <line key={line} x1={18} x2={partWidth(columns) - 6} y1={mid + line * 2 * OV_STEP} y2={mid + line * 2 * OV_STEP} stroke="#ffffff42" strokeWidth={0.8} />)}
        {own.map(note => {
          const { step, sharp } = overviewStep(note.midi, clef);
          const clamped = Math.max(-9, Math.min(9, step));
          const y = mid - clamped * OV_STEP;
          const ledgers: number[] = [];
          for (let line = 6; line <= Math.abs(clamped); line += 2) ledgers.push(clamped > 0 ? line : -line);
          const stemUp = clamped < 0;
          // The same engraving arithmetic as the main score: the note is
          // split at barlines, each span printed with its true VALUES —
          // filled quarters, hollow halves, flags on eighths, dots, and
          // ties between the pieces. What the editor engraves, this shows.
          const beatLen = eighthLen * 2;
          const barLen = perBar * eighthLen;
          type Piece = { time: number; value: number; dotted: boolean; tie: boolean };
          const pieces: Piece[] = [];
          let spanStart = Math.max(note.start, from);
          const noteEnd = Math.min(note.end, until);
          let guard = 0;
          while (spanStart < noteEnd - 0.001 && guard++ < 16) {
            const barEnd = from + (Math.floor((spanStart - from) / barLen + 1e-6) + 1) * barLen;
            const spanEnd = Math.min(noteEnd, barEnd);
            if (spanEnd - spanStart < 0.02) { spanStart = spanEnd; continue; }
            const symbols = durationToSymbols((spanEnd - spanStart) / beatLen);
            let time = spanStart;
            for (const symbol of symbols) {
              pieces.push({ time, value: symbol.value, dotted: symbol.dotted, tie: true });
              time += symbol.beats * beatLen;
            }
            spanStart = spanEnd;
          }
          if (pieces.length) pieces[pieces.length - 1].tie = false;
          return <g key={note.id}>
            {pieces.map((piece, index) => {
              const px = Math.max(PART_LEFT, x(piece.time)) + 3.6;
              const hollow = piece.value >= 2;
              const stemEnd = stemUp ? y - 16 : y + 16;
              return <g key={index}>
                {ledgers.map(line => <line key={line} x1={px - 5.6} x2={px + 5.6} y1={mid - line * OV_STEP} y2={mid - line * OV_STEP} stroke="#ffffff38" strokeWidth={0.8} />)}
                {index === 0 && sharp && <text x={px - 11} y={y + 3.4} fontSize={9} fill={VOICE_COLOURS[part]} opacity={0.9}>♯</text>}
                <ellipse cx={px} cy={y} rx={4.7} ry={3.6} transform={`rotate(-14 ${px} ${y})`}
                  fill={hollow ? 'transparent' : VOICE_COLOURS[part]} stroke={VOICE_COLOURS[part]} strokeWidth={hollow ? 1.3 : 1} opacity={0.95} />
                {piece.value < 4 && <line x1={px + (stemUp ? 3.4 : -3.4)} x2={px + (stemUp ? 3.4 : -3.4)} y1={y} y2={stemEnd} stroke={VOICE_COLOURS[part]} strokeWidth={1.2} opacity={0.95} />}
                {piece.value <= 0.5 && <path d={`M ${px + (stemUp ? 3.4 : -3.4)} ${stemEnd} q 5 ${stemUp ? 3 : -3} 3.5 ${stemUp ? 8 : -8}`} stroke={VOICE_COLOURS[part]} strokeWidth={1} fill="none" opacity={0.95} />}
                {piece.value <= 0.25 && <path d={`M ${px + (stemUp ? 3.4 : -3.4)} ${stemEnd + (stemUp ? 4 : -4)} q 5 ${stemUp ? 3 : -3} 3.5 ${stemUp ? 8 : -8}`} stroke={VOICE_COLOURS[part]} strokeWidth={1} fill="none" opacity={0.95} />}
                {piece.dotted && <circle cx={px + 7} cy={y - 2} r={1.3} fill={VOICE_COLOURS[part]} opacity={0.95} />}
                {piece.tie && pieces[index + 1] && <path d={`M ${px + 4} ${y + (stemUp ? 4.5 : -4.5)} Q ${(px + Math.max(PART_LEFT, x(pieces[index + 1].time)) + 3.6) / 2} ${y + (stemUp ? 9 : -9)}, ${Math.max(PART_LEFT, x(pieces[index + 1].time))} ${y + (stemUp ? 4.5 : -4.5)}`} stroke={VOICE_COLOURS[part]} strokeWidth={0.9} fill="none" opacity={0.8} />}
              </g>;
            })}
            {part === 0 && note.lyric && x(note.start) >= PART_LEFT - 1 && <text x={Math.max(PART_LEFT, x(note.start))} y={mid + 5 * OV_STEP + 11} fontSize={9.5} fill="#94a3b8">{note.lyric}</text>}
          </g>;
        })}
      </g>;
    })}
  </svg>;
}

export function InstrumentStaffEditor({ value, onChange, columns, perBar, reference, hoverColumn, onHoverColumn, brushValue, onBrushChange }: {
  value: string; onChange: (next: string) => void; columns: number; perBar: number;
  /** The SATB notes in this window, drawn as faint coloured dashes so the
   *  part is written against the voices' own pitches. */
  reference?: StudioReferenceNote[];
  hoverColumn?: number | null; onHoverColumn?: (column: number | null) => void;
  /** Controlled value brush (eighths) — the studio owns it so MIDI
   *  step-entry can share the same length. */
  brushValue?: number; onBrushChange?: (hold: number) => void;
}) {
  const cells = useMemo(() => parsePartCells(value), [value]);
  // The value brush: how long the next placed note lasts, in eighths.
  // Double-clicking an existing note re-values it to the brush.
  const [ownBrush, setOwnBrush] = React.useState(2);
  const brush = brushValue ?? ownBrush;
  const setBrush = onBrushChange ?? setOwnBrush;
  const stacks = cells.map((cell, column) => cell ? { ...cell, column } : null).filter(Boolean) as Array<Cell & { column: number }>;
  const allMidis = stacks.flatMap(stack => stack.midis);
  const bass = allMidis.length ? [...allMidis].sort((a, b) => a - b)[Math.floor(allMidis.length / 2)] < 57 : false;
  const mid = 64;
  const FX_Y = 126;
  const height = 158;

  function edit(mutate: (next: (Cell | null)[]) => void) {
    const next = cells.map(cell => cell ? { ...cell, midis: [...cell.midis] } : null);
    while (next.length < columns) next.push(null);
    mutate(next);
    onChange(buildPartText(next));
  }
  function freeSpan(next: (Cell | null)[], column: number) {
    for (let index = 0; index < column; index++) {
      const cell = next[index];
      if (cell && index + cell.hold > column) cell.hold = column - index;
    }
  }
  /** Make room for a note of `length` eighths starting at `column`: earlier
   *  notes reaching in are truncated, notes starting inside are removed. */
  function clearRange(next: (Cell | null)[], column: number, length: number) {
    freeSpan(next, column);
    for (let index = column; index < Math.min(columns, column + length); index++) next[index] = null;
  }
  function handleDouble(event: React.MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const column = Math.floor((event.clientX - bounds.left - PART_LEFT) / PART_CELL);
    if (column < 0 || column >= columns) return;
    // Re-value in place: the stack keeps its pitches, its length becomes
    // the brush.
    edit(next => {
      const cell = next[column];
      if (!cell) return;
      clearRange(next, column + 1, brush - 1);
      next[column] = cell;
      cell.hold = Math.max(1, Math.min(brush, columns - column));
    });
  }
  function handleClick(event: React.MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const column = Math.floor((event.clientX - bounds.left - PART_LEFT) / PART_CELL);
    if (column < 0 || column >= columns) return;
    const clickY = event.clientY - bounds.top;
    if (clickY >= FX_Y - 8) {
      // the fx strip: accent -> staccato -> plain
      edit(next => {
        const cell = next[column];
        if (!cell) return;
        if (cell.accent) { delete cell.accent; cell.staccato = true; }
        else if (cell.staccato) delete cell.staccato;
        else cell.accent = true;
        delete cell.symbol; // still the same voicing, now explicit
      });
      return;
    }
    if (event.shiftKey) {
      edit(next => {
        for (let index = column - 1; index >= 0; index--) {
          const cell = next[index];
          if (cell) { if (index + cell.hold === column && !next[column]) cell.hold += 1; return; }
        }
      });
      return;
    }
    const step = Math.max(-11, Math.min(11, Math.round((mid - clickY) / STEP)));
    const midi = stepMidi(step, bass, event.ctrlKey || event.metaKey);
    edit(next => {
      const existing = next[column];
      if (existing) {
        // toggle the pitch inside the stack: same pitch out, new pitch in
        const at = existing.midis.indexOf(midi);
        if (at >= 0) existing.midis.splice(at, 1);
        else existing.midis.push(midi);
        existing.midis.sort((a, b) => a - b);
        delete existing.symbol;
        if (!existing.midis.length) next[column] = null;
        if (existing.midis.length > 1) delete existing.slideTo;
      } else {
        clearRange(next, column, brush);
        next[column] = { midis: [midi], hold: Math.max(1, Math.min(brush, columns - column)) };
      }
    });
  }
  function handleContext(event: React.MouseEvent<SVGSVGElement>) {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const column = Math.floor((event.clientX - bounds.left - PART_LEFT) / PART_CELL);
    if (column < 0 || column >= columns) return;
    edit(next => { freeSpan(next, column); next[column] = null; });
  }

  return <div>
    <div className="flex items-center gap-1 pb-1 pt-0.5" style={{ paddingLeft: PART_LEFT }}>
      <span className="text-[8px] font-black uppercase tracking-[.14em] text-slate-500">Value</span>
      {([[1, '\u{1D160}', 'eighth'], [2, '\u{1D15F}', 'quarter'], [3, '\u{1D15F}.', 'dotted quarter'], [4, '\u{1D15E}', 'half'], [6, '\u{1D15E}.', 'dotted half'], [8, '\u{1D15D}', 'whole']] as Array<[number, string, string]>).map(([hold, glyph, name]) =>
        <button key={hold} onClick={() => setBrush(hold)} title={`${name} — new notes last this long; double-click an existing note to re-value it`}
          className={`min-w-[34px] rounded border px-2 py-1 text-[16px] leading-none ${brush === hold ? 'border-sky-300/60 bg-sky-300/15 text-sky-100' : 'border-white/12 text-slate-400 hover:bg-white/[.06]'}`}
          style={{ fontFamily: "'Segoe UI Symbol','Noto Music',serif" }}>{glyph}</button>)}
      <span className="text-[9px] text-slate-500">click places this value · double-click a note re-values it</span>
    </div>
    <svg width={partWidth(columns)} height={height} onClick={handleClick} onContextMenu={handleContext} onDoubleClick={handleDouble}
    onMouseMove={onHoverColumn ? event => onHoverColumn(columnFromEvent(event, columns)) : undefined}
    onMouseLeave={onHoverColumn ? () => onHoverColumn(null) : undefined}
    style={{ cursor: 'crosshair', display: 'block' }}>
    <HoverRail hoverColumn={hoverColumn} columns={columns} />
    <GuideLines columns={columns} perBar={perBar} y1={6} y2={height - 4} />
    {[-2, -1, 0, 1, 2].map(line => <line key={line} x1={8} x2={partWidth(columns) - 6} y1={mid + line * 2 * STEP} y2={mid + line * 2 * STEP} stroke="#ffffff50" strokeWidth={1} />)}
    {reference?.map((voice, index) => {
      const { step } = midiStep(voice.midi, bass);
      const clamped = Math.max(-11, Math.min(11, step));
      const y = mid - clamped * STEP;
      return <g key={`ref-${index}`} pointerEvents="none">
        {Array.from({ length: voice.endEighth - voice.startEighth }, (_, offset) => {
          const column = voice.startEighth + offset;
          if (column >= columns) return null;
          return <line key={column} x1={PART_LEFT + column * PART_CELL + 5} x2={PART_LEFT + (column + 1) * PART_CELL - 5}
            y1={y} y2={y} stroke={VOICE_COLOURS[voice.part]} strokeWidth={3} strokeLinecap="round" opacity={0.22} />;
        })}
      </g>;
    })}
    <text x={10} y={bass ? mid + 2 : mid + 2 * STEP * 2 - 2} fontSize={bass ? 33 : 41} fill="#ffffffd8" fontFamily="'Segoe UI Symbol','Noto Music',serif">{bass ? '\u{1D122}' : '\u{1D11E}'}</text>
    <text x={8} y={FX_Y + 8} fontSize={8} fontWeight={700} fill="#64748b">fx</text>
    <line x1={PART_LEFT} x2={partWidth(columns) - 6} y1={FX_Y - 8} y2={FX_Y - 8} stroke="#ffffff18" strokeWidth={1} />
    {stacks.map(stack => {
      const x = PART_LEFT + stack.column * PART_CELL + PART_CELL / 2;
      // Engrave the stack with its TRUE VALUE, the same arithmetic the
      // score uses: hold in eighths -> symbols (a 3-eighth hold prints a
      // dotted quarter; a 5-eighth hold a half tied to an eighth).
      const symbols = durationToSymbols(stack.hold / 2);
      const topInfo = midiStep(stack.midis[stack.midis.length - 1], bass);
      const bottomInfo = midiStep(stack.midis[0], bass);
      const topY = mid - topInfo.step * STEP;
      const bottomY = mid - bottomInfo.step * STEP;
      let pieceEighth = 0;
      return <g key={stack.column}>
        {stack.symbol && <text x={x} y={13} fontSize={9} fontWeight={800} textAnchor="middle" fill="#fde68a">{stack.symbol}</text>}
        {symbols.map((symbol, index) => {
          const px = PART_LEFT + (stack.column + pieceEighth) * PART_CELL + PART_CELL / 2;
          pieceEighth += symbol.beats * 2;
          const nx = PART_LEFT + (stack.column + pieceEighth) * PART_CELL + PART_CELL / 2;
          const hollow = symbol.value >= 2;
          const whole = symbol.value >= 4;
          const stemTop = topY - 24;
          return <g key={index}>
            {stack.midis.map(midi => {
              const { step, sharp } = midiStep(midi, bass);
              const y = mid - step * STEP;
              const ledgers: number[] = [];
              for (let line = 6; line <= Math.abs(step); line += 2) ledgers.push(step > 0 ? line : -line);
              return <g key={midi}>
                {ledgers.map(line => <line key={line} x1={px - 8} x2={px + 8} y1={mid - line * STEP} y2={mid - line * STEP} stroke="#ffffff45" strokeWidth={1} />)}
                {index === 0 && sharp && <text x={px - 14} y={y + 4} fontSize={11} fill="#93c5fd">♯</text>}
                <ellipse cx={px} cy={y} rx={5.8} ry={4.3} transform={`rotate(-14 ${px} ${y})`}
                  fill={hollow ? 'transparent' : '#93c5fd'} stroke="#93c5fd" strokeWidth={hollow ? 1.5 : 1} />
              </g>;
            })}
            {!whole && <line x1={px + 4.2} x2={px + 4.2} y1={bottomY} y2={stemTop} stroke="#93c5fd" strokeWidth={1.1} />}
            {symbol.value <= 0.5 && <path d={`M ${px + 4.2} ${stemTop} q 6 4 4 10`} stroke="#93c5fd" strokeWidth={1.1} fill="none" />}
            {symbol.value <= 0.25 && <path d={`M ${px + 4.2} ${stemTop + 5} q 6 4 4 10`} stroke="#93c5fd" strokeWidth={1.1} fill="none" />}
            {symbol.dotted && <circle cx={px + 8.5} cy={topY - 2.5} r={1.5} fill="#93c5fd" />}
            {index < symbols.length - 1 && <path d={`M ${px + 5} ${topY - 6} Q ${(px + nx) / 2} ${topY - 11}, ${nx - 4} ${topY - 6}`} stroke="#93c5fd" strokeWidth={1} fill="none" opacity={0.8} />}
          </g>;
        })}
        {stack.slideTo !== undefined && stack.midis.length === 1 && <text x={x + 7} y={topY - 6} fontSize={9} fontWeight={700} fill="#7dd3fc">{stack.slideTo > stack.midis[0] ? '↗' : '↘'}</text>}
        {(stack.accent || stack.staccato) && <text x={x} y={FX_Y + 8} fontSize={stack.accent ? 10 : 13} fontWeight={800} textAnchor="middle" fill="#fbbf24">{stack.accent ? '>' : '·'}</text>}
        <text x={x} y={height - 7} fontSize={9.5} textAnchor="middle" fill="#64748b">{stack.symbol ?? (stack.midis.length > 2 ? midiToken(stack.midis[0]) + '+' + (stack.midis.length - 1) : stack.midis.map(midiToken).join(','))}</text>
      </g>;
    })}
    </svg>
  </div>;
}

const DRUM_LANES: Array<[string, string]> = [['K', 'kick'], ['S', 'snare'], ['H', 'hat'], ['T', 'tom hi'], ['t', 'tom lo'], ['B', 'cajón bass'], ['P', 'cajón slap'], ['c', 'cajón tick']];

function parseDrumCells(text: string): Map<string, string[]> {
  const lanes = new Map<string, string[]>();
  for (const line of text.split(/\n/)) {
    const match = line.match(/^\s*([KSHTtBPc])\s*:\s*(.*)$/);
    if (!match) continue;
    lanes.set(match[1], match[2].replace(/[|\s]/g, '').split(''));
  }
  return lanes;
}

function buildDrumText(lanes: Map<string, string[]>, columns: number): string {
  const lines: string[] = [];
  for (const [letter] of DRUM_LANES) {
    const cells = lanes.get(letter);
    if (!cells || !cells.some(cell => cell !== '-' && cell !== '.')) continue;
    const row = Array.from({ length: columns }, (_, index) => cells[index] && cells[index] !== '.' ? cells[index] : '-');
    while (row.length && row[row.length - 1] === '-') row.pop();
    if (row.some(cell => cell !== '-')) lines.push(`${letter}: ${row.join('')}`);
  }
  return lines.join('\n');
}

export function DrumGridEditor({ value, onChange, columns, perBar, hoverColumn, onHoverColumn }: {
  value: string; onChange: (next: string) => void; columns: number; perBar: number;
  hoverColumn?: number | null; onHoverColumn?: (column: number | null) => void;
}) {
  const lanes = useMemo(() => parseDrumCells(value), [value]);
  const ROW = 22;
  const height = 8 + DRUM_LANES.length * ROW + 4;

  function cycle(letter: string, column: number) {
    const next = new Map([...lanes.entries()].map(([key, cells]) => [key, cells.slice()]));
    const cells = next.get(letter) ?? [];
    while (cells.length < columns) cells.push('-');
    const current = cells[column] === '.' ? '-' : cells[column] ?? '-';
    cells[column] = current === '-' ? 'o' : current === 'o' || current === 'x' ? 'O' : '-';
    next.set(letter, cells);
    onChange(buildDrumText(next, columns));
  }

  return <svg width={partWidth(columns)} height={height} style={{ display: 'block' }}
    onMouseMove={onHoverColumn ? event => onHoverColumn(columnFromEvent(event, columns)) : undefined}
    onMouseLeave={onHoverColumn ? () => onHoverColumn(null) : undefined}>
    <HoverRail hoverColumn={hoverColumn} columns={columns} />
    <GuideLines columns={columns} perBar={perBar} y1={4} y2={height - 4} />
    {DRUM_LANES.map(([letter, name], row) => {
      const y = 8 + row * ROW;
      const cells = lanes.get(letter) ?? [];
      return <g key={letter}>
        <text x={6} y={y + 13} fontSize={10.5} fontWeight={700} fill="#fca5a5cc">{letter}</text>
        <text x={18} y={y + 13} fontSize={8.5} fill="#64748b">{name}</text>
        <line x1={PART_LEFT} x2={partWidth(columns) - 6} y1={y + ROW - 2} y2={y + ROW - 2} stroke="#ffffff10" strokeWidth={1} />
        {Array.from({ length: columns }, (_, column) => {
          const mark = cells[column] && cells[column] !== '.' ? cells[column] : '-';
          const cx = PART_LEFT + column * PART_CELL + PART_CELL / 2;
          return <g key={column} onClick={() => cycle(letter, column)} style={{ cursor: 'pointer' }}>
            <rect x={PART_LEFT + column * PART_CELL + 1} y={y} width={PART_CELL - 2} height={ROW - 3} fill="transparent" />
            {mark !== '-' && <circle cx={cx} cy={y + 8} r={mark === 'X' || mark === 'O' ? 6.2 : 4.4}
              fill={mark === 'X' || mark === 'O' ? '#fb7185' : '#fca5a5'} opacity={0.95} />}
          </g>;
        })}
      </g>;
    })}
  </svg>;
}
