'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { NoteMarks, SongNote } from '@/lib/vocal-hero/types';
import { midiNoteName } from '@/lib/vocal-hero/liveCues';
import { DRUM_STYLES, INSTRUMENT_STYLES, type BandEvent } from '@/lib/vocal-hero/accompaniment';
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

/** A band style id compressed for print: "🎸 folk · 🥁 straight". */
const shortStyle = (value: string) => value === 'stop' || value === 'off' ? 'tacet'
  : value.replace('melody-gtr', '🎸 melody').replace('melody-pno', '🎹 melody').replace('bass-walk', '🎸 walking bass')
    .replace('str-held', '🎻 strings').replace('pad-held', '🌫 pad').replace('brs-held', '🎺 brass')
    .replace('egtr-', '⚡ ').replace('gtr-', '🎸 ').replace('pno-', '🎹 ').replace('drum-', '🥁 ').replace('cajon-', '🪘 ').replace('custom', '✍ custom');

const GAP = 7;
const STEP = GAP / 2;
/** How long a finger must rest before the score gives way -- on a note, to
 *  pick it up; on empty staff, to write one. Nothing on the score is created,
 *  moved or destroyed by a tap: a tap only ever auditions. */
const HOLD_MS = 2000;
const BEAT_W = 36;
const BAR_PAD = 16;
const MARGIN_LEFT = 78;
const SYSTEM_W = 1120;
const STAFF_MIDS = [56, 132, 208, 284];
// Every voice gets a lyric row under its own staff, choral-score style —
// the bass row sits a touch higher so it clears the band lanes below it.
const LYRIC_YS = [96, 172, 248, 320];
const SYSTEM_H = 416;
// The band lane: two thin rows under the bass staff where the rhythm
// section's ACTUAL events print — what the ear will hear, on paper.
// The whole strip sits below the bass voice's lyric row.
const BAND_TEXT_Y = 328;
const LANE_INSTRUMENT_Y = 352;
const LANE_DRUM_Y = 364;
/** Recordings have their own row beneath the band lanes, so a clip never
 *  sits on top of an instrument instruction. */
const CLIP_ROW_Y = 390;
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
  /** A triplet member: printed with the little 3. */
  triplet: boolean;
  /** The note's performance markings, carried on its FIRST symbol only. */
  marks?: NoteMarks;
};

type Beam = { system: number; x1: number; x2: number; y: number; up: boolean; double: boolean; triplet: boolean };

export type DragPreview = { id: string; ids: string[]; dSteps: number; dx: number } | null;

