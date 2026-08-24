'use client';

import { useMemo } from 'react';
import type { SongNote } from '@/lib/vocal-hero/types';
import { accidentalMark, durationToSymbols, inferKeySignature, spellPitch, staffStep, type Accidental } from '@/lib/vocal-hero/notation';

// The score view: the arrangement as a closed SATB score — soprano and alto
// on a treble staff (stems up / down), tenor and bass on a bass staff — the
// way a musician already reads. White-on-dark engraving to sit inside the
// editor's world. It is a VIEW with selection: click a head to select the
// note, then the editor's own controls change it; drawing happens in the
// grid, which stays one toggle away.

export interface ScoreBar { start: number; end: number; beatCount: number; numerator: number; denominator: number; number: number }

const GAP = 7;                       // one staff space, px
const STEP = GAP / 2;                // one diatonic step
const BEAT_W = 36;
const BAR_PAD = 16;
const MARGIN_LEFT = 78;              // clef + signature + meter
const SYSTEM_W = 1120;
const TREBLE_MID = 66;               // y of the treble middle line (B4)
const BASS_MID = 152;                // y of the bass middle line (D3)
const LYRIC_Y = 110;                 // the alley between the staves, where hymnals put the words
const SYSTEM_H = 214;
const COLOURS = ['#ff60bc', '#a965ff', '#22d3ee', '#ffbd45'];

const FLAT_STEPS_TREBLE = [0, 3, -1, 2, -2, 1, -3];
const SHARP_STEPS_TREBLE = [4, 1, 5, 2, -1, 3, 0];

type Glyph = {
  id: string; part: number; x: number; y: number; step: number;
  value: number; dotted: boolean; tieFrom?: { x: number; y: number };
  mark: string | null; lyric: string; clefMid: number; system: number;
  midi: number;
};

export function ScoreView({ notes, bars, playhead, selectedIds, onSelectNote }: {
  notes: SongNote[]; bars: ScoreBar[]; playhead: number | null;
  selectedIds: string[]; onSelectNote: (id: string, part: number) => void;
}) {
  const layout = useMemo(() => buildLayout(notes, bars), [notes, bars]);
  const selected = new Set(selectedIds);
  const cursor = playhead !== null ? layout.timeToXY(playhead) : null;

  return <div className="vh-editor-scrollbars h-full overflow-auto px-4 py-4">
    <svg width={SYSTEM_W + 24} height={layout.systems * SYSTEM_H + 24} className="select-none">
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
          {cursor && cursor.system === system &&
            <line x1={cursor.x} x2={cursor.x} y1={TREBLE_MID - 3 * GAP} y2={BASS_MID + 3 * GAP} stroke="#22d3ee" strokeWidth={2} opacity={0.8} />}
        </g>;
      })}
      {layout.glyphs.map(glyph => {
        const top = glyph.system * SYSTEM_H + 12;
        const isSelected = selected.has(glyph.id);
        const colour = isSelected ? '#ec4899' : '#ffffff';
        const stemUp = glyph.part === 0 || glyph.part === 2 || glyph.part === -1;
        const stemX = glyph.x + (stemUp ? 4.4 : -4.4);
        const ledger: number[] = [];
        for (let line = 6; line <= Math.abs(glyph.step); line += 2) ledger.push(glyph.step > 0 ? line : -line);
        return <g key={`${glyph.id}-${glyph.x}`} transform={`translate(12 ${top})`} onClick={() => onSelectNote(glyph.id, glyph.part)} style={{ cursor: 'pointer' }}>
          {ledger.map(step => <line key={step} x1={glyph.x - 8} x2={glyph.x + 8} y1={glyph.clefMid - step * STEP} y2={glyph.clefMid - step * STEP} stroke="#ffffff55" strokeWidth={1} />)}
          {glyph.mark && <text x={glyph.x - 15} y={glyph.y + 4.5} fontSize={13} fill={colour}>{glyph.mark}</text>}
          <ellipse cx={glyph.x} cy={glyph.y} rx={4.8} ry={3.5} transform={`rotate(-14 ${glyph.x} ${glyph.y})`}
            fill={glyph.value >= 2 ? 'transparent' : colour} stroke={colour} strokeWidth={glyph.value >= 2 ? 1.6 : 1} />
          {glyph.value < 4 && <line x1={stemX} x2={stemX} y1={glyph.y} y2={glyph.y + (stemUp ? -26 : 26)} stroke={colour} strokeWidth={1.1} />}
          {glyph.value <= 0.5 && <path d={stemUp
            ? `M ${stemX} ${glyph.y - 26} c 6 4, 9 8, 6 16`
            : `M ${stemX} ${glyph.y + 26} c 6 -4, 9 -8, 6 -16`} stroke={colour} strokeWidth={1.4} fill="none" />}
          {glyph.value <= 0.25 && <path d={stemUp
            ? `M ${stemX} ${glyph.y - 20} c 6 4, 9 8, 6 16`
            : `M ${stemX} ${glyph.y + 20} c 6 -4, 9 -8, 6 -16`} stroke={colour} strokeWidth={1.4} fill="none" />}
          {glyph.dotted && <circle cx={glyph.x + 8.5} cy={glyph.step % 2 === 0 ? glyph.y - STEP : glyph.y} r={1.7} fill={colour} />}
          {glyph.tieFrom && glyph.tieFrom.x < glyph.x &&
            <path d={`M ${glyph.tieFrom.x + 5} ${glyph.tieFrom.y + 6} Q ${(glyph.tieFrom.x + glyph.x) / 2} ${glyph.tieFrom.y + 12}, ${glyph.x - 5} ${glyph.y + 6}`} stroke={colour} strokeWidth={1.1} fill="none" />}
          {glyph.lyric && <text x={glyph.x} y={LYRIC_Y} fontSize={10.5} fill={isSelected ? '#ec4899' : '#cbd5e1'} textAnchor="middle">{glyph.lyric}</text>}
        </g>;
      })}
    </svg>
  </div>;
}

