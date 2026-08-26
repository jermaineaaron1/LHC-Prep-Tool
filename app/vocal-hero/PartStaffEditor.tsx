'use client';

import React, { useMemo, useState } from 'react';

// The Part studio's staff: the written instrument line drawn — and DRAWN ON —
// as real notation, the way the SATB staves work. The text tab stays the
// stored format; this editor parses it into cells on the eighth grid, lets
// the mouse place noteheads on staff lines and spaces, and writes the tokens
// back. The drum tab gets the matching treatment as a lane grid.
//
// Interactions (instrument staff):
//   click            place a note at that eighth, on that line/space
//   Ctrl+click       place it sharpened
//   Shift+click      extend the note ending just before this eighth (a ~)
//   right-click      clear the eighth back to a rest
// Slides (e3>g3) survive edits to other columns and keep printing with
// their arrows; write or change a slide in the text below.

const STEP = 3.5;
const CELL = 26;
const LEFT = 46;
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const PC_NAME = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const PC_LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const PC_SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];

interface Cell { midi: number; hold: number; slideTo?: number }

function tokenMidi(token: string): number | null {
  const match = token.toLowerCase().match(/^([a-g])([#b]?)(-?\d)$/);
  if (!match) return null;
  let pc = LETTER_PC[['c', 'd', 'e', 'f', 'g', 'a', 'b'].indexOf(match[1])];
  if (match[2] === '#') pc += 1;
  if (match[2] === 'b') pc -= 1;
  return pc + 12 * (parseInt(match[3], 10) + 1);
}

function midiToken(midi: number): string {
  return PC_NAME[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

/** The tab text as cells on the eighth grid (null = rest). */
function parseCells(text: string): { cells: (Cell | null)[]; length: number } {
  const tokens = text.replace(/\|/g, ' ').trim().split(/\s+/).filter(Boolean);
  const cells: (Cell | null)[] = [];
  for (const token of tokens) {
    if (token === '~') {
      const last = [...cells].reverse().find(cell => cell);
      if (last) last.hold += 1;
      cells.push(null);
      continue;
    }
    if (token === '-' || token === '.') { cells.push(null); continue; }
    const slide = token.split('>');
    const midi = tokenMidi(slide[0]);
    if (midi === null) { cells.push(null); continue; }
    const slideTo = slide[1] ? tokenMidi(slide[1]) : null;
    cells.push({ midi, hold: 1, ...(slideTo !== null && slideTo !== undefined ? { slideTo } : {}) });
  }
  return { cells, length: cells.length };
}

function buildText(cells: (Cell | null)[]): string {
  const out: string[] = [];
  let skip = 0;
  for (let index = 0; index < cells.length; index++) {
    if (skip > 0) { out.push('~'); skip -= 1; continue; }
    const cell = cells[index];
    if (!cell) { out.push('-'); continue; }
    out.push(midiToken(cell.midi) + (cell.slideTo !== undefined ? '>' + midiToken(cell.slideTo) : ''));
    skip = cell.hold - 1;
  }
  while (out.length && out[out.length - 1] === '-') out.pop();
  return out.join(' ');
}

/** Diatonic staff step from the clef's middle line (treble: B4, bass: D3). */
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

export function InstrumentStaffEditor({ value, onChange, eighthsPerBar }: {
  value: string; onChange: (next: string) => void; eighthsPerBar: number;
}) {
  const { cells } = useMemo(() => parseCells(value), [value]);
  const [extraBars, setExtraBars] = useState(0);
  const perBar = Math.max(2, eighthsPerBar);
  const columns = Math.min(32, Math.max(perBar * 2, Math.ceil(cells.length / perBar) * perBar) + extraBars * perBar);
  const notes = cells.map((cell, column) => cell ? { ...cell, column } : null).filter(Boolean) as Array<Cell & { column: number }>;
  const bass = notes.length ? [...notes.map(note => note.midi)].sort((a, b) => a - b)[Math.floor(notes.length / 2)] < 57 : false;
  const mid = 46;
  const width = LEFT + columns * CELL + 10;
  const height = 100;

  function edit(mutate: (next: (Cell | null)[]) => void) {
    const next = cells.slice();
    while (next.length < columns) next.push(null);
    mutate(next);
    onChange(buildText(next));
  }
  function clearSpan(next: (Cell | null)[], column: number) {
    // free this eighth: truncate any earlier note whose hold reaches it
    for (let index = 0; index < column; index++) {
      const cell = next[index];
      if (cell && index + cell.hold > column) cell.hold = column - index;
    }
    next[column] = null;
  }
  function handleClick(event: React.MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const column = Math.floor((event.clientX - bounds.left - LEFT) / CELL);
    if (column < 0 || column >= columns) return;
    if (event.shiftKey) {
      edit(next => {
        for (let index = column - 1; index >= 0; index--) {
          const cell = next[index];
          if (cell) { if (index + cell.hold === column) { clearSpan(next, column); next[index] = cell; cell.hold += 1; } return; }
        }
      });
      return;
    }
    const step = Math.max(-11, Math.min(11, Math.round((mid - (event.clientY - bounds.top)) / STEP)));
    const midi = stepMidi(step, bass, event.ctrlKey || event.metaKey);
    edit(next => { clearSpan(next, column); next[column] = { midi, hold: 1 }; });
  }
  function handleContext(event: React.MouseEvent<SVGSVGElement>) {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const column = Math.floor((event.clientX - bounds.left - LEFT) / CELL);
    if (column < 0 || column >= columns) return;
    edit(next => clearSpan(next, column));
  }

  return <div className="overflow-x-auto rounded-lg border border-white/12 bg-[#050716]">
    <svg width={width} height={height} onClick={handleClick} onContextMenu={handleContext} style={{ cursor: 'crosshair', display: 'block' }}>
      {Array.from({ length: columns + 1 }, (_, column) => {
        const x = LEFT + column * CELL;
        const onBar = column % perBar === 0, onBeat = column % 2 === 0;
        return <line key={column} x1={x} x2={x} y1={14} y2={height - 20} stroke={onBar ? '#ffffff38' : onBeat ? '#ffffff1c' : '#ffffff0e'} strokeWidth={onBar ? 1.2 : 1} />;
      })}
      {Array.from({ length: columns }, (_, column) => column % 2 === 0 && <text key={`n${column}`} x={LEFT + column * CELL + 3} y={11} fontSize={8} fill="#64748b">{column % perBar === 0 ? `bar ${column / perBar + 1}` : `${(column % perBar) / 2 + 1}`}</text>)}
      {[-2, -1, 0, 1, 2].map(line => <line key={line} x1={8} x2={width - 6} y1={mid + line * 2 * STEP} y2={mid + line * 2 * STEP} stroke="#ffffff50" strokeWidth={1} />)}
      <text x={10} y={bass ? mid + 2 : mid + 2 * STEP * 2 - 2} fontSize={bass ? 26 : 32} fill="#ffffffd8" fontFamily="'Segoe UI Symbol','Noto Music',serif">{bass ? '\u{1D122}' : '\u{1D11E}'}</text>
      {notes.map(note => {
        const { step, sharp } = midiStep(note.midi, bass);
        const x = LEFT + note.column * CELL + CELL / 2;
        const y = mid - step * STEP;
        const ledgers: number[] = [];
        for (let line = 6; line <= Math.abs(step); line += 2) ledgers.push(step > 0 ? line : -line);
        return <g key={note.column}>
          {ledgers.map(line => <line key={line} x1={x - 8} x2={x + 8} y1={mid - line * STEP} y2={mid - line * STEP} stroke="#ffffff45" strokeWidth={1} />)}
          {note.hold > 1 && <line x1={x + 5} x2={LEFT + (note.column + note.hold) * CELL - 4} y1={y} y2={y} stroke="#93c5fd88" strokeWidth={2.6} strokeLinecap="round" />}
          {sharp && <text x={x - 14} y={y + 4} fontSize={11} fill="#93c5fd">♯</text>}
          <ellipse cx={x} cy={y} rx={4.6} ry={3.4} transform={`rotate(-14 ${x} ${y})`} fill="#93c5fd" />
          <line x1={x + 4.2} x2={x + 4.2} y1={y} y2={y - 20} stroke="#93c5fd" strokeWidth={1.1} />
          {note.slideTo !== undefined && <text x={x + 7} y={y - 6} fontSize={9} fontWeight={700} fill="#7dd3fc">{note.slideTo > note.midi ? '↗' : '↘'}</text>}
          <text x={x} y={height - 7} fontSize={7.5} textAnchor="middle" fill="#64748b">{midiToken(note.midi)}</text>
        </g>;
      })}
    </svg>
    <div className="flex items-center justify-between border-t border-white/10 px-2 py-1 text-[9.5px] text-slate-500">
      <span>click = note on that line/space · Ctrl+click = ♯ · Shift+click = lengthen the note into this eighth · right-click = rest</span>
      <button onClick={() => setExtraBars(current => current + 1)} disabled={columns >= 32} className="rounded border border-white/15 px-1.5 py-0.5 text-slate-300 disabled:opacity-30">＋ bar</button>
    </div>
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

export function DrumGridEditor({ value, onChange, eighthsPerBar }: {
  value: string; onChange: (next: string) => void; eighthsPerBar: number;
}) {
  const lanes = useMemo(() => parseDrumCells(value), [value]);
  const [extraBars, setExtraBars] = useState(0);
  const perBar = Math.max(2, eighthsPerBar);
  const longest = Math.max(0, ...[...lanes.values()].map(cells => cells.length));
  const columns = Math.min(32, Math.max(perBar * 2, Math.ceil(longest / perBar) * perBar) + extraBars * perBar);
  const ROW = 15;
  const width = LEFT + columns * CELL + 10;
  const height = 16 + DRUM_LANES.length * ROW + 4;

  function cycle(letter: string, column: number) {
    const next = new Map([...lanes.entries()].map(([key, cells]) => [key, cells.slice()]));
    const cells = next.get(letter) ?? [];
    while (cells.length < columns) cells.push('-');
    const current = cells[column] === '.' ? '-' : cells[column] ?? '-';
    cells[column] = current === '-' ? 'o' : current === 'o' || current === 'x' ? 'O' : '-';
    next.set(letter, cells);
    onChange(buildDrumText(next, columns));
  }

  return <div className="overflow-x-auto rounded-lg border border-white/12 bg-[#050716]">
    <svg width={width} height={height} style={{ display: 'block' }}>
      {Array.from({ length: columns + 1 }, (_, column) => {
        const x = LEFT + column * CELL;
        const onBar = column % perBar === 0, onBeat = column % 2 === 0;
        return <line key={column} x1={x} x2={x} y1={13} y2={height - 4} stroke={onBar ? '#ffffff38' : onBeat ? '#ffffff1c' : '#ffffff0e'} strokeWidth={onBar ? 1.2 : 1} />;
      })}
      {Array.from({ length: columns }, (_, column) => column % 2 === 0 && <text key={`n${column}`} x={LEFT + column * CELL + 3} y={10} fontSize={8} fill="#64748b">{column % perBar === 0 ? `bar ${column / perBar + 1}` : `${(column % perBar) / 2 + 1}`}</text>)}
      {DRUM_LANES.map(([letter, name], row) => {
        const y = 16 + row * ROW;
        const cells = lanes.get(letter) ?? [];
        return <g key={letter}>
          <text x={6} y={y + 10} fontSize={8.5} fontWeight={700} fill="#fca5a5cc">{letter}</text>
          <text x={16} y={y + 10} fontSize={7} fill="#64748b">{name}</text>
          <line x1={LEFT} x2={width - 6} y1={y + ROW - 2} y2={y + ROW - 2} stroke="#ffffff10" strokeWidth={1} />
          {Array.from({ length: columns }, (_, column) => {
            const mark = cells[column] && cells[column] !== '.' ? cells[column] : '-';
            const cx = LEFT + column * CELL + CELL / 2;
            return <g key={column} onClick={() => cycle(letter, column)} style={{ cursor: 'pointer' }}>
              <rect x={LEFT + column * CELL + 1} y={y} width={CELL - 2} height={ROW - 3} fill="transparent" />
              {mark !== '-' && <circle cx={cx} cy={y + 6} r={mark === 'X' || mark === 'O' ? 4.6 : 3.2}
                fill={mark === 'X' || mark === 'O' ? '#fb7185' : '#fca5a5'} opacity={0.95} />}
            </g>;
          })}
        </g>;
      })}
    </svg>
    <div className="flex items-center justify-between border-t border-white/10 px-2 py-1 text-[9.5px] text-slate-500">
      <span>click a cell to cycle: hit → accent → off</span>
      <button onClick={() => setExtraBars(current => current + 1)} disabled={columns >= 32} className="rounded border border-white/15 px-1.5 py-0.5 text-slate-300 disabled:opacity-30">＋ bar</button>
    </div>
  </div>;
}