export function ScoreView({ notes, bars, getPlayhead, selectedIds, tool, onSelectNote, onAddNote, onEraseNote, onDragCommit, onLyricChange, onAuditionNote, onAuditionNotes, chords, onChordEdit, onDeselect, resolveAdd, signature, bandEvents, onBandEdit, bandDefaults, onBandAudition, onBandWrite, onBandDrop, clipMarkers, onClipEdit, onClipDrag, showLeadIn, zoom = 1, snapTime }: {
  notes: SongNote[]; bars: ScoreBar[];
  getPlayhead: () => number | null;
  selectedIds: string[]; tool: ScoreTool;
  onSelectNote: (id: string, part: number, additive?: boolean) => void;
  /** part comes from the staff that was clicked — the staff IS the voice. */
  /** Returns the new note's id, so a note written by a fingertip can be put
   *  straight into positioning mode without a second gesture. */
  onAddNote: (part: number, time: number, midi: number) => string | void;
  /** Sound a note without changing it. A single tap does this and nothing
   *  else -- the surest way to know which note you are about to edit is to
   *  hear it. */
  onAuditionNote?: (id: string) => void;
  /** Sound every held note at once, so a chord under the finger can be
   *  checked as a chord before it is committed. */
  onAuditionNotes?: (ids: string[]) => void;
  onEraseNote: (id: string) => void;
  onDragCommit: (id: string, changes: { midi: number; start: number; end: number }) => void;
  onLyricChange: (id: string, lyric: string) => void;
  /** Chord symbols to engrave above the top staff, in song time. */
  chords?: Array<{ at: number; symbol: string }>;
  /** When wired, an empty landing box floats over every beat above the top
   *  staff — click it and type the chord. Called with the beat's time and
   *  the typed symbol ('' clears the chord there). */
  onChordEdit?: (at: number, symbol: string) => void;
  /** The band's WRITTEN-TIME events (no warp, no humanize, no count-in).
   *  When supplied, two lane rows under the bass staff print every hit —
   *  strum arrows, arpeggio note names, bass walk, drum strikes — at the
   *  exact beat position it sounds, under the singing it accompanies. */
  bandEvents?: BandEvent[];
  /** When wired, clicking a band directive under the bass staff opens an
   *  in-place popover; its choices arrive here. The target names the note
   *  carrying the instruction, or 'default' for the song-wide starting
   *  band. field 'remove' clears the instruction entirely. */
  onBandEdit?: (target: { noteId: string } | 'default', field: 'instrument' | 'drums' | 'remove', value: string) => void;
  /** The song-wide starting band, shown as a clickable label at the head
   *  of the directive line. */
  bandDefaults?: { instrument: string; drums: string };
  /** Clicking a directive auditions it: the editor plays just the band
   *  from that instruction's bar. */
  onBandAudition?: (target: { noteId: string } | 'default') => void;
  /** Dropping a band chip from the palette: called with the PRINTED bar
   *  numbers the drag painted (start === end for a plain drop) and the
   *  chip's payload. While a chip is over the score, the painted bars
   *  highlight so the range is visible before release. */
  onBandDrop?: (startBar: number, endBar: number, payload: { field: string; style: string }) => void;
  /** Double-clicking a directive (or the popover's Write button) opens the
   *  part studio: the SATB overview plus the written-out line editor. */
  onBandWrite?: (target: { noteId: string } | 'default') => void;
  /** Free clips on the instrument tracks: a green 🎼 marker prints at each
   *  clip's start; clicking one opens it in the Part studio. */
  clipMarkers?: Array<{ at: number; label: string; trackId: string; clipId: string; endAt?: number }>;
  /** Dragging a recording: the body moves it, either end crops it. Deltas
   *  arrive in seconds, so the caller does not need the score's geometry. */
  onClipDrag?: (trackId: string, clipId: string, change: 'move' | 'crop-start' | 'crop-end', seconds: number) => void;
  onClipEdit?: (trackId: string, clipId: string) => void;
  /** Render the silent lead-in bars instead of opening at the first note —
   *  the editor's mode, so instrumental intros have somewhere to live. */
  showLeadIn?: boolean;
  /** Double-clicking a SELECTED notehead calls this — the escape hatch that
   *  turns the value palette back into "set the next entry" instead of
   *  "re-value the selection". */
  onDeselect?: () => void;
  /** Where a click at this time, on this staff, would actually put the
   *  note (snapped, clamped into its bar, moved past any blocking note) —
   *  drives the ghost head under the cursor. */
  resolveAdd?: (time: number, part: number) => number;
  /** How large to draw the engraving, 1 being written size. 0 means "fit a
   *  system across whatever width this has" -- an overview, measured here
   *  because only this component knows how wide its own scroller is.
   *
   *  The scale is a CSS transform on one wrapper, so the engraving itself is
   *  laid out once at its natural size and never re-measured: ScoreBody stays
   *  memoised and zooming costs nothing. The price is that every pointer
   *  reading arrives in SCALED pixels, so each conversion below divides by it
   *  -- miss one and notes would move by the wrong interval under the cursor. */
  zoom?: number;
  /** Where a time would land on the grid. A fingertip is wider than a
   *  semiquaver, so touch drags land on the grid rather than wherever the
   *  finger happened to stop; a mouse keeps its free placement. */
  snapTime?: (time: number) => number;
  /** Spell in this key instead of inferring one — a compiled rendition with
   *  a lifted last verse stays spelled in the song's own key, and the lift
   *  wears its honest accidentals. */
  signature?: number;
}) {
  const layout = useMemo(() => buildLayout(notes, bars, signature, chords, showLeadIn), [notes, bars, signature, chords, showLeadIn]);
  // Fit is a measurement, not a constant: it is whatever puts one system
  // across the scroller as it stands now.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [fitScale, setFitScale] = useState(1);
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const measure = () => setFitScale(Math.max(.2, Math.min(1, (box.clientWidth - 32) / (SYSTEM_W + 24))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const scale = zoom > 0 ? zoom : fitScale;
  // The band lane, printed: every event at its exact written position.
  // Strums are arrows (soft upstrokes dimmed), arpeggio/bass notes are
  // NAMED so the picking pattern reads like a tab, block chords are ▪,
  // drums print their strikes. A tab slide (e3>g3) wears its arrow.
  const laneMarks = useMemo(() => {
    if (!bandEvents?.length) return [];
    const names = layout.signature < 0
      ? ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']
      : ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
    const marks: Array<{ x: number; system: number; drum: boolean; label: string; dim: boolean }> = [];
    for (const event of bandEvents) {
      const position = layout.timeToXY(event.at);
      if (!position) continue;
      let label = '', dim = false, drum = false;
      switch (event.kind) {
        case 'strum-down': label = '↓'; break;
        case 'strum-up': label = '↑'; dim = true; break;
        case 'pluck': case 'keys': case 'bass': {
          const solo = event.midis && event.midis.length === 1 ? event.midis[0] : null;
          label = solo !== null ? names[((solo % 12) + 12) % 12] : '▪';
          if (solo !== null && event.slideTo !== undefined) label += event.slideTo > solo ? '↗' : '↘';
          break;
        }
        case 'kick': case 'cajon-bass': label = '●'; drum = true; break;
        case 'snare': case 'cajon-slap': label = '×'; drum = true; break;
        case 'hat': case 'cajon-tick': label = '•'; dim = true; drum = true; break;
        case 'tom-low': label = 'T'; drum = true; break;
        case 'tom-high': label = 't'; drum = true; break;
      }
      if (label) marks.push({ x: position.x, system: position.system, drum, label, dim });
    }
    return marks;
  }, [bandEvents, layout]);
  const laneSystems = useMemo(() => [...new Set(laneMarks.map(mark => mark.system))], [laneMarks]);
  // In-place band editing: click a directive (or the default label at the
  // head of the line) and a popover with the instrument/drum pickers opens
  // right there.
  const [bandEdit, setBandEdit] = useState<{ target: { noteId: string } | 'default'; x: number; system: number } | null>(null);
  // A band instruction answers to both clicks: one opens the little chooser,
  // two go straight to writing the part. The single-click action waits a beat
  // so the chooser never flashes open on its way to the part studio.
  const bandClickTimer = useRef<number | null>(null);
  useEffect(() => () => { if (bandClickTimer.current) window.clearTimeout(bandClickTimer.current); }, []);
  function bandTap(open: () => void) {
    if (bandClickTimer.current) window.clearTimeout(bandClickTimer.current);
    bandClickTimer.current = window.setTimeout(() => { bandClickTimer.current = null; open(); }, 240);
  }
  // Dragging a recording along the staff: the pointer's own x is turned back
  // into song time, so a clip follows the cursor at whatever the bars happen
  // to be spaced at, and the same gesture crops when it starts on an edge.
  const clipDragRef = useRef<{ trackId: string; clipId: string; mode: 'move' | 'crop-start' | 'crop-end'; last: number } | null>(null);
  function timeAtPointer(event: React.PointerEvent<SVGElement>): number | null {
    const svg = event.currentTarget.ownerSVGElement ?? (event.currentTarget as unknown as SVGSVGElement);
    const bounds = svg.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / scale - 12;
    const y = (event.clientY - bounds.top) / scale - 12;
    const system = Math.max(0, Math.floor(y / SYSTEM_H));
    return layout.xyToTime(system, x);
  }
  function clipPointerDown(event: React.PointerEvent<SVGRectElement>, marker: { trackId: string; clipId: string }, mode: 'move' | 'crop-start' | 'crop-end') {
    if (!onClipDrag) return;
    const at = timeAtPointer(event);
    if (at === null) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    clipDragRef.current = { ...marker, mode, last: at };
  }
  function clipPointerMove(event: React.PointerEvent<SVGRectElement>) {
    const drag = clipDragRef.current;
    if (!drag || !onClipDrag) return;
    const at = timeAtPointer(event);
    if (at === null) return;
    const delta = at - drag.last;
    if (Math.abs(delta) < 0.01) return;   // ignore jitter, and keep re-renders sane
    drag.last = at;
    onClipDrag(drag.trackId, drag.clipId, drag.mode, delta);
  }
  function clipPointerUp(event: React.PointerEvent<SVGRectElement>) {
    if (!clipDragRef.current) return;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    clipDragRef.current = null;
  }
  function bandDoubleTap(write: () => void) {
    if (bandClickTimer.current) { window.clearTimeout(bandClickTimer.current); bandClickTimer.current = null; }
    setBandEdit(null);
    write();
  }
  // A band chip being dragged over the score: the painted bar range.
  const [dropRange, setDropRange] = useState<{ anchor: number; current: number } | null>(null);
  function barUnderDrag(event: React.DragEvent<HTMLDivElement>): number | null {
    const container = event.currentTarget;
    const bounds = container.getBoundingClientRect();
    const x = (event.clientX - bounds.left + container.scrollLeft - 16) / scale - 12;
    const y = (event.clientY - bounds.top + container.scrollTop - 16) / scale;
    const system = Math.floor((y - 12) / SYSTEM_H);
    const time = layout.xyToTime(system, x);
    if (time === null) return null;
    return layout.barAt(time)?.number ?? null;
  }
  function handleBandDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!onBandDrop || !event.dataTransfer.types.includes('application/x-vh-band')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const bar = barUnderDrag(event);
    if (bar === null) return;
    setDropRange(current => current && current.current === bar ? current : { anchor: current?.anchor ?? bar, current: bar });
  }
  function handleBandDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!onBandDrop || !event.dataTransfer.types.includes('application/x-vh-band')) return;
    event.preventDefault();
    const range = dropRange;
    setDropRange(null);
    try {
      const payload = JSON.parse(event.dataTransfer.getData('application/x-vh-band')) as { field: string; style: string };
      const bar = barUnderDrag(event) ?? range?.current ?? range?.anchor;
      if (bar === null || bar === undefined) return;
      const anchor = range?.anchor ?? bar;
      onBandDrop(Math.min(anchor, bar), Math.max(anchor, bar), payload);
    } catch { /* not our payload */ }
  }
  const [drag, setDrag] = useState<DragPreview>(null);
  // Inline lyric editing: double-click a word under the melody (or the empty
  // spot where one belongs), type, Tab to the next note, Enter to finish.
  const [lyricEdit, setLyricEdit] = useState<{ id: string; x: number; system: number; staff: number; value: string } | null>(null);
  // Inline chord entry: every beat has a landing slot above the top staff.
  // Click one, type, Enter to finish — Tab hops to the next beat like a
  // lead sheet being filled in left to right.
  const [chordEdit, setChordEdit] = useState<{ index: number; at: number; x: number; system: number; value: string } | null>(null);
  // A slot owns any chord inside its half-beat window; the exact match is
  // only for "did the typed value actually change" at commit time.
  const chordInSlot = (slot: { at: number; window: number }) => chords?.find(chord => Math.abs(chord.at - slot.at) < slot.window);
  function startChordEdit(index: number) {
    const slot = layout.chordSlots[index];
    if (!slot) { setChordEdit(null); return; }
    const existing = chordInSlot(slot);
    // The input opens over the chord it edits, even when that chord sits
    // off the beat — not over the beat's own gridline.
    const position = existing ? layout.timeToXY(existing.at) : null;
    setChordEdit({ index, at: existing?.at ?? slot.at, x: position?.x ?? slot.x, system: position?.system ?? slot.system, value: existing?.symbol ?? '' });
  }
  function commitChord(step: number) {
    if (!chordEdit) return;
    const typed = chordEdit.value.trim();
    const existing = chords?.find(chord => Math.abs(chord.at - chordEdit.at) < 0.04);
    if (typed !== (existing?.symbol ?? '')) onChordEdit?.(chordEdit.at, typed);
    if (!step) { setChordEdit(null); return; }
    startChordEdit(chordEdit.index + step);
  }
  // Every staff's notes anchor its lyric row — words live under the voice
  // that sings them, so each part is edited beneath its own staff.
  const lyricAnchors = useMemo(() => layout.glyphs
    .filter((g, i, all) => all.findIndex(o => o.id === g.id) === i)
    .sort((a, b) => a.system - b.system || a.x - b.x), [layout]);
  function startLyricEdit(anchor: { id: string; x: number; system: number; staff: number }) {
    const note = notes.find(n => n.id === anchor.id);
    setLyricEdit({ id: anchor.id, x: anchor.x, system: anchor.system, staff: anchor.staff, value: note?.lyric ?? '' });
  }
  function commitLyric(advance: boolean) {
    if (!lyricEdit) return;
    onLyricChange(lyricEdit.id, lyricEdit.value.trim());
    if (!advance) { setLyricEdit(null); return; }
    // Tab walks along the SAME voice's words, not down into the next staff.
    const sameStaff = lyricAnchors.filter(a => a.staff === lyricEdit.staff);
    const index = sameStaff.findIndex(a => a.id === lyricEdit.id);
    const next = sameStaff[index + 1];
    if (next) startLyricEdit(next); else setLyricEdit(null);
  }
  function lyricBandDoubleClick(event: React.MouseEvent<SVGSVGElement>) {
    if (locked) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / scale - 12;
    const y = (event.clientY - bounds.top) / scale;
    const system = Math.floor((y - 12) / SYSTEM_H);
    const yIn = y - 12 - system * SYSTEM_H;
    const staff = LYRIC_YS.findIndex(rowY => yIn >= rowY - 5 && yIn <= rowY + 12);
    if (staff < 0) return;
    const candidates = lyricAnchors.filter(a => a.system === system && a.staff === staff);
    if (!candidates.length) return;
    const nearest = candidates.reduce((best, a) => Math.abs(a.x - x) < Math.abs(best.x - x) ? a : best, candidates[0]);
    if (Math.abs(nearest.x - x) > 40) return;
    startLyricEdit(nearest);
  }
  const dragRef = useRef<{ id: string; note: SongNote; step: number; clef: StaffClef; originX: number; originY: number; secondsPerPx: number; moved: boolean; touch: boolean; held: boolean; gx: number; gsystem: number; gstaff: number; baseSteps: number; baseDx: number } | null>(null);
  /** The last pitch the drag passed through, so each new one can be felt. */
  const lastStepsRef = useRef(0);
  // Touch note editing.
  //
  // A mouse commits a drag on release, and that is right: the cursor is one
  // pixel and you can see the note the whole way. A fingertip covers the note
  // it is moving, so "did that land where I meant?" cannot be answered until
  // the finger lifts -- by which point a mouse-style commit has already
  // happened. So a finger never commits. It picks the note up, moves it, and
  // leaves it hovering while a small bar asks: keep it, put it back, or throw
  // it away. Holding still for a moment picks a note up without moving it,
  // which is how deleting works now that a long press must not delete on its
  // own.
  const holdTimerRef = useRef<number | null>(null);
  // Where the finger is right now, so a hold that completes can start its drag
  // from where the hand actually is rather than from where it first landed.
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  // Three seconds is a long time to press something and be told nothing. The
  // ring closes over exactly the hold, so a finger that is being heard looks
  // different from one that is not -- and a hold that gets cancelled is seen
  // to be cancelled instead of just never happening.
  const holdRingRef = useRef<HTMLDivElement | null>(null);
  const holdAnimationRef = useRef<Animation | null>(null);
  function startHoldRing(event: React.PointerEvent) {
    const ring = holdRingRef.current, box = scrollRef.current;
    if (!ring || !box) return;
    const bounds = box.getBoundingClientRect();
    ring.style.left = (event.clientX - bounds.left + box.scrollLeft) + 'px';
    ring.style.top = (event.clientY - bounds.top + box.scrollTop) + 'px';
    ring.style.display = 'block';
    holdAnimationRef.current?.cancel();
    holdAnimationRef.current = ring.animate?.(
      [{ transform: 'translate(-50%,-50%) scale(.35)', opacity: .95 },
       { transform: 'translate(-50%,-50%) scale(1)', opacity: .25 }],
      { duration: HOLD_MS, easing: 'linear', fill: 'forwards' }) ?? null;
  }
  function stopHoldRing() {
    holdAnimationRef.current?.cancel();
    holdAnimationRef.current = null;
    if (holdRingRef.current) holdRingRef.current.style.display = 'none';
  }
  const [touchEdit, setTouchEdit] = useState<{ ids: string[]; id: string; note: SongNote; step: number; clef: StaffClef; secondsPerPx: number; x: number; system: number; staff: number } | null>(null);
  // While a note is held, the score is locked: nothing else on it answers a
  // tap. Without that, the finger that reaches for the tick brushes a
  // notehead on the way and starts editing something else -- and at 50% zoom
  // "something else" is four pixels from what you meant.
  const locked = touchEdit !== null;
  // Every position the held note has rested at, oldest first, with the
  // original at the bottom. Reverting used to throw away the whole edit and
  // return to where the note started, which is no help after four careful
  // nudges -- you wanted the last one back, not all of them.
  const [editHistory, setEditHistory] = useState<Array<{ dSteps: number; dx: number }>>([]);
  useEffect(() => () => { if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current); }, []);
  /** Put the held note where it can be seen, and keep it under the finger.
   *  Scrolling moves the score out from under the hand, so the drag's origin
   *  travels with it -- otherwise the note jumps by exactly the scroll. */
  function focusHeld(gx: number, gsystem: number, gstaff: number, active?: typeof dragRef.current) {
    const box = scrollRef.current;
    if (!box) return;
    const x = 16 + (gx + 12) * scale;
    const y = 16 + (gsystem * SYSTEM_H + 12 + STAFF_MIDS[gstaff]) * scale;
    const padX = 70, padY = 90;
    let left = box.scrollLeft, top = box.scrollTop;
    if (x < left + padX) left = Math.max(0, x - padX);
    else if (x > left + box.clientWidth - padX) left = x - box.clientWidth + padX;
    if (y < top + padY) top = Math.max(0, y - padY);
    else if (y > top + box.clientHeight - padY) top = y - box.clientHeight + padY;
    const movedLeft = left - box.scrollLeft, movedTop = top - box.scrollTop;
    if (!movedLeft && !movedTop) return;                      // already in view
    box.scrollLeft = left;
    box.scrollTop = top;
    if (active) { active.originX -= movedLeft; active.originY -= movedTop; }
  }
  const liftNote = (active: NonNullable<typeof dragRef.current>) => (setEditHistory([]), setTouchEdit({
    ids: [active.id], id: active.id, note: active.note, step: active.step, clef: active.clef,
    secondsPerPx: active.secondsPerPx, x: active.gx, system: active.gsystem, staff: active.gstaff,
  }));
  function closeTouchEdit() { setDrag(null); setTouchEdit(null); setEditHistory([]); }
  /** One step back: the position before the last drag, then the one before
   *  that, and so on down to where the note began. With nothing left to undo
   *  it lets the note go, which is what the button used to do outright. */
  function stepBack() {
    if (!touchEdit) return;
    if (!editHistory.length) { closeTouchEdit(); return; }
    const previous = editHistory[editHistory.length - 1];
    setEditHistory(current => current.slice(0, -1));
    if (previous.dSteps === 0 && previous.dx === 0) setDrag(null);
    else setDrag({ id: touchEdit.id, ids: touchEdit.ids, dSteps: previous.dSteps, dx: previous.dx });
    lastStepsRef.current = previous.dSteps;
  }
  function commitTouchEdit() {
    if (!touchEdit) return;
    const preview = drag && drag.ids.includes(touchEdit.id) ? drag : null;
    if (preview && (preview.dSteps !== 0 || preview.dx !== 0)) {
      // Every held note travels the same interval and the same distance, so a
      // chord or a phrase keeps its shape.
      for (const id of touchEdit.ids) {
        const note = notes.find(item => item.id === id);
        const glyph = layout.glyphs.find(item => item.id === id);
        if (!note || !glyph) continue;
        const midi = preview.dSteps === 0 ? note.midi
          : stepToMidi(glyph.step + preview.dSteps, STAFF_CLEFS[glyph.staff], layout.signature);
        const start = Math.max(0, note.start + preview.dx * touchEdit.secondsPerPx);
        onDragCommit(id, { midi, start, end: start + (note.end - note.start) });
      }
    }
    closeTouchEdit();
  }
  function deleteTouchEdit() {
    const ids = touchEdit?.ids ?? [];
    closeTouchEdit();
    for (const id of ids) onEraseNote(id);
  }
  /** A second note tapped while one is held joins it rather than replacing it. */
  function toggleHeld(glyph: Glyph) {
    setTouchEdit(current => {
      if (!current) return current;
      const has = current.ids.includes(glyph.id);
      if (has && current.ids.length === 1) return current;      // never empty the set
      const ids = has ? current.ids.filter(id => id !== glyph.id) : [...current.ids, glyph.id];
      return { ...current, ids };
    });
    onSelectNote(glyph.id, glyph.part, true);
  }
  // Which kind of pointer is on the note right now. A long-press on a phone
  // raises the very same contextmenu event a right-click does, so a finger
  // resting on a note deleted it -- and touch is now the main way in, since
  // dragging notes by finger works. Deleting stays a mouse shortcut: touch
  // has the Erase tool and the toolbar's ✕, both of which say what they do.
  const lastPointerTypeRef = useRef<string>('mouse');
  function eraseFromContextMenu(id: string) {
    if (lastPointerTypeRef.current !== 'mouse') return;
    onEraseNote(id);
  }
  // The ghost head: a faint notehead that rides the cursor over empty staff
  // space, already snapped to where a click would land — so "the note goes
  // exactly where I aim" is visible before the click. Imperative (a ref, no
  // state) so mousemove never re-renders the engraving.
  const ghostRef = useRef<HTMLDivElement | null>(null);
  function updateGhost(event: React.PointerEvent) {
    const ghost = ghostRef.current;
    if (!ghost) return;
    const hide = () => { ghost.style.display = 'none'; };
    if (dragRef.current || tool === 'erase' || (event.target as Element).closest('[data-glyph]')) return hide();
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / scale - 12;
    const y = (event.clientY - bounds.top) / scale;
    const system = Math.floor((y - 12) / SYSTEM_H);
    const yIn = y - 12 - system * SYSTEM_H;
    const staff = STAFF_MIDS.findIndex(mid => yIn > mid - 5 * GAP && yIn < mid + 5 * GAP);
    if (staff < 0) return hide();
    const time = layout.xyToTime(system, x);
    if (time === null) return hide();
    const landed = layout.timeToXY(resolveAdd ? resolveAdd(time, staff) : time);
    if (!landed) return hide();
    const step = Math.round((STAFF_MIDS[staff] - yIn) / STEP);
    ghost.style.display = 'block';
    ghost.style.transform = `translate(${landed.x + 12 - 5}px, ${landed.system * SYSTEM_H + 12 + (STAFF_MIDS[staff] - step * STEP) - 4}px)`;
  }

  function beginDrag(event: React.PointerEvent, glyph: Glyph) {
    lastPointerTypeRef.current = event.pointerType || 'mouse';
    if (tool === 'erase') { onEraseNote(glyph.id); return; }
    // Locked: a tap on any OTHER note adds it to the held set instead of
    // starting a fresh edit. The held notes themselves stay draggable.
    if (locked && touchEdit && !touchEdit.ids.includes(glyph.id)) { toggleHeld(glyph); return; }
    // Ctrl/Cmd/Shift-click builds a selection — slurs and hairpins span it.
    onSelectNote(glyph.id, glyph.part, event.ctrlKey || event.metaKey || event.shiftKey);
    const note = notes.find(item => item.id === glyph.id);
    const bar = layout.barAt(note?.start ?? 0);
    if (!note || !bar) return;
    const touch = event.pointerType === 'touch' || event.pointerType === 'pen';
    // A note already lifted -- held a moment ago, or just written by a hold on
    // empty staff -- is draggable at once. Asking for a second three-second
    // hold to nudge the note you are already holding would be absurd.
    const alreadyLifted = Boolean(touchEdit && touchEdit.ids.includes(glyph.id));
    // Picking up a note that is ALREADY hovering must continue from where it
    // hovers, not from where it was written. Without this every fresh grab
    // snapped the note home and started again, so it could only ever be moved
    // once -- which is no use at all when the whole point is to try a pitch,
    // look at it, and try another before committing.
    const carried = alreadyLifted && drag && drag.ids.includes(glyph.id) ? drag : null;
    dragRef.current = {
      id: glyph.id, note, step: glyph.step, clef: STAFF_CLEFS[glyph.staff],
      originX: event.clientX, originY: event.clientY,
      secondsPerPx: (bar.end - bar.start) / (bar.width - BAR_PAD), moved: false,
      touch, held: alreadyLifted, gx: glyph.x, gsystem: glyph.system, gstaff: glyph.staff,
      baseSteps: carried ? carried.dSteps : 0, baseDx: carried ? carried.dx : 0,
    };
    lastStepsRef.current = carried ? carried.dSteps : 0;
    if (touch && !alreadyLifted) {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      startHoldRing(event);
      if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null;
        const active = dragRef.current;
        if (!active || active.id !== glyph.id || active.moved) return;
        active.held = true;
        stopHoldRing();
        // The hand has drifted during three seconds of pressing -- everybody's
        // does. Start the drag from where the finger IS, or the note leaps by
        // the accumulated drift the instant it is picked up.
        const now = lastPointerRef.current;
        if (now) { active.originX = now.x; active.originY = now.y; }
        // A note that has been picked up should feel picked up.
        try { navigator.vibrate?.(18); } catch { /* not every phone buzzes */ }
        focusHeld(active.gx, active.gsystem, active.gstaff, active);
        liftNote(active);
      }, HOLD_MS);
    }
    try { (event.target as Element).setPointerCapture?.(event.pointerId); } catch { /* synthetic pointers have no capture */ }
  }
  function moveDrag(event: React.PointerEvent) {
    const active = dragRef.current;
    if (!active) return;
    if (active.touch && !active.held) {
      // Before the hold completes the finger is not dragging anything, and
      // nothing it does cancels the hold. A fingertip covers a notehead
      // several times over and a hand pressing for three seconds wanders;
      // cancelling on that wander was the hold "not being recognised". The
      // note owns this gesture outright -- touch-action on the glyph means it
      // cannot scroll the score either way -- so the only thing that ends it
      // is lifting off.
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      return;
    }
    const stepDelta = Math.round((active.originY - event.clientY) / (STEP * scale));
    const pxDelta = (event.clientX - active.originX) / scale;
    if (!active.moved && Math.abs(stepDelta) < 1 && Math.abs(pxDelta) < 4) return;
    // This drag is under way: record where the note stood before it, so the
    // revert button has somewhere to go back TO.
    if (!active.moved) setEditHistory(current => [...current, { dSteps: active.baseSteps, dx: active.baseDx }]);
    const dSteps = active.baseSteps + stepDelta;
    // Up and down only. A hand moving 3.5px per semitone cannot help drifting
    // sideways too, and sideways is the note's PLACE IN THE BAR -- a thing
    // nobody nudges by accident and lives with. The mouse keeps both axes.
    let dx = active.touch ? 0 : active.baseDx + pxDelta;
    // Once it is travelling it is a drag, not a hold -- but a note already
    // lifted stays lifted, and the bar follows it.
    if (holdTimerRef.current) { window.clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    active.moved = true;
    if (active.touch && snapTime) {
      const landed = snapTime(Math.max(0, active.note.start + dx * active.secondsPerPx));
      dx = (landed - active.note.start) / active.secondsPerPx;
    }
    // Every line and space it passes gets a tick, so the landing is felt as
    // well as seen: a pitch chosen by fingertip on a four-pixel staff needs
    // more than a picture to be sure of.
    if (dSteps !== lastStepsRef.current) {
      lastStepsRef.current = dSteps;
      try { navigator.vibrate?.(5); } catch { /* not every phone buzzes */ }
    }
    setDrag({ id: active.id, ids: touchEdit && touchEdit.ids.includes(active.id) ? touchEdit.ids : [active.id], dSteps, dx });
  }
  function endDrag() {
    const active = dragRef.current;
    dragRef.current = null;
    stopHoldRing();
    lastPointerRef.current = null;
    if (holdTimerRef.current) { window.clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    if (!active) { setDrag(null); return; }
    if (active.touch) {
      // Held: the note is hovering and the bar does the asking. The preview
      // deliberately survives the release -- that IS the answer to "where did
      // it land".
      if (active.held) {
        // A held note TAPPED rather than dragged leaves the picked set -- the
        // same tap that added it takes it away again. The first note stays:
        // emptying the set would leave the bar asking about nothing.
        if (!active.moved && touchEdit && touchEdit.ids.length > 1 && touchEdit.ids.includes(active.id)) {
          setTouchEdit(current => current && { ...current, ids: current.ids.filter(id => id !== active.id) });
          onSelectNote(active.id, active.note.part, true);
          return;
        }
        if (!touchEdit) liftNote(active);
        return;
      }
      setDrag(null);
      // A plain tap changes nothing. It sounds the note, which is how you find
      // out whether it is the one you meant before spending three seconds on it.
      if (!active.moved) onAuditionNote?.(active.id);
      return;
    }
    setDrag(null);
    if (!active.moved) return;
    const preview = drag && drag.ids.includes(active.id) ? drag : null;
    if (!preview) return;
    const midi = preview.dSteps === 0 ? active.note.midi : stepToMidi(active.step + preview.dSteps, active.clef, layout.signature);
    const dTime = preview.dx * active.secondsPerPx;
    const start = Math.max(0, active.note.start + dTime);
    onDragCommit(active.id, { midi, start, end: start + (active.note.end - active.note.start) });
  }

  // Writing a note with a fingertip.
  //
  // A mouse hovers, so the ghost head shows where the note will land BEFORE
  // the click. A finger has no hover: the first the phone hears is the tap
  // that writes, and at 50% zoom a staff step is under two pixels, so a note
  // aimed at A4 lands wherever the fingertip's centre happened to be. So the
  // touch-down only AIMS -- the ghost and its pitch name appear under the
  // finger and follow it, and the note is written on release.
  const placeRef = useRef<{ staff: number; time: number; midi: number } | null>(null);
  const aimRef = useRef<HTMLDivElement | null>(null);
  function aimAt(event: React.PointerEvent): { staff: number; time: number; midi: number } | null {
    const bounds = (event.currentTarget as Element).getBoundingClientRect();
    const x = (event.clientX - bounds.left) / scale - 12;
    const y = (event.clientY - bounds.top) / scale;
    const system = Math.floor((y - 12) / SYSTEM_H);
    const yIn = y - 12 - system * SYSTEM_H;
    const staff = STAFF_MIDS.findIndex(mid => yIn > mid - 5 * GAP && yIn < mid + 5 * GAP);
    if (staff < 0) return null;
    const time = layout.xyToTime(system, x);
    if (time === null) return null;
    const step = Math.round((STAFF_MIDS[staff] - yIn) / STEP);
    return { staff, time, midi: stepToMidi(step, STAFF_CLEFS[staff], layout.signature) };
  }
  function showAim(aim: { staff: number; time: number; midi: number } | null) {
    const chip = aimRef.current;
    if (!chip) return;
    if (!aim) { chip.style.display = 'none'; return; }
    const landed = layout.timeToXY(resolveAdd ? resolveAdd(aim.time, aim.staff) : aim.time);
    if (!landed) { chip.style.display = 'none'; return; }
    chip.style.display = 'block';
    chip.textContent = midiNoteName(aim.midi);
    chip.style.left = Math.max(4, 16 + (landed.x + 12) * scale - 16) + 'px';
    chip.style.top = (16 + (landed.system * SYSTEM_H + 12 + STAFF_MIDS[aim.staff] - 6 * GAP) * scale) + 'px';
  }
  const placeHoldRef = useRef<number | null>(null);
  const placeOriginRef = useRef<{ x: number; y: number } | null>(null);
  const placeDownRef = useRef(false);
  // A note written by a hold has to be lifted into positioning mode, but it
  // does not exist until the parent re-renders with it. So the id is parked
  // here and the effect below picks it up the moment its glyph is engraved.
  const pendingLiftRef = useRef<string | null>(null);
  useEffect(() => { if (placeHoldRef.current) window.clearTimeout(placeHoldRef.current); }, []);

  function placePointerDown(event: React.PointerEvent) {
    lastPointerTypeRef.current = event.pointerType || 'mouse';
    if (locked || tool === 'erase') return;
    if (event.pointerType === 'mouse') return;                       // the mouse still clicks
    if ((event.target as Element).closest('[data-glyph]')) return;   // that is a note, not empty staff
    const aim = aimAt(event);
    placeRef.current = aim;
    placeOriginRef.current = { x: event.clientX, y: event.clientY };
    placeDownRef.current = true;
    showAim(aim);
    if (aim) startHoldRing(event);
    if (placeHoldRef.current) window.clearTimeout(placeHoldRef.current);
    if (!aim) return;
    placeHoldRef.current = window.setTimeout(() => {
      placeHoldRef.current = null;
      stopHoldRing();
      const held = placeRef.current;
      placeRef.current = null;
      showAim(null);
      if (!held) return;
      try { navigator.vibrate?.(18); } catch { /* not every phone buzzes */ }
      const id = onAddNote(held.staff, held.time, held.midi);
      // Straight into positioning: the note is written, and the tick is what
      // says it belongs there.
      if (typeof id === 'string') pendingLiftRef.current = id;
    }, HOLD_MS);
  }
  function placePointerMove(event: React.PointerEvent) {
    if (!placeRef.current) return;
    const origin = placeOriginRef.current;
    // Empty staff CAN be scrolled, so a genuine journey still means "I am
    // moving the page, not choosing a spot" -- but the bar is set where a
    // scroll lives, well clear of the drift of a hand holding still.
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 34) {
      if (placeHoldRef.current) { window.clearTimeout(placeHoldRef.current); placeHoldRef.current = null; }
      placeRef.current = null;
      stopHoldRing();
      showAim(null);
      return;
    }
    const aim = aimAt(event);
    if (aim) placeRef.current = aim;
    showAim(placeRef.current);
  }
  function placePointerUp() {
    stopHoldRing();
    if (placeHoldRef.current) { window.clearTimeout(placeHoldRef.current); placeHoldRef.current = null; }
    placeRef.current = null;
    placeOriginRef.current = null;
    placeDownRef.current = false;
    showAim(null);
    // A tap writes nothing. Only the hold does.
  }

  useEffect(() => {
    const id = pendingLiftRef.current;
    if (!id) return;
    const glyph = layout.glyphs.find(item => item.id === id);
    const note = notes.find(item => item.id === id);
    if (!glyph || !note) return;                       // engraved on a later render
    const bar = layout.barAt(note.start);
    pendingLiftRef.current = null;
    if (!bar) return;
    const secondsPerPx = (bar.end - bar.start) / (bar.width - BAR_PAD);
    setEditHistory([]);
    setTouchEdit({
      ids: [id], id, note, step: glyph.step, clef: STAFF_CLEFS[glyph.staff],
      secondsPerPx, x: glyph.x, system: glyph.system, staff: glyph.staff,
    });
    // Still holding? Then the finger that wrote this note is already carrying
    // it, and lifting to press it again would be a pointless ceremony.
    if (placeDownRef.current && placeOriginRef.current) {
      dragRef.current = {
        id, note, step: glyph.step, clef: STAFF_CLEFS[glyph.staff],
        originX: placeOriginRef.current.x, originY: placeOriginRef.current.y,
        secondsPerPx, moved: false, touch: true, held: true,
        gx: glyph.x, gsystem: glyph.system, gstaff: glyph.staff,
        baseSteps: 0, baseDx: 0,
      };
      lastStepsRef.current = 0;
    }
    focusHeld(glyph.x, glyph.system, glyph.staff, dragRef.current);
  }, [layout, notes]);

  function staffClick(event: React.MouseEvent<SVGSVGElement>) {
    // One mode: empty staff space enters a note; heads handle themselves.
    if ((event.target as Element).closest('[data-glyph]')) return;
    if (tool === 'erase') return;
    // Locked, the staff answers nothing: the tick and the cross are the only
    // ways out, so a stray tap cannot lose the edit.
    if (locked) return;
    // Touch writes only by holding, never by tapping -- and a tap still
    // raises a click, which would otherwise write the note the tap refused to.
    if (lastPointerTypeRef.current !== 'mouse') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / scale - 12;
    const y = (event.clientY - bounds.top) / scale;
    const system = Math.floor((y - 12) / SYSTEM_H);
    const yIn = y - 12 - system * SYSTEM_H;
    const staff = STAFF_MIDS.findIndex(mid => yIn > mid - 5 * GAP && yIn < mid + 5 * GAP);
    if (staff < 0) return;
    const time = layout.xyToTime(system, x);
    if (time === null) return;
    const step = Math.round((STAFF_MIDS[staff] - yIn) / STEP);
    onAddNote(staff, time, stepToMidi(step, STAFF_CLEFS[staff], layout.signature));
  }

  return <div ref={scrollRef} className="vh-editor-scrollbars relative h-full overflow-auto px-4 py-4"
    // Android raises its own long-press callout at about half a second, which
    // cancels the pointer stream the hold is counting on. This is the score,
    // not a web page to select text out of.
    // Held, the score itself stops moving: a finger dragging a note must not
    // also be panning the page it is drawn on.
    style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none', touchAction: locked ? 'none' : undefined }}
    onContextMenu={event => { if (lastPointerTypeRef.current !== 'mouse') event.preventDefault(); }}
    onDragOver={onBandDrop ? handleBandDragOver : undefined}
    onDrop={onBandDrop ? handleBandDrop : undefined}
    onDragLeave={onBandDrop ? event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setDropRange(null);
    } : undefined}>
    {/* Two boxes: the outer one reserves the space the drawing takes up once
        scaled, so the scrollbars are honest; the inner one is the score's own
        coordinate system, and everything inside it is positioned in score
        units at every zoom. */}
    <div style={{ width: (SYSTEM_W + 24) * scale, height: (layout.systems * SYSTEM_H + 24) * scale }}>
    <div className="relative" style={{ width: SYSTEM_W + 24, height: layout.systems * SYSTEM_H + 24, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
    <ScoreBody layout={layout} selectedIds={selectedIds} heldIds={touchEdit?.ids} drag={drag} tool={tool}
      onGlyphDown={beginDrag} onGlyphDoubleClick={glyph => { if (selectedIds.includes(glyph.id)) onDeselect?.(); }}
      onDown={placePointerDown}
      onMove={event => { moveDrag(event); placePointerMove(event); updateGhost(event); }}
      onUp={event => { endDrag(); placePointerUp(); void event; }}
      onLeave={() => { if (ghostRef.current) ghostRef.current.style.display = 'none'; }}
      onStaffClick={staffClick} onDoubleClick={lyricBandDoubleClick} onGlyphContext={eraseFromContextMenu} />
    <CursorLayer layout={layout} getPlayhead={getPlayhead} />
    {(layout.bandTexts.length > 0 || (onBandEdit && bandDefaults) || (clipMarkers?.length ?? 0) > 0) && <svg className="absolute left-0 top-0 z-10" width={SYSTEM_W + 24} height={layout.systems * SYSTEM_H + 24} style={{ pointerEvents: 'none' }} aria-hidden>
      {clipMarkers?.map((marker, index) => {
        const position = layout.timeToXY(marker.at);
        if (!position) return null;
        // A recording covers the staff for as long as it lasts, so it is
        // drawn as a band from where it starts to where it ends - across
        // system breaks if it runs that long.
        if (marker.endAt !== undefined && marker.endAt > marker.at) {
          const finish = layout.timeToXY(marker.endAt) ?? { system: position.system, x: layout.systemWidth(position.system) };
          const y = (system: number) => system * SYSTEM_H + 12 + CLIP_ROW_Y;
          const rows: Array<{ system: number; from: number; to: number }> = [];
          for (let system = position.system; system <= finish.system; system++) {
            rows.push({
              system,
              from: system === position.system ? position.x : MARGIN_LEFT,
              to: system === finish.system ? finish.x : layout.systemWidth(system),
            });
          }
          return <g key={`clip-${index}`}
            className={onClipEdit ? 'hover:opacity-90' : undefined}
            style={onClipEdit ? { pointerEvents: 'auto', cursor: 'pointer' } : undefined}
            onClick={onClipEdit ? () => onClipEdit(marker.trackId, marker.clipId) : undefined}>
            {onClipEdit && <title>{marker.label} — drag to move it along the music (it lands on a beat) · drag either end to crop · click for the panel</title>}
            {rows.map(row => {
              const width = Math.max(6, row.to - row.from);
              const first = row.system === position.system;
              const last = row.system === finish.system;
              return <g key={row.system}>
                <rect x={row.from + 12} y={y(row.system)} width={width} height={16} rx={4}
                  fill="#34d39922" stroke="#34d399aa" strokeWidth={1.1}
                  style={onClipDrag ? { pointerEvents: 'auto', cursor: 'grab', touchAction: 'none' } : { pointerEvents: 'auto' }}
                  onPointerDown={event => clipPointerDown(event, marker, 'move')}
                  onPointerMove={clipPointerMove}
                  onPointerUp={clipPointerUp}
                  onPointerCancel={clipPointerUp} />
                {/* the ends crop: grab either edge and drag it in or out */}
                {first && <rect x={row.from + 12} y={y(row.system)} width={9} height={16} rx={3}
                  fill="#34d399" fillOpacity={0.55}
                  style={onClipDrag ? { pointerEvents: 'auto', cursor: 'ew-resize', touchAction: 'none' } : undefined}
                  onPointerDown={event => clipPointerDown(event, marker, 'crop-start')}
                  onPointerMove={clipPointerMove}
                  onPointerUp={clipPointerUp}
                  onPointerCancel={clipPointerUp} />}
                {last && <rect x={row.from + 12 + width - 9} y={y(row.system)} width={9} height={16} rx={3}
                  fill="#34d399" fillOpacity={0.55}
                  style={onClipDrag ? { pointerEvents: 'auto', cursor: 'ew-resize', touchAction: 'none' } : undefined}
                  onPointerDown={event => clipPointerDown(event, marker, 'crop-end')}
                  onPointerMove={clipPointerMove}
                  onPointerUp={clipPointerUp}
                  onPointerCancel={clipPointerUp} />}
                {/* the grip: the clip is a thing you pull, not a caption */}
                {first && <text x={row.from + 25} y={y(row.system) + 12} fontSize={10} fill="#86efac" fillOpacity={0.75} style={{ pointerEvents: 'none' }}>⠿</text>}
                {first && <text x={row.from + 38} y={y(row.system) + 12} fontSize={9} fontWeight={800} fill="#86efac" style={{ pointerEvents: 'none' }}>{marker.label}</text>}
              </g>;
            })}
          </g>;
        }
        return <text key={`clip-${index}`} x={position.x + 12} y={position.system * SYSTEM_H + 12 + STAFF_MIDS[3] + 74}
          fontSize={10} fontWeight={800} fill="#86efac"
          className={onClipEdit ? 'hover:fill-white' : undefined} style={onClipEdit ? { pointerEvents: 'auto', cursor: 'pointer' } : undefined}
          onClick={onClipEdit ? () => onClipEdit(marker.trackId, marker.clipId) : undefined}>
          {onClipEdit && <title>A free clip on the {marker.label.replace('🎼 ', '')} track — click to open and edit exactly what it plays</title>}
          {marker.label}</text>;
      })}
      {onBandEdit && bandDefaults && <text x={14} y={12 + BAND_TEXT_Y} fontSize={10} fontStyle="italic" fontWeight={700}
        fill="#fca5a5cc" className="hover:fill-white" style={{ pointerEvents: 'auto', cursor: 'pointer' }}
        onClick={() => bandTap(() => { setBandEdit({ target: 'default', x: 30, system: 0 }); onBandAudition?.('default'); })}
        onDoubleClick={() => bandDoubleTap(() => onBandWrite?.('default'))}>
        <title>The band from the top of the song — click to hear and change it; double-click to write the part note by note</title>
        {bandDefaults.instrument === 'off' && bandDefaults.drums === 'off'
          ? '🎷 no band — click to add'
          : `${shortStyle(bandDefaults.instrument)} · ${shortStyle(bandDefaults.drums)}`}</text>}
      {layout.bandTexts.map((text, i) => <text key={`band-${i}`} x={text.x + 12} y={text.system * SYSTEM_H + 12 + BAND_TEXT_Y}
        fontSize={10} fontStyle="italic" fontWeight={700} fill="#fca5a5cc"
        className={onBandEdit ? 'hover:fill-white' : undefined} style={onBandEdit ? { pointerEvents: 'auto', cursor: 'pointer' } : undefined}
        onClick={onBandEdit ? () => bandTap(() => { setBandEdit({ target: { noteId: text.noteId }, x: text.x, system: text.system }); onBandAudition?.({ noteId: text.noteId }); }) : undefined}
        onDoubleClick={onBandWrite ? () => bandDoubleTap(() => onBandWrite({ noteId: text.noteId })) : undefined}>
        {onBandEdit && <title>Band instruction from this bar — click to hear and change it; double-click to write the part note by note</title>}
        {text.label}</text>)}
    </svg>}
    {dropRange && <svg className="pointer-events-none absolute left-0 top-0 z-20" width={SYSTEM_W + 24} height={layout.systems * SYSTEM_H + 24} aria-hidden>
      {layout.placedBars.filter(bar => bar.number >= Math.min(dropRange.anchor, dropRange.current) && bar.number <= Math.max(dropRange.anchor, dropRange.current)).map(bar =>
        <rect key={bar.number} x={bar.x + 12} y={bar.system * SYSTEM_H + 12 + STAFF_MIDS[0] - 2 * GAP - 26}
          width={bar.width} height={STAFF_MIDS[3] - STAFF_MIDS[0] + 4 * GAP + 46} rx={6}
          fill="#fbbf2415" stroke="#fbbf24" strokeWidth={1.2} strokeDasharray="5 4" />)}
    </svg>}
    {laneMarks.length > 0 && <svg className="pointer-events-none absolute left-0 top-0" width={SYSTEM_W + 24} height={layout.systems * SYSTEM_H + 24} aria-hidden>
      {laneSystems.map(system => <g key={system} fontSize={8}>
        <text x={2} y={system * SYSTEM_H + 12 + LANE_INSTRUMENT_Y} fill="#93c5fd" opacity={0.5}>🎸</text>
        <text x={2} y={system * SYSTEM_H + 12 + LANE_DRUM_Y} fill="#fca5a5" opacity={0.5}>🥁</text>
      </g>)}
      {laneMarks.map((mark, i) => <text key={i} x={mark.x + 12} y={mark.system * SYSTEM_H + 12 + (mark.drum ? LANE_DRUM_Y : LANE_INSTRUMENT_Y)}
        fontSize={mark.label.length > 1 ? 7.5 : 9.5} textAnchor="middle" fontWeight={700}
        fill={mark.drum ? '#fca5a5' : '#93c5fd'} opacity={mark.dim ? 0.4 : 0.85}>{mark.label}</text>)}
    </svg>}
    {onChordEdit && <svg className="absolute left-0 top-0 z-10" width={SYSTEM_W + 24} height={layout.systems * SYSTEM_H + 24} style={{ pointerEvents: 'none' }} aria-hidden>
      {layout.chordSlots.map((slot, index) => {
        const filled = chordInSlot(slot);
        const fx = filled ? (layout.timeToXY(filled.at)?.x ?? slot.x) : slot.x;
        const ringW = filled ? Math.max(26, filled.symbol.length * 6.6 + 10) : 18;
        const baseline = slot.system * SYSTEM_H + 12 + STAFF_MIDS[0] - 2 * GAP - 24;
        // The whole beat cell is the click target; the drawn box stays small.
        return <g key={index} className="group" style={{ pointerEvents: 'auto', cursor: 'text' }}
          onClick={event => { event.stopPropagation(); if (!locked) startChordEdit(index); }}>
          <title>{filled ? `${filled.symbol} — click to change or clear` : 'Click to write a chord on this beat'}</title>
          <rect x={slot.x + 12 - 17} y={baseline - 16} width={34} height={22} fill="transparent" />
          {filled
            ? <rect x={fx + 12 - ringW / 2} y={baseline - 12} width={ringW} height={16} rx={3.5} fill="#fde68a18" stroke="#fde68a" strokeWidth={1}
              className="opacity-0 transition-opacity group-hover:opacity-70" />
            : <rect x={slot.x + 12 - 9} y={baseline - 10} width={18} height={13} rx={3} fill="transparent" stroke="#fde68a" strokeWidth={1} strokeDasharray="2.5 2.5"
              className="opacity-20 transition-opacity group-hover:opacity-80" />}
        </g>;
      })}
    </svg>}
    <div ref={holdRingRef} className="pointer-events-none absolute z-30 hidden h-14 w-14 rounded-full border-[3px] border-cyan-300/80 bg-cyan-300/10 shadow-[0_0_18px_#22d3ee66]" style={{ transform: 'translate(-50%,-50%)' }} />
    <div ref={aimRef} className="pointer-events-none absolute z-40 hidden rounded-md border border-cyan-300/60 bg-[#04121ff2] px-1.5 py-0.5 font-mono text-[11px] font-bold text-cyan-100 shadow-[0_6px_18px_#000b]" />
    <div ref={ghostRef} className="pointer-events-none absolute left-0 top-0 z-10 hidden">
      <div className="h-2 w-2.5 rounded-[50%] border border-cyan-300/90 bg-cyan-300/25" style={{ transform: 'rotate(-14deg)' }} />
    </div>
    {touchEdit && (() => {
      const preview = drag && drag.id === touchEdit.id ? drag : null;
      const moved = Boolean(preview && (preview.dSteps !== 0 || preview.dx !== 0));
      const count = touchEdit.ids.length;
      const name = count > 1 ? count + ' notes' : midiNoteName(preview && preview.dSteps !== 0
        ? stepToMidi(touchEdit.step + preview.dSteps, touchEdit.clef, layout.signature)
        : touchEdit.note.midi);
      // Positioned in SCALED pixels, outside the box that scales, so the
      // buttons stay thumb-sized at 50% where the notes are 4px across.
      const left = 16 + (touchEdit.x + 12) * scale;
      const top = 16 + (touchEdit.system * SYSTEM_H + 12 + STAFF_MIDS[touchEdit.staff] + 5.5 * GAP) * scale;
      return <div className="absolute z-40 flex items-center gap-1 rounded-xl border border-cyan-300/45 bg-[#060c1af5] px-1.5 py-1 shadow-[0_12px_34px_#000c]"
        style={{ left: Math.max(4, left - 74), top }}>
        <b className="px-1 font-mono text-[11px] text-cyan-200">{name}</b>
        <button type="button" onClick={commitTouchEdit}
          title={moved ? 'Keep it here' : count > 1 ? 'Done — leave them as they are' : 'Leave it where it is'}
          className="rounded-lg border border-emerald-300/50 bg-emerald-300/15 px-2.5 py-1.5 text-xs font-bold text-emerald-100">✓</button>
        {onAuditionNotes && <button type="button" onClick={() => onAuditionNotes(touchEdit.ids)}
          title={count > 1 ? `Hear these ${count} notes together` : 'Hear this note'}
          className="rounded-lg border border-cyan-300/45 bg-cyan-300/10 px-2.5 py-1.5 text-xs text-cyan-100">▶</button>}
        <button type="button" onClick={stepBack}
          title={editHistory.length ? `Undo the last move (${editHistory.length} to go back through)` : 'Leave it where it was'}
          className={'rounded-lg border px-2.5 py-1.5 text-xs ' + (editHistory.length ? 'border-amber-300/50 bg-amber-300/10 text-amber-100' : 'border-white/20 text-slate-200')}>↩</button>
        <button type="button" onClick={deleteTouchEdit} title={count > 1 ? `Delete these ${count} notes` : 'Delete this note'}
          className="rounded-lg border border-rose-300/60 bg-rose-400/20 px-2.5 py-1.5 text-xs font-bold text-rose-100">✕</button>
      </div>;
    })()}
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
      style={{ left: lyricEdit.x + 12 - 48, top: lyricEdit.system * SYSTEM_H + 12 + LYRIC_YS[lyricEdit.staff] - 12 }} />}
    {chordEdit && <input autoFocus value={chordEdit.value} placeholder="C, G7…"
      onFocus={event => event.target.select()}
      onChange={event => setChordEdit(current => current && { ...current, value: event.target.value })}
      onKeyDown={event => {
        if (event.key === 'Tab') { event.preventDefault(); commitChord(event.shiftKey ? -1 : 1); }
        else if (event.key === 'Enter') { event.preventDefault(); commitChord(0); }
        else if (event.key === 'Escape') setChordEdit(null);
      }}
      onBlur={() => commitChord(0)}
      aria-label="Chord on this beat"
      className="absolute z-20 w-16 rounded border border-amber-300/70 bg-[#1a1206] px-1.5 py-0.5 text-center text-xs font-bold text-amber-100 shadow-[0_0_18px_#f59e0b44] placeholder:font-normal placeholder:text-amber-200/30"
      style={{ left: chordEdit.x + 12 - 32, top: chordEdit.system * SYSTEM_H + 12 + STAFF_MIDS[0] - 2 * GAP - 24 - 20 }} />}
    {bandEdit && onBandEdit && (() => {
      const isDefault = bandEdit.target === 'default';
      const current = isDefault
        ? { instrument: bandDefaults?.instrument ?? 'off', drums: bandDefaults?.drums ?? 'off' }
        : (notes.find(note => note.id === (bandEdit.target as { noteId: string }).noteId)?.marks?.band ?? {});
      return <div className="absolute z-30 w-60 rounded-xl border border-rose-300/40 bg-[#160a14] p-2 text-[10px] text-slate-200 shadow-[0_0_28px_#f43f5e40]"
        style={{ left: Math.max(4, Math.min(bandEdit.x + 12 - 120, SYSTEM_W - 230)), top: bandEdit.system * SYSTEM_H + 12 + BAND_TEXT_Y + 22 }}
        onKeyDown={event => { if (event.key === 'Escape') setBandEdit(null); }}>
        <div className="mb-1.5 flex items-center justify-between">
          <b className="text-[9px] font-black uppercase tracking-[.16em] text-rose-200">{isDefault ? 'Band · from the top' : 'Band · from this bar'}</b>
          <button onClick={() => setBandEdit(null)} aria-label="Close band editor" className="rounded px-1.5 text-slate-400 hover:text-white">✕</button>
        </div>
        <label className="mb-1 flex items-center gap-1.5">🎸
          <select autoFocus value={current.instrument ?? ''} onChange={event => onBandEdit(bandEdit.target, 'instrument', event.target.value)}
            aria-label="Instrument from here" className="w-full rounded border border-white/15 bg-black/40 px-1 py-1 text-[10px] text-white">
            {!isDefault && <option value="">(keep playing)</option>}
            {INSTRUMENT_STYLES.filter(style => isDefault || style.id !== 'off').map(style => <option key={style.id} value={style.id}>{style.label}</option>)}
            {!isDefault && <option value="stop">🚫 Stop the instrument</option>}
          </select></label>
        <label className="flex items-center gap-1.5">🥁
          <select value={current.drums ?? ''} onChange={event => onBandEdit(bandEdit.target, 'drums', event.target.value)}
            aria-label="Drums from here" className="w-full rounded border border-white/15 bg-black/40 px-1 py-1 text-[10px] text-white">
            {!isDefault && <option value="">(keep playing)</option>}
            {DRUM_STYLES.filter(style => isDefault || style.id !== 'off').map(style => <option key={style.id} value={style.id}>{style.label}</option>)}
            {!isDefault && <option value="stop">🚫 Stop the drums</option>}
          </select></label>
        {onBandWrite && <button onClick={() => { const target = bandEdit.target; setBandEdit(null); onBandWrite(target); }}
          className="mt-1.5 w-full rounded border border-sky-300/30 px-2 py-1 text-sky-200 hover:bg-sky-300/10">✍ Write the part yourself…</button>}
        {!isDefault && <button onClick={() => { onBandEdit(bandEdit.target, 'remove', ''); setBandEdit(null); }}
          className="mt-1.5 w-full rounded border border-rose-300/30 px-2 py-1 text-rose-200 hover:bg-rose-300/10">Remove this instruction</button>}
        <button onClick={() => setBandEdit(null)} className="mt-1.5 w-full rounded border border-emerald-300/30 px-2 py-1 text-emerald-200 hover:bg-emerald-300/10">Done</button>
      </div>;
    })()}
    </div>
    </div>
  </div>;
}