function buildLayout(notes: SongNote[], rawBars: ScoreBar[]) {
  // The music begins after a lead-in, but the editor's bar grid begins at
  // zero — unshifted, every note would straddle a barline and print as tied
  // fragments. Bar 1 of the SCORE starts where the first note starts. (A
  // song written with a pickup will look barred from its first note; that
  // trade is accepted for now.)
  const offset = notes.length ? Math.min(...notes.map(note => note.start)) : 0;
  const bars = rawBars.map(bar => ({ ...bar, start: bar.start + offset, end: bar.end + offset }));
  const signature = inferKeySignature(notes.map(note => note.midi));
  const mark = signature > 0 ? '♯' : '♭';
  const steps = signature > 0 ? SHARP_STEPS_TREBLE : FLAT_STEPS_TREBLE;
  const signatureGlyphs = Array.from({ length: Math.abs(signature) }, (_, index) => ({ index, mark, trebleStep: steps[index] }));

  // Systems: as many whole bars as fit the width.
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
  const timeToXY = (time: number) => {
    const bar = placed.find(item => time >= item.start && time < item.end) ?? placed.at(-1);
    if (!bar) return null;
    const frac = Math.max(0, Math.min(1, (time - bar.start) / Math.max(0.001, bar.end - bar.start)));
    return { system: bar.system, x: bar.x + 6 + frac * (bar.width - BAR_PAD) };
  };
  const systemWidth = (index: number) => {
    const last = placed.filter(bar => bar.system === index).at(-1);
    return last ? last.x + last.width : SYSTEM_W - 12;
  };

  // Notes -> glyphs, walked left to right per staff so bar-local accidental
  // memory reads the way an engraver writes.
  const glyphs: Glyph[] = [];
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.part - b.part);
  const barStates = new Map<string, Map<string, Accidental>>();
  for (const note of sorted) {
    const clef = note.part >= 2 ? 'bass' : 'treble';
    const clefMid = clef === 'bass' ? BASS_MID : TREBLE_MID;
    const pitch = spellPitch(note.midi, signature);
    const step = staffStep(pitch, clef);
    // Split across barlines, then decompose each span into printable values.
    let spanStart = note.start;
    let previous: { x: number; y: number } | null = null;
    let first = true;
    while (spanStart < note.end - 0.001) {
      // Stored times are rounded to milliseconds, so a note can begin a hair
      // before its own barline; an unbiased lookup then emits a phantom
      // sixteenth in the previous bar. Bias the lookup into the bar the note
      // musically belongs to, and never engrave a hairline sliver.
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
  // Interlocking seconds: when up- and down-stem voices sit a step apart at
  // the same moment, the down-stem head shifts left, as engravers print it.
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
  return { glyphs, systems, barlines, signatureGlyphs, meter, timeToXY, systemWidth };
}