const ScoreBody = React.memo(function ScoreBody({ layout, selectedIds, heldIds, drag, tool, onGlyphDown, onGlyphDoubleClick, onDown, onMove, onUp, onLeave, onStaffClick, onDoubleClick, onGlyphContext }: {
  layout: Layout; selectedIds: string[]; heldIds?: string[]; drag: DragPreview; tool: ScoreTool;
  onGlyphDown: (event: React.PointerEvent, glyph: Glyph) => void;
  onGlyphDoubleClick: (glyph: Glyph) => void;
  onDown: (event: React.PointerEvent) => void;
  onMove: (event: React.PointerEvent) => void;
  onUp: (event: React.PointerEvent) => void;
  onLeave: () => void;
  onStaffClick: (event: React.MouseEvent<SVGSVGElement>) => void;
  onDoubleClick: (event: React.MouseEvent<SVGSVGElement>) => void;
  onGlyphContext: (id: string) => void;
}) {
  const selected = new Set(selectedIds);
  // The notes this edit is about. Everything else on the staff is scenery
  // until the tick.
  const held = new Set(heldIds ?? []);
  return <svg width={SYSTEM_W + 24} height={layout.systems * SYSTEM_H + 24} className="select-none"
    onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onLeave} onClick={onStaffClick} onDoubleClick={onDoubleClick}
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
    {layout.rests.map((rest, i) => <g key={`rest-${i}`} transform={`translate(12 ${rest.system * SYSTEM_H + 12})`} pointerEvents="none" opacity={0.6}>
      {rest.block === 'whole' && <rect x={rest.x - 4.5} y={STAFF_MIDS[rest.staff] - GAP} width={9} height={3.6} fill="#ffffff" />}
      {rest.block === 'half' && <rect x={rest.x - 4.5} y={STAFF_MIDS[rest.staff] - 3.6} width={9} height={3.6} fill="#ffffff" />}
      {rest.symbol && <text x={rest.x} y={STAFF_MIDS[rest.staff] + 8} fontSize={24} textAnchor="middle" fill="#ffffff" fontFamily="'Segoe UI Symbol','Noto Music',serif">{rest.symbol}</text>}
      {rest.dotted && <circle cx={rest.x + 9} cy={STAFF_MIDS[rest.staff] - STEP} r={1.6} fill="#ffffff" />}
    </g>)}
    {layout.beams.map((beam, i) => <g key={`beam-${i}`} transform={`translate(12 ${beam.system * SYSTEM_H + 12})`}>
      <line x1={beam.x1} x2={beam.x2} y1={beam.y} y2={beam.y} stroke="#ffffff" strokeWidth={3.2} />
      {beam.double && <line x1={beam.x1} x2={beam.x2} y1={beam.y + (beam.up ? 5 : -5)} y2={beam.y + (beam.up ? 5 : -5)} stroke="#ffffff" strokeWidth={3.2} />}
      {beam.triplet && <text x={(beam.x1 + beam.x2) / 2} y={beam.y + (beam.up ? -4 : 12)} fontSize={10} fontStyle="italic" fontWeight={700} textAnchor="middle" fill="#ffffffcc">3</text>}
    </g>)}
    {layout.slides.map((slide, i) => <line key={`slide-${i}`} transform={`translate(12 ${slide.system * SYSTEM_H + 12})`}
      x1={slide.x1} y1={slide.y1} x2={slide.x2} y2={slide.y2} stroke="#ffffffd8" strokeWidth={1.6} pointerEvents="none" />)}
    {layout.tempoTexts.map((text, i) => <text key={`tempo-${i}`} x={text.x + 12} y={text.system * SYSTEM_H + 12 + STAFF_MIDS[0] - 2 * GAP - 38}
      fontSize={12} fontStyle="italic" fontWeight={800} fill="#7dd3fc" fontFamily="Georgia,'Times New Roman',serif">{text.label}</text>)}
    {layout.chordTexts.map((text, i) => <text key={`chord-${i}`} x={text.x + 12} y={text.system * SYSTEM_H + 12 + STAFF_MIDS[0] - 2 * GAP - 24}
      fontSize={12} fontWeight={800} textAnchor="middle" fill="#fde68a">{text.label}</text>)}
    {layout.spans.map((span, i) => {
      const mid = STAFF_MIDS[span.staff];
      const top = span.system * SYSTEM_H + 12;
      if (span.kind === 'slur') {
        const arcY = Math.min(span.y1, span.y2) - 20;
        return <g key={`span-${i}`} transform={`translate(12 ${top})`} pointerEvents="none">
          <path d={`M ${span.x1} ${span.y1 - 7} Q ${(span.x1 + span.x2) / 2} ${arcY}, ${span.x2} ${span.y2 - 7}`} stroke="#ffffffd8" strokeWidth={1.4} fill="none" />
        </g>;
      }
      // Hairpins sit above the staff in vocal writing — the words own the
      // space below. The two jaw lines run between this segment's opening
      // widths, so a wedge split over a line break stays continuous.
      const yMid = mid - 2 * GAP - 9;
      return <g key={`span-${i}`} transform={`translate(12 ${top})`} pointerEvents="none" stroke="#ffffffc8" strokeWidth={1.2} fill="none">
        <path d={`M ${span.x1} ${yMid - span.w1} L ${span.x2} ${yMid - span.w2} M ${span.x1} ${yMid + span.w1} L ${span.x2} ${yMid + span.w2}`} />
      </g>;
    })}
    {layout.glyphs.map(glyph => {
      const top = glyph.system * SYSTEM_H + 12;
      const isSelected = selected.has(glyph.id);
      const dragging = drag && drag.ids.includes(glyph.id) ? drag : null;
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
      // Where it will land, drawn right across the system: the eye needs a
      // line to read the pitch against, not a floating head.
      for (let line = 6; line <= Math.abs(previewStep); line += 2) ledger.push(previewStep > 0 ? line : -line);
      return <g key={`${glyph.id}-${glyph.x}`} data-glyph transform={`translate(12 ${top})`}
        onPointerDown={event => onGlyphDown(event, glyph)}
        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onGlyphContext(glyph.id); }}
        // A finger starting on a notehead is DRAGGING it, not panning the
        // score. Without this the browser claims the gesture as a scroll --
        // it owns the decision at touchstart, and the score scrolls both ways
        // -- so the pointer stream was cancelled before a note ever moved and
        // dragging was simply a desktop-only feature. The catch area is 9px
        // around the head, so panning from anywhere else still works.
        style={{ cursor: tool === 'erase' ? 'not-allowed' : 'pointer', touchAction: 'none' }}>
        {held.has(glyph.id) && <circle cx={gx} cy={gy} r={10.5} fill="none" stroke="#22d3ee" strokeWidth={1.8} opacity={.95} />}
        {dragging && <line x1={-12} x2={SYSTEM_W} y1={gy} y2={gy} stroke="#22d3ee" strokeWidth={1} strokeDasharray="5 4" opacity={.6} />}
        {ledger.map(step => <line key={step} x1={gx - 8} x2={gx + 8} y1={mid - step * STEP} y2={mid - step * STEP} stroke="#ffffff55" strokeWidth={1} />)}
        {glyph.mark && !dragging && <text x={gx - 15} y={gy + 4.5} fontSize={13} fill={colour}>{glyph.mark}</text>}
        {/* An invisible catch area: the printed head is ~5px, far too small a
            target — clicks meant for the note were landing on "empty staff"
            and writing a new one instead. Double-click sits on the HEAD, not
            the whole group, so double-clicking the lyric word below still
            opens the lyric editor. */}
        <circle cx={gx} cy={gy} r={9} fill="transparent" stroke="none"
          onDoubleClick={event => { event.stopPropagation(); onGlyphDoubleClick(glyph); }} />
        <ellipse onDoubleClick={event => { event.stopPropagation(); onGlyphDoubleClick(glyph); }}
          cx={gx} cy={gy} rx={4.8} ry={3.5} transform={`rotate(-14 ${gx} ${gy})`}
          fill={glyph.value >= 2 ? 'transparent' : colour} stroke={colour} strokeWidth={glyph.value >= 2 ? 1.6 : 1} />
        {glyph.value < 4 && <line x1={stemX} x2={stemX} y1={gy} y2={stemEndY} stroke={colour} strokeWidth={1.1} />}
        {glyph.value <= 0.5 && !glyph.beam && <path d={stemUp
          ? `M ${stemX} ${gy - 26} c 6 4, 9 8, 6 16`
          : `M ${stemX} ${gy + 26} c 6 -4, 9 -8, 6 -16`} stroke={colour} strokeWidth={1.4} fill="none" />}
        {glyph.value <= 0.25 && !glyph.beam && <path d={stemUp
          ? `M ${stemX} ${gy - 20} c 6 4, 9 8, 6 16`
          : `M ${stemX} ${gy + 20} c 6 -4, 9 -8, 6 -16`} stroke={colour} strokeWidth={1.4} fill="none" />}
        {glyph.dotted && <circle cx={gx + 8.5} cy={glyph.step % 2 === 0 ? gy - STEP : gy} r={1.7} fill={colour} />}
        {glyph.triplet && !glyph.beam && <text x={gx} y={gy - (previewStep < 0 ? 32 : 14)} fontSize={10} fontStyle="italic" fontWeight={700} textAnchor="middle" fill="#ffffffcc">3</text>}
        {glyph.marks?.staccato && <circle cx={gx} cy={gy + (stemUp ? 8 : -8)} r={1.7} fill={colour} />}
        {glyph.marks?.tenuto && <rect x={gx - 4} y={gy + (stemUp ? 7 : -8.5)} width={8} height={1.8} fill={colour} />}
        {glyph.marks?.fermata && <text x={gx} y={mid - 2 * GAP - 14} fontSize={15} textAnchor="middle" fill="#ffffffd8" fontFamily="'Segoe UI Symbol','Noto Music',serif">{'\u{1D110}'}</text>}
        {glyph.marks?.dynamic && <text x={gx} y={mid - 2 * GAP - 3} fontSize={12} fontStyle="italic" fontWeight={800} textAnchor="middle" fill="#fbbf24" fontFamily="Georgia,'Times New Roman',serif">{glyph.marks.dynamic}</text>}
        {glyph.tieFrom && glyph.tieFrom.x < glyph.x && !dragging &&
          <path d={`M ${glyph.tieFrom.x + 5} ${glyph.tieFrom.y + 6} Q ${(glyph.tieFrom.x + glyph.x) / 2} ${glyph.tieFrom.y + 12}, ${glyph.x - 5} ${glyph.y + 6}`} stroke={colour} strokeWidth={1.1} fill="none" />}
        {glyph.lyric && <text x={glyph.x} y={LYRIC_YS[glyph.staff]} fontSize={10.5} fill={isSelected ? '#ec4899' : '#cbd5e1'} textAnchor="middle">{glyph.lyric}</text>}
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
          line.style.transform = `translate(${at.x + 12}px, ${at.system * SYSTEM_H + 12 + STAFF_MIDS[0] - 3 * GAP}px)`;
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

function buildLayout(notes: SongNote[], rawBars: ScoreBar[], signatureOverride?: number, chords?: Array<{ at: number; symbol: string }>, showLeadIn?: boolean) {
  // The page opens where the music does: whole bars of lead-in silence are
  // dropped, not shifted — shifting the grid under the notes broke any bar
  // list whose lengths vary (a rendition with a broader pass), and it made
  // the printed bar numbers disagree with the entry caret's.
  // The EDITOR shows the lead-in instead (showLeadIn): those bars are where
  // instrumental intros live — clips can be dropped on them and the count-in
  // is visible — so hiding them would hide the intro workflow itself.
  const offset = showLeadIn ? 0 : notes.length ? Math.min(...notes.map(note => note.start)) : 0;
  const bars = rawBars.filter(bar => bar.end > offset + 0.01);
  const signature = signatureOverride ?? inferKeySignature(notes.map(note => note.midi));
  const mark = signature > 0 ? '♯' : '♭';
  const steps = signature > 0 ? SHARP_STEPS_TREBLE : FLAT_STEPS_TREBLE;
  const signatureGlyphs = Array.from({ length: Math.abs(signature) }, (_, index) => ({ index, mark, trebleStep: steps[index] }));

  const usable = SYSTEM_W - MARGIN_LEFT - 12;
  type PlacedBar = ScoreBar & { system: number; x: number; width: number };
  // Bars breathe for their words, as engraving always has: a bar whose
  // melody carries long syllables widens until neighbouring lyrics stop
  // colliding, instead of every bar getting the same beats-times-pixels.
  const lyricNeed = new Map<number, number>();
  for (const bar of bars) {
    // Each staff prints its own lyric row, so the bar must fit its WIDEST
    // row — rows on different staves never collide with each other.
    const rowWidths = new Map<number, number>();
    for (const note of notes) {
      if (!(note.lyric ?? '').trim() || note.start < bar.start - 0.001 || note.start >= bar.end - 0.001) continue;
      const staff = staffOfPart(note.part);
      rowWidths.set(staff, (rowWidths.get(staff) ?? 0) + Math.max(16, note.lyric!.trim().length * 5.6 + 8));
    }
    let widest = 0;
    for (const width of rowWidths.values()) widest = Math.max(widest, width);
    if (widest) lyricNeed.set(bar.number, widest);
  }
  // ...and for their NOTES: a bar carrying a sixteenth figure needs room for
  // every head, or the turn prints as a pile-up with its neighbours.
  const noteNeed = new Map<number, number>();
  for (const bar of bars) {
    const onsetsByPart = new Map<number, Set<number>>();
    for (const note of notes) {
      if (note.start < bar.start - 0.001 || note.start >= bar.end - 0.001) continue;
      if (!onsetsByPart.has(note.part)) onsetsByPart.set(note.part, new Set());
      onsetsByPart.get(note.part)!.add(Math.round(note.start * 96));
    }
    let busiest = 0;
    for (const set of onsetsByPart.values()) busiest = Math.max(busiest, set.size);
    if (busiest > 2) noteNeed.set(bar.number, busiest * 30 + 12);
  }
  const placed: PlacedBar[] = [];
  let system = 0, x = MARGIN_LEFT;
  for (const bar of bars) {
    const natural = bar.beatCount * BEAT_W;
    const need = Math.max(lyricNeed.get(bar.number) ?? 0, noteNeed.get(bar.number) ?? 0);
    const width = Math.max(natural, Math.min(natural * 2.4, need)) + BAR_PAD;
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
    // Clamped just under 1: a click in the bar's trailing padding must stay
    // THIS bar's time — at exactly bar.end it would belong to the next bar,
    // and a note aimed at the last beat landed on the wrong side of the line.
    const frac = Math.max(0, Math.min(0.999, (x - bar.x - 6) / Math.max(1, bar.width - BAR_PAD)));
    return bar.start + frac * (bar.end - bar.start);
  };
  const systemWidth = (index: number) => {
    const last = placed.filter(bar => bar.system === index).at(-1);
    return last ? last.x + last.width : SYSTEM_W - 12;
  };

  const glyphs: Glyph[] = [];
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.part - b.part);
  const barStates = new Map<string, Map<string, Accidental>>();
  // A dynamic prints once, where it changes — a phrase marked forte is one
  // f, not one per note.
  const lastDynamic = new Map<number, string | undefined>();
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
          value: symbol.value, dotted: symbol.dotted, triplet: symbol.triplet,
          marks: first ? (() => {
            if (!note.marks) return undefined;
            if (note.marks.dynamic && lastDynamic.get(staff) === note.marks.dynamic) return { ...note.marks, dynamic: undefined };
            if (note.marks.dynamic) lastDynamic.set(staff, note.marks.dynamic);
            return note.marks;
          })() : undefined,
          tieFrom: previous ?? undefined,
          mark: first ? accidentalMark(pitch, signature, state) : null,
          lyric: first ? note.lyric ?? '' : '',
          staff, system: position.system,
          barNumber: bar.number, beat: Math.floor((symbolTime - bar.start) / beatLen + 1e-6),
        });
        previous = { x: position.x, y };
        first = false;
        symbolTime += symbol.beats * beatLen;
      }
      spanStart = spanEnd;
    }
  }
  // Rests make the arithmetic visible: silence in a bar is engraved, so
  // every bar visibly adds up to its meter instead of looking short. The
  // whole-bar rest is the hanging block whatever the meter; the half rest
  // sits on the middle line; shorter rests are the usual squiggles.
  type Rest = { x: number; system: number; staff: number; symbol: string | null; block: 'whole' | 'half' | null; dotted: boolean };
  const rests: Rest[] = [];
  const REST_GLYPHS: Record<number, string> = { 1: '\u{1D13D}', 0.5: '\u{1D13E}', 0.25: '\u{1D13F}' };
  // Rests live only where the piece does: the grid keeps empty padding bars
  // after the last note so there is room to click new music in, and those
  // must stay clean staves, not four rows of whole rests.
  const musicEnd = notes.length ? Math.max(...notes.map(note => note.end)) : 0;
  for (let staff = 0; staff < 4; staff++) {
    const staffNotes = notes.filter(note => staffOfPart(note.part) === staff).sort((a, b) => a.start - b.start);
    if (!staffNotes.length) continue;  // an unused voice stays a clean staff, not a wall of rests
    for (const bar of placed) {
      if (bar.start > musicEnd - 0.05) break;
      const beatLen = (bar.end - bar.start) / bar.beatCount;
      // Gaps are measured in BEATS, and anything under a fifth of a beat is
      // articulation, not silence: stored durations carry a ~4% breathing
      // gap, which after a half note is 0.08 beats — printing that as a
      // semiquaver rest would litter the page with phantom rests.
      let cursor = bar.start;
      const gaps: Array<[number, number]> = [];
      for (const note of staffNotes) {
        if (note.end <= bar.start + 0.01 || note.start >= bar.end - 0.01) continue;
        const from = Math.max(bar.start, note.start);
        if ((from - cursor) / beatLen > 0.2) gaps.push([cursor, from]);
        cursor = Math.max(cursor, Math.min(bar.end, note.end));
      }
      if ((bar.end - cursor) / beatLen > 0.2) gaps.push([cursor, bar.end]);
      for (const [gapStart, gapEnd] of gaps) {
        const wholeBar = gapEnd - gapStart > bar.end - bar.start - 0.02;
        const symbols = wholeBar ? [{ value: 4, dotted: false }] : durationToSymbols((gapEnd - gapStart) / beatLen);
        let restTime = gapStart;
        for (const symbol of symbols) {
          const position = timeToXY(restTime)!;
          rests.push({
            x: position.x, system: position.system, staff, dotted: symbol.dotted,
            symbol: REST_GLYPHS[symbol.value] ?? null,
            block: symbol.value >= 4 || wholeBar ? 'whole' : symbol.value >= 2 ? 'half' : null,
          });
          restTime = Math.min(gapEnd, restTime + symbol.value * (symbol.dotted ? 1.5 : 1) * beatLen);
        }
      }
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
    beams.push({ system: group[0].system, x1, x2, y, up, double: group.every(g => g.value <= 0.25), triplet: group.every(g => g.triplet) });
  }
  // Slurs and hairpins: 'start' marks open, the next 'end' in the same staff
  // closes. Drawn only when both ends share a system — the common case; an
  // arc across a line break is a later refinement.
  // A span that crosses a line break is drawn in two pieces, the way
  // engraving always has: out to the right edge, then in from the left
  // margin. Hairpins carry their opening widths so the wedge grows (or
  // narrows) continuously across the break.
  type Span = { kind: 'slur' | 'pin'; staff: number; system: number; x1: number; y1: number; x2: number; y2: number; w1: number; w2: number };
  const spans: Span[] = [];
  const PIN_W = 4.5;
  const pushSlur = (staff: number, from: Glyph, to: Glyph) => {
    if (from.system === to.system) spans.push({ kind: 'slur', staff, system: to.system, x1: from.x, y1: from.y, x2: to.x, y2: to.y, w1: 0, w2: 0 });
    else {
      spans.push({ kind: 'slur', staff, system: from.system, x1: from.x, y1: from.y, x2: systemWidth(from.system) - 6, y2: from.y, w1: 0, w2: 0 });
      spans.push({ kind: 'slur', staff, system: to.system, x1: MARGIN_LEFT + 2, y1: to.y, x2: to.x, y2: to.y, w1: 0, w2: 0 });
    }
  };
  const pushPin = (staff: number, from: Glyph, to: Glyph, kind: 'cresc' | 'decresc') => {
    const wide = kind === 'cresc' ? [0, PIN_W] : [PIN_W, 0];
    if (from.system === to.system) spans.push({ kind: 'pin', staff, system: to.system, x1: from.x, y1: 0, x2: to.x, y2: 0, w1: wide[0], w2: wide[1] });
    else {
      const midWidth = (wide[0] + wide[1]) / 2;
      spans.push({ kind: 'pin', staff, system: from.system, x1: from.x, y1: 0, x2: systemWidth(from.system) - 6, y2: 0, w1: wide[0], w2: midWidth });
      spans.push({ kind: 'pin', staff, system: to.system, x1: MARGIN_LEFT + 2, y1: 0, x2: to.x, y2: 0, w1: midWidth, w2: wide[1] });
    }
  };
  for (let staff = 0; staff < 4; staff++) {
    const firsts = glyphs.filter(g => g.staff === staff && g.marks).sort((a, b) => a.system - b.system || a.x - b.x);
    let openSlur: Glyph | null = null;
    let openPin: { glyph: Glyph; kind: 'cresc' | 'decresc' } | null = null;
    for (const glyph of firsts) {
      if (glyph.marks!.slur === 'start') openSlur = glyph;
      else if (glyph.marks!.slur === 'end' && openSlur) { pushSlur(staff, openSlur, glyph); openSlur = null; }
      if (glyph.marks!.hairpin === 'cresc' || glyph.marks!.hairpin === 'decresc') openPin = { glyph, kind: glyph.marks!.hairpin! as 'cresc' | 'decresc' };
      else if (glyph.marks!.hairpin === 'end' && openPin) { pushPin(staff, openPin.glyph, glyph, openPin.kind); openPin = null; }
    }
  }
  // Tempo terms are SCORE-level: whichever voice carries the mark, the term
  // prints once above the top staff at that moment.
  const TEMPO_LABELS: Record<string, string> = { rit: 'rit.', accel: 'accel.', atempo: 'a tempo', allegro: 'Allegro' };
  const tempoTexts: Array<{ x: number; system: number; label: string }> = [];
  for (const glyph of glyphs) {
    const kind = glyph.marks?.tempo;
    if (!kind) continue;
    if (tempoTexts.some(text => text.system === glyph.system && Math.abs(text.x - glyph.x) < 14)) continue;
    tempoTexts.push({ x: glyph.x, system: glyph.system, label: TEMPO_LABELS[kind] ?? kind });
  }
  // Band instructions print below the bass staff, where a rhythm section
  // reads: "gtr folk · kit", "band: tacet".
  const bandTexts: Array<{ x: number; system: number; label: string; noteId: string }> = [];
  for (const glyph of glyphs) {
    const band = glyph.marks?.band;
    if (!band || (!band.instrument && !band.drums)) continue;
    if (bandTexts.some(text => text.system === glyph.system && Math.abs(text.x - glyph.x) < 14)) continue;
    const parts: string[] = [];
    if (band.instrument) parts.push(shortStyle(band.instrument));
    if (band.drums) parts.push(shortStyle(band.drums));
    bandTexts.push({ x: glyph.x, system: glyph.system, label: parts.join(' · '), noteId: glyph.id });
  }
  // Slide (portamento) lines: from a marked note's head toward the next
  // note's head on the same staff — the singer's glide, drawn. A slide
  // that crosses a line break (or leads nowhere) becomes a short tick
  // sloped toward where the voice is going.
  const slides: Array<{ x1: number; y1: number; x2: number; y2: number; system: number }> = [];
  for (const note of sorted) {
    if (!note.marks?.slide) continue;
    const staff = staffOfPart(note.part);
    const from = glyphs.filter(glyph => glyph.id === note.id && glyph.staff === staff).at(-1);
    if (!from) continue;
    const next = sorted.filter(item => staffOfPart(item.part) === staff && item.id !== note.id && item.start >= note.end - 0.05)
      .sort((a, b) => a.start - b.start)[0];
    const to = next ? glyphs.find(glyph => glyph.id === next.id) : undefined;
    if (to && to.system === from.system && to.x - from.x >= 18) {
      slides.push({ x1: from.x + 7, y1: from.y + (to.y >= from.y ? 2 : -2), x2: to.x - 7, y2: to.y + (to.y >= from.y ? -2 : 2), system: from.system });
    } else {
      const slope = to ? (to.y > from.y ? 6 : -6) : 4;
      slides.push({ x1: from.x + 7, y1: from.y + (slope > 0 ? 2 : -2), x2: from.x + 17, y2: from.y + slope, system: from.system });
    }
  }
  // Chord symbols ride above the top staff, lead-sheet style.
  const chordTexts: Array<{ x: number; system: number; label: string }> = [];
  for (const chord of chords ?? []) {
    const position = timeToXY(chord.at);
    if (position) chordTexts.push({ x: position.x, system: position.system, label: chord.symbol });
  }
  // Neighbouring symbols keep clear of each other — half-beat changes like
  // Em/B then B printed as one smear. Later labels slide right just enough
  // (they are centre-anchored, so the gap is the two half-widths plus air).
  chordTexts.sort((a, b) => a.system - b.system || a.x - b.x);
  for (let i = 1; i < chordTexts.length; i++) {
    const prev = chordTexts[i - 1], cur = chordTexts[i];
    if (cur.system !== prev.system) continue;
    const minGap = (prev.label.length + cur.label.length) * 3.6 + 6;
    if (cur.x - prev.x < minGap) cur.x = prev.x + minGap;
  }
  // One chord landing slot floats over every beat — the lead sheet's empty
  // spaces made clickable. Each slot OWNS the half-beat around it, so a
  // chord entered off the beat (via the Expression bar) still belongs to
  // its nearest slot instead of leaving a deceptively empty box beside it.
  // Rendered only when an onChordEdit handler is wired.
  const chordSlots: Array<{ at: number; x: number; system: number; window: number }> = [];
  for (const bar of placed) {
    const beatLen = (bar.end - bar.start) / Math.max(1, bar.beatCount);
    for (let beat = 0; beat < bar.beatCount; beat++) {
      const at = bar.start + beat * beatLen;
      const position = timeToXY(at);
      if (position) chordSlots.push({ at: Math.round(at * 1000) / 1000, x: position.x, system: position.system, window: beatLen / 2 });
    }
  }
  const meter: [number, number] = [bars[0]?.numerator ?? 4, bars[0]?.denominator ?? 4];
  return { glyphs, beams, rests, spans, slides, tempoTexts, chordTexts, chordSlots, bandTexts, placedBars: placed, systems, barlines, signatureGlyphs, meter, signature, timeToXY, xyToTime, barAt, systemWidth };
}
