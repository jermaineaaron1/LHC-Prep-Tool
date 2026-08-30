'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RenditionRail } from './RenditionBuilder';
import { ScoreView, type ScoreBar } from './ScoreView';
import { AlignedVoicesOverview, DrumGridEditor, InstrumentStaffEditor, PART_CELL, PART_LEFT, buildPartText, drumLengthEighths, midiToken, parsePartCells, partLengthEighths, type PartCell } from './PartStaffEditor';
import { inferKeySignature, signatureAlteration, snapBeats } from '@/lib/vocal-hero/notation';
import { compileRendition, deriveSections, type RenditionCard } from '@/lib/vocal-hero/rendition';
import { createSongStub, updateSong } from '@/lib/vocal-hero/supabaseClient';
import type { BackingTrackClip, BackingTrackSettings, DynamicMark, MusicalTimelineSettings, NoteMarks, RhythmicNoteValue, Song, SongNote, TempoMarkKind, TimedLyricSection, VocalTake } from '@/lib/vocal-hero/types';
import { mixBus } from '@/lib/vocal-hero/voiceSynth';
import { playableNotes } from '@/lib/vocal-hero/songData';
import { assignMidiParts, DEFAULT_SATB_MIDI_RANGES, midiSourceKey, normaliseSatbMidiRanges, parseMidiNotes, type ImportedMidiNote, type SatbMidiRanges } from '@/lib/vocal-hero/midi';
import { assignXmlParts, parseMusicXml, readMusicXmlFile, type MusicXmlImport } from '@/lib/vocal-hero/musicxml';
import { detectVocalNotes, type AudioNoteDetectionDiagnostics } from '@/lib/vocal-hero/audioToNotes';
import { supabase } from '@/lib/vocal-hero/supabaseClient';
import { BackingTrackPanel } from './BackingTrackPanel';
import { BackingTrackLane } from './BackingTrackLane';
import { DEFAULT_TARGETS_PER_PHRASE } from '@/lib/vocal-hero/liveCues';
import { HARMONY_INTERVALS, harmoniseInto, resolveOverlapsPreservingRhythm, splitIntoSyllables, spreadLyricsAcrossNotes, alignToMelodyRhythm } from '@/lib/vocal-hero/arrange';
import { buildWarpTable, interpretMarks, tableUnwarp, tableWarp } from '@/lib/vocal-hero/performMarks';
import { parseChord, transposeChordSymbol } from '@/lib/vocal-hero/chords';

import { playVoice, preloadPiano, samplesReady, warmPiano } from '@/lib/vocal-hero/sampler';
import { downloadSingerVoice, playSingerBuffers, prepareSingerBuffers, singerVoiceReady, voiceKindForPart } from '@/lib/vocal-hero/singer';
import { bandRegions, buildBandEvents, DRUM_STYLES, INSTRUMENT_STYLES, playBandEvent, type BandEvent, type BandTimbre, type DrumStyleId, type InstrumentStyleId } from '@/lib/vocal-hero/accompaniment';
import { GROOVE_VIBES, planGroove } from '@/lib/vocal-hero/groove';

const VOICES = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#ff60bc', '#ffae42', '#4ca0ff', '#43e2bb'];
const TIMELINE_LABEL_WIDTH = 124;
const PITCH_ROW_HEIGHT = 22;
const PITCH_HEADER_HEIGHT = 34;
const DEFAULT_BPM = 120;
const DEFAULT_BEATS_PER_BAR = 4;
const DEFAULT_BEAT_UNIT = 4;
const DEFAULT_SNAP_DIVISION = 16;
const DEFAULT_NOTE_VALUE: RhythmicNoteValue = 'sixteenth';
const LASSO_THRESHOLD = 5;
const KEY_TONICS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const KEY_MODES = ['Major', 'Minor', 'Dorian', 'Mixolydian', 'Phrygian', 'Lydian'];
const VOICE_MIDI_RANGES = [
  { min: 60, max: 81 }, // Soprano C4-A5
  { min: 53, max: 74 }, // Alto F3-D5
  { min: 48, max: 67 }, // Tenor C3-G4
  { min: 40, max: 64 }, // Bass E2-E4
] as const;
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

function midiNoteName(midi: number) { const safe = Math.max(0, Math.min(127, Math.round(midi))); return `${NOTE_NAMES[safe % 12]}${Math.floor(safe / 12) - 1}`; }
function formatClock(seconds: number) { const safe = Math.max(0, seconds); return `${Math.floor(safe / 60)}:${String(Math.floor(safe) % 60).padStart(2, '0')}.${Math.floor((safe % 1) * 10)}`; }
// A voice's comfortable compass used to be a wall: the lane drew only those
// rows, so a pitch outside them could not be clicked, dragged to, or even
// seen. Parts share notes constantly — a unison between Alto and Tenor, a
// soprano line doubled an octave down — and none of that could be written.
//
// The compass is now advice rather than a fence. Each lane extends a fifth
// past it in both directions, which is enough for any pair of neighbouring
// voices to meet, and the rows beyond it are shaded so an arranger can still
// see at a glance where a voice is being asked to stretch.
const RANGE_MARGIN = 7;

function naturalRangeForPart(part: number) {
  return VOICE_MIDI_RANGES[part] ?? VOICE_MIDI_RANGES[0];
}

function pitchRangeForPart(part: number, notes: SongNote[] = []) {
  const natural = naturalRangeForPart(part);
  let min = natural.min - RANGE_MARGIN;
  let max = natural.max + RANGE_MARGIN;
  // Never hide a note that already exists, however far out it was put.
  for (const note of notes) {
    if (note.part !== part) continue;
    min = Math.min(min, Math.floor(note.midi) - 1);
    max = Math.max(max, Math.ceil(note.midi) + 1);
  }
  return { min: Math.max(0, min), max: Math.min(127, max), natural };
}
type EditableSong = Pick<Song, 'id' | 'title' | 'notes' | 'timed_lyrics' | 'backing_media_url' | 'backing_media_kind' | 'backing_track_settings'>;

// One decode per session for each sung take, shared across every play's
// AudioContext (an AudioBuffer is not tied to the context that decoded it).
const takeBufferCache = new Map<string, Promise<AudioBuffer | null>>();
function loadTakeBuffer(url: string): Promise<AudioBuffer | null> {
  if (!takeBufferCache.has(url)) {
    takeBufferCache.set(url, (async () => {
      try {
        const raw = await fetch(url).then(response => response.ok ? response.arrayBuffer() : null);
        if (!raw) return null;
        const scratch = new OfflineAudioContext(1, 8, 44100);
        return await scratch.decodeAudioData(raw);
      } catch { return null; }
    })());
  }
  return takeBufferCache.get(url)!;
}
type EditorTool = 'select' | 'draw' | 'erase';
type PlaybackScope = 'all' | 'range' | 'note';
type ArrangementSnapshot = { title: string; notes: SongNote[]; timedLyrics: TimedLyricSection[]; chordSymbols: Array<{ at: number; symbol: string }>; karaokeLyrics: BackingTrackSettings['karaoke_lyrics']; musicalTimeline: MusicalTimelineSettings; selectedId: string | null; selectedIds: string[]; selectedPart: number; playScope: PlaybackScope; playParts: boolean[]; playRange: { start: number; end: number } };
type MidiPreview = { fileName: string; notes: ImportedMidiNote[] };
const DEFAULT_TRACK_SETTINGS: BackingTrackSettings = { volume: 1, speed: 1, timeline_offset: 0, trim_start: 0, trim_end: null, loop_start: 0, loop_end: null, loop_enabled: false, skip_regions: [], split_markers: [], media_duration: null, effect: 'none' };

type MusicalState = { bpm: number; numerator: number; denominator: number; tonic: string; mode: string };
type MusicalBeat = { start: number; end: number; beat: number; bar: number; subdivisionStarts: number[] };
type MusicalBar = MusicalState & { start: number; end: number; number: number; beats: MusicalBeat[] };
type BeatPosition = MusicalState & { bar: number; beat: number; fraction: number; start: number; end: number };
type NoteDivision = NonNullable<MusicalTimelineSettings['snap_division']>;
type NoteValueDefinition = { value: RhythmicNoteValue; label: string; short: string; symbol: string; quarterBeats: number; requiredGrid: NoteDivision; group: 'Straight' | 'Dotted' | 'Double-dotted' | 'Tuplets' };
const GRID_DIVISIONS: Array<{ value: NoteDivision; label: string }> = [
  { value: 0, label: 'Free — no snapping' },
  { value: 4, label: 'Quarter-note grid' }, { value: 6, label: 'Quarter-note triplet grid' },
  { value: 8, label: 'Eighth-note grid' }, { value: 12, label: 'Eighth-note triplet grid' },
  { value: 16, label: 'Sixteenth-note grid' }, { value: 24, label: 'Sixteenth-note triplet grid' },
  { value: 32, label: 'Thirty-second-note grid' }, { value: 48, label: 'Thirty-second-note triplet grid' },
  { value: 64, label: 'Sixty-fourth-note grid' }, { value: 96, label: 'Hybrid 1/96 grid' },
  { value: 128, label: 'Ultra-fine 1/128 grid' }, { value: 192, label: 'Hybrid 1/192 grid' },
  { value: 256, label: 'Ultra-fine 1/256 grid' },
];
const NOTE_VALUES: NoteValueDefinition[] = [
  { value: 'whole', label: 'Whole note / semibreve', short: 'Whole', symbol: '𝅝', quarterBeats: 4, requiredGrid: 1, group: 'Straight' },
  { value: 'half', label: 'Half note / minim', short: 'Half', symbol: '𝅗𝅥', quarterBeats: 2, requiredGrid: 2, group: 'Straight' },
  { value: 'quarter', label: 'Quarter note / crotchet', short: 'Quarter', symbol: '♩', quarterBeats: 1, requiredGrid: 4, group: 'Straight' },
  { value: 'eighth', label: 'Eighth note / quaver', short: 'Eighth', symbol: '♪', quarterBeats: .5, requiredGrid: 8, group: 'Straight' },
  { value: 'sixteenth', label: 'Sixteenth note / semiquaver', short: '1/16', symbol: '𝅘𝅥𝅯', quarterBeats: .25, requiredGrid: 16, group: 'Straight' },
  { value: 'thirty-second', label: 'Thirty-second note / demisemiquaver', short: '1/32', symbol: '𝅘𝅥𝅰', quarterBeats: .125, requiredGrid: 32, group: 'Straight' },
  { value: 'sixty-fourth', label: 'Sixty-fourth note / hemidemisemiquaver', short: '1/64', symbol: '𝅘𝅥𝅱', quarterBeats: .0625, requiredGrid: 64, group: 'Straight' },
  { value: 'dotted-whole', label: 'Dotted whole / dotted semibreve', short: 'Dotted whole', symbol: '𝅝 ·', quarterBeats: 6, requiredGrid: 2, group: 'Dotted' },
  { value: 'dotted-half', label: 'Dotted half / dotted minim', short: 'Dotted half', symbol: '𝅗𝅥 ·', quarterBeats: 3, requiredGrid: 4, group: 'Dotted' },
  { value: 'dotted-quarter', label: 'Dotted quarter / dotted crotchet', short: 'Dotted quarter', symbol: '♩ ·', quarterBeats: 1.5, requiredGrid: 8, group: 'Dotted' },
  { value: 'dotted-eighth', label: 'Dotted eighth / dotted quaver', short: 'Dotted eighth', symbol: '♪ ·', quarterBeats: .75, requiredGrid: 16, group: 'Dotted' },
  { value: 'dotted-sixteenth', label: 'Dotted sixteenth / dotted semiquaver', short: 'Dotted 1/16', symbol: '𝅘𝅥𝅯 ·', quarterBeats: .375, requiredGrid: 32, group: 'Dotted' },
  { value: 'dotted-thirty-second', label: 'Dotted thirty-second / dotted demisemiquaver', short: 'Dotted 1/32', symbol: '𝅘𝅥𝅰 ·', quarterBeats: .1875, requiredGrid: 64, group: 'Dotted' },
  { value: 'dotted-sixty-fourth', label: 'Dotted sixty-fourth / dotted hemidemisemiquaver', short: 'Dotted 1/64', symbol: '𝅘𝅥𝅱 ·', quarterBeats: .09375, requiredGrid: 128, group: 'Dotted' },
  { value: 'double-dotted-whole', label: 'Double-dotted whole', short: 'Double-dotted whole', symbol: '𝅝 ··', quarterBeats: 7, requiredGrid: 4, group: 'Double-dotted' },
  { value: 'double-dotted-half', label: 'Double-dotted half', short: 'Double-dotted half', symbol: '𝅗𝅥 ··', quarterBeats: 3.5, requiredGrid: 8, group: 'Double-dotted' },
  { value: 'double-dotted-quarter', label: 'Double-dotted quarter', short: 'Double-dotted quarter', symbol: '♩ ··', quarterBeats: 1.75, requiredGrid: 16, group: 'Double-dotted' },
  { value: 'double-dotted-eighth', label: 'Double-dotted eighth', short: 'Double-dotted eighth', symbol: '♪ ··', quarterBeats: .875, requiredGrid: 32, group: 'Double-dotted' },
  { value: 'double-dotted-sixteenth', label: 'Double-dotted sixteenth', short: 'Double-dotted 1/16', symbol: '𝅘𝅥𝅯 ··', quarterBeats: .4375, requiredGrid: 64, group: 'Double-dotted' },
  { value: 'double-dotted-thirty-second', label: 'Double-dotted thirty-second', short: 'Double-dotted 1/32', symbol: '𝅘𝅥𝅰 ··', quarterBeats: .21875, requiredGrid: 128, group: 'Double-dotted' },
  { value: 'double-dotted-sixty-fourth', label: 'Double-dotted sixty-fourth', short: 'Double-dotted 1/64', symbol: '𝅘𝅥𝅱 ··', quarterBeats: .109375, requiredGrid: 256, group: 'Double-dotted' },
  { value: 'half-triplet', label: 'Half-note triplet', short: 'Half triplet', symbol: '𝅗𝅥 ₃', quarterBeats: 4 / 3, requiredGrid: 3, group: 'Tuplets' },
  { value: 'quarter-triplet', label: 'Quarter-note triplet', short: 'Quarter triplet', symbol: '♩ ₃', quarterBeats: 2 / 3, requiredGrid: 6, group: 'Tuplets' },
  { value: 'eighth-triplet', label: 'Eighth-note triplet', short: 'Eighth triplet', symbol: '♪ ₃', quarterBeats: 1 / 3, requiredGrid: 12, group: 'Tuplets' },
  { value: 'sixteenth-triplet', label: 'Sixteenth-note triplet', short: '1/16 triplet', symbol: '𝅘𝅥𝅯 ₃', quarterBeats: 1 / 6, requiredGrid: 24, group: 'Tuplets' },
  { value: 'thirty-second-triplet', label: 'Thirty-second-note triplet', short: '1/32 triplet', symbol: '𝅘𝅥𝅰 ₃', quarterBeats: 1 / 12, requiredGrid: 48, group: 'Tuplets' },
  { value: 'sixty-fourth-triplet', label: 'Sixty-fourth-note triplet', short: '1/64 triplet', symbol: '𝅘𝅥𝅱 ₃', quarterBeats: 1 / 24, requiredGrid: 96, group: 'Tuplets' },
];
const NOTE_VALUE_GROUPS: NoteValueDefinition['group'][] = ['Straight', 'Dotted', 'Double-dotted', 'Tuplets'];
function noteValue(value: RhythmicNoteValue | undefined) { return NOTE_VALUES.find(item => item.value === value) ?? NOTE_VALUES.find(item => item.value === DEFAULT_NOTE_VALUE)!; }
function compatibleGrid(current: NoteDivision, required: NoteDivision) {
  // Choosing a note value must not quietly switch snapping back on.
  if (current <= 0) return 0;
  return GRID_DIVISIONS.find(item => item.value > 0 && item.value >= current && item.value % required === 0)?.value ?? 192;
}
function rhythmicCompanionHint(value: RhythmicNoteValue) {
  const hints: Partial<Record<RhythmicNoteValue, string>> = {
    'dotted-whole': 'Leaves a half-note pulse available', 'dotted-half': 'Pairs naturally with a quarter note',
    'dotted-quarter': 'Pairs naturally with an eighth note or two sixteenths', 'dotted-eighth': 'Pairs naturally with a sixteenth note',
    'dotted-sixteenth': 'Pairs naturally with a thirty-second note', 'dotted-thirty-second': 'Pairs naturally with a sixty-fourth note',
    'dotted-sixty-fourth': 'Leaves a 1/128-note pulse available',
    'double-dotted-whole': 'Leaves a quarter-note pulse available', 'double-dotted-half': 'Leaves an eighth-note pulse available',
    'double-dotted-quarter': 'Pairs naturally with a sixteenth note', 'double-dotted-eighth': 'Pairs naturally with a thirty-second note',
    'double-dotted-sixteenth': 'Leaves a sixty-fourth-note pulse available', 'double-dotted-thirty-second': 'Leaves a 1/128-note pulse available',
    'double-dotted-sixty-fourth': 'Leaves a 1/256-note pulse available',
  };
  if (value.endsWith('-triplet')) return 'Triplet spacing remains available for the other two notes in the group';
  return hints[value] ?? 'The independent grid still permits rests, ties, syncopation and custom resized lengths';
}

function sortByTime<T extends { at: number }>(items: T[]) { return [...items].sort((a, b) => a.at - b.at); }
function normaliseMusicalTimeline(song: Song, settings: BackingTrackSettings): MusicalTimelineSettings {
  const stored = settings.musical_timeline;
  const ensureBase = <T extends { at: number }>(items: T[], fallback: T) => {
    const valid = sortByTime(items.filter(item => Number.isFinite(item.at) && item.at >= 0));
    return valid.some(item => item.at === 0) ? valid : [fallback, ...valid];
  };
  const snapValue = NOTE_VALUES.some(item => item.value === stored?.snap_value) ? stored!.snap_value! : DEFAULT_NOTE_VALUE;
  const storedGrid = GRID_DIVISIONS.some(item => item.value === stored?.snap_division) ? stored!.snap_division as NoteDivision : DEFAULT_SNAP_DIVISION;
  return {
    tempo_changes: ensureBase(stored?.tempo_changes ?? [], { at: 0, bpm: Math.max(20, Number(song.bpm) || DEFAULT_BPM) }).map(item => ({ ...item, bpm: Math.max(20, Math.min(400, Number(item.bpm) || DEFAULT_BPM)) })),
    meter_changes: ensureBase(stored?.meter_changes ?? [], { at: 0, numerator: Math.max(1, Number(song.time_sig) || DEFAULT_BEATS_PER_BAR), denominator: DEFAULT_BEAT_UNIT }).map(item => ({ ...item, numerator: Math.max(1, Math.min(32, Math.round(Number(item.numerator) || DEFAULT_BEATS_PER_BAR))), denominator: [1, 2, 4, 8, 16, 32].includes(Number(item.denominator)) ? Number(item.denominator) : DEFAULT_BEAT_UNIT })),
    key_changes: ensureBase(stored?.key_changes ?? [], { at: 0, tonic: 'C', mode: 'Major' }).map(item => ({ ...item, tonic: item.tonic || 'C', mode: item.mode || 'Major' })),
    snap_division: compatibleGrid(storedGrid, noteValue(snapValue).requiredGrid),
    snap_value: snapValue,
  };
}
function eventAt<T extends { at: number }>(items: T[], at: number) { return sortByTime(items).filter(item => item.at <= at + .001).at(-1) ?? items[0]; }
function musicalStateAt(timeline: MusicalTimelineSettings, at: number): MusicalState {
  const tempo = eventAt(timeline.tempo_changes, at);
  const meter = eventAt(timeline.meter_changes, at);
  const key = eventAt(timeline.key_changes, at);
  return { bpm: tempo?.bpm ?? DEFAULT_BPM, numerator: meter?.numerator ?? DEFAULT_BEATS_PER_BAR, denominator: meter?.denominator ?? DEFAULT_BEAT_UNIT, tonic: key?.tonic ?? 'C', mode: key?.mode ?? 'Major' };
}
function buildMusicalGrid(duration: number, timeline: MusicalTimelineSettings): MusicalBar[] {
  const changePoints = Array.from(new Set([0, duration, ...timeline.tempo_changes.map(item => item.at), ...timeline.meter_changes.map(item => item.at), ...timeline.key_changes.map(item => item.at)].filter(at => at >= 0 && at <= duration))).sort((a, b) => a - b);
  const bars: MusicalBar[] = [];
  let barNumber = 1;
  for (let segment = 0; segment < changePoints.length - 1; segment += 1) {
    const start = changePoints[segment];
    const end = changePoints[segment + 1];
    const state = musicalStateAt(timeline, start);
    const beatLength = (60 / state.bpm) * (4 / state.denominator);
    const barLength = beatLength * state.numerator;
    for (let barStart = start; barStart < end - .0001; barStart += barLength) {
      const barEnd = Math.min(end, barStart + barLength);
      const beats: MusicalBeat[] = [];
      for (let beat = 0; beat < state.numerator; beat += 1) {
        const beatStart = barStart + beat * beatLength;
        if (beatStart >= barEnd - .0001) break;
        const beatEnd = Math.min(barEnd, beatStart + beatLength);
        const subdivisions = Math.max(1, Math.round((timeline.snap_division ?? DEFAULT_SNAP_DIVISION) / state.denominator));
        beats.push({ start: beatStart, end: beatEnd, beat: beat + 1, bar: barNumber, subdivisionStarts: Array.from({ length: Math.max(0, subdivisions - 1) }, (_, part) => beatStart + ((beatEnd - beatStart) * (part + 1)) / subdivisions).filter(value => value < beatEnd - .0001) });
      }
      bars.push({ ...state, start: barStart, end: barEnd, number: barNumber, beats });
      barNumber += 1;
    }
  }
  return bars;
}
function beatPositionAt(bars: MusicalBar[], time: number): BeatPosition | null {
  const safe = Math.max(0, time);
  const bar = bars.find(item => safe >= item.start - .0001 && safe < item.end - .0001) ?? bars.at(-1);
  if (!bar) return null;
  const beat = bar.beats.find(item => safe >= item.start - .0001 && safe < item.end - .0001) ?? bar.beats.at(-1);
  if (!beat) return null;
  return { bpm: bar.bpm, numerator: bar.numerator, denominator: bar.denominator, tonic: bar.tonic, mode: bar.mode, bar: bar.number, beat: beat.beat, fraction: Math.max(0, Math.min(.999, (safe - beat.start) / Math.max(.001, beat.end - beat.start))), start: beat.start, end: beat.end };
}
function beatOffsetLabel(fraction: number) {
  if (fraction < .025) return 'ON BEAT';
  const nearestQuarter = Math.round(fraction * 4) / 4;
  if (Math.abs(fraction - nearestQuarter) < .025) return nearestQuarter === .25 ? '¼ BEAT AFTER' : nearestQuarter === .5 ? '½ BEAT AFTER' : nearestQuarter === .75 ? '¾ BEAT AFTER' : 'ON BEAT';
  return `OFF GRID +${fraction.toFixed(2)} BEAT`;
}
function compactBeatLabel(position: BeatPosition | null) {
  if (!position) return '—';
  if (position.fraction < .025) return `${position.bar}.${position.beat}`;
  const nearestQuarter = Math.round(position.fraction * 4) / 4;
  const suffix = Math.abs(position.fraction - nearestQuarter) < .025 ? ({ .25: '¼', .5: '½', .75: '¾' } as Record<number, string>)[nearestQuarter] ?? position.fraction.toFixed(2) : position.fraction.toFixed(2);
  return `${position.bar}.${position.beat}+${suffix}`;
}
function durationInBeats(bars: MusicalBar[], start: number, end: number) {
  return bars.flatMap(bar => bar.beats).reduce((total, beat) => {
    const overlap = Math.max(0, Math.min(end, beat.end) - Math.max(start, beat.start));
    return total + overlap / Math.max(.001, beat.end - beat.start);
  }, 0);
}
function snapStepAt(bars: MusicalBar[], time: number, division: NoteDivision) {
  const position = beatPositionAt(bars, time);
  if (division <= 0) return (60 / (position?.bpm ?? DEFAULT_BPM)) / 8;
  return (60 / (position?.bpm ?? DEFAULT_BPM)) * (4 / division);
}
function noteDurationAt(bars: MusicalBar[], time: number, value: RhythmicNoteValue) {
  const position = beatPositionAt(bars, time);
  return (60 / (position?.bpm ?? DEFAULT_BPM)) * noteValue(value).quarterBeats;
}
function closestNoteValue(bars: MusicalBar[], start: number, end: number) {
  const duration = Math.max(.001, end - start);
  return NOTE_VALUES.reduce((closest, item) => {
    const error = Math.abs(noteDurationAt(bars, start, item.value) - duration);
    return error < closest.error ? { item, error } : closest;
  }, { item: noteValue(DEFAULT_NOTE_VALUE), error: Number.POSITIVE_INFINITY });
}
function snapTimeToGrid(bars: MusicalBar[], time: number, division: NoteDivision, mode: 'round' | 'ceil' | 'floor' = 'round') {
  const safe = Math.max(0, time);
  // Free placement: the note belongs where the ear put it.
  if (division <= 0) return roundPrecise(safe);
  const position = beatPositionAt(bars, safe);
  const bar = position ? bars.find(item => item.number === position.bar) : bars[0];
  const origin = bar?.start ?? 0;
  const step = snapStepAt(bars, safe, division);
  const units = (safe - origin) / Math.max(.001, step);
  const snappedUnits = mode === 'ceil' ? Math.ceil(units - .0001) : mode === 'floor' ? Math.floor(units + .0001) : Math.round(units);
  return roundPrecise(Math.max(0, origin + snappedUnits * step));
}
function quantizeNote(note: SongNote, bars: MusicalBar[], division: NoteDivision) {
  const start = snapTimeToGrid(bars, note.start, division);
  const step = snapStepAt(bars, start, division);
  const units = Math.max(1, Math.round((note.end - note.start) / Math.max(.001, step)));
  // The end lands ON the grid, like the start: a millisecond-rounded start
  // plus an exact duration could end a millisecond past the next note's
  // snapped start, and the overlap resolver read that rounding noise as a
  // real clash — pushing every later note in the voice one grid step along.
  return remapNoteExpression(note, start, snapTimeToGrid(bars, start + units * step, division));
}
function latchNoteToValue(note: SongNote, bars: MusicalBar[], division: NoteDivision, value: RhythmicNoteValue) {
  const start = snapTimeToGrid(bars, note.start, division);
  return remapNoteExpression(note, start, roundPrecise(start + noteDurationAt(bars, start, value)));
}
function remapNoteExpression(note: SongNote, start: number, end: number) {
  if (!note.expression?.contour.length) return { ...note, start, end };
  const originalDuration = Math.max(.001, note.end - note.start);
  const nextDuration = Math.max(.001, end - start);
  const scale = nextDuration / originalDuration;
  return {
    ...note,
    start,
    end,
    expression: {
      ...note.expression,
      contour: note.expression.contour.map(point => ({ ...point, offset: roundPrecise(Math.min(nextDuration, Math.max(0, point.offset * scale))) })),
    },
  };
}
function notesOverlap(a: SongNote, b: SongNote) { return a.part === b.part && a.start < b.end - .0005 && a.end > b.start + .0005; }
/**
 * Would placing these notes here overlap something else in the same voice?
 *
 * Only pairs involving a candidate count. This used to sort the whole voice
 * and look for any adjacent overlap at all, so a single pre-existing overlap —
 * a chord imported into one line, which the importer now keeps rather than
 * silently discarding — reported a collision for every move, duplicate and
 * paste in that voice from then on, however far away from it.
 */
function collisionInVoice(candidates: SongNote[], fixed: SongNote[]) {
  return candidates.some((candidate, index) =>
    fixed.some(note => note.id !== candidate.id && notesOverlap(note, candidate))
    || candidates.some((other, otherIndex) => otherIndex !== index && notesOverlap(other, candidate)));
}
function quantizeAndResolveNotes(input: SongNote[], bars: MusicalBar[], division: NoteDivision) {
  const quantized = input.map(note => quantizeNote(note, bars, division));
  const adjusted = new Map<string, SongNote>();
  const parts = Array.from(new Set(quantized.map(note => note.part)));
  parts.forEach(part => {
    let voiceEnd = 0;
    quantized.filter(note => note.part === part).sort((a, b) => a.start - b.start || a.end - b.end).forEach(note => {
      const duration = Math.max(snapStepAt(bars, note.start, division), note.end - note.start);
      const start = note.start < voiceEnd - .0005 ? snapTimeToGrid(bars, voiceEnd, division, 'ceil') : note.start;
      const next = { ...note, start, end: snapTimeToGrid(bars, start + duration, division) };
      adjusted.set(note.id, next);
      voiceEnd = next.end;
    });
  });
  return input.map(note => adjusted.get(note.id) ?? note);
}

function phraseText(events: Array<{ lyric: string }>) {
  let text = '';
  let joinNext = false;
  events.forEach(event => {
    const raw = event.lyric.trim();
    const joinsPrevious = joinNext || /^[-–—]/.test(raw);
    if (text && !joinsPrevious) text += ' ';
    text += raw.replace(/^[-–—]+|[-–—]+$/g, '');
    joinNext = /[-–—]$/.test(raw);
  });
  return text.trim();
}

function timedLyricsFromNotes(notes: SongNote[], targetsPerPhrase: number): TimedLyricSection[] {
  const events: Array<{ lyric: string; start: number; end: number }> = [];
  [...notes].filter(note => note.lyric.trim()).sort((a, b) => a.start - b.start || a.part - b.part).forEach(note => {
    const existing = events.find(event => Math.abs(event.start - note.start) <= .07);
    if (existing) {
      existing.end = Math.max(existing.end, note.end);
      if (note.lyric.trim().length > existing.lyric.length) existing.lyric = note.lyric.trim();
    } else events.push({ lyric: note.lyric.trim(), start: note.start, end: note.end });
  });
  const result: TimedLyricSection[] = [];
  let phrase: typeof events = [];
  const flush = () => {
    if (!phrase.length) return;
    result.push({ primary: phraseText(phrase), translation: '', start: phrase[0].start, end: phrase[phrase.length - 1].end });
    phrase = [];
  };
  events.forEach(event => {
    const previous = phrase.at(-1);
    if (previous && (event.start - previous.end > 1.15 || /[.!?;:]$/.test(previous.lyric) || (phrase.length >= targetsPerPhrase && !/[-–—]$/.test(previous.lyric)))) flush();
    phrase.push(event);
  });
  flush();
  return result;
}
function latchAndResolveNotes(input: SongNote[], bars: MusicalBar[], division: NoteDivision, value: RhythmicNoteValue) {
  const latched = input.map(note => latchNoteToValue(note, bars, division, value));
  const adjusted = new Map<string, SongNote>();
  Array.from(new Set(latched.map(note => note.part))).forEach(part => {
    let voiceEnd = 0;
    latched.filter(note => note.part === part).sort((a, b) => a.start - b.start || a.end - b.end).forEach(note => {
      const duration = note.end - note.start;
      const start = note.start < voiceEnd - .0005 ? snapTimeToGrid(bars, voiceEnd, division, 'ceil') : note.start;
      const next = { ...note, start, end: roundPrecise(start + duration) };
      adjusted.set(note.id, next);
      voiceEnd = next.end;
    });
  });
  return input.map(note => adjusted.get(note.id) ?? note);
}
export function ArrangementEditor({ song, onClose, onSave, onSongCreated }: { song: Song; onClose: () => void; onSave: (values: EditableSong) => Promise<void>; onSongCreated?: () => void; }) {
  const [title, setTitle] = useState(song.title);
  const [notes, setNotes] = useState<SongNote[]>(() => playableNotes(song));
  const [timedLyrics, setTimedLyrics] = useState<TimedLyricSection[]>(() => (song.timed_lyrics ?? []).map(section => ({ ...section })));
  const [selectedId, setSelectedId] = useState<string | null>(() => playableNotes(song)[0]?.id ?? null);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => playableNotes(song)[0]?.id ? [playableNotes(song)[0].id] : []);
  const [noteClipboard, setNoteClipboard] = useState<SongNote[]>([]);
  const [selectedPart, setSelectedPart] = useState(0);
  // A 36px/second starting scale keeps individual lyric targets readable; 160px/second
  // gives arrangers up to ten times the former default width for detailed editing.
  const [zoom, setZoom] = useState(36);
  const [saving, setSaving] = useState(false);
  const [tool, setTool] = useState<EditorTool>('select');
  const [playScope, setPlayScope] = useState<PlaybackScope>('all');
  const [playParts, setPlayParts] = useState([true, true, true, true]);
  const [playRange, setPlayRange] = useState({ start: 0, end: 8 });
  const [rangeParts, setRangeParts] = useState<{ start: number; end: number } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(0);
  const [collapsedVoices, setCollapsedVoices] = useState([false, false, false, false]);
  const [recording, setRecording] = useState(false);
  const [uploadingTake, setUploadingTake] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingTake, setRecordingTake] = useState<Blob | null>(null);
  const [transcribingTake, setTranscribingTake] = useState(false);
  const [recordingPart, setRecordingPart] = useState(0);
  const [transcriptionSnap, setTranscriptionSnap] = useState(false);
  const [transcriptionDiagnostics, setTranscriptionDiagnostics] = useState<AudioNoteDetectionDiagnostics | null>(null);
  const [recordingTimelineOffset, setRecordingTimelineOffset] = useState(0);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [editorNotice, setEditorNotice] = useState<string | null>(null);
  const [savingRendition, setSavingRendition] = useState(false);
  const [renditionCards, setRenditionCards] = useState<RenditionCard[]>([]);
  // A musician reads staves; the grid is for surgery; the rendition stage
  // shapes the performance — three views of one editor, Score the default.
  const [noteView, setNoteView] = useState<'score' | 'grid' | 'rendition'>('score');
  // MuseScore-style step entry: pick a value, type pitches, the caret walks
  // the bar. The caret normally derives from the selection (the end of the
  // selected note, else the end of the voice); a rest overrides it forward.
  const [stepInput, setStepInput] = useState(false);
  const [stepCaret, setStepCaret] = useState<number | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // The preview SINGS by default; the piano remains one tap away.
  const [previewVoice, setPreviewVoice] = useState<'choir' | 'singer' | 'piano'>('choir');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('vh_preview_voice');
      if (saved === 'choir' || saved === 'singer' || saved === 'piano') setPreviewVoice(saved);
    } catch { /* storage unavailable */ }
  }, []);
  function cyclePreviewVoice() {
    setPreviewVoice(current => {
      const next = current === 'choir' ? 'singer' : current === 'singer' ? 'piano' : 'choir';
      try { window.localStorage.setItem('vh_preview_voice', next); } catch { /* fine */ }
      return next;
    });
  }
  const previewVoices = previewVoice !== 'piano';
  const [closePrompt, setClosePrompt] = useState(false);
  // The rendition always compiles from the SOURCE arrangement, never from its
  // own output — otherwise hear-and-return would stack passes of passes. The
  // source tracks the editor's notes until the first apply, so a note fixed
  // before building a rendition is included; after an apply it stays frozen
  // on the pre-apply arrangement.
  const renditionSourceRef = useRef<{ notes: SongNote[]; lyrics: TimedLyricSection[] } | null>(null);
  const renditionAppliedRef = useRef(false);
  // Unsaved work exists from the first edit until a save SUCCEEDS. The two
  // silent ways to lose an arrangement were a failed save whose error
  // rendered behind this overlay, and a close that never asked.
  const dirtyRef = useRef(false);
  const [midiPreview, setMidiPreview] = useState<MidiPreview | null>(null);
  const [midiError, setMidiError] = useState<string | null>(null);
  const [midiRanges, setMidiRanges] = useState<SatbMidiRanges>(DEFAULT_SATB_MIDI_RANGES);
  const [midiSourceParts, setMidiSourceParts] = useState<Record<string, number>>({});
  const [midiPart, setMidiPart] = useState<number | null>(null);
  const [midiMode, setMidiMode] = useState<'replace' | 'append'>('replace');
  const [xmlPreview, setXmlPreview] = useState<{ fileName: string; result: MusicXmlImport } | null>(null);
  const [xmlMapping, setXmlMapping] = useState<Record<string, number>>({});
  const [xmlMode, setXmlMode] = useState<'replace' | 'append'>('replace');
  const [mediaUrl, setMediaUrl] = useState(song.backing_media_url ?? song.audio_url ?? '');
  const [mediaKind, setMediaKind] = useState<'audio' | 'video'>(song.backing_media_kind ?? 'audio');
  const [mediaName, setMediaName] = useState('');
  const [showBackingEditor, setShowBackingEditor] = useState(false);
  const [showLyricLine, setShowLyricLine] = useState(false);
  const [showHarmony, setShowHarmony] = useState(false);
  const [trackSettings, setTrackSettings] = useState<BackingTrackSettings>({ ...DEFAULT_TRACK_SETTINGS, ...(song.backing_track_settings ?? {}) });
  const accompaniment = trackSettings.accompaniment ?? { guitar: 'off', drums: 'off' };
  const [musicalTimeline, setMusicalTimeline] = useState<MusicalTimelineSettings>(() => normaliseMusicalTimeline(song, { ...DEFAULT_TRACK_SETTINGS, ...(song.backing_track_settings ?? {}) }));
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ past: ArrangementSnapshot[]; future: ArrangementSnapshot[] }>({ past: [], future: [] });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [timelineFocus, setTimelineFocus] = useState(false);
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const noteAuditionContextRef = useRef<AudioContext | null>(null);
  const noteAuditionStopRef = useRef<(() => void) | null>(null);
  const noteAuditionGenerationRef = useRef(0);
  const transportRunningRef = useRef(false);
  const playheadRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const playbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backingStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backingPlayGenerationRef = useRef(0);
  const backingMediaRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const lassoRef = useRef<{ originX: number; originY: number; additive: boolean; baseIds: string[]; moved: boolean } | null>(null);
  const suppressLaneClickRef = useRef(false);
  const [lassoBox, setLassoBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const noteMoveRef = useRef<{ originX: number; originY: number; ids: string[]; initial: Record<string, { midi: number; start: number; end: number }>; targetId: string; deltaMidi: number; deltaTime: number; moved: boolean; historyPushed: boolean; selectionApplied: boolean } | null>(null);
  const midiInputRef = useRef<HTMLInputElement | null>(null);
  const xmlInputRef = useRef<HTMLInputElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const musicalLatchSignatureRef = useRef('');
  const selected = notes.find(note => note.id === selectedId) ?? null;
  const backingTimelineEnd = trackSettings.clips?.length ? Math.max(...trackSettings.clips.map(clip => clip.timeline_start + (clip.source_end - clip.source_start))) : trackSettings.timeline_offset + Math.max(0, (trackSettings.trim_end ?? trackSettings.media_duration ?? 0) - trackSettings.trim_start);
  const transportEnd = Math.max(.1, song.duration || 0, backingTimelineEnd, ...notes.map(note => note.end));
  const duration = Math.max(32, transportEnd + 4);
  const timelineWidth = Math.min(Math.max(duration * zoom, 1600), 48000);
  const musicalBars = useMemo(() => buildMusicalGrid(duration, musicalTimeline), [duration, musicalTimeline]);
  const cursorMusicalState = musicalStateAt(musicalTimeline, playhead ?? 0);
  const scoreBars: ScoreBar[] = useMemo(() => musicalBars.map(bar => ({ start: bar.start, end: bar.end, beatCount: Math.max(1, bar.beats.length), numerator: bar.numerator, denominator: bar.denominator, number: bar.number })), [musicalBars]);
  // What the band will ACTUALLY play, in written time — the score's band
  // lane prints these events so every strum, arpeggio note, bass step and
  // drum hit is visible under the singing it accompanies.
  const laneBandEvents = useMemo(() => {
    const lastSound = notes.reduce((latest, note) => Math.max(latest, note.end), 0);
    if (!lastSound) return undefined;
    const anyClips = (trackSettings.band_tracks ?? []).some(track => !track.muted && track.clips.length > 0);
    if (accompaniment.guitar === 'off' && accompaniment.drums === 'off' && !notes.some(note => note.marks?.band) && !anyClips) return undefined;
    const bandBars = musicalBars.map(bar => ({ start: bar.start, end: bar.end, beatCount: Math.max(1, bar.beats.length) }));
    return buildBandEvents({
      bars: bandBars, chords: trackSettings.chord_symbols ?? [], notes,
      defaults: { instrument: accompaniment.guitar as InstrumentStyleId, drums: accompaniment.drums as DrumStyleId },
      until: lastSound + 0.05,
      customTabs: { instrument: accompaniment.instrument_tab, drums: accompaniment.drum_tab },
      tracks: trackSettings.band_tracks,
      humanize: false, countIn: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, musicalBars, trackSettings.chord_symbols, trackSettings.band_tracks, accompaniment.guitar, accompaniment.drums, accompaniment.instrument_tab, accompaniment.drum_tab]);
  // Rendition: compiled from the SOURCE arrangement, never from its own
  // output — the source tracks the live notes until a compiled rendition is
  // loaded into the editor, then freezes on the pre-load arrangement.
  if (!renditionAppliedRef.current || !renditionSourceRef.current) renditionSourceRef.current = { notes, lyrics: timedLyrics };
  const renditionSource = renditionSourceRef.current;
  const renditionSections = useMemo(() => deriveSections(renditionSource.notes, renditionSource.lyrics), [renditionSource.notes, renditionSource.lyrics]);
  const baseMusicalState = musicalStateAt(musicalTimeline, 0);
  const compiledRendition = useMemo(() => compileRendition(renditionSource.notes, renditionSource.lyrics, renditionSections, renditionCards, { bpm: baseMusicalState.bpm, beatsPerBar: baseMusicalState.numerator }),
    [renditionSource.notes, renditionSource.lyrics, renditionSections, renditionCards, baseMusicalState.bpm, baseMusicalState.numerator]);
  // The compiled score is spelled in the SOURCE key: a lifted final pass then
  // shows its honest accidentals instead of dragging the whole page into a
  // compromise signature.
  const renditionSignature = useMemo(() => inferKeySignature(renditionSource.notes.map(note => note.midi)), [renditionSource.notes]);
  // What the transport performs depends on the view: the rendition stage
  // plays its compilation, Score and Grid play the arrangement itself.
  const activePerformance = noteView === 'rendition'
    ? { notes: compiledRendition.notes, end: Math.max(.1, compiledRendition.duration) }
    : { notes, end: transportEnd };
  const noteByPart = useMemo(() => VOICES.map((_, index) => notes.filter(note => note.part === index || (note.part === -1 && index === selectedPart))), [notes, selectedPart]);
  const entryStart = useMemo(() => {
    if (stepCaret !== null) return stepCaret;
    const division = musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION;
    const inVoice = (note: SongNote) => note.part === selectedPart || note.part === -1;
    const musicalEnd = (note: SongNote) => {
      const state = musicalStateAt(musicalTimeline, note.start);
      const quarter = 60 / state.bpm;
      // The caret sits where the note musically finishes: a stored whole note
      // lives ~3.84 beats but OWNS four, and entry continues after the fourth.
      return note.start + snapBeats((note.end - note.start) / quarter) * quarter;
    };
    const selectedNote = notes.find(note => note.id === selectedId);
    const base = selectedNote && inVoice(selectedNote)
      ? musicalEnd(selectedNote)
      : notes.some(inVoice) ? Math.max(...notes.filter(inVoice).map(musicalEnd)) : (playheadRef.current ?? 0);
    return snapTimeToGrid(musicalBars, base, division, 'round');
  }, [stepCaret, notes, selectedId, selectedPart, musicalBars, musicalTimeline.snap_division]);  // deliberately not `playhead`: entry does not follow playback
  const entryBar = useMemo(() => musicalBars.find(bar => entryStart >= bar.start - .001 && entryStart < bar.end - .001) ?? null, [musicalBars, entryStart]);
  // Remaining room in the caret's bar, in quarter-note beats — the number
  // every value button is annotated against.
  const remainingQuarters = entryBar ? Math.max(0, (entryBar.end - entryStart) / (60 / entryBar.bpm)) : 0;
  const keySignature = useMemo(() => inferKeySignature(notes.map(note => note.midi)), [notes]);
  // The engraver's grouping rule as an entry assistant: a dotted quaver
  // placed on the beat leaves a semiquaver of that beat unspent, and the
  // natural next note IS that semiquaver — so when the sticky value would
  // cross the beat boundary from mid-beat, the entry value auto-switches to
  // the exact completion. On the boundary, the sticky value rules again,
  // which is what makes 'dotted-quaver, semiquaver, dotted-quaver…' typing
  // flow with no palette visits at all.
  const beatCompletion = useMemo(() => {
    if (!entryBar) return null;
    const quarter = 60 / entryBar.bpm;
    const beatLen = quarter * (4 / entryBar.denominator);
    const intoBeat = ((entryStart - entryBar.start) % beatLen + beatLen) % beatLen;
    const eps = 0.02 * beatLen;
    if (intoBeat < eps || beatLen - intoBeat < eps) return null;      // on the boundary
    const remainingQ = (beatLen - intoBeat) / quarter;
    const sticky = NOTE_VALUES.find(item => item.value === (musicalTimeline.snap_value ?? DEFAULT_NOTE_VALUE));
    if (!sticky || sticky.quarterBeats <= remainingQ + 0.01) return null;  // sticky fits the beat
    const completion = NOTE_VALUES.find(item =>
      (item.group === 'Straight' || item.group === 'Dotted') && Math.abs(item.quarterBeats - remainingQ) < 0.02);
    return completion ?? null;
  }, [entryBar, entryStart, musicalTimeline.snap_value]);
  const entryValue: RhythmicNoteValue = beatCompletion?.value ?? musicalTimeline.snap_value ?? DEFAULT_NOTE_VALUE;
  const selectedNotes = useMemo(() => notes.filter(note => selectedIds.includes(note.id)).sort((a, b) => a.start - b.start || a.part - b.part), [notes, selectedIds]);

  useEffect(() => {
    if (!musicalBars.length) return;
    const signature = JSON.stringify([musicalTimeline.tempo_changes, musicalTimeline.meter_changes, musicalTimeline.snap_division]);
    if (musicalLatchSignatureRef.current === signature) return;
    musicalLatchSignatureRef.current = signature;
    const division = musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION;
    setNotes(current => {
      const latched = quantizeAndResolveNotes(current, musicalBars, division);
      // Announce only MUSICAL movement. Stored times are rounded to
      // milliseconds, so half-millisecond drift is constant background noise
      // -- and the old half-millisecond threshold made this banner fire on
      // songs whose notes had not meaningfully moved at all.
      const changed = latched.some((note, index) => Math.abs(note.start - current[index].start) > .01 || Math.abs(note.end - current[index].end) > .01);
      if (changed) setEditorNotice(`Arrangement aligned to the ${GRID_DIVISIONS.find(item => item.value === division)?.label ?? `1/${division} grid`}; same-voice clashes were moved to the next available position.`);
      return latched;
    });
  }, [musicalBars, musicalTimeline.snap_division]);

  useEffect(() => () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current);
    if (backingStartTimerRef.current) clearTimeout(backingStartTimerRef.current);
    backingMediaRef.current?.pause();
    recorderRef.current?.stream.getTracks().forEach(track => track.stop());
    void audioContextRef.current?.close();
    noteAuditionGenerationRef.current += 1;
    noteAuditionStopRef.current?.();
    void noteAuditionContextRef.current?.close();
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => {
      const active = document.fullscreenElement === editorRootRef.current;
      setIsFullscreen(active);
      if (!active) setTimelineFocus(false);
    };
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  async function toggleFullscreen() {
    const root = editorRootRef.current;
    if (!root) return;
    if (document.fullscreenElement === root) await document.exitFullscreen();
    else await root.requestFullscreen();
  }

  async function closeOrExitFullscreen() {
    if (timelineFocus) {
      setTimelineFocus(false);
      if (document.fullscreenElement) await document.exitFullscreen();
      return;
    }
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    // The browser's own confirm() box looked like a foreign object over the
    // editor — this is the same question asked in the editor's own voice,
    // with the answer people actually want ("Save and close") added.
    if (dirtyRef.current) { setClosePrompt(true); return; }
    onClose();
  }

  async function enterTimelineFocus() {
    setTimelineFocus(true);
    const root = editorRootRef.current;
    if (root && document.fullscreenElement !== root) await root.requestFullscreen();
  }

  async function exitTimelineFocus() {
    setTimelineFocus(false);
    if (document.fullscreenElement) await document.exitFullscreen();
  }

  const freeGrid = (musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION) <= 0;

  function focusVoice(part: number) {
    setSelectedPart(part);
    setCollapsedVoices(current => current.map((value, index) => index === part ? false : value));
    requestAnimationFrame(() => document.getElementById(`vh-voice-${part}`)?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' }));
  }

  function upsertMusicalEvent(kind: 'tempo' | 'meter' | 'key', values: Partial<MusicalState>, at = playhead ?? 0) {
    const eventTime = roundPrecise(Math.max(0, at));
    pushHistory();
    setMusicalTimeline(current => {
      if (kind === 'tempo') {
        const next = { at: eventTime, bpm: Math.max(20, Math.min(400, Number(values.bpm) || DEFAULT_BPM)) };
        return { ...current, tempo_changes: sortByTime([...current.tempo_changes.filter(item => Math.abs(item.at - eventTime) > .001), next]) };
      }
      if (kind === 'meter') {
        const next = { at: eventTime, numerator: Math.max(1, Math.min(32, Math.round(Number(values.numerator) || DEFAULT_BEATS_PER_BAR))), denominator: [1, 2, 4, 8, 16, 32].includes(Number(values.denominator)) ? Number(values.denominator) : DEFAULT_BEAT_UNIT };
        return { ...current, meter_changes: sortByTime([...current.meter_changes.filter(item => Math.abs(item.at - eventTime) > .001), next]) };
      }
      const next = { at: eventTime, tonic: values.tonic || 'C', mode: values.mode || 'Major' };
      return { ...current, key_changes: sortByTime([...current.key_changes.filter(item => Math.abs(item.at - eventTime) > .001), next]) };
    });
  }

  function changeSnapDivision(division: NoteDivision) {
    pushHistory();
    const latched = quantizeAndResolveNotes(notes, musicalBars, division);
    setMusicalTimeline(current => ({ ...current, snap_division: division }));
    setNotes(latched);
    setEditorNotice(`All notes aligned to the ${GRID_DIVISIONS.find(item => item.value === division)?.label ?? `1/${division} grid`}. Same-voice overlaps were moved forward automatically.`);
  }

  function changeNoteValue(value: RhythmicNoteValue) {
    pushHistory();
    const definition = noteValue(value);
    const division = compatibleGrid(musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION, definition.requiredGrid);
    setMusicalTimeline(current => ({ ...current, snap_value: value, snap_division: division }));
    // With notes selected — and step entry off, where numbers set the NEXT
    // entry as in MuseScore — the value buttons EDIT: the selected notes take
    // the value, consuming following material the way lengthening does on
    // paper. A crotchet turned minim eats the crotchet after it; a minim
    // turned crotchet leaves its second half as rest.
    if (!stepInput && selectedIds.length) {
      // Lengthening never eats what follows any more: the rest of the bar
      // slides right, and overflow ties into a freshly inserted bar.
      // Shortening leaves its remainder as rest.
      const shifts: Array<{ from: number; by: number }> = [];
      setNotes(current => {
        let next = current;
        const ordered = [...selectedIds].map(id => next.find(note => note.id === id)).filter((note): note is SongNote => Boolean(note)).sort((a, b) => a.start - b.start).map(note => note.id);
        for (const id of ordered) {
          const target = next.find(note => note.id === id);
          if (!target) continue;
          const end = snapTimeToGrid(musicalBars, target.start + noteDurationAt(musicalBars, target.start, value), division);
          if (end <= target.start + .01) continue;
          const flowed = placeWithFlow(next, { ...target, end });
          next = flowed.notes;
          if (flowed.shiftBy > 0) shifts.push({ from: flowed.shiftFrom, by: flowed.shiftBy });
        }
        return next;
      });
      for (const shift of shifts) shiftLyricsLater(shift.from, shift.by);
      setEditorNotice(`${definition.symbol} ${definition.label} — selected note${selectedIds.length === 1 ? '' : 's'} re-valued; new entries use this length too.`);
      return;
    }
    setEditorNotice(`${definition.symbol} ${definition.label} selected. New notes use this length; the placement grid remains fine enough for the shorter notes that may follow it.`);
  }

  function latchAllToNoteValue() {
    const value = musicalTimeline.snap_value ?? DEFAULT_NOTE_VALUE;
    const definition = noteValue(value);
    const division = compatibleGrid(musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION, definition.requiredGrid);
    pushHistory();
    setMusicalTimeline(current => ({ ...current, snap_value: value, snap_division: division }));
    setNotes(latchAndResolveNotes(notes, musicalBars, division, value));
    setEditorNotice(`Every note now uses ${definition.symbol} ${definition.label}. Same-voice overlaps were moved forward automatically.`);
  }

  function alignHarmonyToMelody() {
    if (!notes.some(note => note.part === 0 || note.part === -1)) { setEditorNotice('There is no melody line to align to yet — the Soprano voice is empty.'); return; }
    const scope = selectedIds.length ? new Set(selectedIds) : null;
    const eligible = notes.filter(note => note.part > 0 && (!scope || scope.has(note.id)));
    if (!eligible.length) { setEditorNotice(scope ? 'The selection has no harmony notes. Select Alto, Tenor or Bass notes — or clear the selection to align every harmony voice.' : 'Nothing to align yet — Alto, Tenor and Bass have no notes.'); return; }
    pushHistory();
    const result = alignToMelodyRhythm(notes, scope);
    setNotes(result.notes);
    setEditorNotice(result.aligned
      ? `${result.aligned} harmony note${result.aligned === 1 ? '' : 's'} snapped onto the melody's rhythm${scope ? ' (selection only)' : ''}. Undo brings the old timing back.`
      : "Everything already sits on the melody's rhythm — nothing moved.");
  }

  function removeMusicalEvent(kind: 'tempo' | 'meter' | 'key', at: number) {
    if (at === 0) return;
    pushHistory();
    setMusicalTimeline(current => kind === 'tempo' ? { ...current, tempo_changes: current.tempo_changes.filter(item => item.at !== at) } : kind === 'meter' ? { ...current, meter_changes: current.meter_changes.filter(item => item.at !== at) } : { ...current, key_changes: current.key_changes.filter(item => item.at !== at) });
  }

  useEffect(() => {
    const media = backingMediaRef.current;
    if (!transportRunningRef.current || !isPlaying || playhead === null || !mediaUrl || !media) return;
    const expected = sourceTimeAt(playhead);
    if (expected === null) { if (!media.paused) media.pause(); return; }
    if (Math.abs(media.currentTime - expected) > .3) media.currentTime = expected;
    media.volume = Math.max(0, Math.min(1, trackSettings.volume));
    media.playbackRate = Math.max(.5, Math.min(1.5, trackSettings.speed));
    if (media.paused) void media.play().catch(() => undefined);
  }, [isPlaying, mediaUrl, playhead, trackSettings.clips, trackSettings.media_duration, trackSettings.speed, trackSettings.trim_end, trackSettings.trim_start, trackSettings.timeline_offset, trackSettings.skip_regions, trackSettings.volume]);

  // Lay a typed line across notes. The selection wins when there is one, so a
  // single phrase can be re-worded without touching the rest of the song;
  // otherwise it falls to the whole of the chosen voice.
  function lyricTargets() {
    const chosen = notes.filter(note => selectedIds.includes(note.id));
    if (chosen.length) return chosen;
    return notes.filter(note => note.part === selectedPart || note.part === -1);
  }

  function applyLyricLine(line: string) {
    const targets = lyricTargets();
    if (!targets.length) { setEditorNotice('No notes to put words on. Select some, or draw the line first.'); return; }
    const result = spreadLyricsAcrossNotes(line, targets);
    pushHistory();
    setNotes(current => current.map(note => note.id in result.assignments ? { ...note, lyric: result.assignments[note.id] } : note));
    setShowLyricLine(false);
    setEditorNotice(result.leftover.length
      ? `${result.syllables} syllables for ${result.notes} notes — "${result.leftover.join(' ')}" had nowhere to go.`
      : result.cleared
        ? `Placed ${result.syllables} syllables; ${result.cleared} later note${result.cleared === 1 ? '' : 's'} left empty.`
        : `Placed ${result.syllables} syllables across ${result.notes} notes.`);
  }

  function applyHarmony(fromPart: number, toPart: number, semitones: number) {
    const chosen = notes.filter(note => selectedIds.includes(note.id) && note.part === fromPart);
    const source = chosen.length ? chosen : notes.filter(note => note.part === fromPart);
    if (!source.length) { setEditorNotice(`${VOICES[fromPart]} has no notes to copy.`); return; }
    const target = notes.filter(note => note.part === toPart);
    const result = harmoniseInto(source, target, toPart, semitones, () => `note-${crypto.randomUUID()}`);
    pushHistory();
    setNotes(current => [...current.filter(note => note.part !== toPart), ...result.notes].sort((a, b) => a.start - b.start));
    setShowHarmony(false);
    setEditorNotice(`Copied ${result.copied} note${result.copied === 1 ? '' : 's'} into ${VOICES[toPart]}${result.replaced ? `, replacing ${result.replaced}` : ''}. Chromatic copy — check it against the key by ear.`);
  }

  function makeSnapshot(): ArrangementSnapshot { return { title, notes: notes.map(note => ({ ...note })), timedLyrics: timedLyrics.map(section => ({ ...section })), chordSymbols: (trackSettings.chord_symbols ?? []).map(chord => ({ ...chord })), karaokeLyrics: trackSettings.karaoke_lyrics ? { ...trackSettings.karaoke_lyrics } : undefined, musicalTimeline: { tempo_changes: musicalTimeline.tempo_changes.map(item => ({ ...item })), meter_changes: musicalTimeline.meter_changes.map(item => ({ ...item })), key_changes: musicalTimeline.key_changes.map(item => ({ ...item })), snap_division: musicalTimeline.snap_division, snap_value: musicalTimeline.snap_value }, selectedId, selectedIds: [...selectedIds], selectedPart, playScope, playParts: [...playParts], playRange: { ...playRange } }; }
  function pushHistory() { dirtyRef.current = true; const snapshot = makeSnapshot(); setHistory(current => ({ past: [...current.past, snapshot].slice(-100), future: [] })); }
  function restoreSnapshot(snapshot: ArrangementSnapshot) { setTitle(snapshot.title); setNotes(snapshot.notes.map(note => ({ ...note }))); setTimedLyrics(snapshot.timedLyrics.map(section => ({ ...section }))); setTrackSettings(current => ({ ...current, chord_symbols: snapshot.chordSymbols.map(chord => ({ ...chord })), karaoke_lyrics: snapshot.karaokeLyrics ? { ...snapshot.karaokeLyrics } : undefined })); setMusicalTimeline({ tempo_changes: snapshot.musicalTimeline.tempo_changes.map(item => ({ ...item })), meter_changes: snapshot.musicalTimeline.meter_changes.map(item => ({ ...item })), key_changes: snapshot.musicalTimeline.key_changes.map(item => ({ ...item })), snap_division: snapshot.musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION, snap_value: snapshot.musicalTimeline.snap_value ?? DEFAULT_NOTE_VALUE }); setSelectedId(snapshot.selectedId); setSelectedIds([...snapshot.selectedIds]); setSelectedPart(snapshot.selectedPart); setPlayScope(snapshot.playScope); setPlayParts([...snapshot.playParts]); setPlayRange({ ...snapshot.playRange }); }
  function undo() { const previous = history.past.at(-1); if (!previous) return; dirtyRef.current = true; const current = makeSnapshot(); restoreSnapshot(previous); setHistory({ past: history.past.slice(0, -1), future: [current, ...history.future] }); }
  function redo() { const next = history.future[0]; if (!next) return; dirtyRef.current = true; const current = makeSnapshot(); restoreSnapshot(next); setHistory({ past: [...history.past, current].slice(-100), future: history.future.slice(1) }); }
  function update(id: string, values: Partial<SongNote>, quiet = false) {
    const target = notes.find(note => note.id === id);
    if (!target) return;
    const division = musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION;
    const timingChanged = values.start !== undefined || values.end !== undefined || values.part !== undefined;
    const candidate = timingChanged ? quantizeNote({ ...target, ...values }, musicalBars, division) : { ...target, ...values };
    pushHistory();
    // Dropping a note onto exactly ONE other note swaps their places — each
    // takes the other's start and keeps its own length, pitch and word.
    // Anything else that is moved or resized onto occupied time takes that
    // time, and the space it leaves behind becomes rest. (Refusing with a
    // notice made every drag in a full bar a dead end.)
    if (timingChanged && values.start !== undefined) {
      const overlapped = notes.filter(note => note.id !== id && note.part === candidate.part
        && note.start < candidate.end - .0005 && note.end > candidate.start + .0005);
      if (overlapped.length === 1) {
        const partner = overlapped[0];
        const moved = { ...candidate, start: partner.start, end: roundPrecise(partner.start + (target.end - target.start)) };
        const slid = { ...partner, start: target.start, end: roundPrecise(target.start + (partner.end - partner.start)) };
        if (!collisionInVoice([moved, slid], notes.filter(note => note.id !== id && note.id !== partner.id))) {
          setNotes(current => current.map(note => note.id === id ? moved : note.id === partner.id ? slid : note));
          setEditorNotice(null);
          return;
        }
      }
    }
    setNotes(current => timingChanged
      ? carveSpace(current, candidate.part, candidate.start, candidate.end, id).map(note => note.id === id ? candidate : note)
      : current.map(note => note.id === id ? candidate : note));
    if (values.lyric !== undefined) {
      setTrackSettings(current => ({ ...current, karaoke_lyrics: { targets_per_phrase: current.karaoke_lyrics?.targets_per_phrase ?? DEFAULT_TARGETS_PER_PHRASE, max_lines: current.karaoke_lyrics?.max_lines ?? 2, source: 'notes' } }));
      if (!quiet) setEditorNotice('Note lyric updated. Save to publish the change.');
      return;
    }
    setEditorNotice(null);
  }
  function selectNote(id: string, additive = false) { const note = notes.find(item => item.id === id); if (!note) return; setSelectedPart(note.part < 0 ? 0 : note.part); setSelectedId(id); setSelectedIds(current => additive ? (current.includes(id) ? current.filter(item => item !== id) : [...current, id]) : [id]); setPlayScope('note'); auditionNote(note); }
  function stopNoteAudition() {
    noteAuditionGenerationRef.current += 1;
    noteAuditionStopRef.current?.();
    noteAuditionStopRef.current = null;
  }
  function auditionNote(note: SongNote) {
    stopNoteAudition();
    const generation = noteAuditionGenerationRef.current;
    const play = (context: AudioContext) => {
      if (generation !== noteAuditionGenerationRef.current) return;
      noteAuditionStopRef.current = previewVoices
        ? playVoice(context, note, context.currentTime + .012, Math.max(.04, note.end - note.start))
        : playPianoTone(context, note, context.currentTime + .012, Math.max(.04, note.end - note.start), 0);
    };
    let context = noteAuditionContextRef.current;
    if (!context || context.state === 'closed') {
      context = new AudioContext({ latencyHint: 'interactive' });
      noteAuditionContextRef.current = context;
    }
    if (context.state === 'suspended') void context.resume().then(() => play(context)).catch(() => undefined);
    else play(context);
  }
  /** Make [start, end) free in one voice, the way a pencil frees paper: the
   *  note sounding at `start` is cut off there, notes fully inside the span
   *  go, and a note the span cuts into keeps its tail. Anything left shorter
   *  than one grid step goes too. Writing where something already sounds now
   *  REPLACES it — the old behavior refused with a notice, which on a fully
   *  transcribed song made the editor feel dead: every bar was "occupied". */
  function carveSpace(all: SongNote[], part: number, start: number, end: number, keepId?: string) {
    const step = snapStepAt(musicalBars, start, musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION);
    const result: SongNote[] = [];
    for (const note of all) {
      if (note.id === keepId || note.part !== part || note.end <= start + .0005 || note.start >= end - .0005) { result.push(note); continue; }
      const keepHead = start - note.start >= step - .001;
      const keepTail = note.end - end >= step - .001;
      if (keepHead) result.push({ ...note, end: roundPrecise(start) });
      if (keepTail) result.push({ ...note, id: keepHead ? `note-${crypto.randomUUID()}` : note.id, start: roundPrecise(end), lyric: keepHead ? '' : note.lyric });
    }
    return result;
  }
  /** Where a score click at `time` actually puts a note: snapped to the
   *  grid, then clamped INSIDE the clicked bar — the start can reach the
   *  bar's last grid slot but no further, and the note is cut at the
   *  barline. Writing near the end of a bar used to round forward onto the
   *  next bar's first beat and spill over its barline. */
  function resolveScoreAdd(time: number, part?: number) {
    const division = musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION;
    const value = musicalTimeline.snap_value ?? DEFAULT_NOTE_VALUE;
    const bar = musicalBars.find(item => time >= item.start && time < item.end);
    let start = snapTimeToGrid(musicalBars, time, division);
    if (bar) {
      const step = snapStepAt(musicalBars, bar.start, division);
      start = Math.min(Math.max(start, roundPrecise(bar.start)), snapTimeToGrid(musicalBars, bar.end - step, division));
    }
    // The blocker rule lives HERE so the ghost head is honest: aimed inside
    // an earlier note's span, the note (and the ghost) take the first free
    // spot after it — the audit caught the ghost showing the click point
    // while the note landed after the blocker.
    if (part !== undefined) {
      const blocker = notes.filter(note => note.part === part && note.start < start - .0005
        && note.start + musicalDurationOf(note) > start + .0005).sort((a, b) => b.start - a.start)[0];
      if (blocker) start = snapTimeToGrid(musicalBars, blocker.start + musicalDurationOf(blocker), division);
    }
    // No cut at the barline any more: a value that outgrows the bar ties
    // into the fresh bar that placeWithFlow inserts for it.
    return { start, end: roundPrecise(start + noteDurationAt(musicalBars, start, value)) };
  }
  /** A note's length in whole grid time — the stored duration keeps a ~4%
   *  articulation gap, but flowing notes one after another must advance by
   *  what each note OWNS, or every pack drifts off the grid. */
  function musicalDurationOf(note: SongNote) {
    const quarter = 60 / musicalStateAt(musicalTimeline, note.start).bpm;
    return snapBeats((note.end - note.start) / quarter) * quarter;
  }
  /** Place `candidate` in its voice WITHOUT touching anything that starts
   *  earlier: the rest of the bar slides right to make room (never left),
   *  and when the bar cannot hold it all, fresh bars are inserted between
   *  this bar and the next — later bars keep their music exactly where it
   *  was. A note that outgrows its bar crosses the new barline and engraves
   *  as a tie; what the new bars do not use engraves as rest. */
  function placeWithFlow(all: SongNote[], candidate: SongNote): { notes: SongNote[]; shiftFrom: number; shiftBy: number } {
    const bar = musicalBars.find(item => candidate.start >= item.start - .001 && candidate.start < item.end - .001);
    if (!bar) return { notes: [...all.filter(note => note.id !== candidate.id), candidate], shiftFrom: Number.POSITIVE_INFINITY, shiftBy: 0 };
    const barLen = bar.end - bar.start;
    const tail = all.filter(note => note.id !== candidate.id && note.part === candidate.part
      && note.start >= candidate.start - .0005 && note.start < bar.end - .0005).sort((a, b) => a.start - b.start);
    const tailIds = new Set(tail.map(note => note.id));
    let cursor = roundPrecise(candidate.start + musicalDurationOf(candidate));
    const placedTail: SongNote[] = [];
    for (const note of tail) {
      const start = roundPrecise(Math.max(cursor, note.start));  // push only, never pull — a shortened note leaves rest
      placedTail.push({ ...note, start, end: roundPrecise(start + (note.end - note.start)) });
      cursor = roundPrecise(start + musicalDurationOf(note));
    }
    const overflow = cursor - bar.end;
    const shiftBy = overflow > .001 ? Math.ceil((overflow - .001) / barLen) * barLen : 0;
    let working = all.filter(note => note.id !== candidate.id && !tailIds.has(note.id));
    if (shiftBy > 0) working = working.map(note => note.start >= bar.end - .005 ? { ...note, start: roundPrecise(note.start + shiftBy), end: roundPrecise(note.end + shiftBy) } : note);
    return { notes: [...working, candidate, ...placedTail], shiftFrom: bar.end, shiftBy };
  }
  function shiftLyricsLater(from: number, by: number) {
    if (by <= 0) return;
    setTimedLyrics(current => current.map(line => line.start >= from - .005 ? { ...line, start: roundPrecise(line.start + by), end: roundPrecise(line.end + by) } : line));
  }
  function addNote(part = selectedPart, start = notes.reduce((latest, note) => Math.max(latest, note.end), 0), midi = 60, end?: number, lyric = '') {
    const division = musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION;
    const value = musicalTimeline.snap_value ?? DEFAULT_NOTE_VALUE;
    // The new note NEVER trims what came before it: aimed inside an earlier
    // note's span, it takes the first free spot after that note instead.
    const blocker = notes.filter(note => note.part === part && note.start < start - .0005
      && note.start + musicalDurationOf(note) > start + .0005).sort((a, b) => b.start - a.start)[0];
    const at = blocker ? snapTimeToGrid(musicalBars, blocker.start + musicalDurationOf(blocker), division) : start;
    const id = `note-${crypto.randomUUID()}`;
    const candidate = quantizeNote({ id, part, midi, start: at, end: end !== undefined ? at + (end - start) : at + noteDurationAt(musicalBars, at, value), lyric, velocity: 100 }, musicalBars, division);
    pushHistory();
    const flowed = placeWithFlow(notes, candidate);
    setNotes(flowed.notes);
    shiftLyricsLater(flowed.shiftFrom, flowed.shiftBy);
    setSelectedPart(part); setSelectedId(id); setSelectedIds([id]);
    setEditorNotice(flowed.shiftBy > 0 ? 'A fresh bar was inserted to hold the overflow — everything after it kept its place. Undo reverses it.' : null);
    auditionNote(candidate);
  }
  function insertStepPitch(letter: string) {
    const PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
    const pc = PC[letter];
    if (pc === undefined || !entryBar) return;
    const inVoice = notes.filter(note => (note.part === selectedPart || note.part === -1) && note.start < entryStart + .01).sort((a, b) => a.start - b.start);
    const reference = inVoice.at(-1)?.midi ?? [69, 64, 57, 48][selectedPart] ?? 60;
    // Letters enter the DIATONIC pitch of the song's key, nearest the line's
    // last note — in E-flat major, typing E gives E-flat, as it should.
    const alteration = signatureAlteration(letter.toUpperCase(), keySignature);
    const natural = pc + alteration;
    const midi = natural + 12 * Math.round((reference - natural) / 12);
    setStepCaret(null);
    addNote(selectedPart, entryStart, midi, entryStart + noteDurationAt(musicalBars, entryStart, entryValue), '');
  }
  function restStepAdvance() {
    setStepCaret(entryStart + noteDurationAt(musicalBars, entryStart, entryValue));
  }
  function fillRestOfBar() {
    if (!entryBar || remainingQuarters < .12) return;
    const inVoice = notes.filter(note => (note.part === selectedPart || note.part === -1) && note.start < entryStart + .01).sort((a, b) => a.start - b.start);
    const reference = inVoice.at(-1)?.midi ?? [69, 64, 57, 48][selectedPart] ?? 60;
    setStepCaret(null);
    addNote(selectedPart, entryStart, reference, entryBar.end, '');
  }
  function insertBarAtCaret() {
    if (!entryBar) return;
    const length = entryBar.end - entryBar.start;
    pushHistory();
    setNotes(current => current.map(note => note.start >= entryBar.start - .005 ? { ...note, start: note.start + length, end: note.end + length } : note));
    setTimedLyrics(current => current.map(line => line.start >= entryBar.start - .005 ? { ...line, start: line.start + length, end: line.end + length } : line));
    // The HARMONY and the CLIPS live on the same timeline as the notes —
    // they move together or the song falls apart.
    setTrackSettingsDirty(current => ({
      ...current,
      chord_symbols: (current.chord_symbols ?? []).map(chord => chord.at >= entryBar.start - .005 ? { ...chord, at: roundPrecise(chord.at + length) } : chord),
      band_tracks: current.band_tracks?.map(track => ({
        ...track,
        clips: track.clips.map(clip => clip.start >= entryBar.start - .005 ? { ...clip, start: roundPrecise(clip.start + length) } : clip),
      })),
    }));
    setEditorNotice(`An empty bar was inserted at bar ${entryBar.number}; everything after it — notes, chords and clips — moved one bar later. Undo reverses the notes; chords and clips follow the settings.`);
  }
  function deleteBarAtCaret() {
    if (!entryBar) return;
    const length = entryBar.end - entryBar.start;
    const removed = notes.filter(note => note.start >= entryBar.start - .005 && note.start < entryBar.end - .005).length;
    pushHistory();
    setNotes(current => current
      .filter(note => !(note.start >= entryBar.start - .005 && note.start < entryBar.end - .005))
      .map(note => note.start >= entryBar.end - .005 ? { ...note, start: note.start - length, end: note.end - length } : note));
    setTimedLyrics(current => current
      .filter(line => !(line.start >= entryBar.start - .005 && line.end <= entryBar.end + .005))
      .map(line => line.start >= entryBar.end - .005 ? { ...line, start: line.start - length, end: line.end - length } : line));
    setTrackSettingsDirty(current => ({
      ...current,
      chord_symbols: (current.chord_symbols ?? [])
        .filter(chord => !(chord.at >= entryBar.start - .005 && chord.at < entryBar.end - .005))
        .map(chord => chord.at >= entryBar.end - .005 ? { ...chord, at: roundPrecise(chord.at - length) } : chord),
      band_tracks: current.band_tracks?.map(track => ({
        ...track,
        clips: track.clips
          .filter(clip => !(clip.start >= entryBar.start - .005 && clip.start < entryBar.end - .005))
          .map(clip => clip.start >= entryBar.end - .005 ? { ...clip, start: roundPrecise(clip.start - length) } : clip),
      })).filter(track => track.clips.length > 0),
    }));
    setEditorNotice(`Bar ${entryBar.number} removed${removed ? ` with its ${removed} note${removed === 1 ? '' : 's'}` : ''}; later bars — notes, chords and clips — moved up. Undo reverses the notes; chords and clips follow the settings.`);
  }
  function nudgeSelectedPitch(delta: number) {
    const target = notes.find(note => note.id === selectedId);
    if (target) update(target.id, { midi: Math.max(24, Math.min(96, target.midi + delta)) });
  }
  const stepApiRef = useRef({ insertStepPitch, restStepAdvance, nudgeSelectedPitch, changeNoteValue, undo, redo, stepInput, snapValue: musicalTimeline.snap_value ?? DEFAULT_NOTE_VALUE });
  stepApiRef.current = { insertStepPitch, restStepAdvance, nudgeSelectedPitch, changeNoteValue, undo, redo, stepInput, snapValue: musicalTimeline.snap_value ?? DEFAULT_NOTE_VALUE };

  function addAt(part: number, event: React.MouseEvent<HTMLDivElement>) { const bounds = event.currentTarget.getBoundingClientRect(); const pointerTime = Math.max(0, (event.clientX - bounds.left) / zoom); const division = musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION; const range = pitchRangeForPart(part, notes); const row = Math.max(0, Math.min(range.max - range.min, Math.floor((event.clientY - bounds.top - PITCH_HEADER_HEIGHT) / PITCH_ROW_HEIGHT))); addNote(part, snapTimeToGrid(musicalBars, pointerTime, division), range.max - row); }
  function duplicateSelected() {
    if (!selected) return;
    const division = musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION;
    const id = `note-${crypto.randomUUID()}`;
    const start = snapTimeToGrid(musicalBars, selected.end, division, 'ceil');
    const copy = quantizeNote({ ...selected, id, start, end: start + (selected.end - selected.start) }, musicalBars, division);
    if (collisionInVoice([copy], notes)) { setEditorNotice(`Cannot duplicate here because ${VOICES[copy.part] ?? 'this voice'} already contains a note.`); return; }
    pushHistory(); setNotes(current => [...current, copy]); setSelectedId(id); setSelectedIds([id]); setTool('select'); setEditorNotice(null);
  }
  function copySelectedNotes() {
    const copied = notes.filter(note => selectedIds.includes(note.id)).sort((a, b) => a.start - b.start || a.part - b.part).map(note => ({ ...note }));
    if (copied.length) { setNoteClipboard(copied); setTool('select'); }
  }
  function pasteCopiedNotes() {
    if (!noteClipboard.length) return;
    const anchor = Math.min(...noteClipboard.map(note => note.start));
    const division = musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION;
    const destination = snapTimeToGrid(musicalBars, Math.max(0, playhead ?? 0), division);
    const pasted = noteClipboard.map(note => quantizeNote({ ...note, id: `note-${crypto.randomUUID()}`, start: destination + note.start - anchor, end: destination + note.end - anchor }, musicalBars, division));
    if (collisionInVoice(pasted, notes)) { setEditorNotice('Paste cancelled: one or more notes would overlap an existing note in the same voice. Move the playhead to a free beat and paste again.'); return; }
    pushHistory();
    setNotes(current => [...current, ...pasted]);
    setSelectedIds(pasted.map(note => note.id));
    setSelectedId(pasted[0]?.id ?? null);
    setSelectedPart(pasted[0]?.part < 0 ? 0 : pasted[0]?.part ?? 0);
    setPlayScope('note');
    setTool('select');
    setEditorNotice(null);
  }
  function removeNote(id: string) { pushHistory(); setNotes(current => current.filter(note => note.id !== id)); setSelectedId(current => current === id ? null : current); setSelectedIds(current => current.filter(item => item !== id)); }
  /** Rewrite the marks (and optionally velocity) of every selected note, in
   *  time order, in one history step. Empty marks objects are dropped so the
   *  stored JSON stays clean. */
  function editSelectionMarks(mutate: (marks: NoteMarks, note: SongNote, index: number, count: number) => { marks: NoteMarks; velocity?: number }) {
    if (!selectedIds.length) return;
    pushHistory();
    setNotes(current => {
      const chosen = current.filter(note => selectedIds.includes(note.id)).sort((a, b) => a.start - b.start);
      const order = new Map(chosen.map((note, index) => [note.id, index]));
      return current.map(note => {
        const index = order.get(note.id);
        if (index === undefined) return note;
        const result = mutate({ ...(note.marks ?? {}) }, note, index, chosen.length);
        const kept = Object.fromEntries(Object.entries(result.marks).filter(([, value]) => value !== undefined && value !== false));
        return { ...note, marks: Object.keys(kept).length ? kept as NoteMarks : undefined, ...(result.velocity !== undefined ? { velocity: result.velocity } : {}) };
      });
    });
    setEditorNotice(null);
  }
  function applyDynamicToSelection(dynamic: DynamicMark | null) {
    const DYNAMIC_VELOCITY: Record<DynamicMark, number> = { pp: 40, p: 55, mp: 70, mf: 85, f: 100, ff: 115 };
    editSelectionMarks(marks => dynamic
      ? { marks: { ...marks, dynamic }, velocity: DYNAMIC_VELOCITY[dynamic] }
      : { marks: { ...marks, dynamic: undefined }, velocity: 100 });
  }
  function toggleMarkOnSelection(key: 'staccato' | 'tenuto' | 'fermata' | 'slide') {
    const allHave = selectedNotes.length > 0 && selectedNotes.every(note => note.marks?.[key]);
    editSelectionMarks(marks => ({ marks: { ...marks, [key]: allHave ? undefined : true } }));
  }
  function transposeSong(semitones: number) {
    pushHistory();
    setNotes(current => current.map(note => ({ ...note, midi: Math.max(24, Math.min(96, note.midi + semitones)) })));
    setTrackSettingsDirty(current => ({ ...current, chord_symbols: (current.chord_symbols ?? []).map(chord => ({ ...chord, symbol: transposeChordSymbol(chord.symbol, semitones) })) }));
    setEditorNotice(`Whole song moved ${semitones > 0 ? 'up' : 'down'} a semitone — notes and chord symbols together. Undo reverses it.`);
  }
  function setChordAtSelection(symbol: string) {
    const first = selectedNotes[0];
    if (!first) return;
    pushHistory();
    const at = roundPrecise(first.start);
    setTrackSettingsDirty(current => {
      const others = (current.chord_symbols ?? []).filter(chord => Math.abs(chord.at - at) > 0.05);
      const next = symbol.trim() ? [...others, { at, symbol: symbol.trim() }].sort((a, b) => a.at - b.at) : others;
      return { ...current, chord_symbols: next };
    });
    setEditorNotice(null);
  }
  function applyBandAt(target: { noteId: string } | 'default', field: 'instrument' | 'drums' | 'remove', value: string) {
    // The score's band directives land here: clicking one opens a popover
    // and its choices arrive as targeted edits — no need to hunt for the
    // carrying note. 'default' edits the song-wide starting band instead.
    if (target === 'default') {
      const mapped = value === 'stop' ? 'off' : value;
      setTrackSettingsDirty(current => ({ ...current, accompaniment: {
        guitar: field === 'instrument' ? mapped : current.accompaniment?.guitar ?? 'off',
        drums: field === 'drums' ? mapped : current.accompaniment?.drums ?? 'off',
        instrument_tab: current.accompaniment?.instrument_tab, drum_tab: current.accompaniment?.drum_tab,
      } }));
      return;
    }
    pushHistory();
    setNotes(current => current.map(note => {
      if (note.id !== target.noteId) return note;
      const marks = { ...(note.marks ?? {}) };
      if (field === 'remove') { delete marks.band; }
      else {
        const band = { ...(marks.band ?? {}) };
        if (value) band[field] = value; else delete band[field];
        // Leaving 'custom' retires the instruction's written part with it.
        if (field === 'instrument' && value !== 'custom') delete band.instrument_tab;
        if (field === 'drums' && value !== 'custom') delete band.drum_tab;
        if (band.instrument || band.drums) marks.band = band; else delete marks.band;
      }
      return { ...note, marks: Object.keys(marks).length ? marks : undefined };
    }));
  }
  // ---- audition + part studio: hear one band instruction, or write it.
  const auditionContextRef = useRef<AudioContext | null>(null);
  useEffect(() => { preloadPiano(); }, []);
  function bandBarsForBuild() {
    return musicalBars.map(bar => ({ start: bar.start, end: bar.end, beatCount: Math.max(1, bar.beats.length) }));
  }
  function anchorBarOf(target: { noteId: string } | 'default') {
    // 'from the top' means where the MUSIC starts — a song with silent
    // lead-in bars anchors at its first sung bar, never at empty ones.
    // An instruction riding a MID-BAR note governs from the NEXT barline
    // (the band turns at barlines), so its window starts there too.
    const anchor = target === 'default'
      ? (notes.length ? Math.min(...notes.map(note => note.start)) : 0)
      : (notes.find(note => note.id === target.noteId)?.start ?? 0);
    const bar = musicalBars.find(item => anchor + 0.01 >= item.start && anchor + 0.01 < item.end) ?? musicalBars[0];
    if (target !== 'default' && bar && anchor - bar.start > 0.03) {
      const index = musicalBars.indexOf(bar);
      return musicalBars[index + 1] ?? bar;
    }
    return bar;
  }
  async function playAudition(events: BandEvent[], from: number, seconds: number): Promise<{ context: AudioContext; start: number } | null> {
    void auditionContextRef.current?.close().catch(() => undefined);
    const slice = events.filter(event => event.at >= from - 0.01 && event.at < from + seconds);
    if (!slice.length) return null;
    const context = new AudioContext();
    auditionContextRef.current = context;
    warmPiano(context);
    void context.resume();
    // Scheduling picks sample-or-synth at CALL time, so scheduling in the
    // same tick the context was born always lost the race and the whole
    // audition fell back to synthesis. Wait for the decode (capped, so a
    // missing file can never hold the preview hostage) — the real piano
    // and guitar recordings are what plays.
    await Promise.race([samplesReady(context), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (auditionContextRef.current !== context || context.state === 'closed') return null;
    const start = context.currentTime + 0.06;
    for (const event of slice) playBandEvent(context, event, start + event.at - from);
    return { context, start };
  }
  /** The studio's second preview: the part TOGETHER with the singing —
   *  every voice sounding in the window joins the band. */
  async function playAuditionWithVoices(events: BandEvent[], from: number, seconds: number): Promise<{ context: AudioContext; start: number } | null> {
    const running = (await playAudition(events, from, seconds)) ?? (() => {
      const context = new AudioContext();
      auditionContextRef.current = context;
      void context.resume();
      return { context, start: context.currentTime + 0.06 };
    })();
    const until = from + seconds;
    const sounding = notes.filter(note => note.start < until && note.end > from);
    for (const note of sounding) {
      const at = Math.max(0, note.start - from);
      const length = Math.min(note.end, until) - Math.max(note.start, from);
      if (length > 0.04) playVoice(running.context, note, running.start + at, length);
    }
    return sounding.length > 0 || events.length > 0 ? running : null;
  }
  /** The needle: while an audition runs, a cyan line rides the shared
   *  ruler through all three sections at the audio clock's position. */
  const [auditionRun, setAuditionRun] = useState<{ context: AudioContext; startAt: number; seconds: number } | null>(null);
  const studioNeedleRef = useRef<HTMLDivElement | null>(null);
  const studioScrollRef = useRef<HTMLDivElement | null>(null);
  function stopAudition() {
    void auditionContextRef.current?.close().catch(() => undefined);
    setAuditionRun(null);
  }
  useEffect(() => {
    if (!auditionRun || !bandWrite) return;
    const eighthLen = bandWrite.barLen / bandWrite.perBar;
    let raf = 0;
    const tick = () => {
      const elapsed = auditionRun.context.currentTime - auditionRun.startAt;
      const needle = studioNeedleRef.current;
      if (needle && elapsed >= 0) {
        needle.style.display = 'block';
        const left = PART_LEFT + (elapsed / eighthLen) * PART_CELL;
        needle.style.left = `${left}px`;
        const scroller = studioScrollRef.current;
        if (scroller) {
          const target = Math.max(0, left - scroller.clientWidth * 0.45);
          if (Math.abs(scroller.scrollLeft - target) > 10) scroller.scrollLeft = target;
        }
      }
      if (elapsed > auditionRun.seconds + 0.3) {
        setAuditionRun(null);
        void auditionRun.context.close().catch(() => undefined);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (studioNeedleRef.current) studioNeedleRef.current.style.display = 'none';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditionRun]);
  async function auditionBandAt(target: { noteId: string } | 'default') {
    const bar = anchorBarOf(target);
    if (!bar || !laneBandEvents) { setEditorNotice('Nothing for the band to play yet — give it chord symbols, a melody style, or a written part.'); return; }
    const played = await playAudition(laneBandEvents, bar.start, 4 * (bar.end - bar.start) + 0.01);
    setEditorNotice(played
      ? `▶ Auditioning the band from bar ${bar.number ?? '?'} — double-click the instruction to write the part yourself.`
      : 'The band is silent here — chord styles need chord symbols to play.');
  }
  const [bandWrite, setBandWrite] = useState<{ target: { noteId: string } | { trackId: string; clipId: string } | 'default'; barNumber: number; from: number; barLen: number; perBar: number; anchorTime: number } | null>(null);
  /** How many bars the part applies for — null means until the next
   *  instruction. Saving with a number stamps a closing instruction that
   *  restores what played before, so the part covers EXACTLY those bars. */
  const [applyBars, setApplyBars] = useState<number | null>(null);
  const [draftInstrumentTab, setDraftInstrumentTab] = useState('');
  const [draftDrumTab, setDraftDrumTab] = useState('');
  const [patternBars, setPatternBars] = useState(2);
  // The alignment rail: whichever section the cursor is over, one glowing
  // column runs through voices, staff and drums at that eighth.
  const [studioHover, setStudioHover] = useState<number | null>(null);
  const [studioFull, setStudioFull] = useState(false);
  const studioPanelRef = useRef<HTMLDivElement | null>(null);
  /** ⛶ = REAL browser fullscreen: the studio takes the whole monitor via
   *  the Fullscreen API, not just the page. If the browser refuses (older
   *  engines, embeds without the permission), the in-page expansion still
   *  applies, so the button always does something. */
  function toggleStudioFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      setStudioFull(false);
      return;
    }
    setStudioFull(true);
    void studioPanelRef.current?.requestFullscreen?.().catch(() => undefined);
  }
  useEffect(() => {
    const sync = () => { if (!document.fullscreenElement) setStudioFull(current => current && false); };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  useEffect(() => {
    // Closing the studio always leaves fullscreen with it.
    if (!bandWrite && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    if (!bandWrite) setStudioFull(false);
  }, [bandWrite]);
  /** Print what the band ACTUALLY plays in a window into editable tab text —
   *  how the studio opens a preset pattern as its exact notes. */
  function materializeInstrumentTab(events: BandEvent[], from: number, eighthLen: number, columns: number): string {
    const cells: string[] = Array.from({ length: columns }, () => '-');
    for (const event of events) {
      if (!['pluck', 'keys', 'bass', 'strum-down', 'strum-up'].includes(event.kind) || !event.midis?.length) continue;
      const cell = Math.round((event.at - from) / eighthLen);
      if (cell < 0 || cell >= columns) continue;
      const existing = cells[cell] === '-' ? [] : cells[cell].split(',');
      cells[cell] = [...new Set([...existing, ...event.midis.map(midiToken)])].join(',');
    }
    // No trailing trim: the loop is the tab's length, and a loop shorter
    // than the window would displace every repeat off the barline.
    return cells.some(cell => cell !== '-') ? cells.join(' ') : '';
  }
  const DRUM_KIND_LANE: Record<string, string> = { kick: 'K', snare: 'S', hat: 'H', 'tom-high': 'T', 'tom-low': 't', 'cajon-bass': 'B', 'cajon-slap': 'P', 'cajon-tick': 'c' };
  function materializeDrumTab(events: BandEvent[], from: number, eighthLen: number, columns: number): string {
    const lanes = new Map<string, string[]>();
    for (const event of events) {
      const lane = DRUM_KIND_LANE[event.kind];
      if (!lane) continue;
      const cell = Math.round((event.at - from) / eighthLen);
      if (cell < 0 || cell >= columns) continue;
      if (!lanes.has(lane)) lanes.set(lane, Array.from({ length: columns }, () => '-'));
      lanes.get(lane)![cell] = 'o';
    }
    // Every lane keeps the full window: parseDrumTab loops at the LONGEST
    // lane, so ragged per-lane trims changed the loop length away from the
    // musical window and every repeat displaced off the barline.
    return [...lanes.entries()].map(([lane, cells]) => `${lane}: ${cells.join('')}`).join('\n');
  }
  function openBandWrite(target: { noteId: string } | 'default') {
    stopAudition();
    const bar = anchorBarOf(target);
    const from = bar?.start ?? 0;
    const perBar = Math.max(2, (bar?.beats.length ?? 2) * 2);
    const eighthLen = bar ? (bar.end - bar.start) / perBar : 0.25;
    // The studio edits the EXACT part sounding here. Priority: the
    // instruction's own written part; a custom region's tab; otherwise the
    // preset pattern is materialized into concrete notes over this window,
    // ready to be reshaped.
    const own = target !== 'default' ? notes.find(note => note.id === target.noteId)?.marks?.band : undefined;
    const regions = bandRegions(notes, { instrument: accompaniment.guitar as InstrumentStyleId, drums: accompaniment.drums as DrumStyleId });
    // The region THIS instruction creates — resolved at the instruction's
    // own time, not the bar start (where a mid-bar instruction hasn't
    // turned yet and the previous section would be seeded instead).
    const anchorTime = target === 'default' ? from : (notes.find(note => note.id === target.noteId)?.start ?? from);
    let region = regions[0];
    for (const item of regions) { if (item.from <= anchorTime + 0.02) region = item; else break; }
    const seedColumns = Math.min(32, 4 * perBar);
    const windowEvents = (laneBandEvents ?? []).filter(event => event.at >= from - 0.01 && event.at < from + seedColumns * eighthLen - 0.001);
    const instrumentDraft = own?.instrument_tab
      ?? (region.instrument === 'custom' ? (region.instrumentTab ?? accompaniment.instrument_tab ?? '')
        : region.instrument !== 'off' ? materializeInstrumentTab(windowEvents, from, eighthLen, seedColumns) : '');
    const drumDraft = own?.drum_tab
      ?? (region.drums === 'custom' ? (region.drumTab ?? accompaniment.drum_tab ?? '')
        : region.drums !== 'off' ? materializeDrumTab(windowEvents, from, eighthLen, seedColumns) : '');
    setDraftInstrumentTab(instrumentDraft);
    setDraftDrumTab(drumDraft);
    const contentBars = Math.ceil(Math.max(partLengthEighths(instrumentDraft), drumLengthEighths(drumDraft), 1) / perBar);
    setPatternBars(Math.min(4, Math.max(2, contentBars)));
    setStudioHover(null);
    setApplyBars(null);
    setBandWrite({ target, barNumber: bar?.number ?? 1, from, barLen: bar ? bar.end - bar.start : 2, perBar, anchorTime });
    const materialized = (!own?.instrument_tab && region.instrument !== 'custom' && region.instrument !== 'off')
      || (!own?.drum_tab && region.drums !== 'custom' && region.drums !== 'off');
    if (materialized) setEditorNotice('The part below is EXACTLY what the band plays here, printed as editable notes — reshape it and press Use this part to make it this section’s own.');
  }
  // Every studio section shares ONE column count, so the three stay strictly
  // aligned and equally long: at least the chosen bars, grown to fit the
  // longer of the two written parts.
  const studioColumns = useMemo(() => {
    if (!bandWrite) return 8;
    const content = Math.max(partLengthEighths(draftInstrumentTab), drumLengthEighths(draftDrumTab));
    // The window always spans EVERY bar the part is set to apply to.
    return Math.min(64, Math.max(patternBars * bandWrite.perBar, (applyBars ?? 0) * bandWrite.perBar, Math.ceil(content / bandWrite.perBar) * bandWrite.perBar));
  }, [bandWrite, draftInstrumentTab, draftDrumTab, patternBars, applyBars]);
  // The SATB pitches as ghost dashes on the instrument staff, column by
  // column — place a head ON a dash to double that voice, off it to harmonize.
  const studioReference = useMemo(() => {
    if (!bandWrite) return [];
    const eighthLen = bandWrite.barLen / bandWrite.perBar;
    const until = bandWrite.from + studioColumns * eighthLen;
    return notes.filter(note => note.start < until && note.end > bandWrite.from).map(note => ({
      midi: note.midi, part: note.part < 0 ? 0 : Math.min(3, note.part),
      startEighth: Math.max(0, Math.floor((note.start - bandWrite.from) / eighthLen + 0.001)),
      endEighth: Math.min(studioColumns, Math.ceil((note.end - bandWrite.from) / eighthLen - 0.001)),
    })).filter(reference => reference.endEighth > reference.startEighth);
  }, [bandWrite, notes, studioColumns]);
  /** Open the studio on a CLIP: the DAW path. The drafts hold the clip's
   *  written music; drums and Applies-for do not apply — a clip has its
   *  own length and its track's timbre. */
  function openClipWrite(trackId: string, clipId: string, presetBars?: number) {
    stopAudition();
    const track = (trackSettings.band_tracks ?? []).find(item => item.id === trackId);
    const clip = track?.clips.find(item => item.id === clipId);
    if (!track || !clip) return;
    const bar = musicalBars.find(item => clip.start + 0.01 >= item.start && clip.start + 0.01 < item.end) ?? musicalBars[0];
    const perBar = Math.max(2, (bar?.beats.length ?? 2) * 2);
    setDraftInstrumentTab(clip.tab);
    setDraftDrumTab('');
    const contentBars = Math.ceil(Math.max(partLengthEighths(clip.tab), 1) / perBar);
    setPatternBars(Math.min(8, Math.max(2, presetBars ?? contentBars)));
    setStudioHover(null);
    setApplyBars(null);
    setBandWrite({ target: { trackId, clipId }, barNumber: bar?.number ?? 1, from: clip.start, barLen: bar ? bar.end - bar.start : 2, perBar, anchorTime: clip.start });
  }
  const clipTarget = bandWrite && typeof bandWrite.target === 'object' && 'clipId' in bandWrite.target ? bandWrite.target : null;
  const partImportRef = useRef<HTMLInputElement | null>(null);
  const [importingPart, setImportingPart] = useState(false);
  // ---- the MIDI keyboard, DAW-style step entry: play a note or a chord
  // on a connected keyboard and it lands on the staff at the brush length,
  // column after column. Notes arriving within 90ms group into one stack.
  const [studioBrush, setStudioBrush] = useState(2);
  const studioBrushRef = useRef(2);
  useEffect(() => { studioBrushRef.current = studioBrush; }, [studioBrush]);
  const [midiArmed, setMidiArmed] = useState(false);
  const midiAccessRef = useRef<{ inputs: Map<string, { onmidimessage: ((message: { data: Uint8Array }) => void) | null }>; onstatechange: (() => void) | null } | null>(null);
  const midiChordRef = useRef<{ midis: number[]; timer: number | null }>({ midis: [], timer: null });
  function commitMidiStep(midis: number[]) {
    setDraftInstrumentTab(current => {
      const cells = parsePartCells(current);
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      const start = cells.length;
      if (start >= 64) return current;
      const hold = Math.max(1, Math.min(studioBrushRef.current, 64 - start));
      cells.push({ midis: [...midis].sort((a, b) => a - b), hold });
      for (let extra = 1; extra < hold; extra++) cells.push(null);
      return buildPartText(cells);
    });
  }
  function handleMidiMessage(message: { data: Uint8Array }) {
    const [status, note, velocity] = message.data;
    if ((status & 0xf0) !== 0x90 || !velocity) return;   // note-on only
    const chord = midiChordRef.current;
    chord.midis.push(note);
    if (chord.timer) window.clearTimeout(chord.timer);
    chord.timer = window.setTimeout(() => {
      const midis = [...new Set(chord.midis)];
      chord.midis = [];
      chord.timer = null;
      commitMidiStep(midis);
    }, 90);
  }
  function detachMidi() {
    const access = midiAccessRef.current;
    if (access) { for (const input of access.inputs.values()) input.onmidimessage = null; access.onstatechange = null; }
    setMidiArmed(false);
  }
  async function toggleMidiInput() {
    if (midiArmed) { detachMidi(); setEditorNotice('🎹 MIDI input off.'); return; }
    const request = (navigator as Navigator & { requestMIDIAccess?: () => Promise<unknown> }).requestMIDIAccess;
    if (!request) { setEditorNotice('This browser has no Web MIDI — Chrome or Edge can talk to your keyboard.'); return; }
    try {
      const access = await request.call(navigator) as NonNullable<typeof midiAccessRef.current>;
      midiAccessRef.current = access;
      const attach = () => { for (const input of access.inputs.values()) input.onmidimessage = handleMidiMessage; };
      attach();
      access.onstatechange = attach;
      const count = [...access.inputs.values()].length;
      setMidiArmed(true);
      setEditorNotice(count
        ? `🎹 MIDI armed (${count} device${count === 1 ? '' : 's'}). Play a note or a chord — it lands at the palette's value, step by step. Pick a longer value for longer notes; rests via the staff.`
        : '🎹 MIDI armed — no keyboard detected yet. Plug it in and play; it will be picked up automatically.');
    } catch {
      setEditorNotice('The browser refused MIDI access — allow it in the site permissions and try again.');
    }
  }
  useEffect(() => { if (!bandWrite) detachMidi(); /* the studio closing disarms the keyboard */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandWrite]);
  /** Bring outside music INTO the part: a MIDI file, a MusicXML sheet, or
   *  an audio recording (transcribed offline by the same detector that
   *  turns sung takes into notes). Whatever arrives is quantized onto the
   *  studio's eighth grid and written into the draft. */
  async function importPartFile(file: File) {
    if (!bandWrite) return;
    setImportingPart(true);
    try {
      const name = file.name.toLowerCase();
      let imported: Array<{ start: number; end: number; midi: number }> = [];
      let source = '';
      if (name.endsWith('.mid') || name.endsWith('.midi')) {
        imported = parseMidiNotes(await file.arrayBuffer());
        source = 'MIDI';
      } else if (name.endsWith('.xml') || name.endsWith('.musicxml') || name.endsWith('.mxl')) {
        imported = parseMusicXml(await readMusicXmlFile(file)).notes;
        source = 'MusicXML';
      } else {
        const context = new AudioContext();
        const decoded = await context.decodeAudioData(await file.arrayBuffer());
        await context.close();
        const result = await detectVocalNotes(decoded, { part: 0, timelineOffset: 0, minMidi: 30, maxMidi: 96 });
        imported = result.notes;
        source = `the recording (${Math.round(result.diagnostics.averageConfidence * 100)}% pitch confidence)`;
      }
      if (!imported.length) { setEditorNotice('Nothing usable came out of that file — no notes were found.'); return; }
      const eighthLen = bandWrite.barLen / bandWrite.perBar;
      const anchor = Math.min(...imported.map(note => note.start));
      const cells: (PartCell | null)[] = Array.from({ length: 64 }, () => null);
      let clipped = 0;
      for (const note of imported) {
        const column = Math.round((note.start - anchor) / eighthLen);
        if (column < 0 || column >= 64) { clipped += 1; continue; }
        const hold = Math.max(1, Math.round((note.end - note.start) / eighthLen));
        const cell = cells[column] ?? { midis: [], hold: 1 };
        if (!cell.midis.includes(note.midi)) cell.midis.push(note.midi);
        cell.midis.sort((a, b) => a - b);
        cell.hold = Math.max(cell.hold, Math.min(hold, 64 - column));
        cells[column] = cell;
      }
      // A hold must never swallow a later note (imports at a different
      // tempo than the song can land notes inside earlier holds) — the
      // earlier note is truncated, the newcomer survives.
      let previousColumn = -1;
      for (let column = 0; column < cells.length; column++) {
        if (!cells[column]) continue;
        if (previousColumn >= 0) {
          const previous = cells[previousColumn]!;
          if (previousColumn + previous.hold > column) previous.hold = column - previousColumn;
        }
        previousColumn = column;
      }
      const text = buildPartText(cells);
      if (!text.trim()) { setEditorNotice('The file’s notes did not fit the grid.'); return; }
      setDraftInstrumentTab(text);
      setPatternBars(Math.min(8, Math.max(2, Math.ceil(partLengthEighths(text) / bandWrite.perBar))));
      setEditorNotice(`\u{1F4E5} ${imported.length - clipped} notes imported from ${source}${clipped ? ` (${clipped} beyond the 8-bar window were left out)` : ''} — quantized to the eighth grid, on the staff and ready to reshape.`);
    } catch (error) {
      setEditorNotice(`That file could not be read: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImportingPart(false);
    }
  }
  // The studio's preview: the DRAFT playing. In clip mode the draft is the
  // clip ALONE (its track's timbre, once, from its start); otherwise the
  // draft tabs play everywhere with band marks stripped, so the writer
  // hears the whole line against SATB.
  const draftBandEvents = useMemo(() => {
    if (!bandWrite) return undefined;
    const lastSound = notes.reduce((latest, note) => Math.max(latest, note.end), 0);
    if (!lastSound) return undefined;
    if (clipTarget) {
      const track = (trackSettings.band_tracks ?? []).find(item => item.id === clipTarget.trackId);
      if (!track) return undefined;
      return buildBandEvents({
        bars: bandBarsForBuild(), chords: trackSettings.chord_symbols ?? [], notes,
        defaults: { instrument: 'off', drums: 'off' },
        until: lastSound + 0.05,
        tracks: [{ ...track, clips: [{ id: clipTarget.clipId, start: bandWrite.from, tab: draftInstrumentTab }] }],
        humanize: false, countIn: false,
      });
    }
    return buildBandEvents({
      bars: bandBarsForBuild(), chords: trackSettings.chord_symbols ?? [],
      notes: notes.map(note => note.marks?.band ? { ...note, marks: { ...note.marks, band: undefined } } : note),
      defaults: {
        instrument: (draftInstrumentTab.trim() ? 'custom' : accompaniment.guitar) as InstrumentStyleId,
        drums: (draftDrumTab.trim() ? 'custom' : accompaniment.drums) as DrumStyleId,
      },
      until: lastSound + 0.05,
      customTabs: { instrument: draftInstrumentTab, drums: draftDrumTab },
      humanize: false, countIn: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandWrite, clipTarget, draftInstrumentTab, draftDrumTab, musicalBars, notes, trackSettings.chord_symbols, trackSettings.band_tracks, accompaniment.guitar, accompaniment.drums]);
  /** The instruction that ENDS a limited span: restores what played before
   *  the anchor (or the given override), on the first note at the boundary.
   *  Null when a later instruction already takes over inside the span. */
  function closingFor(anchorTime: number, boundary: number, excludeNoteId: string | null, override?: NonNullable<NoteMarks['band']>): { carrierId: string; band: NonNullable<NoteMarks['band']> } | null {
    const intervening = notes.some(note => note.id !== excludeNoteId && note.marks?.band && note.start > anchorTime + 0.01 && note.start < boundary + 0.02);
    const carrier = notes.filter(note => note.start >= boundary - 0.02).sort((a, b) => a.start - b.start)[0];
    if (intervening || !carrier) return null;
    if (override) return { carrierId: carrier.id, band: override };
    const others = notes.filter(note => note.id !== excludeNoteId);
    const regions = bandRegions(others, { instrument: accompaniment.guitar as InstrumentStyleId, drums: accompaniment.drums as DrumStyleId });
    let previous = regions[0];
    for (const item of regions) { if (item.from <= anchorTime + 0.01) previous = item; else break; }
    const style = (value: string) => value === 'off' ? 'stop' : value;
    return { carrierId: carrier.id, band: {
      instrument: style(previous.instrument), drums: style(previous.drums),
      ...(previous.instrument === 'custom' && previous.instrumentTab ? { instrument_tab: previous.instrumentTab } : {}),
      ...(previous.drums === 'custom' && previous.drumTab ? { drum_tab: previous.drumTab } : {}),
    } };
  }
  /** A band chip dropped on the score: place the instruction on the first
   *  note of the painted range; painting several bars limits the span with
   *  a closing instruction. The custom chip opens the Part studio instead. */
  function handleBandChipDrop(startBar: number, endBar: number, payload: { field: string; style: string }) {
    const bar = musicalBars.find(item => item.number === startBar);
    if (!bar) return;
    if (payload.field === 'clip') {
      // The DAW path: a free clip on its instrument's track, opened in the
      // studio ready to be written. No carrier note needed — clips live on
      // the song itself.
      const timbre = payload.style as BandTimbre;
      const trackId = `trk-${timbre}`;
      const clipId = `clip-${crypto.randomUUID().slice(0, 8)}`;
      setTrackSettingsDirty(current => {
        const tracks = (current.band_tracks ?? []).map(track => track.id === trackId ? { ...track, clips: [...track.clips] } : track);
        let track = tracks.find(item => item.id === trackId);
        if (!track) { track = { id: trackId, name: timbre, timbre, clips: [] }; tracks.push(track); }
        track.clips.push({ id: clipId, start: bar.start, tab: '' });
        return { ...current, band_tracks: tracks };
      });
      stopAudition();
      setDraftInstrumentTab('');
      setDraftDrumTab('');
      const perBar = Math.max(2, (bar.beats.length ?? 2) * 2);
      setPatternBars(Math.min(8, Math.max(2, endBar - startBar + 1)));
      setStudioHover(null);
      setApplyBars(null);
      setBandWrite({ target: { trackId, clipId }, barNumber: startBar, from: bar.start, barLen: bar.end - bar.start, perBar, anchorTime: bar.start });
      return;
    }
    const carrier = notes.filter(note => note.start >= bar.start - 0.02 && note.start < bar.end - 0.01).sort((a, b) => a.start - b.start)[0]
      ?? notes.filter(note => note.start >= bar.start - 0.02).sort((a, b) => a.start - b.start)[0];
    if (!carrier) { setEditorNotice('No note there to carry the instruction — drop it on a bar with singing.'); return; }
    if (payload.field === 'custom') {
      openBandWrite({ noteId: carrier.id });
      if (endBar > startBar) setApplyBars(Math.min(8, endBar - startBar + 1));
      return;
    }
    const boundaryBar = musicalBars.find(item => item.number === endBar);
    // The closing restores the sound AS IT IS at the drop point — including
    // any instruction already on the carrier that this drop overrides — so
    // a painted break ends by handing back exactly what was playing.
    const closing = endBar > startBar ? closingFor(carrier.start, (boundaryBar ?? bar).end, null) : null;
    pushHistory();
    setNotes(current => current.map(note => {
      if (note.id === carrier.id) {
        const band = { ...(note.marks?.band ?? {}) };
        if (payload.field === 'stop') { band.instrument = 'stop'; band.drums = 'stop'; delete band.instrument_tab; delete band.drum_tab; }
        else if (payload.field === 'instrument') { band.instrument = payload.style; delete band.instrument_tab; }
        else { band.drums = payload.style; delete band.drum_tab; }
        return { ...note, marks: { ...(note.marks ?? {}), band } };
      }
      if (closing && note.id === closing.carrierId) return { ...note, marks: { ...(note.marks ?? {}), band: closing.band } };
      return note;
    }));
    const effective = carrier.start - bar.start > 0.03 ? startBar + 1 : startBar;
    setEditorNotice(endBar > startBar
      ? `Dropped: plays bars ${effective}–${endBar + 1}, then the previous sound resumes${closing ? '' : ' (a later instruction takes over)'} . Undo removes it.`
      : `Dropped: plays from bar ${effective} until the next instruction. Undo removes it.`);
  }
  function saveBandWrite() {
    if (!bandWrite) return;
    stopAudition();
    const instrument = draftInstrumentTab.trim();
    const drums = draftDrumTab.trim();
    // A part limited to N bars gets a CLOSING instruction at its boundary
    // that restores whatever played before it — unless a later instruction
    // already takes over inside the span.
    // Clips carry their own length — save the tab and be done.
    if (typeof bandWrite.target === 'object' && 'clipId' in bandWrite.target) {
      const { trackId, clipId } = bandWrite.target;
      setTrackSettingsDirty(current => {
        const tracks = (current.band_tracks ?? [])
          .map(track => track.id !== trackId ? track : {
            ...track,
            clips: instrument
              ? track.clips.map(clip => clip.id === clipId ? { ...clip, tab: instrument } : clip)
              : track.clips.filter(clip => clip.id !== clipId),
          })
          .filter(track => track.clips.length > 0);
        return { ...current, band_tracks: tracks.length ? tracks : undefined };
      });
      setBandWrite(null);
      setEditorNotice(instrument
        ? `\u{1F3BC} The clip is saved — it plays once from bar ${bandWrite.barNumber} in its track's voice. Save keeps it with the song.`
        : 'The empty clip was removed.');
      return;
    }
    const closing = applyBars
      ? closingFor(bandWrite.anchorTime, bandWrite.from + applyBars * bandWrite.barLen,
        typeof bandWrite.target === 'object' && 'noteId' in bandWrite.target ? bandWrite.target.noteId : null,
        bandWrite.target === 'default' ? { instrument: 'stop', drums: 'stop' } : undefined)
      : null;
    if (bandWrite.target === 'default') {
      // The song-wide part: lives on the accompaniment settings.
      setTrackSettingsDirty(current => {
        const acc = {
          guitar: current.accompaniment?.guitar ?? 'off', drums: current.accompaniment?.drums ?? 'off',
          instrument_tab: instrument || undefined, drum_tab: drums || undefined,
        };
        if (instrument) acc.guitar = 'custom';
        if (drums) acc.drums = 'custom';
        return { ...current, accompaniment: acc };
      });
      if (closing) {
        pushHistory();
        setNotes(current => current.map(note => note.id === closing!.carrierId ? { ...note, marks: { ...(note.marks ?? {}), band: closing!.band } } : note));
      }
    } else {
      // A section's part: lives ON ITS INSTRUCTION, so every section keeps
      // its own written music — editing one never rewrites another.
      // Empty drafts CLEAR the instruction's stored part.
      const noteId = (bandWrite.target as { noteId: string }).noteId;
      pushHistory();
      setNotes(current => current.map(note => {
        if (note.id === noteId) {
          const band = { ...(note.marks?.band ?? {}) };
          if (instrument) { band.instrument = 'custom'; band.instrument_tab = instrument; } else delete band.instrument_tab;
          if (drums) { band.drums = 'custom'; band.drum_tab = drums; } else delete band.drum_tab;
          return { ...note, marks: { ...(note.marks ?? {}), band } };
        }
        if (closing && note.id === closing.carrierId) return { ...note, marks: { ...(note.marks ?? {}), band: closing.band } };
        return note;
      }));
    }
    setBandWrite(null);
    setEditorNotice(applyBars
      ? `✍ The part plays for ${applyBars} bar${applyBars === 1 ? '' : 's'} from bar ${bandWrite.barNumber}${closing ? ', then the previous sound resumes' : ' (a later instruction takes over inside that span)'}. Save keeps it.`
      : '✍ The written part now plays from its instruction — the lane under the bass staff shows every hit. Save keeps it with the song.');
  }
  function setChordAtTime(at: number, symbol: string) {
    // The score's per-beat chord slots land here. '' clears the beat.
    const clean = symbol.trim();
    if (clean && !parseChord(clean)) { setEditorNotice(`"${clean}" isn't a chord symbol I can read — try C, G7, Dm7, Cmaj7, F#m, G/B.`); return; }
    pushHistory();
    setTrackSettingsDirty(current => {
      const others = (current.chord_symbols ?? []).filter(chord => Math.abs(chord.at - at) > 0.04);
      const next = clean ? [...others, { at: roundPrecise(at), symbol: clean }].sort((a, b) => a.at - b.at) : others;
      return { ...current, chord_symbols: next };
    });
    setEditorNotice(null);
  }
  const grooveSeedRef = useRef(0);
  function generateGroove() {
    // Each press dictates the NEXT vibe: chords read from the voices when
    // none exist, band instructions at the section turns, singer dynamics
    // that build, and a held final note — one undoable edit.
    const vibe = GROOVE_VIBES[grooveSeedRef.current % GROOVE_VIBES.length];
    grooveSeedRef.current += 1;
    const bandBars = musicalBars.map(bar => ({ start: bar.start, end: bar.end, beatCount: Math.max(1, bar.beats.length) }));
    const plan = planGroove(notes, bandBars, trackSettings.chord_symbols ?? [], keySignature < 0, vibe);
    if (!plan) { setEditorNotice('This song is too short to shape into sections.'); return; }
    pushHistory();
    if (plan.chords) setTrackSettingsDirty(current => ({ ...current, chord_symbols: plan.chords! }));
    setNotes(current => current.map(note => {
      const patch = plan.markPatches.find(item => item.noteId === note.id);
      if (!patch) return note;
      return { ...note, marks: { ...(note.marks ?? {}), ...patch.marks }, ...(patch.velocity !== undefined ? { velocity: patch.velocity } : {}) };
    }));
    setEditorNotice(`🎲 ${plan.summary}. Press again for the next vibe; Undo removes it; Save keeps it.`);
  }
  function applyBandToSelection(field: 'instrument' | 'drums', value: string) {
    const first = selectedNotes[0];
    if (!first) return;
    editSelectionMarks((marks, note) => {
      if (note.id !== first.id) return { marks };
      const band = { ...(marks.band ?? {}) };
      if (value) band[field] = value; else delete band[field];
      if (field === 'instrument' && value !== 'custom') delete band.instrument_tab;
      if (field === 'drums' && value !== 'custom') delete band.drum_tab;
      return { marks: { ...marks, band: band.instrument || band.drums ? band : undefined } };
    });
  }
  function applyTempoToSelection(kind: TempoMarkKind) {
    // A tempo instruction is a moment, not a range: it lands on the earliest
    // selected note and takes effect from there — rit. and accel. ramp until
    // the next tempo mark, a tempo and Allegro hold until the next.
    const first = selectedNotes[0];
    if (!first) return;
    const already = first.marks?.tempo === kind;
    editSelectionMarks((marks, note) => note.id === first.id
      ? { marks: { ...marks, tempo: already ? undefined : kind } }
      : { marks });
  }
  function applySpanToSelection(kind: 'slur' | 'cresc' | 'decresc') {
    // A span is a VOICE-level thing, so the selection is grouped by part and
    // every part with two or more selected notes gets its own span — select a
    // phrase across all four voices and the whole choir swells together. The
    // old rule took the global first and last note, which in a cross-voice
    // selection put the two ends in different parts: they never paired, and
    // nothing drew.
    const byPart = new Map<number, SongNote[]>();
    for (const note of selectedNotes) { const list = byPart.get(note.part) ?? []; list.push(note); byPart.set(note.part, list); }
    const eligible = [...byPart.values()].filter(list => list.length >= 2);
    if (!eligible.length) return;
    const roles = new Map<string, 'first' | 'last'>();
    for (const list of eligible) { roles.set(list[0].id, 'first'); roles.set(list[list.length - 1].id, 'last'); }
    const already = eligible.every(list => kind === 'slur'
      ? list[0].marks?.slur === 'start' && list[list.length - 1].marks?.slur === 'end'
      : list[0].marks?.hairpin === kind && list[list.length - 1].marks?.hairpin === 'end');
    editSelectionMarks((marks, note) => {
      const role = roles.get(note.id);
      if (kind === 'slur') return { marks: { ...marks, slur: already ? undefined : role === 'first' ? 'start' : role === 'last' ? 'end' : undefined } };
      return { marks: { ...marks, hairpin: already ? undefined : role === 'first' ? kind : role === 'last' ? 'end' : undefined } };
    });
  }
  function clearMarksOnSelection() {
    editSelectionMarks(() => ({ marks: {}, velocity: 100 }));
  }
  function removeSelected() { if (!selectedIds.length) return; pushHistory(); setNotes(current => current.filter(note => !selectedIds.includes(note.id))); setSelectedId(null); setSelectedIds([]); }
  function beginResizeHistory() { pushHistory(); }
  function beginNoteMove(id: string, clientX: number, clientY: number, additive = false) {
    const target = notes.find(note => note.id === id);
    if (!target) return;
    auditionNote(target);
    const ids = additive ? (selectedIds.includes(id) ? selectedIds.filter(item => item !== id) : [...selectedIds, id]) : selectedIds.includes(id) ? [...selectedIds] : [id];
    const initial = notes.reduce<Record<string, { midi: number; start: number; end: number }>>((values, note) => { if (ids.includes(note.id)) values[note.id] = { midi: note.midi, start: note.start, end: note.end }; return values; }, {});
    noteMoveRef.current = { originX: clientX, originY: clientY, ids: Object.keys(initial), initial, targetId: ids.includes(id) ? id : ids[0] ?? id, deltaMidi: 0, deltaTime: 0, moved: false, historyPushed: false, selectionApplied: false };
    const targetPart = target.part < 0 ? 0 : target.part;
    setSelectedPart(targetPart);
    setSelectedId(ids.includes(id) ? id : ids[0] ?? null);
    setSelectedIds(Object.keys(initial));
    setPlayScope(ids.length ? 'note' : 'all');
  }
  function moveNote(clientX: number, clientY: number) {
    const active = noteMoveRef.current;
    if (!active?.ids.length) return false;
    const targets = notes.filter(note => active.ids.includes(note.id));
    const minimumMidiDelta = Math.max(...targets.map(note => { const part = note.part < 0 ? selectedPart : note.part; return pitchRangeForPart(part, notes).min - active.initial[note.id].midi; }));
    const maximumMidiDelta = Math.min(...targets.map(note => { const part = note.part < 0 ? selectedPart : note.part; return pitchRangeForPart(part, notes).max - active.initial[note.id].midi; }));
    const requestedMidiDelta = Math.round((active.originY - clientY) / PITCH_ROW_HEIGHT);
    const deltaMidi = minimumMidiDelta <= maximumMidiDelta ? Math.max(minimumMidiDelta, Math.min(maximumMidiDelta, requestedMidiDelta)) : 0;
    const earliestStart = Math.min(...Object.values(active.initial).map(value => value.start));
    const requestedTimeDelta = (clientX - active.originX) / zoom;
    const division = musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION;
    const snappedEarliest = snapTimeToGrid(musicalBars, Math.max(0, earliestStart + requestedTimeDelta), division);
    const deltaTime = roundPrecise(snappedEarliest - earliestStart);
    if (deltaMidi === active.deltaMidi && deltaTime === active.deltaTime) return active.moved;
    if (!active.selectionApplied) {
      const target = notes.find(note => note.id === active.targetId);
      setSelectedId(active.targetId);
      setSelectedIds(active.ids);
      if (target) setSelectedPart(target.part < 0 ? selectedPart : target.part);
      setPlayScope('note');
      active.selectionApplied = true;
    }
    const candidates = targets.map(note => {
      const initial = active.initial[note.id];
      return { ...note, midi: initial.midi + deltaMidi, start: roundPrecise(initial.start + deltaTime), end: roundPrecise(initial.end + deltaTime) };
    });
    if (collisionInVoice(candidates, notes.filter(note => !active.ids.includes(note.id)))) {
      setEditorNotice('Move blocked: notes may overlap across SATB parts, but not inside the same individual voice.');
      return active.moved;
    }
    if (!active.historyPushed && (deltaMidi !== 0 || Math.abs(deltaTime) >= .001)) { pushHistory(); active.historyPushed = true; }
    active.deltaMidi = deltaMidi;
    active.deltaTime = deltaTime;
    active.moved = active.moved || deltaMidi !== 0 || Math.abs(deltaTime) >= .001;
    setNotes(current => current.map(note => {
      const initial = active.initial[note.id];
      return initial === undefined ? note : { ...note, midi: initial.midi + deltaMidi, start: roundPrecise(initial.start + deltaTime), end: roundPrecise(initial.end + deltaTime) };
    }));
    setEditorNotice(null);
    return active.moved;
  }
  function endNoteMove() { const moved = Boolean(noteMoveRef.current?.moved); noteMoveRef.current = null; return moved; }
  function resizeNote(id: string, end: number) {
    setNotes(current => {
      const target = current.find(note => note.id === id);
      if (!target) return current;
      const division = musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION;
      const step = snapStepAt(musicalBars, target.start, division);
      const nextEnd = Math.max(roundPrecise(target.start + step), snapTimeToGrid(musicalBars, end, division));
      const delta = roundPrecise(nextEnd - target.end);
      if (!delta) return current;
      // Ripple only the edited voice. Other SATB parts remain independent and may harmonically overlap.
      return current.map(note => {
        if (note.id === id) return remapNoteExpression(note, note.start, nextEnd);
        if (note.part === target.part && note.start >= target.end - .001) return { ...note, start: Math.max(0, roundPrecise(note.start + delta)), end: Math.max(step, roundPrecise(note.end + delta)) };
        return note;
      });
    });
  }
  function clearPlaybackSelections() { setPlayScope('all'); setPlayParts([true, true, true, true]); setPlayRange({ start: 0, end: 8 }); setRangeParts(null); setSelectedId(null); setSelectedIds([]); }
  function selectAllVoices() { clearPlaybackSelections(); haltPlaybackEngine(); setTransportPosition(0); setIsPaused(false); }
  function selectPlayPart(part: number, additive = false) { setPlayParts(current => additive ? current.map((enabled, index) => index === part ? !enabled : enabled) : VOICES.map((_, index) => index === part)); setPlayScope('all'); setRangeParts(null); setSelectedId(null); setSelectedIds([]); haltPlaybackEngine(); setTransportPosition(0); setIsPaused(false); focusVoice(part); }
  function beginLasso(event: React.PointerEvent<HTMLDivElement>) {
    if (tool !== 'select' || event.button !== 0 || (event.target as HTMLElement).closest('[data-note-id]')) return;
    lassoRef.current = { originX: event.clientX, originY: event.clientY, additive: event.ctrlKey || event.metaKey, baseIds: event.ctrlKey || event.metaKey ? [...selectedIds] : [], moved: false };
    // Do not capture a plain pointer-down: Draw mode still needs the lane's
    // ensuing click to create a note. Capture only after this becomes a drag.
    setLassoBox(null);
  }
  function moveLasso(event: React.PointerEvent<HTMLDivElement>) {
    const active = lassoRef.current;
    if (!active) return;
    const dx = event.clientX - active.originX;
    const dy = event.clientY - active.originY;
    if (!active.moved && Math.hypot(dx, dy) < LASSO_THRESHOLD) return;
    if (!active.moved && !event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    active.moved = true;
    const containerBounds = event.currentTarget.getBoundingClientRect();
    const selectionBounds = { left: Math.min(active.originX, event.clientX), right: Math.max(active.originX, event.clientX), top: Math.min(active.originY, event.clientY), bottom: Math.max(active.originY, event.clientY) };
    setLassoBox({ left: selectionBounds.left - containerBounds.left, top: selectionBounds.top - containerBounds.top, width: selectionBounds.right - selectionBounds.left, height: selectionBounds.bottom - selectionBounds.top });
    const intersected = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-note-id]')).filter(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.right >= selectionBounds.left && bounds.left <= selectionBounds.right && bounds.bottom >= selectionBounds.top && bounds.top <= selectionBounds.bottom;
    }).map(element => element.dataset.noteId).filter((id): id is string => Boolean(id));
    const ids = Array.from(new Set([...active.baseIds, ...intersected]));
    setSelectedIds(ids);
    setSelectedId(ids[0] ?? null);
    const first = notes.find(note => note.id === ids[0]);
    if (first) setSelectedPart(first.part < 0 ? 0 : first.part);
    if (ids.length) setPlayScope('note');
  }
  function endLasso(event: React.PointerEvent<HTMLDivElement>) {
    const active = lassoRef.current;
    if (!active) return;
    if (active.moved) suppressLaneClickRef.current = true;
    else if (tool === 'select') {
      const bounds = event.currentTarget.getBoundingClientRect();
      clearPlaybackSelections();
      seekFromTimeline(Math.max(0, (event.clientX - bounds.left - TIMELINE_LABEL_WIDTH) / zoom));
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    lassoRef.current = null;
    setLassoBox(null);
  }
  function handleLaneClick(part: number, event: React.MouseEvent<HTMLDivElement>) {
    if (suppressLaneClickRef.current) { suppressLaneClickRef.current = false; return; }
    if (tool === 'erase') clearPlaybackSelections();
  }
  // The Draw tool is gone — one mode does everything. In the grid, a
  // double-click on empty lane space writes a note there.
  function handleLaneDoubleClick(part: number, event: React.MouseEvent<HTMLDivElement>) {
    if (tool !== 'select' || (event.target as HTMLElement).closest('[data-note-id]')) return;
    addAt(part, event);
  }

  useEffect(() => {
    const handleClipboardShortcut = (event: KeyboardEvent) => {
      if (midiPreview || showBackingEditor || showLyricLine || showHarmony) return;
      // The rendition stage edits passes, not notes — note shortcuts would
      // silently mutate the hidden arrangement.
      if (noteView === 'rendition') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      const api = stepApiRef.current;
      const numbered: Record<string, RhythmicNoteValue> = { '7': 'whole', '6': 'half', '5': 'quarter', '4': 'eighth', '3': 'sixteenth' };
      const dotMap: Record<string, RhythmicNoteValue> = { 'whole': 'dotted-whole', 'half': 'dotted-half', 'quarter': 'dotted-quarter', 'eighth': 'dotted-eighth', 'sixteenth': 'dotted-sixteenth', 'dotted-whole': 'whole', 'dotted-half': 'half', 'dotted-quarter': 'quarter', 'dotted-eighth': 'eighth', 'dotted-sixteenth': 'sixteenth' };
      if (api.stepInput && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (numbered[key]) { event.preventDefault(); api.changeNoteValue(numbered[key]); return; }
        if (key === '.') { event.preventDefault(); const next = dotMap[api.snapValue]; if (next) api.changeNoteValue(next); return; }
        if ('abcdefg'.includes(key)) { event.preventDefault(); api.insertStepPitch(key); return; }
        if (key === 'r') { event.preventDefault(); api.restStepAdvance(); return; }
        if (key === 'arrowup' || key === 'arrowdown') { event.preventDefault(); api.nudgeSelectedPitch(key === 'arrowup' ? 1 : -1); return; }
      }
      // Outside step entry the same keys edit the SELECTION, as in MuseScore:
      // 5 turns the selected note into a crotchet, . dots it.
      if (!api.stepInput && !event.ctrlKey && !event.metaKey && !event.altKey && selectedIds.length) {
        if (numbered[key]) { event.preventDefault(); api.changeNoteValue(numbered[key]); return; }
        if (key === '.') { event.preventDefault(); const next = dotMap[api.snapValue]; if (next) api.changeNoteValue(next); return; }
      }
      if ((key === 'backspace' || key === 'delete') && selectedIds.length) { event.preventDefault(); removeSelected(); return; }
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
      if (key === 'z') { event.preventDefault(); if (event.shiftKey) api.redo(); else api.undo(); return; }
      if (key === 'y') { event.preventDefault(); api.redo(); return; }
      if (key === 'c' && selectedIds.length) { event.preventDefault(); copySelectedNotes(); }
      if (key === 'v' && noteClipboard.length) { event.preventDefault(); pasteCopiedNotes(); }
    };
    window.addEventListener('keydown', handleClipboardShortcut);
    return () => window.removeEventListener('keydown', handleClipboardShortcut);
  }, [midiPreview, noteClipboard, notes, noteView, playhead, selectedIds, showBackingEditor, showHarmony, showLyricLine]);
  function stopBackingTrack() { backingPlayGenerationRef.current += 1; if (backingStartTimerRef.current) clearTimeout(backingStartTimerRef.current); backingStartTimerRef.current = null; backingMediaRef.current?.pause(); }
  function effectiveTrackClips() {
    if (trackSettings.clips !== undefined) return [...trackSettings.clips].sort((a, b) => a.timeline_start - b.timeline_start);
    const sourceEnd = trackSettings.trim_end ?? trackSettings.media_duration ?? duration;
    return mediaUrl ? [{ id: 'legacy-base', source_start: trackSettings.trim_start, source_end: Math.max(trackSettings.trim_start + .1, sourceEnd), timeline_start: trackSettings.timeline_offset }] : [];
  }
  function sourceTimeAt(timelineTime: number) {
    const clip = effectiveTrackClips().find(item => timelineTime >= item.timeline_start && timelineTime < item.timeline_start + (item.source_end - item.source_start));
    if (!clip) return null;
    const sourceTime = clip.source_start + timelineTime - clip.timeline_start;
    const skipped = trackSettings.skip_regions.find(region => sourceTime >= region.start && sourceTime < region.end);
    return skipped ? skipped.end : sourceTime;
  }
  /* Backing-track changes never went through pushHistory, so the unsaved-
     changes guard could not see them: volume, trim, skips, loops, clip
     drags and a fresh upload could all be discarded by Close without a
     question. Every mutation now funnels through this dispatcher. */
  const setTrackSettingsDirty: typeof setTrackSettings = action => { dirtyRef.current = true; setTrackSettings(action); };

  function updateTrackClips(clips: BackingTrackClip[]) {
    setTrackSettingsDirty(current => {
      const first = [...clips].sort((a, b) => a.timeline_start - b.timeline_start)[0];
      return { ...current, clips, timeline_offset: first?.timeline_start ?? current.timeline_offset, trim_start: first?.source_start ?? current.trim_start, trim_end: first?.source_end ?? current.trim_end };
    });
  }
  function startBackingTrack(timelineTime: number, transportRate: number) {
    const media = backingMediaRef.current;
    stopBackingTrack();
    if (!mediaUrl || !media) return;
    const playGeneration = backingPlayGenerationRef.current;
    const targetVolume = Math.max(0, Math.min(1, trackSettings.volume));
    media.volume = targetVolume;
    media.playbackRate = transportRate;
    const sourceTime = sourceTimeAt(timelineTime);
    const nextClip = effectiveTrackClips().find(clip => clip.timeline_start >= timelineTime);
    if (sourceTime === null && !nextClip) return;
    const play = () => { void media.play().then(() => { if (playGeneration !== backingPlayGenerationRef.current) media.pause(); else setMediaError(null); }).catch(() => { if (playGeneration === backingPlayGenerationRef.current) setMediaError('Browser blocked backing-track playback. Press Play again to allow audio.'); }); };
    if (sourceTime === null && nextClip) {
      media.currentTime = nextClip.source_start;
      media.volume = 0;
      play();
      backingStartTimerRef.current = setTimeout(() => { if (playGeneration !== backingPlayGenerationRef.current) return; media.currentTime = nextClip.source_start; media.volume = targetVolume; }, ((nextClip.timeline_start - timelineTime) / transportRate) * 1000);
    } else {
      media.currentTime = sourceTime ?? 0;
      play();
    }
  }
  function enforceBackingEdits(event: React.SyntheticEvent<HTMLAudioElement>) {
    const media = event.currentTarget;
    const skipped = trackSettings.skip_regions.find(region => media.currentTime >= region.start && media.currentTime < region.end);
    if (skipped) media.currentTime = skipped.end;
    const activeClip = playhead === null ? null : effectiveTrackClips().find(clip => playhead >= clip.timeline_start && playhead < clip.timeline_start + (clip.source_end - clip.source_start));
    if (activeClip && media.currentTime >= activeClip.source_end) media.pause();
  }
  function haltPlaybackEngine() {
    stopNoteAudition();
    transportRunningRef.current = false;
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current);
    animationFrameRef.current = null;
    playbackTimerRef.current = null;
    stopBackingTrack();
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    setIsPlaying(false);
  }
  function setTransportPosition(time: number) {
    const next = Math.max(0, Math.min(activePerformance.end, time));
    playheadRef.current = next;
    setPlayhead(next);
    return next;
  }
  function stopPlayback() { haltPlaybackEngine(); setTransportPosition(0); setIsPaused(false); clearPlaybackSelections(); }
  function pausePlayback() { if (!transportRunningRef.current) return; haltPlaybackEngine(); setIsPaused(true); }
  function finishPlayback(time: number) { haltPlaybackEngine(); setTransportPosition(time); setIsPaused(false); }
  function playbackSelection(forceAll = false) {
    const source = activePerformance.notes;
    const enabled = forceAll ? source : source.filter(note => note.part < 0 || playParts[note.part]);
    const scoped = forceAll || playScope === 'all' ? enabled : playScope === 'note' ? enabled.filter(note => selectedIds.includes(note.id)) : enabled.filter(note => note.end >= playRange.start && note.start <= playRange.end);
    const ordered = [...scoped].sort((a, b) => a.start - b.start);
    const start = forceAll || playScope === 'all' ? 0 : playScope === 'range' ? playRange.start : ordered[0]?.start ?? 0;
    const end = forceAll || playScope === 'all' ? activePerformance.end : playScope === 'range' ? Math.min(activePerformance.end, playRange.end) : Math.max(start, ...ordered.map(note => note.end));
    return { ordered, start, end };
  }
  async function startPlaybackAt(requestedTime: number, forceAll = false) {
    haltPlaybackEngine();
    const { ordered, start, end } = playbackSelection(forceAll);
    if ((!ordered.length && !mediaUrl) || end <= start) return;
    const requested = Math.max(start, Math.min(end, requestedTime));
    const first = requested >= end - .01 ? start : requested;
    const preview = ordered.filter(note => note.start <= end && note.end >= first);
    const transportRate = Math.max(.5, Math.min(1.5, trackSettings.speed));
    // The marks PLAY: hairpins ramp loudness across their span, slurs run
    // legato, fermatas hold time itself, and rit./accel./a tempo/Allegro
    // bend the clock — all through one warp table, so the cursor and the
    // tones always agree. A backing track cannot wait or bend, so with one
    // loaded time stays literal.
    const performed = interpretMarks(activePerformance.notes);
    const table = mediaUrl && noteView !== 'rendition' ? null : buildWarpTable(activePerformance.notes, end + 1);
    const w = (time: number) => table ? tableWarp(table, time) : time;
    if (preview.length) {
      const context = new AudioContext();
      audioContextRef.current = context;
      warmPiano(context);
      void context.resume();
      // Wait (briefly, capped) for the sampled piano and guitar to decode
      // before scheduling: scheduling picks sample-or-synth at call time,
      // so the old same-tick scheduling meant the preview NEVER used the
      // real recordings — every play fell back to synthesis.
      await Promise.race([samplesReady(context), new Promise(resolve => setTimeout(resolve, 1500))]);
      if (audioContextRef.current !== context || context.state === 'closed') return;
      // One timing rule for every renderer, so the AI singer, the choir and
      // the piano land on identical clocks.
      const timingOf = (note: SongNote) => {
        const audibleStart = Math.max(note.start, first);
        const at = (w(audibleStart) - w(first)) / transportRate;
        const hold = performed.holds.find(item => table && Math.abs(item.at - note.end) < 0.12);
        let length = Math.max(.07, (hold && table ? tableWarp(table, hold.at) : w(Math.min(note.end, end))) - w(audibleStart));
        if (!hold && note.marks?.staccato) length = Math.max(.05, length * 0.5);
        else if (!hold && performed.legato.has(note.id)) length = Math.max(length, w(performed.nextStart.get(note.id) ?? note.end) - w(audibleStart));
        else if (!hold && note.marks?.tenuto) length *= 1.04;
        return { at, length };
      };
      // REAL singers first: a part with an active sung take is carried by
      // the recording — the church's own voice — and the choir and the AI
      // both stay away from it.
      const activeTakes = (trackSettings.vocal_takes ?? []).filter(take => take.active !== false);
      let sungTakes: Array<{ take: VocalTake; buffer: AudioBuffer }> = [];
      if (activeTakes.length) {
        const firstLoad = activeTakes.some(take => !takeBufferCache.has(take.url));
        if (firstLoad) setEditorNotice('Loading the sung guides…');
        const loaded = await Promise.all(activeTakes.map(async take => ({ take, buffer: await loadTakeBuffer(take.url) })));
        if (audioContextRef.current !== context || (context.state as string) === 'closed') return;
        sungTakes = loaded.filter((item): item is { take: VocalTake; buffer: AudioBuffer } => item.buffer !== null);
        if (firstLoad) setEditorNotice(sungTakes.length ? null : 'The sung guides could not load — the choir sings this pass.');
      }
      const partsSung = new Set(sungTakes.map(item => Math.max(0, Math.min(3, item.take.part))));
      // The AI CHOIR prepares before anything is scheduled, so the words,
      // the band and any synth voices all start on the same clock. Every
      // part that carries lyrics is sung \u2014 female voice on soprano and
      // alto, male on tenor and bass; parts without words stay synth.
      let singerPreparedByPart: Map<number, Array<{ at: number; buffer: AudioBuffer } | null>> | null = null;
      if (previewVoice === 'singer') {
        try {
          const partOf = (note: SongNote) => (note.part === -1 ? 0 : note.part);
          const partsWithWords = [0, 1, 2, 3].filter(p => !partsSung.has(p) && preview.some(note => partOf(note) === p && (note.lyric ?? '').trim()));
          const kinds = [...new Set(partsWithWords.map(p => voiceKindForPart(p)))];
          if (partsWithWords.length && !(await singerVoiceReady(kinds))) {
            setEditorNotice('Downloading the demo choir\u2019s voices \u2014 one time, kept on this device\u2026');
            await downloadSingerVoice(kinds, (label, pct) => setEditorNotice(`Downloading the ${label} voice\u2026 ${pct}%`));
          }
          const byPart = new Map<number, Array<{ at: number; buffer: AudioBuffer } | null>>();
          for (const p of partsWithWords) {
            const line = preview
              .filter(note => partOf(note) === p)
              .sort((a, b) => a.start - b.start)
              .map(note => {
                const { at, length } = timingOf(note);
                return { midi: note.midi, at, seconds: length / transportRate, lyric: note.lyric ?? '' };
              });
            byPart.set(p, await prepareSingerBuffers(context, line, voiceKindForPart(p), message => setEditorNotice(message)));
          }
          if (audioContextRef.current !== context || (context.state as string) === 'closed') return;
          singerPreparedByPart = byPart.size ? byPart : null;
        } catch {
          singerPreparedByPart = null;
          setEditorNotice('The demo choir could not start \u2014 the synth choir sings this pass.');
        }
      }
      preview.forEach(note => {
        const audibleStart = Math.max(note.start, first);
        const at = (w(audibleStart) - w(first)) / transportRate;
        // Lengths live in performance time now, so a ritardando's notes are
        // genuinely broader and a held note sounds through its pause.
        const hold = performed.holds.find(item => table && Math.abs(item.at - note.end) < 0.12);
        // w(hold.at) already lands AFTER the pause — the held note's sound
        // reaches through it without counting the hold twice.
        let length = Math.max(.07, (hold && table ? tableWarp(table, hold.at) : w(Math.min(note.end, end))) - w(audibleStart));
        if (!hold && note.marks?.staccato) length = Math.max(.05, length * 0.5);
        else if (!hold && performed.legato.has(note.id)) length = Math.max(length, w(performed.nextStart.get(note.id) ?? note.end) - w(audibleStart));
        else if (!hold && note.marks?.tenuto) length *= 1.04;
        const velocity = performed.velocity.get(note.id);
        const played = velocity !== undefined ? { ...note, velocity } : note;
        // A slide mark bends this note's tail into the NEXT note of the
        // same voice — the sung portamento, audible in the preview.
        const slideTarget = note.marks?.slide
          ? activePerformance.notes.filter(item => item.part === note.part && item.id !== note.id && item.start >= note.end - 0.05).sort((a, b) => a.start - b.start)[0]?.midi
          : undefined;
        if (partsSung.has(note.part === -1 ? 0 : note.part)) return;   // a real singer carries this part
        if (singerPreparedByPart && singerPreparedByPart.has(note.part === -1 ? 0 : note.part)) return;   // the AI choir carries this part
        const toned = singerPreparedByPart ? { ...played, velocity: Math.round(played.velocity * 0.55) } : played;
        if (previewVoices) playVoice(context, toned, context.currentTime + at, length / transportRate, slideTarget);
        else playPianoTone(context, toned, context.currentTime + at, length / transportRate);
      });
      if (singerPreparedByPart) {
        const base = context.currentTime;
        for (const [p, prepared] of singerPreparedByPart) {
          playSingerBuffers(context, prepared.map(item => item && { at: base + item.at, buffer: item.buffer }), p === 0 ? 0.9 : 0.55);
        }
      }
      // The sung takes play as recorded: real time, no warp — a recording
      // cannot wait or bend any more than the backing track can.
      for (const { take, buffer } of sungTakes) {
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = transportRate;
        const gainNode = context.createGain();
        gainNode.gain.value = take.gain ?? 0.9;
        source.connect(gainNode);
        gainNode.connect(mixBus(context));
        const lead = (take.start - first) / transportRate;
        if (lead >= 0) source.start(context.currentTime + lead);
        else if (-lead < buffer.duration) source.start(context.currentTime, -lead);
      }
      // ---- the band: the SAVED guitar and drum styles, on the same warped
      // clock as the voices — what plays here is what the room will hear.
      // Like practice and the round: a real backing track fills the space,
      // so the synthesized band stands down rather than playing over it.
      if (noteView !== 'rendition' && !mediaUrl) {
        const lastSound = activePerformance.notes.reduce((latest, note) => Math.max(latest, note.end), 0);
        const bandBars = musicalBars.map(bar => ({ start: bar.start, end: bar.end, beatCount: Math.max(1, bar.beats.length) }));
        // Events are built in PERFORMANCE time (the same warp as the voices),
        // so a strum before a fermata rings through the pause and the beat
        // broadens with a ritardando. Loudness follows the choir's dynamics
        // and hairpins via the interpreted velocities.
        const events = buildBandEvents({
          bars: bandBars, chords: trackSettings.chord_symbols ?? [],
          notes: activePerformance.notes,
          defaults: { instrument: accompaniment.guitar as InstrumentStyleId, drums: accompaniment.drums as DrumStyleId },
          until: Math.min(end, lastSound + .1),
          warp: w,
          effectiveVelocity: performed.velocity,
          customTabs: { instrument: accompaniment.instrument_tab, drums: accompaniment.drum_tab },
          tracks: trackSettings.band_tracks,
        });
        const windowFrom = w(first) - .01, windowTo = w(end);
        for (const event of events) {
          if (event.at < windowFrom || event.at >= windowTo) continue;
          playBandEvent(context, event, context.currentTime + (event.at - w(first)) / transportRate);
        }
      }
    }
    // The backing track belongs to the song as recorded; a compiled
    // rendition has its own timeline, so the track stays silent there.
    if (noteView !== 'rendition') startBackingTrack(first, transportRate);
    setTransportPosition(first);
    setIsPaused(false);
    const startedAt = performance.now();
    const tick = () => {
      if (!transportRunningRef.current) return;
      const perfNow = w(first) + ((performance.now() - startedAt) / 1000) * transportRate;
      const next = Math.min(end, table ? tableUnwarp(table, perfNow) : perfNow);
      playheadRef.current = next;
      setPlayhead(next);
      if (next < end) animationFrameRef.current = requestAnimationFrame(tick);
    };
    transportRunningRef.current = true;
    setIsPlaying(true);
    tick();
    playbackTimerRef.current = setTimeout(() => finishPlayback(end), Math.max(.1, (w(end) - w(first)) / transportRate) * 1000 + 80);
  }
  function playFromCursor() { void startPlaybackAt(playheadRef.current); }
  function playFromStart() { const selection = playbackSelection(); void startPlaybackAt(selection.start); }
  function seekTransport(time: number, forceAll = false) {
    const wasPlaying = transportRunningRef.current;
    haltPlaybackEngine();
    const next = setTransportPosition(time);
    setIsPaused(false);
    if (wasPlaying) void startPlaybackAt(next, forceAll);
  }
  function seekFromTimeline(time: number) { clearPlaybackSelections(); seekTransport(time, true); }
  function skipTransport(seconds: number) { seekTransport(playheadRef.current + seconds); }
  async function toggleRecording() {
    if (recording) { recorderRef.current?.stop(); return; }
    setRecordError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Recording is not supported in this browser.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
      const recorder = new MediaRecorder(stream);
      setRecordingPart(Math.max(0, Math.min(3, selectedPart)));
      setRecordingTimelineOffset(Math.max(0, playheadRef.current));
      recorderChunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size) recorderChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        const take = new Blob(recorderChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (take.size) {
          setRecordingTake(take);
          setRecordingUrl(previous => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(take); });
          setTranscriptionDiagnostics(null);
          setEditorNotice(`Vocal take captured. Review it, choose its destination voice and timing treatment, then convert the monophonic recording into editable timeline notes.`);
        }
        setRecording(false);
        recorderRef.current = null;
      };
      recorderRef.current = recorder;
      // Chunked delivery (1 s slices): a take can run for HOURS without the
      // browser holding one giant buffer hostage until stop.
      recorder.start(1000);
      setRecording(true);
    } catch (error) { setRecordError(error instanceof Error ? error.message : 'Unable to access the microphone.'); setRecording(false); }
  }
  function playRecordedTake() { if (recordingUrl) void new Audio(recordingUrl).play(); }
  /** The take stays AUDIO: the singer's own voice becomes that part's sung
   *  guide in the preview, aligned where the playhead stood when recording
   *  began. Upload rides the same signed-URL route as the backing track. */
  async function keepRecordedTake() {
    if (!recordingTake || uploadingTake) return;
    setRecordError(null);
    setUploadingTake(true);
    try {
      const extension = (recordingTake.type.split(';')[0].split('/')[1] || 'webm').replace(/[^a-z0-9]/gi, '');
      const fileName = `sung-take-${VOICES[recordingPart].toLowerCase()}-${Date.now()}.${extension}`;
      const prepared = await fetch('/api/vocal-hero/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ songId: song.id, fileName, contentType: recordingTake.type || 'audio/webm', size: recordingTake.size }) });
      const payload = await prepared.json() as { bucket?: string; path?: string; token?: string; publicUrl?: string; error?: string };
      if (!prepared.ok || !payload.bucket || !payload.path || !payload.token || !payload.publicUrl) throw new Error(payload.error || 'Unable to prepare the take upload.');
      const { error } = await supabase.storage.from(payload.bucket).uploadToSignedUrl(payload.path, payload.token, recordingTake);
      if (error) throw new Error(error.message);
      const url = payload.publicUrl;
      setTrackSettingsDirty(current => ({
        ...current,
        vocal_takes: [
          ...(current.vocal_takes ?? []),
          { id: crypto.randomUUID(), part: recordingPart, url, start: recordingTimelineOffset, active: true },
        ],
      }));
      setEditorNotice(`${VOICES[recordingPart]} sung guide saved — the preview now plays this real voice for that part. Press Save to keep it with the song.`);
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : 'Unable to save the sung take.');
    } finally {
      setUploadingTake(false);
    }
  }
  async function convertRecordedTake() {
    if (!recordingTake || transcribingTake) return;
    setRecordError(null);
    setTranscribingTake(true);
    try {
      const context = new AudioContext();
      const decoded = await context.decodeAudioData(await recordingTake.arrayBuffer());
      await context.close();
      const range = pitchRangeForPart(recordingPart, notes);
      const result = await detectVocalNotes(decoded, { part: recordingPart, timelineOffset: recordingTimelineOffset, minMidi: range.min, maxMidi: range.max });
      const detected = result.notes;
      setTranscriptionDiagnostics(result.diagnostics);
      if (!detected.length) throw new Error(`No stable pitches were detected inside the ${VOICES[recordingPart]} range (${midiNoteName(range.min)}–${midiNoteName(range.max)}). Choose the correct destination voice or record a clean, unaccompanied solo closer to the microphone.`);
      const division = musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION;
      const accepted: SongNote[] = [];
      let skipped = 0;
      for (const raw of detected) {
        const candidate = transcriptionSnap ? quantizeNote(raw, musicalBars, division) : raw;
        if (collisionInVoice([candidate], [...notes, ...accepted])) skipped += 1;
        else accepted.push(candidate);
      }
      if (!accepted.length) throw new Error(`The take produced ${detected.length} pitches at ${Math.round(result.diagnostics.averageConfidence * 100)}% mean confidence, but they overlap existing ${VOICES[recordingPart]} notes. Move the playhead to a clear range or remove those notes first.`);
      pushHistory();
      setNotes(current => [...current, ...accepted].sort((a, b) => a.start - b.start || a.part - b.part));
      setSelectedIds(accepted.map(note => note.id));
      setSelectedId(accepted[0].id);
      setSelectedPart(recordingPart);
      setTool('select');
      const pitchSpan = result.diagnostics.lowestMidi === null || result.diagnostics.highestMidi === null ? '' : ` Pitch range ${midiNoteName(result.diagnostics.lowestMidi)}–${midiNoteName(result.diagnostics.highestMidi)}.`;
      const rejected = result.diagnostics.rejectedOutOfRangeFrames ? ` ${result.diagnostics.rejectedOutOfRangeFrames} out-of-range analysis frames were rejected instead of being clamped to a false boundary note.` : '';
      setEditorNotice(`Converted ${accepted.length} editable ${VOICES[recordingPart]} note${accepted.length === 1 ? '' : 's'} at ${formatClock(recordingTimelineOffset)} using ${transcriptionSnap ? 'grid-snapped' : 'measured performance'} timing. YIN analysis resolution ${result.diagnostics.timingResolutionMs.toFixed(1)} ms; mean confidence ${Math.round(result.diagnostics.averageConfidence * 100)}%; ${result.diagnostics.expressiveNotes} note${result.diagnostics.expressiveNotes === 1 ? '' : 's'} captured with pitch movement or vibrato.${pitchSpan}${rejected}${skipped ? ` ${skipped} overlapping detection${skipped === 1 ? ' was' : 's were'} skipped.` : ''} Add lyrics, audition the expressive notes against the take, then Save.`);
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : 'Unable to convert this vocal take into notes.');
    } finally {
      setTranscribingTake(false);
    }
  }
  async function save() { setSaving(true); try { await onSave({ id: song.id, title: title.trim() || song.title, notes: [...notes].sort((a, b) => a.start - b.start).map(note => ({ ...note, start: Math.max(0, roundPrecise(note.start)), end: Math.max(roundPrecise(note.start) + .001, roundPrecise(note.end)) })), timed_lyrics: timedLyrics.map(section => ({ ...section, primary: section.primary.trim(), translation: section.translation.trim(), start: Math.max(0, roundPrecise(section.start)), end: Math.max(roundPrecise(section.start) + .01, roundPrecise(section.end)) })).filter(section => section.primary), backing_media_url: mediaUrl || undefined, backing_media_kind: mediaUrl ? mediaKind : undefined, backing_track_settings: { ...trackSettings, karaoke_lyrics: { targets_per_phrase: trackSettings.karaoke_lyrics?.targets_per_phrase ?? DEFAULT_TARGETS_PER_PHRASE, max_lines: trackSettings.karaoke_lyrics?.max_lines ?? 2, source: trackSettings.karaoke_lyrics?.source ?? 'notes' }, musical_timeline: musicalTimeline } }); dirtyRef.current = false; } catch (cause) { setEditorNotice(`Save FAILED — nothing was stored: ${cause instanceof Error ? cause.message : 'unknown error'}. Check the connection and press Save again.`); } finally { setSaving(false); } }
  async function uploadBackingTrack(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMediaError(null);
    setUploadingMedia(true);
    try {
      if (!/^(audio|video)\//.test(file.type)) throw new Error('Choose an audio or video file for the backing track.');
      const prepared = await fetch('/api/vocal-hero/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ songId: song.id, fileName: file.name, contentType: file.type, size: file.size }) });
      const payload = await prepared.json() as { bucket?: string; path?: string; token?: string; publicUrl?: string; error?: string };
      if (!prepared.ok || !payload.bucket || !payload.path || !payload.token || !payload.publicUrl) throw new Error(payload.error || 'Unable to prepare the media upload.');
      const { error } = await supabase.storage.from(payload.bucket).uploadToSignedUrl(payload.path, payload.token, file);
      if (error) throw new Error(error.message);
      dirtyRef.current = true;
      setMediaUrl(payload.publicUrl);
      setMediaKind(file.type.startsWith('video/') ? 'video' : 'audio');
      setMediaName(file.name);
      setTrackSettings(current => ({ ...current, trim_start: 0, trim_end: null, timeline_offset: 0, loop_start: 0, loop_end: null, skip_regions: [], split_markers: [], clips: undefined, media_duration: null }));
    } catch (error) { setMediaError(error instanceof Error ? error.message : 'Unable to upload the backing track.'); }
    finally { setUploadingMedia(false); }
  }
  async function openMidi(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMidiError(null);
    try {
      const parsed = parseMidiNotes(await file.arrayBuffer());
      if (!parsed.length) throw new Error('No completed MIDI note events were found in this file.');
      // A file with several tracks is almost always one voice per track --
      // choir and SATB exports -- so each track defaults to the voice its
      // MEDIAN pitch suggests, whole. A single-track file is usually a piano
      // reduction, where splitting each note by range is the useful default.
      // Previously the label promised the median assignment while auto mode
      // silently split every track note-by-note.
      const sources = new Map<string, ImportedMidiNote[]>();
      for (const note of parsed) {
        const key = midiSourceKey(note);
        sources.set(key, [...(sources.get(key) ?? []), note]);
      }
      const defaults: Record<string, number> = {};
      if (sources.size > 1) {
        const bounds = normaliseSatbMidiRanges(midiRanges);
        for (const [key, notesForSource] of sources) defaults[key] = suggestedPartFor(notesForSource, bounds);
      }
      setMidiSourceParts(defaults);
      setMidiPreview({ fileName: file.name, notes: parsed });
    } catch (error) { setMidiError(error instanceof Error ? error.message : 'Unable to read this MIDI file.'); }
  }
  /* MusicXML brings what MIDI cannot: which voice each note belongs to, and
     the words already broken into syllables. So there is nothing to guess --
     the review below is a confirmation, not a reconstruction. */
  async function openMusicXml(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMidiError(null);
    try {
      const result = parseMusicXml(await readMusicXmlFile(file));
      setXmlMapping(Object.fromEntries(result.sources.map(source => [source.key, source.suggestedPart])));
      setXmlPreview({ fileName: file.name, result });
    } catch (error) { setMidiError(error instanceof Error ? error.message : 'Unable to read this MusicXML file.'); }
  }
  function applyXmlImport() {
    if (!xmlPreview) return;
    const imported = assignXmlParts(xmlPreview.result.notes, xmlMapping, () => `note-${crypto.randomUUID()}`);
    const merged = xmlMode === 'replace' ? imported : [...notes, ...imported];
    const resolved = resolveOverlapsPreservingRhythm(merged);
    pushHistory();
    setNotes(resolved.notes);
    setSelectedIds(imported.map(note => note.id));
    setSelectedId(imported[0]?.id ?? null);
    setSelectedPart(imported[0]?.part ?? 0);
    setXmlPreview(null);
    setTool('select');
    const { result } = xmlPreview;
    setEditorNotice(
      `Imported ${imported.length} notes from ${result.title || xmlPreview.fileName}` +
      (result.lyricCount ? ` with ${result.lyricCount} syllables already attached` : ', though the score carried no lyrics') +
      `. Written tempo ${Math.round(result.bpm)} bpm` +
      (resolved.trimmed ? `; ${resolved.trimmed} note${resolved.trimmed === 1 ? ' was' : 's were'} shortened where they overlapped the next` : '') +
      '.' + (result.warnings.length ? ' ' + result.warnings.join(' ') : ''));
  }
  function applyMidiImport() {
    if (!midiPreview) return;
    const imported = assignMidiParts(midiPreview.notes, normaliseSatbMidiRanges(midiRanges), midiPart, midiSourceParts);
    const division = musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION;
    const merged = midiMode === 'replace' ? imported : [...notes, ...imported];
    const resolved = resolveOverlapsPreservingRhythm(merged);
    pushHistory();
    setNotes(resolved.notes);
    setSelectedIds(imported.map(note => note.id));
    setSelectedId(imported[0]?.id ?? null);
    setSelectedPart(imported[0]?.part ?? 0);
    setMidiPreview(null);
    setTool('select');
    setEditorNotice(
      `Imported ${imported.length} note${imported.length === 1 ? '' : 's'} at their exact MIDI times. ` +
      `Every start is as played, so runs, fills and glissandi keep their rhythm` +
      (resolved.trimmed ? `; ${resolved.trimmed} note${resolved.trimmed === 1 ? ' was' : 's were'} shortened where they overlapped the next` : '') +
      (resolved.stacked ? `. ${resolved.stacked} note${resolved.stacked === 1 ? ' shares a start' : 's share a start'} with another in the same voice — a chord one voice cannot sing, kept for you to split or delete` : '') + '.');
  }

  // Switching what the transport performs mid-flight would leave the engine
  // playing one thing while the page shows another — stop first, always.
  function switchView(view: 'score' | 'grid' | 'rendition') {
    if (view === noteView) return;
    stopPlayback();
    setNoteView(view);
  }
  function applyRendition() {
    renditionAppliedRef.current = true;
    pushHistory();
    stopPlayback();
    setNotes(compiledRendition.notes);
    setTimedLyrics(compiledRendition.timedLyrics);
    // The compiled bars come with their own tempo map (broader and brighter
    // passes change bpm exactly on their opening barline) — hand it to the
    // editor so its grid agrees with every pass.
    setMusicalTimeline(current => ({ ...current, tempo_changes: compiledRendition.tempoEvents.map(event => ({ at: event.at, bpm: event.bpm })) }));
    setSelectedIds([]);
    setSelectedId(null);
    setNoteView('score');
    setEditorNotice('Rendition loaded into the note editor for fine-tuning. Undo brings the original arrangement back. Saving from here overwrites THIS song — use the rendition stage’s “Save as a new song” to keep both.');
  }
  async function saveRenditionAsNew(newTitle: string) {
    setSavingRendition(true);
    try {
      const stub = await createSongStub({ title: newTitle, artist: song.artist ?? undefined, tags: song.tags ?? undefined });
      await updateSong(stub.id, {
        notes: compiledRendition.notes, timed_lyrics: compiledRendition.timedLyrics, duration: compiledRendition.duration,
        bpm: compiledRendition.tempoEvents[0]?.bpm ?? song.bpm, time_sig: song.time_sig, status: 'ready',
        arranged_by: `Our rendition, arranged from “${song.title}”`,
        ...(compiledRendition.tempoEvents.length > 1 ? {
          backing_track_settings: {
            ...DEFAULT_TRACK_SETTINGS,
            musical_timeline: {
              tempo_changes: compiledRendition.tempoEvents.map(event => ({ at: event.at, bpm: event.bpm })),
              meter_changes: [{ at: 0, numerator: baseMusicalState.numerator, denominator: 4 }],
              key_changes: [{ at: 0, tonic: baseMusicalState.tonic, mode: baseMusicalState.mode }],
              snap_division: musicalTimeline.snap_division,
              snap_value: musicalTimeline.snap_value,
            },
          },
        } : {}),
      });
      onSongCreated?.();
    } finally {
      setSavingRendition(false);
    }
  }
  return <div ref={editorRootRef} data-timeline-focus={timelineFocus ? 'true' : 'false'} className="vh-editor-scrollbars fixed inset-0 z-50 overflow-hidden bg-[#020510] text-slate-100">
    <audio ref={backingMediaRef} src={mediaUrl || undefined} preload="auto" className="hidden" onLoadedMetadata={event => { const media_duration = event.currentTarget.duration; if (Number.isFinite(media_duration)) setTrackSettings(current => current.media_duration === media_duration ? current : { ...current, media_duration }); }} onTimeUpdate={enforceBackingEdits} />
    <header className={`${timelineFocus ? 'hidden' : 'flex'} min-h-14 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-white/10 bg-[#070a1b] px-4 py-1.5`}>
      <Brand />
      <span className="hidden text-[10px] font-black uppercase tracking-[.2em] text-fuchsia-300 sm:block">Song Editor</span>
      <span className="flex min-w-0 items-center gap-2">
        <input value={title} onChange={event => { dirtyRef.current = true; setTitle(event.target.value); }} aria-label="Song title" className="w-64 max-w-[38vw] truncate border-0 bg-transparent text-sm font-semibold text-white outline-none" />
        <span aria-hidden="true" className="text-fuchsia-300">✎</span>
      </span>
      <span className={`hidden rounded-full px-2.5 py-1 text-[10px] font-bold md:block ${dirtyRef.current ? 'border border-amber-300/30 bg-amber-300/10 text-amber-200' : 'border border-emerald-300/25 bg-emerald-300/[.07] text-emerald-300'}`}>{dirtyRef.current ? '● Unsaved changes' : '✓ Saved'}</span>
      <div className="ml-auto flex items-center gap-2">
        <button onClick={() => void save()} disabled={saving} className="rounded-lg bg-[linear-gradient(120deg,#d946ef,#22d3ee)] px-4 py-2 text-xs font-black text-[#08101d] disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={() => switchView(noteView === 'rendition' ? 'score' : 'rendition')} aria-pressed={noteView === 'rendition'} title="Shape the performance: passes, keys, tempos — over the live score" className={`rounded-lg border px-3 py-2 text-xs font-semibold ${noteView === 'rendition' ? 'border-cyan-300/70 bg-cyan-300/20 text-cyan-50' : 'border-cyan-300/35 bg-cyan-300/[.07] text-cyan-100'}`}>⟳ Rendition</button>
        <button onClick={() => void toggleFullscreen()} aria-pressed={isFullscreen} title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'} className="rounded-lg border border-white/15 px-3 py-2 text-xs">{isFullscreen ? '⊙' : '⛶'}</button>
        <button onClick={() => void closeOrExitFullscreen()} title={isFullscreen ? 'Exit full screen without closing the editor' : 'Close the song editor'} className="rounded-lg border border-white/15 px-3 py-2 text-xs">Close</button>
      </div>
    </header>
    <div className={`flex ${timelineFocus ? 'h-screen min-h-0' : 'h-[calc(100vh-64px)] min-h-[620px]'} overflow-auto`}>
      <aside className="hidden w-56 shrink-0 border-r border-white/10 bg-[#070b1e] p-3 lg:block">
        <p className="text-[10px] font-black uppercase tracking-[.18em] text-slate-500">Voices</p>
        <div className="mt-2 space-y-2">{VOICES.map((voice, index) => {
          const audible = playScope === 'all' && playParts[index];
          return <div key={voice} onClick={() => focusVoice(index)} role="button" tabIndex={0}
            className="cursor-pointer rounded-xl border p-3 transition"
            style={{ borderColor: selectedPart === index ? COLOURS[index] : '#ffffff14', background: selectedPart === index ? `${COLOURS[index]}12` : '#060917', boxShadow: selectedPart === index ? `0 0 18px ${COLOURS[index]}22` : undefined }}>
            <div className="flex items-center gap-2">
              <b className="text-xl leading-none" style={{ color: COLOURS[index] }}>{voice[0]}</b>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-xs text-white">{voice}</b>
                <small className="text-[9px] text-slate-500">{selectedPart === index ? '● editing' : audible ? 'plays' : 'muted'}</small>
              </span>
              <button onClick={event => { event.stopPropagation(); selectPlayPart(index, true); }}
                title={audible ? `Mute ${voice} during playback` : `Unmute ${voice}`}
                className={`rounded-lg border px-2 py-1 text-xs ${audible ? 'border-white/20 text-white' : 'border-white/10 text-slate-600'}`}>{audible ? '🔊' : '🔇'}</button>
            </div>
          </div>; })}
        </div>
        {noteView !== 'rendition' && <button onClick={() => addNote()} className="mt-3 w-full rounded-lg border border-dashed border-fuchsia-400/40 px-3 py-2 text-xs text-fuchsia-300">＋ Add note in {VOICES[selectedPart] ?? 'voice'}</button>}
        <button onClick={selectAllVoices} className="mt-2 w-full rounded-lg border border-white/12 px-3 py-2 text-[11px] text-slate-300">🔊 All voices audible</button>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(circle_at_50%_0%,#28135055,transparent_30%),#080b1c]">
        {!timelineFocus && noteView !== 'rendition' && <EditorToolbar extras={<span className="relative flex items-center gap-1.5">
          <button onClick={cyclePreviewVoice} aria-pressed={previewVoice !== 'piano'}
            title={previewVoice === 'choir' ? 'Preview voice: recorded choir — real human voices singing every part on “ah”. Tap for the AI demo choir (pronounces the actual lyrics; one-time voice download).'
              : previewVoice === 'singer' ? 'Preview voice: AI demo choir \u2014 every part sings its own words: female voice on soprano and alto, male on tenor and bass. Tap for piano.'
              : 'Preview voice: piano. Tap for the synth choir.'}
            className={`rounded-lg border px-2.5 py-2 ${previewVoice !== 'piano' ? 'border-emerald-300/50 bg-emerald-300/10 text-emerald-100' : 'border-white/15 text-slate-300'}`}>{previewVoice === 'choir' ? '\ud83c\udfa4' : previewVoice === 'singer' ? '\ud83d\udde3\ufe0f' : '\ud83c\udfb9'}</button>
          <button onClick={() => setTrackSettingsDirty(current => ({ ...current, accompaniment: { guitar: (current.accompaniment?.guitar ?? 'off'), drums: (current.accompaniment?.drums ?? 'off') === 'off' ? 'drum-kit' : 'off' } }))} aria-pressed={accompaniment.drums !== 'off'}
            title="Drums on or off for THIS SONG — saved with it, heard in preview, practice and rounds. Pick the style (kit or cajon) under the three-dots menu."
            className={`rounded-lg border px-2.5 py-2 ${accompaniment.drums !== 'off' ? 'border-amber-300/50 bg-amber-300/10 text-amber-100' : 'border-white/15 text-slate-300'}`}>{'\ud83e\udd41'}</button>
          <button onClick={() => setMoreOpen(open => !open)} aria-expanded={moreOpen} title="Import, backing track, recording, zoom and more"
            className={`rounded-lg border px-3 py-2 font-bold ${moreOpen ? 'border-fuchsia-300/50 bg-fuchsia-300/15 text-fuchsia-100' : 'border-white/15 text-slate-200'}`}>⋯</button>
          {moreOpen && <div className="absolute right-0 top-11 z-[75] max-h-[calc(100vh-140px)] w-80 space-y-3 overflow-y-auto rounded-2xl border border-white/12 bg-[#0a0e22f8] p-3 text-xs shadow-[0_24px_70px_#000d] backdrop-blur">
            <p className="text-[9px] font-black uppercase tracking-[.2em] text-slate-500">Bring music in</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { setMoreOpen(false); xmlInputRef.current?.click(); }} title="MusicXML keeps voices and lyrics, so nothing has to be guessed" className="rounded-lg border border-emerald-300/40 bg-emerald-300/10 px-3 py-2 font-semibold text-emerald-100">Import MusicXML</button>
              <button onClick={() => { setMoreOpen(false); midiInputRef.current?.click(); }} className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 font-semibold text-cyan-100">Import MIDI</button>
              <button onClick={() => { setMoreOpen(false); mediaInputRef.current?.click(); }} disabled={uploadingMedia} className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 font-semibold text-cyan-100 disabled:opacity-40">{uploadingMedia ? 'Uploading…' : 'Backing track'}</button>
            </div>
            {mediaUrl && <p className="truncate text-slate-500">{mediaName || 'Backing track'} · synchronized with SATB</p>}
            {mediaError && <p className="text-rose-200">Backing track: {mediaError}</p>}
            <p className="text-[9px] font-black uppercase tracking-[.2em] text-slate-500">Record a take</p>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => void toggleRecording()} className={`rounded-lg border px-3 py-2 ${recording ? 'border-rose-300 bg-rose-500/20 text-rose-100' : 'border-white/12 text-rose-300'}`}>{recording ? '■ Stop recording' : '● Record'}</button>
              {recordingUrl && <>
                <button onClick={playRecordedTake} className="rounded-lg border border-emerald-300/30 px-3 py-2 text-emerald-200">Play take</button>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-slate-500">Put in
                  <select aria-label="Transcription destination voice" value={recordingPart} onChange={event => { setRecordingPart(Number(event.target.value)); setTranscriptionDiagnostics(null); setRecordError(null); }} className="rounded border border-white/15 bg-black/30 px-1.5 py-1 text-[11px] text-white">{VOICES.map((voice, index) => <option key={voice} value={index}>{voice}</option>)}</select></label>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-slate-500">Timing
                  <select aria-label="Transcription timing treatment" value={transcriptionSnap ? 'grid' : 'exact'} onChange={event => setTranscriptionSnap(event.target.value === 'grid')} className="rounded border border-white/15 bg-black/30 px-1.5 py-1 text-[11px] text-white"><option value="grid">Snap to grid</option><option value="exact">As sung</option></select></label>
                <button onClick={() => void convertRecordedTake()} disabled={transcribingTake} className="rounded-lg border border-fuchsia-300/40 bg-fuchsia-300/10 px-3 py-2 font-semibold text-fuchsia-100 disabled:opacity-40">{transcribingTake ? 'Detecting…' : 'Take → notes'}</button>
                <button onClick={() => void keepRecordedTake()} disabled={uploadingTake}
                  title="Keep the take as AUDIO: this real voice sings its part in the preview, aligned where the playhead stood when recording began."
                  className="rounded-lg border border-emerald-300/40 bg-emerald-300/10 px-3 py-2 font-semibold text-emerald-100 disabled:opacity-40">{uploadingTake ? 'Saving…' : 'Keep as sung guide'}</button>
              </>}
            </div>
            {(trackSettings.vocal_takes ?? []).length > 0 && <>
              <p className="text-[9px] font-black uppercase tracking-[.2em] text-slate-500">Sung guides — real voices in the preview</p>
              <div className="space-y-1">
                {(trackSettings.vocal_takes ?? []).map(take => <div key={take.id} className="flex items-center gap-2 text-[11px]">
                  <label className="flex flex-1 items-center gap-1.5 text-slate-300">
                    <input type="checkbox" checked={take.active !== false}
                      onChange={event => setTrackSettingsDirty(current => ({ ...current, vocal_takes: (current.vocal_takes ?? []).map(item => item.id === take.id ? { ...item, active: event.target.checked } : item) }))} />
                    {VOICES[Math.max(0, Math.min(3, take.part))]} · from {formatClock(take.start)}
                  </label>
                  <button onClick={() => void new Audio(take.url).play()} className="rounded border border-white/15 px-2 py-0.5 text-emerald-200">▸</button>
                  <button onClick={() => setTrackSettingsDirty(current => ({ ...current, vocal_takes: (current.vocal_takes ?? []).filter(item => item.id !== take.id) }))}
                    title="Remove this sung guide from the song" className="rounded border border-white/15 px-2 py-0.5 text-rose-300">✕</button>
                </div>)}
              </div>
            </>}
            <p className="text-[9px] font-black uppercase tracking-[.2em] text-slate-500">The band — saved with the song; heard in preview, practice and rounds</p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-slate-400">Instrument
                <select aria-label="Instrument style" value={accompaniment.guitar} onChange={event => setTrackSettingsDirty(current => ({ ...current, accompaniment: { ...(current.accompaniment ?? { drums: 'off' }), guitar: event.target.value, drums: current.accompaniment?.drums ?? 'off' } }))}
                  className="rounded border border-white/15 bg-black/30 px-1.5 py-1 text-[11px] text-white">
                  {INSTRUMENT_STYLES.map(style => <option key={style.id} value={style.id}>{style.label}</option>)}
                </select></label>
              <label className="flex items-center gap-1.5 text-slate-400">Drums
                <select aria-label="Drum style" value={accompaniment.drums} onChange={event => setTrackSettingsDirty(current => ({ ...current, accompaniment: { ...(current.accompaniment ?? { guitar: 'gtr-folk' }), guitar: current.accompaniment?.guitar ?? 'off', drums: event.target.value } }))}
                  className="rounded border border-white/15 bg-black/30 px-1.5 py-1 text-[11px] text-white">
                  {DRUM_STYLES.map(style => <option key={style.id} value={style.id}>{style.label}</option>)}
                </select></label>
              <span className="text-slate-500">chord styles need chord symbols; mid-song changes ride the notes (Expression bar)</span>
              <button onClick={generateGroove} title="Dictate a whole arrangement: chords read from the voices, band instructions at the section turns, singer dynamics that build, a held final note. Press again for a different vibe." className="rounded-lg border border-fuchsia-300/40 bg-fuchsia-300/10 px-3 py-1.5 font-semibold text-fuchsia-100">🎲 Generate a groove</button>
            </div>
            {accompaniment.guitar === 'custom' && <div>
              <p className="mb-1 text-[9px] font-black uppercase tracking-[.2em] text-slate-500">Your instrument line — one token per eighth, looped: note names hit, ~ holds, - rests</p>
              <textarea aria-label="Custom instrument line" rows={2} defaultValue={accompaniment.instrument_tab ?? ''} placeholder="e3 g3 b3 e4 ~ - e3>g3  (~ holds, - rests, e3>g3 slides)"
                onBlur={event => setTrackSettingsDirty(current => ({ ...current, accompaniment: { guitar: 'custom', drums: current.accompaniment?.drums ?? 'off', instrument_tab: event.target.value, drum_tab: current.accompaniment?.drum_tab } }))}
                className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-white" /></div>}
            {accompaniment.drums === 'custom' && <div>
              <p className="mb-1 text-[9px] font-black uppercase tracking-[.2em] text-slate-500">Your drum tab — one column per eighth, looped. Lanes: K kick · S snare · H hat · T/t toms · B/P/c cajon. x or o hits, X/O accents, - rests</p>
              <textarea aria-label="Custom drum tab" rows={4} defaultValue={accompaniment.drum_tab ?? ''} placeholder={'K: o---o---\nS: --o---o-\nH: x-x-x-x-'}
                onBlur={event => setTrackSettingsDirty(current => ({ ...current, accompaniment: { guitar: current.accompaniment?.guitar ?? 'off', drums: 'custom', instrument_tab: current.accompaniment?.instrument_tab, drum_tab: event.target.value } }))}
                className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-white" /></div>}
            <p className="text-[9px] font-black uppercase tracking-[.2em] text-slate-500">Song key</p>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => transposeSong(-1)} title="Move every note and chord down a semitone" className="rounded-lg border border-white/15 px-3 py-1.5 text-slate-200">- semitone</button>
              <button onClick={() => transposeSong(1)} title="Move every note and chord up a semitone" className="rounded-lg border border-white/15 px-3 py-1.5 text-slate-200">+ semitone</button>
              <span className="text-slate-500">renditions can still lift per verse</span>
            </div>
            <p className="text-[9px] font-black uppercase tracking-[.2em] text-slate-500">View</p>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => { setMoreOpen(false); void enterTimelineFocus(); }} className="rounded-lg border border-fuchsia-300/40 bg-fuchsia-300/10 px-3 py-2 font-semibold text-fuchsia-100">⛶ Timeline full screen</button>
              <label className="flex items-center gap-2 text-slate-400">Grid zoom <b className="w-8 text-right text-fuchsia-200">{Math.round((zoom / 16) * 10) / 10}x</b>
                <input aria-label="Timeline zoom" type="range" min="16" max="160" step="4" value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label>
            </div>
            <div><p className="mb-1 text-[9px] font-black uppercase tracking-[.2em] text-slate-500">Draw length &amp; glossary</p>
              <DrawNoteValuePicker value={musicalTimeline.snap_value ?? DEFAULT_NOTE_VALUE} onChange={changeNoteValue} /></div>
          </div>}
        </span>} tool={tool} setTool={setTool} drawNoteValue={musicalTimeline.snap_value ?? DEFAULT_NOTE_VALUE} onDrawNoteValueChange={changeNoteValue} playScope={playScope} playParts={playParts} onPlayAll={selectAllVoices} onPlayPart={selectPlayPart} playRange={playRange} playhead={playhead} onClearSelection={selectAllVoices} selectedCount={selectedIds.length} onRemove={removeSelected} canUndo={history.past.length > 0} canRedo={history.future.length > 0} onUndo={undo} onRedo={redo} zoom={zoom} setZoom={setZoom} onDuplicate={duplicateSelected} onCopy={copySelectedNotes} onPaste={pasteCopiedNotes} clipboardCount={noteClipboard.length} onTypeLyrics={() => setShowLyricLine(true)} onHarmonise={() => setShowHarmony(true)} onAlignToMelody={alignHarmonyToMelody} onPlay={playFromCursor} onPlayFromStart={playFromStart} onPause={pausePlayback} onStop={stopPlayback} onSkip={skipTransport} isPlaying={isPlaying} isPaused={isPaused} onRecord={() => void toggleRecording()} recording={recording} onPlayTake={playRecordedTake} hasTake={Boolean(recordingUrl)} onConvertTake={() => void convertRecordedTake()} convertingTake={transcribingTake} recordingPart={recordingPart} onRecordingPartChange={part => { setRecordingPart(part); setTranscriptionDiagnostics(null); setRecordError(null); }} transcriptionSnap={transcriptionSnap} onTranscriptionSnapChange={setTranscriptionSnap} onSave={() => void save()} saving={saving} />}
        {timelineFocus && <TimelineFocusToolbar tool={tool} setTool={setTool} drawNoteValue={musicalTimeline.snap_value ?? DEFAULT_NOTE_VALUE} onDrawNoteValueChange={changeNoteValue} selected={selected} bars={musicalBars} onLyricChange={lyric => selected && update(selected.id, { lyric })} onTrack={() => setShowBackingEditor(true)} onExit={() => void exitTimelineFocus()} onPlay={playFromCursor} onPause={pausePlayback} onStop={stopPlayback} isPlaying={isPlaying} isPaused={isPaused} playhead={playhead} zoom={zoom} setZoom={setZoom} onSave={() => void save()} saving={saving} />}
        <input ref={xmlInputRef} className="hidden" type="file" accept=".musicxml,.xml,.mxl" onChange={openMusicXml} /><input ref={midiInputRef} className="hidden" type="file" accept=".mid,.midi,audio/midi" onChange={openMidi} /><input ref={mediaInputRef} className="hidden" type="file" accept="audio/*,video/*" onChange={uploadBackingTrack} />
        {recordError && <div className="border-b border-rose-300/20 bg-rose-400/10 px-4 py-2 text-xs text-rose-200">Microphone: {recordError}</div>}
        {transcriptionDiagnostics && !recordError && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-cyan-300/15 bg-cyan-300/[.05] px-4 py-2 text-[11px] text-cyan-100">
          <b className="uppercase tracking-[.14em] text-cyan-300">Last vocal analysis</b>
          <span>{Math.round(transcriptionDiagnostics.averageConfidence * 100)}% mean pitch confidence</span>
          <span>{Math.round(transcriptionDiagnostics.averagePitchDriftCents)}¢ mean tuning drift</span>
          <span>{transcriptionDiagnostics.algorithm} · {transcriptionDiagnostics.timingResolutionMs.toFixed(1)} ms hops</span>
          <span>{transcriptionDiagnostics.expressiveNotes} expressive note{transcriptionDiagnostics.expressiveNotes === 1 ? '' : 's'}</span>
          <span>{transcriptionDiagnostics.voicedFrames}/{transcriptionDiagnostics.analyzedFrames} voiced frames</span>
          {transcriptionDiagnostics.lowestMidi !== null && transcriptionDiagnostics.highestMidi !== null && <span>{midiNoteName(transcriptionDiagnostics.lowestMidi)}–{midiNoteName(transcriptionDiagnostics.highestMidi)}</span>}
          {transcriptionDiagnostics.rejectedOutOfRangeFrames > 0 && <span className="text-amber-200">{transcriptionDiagnostics.rejectedOutOfRangeFrames} frames outside {VOICES[recordingPart]} range rejected</span>}
        </div>}
        {midiError && <div className="border-b border-rose-300/20 bg-rose-400/10 px-4 py-2 text-xs text-rose-200">MIDI import: {midiError}</div>}
        {editorNotice && <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[95] flex justify-center px-4"><div className="pointer-events-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-amber-300/25 bg-[#1c1608f2] px-4 py-2.5 text-xs text-amber-100 shadow-[0_18px_50px_#000c] backdrop-blur"><span>{editorNotice}</span><button onClick={() => setEditorNotice(null)} aria-label="Dismiss editor notice" className="rounded border border-amber-200/25 px-2 py-0.5">Close</button></div></div>}
        {closePrompt && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setClosePrompt(false)}>
          <div role="alertdialog" aria-label="Unsaved changes" onClick={event => event.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-amber-300/25 bg-[#0d1024] p-5 shadow-[0_30px_90px_#000d,0_0_40px_#f59e0b22]">
            <p className="text-sm font-black text-amber-100">● Unsaved changes</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">This arrangement has edits that are not saved yet. Closing without saving loses them.</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button autoFocus onClick={() => setClosePrompt(false)} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-200">Keep editing</button>
              <button onClick={() => { setClosePrompt(false); dirtyRef.current = false; onClose(); }} className="rounded-lg border border-rose-300/35 bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-200">Discard changes</button>
              <button disabled={saving} onClick={() => { void save().then(() => { setClosePrompt(false); if (!dirtyRef.current) onClose(); }); }} className="rounded-lg bg-[linear-gradient(120deg,#d946ef,#22d3ee)] px-4 py-2 text-xs font-black text-[#08101d] disabled:opacity-50">{saving ? 'Saving…' : 'Save and close'}</button>
            </div>
          </div>
        </div>}
        {bandWrite && <div className="fixed inset-0 z-[85] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => { stopAudition(); setBandWrite(null); }}>
          <div ref={studioPanelRef} role="dialog" aria-label="Part studio" onClick={event => event.stopPropagation()}
            className={`flex w-full flex-col gap-3 overflow-auto border border-sky-300/25 bg-[#0a0e20] p-5 shadow-[0_30px_90px_#000d,0_0_40px_#38bdf822] ${studioFull ? 'h-screen max-h-none rounded-none' : 'max-h-[92vh] rounded-2xl'}`}
            style={{ maxWidth: studioFull ? '100vw' : 'min(1200px, 96vw)' }}>
            {studioFull && editorNotice && <div className="flex items-center gap-3 rounded-xl border border-amber-300/25 bg-[#1c1608] px-3 py-2 text-xs text-amber-100">
              <span className="flex-1">{editorNotice}</span>
              <button onClick={() => setEditorNotice(null)} aria-label="Dismiss studio notice" className="rounded border border-amber-200/25 px-2 py-0.5">Close</button>
            </div>}
            <div className="flex items-center justify-between">
              <p className="text-sm font-black text-sky-100">✍ Part studio — {clipTarget ? `🎼 ${(trackSettings.band_tracks ?? []).find(t => t.id === clipTarget.trackId)?.name ?? 'clip'} · from bar ${bandWrite.barNumber}` : bandWrite.target === 'default' ? 'from the top of the song' : `from bar ${bandWrite.barNumber}`}</p>
              <div className="flex items-center gap-2">
                {!clipTarget && <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-slate-400"
                  title="How long this part governs the band. 'until changed' plays until the next instruction; N bars stamps a closing instruction at the boundary that brings the previous sound back — and the window below always shows every bar of the span.">Applies for
                  <select value={applyBars ?? 0} onChange={event => setApplyBars(Number(event.target.value) || null)}
                    className="rounded border border-white/15 bg-black/30 px-1.5 py-1 text-[11px] normal-case tracking-normal text-white">
                    <option value={0}>until changed</option>
                    {[1, 2, 3, 4, 6, 8].filter(n => bandWrite && n * bandWrite.perBar <= 64).map(n => <option key={n} value={n}>{n} bar{n > 1 ? 's' : ''}</option>)}
                  </select></label>}
                <button onClick={() => setPatternBars(current => current + 1)} disabled={studioColumns >= 64}
                  title="Extend the pattern by one bar — all three sections grow together" className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 disabled:opacity-30">＋ bar</button>
                <button onClick={toggleStudioFullscreen} aria-pressed={studioFull}
                  title={studioFull ? 'Leave fullscreen (Esc works too)' : 'True fullscreen — the studio takes the whole screen'}
                  className={`rounded-lg border px-2.5 py-1 text-xs ${studioFull ? 'border-sky-300/50 bg-sky-300/15 text-sky-100' : 'border-white/15 text-slate-300'}`}>⛶</button>
                <button onClick={() => { stopAudition(); setBandWrite(null); }} aria-label="Close part studio" className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300">✕</button>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">This is the EXACT part the band plays from bar {bandWrite.barNumber}, printed as editable notes — reshape it, or start fresh. Move the mouse and one glowing column runs through the voices, your staff and your drums; the faint coloured dashes on your staff are the S/A/T/B pitches themselves — land a head on a dash to double that voice, next to it to harmonize. On the staff: <b className="text-slate-300">click</b> = note (more pitches in one column stack a chord; click a head again to remove it) · <b className="text-slate-300">Ctrl</b> = ♯ · <b className="text-slate-300">Shift</b> = lengthen · <b className="text-slate-300">right-click</b> = rest · the <b className="text-slate-300">fx</b> strip cycles accent → staccato · <b className="text-slate-300">[Em7]</b> in the written form voices a chord symbol.</p>
            <div ref={studioScrollRef} className="overflow-x-auto rounded-xl border border-white/10 bg-[#050716]">
              <div className="relative w-max">
                <div ref={studioNeedleRef} className="pointer-events-none absolute bottom-0 top-0 z-10 hidden w-[2px] rounded bg-cyan-300 shadow-[0_0_10px_#22d3ee]" />
                <div className="px-0 pt-1"><span className="pl-2 text-[9px] font-black uppercase tracking-[.16em] text-slate-500">The song — voices &amp; chords</span>
                  <AlignedVoicesOverview notes={notes} chords={trackSettings.chord_symbols ?? []} from={bandWrite.from}
                    eighthLen={bandWrite.barLen / bandWrite.perBar} columns={studioColumns} perBar={bandWrite.perBar}
                    hoverColumn={studioHover} onHoverColumn={setStudioHover} /></div>
                <div className="border-t border-sky-300/15"><span className="pl-2 text-[9px] font-black uppercase tracking-[.16em] text-sky-200">🎸 Your instrument — the exact part, editable</span>
                  <InstrumentStaffEditor value={draftInstrumentTab} onChange={setDraftInstrumentTab} columns={studioColumns} perBar={bandWrite.perBar}
                    reference={studioReference} hoverColumn={studioHover} onHoverColumn={setStudioHover}
                    brushValue={studioBrush} onBrushChange={setStudioBrush} /></div>
                {!clipTarget && <div className="border-t border-rose-300/15"><span className="pl-2 text-[9px] font-black uppercase tracking-[.16em] text-rose-200">🥁 Your drums — tap the grid</span>
                  <DrumGridEditor value={draftDrumTab} onChange={setDraftDrumTab} columns={studioColumns} perBar={bandWrite.perBar}
                    hoverColumn={studioHover} onHoverColumn={setStudioHover} /></div>}
              </div>
            </div>
            <details className="text-[11px] text-slate-300">
              <summary className="cursor-pointer text-slate-400">Written form (the same part as text — edit either, they stay in step)</summary>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="font-black uppercase tracking-[.14em] text-sky-200">🎸 Instrument line</span>
                  <textarea rows={3} value={draftInstrumentTab} onChange={event => setDraftInstrumentTab(event.target.value)} spellCheck={false}
                    placeholder={'e3 g3 b3 e4 ~ - e3>g3 -'}
                    className="rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white" />
                  <span className="text-slate-500">note names per eighth (e3, f#3, bb2) · <b>e3,g3,b3</b> a chord · <b>[Em7]</b> a symbol's voicing · <b>~</b> holds longer · <b>-</b> rest · <b>e3&gt;g3</b> slides · <b>!</b> accent · <b>.</b> staccato (e3! or [Em7].) · bar lines | are ignored</span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-black uppercase tracking-[.14em] text-rose-200">🥁 Drum tab</span>
                  <textarea rows={3} value={draftDrumTab} onChange={event => setDraftDrumTab(event.target.value)} spellCheck={false}
                    placeholder={'K: o---o---\nS: --o---o-\nH: x-x-x-x-\nT: -------o'}
                    className="rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-white" />
                  <span className="text-slate-500"><b>K</b> kick · <b>S</b> snare · <b>H</b> hat · <b>T/t</b> toms · <b>B/P/c</b> cajon — one column per eighth, <b>x/o</b> hit, <b>X/O</b> accent, <b>-</b> rest</span>
                </label>
              </div>
            </details>
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-mono text-slate-500">count the eighths: {Array.from({ length: Math.max(1, scoreBars[0]?.numerator ?? 4) }, (_, i) => `${i + 1} &`).join(' ')} | (one bar)</span>
              <div className="flex flex-wrap gap-2">
                <input ref={partImportRef} type="file" className="hidden" accept=".mid,.midi,.xml,.musicxml,.mxl,audio/*"
                  onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importPartFile(file); }} />
                <button onClick={() => void toggleMidiInput()} aria-pressed={midiArmed}
                  title="Connect a MIDI keyboard (Chrome/Edge): play a note or chord and it lands on the staff at the palette's value, step by step — DAW-style entry."
                  className={`rounded-lg border px-3 py-2 font-semibold ${midiArmed ? 'border-emerald-300/50 bg-emerald-300/15 text-emerald-100' : 'border-white/15 text-slate-300'}`}>{midiArmed ? '🎹 MIDI on' : '🎹 MIDI keyboard'}</button>
                <button onClick={() => partImportRef.current?.click()} disabled={importingPart}
                  title="Bring outside music into this part: a MIDI file, a MusicXML sheet, or an audio recording (your voice or an instrument — it is transcribed to notes). Quantized to the eighth grid, then edit it like anything else."
                  className="rounded-lg border border-amber-300/35 bg-amber-300/[.08] px-3 py-2 font-semibold text-amber-100 disabled:opacity-50">{importingPart ? 'Reading…' : '📥 Import MIDI / sheet / recording'}</button>
                <button onClick={async () => {
                  if (auditionRun) { stopAudition(); return; }
                  const seconds = studioColumns * (bandWrite.barLen / bandWrite.perBar) + 0.01;
                  const run = draftBandEvents ? await playAudition(draftBandEvents, bandWrite.from, seconds) : null;
                  if (!run) { setEditorNotice('Nothing to audition yet — write a note or two first.'); return; }
                  setAuditionRun({ context: run.context, startAt: run.start, seconds });
                }}
                  title="Hear ONLY the instrument and drum part, across the whole window — the needle rides the ruler" className={`rounded-lg border px-3 py-2 font-semibold ${auditionRun ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-100' : 'border-emerald-300/40 bg-emerald-300/10 text-emerald-100'}`}>{auditionRun ? '■ Stop' : '▶ Part alone'}</button>
                <button onClick={async () => {
                  if (auditionRun) { stopAudition(); return; }
                  const seconds = studioColumns * (bandWrite.barLen / bandWrite.perBar) + 0.01;
                  const run = draftBandEvents ? await playAuditionWithVoices(draftBandEvents, bandWrite.from, seconds) : null;
                  if (!run) { setEditorNotice('Nothing sounds in this window yet.'); return; }
                  setAuditionRun({ context: run.context, startAt: run.start, seconds });
                }}
                  title="Hear the part together with the choir's voices, across the whole window — the needle rides the ruler" className={`rounded-lg border px-3 py-2 font-semibold ${auditionRun ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-100' : 'border-fuchsia-300/40 bg-fuchsia-300/10 text-fuchsia-100'}`}>{auditionRun ? '■ Stop' : '▶ With the voices'}</button>
                {bandWrite.target !== 'default' && <button onClick={() => {
                  const target = bandWrite.target;
                  stopAudition(); setBandWrite(null);
                  if (typeof target === 'object' && 'clipId' in target) {
                    setTrackSettingsDirty(current => {
                      const tracks = (current.band_tracks ?? [])
                        .map(track => track.id !== target.trackId ? track : { ...track, clips: track.clips.filter(clip => clip.id !== target.clipId) })
                        .filter(track => track.clips.length > 0);
                      return { ...current, band_tracks: tracks.length ? tracks : undefined };
                    });
                    setEditorNotice('The clip is removed.');
                  } else {
                    applyBandAt(target as { noteId: string }, 'remove', '');
                    setEditorNotice('The instruction and its written part are removed — the previous sound plays on through here.');
                  }
                }}
                  title="Delete this clip or instruction; the surrounding sound continues" className="rounded-lg border border-rose-300/35 px-3 py-2 font-semibold text-rose-200">🗑 Remove</button>}
                <button onClick={() => { stopAudition(); setBandWrite(null); }} className="rounded-lg border border-white/15 px-3 py-2 text-slate-300">Cancel</button>
                <button onClick={saveBandWrite} className="rounded-lg bg-[linear-gradient(120deg,#38bdf8,#a78bfa)] px-4 py-2 font-black text-[#08101d]">Use this part</button>
              </div>
            </div>
          </div>
        </div>}
        <div className="flex min-h-0 flex-1">
          <section className={`min-w-0 flex-1 overflow-auto ${timelineFocus ? 'p-1' : 'p-3'}`}>
            {!timelineFocus && noteView !== 'rendition' && <><details className="mb-2 rounded-xl border border-white/10 bg-[#070a18] px-3 py-2 text-xs">
              <summary className="cursor-pointer select-none font-semibold text-slate-300">Grid, tempo map &amp; drawn length <span className="ml-2 text-[10px] text-slate-500">{cursorMusicalState.numerator}/{cursorMusicalState.denominator} · {cursorMusicalState.bpm} bpm · {cursorMusicalState.tonic} {cursorMusicalState.mode}</span></summary>
              <div className="pt-2"><MusicalTimelineControls timeline={musicalTimeline} cursor={playhead ?? 0} state={cursorMusicalState} onTempo={bpm => upsertMusicalEvent('tempo', { bpm })} onMeter={(numerator, denominator) => upsertMusicalEvent('meter', { numerator, denominator })} onKey={(tonic, mode) => upsertMusicalEvent('key', { tonic, mode })} onSnapDivision={changeSnapDivision} onNoteValue={changeNoteValue} onLatchAll={latchAllToNoteValue} onRemove={removeMusicalEvent} /></div>
            </details>
            <div className="xl:hidden"><BeatPrecisionPanel selectedNotes={selectedNotes} bars={musicalBars} cursor={playhead ?? 0} clipboardCount={noteClipboard.length} onCopy={copySelectedNotes} onPaste={pasteCopiedNotes} /></div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400"><p className="mr-auto max-w-4xl leading-relaxed"><b className="text-slate-200">One mode does everything.</b> Drag a note body left/right for timing and up/down for pitch; double-click empty lane space to write a note there. Ctrl-click builds a selection; drag empty space to lasso. Starts and durations latch to the selected musical note value; writing over an existing note replaces it.</p><button onClick={() => setCollapsedVoices([true, true, true, true])} className="rounded-md border border-white/10 px-2 py-1 text-slate-300">Collapse all voices</button><button onClick={() => setCollapsedVoices([false, false, false, false])} className="rounded-md border border-white/10 px-2 py-1 text-slate-300">Expand all voices</button></div></>}
            {noteView !== 'rendition' && <NoteEntryPalette
              snapValue={musicalTimeline.snap_value ?? DEFAULT_NOTE_VALUE}
              onValue={changeNoteValue}
              stepInput={stepInput}
              onStepInput={value => { setStepInput(value); setStepCaret(null); }}
              caretLabel={compactBeatLabel(beatPositionAt(musicalBars, entryStart + 0.005))}
              completion={beatCompletion ? { symbol: beatCompletion.symbol, short: beatCompletion.short } : null}
              voiceName={VOICES[selectedPart] ?? 'Voice'}
              remainingQuarters={remainingQuarters}
              barFill={entryBar ? Math.max(0, Math.min(1, (entryStart - entryBar.start) / Math.max(.001, entryBar.end - entryBar.start))) : 0}
              onFillBar={fillRestOfBar}
              onRest={restStepAdvance}
            />}
            {noteView !== 'rendition' && selectedNotes.length > 0 && <ExpressionBar
              selection={selectedNotes}
              onDynamic={applyDynamicToSelection}
              onToggle={toggleMarkOnSelection}
              onSpan={applySpanToSelection}
              onTempo={applyTempoToSelection}
              chord={(trackSettings.chord_symbols ?? []).find(chord => selectedNotes[0] && Math.abs(chord.at - selectedNotes[0].start) <= 0.05)?.symbol ?? ''}
              onChord={setChordAtSelection}
              bandBarNumber={selectedNotes[0] ? musicalBars.find(bar => selectedNotes[0].start + 0.01 >= bar.start && selectedNotes[0].start + 0.01 < bar.end)?.number : undefined}
              onBand={applyBandToSelection}
              onClear={clearMarksOnSelection} />}
            <div className="mb-2 flex items-center gap-1 text-xs">
              <button onClick={() => switchView('score')} className={`rounded-l-lg border px-3 py-1.5 ${noteView === 'score' ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-100' : 'border-white/12 text-slate-400'}`} title="The arrangement as an engraved open score — one staff per voice">𝄞 Score</button>
              <button onClick={() => switchView('grid')} className={`border px-3 py-1.5 ${noteView === 'grid' ? 'border-fuchsia-300/50 bg-fuchsia-300/15 text-fuchsia-100' : 'border-white/12 text-slate-400'}`} title="The piano-roll grid — for drawing and dragging notes">▦ Grid</button>
              <button onClick={() => switchView('rendition')} className={`rounded-r-lg border px-3 py-1.5 ${noteView === 'rendition' ? 'border-cyan-300/50 bg-cyan-300/15 text-cyan-100' : 'border-white/12 text-slate-400'}`} title="Shape the performance: stack passes of the song, choose who sings each one, and hear the result">⟳ Rendition</button>
              {noteView === 'score' && <>
                <button onClick={insertBarAtCaret} title={`Insert an empty bar at bar ${entryBar ? entryBar.number : '?'} (the palette's entry bar); everything after moves later`} className="ml-2 rounded-lg border border-white/15 px-2.5 py-1.5 text-slate-300">＋ bar</button>
                <button onClick={deleteBarAtCaret} title={`Remove bar ${entryBar ? entryBar.number : '?'} and its notes; later bars move up`} className="rounded-lg border border-rose-300/25 px-2.5 py-1.5 text-rose-200">− bar</button>
                <span className="ml-2 text-[10px] text-slate-500">Click empty staff space to write a note exactly where the ghost head shows — what follows slides right, and overflow ties into a freshly inserted bar · drop a note onto another to swap them · with a note selected, the value buttons (or keys 3–7 and .) change its length — double-click the note to deselect it first if you only want to pick the next entry's value · right-click removes a note, leaving its rest · Ctrl+Z undo, Ctrl+Y redo · Double-click a word to edit lyrics: Tab = next word, Enter = done · the faint dashed boxes above the top staff take chord symbols — click one and type (Tab = next beat, empty = clear) · the 🎸/🥁 lane under the bass staff prints every hit the band will actually play, beat by beat — click any band instruction on that line (or the label at its head) to change or remove it right there.</span>
              </>}
            </div>
            {noteView === 'score' && <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-[#0a0d1f] px-3 py-2 text-[10px]">
              <span className="font-black uppercase tracking-[.16em] text-slate-500" title="Grab a chip and drop it on a note — the band plays that style from its bar. Drag ACROSS several bars before releasing to limit it to exactly that range (the previous sound resumes after).">Drag onto the score ➜</span>
              {INSTRUMENT_STYLES.filter(style => style.id !== 'off' && style.id !== 'custom').map(style =>
                <span key={style.id} draggable
                  onDragStart={event => { event.dataTransfer.setData('application/x-vh-band', JSON.stringify({ field: 'instrument', style: style.id })); event.dataTransfer.effectAllowed = 'copy'; }}
                  title={`${style.label} — drop on a note; drag across bars to limit the span`}
                  className="cursor-grab select-none rounded-lg border border-sky-300/25 bg-sky-300/[.07] px-2 py-1 text-sky-100 active:cursor-grabbing">{style.label.replace(/(Guitar|Piano|Bass) · /, '').replace(/\s*\(.*\)/, '')}</span>)}
              {DRUM_STYLES.filter(style => style.id !== 'off' && style.id !== 'custom').map(style =>
                <span key={style.id} draggable
                  onDragStart={event => { event.dataTransfer.setData('application/x-vh-band', JSON.stringify({ field: 'drums', style: style.id })); event.dataTransfer.effectAllowed = 'copy'; }}
                  title={`${style.label} — drop on a note; drag across bars to limit the span`}
                  className="cursor-grab select-none rounded-lg border border-rose-300/25 bg-rose-300/[.07] px-2 py-1 text-rose-100 active:cursor-grabbing">{style.label.replace(/(Kit|Cajon) · /, '$1 ').replace(/\s*\(.*\)/, '')}</span>)}
              <span draggable
                onDragStart={event => { event.dataTransfer.setData('application/x-vh-band', JSON.stringify({ field: 'custom', style: 'custom' })); event.dataTransfer.effectAllowed = 'copy'; }}
                title="Drop to open the Part studio for that spot — drag across bars first and the part applies to exactly that range"
                className="cursor-grab select-none rounded-lg border border-fuchsia-300/30 bg-fuchsia-300/10 px-2 py-1 font-semibold text-fuchsia-100 active:cursor-grabbing">✍ Custom part</span>
              <span draggable
                onDragStart={event => { event.dataTransfer.setData('application/x-vh-band', JSON.stringify({ field: 'stop', style: 'stop' })); event.dataTransfer.effectAllowed = 'copy'; }}
                title="Drop to silence the whole band from that bar (until the next instruction)"
                className="cursor-grab select-none rounded-lg border border-white/15 px-2 py-1 text-slate-300 active:cursor-grabbing">🚫 Stop band</span>
              <span className="mx-1 h-4 w-px bg-white/15" />
              {(['guitar', 'piano', 'bass'] as const).map(timbre =>
                <span key={timbre} draggable
                  onDragStart={event => { event.dataTransfer.setData('application/x-vh-band', JSON.stringify({ field: 'clip', style: timbre })); event.dataTransfer.effectAllowed = 'copy'; }}
                  title={`A free ${timbre} clip — drop it ANYWHERE (even empty bars; drag across bars for its length) and write exactly what it plays. It sounds once in a real ${timbre} voice, independent of the style instructions.`}
                  className="cursor-grab select-none rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-2 py-1 font-semibold text-emerald-100 active:cursor-grabbing">🎼 {timbre === 'guitar' ? '🎸' : timbre === 'piano' ? '🎹' : '🎻'} {timbre} clip</span>)}
            </div>}
            {noteView === 'score' && <div className="overflow-auto rounded-xl border border-[#7650d8]/40 bg-[#050716] shadow-[0_18px_55px_#0008,0_0_30px_#6d28d915]" style={{ maxHeight: timelineFocus ? 'calc(100vh - 76px)' : 'max(420px, calc(100vh - 290px))' }}>
              <ScoreView notes={notes} bars={scoreBars} getPlayhead={() => playheadRef.current} selectedIds={selectedIds} tool={tool}
                onSelectNote={(id, part, additive) => {
                  setSelectedIds(current => additive ? (current.includes(id) ? current.filter(item => item !== id) : [...current, id]) : [id]);
                  setSelectedId(id);
                  if (part >= 0) setSelectedPart(part);
                }}
                onAddNote={(part, time, midi) => {
                  // Open score: the staff clicked IS the voice entered.
                  const landing = resolveScoreAdd(time, part);
                  addNote(part, landing.start, midi, landing.end, '');
                }}
                resolveAdd={(time, part) => resolveScoreAdd(time, part).start}
                chords={trackSettings.chord_symbols}
                onChordEdit={setChordAtTime}
                bandEvents={laneBandEvents}
                onBandEdit={applyBandAt}
                bandDefaults={{ instrument: accompaniment.guitar, drums: accompaniment.drums }}
                onBandAudition={auditionBandAt}
                onBandWrite={openBandWrite}
                onBandDrop={handleBandChipDrop}
                clipMarkers={(trackSettings.band_tracks ?? []).flatMap(track => track.clips.map(clip => ({ at: clip.start, label: `🎼 ${track.name}`, trackId: track.id, clipId: clip.id })))}
                onClipEdit={openClipWrite}
                showLeadIn
                onDeselect={() => { setSelectedId(null); setSelectedIds([]); setEditorNotice(null); }}
                onEraseNote={removeNote}
                onDragCommit={(id, changes) => update(id, changes)}
                onLyricChange={(id, lyric) => update(id, { lyric }, true)} />
            </div>}
            {noteView === 'grid' && <div className="overflow-auto rounded-xl border border-[#7650d8]/40 bg-[#050716] shadow-[0_18px_55px_#0008,0_0_30px_#6d28d915]" style={{ maxHeight: timelineFocus ? 'calc(100vh - 76px)' : 'max(420px, calc(100vh - 290px))' }}>
              <div style={{ width: timelineWidth + TIMELINE_LABEL_WIDTH }}>
                <div className="sticky top-0 z-40 bg-[#050716] shadow-[0_12px_28px_#02030ccc]">
                  <div onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); seekFromTimeline((event.clientX - bounds.left - TIMELINE_LABEL_WIDTH) / zoom); }} className="relative flex h-12 cursor-pointer border-b border-cyan-200/15 bg-[linear-gradient(180deg,#141936,#090d21)]" title="Click to move the playhead">
                    <div className="sticky left-0 z-50 flex w-[124px] shrink-0 items-center border-r border-cyan-200/15 bg-[#11162f] px-3 text-[10px] font-bold uppercase tracking-[.15em] text-cyan-200">Bars &amp; beats</div>
                    {musicalBars.map(bar => <span key={`${bar.number}-${bar.start}`} className="relative shrink-0 border-r-2 border-cyan-200/35 pt-1 text-[10px] font-semibold text-slate-300" style={{ width: Math.max(1, (bar.end - bar.start) * zoom), background: bar.number % 2 ? '#17203b88' : '#0e153088' }}><b className="ml-2 text-cyan-100">BAR {bar.number}</b><small className="ml-2 text-[8px] font-normal text-fuchsia-200/80">{bar.numerator}/{bar.denominator} · {bar.bpm} · {bar.tonic} {bar.mode.slice(0, 3)}</small><span className="absolute inset-x-0 bottom-1 flex text-[9px] font-normal text-slate-400">{bar.beats.map(beat => <i key={beat.start} className="not-italic text-center" style={{ width: `${100 / Math.max(1, bar.beats.length)}%` }}>{beat.beat}</i>)}</span></span>)}
                  </div>
                  <BackingTrackLane url={mediaUrl} fileName={mediaName} width={timelineWidth} zoom={zoom} playhead={playhead} settings={trackSettings} onClipsChange={updateTrackClips} onOpenSettings={() => setShowBackingEditor(true)} onSeek={seekFromTimeline} />
                </div>
                <div className="relative" onPointerDown={beginLasso} onPointerMove={moveLasso} onPointerUp={endLasso} onPointerCancel={endLasso}>
                  {lassoBox && <span className="pointer-events-none absolute z-50 rounded border border-fuchsia-200 bg-fuchsia-400/15 shadow-[0_0_22px_#f0abfc55]" style={lassoBox} />}
                  {VOICES.map((voice, index) => <PianoTrack key={voice} name={voice} part={index} notes={noteByPart[index]} selectedId={selectedId} selectedIds={selectedIds} tool={tool} playhead={playhead} selectedRange={playScope === 'range' && rangeParts && index >= rangeParts.start && index <= rangeParts.end ? playRange : null} width={timelineWidth} zoom={zoom} bars={musicalBars} freeGrid={freeGrid} collapsed={collapsedVoices[index]} onToggleCollapse={() => setCollapsedVoices(current => current.map((value, part) => part === index ? !value : value))} onAdd={handleLaneClick} onAddDouble={handleLaneDoubleClick} onSelect={selectNote} onRemove={removeNote} onNoteMoveStart={beginNoteMove} onNoteMove={moveNote} onNoteMoveEnd={endNoteMove} onResizeStart={beginResizeHistory} onResize={resizeNote} onEmptyClick={clearPlaybackSelections} />)}
                </div>
              </div>
            </div>}
            {noteView === 'rendition' && <>
              <RenditionRail
                songTitle={title}
                sections={renditionSections}
                cards={renditionCards}
                onCardsChange={setRenditionCards}
                compiled={compiledRendition}
                getPlayhead={() => playheadRef.current}
                isPlaying={isPlaying}
                onPlayFrom={time => void startPlaybackAt(time)}
                onPause={pausePlayback}
                onStop={stopPlayback}
                onLoadIntoEditor={applyRendition}
                onSaveAsNew={saveRenditionAsNew}
                onNotice={setEditorNotice}
                saving={savingRendition} />
              {compiledRendition.notes.length > 0
                ? <div className="overflow-auto rounded-xl border border-[#7650d8]/40 bg-[#050716] shadow-[0_18px_55px_#0008,0_0_30px_#6d28d915]" style={{ maxHeight: 'max(360px, calc(100vh - 470px))' }}>
                  <ScoreView notes={compiledRendition.notes} bars={compiledRendition.bars} getPlayhead={() => playheadRef.current} selectedIds={[]} tool="select"
                    signature={renditionSignature}
                    onSelectNote={() => {}} onAddNote={() => {}} onEraseNote={() => {}} onDragCommit={() => {}} onLyricChange={() => {}} />
                </div>
                : <div className="grid h-56 place-items-center rounded-xl border border-white/10 bg-[#050716] text-xs text-slate-500">The engraved score of your presentation appears here as soon as it has a pass.</div>}
            </>}
            {!timelineFocus && noteView !== 'rendition' && <details className="mt-3 rounded-xl border border-white/10 bg-[#070a18] px-3 py-2 text-xs">
              <summary className="cursor-pointer font-semibold text-slate-300">Arrangement controls: dynamics, breath &amp; part mixer</summary>
              <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_auto]">
                <div className="space-y-3"><div className="rounded-lg border border-cyan-300/20 bg-cyan-300/5 p-3 text-cyan-100"><b>Gameplay lyrics follow the selected voice.</b><span className="mt-1 block text-slate-400">Add lyrics directly to piano-roll notes. The live display groups those lyrics by musical measure using this song’s tempo and time-signature map.</span></div><Automation notes={notes} /></div>
                <div className="grid grid-cols-4 gap-2">{VOICES.map((voice, index) => <button key={voice} onClick={() => focusVoice(index)} className="rounded-lg border px-3 py-2 text-center" style={{ borderColor: `${COLOURS[index]}66`, color: COLOURS[index], background: `${COLOURS[index]}12` }}><b className="block text-base">{voice[0]}</b><span className="text-[10px]">{voice}</span></button>)}</div>
              </div>
            </details>}
          </section>
          {!timelineFocus && noteView !== 'rendition' && <Inspector selected={selected} bars={musicalBars} update={update} onDelete={removeSelected} onDuplicate={duplicateSelected} />}
        </div>
        {showLyricLine && <LyricLineDialog
          targetCount={lyricTargets().length}
          targetLabel={selectedIds.length ? `${selectedIds.length} selected note${selectedIds.length === 1 ? '' : 's'}` : `Every note in ${VOICES[selectedPart]} — select notes first to do one phrase at a time`}
          onApply={applyLyricLine}
          onClose={() => setShowLyricLine(false)} />}
        {showHarmony && <HarmonyDialog
          noteCounts={[0, 1, 2, 3].map(part => notes.filter(note => note.part === part).length)}
          selectedPart={selectedPart}
          selectionCount={selectedIds.length}
          onApply={applyHarmony}
          onClose={() => setShowHarmony(false)} />}
        {showBackingEditor && <div className="absolute inset-0 z-40 grid place-items-center bg-[#020510]/85 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-label="Backing track editor" className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-cyan-300/30 bg-[#08101f] shadow-[0_0_60px_#22d3ee20]"><header className="flex items-center gap-3 border-b border-white/10 px-5 py-4"><div><p className="text-[10px] font-bold tracking-[.2em] text-cyan-300">BACKING TRACK</p><h2 className="text-lg font-semibold">Audio/video arrangement</h2></div><button onClick={() => setShowBackingEditor(false)} className="ml-auto rounded-lg border border-white/15 px-4 py-2 text-xs">Done</button></header><div className="min-h-0 overflow-y-auto p-4"><BackingTrackPanel url={mediaUrl} kind={mediaKind} fileName={mediaName} settings={trackSettings} setSettings={setTrackSettingsDirty} uploading={uploadingMedia} transportTime={playhead} transportPlaying={isPlaying} onUpload={() => mediaInputRef.current?.click()} /></div></section></div>}
        {xmlPreview && <MusicXmlImportDialog preview={xmlPreview} mapping={xmlMapping} setMapping={setXmlMapping} mode={xmlMode} setMode={setXmlMode} onCancel={() => setXmlPreview(null)} onApply={applyXmlImport} />}
        {midiPreview && <MidiImportDialog preview={midiPreview} ranges={midiRanges} setRanges={setMidiRanges} sourceParts={midiSourceParts} setSourceParts={setMidiSourceParts} fixedPart={midiPart} setFixedPart={setMidiPart} mode={midiMode} setMode={setMidiMode} onCancel={() => setMidiPreview(null)} onApply={applyMidiImport} />}
      </main>

    </div>
    <style jsx global>{`
      .vh-editor-scrollbars, .vh-editor-scrollbars * { scrollbar-width: thin; scrollbar-color: #a855f7 #090d22; }
      .vh-editor-scrollbars ::-webkit-scrollbar { width: 12px; height: 12px; }
      .vh-editor-scrollbars ::-webkit-scrollbar-track { background: linear-gradient(90deg,#070a19,#111735); border: 1px solid #67e8f922; }
      .vh-editor-scrollbars ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
      .vh-editor-scrollbars ::-webkit-scrollbar-thumb { min-height: 42px; border: 3px solid #090d22; border-radius: 999px; background: linear-gradient(180deg,#f05acb,#8b5cf6 55%,#22d3ee); box-shadow: inset 0 0 0 1px #ffffff38,0 0 10px #a855f766; }
      .vh-editor-scrollbars ::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg,#ff8bdd,#a879ff 55%,#57e8ff); }
      .vh-editor-scrollbars ::-webkit-scrollbar-corner { background: #090d22; }
      .vh-editor-scrollbars[data-timeline-focus="true"] > div > aside { display: none !important; }
    `}</style>
  </div>;
}

function GameplayLyricsDialog({ notes, phrases, settings, onPhrasesChange, onSettingsChange, onHistory, onClose }: { notes: SongNote[]; phrases: TimedLyricSection[]; settings: BackingTrackSettings; onPhrasesChange: (value: TimedLyricSection[]) => void; onSettingsChange: (value: NonNullable<BackingTrackSettings['karaoke_lyrics']>) => void; onHistory: () => void; onClose: () => void }) {
  const lyricSettings = { targets_per_phrase: settings.karaoke_lyrics?.targets_per_phrase ?? DEFAULT_TARGETS_PER_PHRASE, max_lines: settings.karaoke_lyrics?.max_lines ?? 2 as 1 | 2, source: settings.karaoke_lyrics?.source ?? (phrases.length ? 'phrases' : 'notes') as 'phrases' | 'notes' };
  const notePhrases = useMemo(() => timedLyricsFromNotes(notes, lyricSettings.targets_per_phrase), [notes, lyricSettings.targets_per_phrase]);
  const activePhrases = lyricSettings.source === 'notes' ? notePhrases : phrases;
  const setSource = (source: 'phrases' | 'notes') => { onHistory(); onSettingsChange({ ...lyricSettings, source }); };
  const updatePhrase = (index: number, values: Partial<TimedLyricSection>) => {
    onPhrasesChange(phrases.map((phrase, phraseIndex) => phraseIndex === index ? { ...phrase, ...values } : phrase));
    if (lyricSettings.source !== 'phrases') onSettingsChange({ ...lyricSettings, source: 'phrases' });
  };
  const addPhrase = () => {
    onHistory();
    const start = roundPrecise(phrases.at(-1)?.end ?? 0);
    onPhrasesChange([...phrases, { primary: 'New gameplay lyric phrase', translation: '', start, end: roundPrecise(start + 4) }]);
    onSettingsChange({ ...lyricSettings, source: 'phrases' });
  };
  const removePhrase = (index: number) => { onHistory(); onPhrasesChange(phrases.filter((_, phraseIndex) => phraseIndex !== index)); };
  const rebuild = () => {
    onHistory();
    onPhrasesChange(notePhrases);
    onSettingsChange({ ...lyricSettings, source: 'phrases' });
  };
  return <div className="absolute inset-0 z-[70] grid place-items-center bg-[#020510]/90 p-3 backdrop-blur-md">
    <section role="dialog" aria-modal="true" aria-label="Gameplay lyrics editor" className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-fuchsia-300/35 bg-[#080c1e] shadow-[0_0_80px_#d946ef2b]">
      <header className="flex items-center gap-4 border-b border-white/10 px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-cyan-300">Karaoke authoring</p><h2 className="text-xl font-semibold text-white">Gameplay lyrics</h2><p className="mt-1 text-xs text-slate-400">Choose the lyric source used by the live game, then edit its wording and timing.</p></div><button onClick={onClose} className="ml-auto rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold">Done</button></header>
      <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <button onClick={() => setSource('notes')} className={`rounded-xl border p-4 text-left ${lyricSettings.source === 'notes' ? 'border-cyan-300 bg-cyan-300/10 shadow-[0_0_22px_#22d3ee20]' : 'border-white/10 bg-white/[.025]'}`}><span className="flex items-center justify-between"><b className="text-cyan-100">Note lyrics</b>{lyricSettings.source === 'notes' && <em className="rounded-full bg-cyan-300/15 px-2 py-1 text-[9px] font-bold not-italic text-cyan-200">LIVE SOURCE</em>}</span><small className="mt-2 block leading-relaxed text-slate-400">Uses the Lyrics field on each piano-roll note. Changes to a note lyric automatically switch gameplay to this source.</small></button>
          <button onClick={() => setSource('phrases')} disabled={!phrases.length} className={`rounded-xl border p-4 text-left disabled:opacity-45 ${lyricSettings.source === 'phrases' ? 'border-fuchsia-300 bg-fuchsia-300/10 shadow-[0_0_22px_#e879f920]' : 'border-white/10 bg-white/[.025]'}`}><span className="flex items-center justify-between"><b className="text-fuchsia-100">Phrase timeline</b>{lyricSettings.source === 'phrases' && <em className="rounded-full bg-fuchsia-300/15 px-2 py-1 text-[9px] font-bold not-italic text-fuchsia-200">LIVE SOURCE</em>}</span><small className="mt-2 block leading-relaxed text-slate-400">Uses the complete sentences below. Phrase start/end times drive the character-by-character karaoke highlight.</small></button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#050817] p-3"><span className="mr-auto text-xs text-slate-400"><b className="text-white">{activePhrases.length}</b> gameplay phrase{activePhrases.length === 1 ? '' : 's'} currently produced</span><button onClick={rebuild} disabled={!notePhrases.length} className="rounded-lg border border-cyan-300/30 px-3 py-2 text-xs font-semibold text-cyan-100 disabled:opacity-40">Build phrase timeline from note lyrics</button><button onClick={addPhrase} className="rounded-lg border border-fuchsia-300/30 bg-fuchsia-300/10 px-3 py-2 text-xs font-semibold text-fuchsia-100">+ Add phrase</button></div>
        {lyricSettings.source === 'notes' && <div className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-300/[.05] p-4"><b className="text-sm text-cyan-100">Live preview from piano-roll notes</b><p className="mt-1 text-xs text-slate-400">Edit an individual target by selecting its note and changing <b>Lyrics</b> in the Inspector. Save the arrangement before starting a new game.</p><div className="mt-3 space-y-2">{notePhrases.map((phrase, index) => <div key={`${phrase.start}-${index}`} className="grid gap-2 rounded-lg border border-white/10 bg-black/15 p-3 sm:grid-cols-[72px_1fr]"><span className="font-mono text-[10px] text-cyan-300">{formatClock(phrase.start)}<br />{formatClock(phrase.end)}</span><p className="text-sm text-white">{phrase.primary}</p></div>)}</div></div>}
        <div className={`${lyricSettings.source === 'notes' ? 'mt-5 border-t border-white/10 pt-5' : 'mt-4'}`}><div className="mb-3 flex items-end justify-between gap-3"><span><b className="text-sm text-white">Phrase timeline editor</b><small className="mt-1 block text-slate-400">Editing any row makes Phrase timeline the live source.</small></span></div>
          <div className="space-y-3">{phrases.map((phrase, index) => <article key={index} className="rounded-xl border border-white/10 bg-white/[.025] p-3"><div className="grid gap-3 lg:grid-cols-[44px_minmax(240px,1fr)_110px_110px_auto]"><span className="grid h-10 w-10 place-items-center rounded-lg bg-fuchsia-300/10 font-mono text-sm font-bold text-fuchsia-200">{index + 1}</span><label className="text-[9px] font-bold uppercase tracking-[.12em] text-slate-500">Sentence / phrase<textarea value={phrase.primary} onFocus={onHistory} onChange={event => updatePhrase(index, { primary: event.target.value })} rows={2} className="mt-1 block w-full resize-y rounded-lg border border-white/15 bg-[#050817] px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-300" /></label><label className="text-[9px] font-bold uppercase tracking-[.12em] text-slate-500">Start (seconds)<input type="number" min="0" step="0.01" value={phrase.start} onFocus={onHistory} onChange={event => updatePhrase(index, { start: Math.max(0, Number(event.target.value) || 0) })} className="mt-1 block w-full rounded-lg border border-white/15 bg-[#050817] px-3 py-2 text-sm text-white" /></label><label className="text-[9px] font-bold uppercase tracking-[.12em] text-slate-500">End (seconds)<input type="number" min="0" step="0.01" value={phrase.end} onFocus={onHistory} onChange={event => updatePhrase(index, { end: Math.max(phrase.start + .01, Number(event.target.value) || phrase.start + .01) })} className="mt-1 block w-full rounded-lg border border-white/15 bg-[#050817] px-3 py-2 text-sm text-white" /></label><button onClick={() => removePhrase(index)} className="self-end rounded-lg border border-rose-300/25 px-3 py-2 text-xs text-rose-200">Remove</button></div></article>)}{!phrases.length && <div className="rounded-xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-500">No phrase rows yet. Build them from note lyrics or add the first phrase manually.</div>}</div>
        </div>
      </div>
      <footer className="flex flex-wrap items-center gap-3 border-t border-white/10 bg-[#050817] px-5 py-3 text-xs text-slate-400"><span className="mr-auto">Press the main <b className="text-white">Save</b> button after closing this window to publish these lyrics to gameplay.</span><button onClick={onClose} className="rounded-lg bg-[linear-gradient(90deg,#d946ef,#38bdf8)] px-5 py-2 font-bold text-white">Done editing</button></footer>
    </section>
  </div>;
}

function LyricLineDialog({ targetCount, targetLabel, onApply, onClose }: { targetCount: number; targetLabel: string; onApply: (line: string) => void; onClose: () => void }) {
  const [line, setLine] = useState('');
  const preview = splitIntoSyllables(line);
  return <div className="absolute inset-0 z-40 grid place-items-center bg-[#020510]/85 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label="Type lyrics onto notes" className="w-full max-w-2xl overflow-hidden rounded-2xl border border-amber-300/30 bg-[#08101f] shadow-[0_0_60px_#f59e0b20]">
      <header className="border-b border-white/10 px-5 py-4">
        <p className="text-[10px] font-bold tracking-[.2em] text-amber-300">TYPE LYRICS</p>
        <h2 className="mt-1 text-lg font-semibold">Lay a line across {targetCount} note{targetCount === 1 ? '' : 's'}</h2>
        <p className="mt-1 text-xs text-slate-400">{targetLabel}</p>
      </header>
      <div className="space-y-3 px-5 py-4">
        <textarea autoFocus value={line} onChange={event => setLine(event.target.value)} rows={3}
          placeholder="Al-le-lu-ia, praise his name"
          className="w-full resize-y rounded-xl border border-white/15 bg-[#050817] px-4 py-3 text-base text-white outline-none focus:border-amber-300/70" />
        <div className="rounded-xl border border-white/10 bg-white/[.03] p-3 text-xs leading-relaxed text-slate-400">
          One fragment per note, in time order. A <b className="text-amber-200">hyphen</b> splits a word across notes and stays on
          the first part, so <code className="text-amber-200">mer-cies</code> becomes <code className="text-amber-200">mer-</code>
          {' '}then <code className="text-amber-200">cies</code>. An <b className="text-amber-200">underscore</b> leaves a note
          empty, which is how one syllable is held over several notes.
        </div>
        {preview.length > 0 && <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">{preview.length} fragment{preview.length === 1 ? '' : 's'} for {targetCount} note{targetCount === 1 ? '' : 's'}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {preview.map((syllable, index) => <span key={index} className={`rounded-md border px-2 py-1 font-mono text-xs ${index < targetCount ? 'border-amber-300/30 bg-amber-300/[.08] text-amber-100' : 'border-rose-300/40 bg-rose-400/10 text-rose-200'}`}>{syllable || '·'}</span>)}
          </div>
          {preview.length > targetCount && <p className="mt-2 text-xs text-rose-300">The last {preview.length - targetCount} would have no note to sit on.</p>}
          {preview.length < targetCount && <p className="mt-2 text-xs text-slate-500">The remaining {targetCount - preview.length} note{targetCount - preview.length === 1 ? '' : 's'} will be left empty.</p>}
        </div>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
        <button onClick={onClose} className="rounded-lg border border-white/15 px-4 py-2 text-xs">Cancel</button>
        <button onClick={() => onApply(line)} disabled={!line.trim()} className="rounded-lg border border-amber-300/40 bg-amber-300/10 px-4 py-2 text-xs font-semibold text-amber-100 disabled:opacity-40">Place on notes</button>
      </footer>
    </section>
  </div>;
}

/**
 * The MuseScore-shaped entry strip: pick a value (buttons or the numbers
 * 3–7), and every button is annotated against the room LEFT in the caret's
 * bar — the one that exactly fills it says so, the ones that spill are
 * marked as tying into the next bar. With Step entry on, letters A–G enter
 * pitches in the song's key at the caret, R rests forward, arrows adjust.
 */
function ExpressionBar({ selection, onDynamic, onToggle, onSpan, onTempo, chord, onChord, onBand, onClear, bandBarNumber }: {
  selection: SongNote[];
  onDynamic: (dynamic: DynamicMark | null) => void;
  onToggle: (key: 'staccato' | 'tenuto' | 'fermata' | 'slide') => void;
  onSpan: (kind: 'slur' | 'cresc' | 'decresc') => void;
  onTempo: (kind: TempoMarkKind) => void;
  chord: string;
  onChord: (symbol: string) => void;
  onBand: (field: 'instrument' | 'drums', value: string) => void;
  onClear: () => void;
  /** The printed number of the bar a band instruction here would start in. */
  bandBarNumber?: number;
}) {
  const bandMark = selection[0]?.marks?.band;
  const activeTempo = selection[0]?.marks?.tempo;
  const tempoButton = (kind: TempoMarkKind, label: string, title: string) =>
    <button onClick={() => onTempo(kind)} title={title}
      className={`rounded-lg border px-2.5 py-1.5 font-serif italic ${activeTempo === kind ? 'border-sky-300/60 bg-sky-300/15 text-sky-100' : 'border-white/12 text-slate-300 hover:bg-white/[.06]'}`}>{label}</button>;
  const DYNAMICS: DynamicMark[] = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
  const activeDynamic = selection.every(note => note.marks?.dynamic === selection[0]?.marks?.dynamic) ? selection[0]?.marks?.dynamic : undefined;
  const allHave = (key: 'staccato' | 'tenuto' | 'fermata' | 'slide') => selection.every(note => note.marks?.[key]);
  const voices = [...selection.reduce((map, note) => { const list = map.get(note.part) ?? []; list.push(note); map.set(note.part, list); return map; }, new Map<number, SongNote[]>()).values()].filter(list => list.length >= 2);
  const spanReady = voices.length > 0;
  const spanned = (kind: 'slur' | 'cresc' | 'decresc') => spanReady && voices.every(list => kind === 'slur'
    ? list[0].marks?.slur === 'start' && list[list.length - 1].marks?.slur === 'end'
    : list[0].marks?.hairpin === kind && list[list.length - 1].marks?.hairpin === 'end');
  const toggleClass = (on: boolean) => `rounded-lg border px-2.5 py-1.5 ${on ? 'border-amber-300/60 bg-amber-300/15 text-amber-100' : 'border-white/12 text-slate-300 hover:bg-white/[.06]'}`;
  return <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-300/20 bg-[#0a0d1f] px-3 py-2 text-xs">
    <span className="text-[9px] font-black uppercase tracking-[.18em] text-amber-200/80">Expression · {selection.length} note{selection.length === 1 ? '' : 's'}</span>
    <span className="flex overflow-hidden rounded-lg border border-white/12">
      {DYNAMICS.map(dynamic => <button key={dynamic} onClick={() => onDynamic(activeDynamic === dynamic ? null : dynamic)}
        title={{ pp: 'Pianissimo — very soft', p: 'Piano — soft', mp: 'Mezzo-piano', mf: 'Mezzo-forte', f: 'Forte — loud', ff: 'Fortissimo — very loud' }[dynamic]}
        className={`px-2 py-1.5 font-serif italic font-black ${activeDynamic === dynamic ? 'bg-amber-300/25 text-amber-100' : 'text-slate-300 hover:bg-white/[.06]'}`}>{dynamic}</button>)}
    </span>
    <button onClick={() => onToggle('staccato')} title="Staccato — detached, half length in playback" className={toggleClass(allHave('staccato'))}>·&nbsp;Staccato</button>
    <button onClick={() => onToggle('tenuto')} title="Tenuto — sustain the note its full written length" className={toggleClass(allHave('tenuto'))}>–&nbsp;Sustain</button>
    <button onClick={() => onToggle('fermata')} title="Fermata — the pause, engraved over the note" className={toggleClass(allHave('fermata'))}>{'\u{1D110}'}&nbsp;Pause</button>
    <button onClick={() => onToggle('slide')} title="Slide (portamento) — glide out of this note into the next note of the same voice. Drawn as a glide line in the score; the preview voice bends its pitch through the join." className={toggleClass(allHave('slide'))}>⟋&nbsp;Slide</button>
    <span className="h-5 w-px bg-white/10" />
    <button onClick={() => onSpan('slur')} disabled={!spanReady} title="Slur / legato — one arc over the selected notes. Ctrl-click 2 or more notes in a voice; selecting several voices slurs each of them." className={`${toggleClass(spanned('slur'))} disabled:opacity-35`}>⌒&nbsp;Slur</button>
    <button onClick={() => onSpan('cresc')} disabled={!spanReady} title="Crescendo — grow through the selected notes. Ctrl-click 2 or more notes in a voice; selecting several voices swells them together." className={`${toggleClass(spanned('cresc'))} disabled:opacity-35`}>&lt;&nbsp;Cresc.</button>
    <button onClick={() => onSpan('decresc')} disabled={!spanReady} title="Decrescendo — fade through the selected notes. Ctrl-click 2 or more notes in a voice; selecting several voices fades them together." className={`${toggleClass(spanned('decresc'))} disabled:opacity-35`}>&gt;&nbsp;Decresc.</button>
    <span className="h-5 w-px bg-white/10" />
    <label className="flex items-center gap-1.5" title="Guitar/piano chord at the first selected note. Type Em, G/B, Cmaj7 and press Enter; engraved above the staff and strummed under playback. Empty removes it.">
      <span className="text-[9px] font-black uppercase tracking-[.14em] text-slate-500">Chord</span>
      <input key={selection[0]?.id ?? 'none'} defaultValue={chord} placeholder="Em"
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onChord((event.target as HTMLInputElement).value); } }}
        className="w-16 rounded-lg border border-white/12 bg-black/25 px-2 py-1.5 text-center font-bold text-white" />
    </label>
    <span className="h-5 w-px bg-white/10" />
    {tempoButton('rit', 'rit.', 'Ritardando — gradually slow down from the first selected note until the next tempo mark (or the end)')}
    {tempoButton('accel', 'accel.', 'Accelerando — gradually speed up from the first selected note until the next tempo mark')}
    {tempoButton('atempo', 'a tempo', 'A tempo — return to the written speed from the first selected note')}
    {tempoButton('allegro', 'Allegro', 'Allegro — brisk (about 5/4 of the written speed) from the first selected note')}
    <span className="h-5 w-px bg-white/10" />
    <span className="flex items-center gap-2 rounded-lg border border-rose-300/25 bg-rose-300/[.06] px-2 py-1"
      title="The band, from this note's bar onward. Whatever you pick here plays until a later note changes it or says Stop — it is one rhythm section for the whole choir, not per voice. The lane under the bass staff shows exactly what it plays.">
      <span className="text-[9px] font-black uppercase tracking-[.14em] text-rose-200/90">Band from bar {bandBarNumber ?? '?'}</span>
      <label className="flex items-center gap-1">
        <span className="text-[10px]">🎸</span>
        <select value={bandMark?.instrument ?? ''} onChange={event => onBand('instrument', event.target.value)}
          className="max-w-36 rounded border border-white/15 bg-black/30 px-1 py-1 text-[10px] text-white">
          <option value="">(keep playing)</option>
          {INSTRUMENT_STYLES.filter(style => style.id !== 'off').map(style => <option key={style.id} value={style.id}>{style.label}</option>)}
          <option value="stop">🚫 Stop the instrument</option>
        </select>
      </label>
      <label className="flex items-center gap-1">
        <span className="text-[10px]">🥁</span>
        <select value={bandMark?.drums ?? ''} onChange={event => onBand('drums', event.target.value)}
          className="max-w-36 rounded border border-white/15 bg-black/30 px-1 py-1 text-[10px] text-white">
          <option value="">(keep playing)</option>
          {DRUM_STYLES.filter(style => style.id !== 'off').map(style => <option key={style.id} value={style.id}>{style.label}</option>)}
          <option value="stop">🚫 Stop the drums</option>
        </select>
      </label>
    </span>
    <button onClick={onClear} title="Remove every marking from the selection" className="rounded-lg border border-rose-300/25 px-2.5 py-1.5 text-rose-200">✕ Clear</button>
  </div>;
}

function NoteEntryPalette({ snapValue, onValue, stepInput, onStepInput, caretLabel, voiceName, remainingQuarters, barFill, onFillBar, onRest, completion }: {
  snapValue: RhythmicNoteValue; onValue: (value: RhythmicNoteValue) => void;
  stepInput: boolean; onStepInput: (value: boolean) => void;
  caretLabel: string; voiceName: string; remainingQuarters: number; barFill: number;
  onFillBar: () => void; onRest: () => void;
  completion: { symbol: string; short: string } | null;
}) {
  const bases: Array<{ base: RhythmicNoteValue; key: string }> = [
    { base: 'whole', key: '7' }, { base: 'half', key: '6' }, { base: 'quarter', key: '5' },
    { base: 'eighth', key: '4' }, { base: 'sixteenth', key: '3' },
  ];
  const dotted = snapValue.startsWith('dotted-');
  const triplet = snapValue.endsWith('-triplet');
  const activeBase = (dotted ? snapValue.slice(7) : triplet ? snapValue.slice(0, -8) : snapValue) as RhythmicNoteValue;
  const fraction = (quarters: number) => {
    const whole = Math.floor(quarters + 1e-6);
    const rem = quarters - whole;
    if (rem > .94) return String(whole + 1);
    const part = Math.abs(rem - .5) < .06 ? '½' : Math.abs(rem - .25) < .06 ? '¼' : Math.abs(rem - .75) < .06 ? '¾' : rem > .06 ? `~${rem.toFixed(2)}` : '';
    return whole ? `${whole}${part}` : (part || '0');
  };
  return <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#080b1d] px-3 py-2 text-xs">
    <button onClick={() => onStepInput(!stepInput)}
      className={`rounded-lg border px-3 py-1.5 font-bold ${stepInput ? 'border-emerald-300/60 bg-emerald-300/15 text-emerald-100' : 'border-white/15 text-slate-300'}`}
      title="MuseScore-style typing: numbers 3–7 pick the value, letters A–G enter pitches in the song's key, R rests forward, ↑↓ adjust the last note, . toggles the dot">
      {stepInput ? '● Step entry ON' : 'Step entry'}</button>
    <span className="flex items-center overflow-hidden rounded-lg border border-fuchsia-300/30">
      {bases.map(({ base, key }) => {
        const definition = NOTE_VALUES.find(item => item.value === (dotted ? `dotted-${base}` : base)) ?? NOTE_VALUES.find(item => item.value === base)!;
        const quarters = definition.quarterBeats;
        const fills = Math.abs(quarters - remainingQuarters) < .05 && remainingQuarters > .05;
        const spills = quarters > remainingQuarters + .05;
        const active = activeBase === base;
        return <button key={base} onClick={() => onValue(definition.value)}
          title={`${definition.label} (${key})${fills ? ' — exactly fills this bar' : spills ? ' — ties into the next bar' : ''}`}
          className={`relative px-2.5 py-1.5 font-['Segoe_UI_Symbol','Noto_Music',serif] text-base leading-none ${active ? 'bg-fuchsia-400/25 text-white' : 'text-slate-300 hover:bg-white/[.06]'} ${fills ? 'text-emerald-200' : ''} ${spills ? 'text-amber-200/80' : ''}`}>
          {definition.symbol}
          <sub className="ml-0.5 align-sub text-[8px] text-slate-500">{key}</sub>
          {fills && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded bg-emerald-300" />}
        </button>;
      })}
      <button onClick={() => { const map: Record<string, RhythmicNoteValue> = { 'whole': 'dotted-whole', 'half': 'dotted-half', 'quarter': 'dotted-quarter', 'eighth': 'dotted-eighth', 'sixteenth': 'dotted-sixteenth' }; onValue(dotted ? activeBase : (map[activeBase] ?? activeBase)); }}
        title="Dot the value (.)" className={`px-2.5 py-1.5 text-base leading-none ${dotted ? 'bg-cyan-300/25 text-cyan-100' : 'text-slate-400 hover:bg-white/[.06]'}`}>·</button>
      <button onClick={() => { const map: Record<string, RhythmicNoteValue> = { 'half': 'half-triplet', 'quarter': 'quarter-triplet', 'eighth': 'eighth-triplet', 'sixteenth': 'sixteenth-triplet' }; onValue(triplet ? activeBase : (map[activeBase] ?? activeBase)); }}
        title="Triplet — three of these in the time of two. Enter three in a row to fill the beat; they engrave with the little 3." className={`px-2 py-1.5 text-[11px] font-black italic leading-none ${triplet ? 'bg-fuchsia-300/25 text-fuchsia-100' : 'text-slate-400 hover:bg-white/[.06]'}`}>3</button>
    </span>
    {completion && <span className="flex items-center gap-1 rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-2 py-1 text-[10px] text-cyan-100"
      title="The chosen value would cross the beat, so the next entry automatically uses the value that completes this beat — the classic pairing: a dotted quaver takes a semiquaver, a quaver takes a quaver.">
      auto <b className="font-['Segoe_UI_Symbol','Noto_Music',serif] text-sm">{completion.symbol}</b> completes the beat</span>}
    <span className="ml-1 flex min-w-44 items-center gap-2 text-[10px] text-slate-400">
      <span><b className="text-slate-200">{voiceName}</b> · next entry {caretLabel} · <b className={remainingQuarters > .05 ? 'text-cyan-200' : 'text-slate-500'}>{fraction(remainingQuarters)} beat{Math.abs(remainingQuarters - 1) < .05 ? '' : 's'} left in the bar</b></span>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-cyan-300/70" style={{ width: `${Math.round(barFill * 100)}%` }} /></span>
    </span>
    <button onClick={onFillBar} disabled={remainingQuarters < .12}
      title="Enter one note on the previous pitch lasting exactly the rest of this bar"
      className="rounded-lg border border-cyan-300/30 px-2.5 py-1.5 text-cyan-100 disabled:opacity-30">Fill rest of bar</button>
    <button onClick={onRest} title="Move the entry point forward by the selected value without a note (R)"
      className="rounded-lg border border-white/15 px-2.5 py-1.5 text-slate-300">Rest →</button>
  </div>;
}

function HarmonyDialog({ noteCounts, selectedPart, selectionCount, onApply, onClose }: { noteCounts: number[]; selectedPart: number; selectionCount: number; onApply: (from: number, to: number, semitones: number) => void; onClose: () => void }) {
  const [from, setFrom] = useState(selectedPart);
  const [to, setTo] = useState((selectedPart + 1) % 4);
  const [semitones, setSemitones] = useState(-4);
  return <div className="absolute inset-0 z-40 grid place-items-center bg-[#020510]/85 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label="Build a harmony part" className="w-full max-w-2xl overflow-hidden rounded-2xl border border-emerald-300/30 bg-[#08101f] shadow-[0_0_60px_#10b98120]">
      <header className="border-b border-white/10 px-5 py-4">
        <p className="text-[10px] font-bold tracking-[.2em] text-emerald-300">HARMONY</p>
        <h2 className="mt-1 text-lg font-semibold">Copy a line into another voice</h2>
        <p className="mt-1 text-xs text-slate-400">Words and timing come with it. {selectionCount > 0 ? `${selectionCount} note${selectionCount === 1 ? '' : 's'} selected, so only those are copied.` : 'Nothing selected, so the whole voice is copied.'}</p>
      </header>
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
        <label className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-500">From
          <select value={from} onChange={event => setFrom(Number(event.target.value))} className="mt-1 block w-full rounded-lg border border-white/15 bg-[#050817] px-3 py-2 text-sm text-white">
            {VOICES.map((voice, index) => <option key={voice} value={index}>{voice} ({noteCounts[index]})</option>)}
          </select>
        </label>
        <label className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-500">Interval
          <select value={semitones} onChange={event => setSemitones(Number(event.target.value))} className="mt-1 block w-full rounded-lg border border-white/15 bg-[#050817] px-3 py-2 text-sm text-white">
            {HARMONY_INTERVALS.map(interval => <option key={interval.semitones} value={interval.semitones}>{interval.label}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-500">Into
          <select value={to} onChange={event => setTo(Number(event.target.value))} className="mt-1 block w-full rounded-lg border border-white/15 bg-[#050817] px-3 py-2 text-sm text-white">
            {VOICES.map((voice, index) => <option key={voice} value={index}>{voice} ({noteCounts[index]})</option>)}
          </select>
        </label>
      </div>
      <div className="px-5 pb-4">
        <p className="rounded-xl border border-amber-300/30 bg-amber-300/[.07] px-3 py-2 text-xs leading-relaxed text-amber-200">
          Every note moves by the same interval. That is a parallel harmony and a sound starting point, but it does not follow the
          key, so some notes will want nudging by ear afterwards.
        </p>
        {from === to && <p className="mt-2 text-xs text-rose-300">Choose two different voices.</p>}
        {noteCounts[to] > 0 && from !== to && <p className="mt-2 text-xs text-slate-500">{VOICES[to]} already has {noteCounts[to]} note{noteCounts[to] === 1 ? '' : 's'}; any inside the copied span are replaced. Undo puts them back.</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
        <button onClick={onClose} className="rounded-lg border border-white/15 px-4 py-2 text-xs">Cancel</button>
        <button onClick={() => onApply(from, to, semitones)} disabled={from === to || !noteCounts[from]} className="rounded-lg border border-emerald-300/40 bg-emerald-300/10 px-4 py-2 text-xs font-semibold text-emerald-100 disabled:opacity-40">Copy into {VOICES[to]}</button>
      </footer>
    </section>
  </div>;
}

function KaraokePhraseControls({ settings, onChange }: { settings: BackingTrackSettings; onChange: (value: NonNullable<BackingTrackSettings['karaoke_lyrics']>) => void }) {
  const value = { targets_per_phrase: settings.karaoke_lyrics?.targets_per_phrase ?? DEFAULT_TARGETS_PER_PHRASE, max_lines: settings.karaoke_lyrics?.max_lines ?? 2 as 1 | 2, source: settings.karaoke_lyrics?.source ?? 'phrases' as 'phrases' | 'notes' };
  return <section className="rounded-xl border border-cyan-300/20 bg-[linear-gradient(135deg,#071729,#120d29)] p-3">
    <div className="flex flex-wrap items-start gap-4"><span className="mr-auto"><b className="block text-sm text-white">Gameplay lyric phrases</b><small className="text-slate-400">Choose how many timed lyric targets appear together. The same phrase sequence is retained after refresh.</small></span>
      <label className="text-[10px] font-bold uppercase tracking-[.12em] text-cyan-300">Targets per phrase<input type="number" min={4} max={20} value={value.targets_per_phrase} onChange={event => onChange({ ...value, targets_per_phrase: Math.max(4, Math.min(20, Math.round(Number(event.target.value) || 10))) })} className="mt-1 block w-24 rounded-lg border border-white/15 bg-[#070b1d] px-3 py-2 text-sm text-white" /></label>
      <label className="text-[10px] font-bold uppercase tracking-[.12em] text-cyan-300">Display lines<select value={value.max_lines} onChange={event => onChange({ ...value, max_lines: Number(event.target.value) === 1 ? 1 : 2 })} className="mt-1 block w-32 rounded-lg border border-white/15 bg-[#070b1d] px-3 py-2 text-sm text-white"><option value={1}>One line</option><option value={2}>Up to two lines</option></select></label>
    </div>
  </section>;
}

function Brand() { return <b className="text-xl">VOCAL<span className="text-fuchsia-400">Hero</span></b>; }
function VoiceStrip({ name, index, active, onClick }: { name: string; index: number; active: boolean; onClick: () => void }) { return <button onClick={onClick} className="w-full rounded-xl border p-3 text-left" style={{ borderColor: active ? COLOURS[index] : `${COLOURS[index]}55`, background: active ? `${COLOURS[index]}19` : `${COLOURS[index]}08` }}><div className="flex items-center gap-2"><b className="text-2xl" style={{ color: COLOURS[index] }}>{name[0]}</b><span><b className="block text-xs" style={{ color: COLOURS[index] }}>{name.toUpperCase()}</b><span className="text-[10px] text-slate-500">⌁ mic · active</span></span></div><div className="mt-3 h-1 rounded-full bg-white/10"><span className="block h-full w-2/3 rounded-full" style={{ background: COLOURS[index] }} /></div></button>; }
function MusicalTimelineControls({ timeline, cursor, state, onTempo, onMeter, onKey, onSnapDivision, onNoteValue, onLatchAll, onRemove }: { timeline: MusicalTimelineSettings; cursor: number; state: MusicalState; onTempo: (bpm: number) => void; onMeter: (numerator: number, denominator: number) => void; onKey: (tonic: string, mode: string) => void; onSnapDivision: (division: NoteDivision) => void; onNoteValue: (value: RhythmicNoteValue) => void; onLatchAll: () => void; onRemove: (kind: 'tempo' | 'meter' | 'key', at: number) => void }) {
  const [bpmDraft, setBpmDraft] = useState(String(state.bpm));
  const [numeratorDraft, setNumeratorDraft] = useState(String(state.numerator));
  useEffect(() => setBpmDraft(String(state.bpm)), [state.bpm]);
  useEffect(() => setNumeratorDraft(String(state.numerator)), [state.numerator]);
  const commitBpm = () => { const value = Math.max(20, Math.min(400, Number(bpmDraft) || state.bpm)); setBpmDraft(String(value)); onTempo(value); };
  const commitNumerator = () => { const value = Math.max(1, Math.min(32, Math.round(Number(numeratorDraft) || state.numerator))); setNumeratorDraft(String(value)); onMeter(value, state.denominator); };
  const changes = [
    ...timeline.tempo_changes.filter(item => item.at > 0).map(item => ({ kind: 'tempo' as const, at: item.at, label: `${item.bpm} BPM` })),
    ...timeline.meter_changes.filter(item => item.at > 0).map(item => ({ kind: 'meter' as const, at: item.at, label: `${item.numerator}/${item.denominator}` })),
    ...timeline.key_changes.filter(item => item.at > 0).map(item => ({ kind: 'key' as const, at: item.at, label: `${item.tonic} ${item.mode}` })),
  ].sort((a, b) => a.at - b.at);
  const selectedValue = noteValue(timeline.snap_value ?? DEFAULT_NOTE_VALUE);
  const field = 'rounded-lg border border-white/15 bg-[#070b1d] px-2 py-2 text-sm font-semibold text-white outline-none focus:border-fuchsia-300/70 focus:ring-2 focus:ring-fuchsia-400/15';
  return <details open className="mb-3 rounded-xl border border-fuchsia-300/20 bg-[linear-gradient(135deg,#15102e,#081326)] text-xs shadow-[0_8px_24px_#0006]">
    <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5"><span className="grid h-8 w-8 place-items-center rounded-lg bg-fuchsia-400/15 text-lg text-fuchsia-200">♩</span><span><b className="block text-sm text-white">Musical timeline</b><small className="text-slate-400">Editable BPM, metre and key at the playhead</small></span><span className="ml-auto rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 font-mono text-cyan-100">Cursor {formatClock(cursor)}</span></summary>
    <div className="grid grid-cols-1 gap-3 border-t border-white/10 p-3 sm:grid-cols-2 xl:grid-cols-[140px_180px_220px_minmax(300px,1.5fr)_210px]">
      <label className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">Quarter-note BPM<input aria-label="BPM at cursor" value={bpmDraft} onChange={event => setBpmDraft(event.target.value)} onBlur={commitBpm} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} inputMode="numeric" className={`${field} mt-1 w-full`} /></label>
      <label className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">Time signature<span className="mt-1 flex items-center gap-1"><input aria-label="Time signature numerator" value={numeratorDraft} onChange={event => setNumeratorDraft(event.target.value)} onBlur={commitNumerator} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} inputMode="numeric" className={`${field} min-w-0 flex-1 text-center`} /><b className="text-lg text-slate-500">/</b><select aria-label="Time signature denominator" value={state.denominator} onChange={event => onMeter(state.numerator, Number(event.target.value))} className={`${field} min-w-0 flex-1 text-center`}>{[1, 2, 4, 8, 16, 32].map(value => <option key={value}>{value}</option>)}</select></span></label>
      <label className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">Key at cursor<span className="mt-1 flex gap-1"><select aria-label="Key tonic" value={state.tonic} onChange={event => onKey(event.target.value, state.mode)} className={`${field} min-w-0 flex-1`}>{KEY_TONICS.map(value => <option key={value}>{value}</option>)}</select><select aria-label="Key mode" value={state.mode} onChange={event => onKey(state.tonic, event.target.value)} className={`${field} min-w-0 flex-[1.4]`}>{KEY_MODES.map(value => <option key={value}>{value}</option>)}</select></span></label>
      <label className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">Default drawn length<span className="mt-1 flex gap-1"><select aria-label="Rhythmic note value" value={selectedValue.value} onChange={event => onNoteValue(event.target.value as RhythmicNoteValue)} className={`${field} min-w-0 flex-1 font-['Segoe_UI_Symbol','Noto_Music',sans-serif] text-base`}>{NOTE_VALUE_GROUPS.map(group => <optgroup key={group} label={group}>{NOTE_VALUES.filter(item => item.group === group).map(item => <option key={item.value} value={item.value}>{item.symbol}  {item.label}</option>)}</optgroup>)}</select><button type="button" onClick={onLatchAll} title="Set every note to this displayed value" className="rounded-lg border border-fuchsia-300/30 bg-fuchsia-400/10 px-2 text-fuchsia-100">Latch all</button></span><small className="mt-1 block normal-case tracking-normal text-cyan-200/75"><span className="mr-1 font-['Segoe_UI_Symbol','Noto_Music',serif] text-base text-fuchsia-200">{selectedValue.symbol}</span>{rhythmicCompanionHint(selectedValue.value)}.</small></label>
      <label className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">Placement grid<select aria-label="Rhythmic placement grid" value={timeline.snap_division ?? DEFAULT_SNAP_DIVISION} onChange={event => onSnapDivision(Number(event.target.value) as NoteDivision)} className={`${field} mt-1 w-full`}>{GRID_DIVISIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><small className="mt-1 block normal-case tracking-normal text-slate-500">Independent of note length for dotted and tuplet rhythms.</small></label>
    </div>
    {changes.length > 0 && <div className="flex flex-wrap items-center gap-2 border-t border-white/[.07] px-3 py-2"><span className="mr-1 text-[10px] font-bold uppercase tracking-[.12em] text-slate-500">Later changes</span>{changes.map(change => <button key={`${change.kind}-${change.at}`} onClick={() => onRemove(change.kind, change.at)} title="Remove this musical change" className="rounded-full border border-white/10 bg-white/[.04] px-2.5 py-1 text-slate-300 hover:border-rose-300/40 hover:text-rose-200"><b className="mr-1 text-cyan-200">{formatClock(change.at)}</b>{change.label} ×</button>)}</div>}
  </details>;
}
function BeatPrecisionPanel({ selectedNotes, bars, cursor, clipboardCount, onCopy, onPaste }: { selectedNotes: SongNote[]; bars: MusicalBar[]; cursor: number; clipboardCount: number; onCopy: () => void; onPaste: () => void }) {
  const primary = selectedNotes[0];
  const position = primary ? beatPositionAt(bars, primary.start) : beatPositionAt(bars, cursor);
  const hold = primary ? durationInBeats(bars, primary.start, primary.end) : 0;
  const detectedRhythm = primary ? closestNoteValue(bars, primary.start, primary.end) : null;
  const rhythmError = primary && detectedRhythm ? detectedRhythm.error / Math.max(.001, primary.end - primary.start) : 0;
  const stateLabel = position ? beatOffsetLabel(position.fraction) : 'NO POSITION';
  const onGrid = stateLabel !== 'NO POSITION' && !stateLabel.startsWith('OFF GRID');
  return <section className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-cyan-300/20 bg-[linear-gradient(90deg,#071729,#11102d)] px-3 py-2.5 text-xs shadow-[0_8px_24px_#0005]" aria-label="Beat precision" aria-live="polite">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 font-mono text-lg font-black text-cyan-100">{position?.beat ?? '·'}</span>
    <span><b className="block text-[10px] uppercase tracking-[.15em] text-cyan-300">{primary ? `${selectedNotes.length} selected note${selectedNotes.length === 1 ? '' : 's'}` : 'Paste destination'}</b><span className="font-semibold text-white">{primary ? `${midiNoteName(primary.midi)} · ${primary.lyric || 'Note'}` : `Playhead ${formatClock(cursor)}`}</span></span>
    <span className="h-8 w-px bg-white/10" />
    <span><small className="block text-[9px] uppercase tracking-[.12em] text-slate-500">Bar · beat</small><b className="font-mono text-base text-white">{compactBeatLabel(position)}</b></span>
    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black tracking-[.08em] ${onGrid ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200' : 'border-amber-300/35 bg-amber-300/10 text-amber-100'}`}>{stateLabel}</span>
    {primary && <><span title="Nearest written rhythmic value; exact imported MIDI timing remains unchanged"><small className="block text-[9px] uppercase tracking-[.12em] text-slate-500">Rhythm value</small><b className="text-sm text-violet-100"><span className="mr-1 font-['Segoe_UI_Symbol','Noto_Music',serif] text-lg leading-none text-fuchsia-200">{detectedRhythm?.item.symbol}</span>{rhythmError > .08 ? '≈ ' : ''}{detectedRhythm?.item.short}</b></span><span><small className="block text-[9px] uppercase tracking-[.12em] text-slate-500">Hold length</small><b className="font-mono text-sm text-fuchsia-200">{hold.toFixed(2)} beats</b></span><span><small className="block text-[9px] uppercase tracking-[.12em] text-slate-500">Exact time</small><b className="font-mono text-[11px] text-slate-200">{primary.start.toFixed(3)}s–{primary.end.toFixed(3)}s</b></span></>}
    <span className="ml-auto flex items-center gap-2"><button onClick={onCopy} disabled={!selectedNotes.length} className="rounded-lg border border-cyan-300/25 px-3 py-2 text-cyan-100 disabled:opacity-35">Copy <kbd className="ml-1 text-[9px] text-slate-400">Ctrl+C</kbd></button><button onClick={onPaste} disabled={!clipboardCount} title="Pastes the earliest copied note at the current playhead" className="rounded-lg border border-fuchsia-300/35 bg-fuchsia-300/10 px-3 py-2 text-fuchsia-100 disabled:opacity-35">Paste here <kbd className="ml-1 text-[9px] text-slate-400">Ctrl+V</kbd></button></span>
  </section>;
}
function DrawNoteValuePicker({ value, onChange }: { value: RhythmicNoteValue; onChange: (value: RhythmicNoteValue) => void }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressOpenedRef = useRef(false);
  const selectedValue = noteValue(value);
  const selectedIndex = Math.max(0, NOTE_VALUES.findIndex(item => item.value === selectedValue.value));
  const cycle = (direction: -1 | 1) => onChange(NOTE_VALUES[(selectedIndex + direction + NOTE_VALUES.length) % NOTE_VALUES.length].value);
  const clearHold = () => { if (holdTimerRef.current) clearTimeout(holdTimerRef.current); holdTimerRef.current = null; };
  const beginHold = () => {
    clearHold();
    longPressOpenedRef.current = false;
    holdTimerRef.current = setTimeout(() => { longPressOpenedRef.current = true; setOpen(true); }, 450);
  };
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const closeOnViewportChange = () => setOpen(false);
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnViewportChange);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnViewportChange);
    };
  }, [open]);
  useEffect(() => () => clearHold(), []);
  const rect = open ? buttonRef.current?.getBoundingClientRect() : null;
  const panelWidth = typeof window === 'undefined' ? 640 : Math.min(720, window.innerWidth - 24);
  const panelLeft = rect && typeof window !== 'undefined' ? Math.max(12, Math.min(window.innerWidth - panelWidth - 12, rect.left + rect.width / 2 - panelWidth / 2)) : 12;
  const panelTop = rect ? rect.bottom + 8 : 80;
  return <div className="flex shrink-0 items-center rounded-xl border border-fuchsia-300/35 bg-[linear-gradient(135deg,#241044,#0b1831)] p-1 shadow-[0_0_22px_#d946ef22]" aria-label="Draw note length">
    <button type="button" onClick={() => cycle(-1)} title="Previous rhythmic value" aria-label="Previous rhythmic value" className="grid h-8 w-8 place-items-center rounded-lg text-lg text-fuchsia-100 hover:bg-white/10">‹</button>
    <button ref={buttonRef} type="button" aria-haspopup="dialog" aria-expanded={open} title="Click or press and hold to open the complete note-value glossary" onPointerDown={beginHold} onPointerUp={clearHold} onPointerCancel={clearHold} onPointerLeave={clearHold} onClick={() => { if (longPressOpenedRef.current) { longPressOpenedRef.current = false; return; } setOpen(current => !current); }} className="flex min-w-40 items-center justify-center gap-2 rounded-lg border border-fuchsia-200/25 bg-fuchsia-400/10 px-3 py-1.5 text-left hover:border-fuchsia-200/50">
      <span aria-hidden="true" className="font-['Segoe_UI_Symbol','Noto_Music',serif] text-2xl leading-none text-fuchsia-200">{selectedValue.symbol}</span><span><small className="block text-[8px] font-bold uppercase tracking-[.14em] text-cyan-300">Draw note</small><b className="block whitespace-nowrap text-[11px] text-white">{selectedValue.short}</b></span><span aria-hidden="true" className="ml-1 text-slate-400">⌄</span>
    </button>
    <button type="button" onClick={() => cycle(1)} title="Next rhythmic value" aria-label="Next rhythmic value" className="grid h-8 w-8 place-items-center rounded-lg text-lg text-fuchsia-100 hover:bg-white/10">›</button>
    {open && rect && createPortal(<div ref={panelRef} role="dialog" aria-label="Rhythmic note glossary" className="fixed z-[100] overflow-y-auto rounded-2xl border border-fuchsia-300/35 bg-[#080b1d]/[.98] p-4 shadow-[0_24px_80px_#000c,0_0_45px_#a855f733] backdrop-blur-xl" style={{ left: panelLeft, top: panelTop, width: panelWidth, maxHeight: `calc(100vh - ${panelTop + 12}px)` }}>
      <div className="mb-3 flex items-start justify-between gap-4"><div><p className="text-[9px] font-bold uppercase tracking-[.2em] text-cyan-300">Draw-note glossary</p><h3 className="mt-1 text-base font-semibold text-white">Choose the next note length</h3><p className="mt-1 text-[10px] text-slate-400">Straight, dotted, double-dotted and triplet values. You can still resize any note afterward.</p></div><button type="button" onClick={() => setOpen(false)} aria-label="Close note glossary" className="rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-300">×</button></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{NOTE_VALUE_GROUPS.map(group => <section key={group} className="rounded-xl border border-white/[.08] bg-white/[.025] p-2"><h4 className="mb-2 px-1 text-[9px] font-bold uppercase tracking-[.16em] text-slate-400">{group}</h4><div className="grid gap-1">{NOTE_VALUES.filter(item => item.group === group).map(item => <button key={item.value} type="button" onClick={() => { onChange(item.value); setOpen(false); }} aria-pressed={item.value === selectedValue.value} className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-left ${item.value === selectedValue.value ? 'border-fuchsia-300/60 bg-fuchsia-400/15 text-white' : 'border-transparent text-slate-300 hover:border-cyan-300/25 hover:bg-cyan-300/[.05]'}`}><span className="w-8 shrink-0 text-center font-['Segoe_UI_Symbol','Noto_Music',serif] text-xl leading-none" style={{ color: item.value === selectedValue.value ? '#f5b8ff' : '#91e9ff' }}>{item.symbol}</span><span className="min-w-0"><b className="block text-[10px] leading-tight">{item.short}</b><small className="mt-0.5 block truncate text-[8px] text-slate-500">{item.label}</small></span></button>)}</div></section>)}</div>
    </div>, document.body)}
  </div>;
}
function EditorToolbar({ extras, tool, setTool, drawNoteValue, onDrawNoteValueChange, playScope, playParts, onPlayAll, onPlayPart, playRange, playhead, onClearSelection, selectedCount, onRemove, canUndo, canRedo, onUndo, onRedo, zoom, setZoom, onDuplicate, onCopy, onPaste, clipboardCount, onTypeLyrics, onHarmonise, onAlignToMelody, onPlay, onPlayFromStart, onPause, onStop, onSkip, isPlaying, isPaused, onRecord, recording, onPlayTake, hasTake, onConvertTake, convertingTake, recordingPart, onRecordingPartChange, transcriptionSnap, onTranscriptionSnapChange, onSave, saving }: { extras?: React.ReactNode; tool: EditorTool; setTool: (tool: EditorTool) => void; drawNoteValue: RhythmicNoteValue; onDrawNoteValueChange: (value: RhythmicNoteValue) => void; playScope: PlaybackScope; playParts: boolean[]; onPlayAll: () => void; onPlayPart: (part: number, additive?: boolean) => void; playRange: { start: number; end: number }; playhead: number | null; onClearSelection: () => void; selectedCount: number; onRemove: () => void; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; zoom: number; setZoom: (value: number) => void; onDuplicate: () => void; onCopy: () => void; onPaste: () => void; clipboardCount: number; onTypeLyrics: () => void; onHarmonise: () => void; onAlignToMelody: () => void; onPlay: () => void; onPlayFromStart: () => void; onPause: () => void; onStop: () => void; onSkip: (seconds: number) => void; isPlaying: boolean; isPaused: boolean; onRecord: () => void; recording: boolean; onPlayTake: () => void; hasTake: boolean; onConvertTake: () => void; convertingTake: boolean; recordingPart: number; onRecordingPartChange: (part: number) => void; transcriptionSnap: boolean; onTranscriptionSnapChange: (snap: boolean) => void; onSave: () => void; saving: boolean }) {
  const toolButton = (value: EditorTool, label: string) => <button onClick={() => setTool(value)} className={`rounded-lg border px-3 py-2 ${tool === value ? 'border-fuchsia-400/60 bg-fuchsia-500/20 text-fuchsia-100' : 'border-white/10 text-slate-100'}`}>{label}</button>;
  const status = playScope === 'range' ? `Range ${playRange.start.toFixed(2)}s–${playRange.end.toFixed(2)}s` : playScope === 'note' ? `${selectedCount || 1} selected note${selectedCount === 1 ? '' : 's'}` : playParts.every(Boolean) ? 'All voices' : VOICES.filter((_, index) => playParts[index]).join(' + ');
  const formatTime = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds)) % 60).padStart(2, '0')}`;
  return <div className="border-b border-white/10 bg-[#0a0c20] text-xs">
    <div className="flex h-14 items-center gap-1.5 overflow-x-auto px-3 [&>*]:shrink-0">
      <span className="flex overflow-hidden rounded-lg border border-white/12">
        {(['select', 'erase'] as EditorTool[]).map(value => <button key={value} onClick={() => setTool(value)}
          className={`px-3 py-2 capitalize ${tool === value ? 'bg-fuchsia-500/25 text-fuchsia-100' : 'text-slate-300 hover:bg-white/[.06]'}`}>{value}</button>)}
      </span>
      <span className="h-6 w-px bg-white/10" />
      <button onClick={onDuplicate} disabled={!selectedCount} title="Duplicate the selection" className="rounded-lg border border-white/10 px-2.5 py-2 disabled:opacity-40">⧉</button>
      <button onClick={onCopy} disabled={!selectedCount} title="Copy (Ctrl+C)" className="rounded-lg border border-white/10 px-2.5 py-2 disabled:opacity-40">Copy</button>
      <button onClick={onPaste} disabled={!clipboardCount} title="Paste at the playhead (Ctrl+V)" className="rounded-lg border border-white/10 px-2.5 py-2 disabled:opacity-40">Paste</button>
      <button onClick={onRemove} disabled={!selectedCount} title="Remove the selection (Delete)" className="rounded-lg border border-rose-300/30 px-2.5 py-2 text-rose-200 disabled:opacity-40">✕{selectedCount > 1 ? ` ${selectedCount}` : ''}</button>
      <span className="h-6 w-px bg-white/10" />
      <button onClick={onHarmonise} title="Copy a voice into another at an interval" className="rounded-lg border border-emerald-300/30 bg-emerald-300/[.07] px-3 py-2 text-emerald-100">♫ Harmony</button>
      <button onClick={onAlignToMelody} title="Snap Alto, Tenor and Bass onto the Soprano's rhythm" className="rounded-lg border border-cyan-300/30 bg-cyan-300/[.07] px-3 py-2 text-cyan-100">Align</button>
      <span className="ml-2 hidden whitespace-nowrap text-[10px] text-slate-500 lg:block">{status}</span>
      {playScope !== 'all' && <button onClick={onClearSelection} className="rounded-md border border-white/10 px-2 py-1.5 text-slate-300">Clear</button>}
      <span className="ml-auto flex items-center gap-1.5">
        <button onClick={onPlayFromStart} title="Play from the beginning" className="rounded-lg border border-white/15 px-2.5 py-2">⏮</button>
        <button onClick={() => onSkip(-5)} title="Back five seconds" className="rounded-lg border border-white/10 px-2.5 py-2">−5s</button>
        <button onClick={isPlaying ? onPause : onPlay} title={isPlaying ? 'Pause' : 'Play from the cursor'}
          className={`min-w-16 rounded-lg border px-4 py-2 font-bold ${isPlaying ? 'border-amber-300/50 bg-amber-300/10 text-amber-100' : 'border-fuchsia-300/50 bg-fuchsia-500/15 text-fuchsia-100'}`}>{isPlaying ? '❚❚' : '▶'}</button>
        <button onClick={onStop} title="Stop and return to the start" className="rounded-lg border border-white/12 px-2.5 py-2">■</button>
        <button onClick={() => onSkip(5)} title="Forward five seconds" className="rounded-lg border border-white/10 px-2.5 py-2">+5s</button>
        <span className="min-w-12 whitespace-nowrap font-mono text-cyan-200">{formatTime(playhead ?? 0)}</span>
        <span className="h-6 w-px bg-white/10" />
        <button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" className="rounded-lg border border-white/10 px-2.5 py-2 disabled:opacity-40">↩</button>
        <button onClick={onRedo} disabled={!canRedo} title="Redo" className="rounded-lg border border-white/10 px-2.5 py-2 disabled:opacity-40">↪</button>
        {extras}
      </span>
    </div>
  </div>;
}

function TimelineFocusToolbar({ tool, setTool, drawNoteValue, onDrawNoteValueChange, selected, bars, onLyricChange, onTrack, onExit, onPlay, onPause, onStop, isPlaying, isPaused, playhead, zoom, setZoom, onSave, saving }: { tool: EditorTool; setTool: (tool: EditorTool) => void; drawNoteValue: RhythmicNoteValue; onDrawNoteValueChange: (value: RhythmicNoteValue) => void; selected: SongNote | null; bars: MusicalBar[]; onLyricChange: (value: string) => void; onTrack: () => void; onExit: () => void; onPlay: () => void; onPause: () => void; onStop: () => void; isPlaying: boolean; isPaused: boolean; playhead: number | null; zoom: number; setZoom: (value: number) => void; onSave: () => void; saving: boolean }) {
  const placement = selected ? beatPositionAt(bars, selected.start) : null;
  return <div className="sticky top-0 z-[70] flex min-h-16 items-center gap-2 overflow-x-auto border-b border-fuchsia-300/25 bg-[#070a19]/95 px-3 py-2 text-xs shadow-[0_14px_40px_#000b,0_0_30px_#a855f722] backdrop-blur-xl">
    <button onClick={onExit} title="Return to the complete editor without discarding unsaved work" className="rounded-lg border border-white/15 bg-white/[.04] px-3 py-2 font-semibold">← Exit timeline</button>
    <span className="h-8 w-px shrink-0 bg-white/10" />
    {(['select', 'erase'] as EditorTool[]).map(value => <button key={value} onClick={() => setTool(value)} className={`rounded-lg border px-3 py-2 capitalize ${tool === value ? 'border-fuchsia-300/60 bg-fuchsia-400/15 text-fuchsia-100' : 'border-white/10 text-slate-300'}`}>{value}</button>)}
    <DrawNoteValuePicker value={drawNoteValue} onChange={onDrawNoteValueChange} />
    <div className="flex shrink-0 items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[.06] px-3 py-2"><span className="text-[9px] font-bold uppercase tracking-[.14em] text-slate-500">Placement</span>{placement ? <><b className="text-cyan-100">{placement.bar}.{placement.beat}</b><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${beatOffsetLabel(placement.fraction) === 'ON BEAT' ? 'bg-emerald-300/15 text-emerald-200' : 'bg-amber-300/15 text-amber-200'}`}>{beatOffsetLabel(placement.fraction)}</span></> : <span className="text-slate-500">Select a note</span>}</div>
    <label className="flex min-w-64 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2"><span className="text-[9px] font-bold uppercase tracking-[.14em] text-slate-500">Note lyric</span><input value={selected?.lyric ?? ''} onChange={event => onLyricChange(event.target.value)} disabled={!selected} placeholder="Select one note" className="min-w-0 flex-1 border-0 bg-transparent text-sm text-white outline-none placeholder:text-slate-600 disabled:opacity-50" /></label>
    <button onClick={onTrack} className="rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 py-2 text-cyan-100">Track</button>
    <button onClick={isPlaying ? onPause : onPlay} className="rounded-lg border border-fuchsia-300/40 bg-fuchsia-400/10 px-3 py-2 font-semibold text-fuchsia-100">{isPlaying ? 'Pause' : isPaused ? 'Resume' : 'Play'}</button><button onClick={onStop} className="rounded-lg border border-cyan-300/30 px-3 py-2 text-cyan-100">Stop</button><span className="font-mono text-cyan-200">{formatClock(playhead ?? 0)}</span>
    <label className="ml-auto flex shrink-0 items-center gap-2 text-slate-400">Zoom <b className="text-fuchsia-200">{Math.round((zoom / 16) * 10) / 10}x</b><input aria-label="Timeline zoom" type="range" min="16" max="160" step="2" value={zoom} onChange={event => setZoom(Number(event.target.value))} className="w-24 accent-fuchsia-400" /></label>
    <button onClick={onSave} disabled={saving} className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 font-bold text-cyan-100">{saving ? 'Saving…' : 'Save'}</button>
  </div>;
}
/* Legacy toolbar retained temporarily for visual regression reference.
function EditorToolbarLegacy({ tool, setTool, playScope, playParts, onPlayAll, onPlayPart, playRange, playhead, onClearSelection, selectedCount, onRemove, canUndo, canRedo, onUndo, onRedo, zoom, setZoom, onDuplicate, onPlay, isPlaying, onRecord, recording, onPlayTake, hasTake, onSave, saving }: { tool: EditorTool; setTool: (tool: EditorTool) => void; playScope: PlaybackScope; playParts: boolean[]; onPlayAll: () => void; onPlayPart: (part: number, additive?: boolean) => void; playRange: { start: number; end: number }; playhead: number | null; onClearSelection: () => void; selectedCount: number; onRemove: () => void; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; zoom: number; setZoom: (value: number) => void; onDuplicate: () => void; onPlay: () => void; isPlaying: boolean; onRecord: () => void; recording: boolean; onPlayTake: () => void; hasTake: boolean; onSave: () => void; saving: boolean }) {
  const toolButton = (value: EditorTool, label: string) => <button onClick={() => setTool(value)} className={`rounded-lg border px-3 py-2 ${tool === value ? 'border-fuchsia-400/60 bg-fuchsia-500/20 text-fuchsia-100' : 'border-white/10 text-slate-100'}`}>{label}</button>;
  const status = playScope === 'range' ? `Range ${playRange.start.toFixed(2)}s–${playRange.end.toFixed(2)}s` : playScope === 'note' ? `${selectedCount || 1} selected note${selectedCount === 1 ? '' : 's'}` : playParts.every(Boolean) ? 'All voices from start' : `${VOICES.filter((_, index) => playParts[index]).join(' + ')} from start`;
  return <div className="border-b border-white/10 bg-[#0a0c20] text-xs"><div className="flex h-14 items-center gap-2 overflow-x-auto px-3">{toolButton('select', 'Select')}{toolButton('draw', 'Draw')}{toolButton('erase', 'Erase')}<button onClick={onDuplicate} disabled={!selectedCount} className="rounded-lg border border-white/10 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40">Duplicate</button><button onClick={onRemove} disabled={!selectedCount} className="rounded-lg border border-rose-300/35 px-3 py-2 text-rose-200 disabled:cursor-not-allowed disabled:opacity-40">Remove{selectedCount > 1 ? ` (${selectedCount})` : ''}</button><span className="h-6 w-px bg-white/10" /><button onClick={onUndo} disabled={!canUndo} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40">Undo</button><button onClick={onRedo} disabled={!canRedo} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40">Redo</button><span className="h-6 w-px bg-white/10" /><span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">Audition voices</span><button onClick={onPlayAll} className={`rounded-md border px-3 py-2 ${playParts.every(Boolean) && playScope === 'all' ? 'border-fuchsia-300/60 bg-fuchsia-500/15 text-fuchsia-100' : 'border-white/10 text-slate-300'}`}>All SATB</button>{VOICES.map((voice, index) => <button key={voice} title="Click for this voice only. Shift-click to add/remove a voice." onClick={event => onPlayPart(index, event.shiftKey)} className="rounded-md border px-3 py-2 font-bold" style={{ borderColor: playParts[index] ? COLOURS[index] : '#ffffff22', color: playParts[index] ? COLOURS[index] : '#64748b', background: playParts[index] ? `${COLOURS[index]}16` : 'transparent' }}>{voice}</button>)}<button onClick={onSave} disabled={saving} className="ml-auto rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 font-bold text-cyan-100">{saving ? 'Saving…' : 'Save'}</button></div><div className="flex h-14 items-center gap-3 overflow-x-auto border-t border-white/[.06] px-3"><span className="whitespace-nowrap text-slate-400">{status}</span>{playScope !== 'all' && <button onClick={onClearSelection} className="rounded-md border border-white/10 px-3 py-2 text-slate-200">Clear selection</button>}<button onClick={onPlay} className={`rounded-lg border px-4 py-2 font-semibold ${isPlaying ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-100' : 'border-fuchsia-300/40 bg-fuchsia-500/10 text-fuchsia-100'}`}>{isPlaying ? 'Stop' : 'Play from start'}</button>{isPlaying && <span className="whitespace-nowrap text-cyan-200">Now {playhead?.toFixed(2)}s</span>}<button onClick={onRecord} className={`rounded-lg border px-3 py-2 ${recording ? 'border-rose-300 bg-rose-500/20 text-rose-100' : 'border-white/10 text-rose-300'}`}>{recording ? 'Stop recording' : 'Record'}</button>{hasTake && <button onClick={onPlayTake} className="rounded-lg border border-emerald-300/30 px-3 py-2 text-emerald-200">Play take</button>}<label className="ml-auto flex shrink-0 items-center gap-2 text-slate-400">Zoom <b className="w-8 text-right text-fuchsia-200">{Math.round((zoom / 16) * 10) / 10}x</b><input aria-label="Timeline zoom" type="range" min="16" max="160" step="2" value={zoom} onChange={event => setZoom(Number(event.target.value))} className="accent-fuchsia-400" /></label></div></div>;
}
*/
function suggestedPartFor(notes: ImportedMidiNote[], bounds: SatbMidiRanges) {
  if (!notes.length) return 0;
  const sorted = notes.map(note => note.midi).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return median <= bounds.bassMax ? 3 : median <= bounds.tenorMax ? 2 : median <= bounds.altoMax ? 1 : 0;
}

function MidiImportDialog({ preview, ranges, setRanges, sourceParts, setSourceParts, fixedPart, setFixedPart, mode, setMode, onCancel, onApply }: { preview: MidiPreview; ranges: SatbMidiRanges; setRanges: (ranges: SatbMidiRanges) => void; sourceParts: Record<string, number>; setSourceParts: (parts: Record<string, number>) => void; fixedPart: number | null; setFixedPart: (part: number | null) => void; mode: 'replace' | 'append'; setMode: (mode: 'replace' | 'append') => void; onCancel: () => void; onApply: () => void }) {
  const updateRange = (key: keyof SatbMidiRanges, value: number) => setRanges({ ...ranges, [key]: value });
  const bounds = normaliseSatbMidiRanges(ranges);
  const sources = Object.values(preview.notes.reduce<Record<string, { key: string; track: number; channel: number; notes: ImportedMidiNote[] }>>((all, note) => { const key = midiSourceKey(note); all[key] ??= { key, track: note.sourceTrack, channel: note.channel, notes: [] }; all[key].notes.push(note); return all; }, {})).sort((a, b) => a.track - b.track || a.channel - b.channel);
  const previewLow = preview.notes.reduce<number>((lowest, note) => Math.min(lowest, note.midi), 127);
  const previewHigh = preview.notes.reduce<number>((highest, note) => Math.max(highest, note.midi), 0);
  const partForPreview = (note: ImportedMidiNote) => { const mapped = sourceParts[midiSourceKey(note)]; if (mapped >= 0 && mapped <= 3) return mapped; return note.midi <= bounds.bassMax ? 3 : note.midi <= bounds.tenorMax ? 2 : note.midi <= bounds.altoMax ? 1 : 0; };
  const counts = preview.notes.reduce((total, note) => {
    const part = fixedPart ?? partForPreview(note);
    total[part] += 1;
    return total;
  }, [0, 0, 0, 0]);
  return <div className="absolute inset-0 z-40 grid place-items-center bg-[#020510]/85 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-label="Import MIDI" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-cyan-300/30 bg-[#0a1024] p-5 shadow-[0_0_50px_#27d9ff25]"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold tracking-[.2em] text-cyan-300">MIDI IMPORT</p><h2 className="mt-1 text-xl font-semibold">Review exact note targets</h2><p className="mt-1 text-xs text-slate-400">{preview.fileName} · {preview.notes.length} note events · {midiNoteName(previewLow)}–{midiNoteName(previewHigh)}</p></div><button onClick={onCancel} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">Cancel</button></div><p className="mt-4 rounded-lg border border-cyan-300/20 bg-cyan-300/5 p-3 text-xs leading-relaxed text-cyan-100"><b>Pitch is imported as the exact MIDI note number.</b> PPQN timing and tempo changes are converted with millisecond precision. SATB placement is separate: use source mapping when the file has distinct tracks/channels, or adjust the pitch ceilings for a single merged performance.</p><div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-xs text-slate-400">Overall placement<select value={fixedPart === null ? 'auto' : String(fixedPart)} onChange={event => setFixedPart(event.target.value === 'auto' ? null : Number(event.target.value))} className="mt-1 w-full rounded-lg border border-white/10 bg-[#050816] px-3 py-2 text-sm text-white"><option value="auto">Use source mapping, then pitch range</option>{VOICES.map((voice, index) => <option key={voice} value={index}>Place every note in {voice}</option>)}</select></label><label className="text-xs text-slate-400">Import action<select value={mode} onChange={event => setMode(event.target.value as 'replace' | 'append')} className="mt-1 w-full rounded-lg border border-white/10 bg-[#050816] px-3 py-2 text-sm text-white"><option value="replace">Replace current arrangement</option><option value="append">Append to current arrangement</option></select></label></div>{fixedPart === null && <><div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-200">MIDI track/channel mapping</p><p className="text-[10px] text-slate-500">Overrides pitch guessing</p></div><div className="mt-3 grid gap-2">{sources.map(source => { const low = source.notes.reduce((lowest, note) => Math.min(lowest, note.midi), 127), high = source.notes.reduce((highest, note) => Math.max(highest, note.midi), 0); return <label key={source.key} className="grid items-center gap-2 rounded-lg border border-white/[.07] bg-white/[.025] p-2 text-xs sm:grid-cols-[1fr_190px]"><span><b className="text-slate-200">Track {source.track + 1} · Channel {source.channel + 1}</b><span className="mt-1 block text-[10px] text-slate-500">{source.notes.length} notes · {midiNoteName(low)}–{midiNoteName(high)}</span></span><select value={sourceParts[source.key] ?? -1} onChange={event => setSourceParts({ ...sourceParts, [source.key]: Number(event.target.value) })} className="rounded-lg border border-white/10 bg-[#050816] px-3 py-2 text-white"><option value={-1}>Split each note by pitch range</option>{VOICES.map((voice, index) => <option key={voice} value={index}>{voice}{suggestedPartFor(source.notes, bounds) === index ? ' — suggested' : ''}</option>)}</select></label>; })}</div></div><div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-slate-200">Automatic SATB pitch buckets</p><p className="text-[10px] text-slate-500">Used by sources left on Auto</p></div><div className="mt-3 grid gap-3 sm:grid-cols-3">{([{ key: 'bassMax', label: 'Bass ceiling' }, { key: 'tenorMax', label: 'Tenor ceiling' }, { key: 'altoMax', label: 'Alto ceiling' }] as const).map(({ key, label }) => <label key={key} className="text-xs text-slate-400">{label} <b className="text-cyan-200">{midiNoteName(ranges[key])}</b><input type="number" min="0" max="127" value={ranges[key]} onChange={event => updateRange(key, Number(event.target.value))} className="mt-1 w-full rounded-lg border border-white/10 bg-[#050816] px-3 py-2 text-white" /></label>)}</div><div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px]">{VOICES.map((voice, index) => <div key={voice} className="rounded-lg border p-2" style={{ borderColor: `${COLOURS[index]}55`, color: COLOURS[index] }}><b className="block text-base">{counts[index]}</b>{voice}</div>)}</div></div></>}<div className="mt-5 flex justify-end gap-3"><button onClick={onCancel} className="rounded-lg border border-white/10 px-4 py-2 text-sm">Cancel</button><button onClick={onApply} className="rounded-lg border border-cyan-300/40 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-100">Import {preview.notes.length} exact notes</button></div></section></div>;
}
function MusicalGridOverlay({ bars, zoom, labels = false, subtle = false }: { bars: MusicalBar[]; zoom: number; labels?: boolean; subtle?: boolean }) {
  // With free placement the bars are a guess about a live take rather than
  // something the players followed, so they stop competing with the waveform
  // and the notes for attention. They stay visible as a rough reference.
  return <span className="pointer-events-none absolute inset-0 z-[2]" aria-hidden="true" style={{ opacity: subtle ? .3 : 1 }}>{bars.map(bar => <span key={`${bar.number}-${bar.start}`}><i className="absolute inset-y-0 w-0.5 bg-cyan-100/65 shadow-[0_0_10px_#22d3ee45]" style={{ left: bar.start * zoom }} />{bar.beats.map(beat => { const beatWidth = Math.max(1, (beat.end - beat.start) * zoom); return <span key={beat.start} className="absolute inset-y-0 border-l border-slate-200/30" style={{ left: beat.start * zoom, width: beatWidth, background: beat.beat % 2 ? 'linear-gradient(90deg,#67e8f908,transparent)' : 'linear-gradient(90deg,#d8b4fe0b,transparent)' }}><i className="absolute inset-y-0 left-1/2 w-px bg-fuchsia-200/15" />{beat.subdivisionStarts.map(value => <i key={value} className="absolute inset-y-0 w-px bg-slate-300/[.09]" style={{ left: (value - beat.start) * zoom }} />)}{labels && beatWidth >= 27 && <b className="absolute left-1 top-1 rounded bg-[#050817]/80 px-1 font-mono text-[8px] font-semibold text-cyan-100/80">{bar.number}.{beat.beat}</b>}</span>; })}</span>)}</span>;
}
function PianoTrack({ name, part, notes, selectedId, selectedIds, tool, playhead, selectedRange, width, zoom, bars, freeGrid, collapsed, onToggleCollapse, onAdd, onAddDouble, onSelect, onRemove, onNoteMoveStart, onNoteMove, onNoteMoveEnd, onResizeStart, onResize }: { name: string; part: number; notes: SongNote[]; selectedId: string | null; selectedIds: string[]; tool: EditorTool; playhead: number | null; selectedRange: { start: number; end: number } | null; width: number; zoom: number; bars: MusicalBar[]; freeGrid: boolean; collapsed: boolean; onToggleCollapse: () => void; onAdd: (part: number, event: React.MouseEvent<HTMLDivElement>) => void; onAddDouble: (part: number, event: React.MouseEvent<HTMLDivElement>) => void; onSelect: (id: string, additive?: boolean) => void; onRemove: (id: string) => void; onNoteMoveStart: (id: string, clientX: number, clientY: number, additive?: boolean) => void; onNoteMove: (clientX: number, clientY: number) => boolean; onNoteMoveEnd: () => boolean; onResizeStart: () => void; onResize: (id: string, end: number) => void; onEmptyClick: () => void }) {
  const resizing = useRef<{ id: string; start: number; initialEnd: number; noteStart: number } | null>(null);
  const notePointerActive = useRef(false);
  const suppressNoteClick = useRef(false);
  const range = pitchRangeForPart(part, notes);
  const pitches = Array.from({ length: range.max - range.min + 1 }, (_, index) => range.max - index);
  const laneHeight = PITCH_HEADER_HEIGHT + pitches.length * PITCH_ROW_HEIGHT;
  function beginResize(event: React.PointerEvent<HTMLSpanElement>, note: SongNote) { event.stopPropagation(); onResizeStart(); resizing.current = { id: note.id, start: event.clientX, initialEnd: note.end, noteStart: note.start }; event.currentTarget.setPointerCapture(event.pointerId); }
  function resize(event: React.PointerEvent<HTMLSpanElement>) { const active = resizing.current; if (!active) return; onResize(active.id, Math.max(active.noteStart + .001, active.initialEnd + ((event.clientX - active.start) / zoom))); }
  function finishResize(event: React.PointerEvent<HTMLSpanElement>) { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); resizing.current = null; }
  function beginMove(event: React.PointerEvent<HTMLButtonElement>, note: SongNote) { event.stopPropagation(); if (tool !== 'select' || event.button !== 0) return; notePointerActive.current = true; suppressNoteClick.current = true; onNoteMoveStart(note.id, event.clientX, event.clientY, event.ctrlKey || event.metaKey || event.shiftKey); event.currentTarget.setPointerCapture(event.pointerId); }
  function move(event: React.PointerEvent<HTMLButtonElement>) { if (!notePointerActive.current) return; suppressNoteClick.current = onNoteMove(event.clientX, event.clientY) || suppressNoteClick.current; }
  function finishMove(event: React.PointerEvent<HTMLButtonElement>) { if (!notePointerActive.current) return; suppressNoteClick.current = onNoteMoveEnd() || suppressNoteClick.current; notePointerActive.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  if (collapsed) return <div id={`vh-voice-${part}`} className="flex h-14 scroll-mt-3 overflow-hidden border-b border-cyan-100/10" data-voice-part={part}>
    <button onPointerDown={event => event.stopPropagation()} onClick={onToggleCollapse} title={`Expand ${name} piano roll`} className="sticky left-0 z-10 flex w-[124px] shrink-0 items-center gap-2 border-r border-cyan-100/10 bg-[#0c1025] px-2 text-left"><span className="text-lg" style={{ color: COLOURS[part] }}>{name[0]}</span><span><b className="block text-xs" style={{ color: COLOURS[part] }}>{name}</b><small className="text-[9px] text-slate-500">{midiNoteName(range.min)}–{midiNoteName(range.max)}</small></span><span className="ml-auto text-slate-400">▸</span></button>
    <div className="relative bg-[#070a19]" style={{ width }}><MusicalGridOverlay bars={bars} zoom={zoom} subtle={freeGrid} />
      {notes.map(note => <span key={note.id} className="pointer-events-none absolute h-2 rounded-full" style={{ left: note.start * zoom, top: 8 + ((range.max - note.midi) / Math.max(1, range.max - range.min)) * 32, width: Math.max(3, (note.end - note.start) * zoom), background: COLOURS[part], boxShadow: selectedIds.includes(note.id) ? `0 0 12px ${COLOURS[part]}` : undefined }} />)}
      {playhead !== null && <span className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white shadow-[0_0_12px_#f4a5ff]" style={{ left: playhead * zoom }} />}
    </div>
  </div>;
  return <div id={`vh-voice-${part}`} className="flex scroll-mt-3 overflow-hidden border-b border-cyan-100/10" data-voice-part={part} style={{ height: laneHeight }}>
    <div className="sticky left-0 z-30 w-[124px] shrink-0 border-r border-cyan-100/15 bg-[#090d20] shadow-[7px_0_18px_#0008]">
      <div className="absolute inset-x-0 top-0 flex h-[34px] items-center gap-1 border-b border-cyan-100/15 bg-[#111631] px-2"><b className="text-[23px] leading-none" style={{ color: COLOURS[part] }}>{name[0]}</b><b className="truncate text-[17px]" style={{ color: COLOURS[part] }}>{name}</b><button onPointerDown={event => event.stopPropagation()} onClick={onToggleCollapse} title={`Collapse ${name} piano roll`} className="ml-auto rounded px-1 text-sm text-slate-400 hover:bg-white/10 hover:text-white">▾</button></div>
      {pitches.map((pitch, index) => { const sharp = [1, 3, 6, 8, 10].includes(pitch % 12); const outside = pitch < range.natural.min || pitch > range.natural.max; return <span key={pitch} className={`absolute right-1 flex items-center justify-end border font-mono text-[12px] font-bold shadow-sm ${sharp ? 'w-[86px] rounded-l-md border-slate-600 bg-[linear-gradient(90deg,#05070d,#222a3d)] pr-2 text-cyan-100' : 'left-1 rounded-l-md border-slate-300/30 bg-[linear-gradient(90deg,#edf4ff,#aebbd2)] pr-3 text-[#111827]'}`} style={{ top: PITCH_HEADER_HEIGHT + index * PITCH_ROW_HEIGHT + 1, height: PITCH_ROW_HEIGHT - 2, opacity: outside ? .45 : 1 }}><span className="mr-auto ml-2 text-[8px] opacity-55">{sharp ? '♯' : '▏'}</span>{midiNoteName(pitch)}</span>; })}
    </div>
    <div onClick={event => onAdd(part, event)} onDoubleClick={event => onAddDouble(part, event)} className={`relative bg-[#060919] ${tool === 'erase' ? 'cursor-not-allowed' : 'cursor-default'}`} style={{ width, height: laneHeight }}><MusicalGridOverlay bars={bars} zoom={zoom} labels subtle={freeGrid} />
      <span className="pointer-events-none absolute inset-x-0 top-0 h-[34px] border-b border-cyan-200/15 bg-[linear-gradient(90deg,rgba(255,255,255,.035),transparent)]" />
      {pitches.map((pitch, index) => { const outside = pitch < range.natural.min || pitch > range.natural.max; return <span key={pitch} title={outside ? `${midiNoteName(pitch)} is outside the comfortable ${name} range — usable, but a stretch` : undefined} className={`pointer-events-none absolute inset-x-0 border-b ${[1, 3, 6, 8, 10].includes(pitch % 12) ? 'border-white/[.035] bg-black/25' : pitch % 12 === 0 ? 'border-cyan-100/20 bg-cyan-200/[.025]' : 'border-white/[.075]'}`} style={{ top: PITCH_HEADER_HEIGHT + index * PITCH_ROW_HEIGHT, height: PITCH_ROW_HEIGHT, boxShadow: outside ? 'inset 0 0 0 999px rgba(2,6,23,.55)' : undefined }} />; })}
      {selectedRange && <span className="pointer-events-none absolute inset-y-0 z-[1] bg-fuchsia-300/15 ring-1 ring-inset ring-fuchsia-200/60" style={{ left: selectedRange.start * zoom, width: Math.max(2, (selectedRange.end - selectedRange.start) * zoom) }} />}
      {playhead !== null && <span className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white shadow-[0_0_12px_#f4a5ff]" style={{ left: playhead * zoom }} />}
      {notes.filter(note => note.part === part || note.part === -1).map(note => { const active = playhead !== null && playhead >= note.start && playhead < note.end; const inRange = selectedRange && note.end >= selectedRange.start && note.start <= selectedRange.end; const isSelected = selectedIds.includes(note.id); const position = beatPositionAt(bars, note.start); const beatLabel = compactBeatLabel(position); const offsetLabel = position ? beatOffsetLabel(position.fraction) : 'No beat'; return <button key={note.id} data-note-id={note.id} aria-pressed={isSelected} title={`${midiNoteName(note.midi)} · Bar/beat ${beatLabel} · ${offsetLabel} · ${note.start.toFixed(3)}s–${note.end.toFixed(3)}s · drag in any direction`} onPointerDown={event => beginMove(event, note)} onPointerMove={move} onPointerUp={finishMove} onPointerCancel={finishMove} onDoubleClick={event => { event.stopPropagation(); const additive = event.ctrlKey || event.metaKey || event.shiftKey; if (!isSelected || additive) onSelect(note.id, additive); }} onClick={event => { event.stopPropagation(); if (suppressNoteClick.current) { suppressNoteClick.current = false; return; } if (tool === 'erase') onRemove(note.id); else onSelect(note.id, event.ctrlKey || event.metaKey || event.shiftKey); }} className={`absolute z-10 touch-none overflow-visible rounded-md border text-left text-[9px] font-black text-[#07111d] transition-[filter,box-shadow] ${tool === 'select' ? 'cursor-move active:cursor-grabbing' : ''}`} style={{ left: note.start * zoom, top: PITCH_HEADER_HEIGHT + (range.max - note.midi) * PITCH_ROW_HEIGHT + 2, width: Math.max(24, (note.end - note.start) * zoom - 2), height: PITCH_ROW_HEIGHT - 4, background: `linear-gradient(180deg,#ffffffaa 0,#ffffff20 42%,#00000018 100%),${COLOURS[part]}`, borderColor: isSelected ? '#fff' : `${COLOURS[part]}dd`, boxShadow: active ? `0 0 28px 6px ${COLOURS[part]}` : isSelected ? `0 0 0 2px #fff,0 0 22px ${COLOURS[part]}` : `0 4px 8px #000b,0 0 8px ${COLOURS[part]}55`, outline: active ? '2px solid white' : inRange ? '2px solid #f5d0fe' : 'none' }}><span className="flex h-full min-w-0 items-center gap-1 overflow-hidden px-1"><b className="shrink-0 rounded bg-black/65 px-1 py-px text-[8px] text-white">{midiNoteName(note.midi)}</b><em className="truncate not-italic">{note.lyric || 'Note'}</em>{isSelected && <small className="ml-auto shrink-0 rounded bg-white/80 px-1 font-mono text-[8px] text-[#11152a]">{beatLabel}</small>}</span>{tool !== 'erase' && <span aria-label="Drag to resize note" onPointerDown={event => beginResize(event, note)} onPointerMove={resize} onPointerUp={finishResize} onPointerCancel={finishResize} className="absolute -right-1 top-0 h-full w-2 cursor-ew-resize rounded-r bg-white/85 opacity-0 transition-opacity hover:opacity-100 focus:opacity-100" />}</button>; })}
    </div>
  </div>;
}
function Automation({ notes }: { notes: SongNote[] }) { const points = notes.slice(0, 18).map((note, index) => `${index * 55},${20 + (84 - note.midi) * .7}`).join(' '); return <div className="mt-3 rounded-xl border border-white/10 bg-[#060918] p-3"><p className="text-xs text-slate-400">♬ Dynamics <span className="ml-4 text-fuchsia-300">mf</span></p><svg className="mt-2 h-10 w-full" viewBox="0 0 1000 65" preserveAspectRatio="none"><polyline fill="none" stroke="#ff60bc" strokeWidth="2" points={points} /></svg><p className="text-xs text-slate-400">⌁ Breath <span className="ml-4 text-cyan-300">60%</span></p><svg className="mt-1 h-8 w-full" viewBox="0 0 1000 65" preserveAspectRatio="none"><polyline fill="none" stroke="#4ca0ff" strokeWidth="2" points={points} /></svg></div>; }
function playPianoTone(context: AudioContext, note: SongNote, startAt: number, length: number, releaseTail = .28) {
  const frequency = 440 * Math.pow(2, (note.midi - 69) / 12);
  const master = context.createGain();
  const expressionGain = context.createGain();
  const filter = context.createBiquadFilter();
  const velocity = Math.max(.025, Math.min(.12, note.velocity / 1150));
  const audibleLength = Math.max(.04, length);
  const releaseAt = startAt + audibleLength + Math.max(0, releaseTail);
  filter.type = 'lowpass';
  filter.frequency.value = Math.min(7200, Math.max(1800, frequency * 8));
  filter.Q.value = .7;
  master.gain.setValueAtTime(.0001, startAt);
  master.gain.exponentialRampToValueAtTime(velocity, startAt + Math.min(.009, audibleLength * .12));
  master.gain.exponentialRampToValueAtTime(velocity * .36, startAt + Math.min(.11, audibleLength * .55));
  master.gain.exponentialRampToValueAtTime(.0001, releaseAt);
  expressionGain.gain.setValueAtTime(.85, startAt);
  const expressionScale = audibleLength / Math.max(.001, note.end - note.start);
  note.expression?.contour.forEach(point => {
    const at = startAt + Math.min(audibleLength, Math.max(0, point.offset * expressionScale));
    expressionGain.gain.linearRampToValueAtTime(Math.max(.22, Math.min(1.15, .25 + point.level * .9)), at);
  });
  expressionGain.connect(master);
  master.connect(filter).connect(context.destination);
  const oscillators: OscillatorNode[] = [];
  [[1, 'triangle', 1], [2, 'sine', .26], [3, 'sine', .12], [4.2, 'sine', .05]].forEach(([ratio, wave, level]) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = wave as OscillatorType;
    const harmonic = Number(ratio);
    oscillator.frequency.setValueAtTime(frequency * harmonic, startAt);
    note.expression?.contour.forEach(point => {
      const at = startAt + Math.min(audibleLength, Math.max(0, point.offset * expressionScale));
      const expressiveFrequency = 440 * Math.pow(2, (note.midi + point.cents / 100 - 69) / 12);
      oscillator.frequency.linearRampToValueAtTime(expressiveFrequency * harmonic, at);
    });
    gain.gain.value = Number(level);
    oscillator.connect(gain).connect(expressionGain);
    oscillator.start(startAt);
    oscillator.stop(releaseAt + .03);
    oscillators.push(oscillator);
  });
  let stopped = false;
  return () => {
    if (stopped || context.state === 'closed') return;
    stopped = true;
    const now = context.currentTime;
    try { master.gain.cancelAndHoldAtTime(now); }
    catch { master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(Math.max(.0001, master.gain.value), now); }
    master.gain.exponentialRampToValueAtTime(.0001, now + .018);
    oscillators.forEach(oscillator => { try { oscillator.stop(now + .02); } catch { /* The scheduled note may already have ended. */ } });
  };
}
function Inspector({ selected, bars, update, onDelete, onDuplicate }: { selected: SongNote | null; bars: MusicalBar[]; update: (id: string, values: Partial<SongNote>) => void; onDelete: () => void; onDuplicate: () => void }) {
  if (!selected) return <aside className="hidden w-60 shrink-0 border-l border-white/10 bg-[#090b1e] p-4 xl:block"><p className="text-xs tracking-[.18em] text-slate-500">INSPECTOR</p><p className="mt-6 text-sm text-slate-400">Select a note to edit its properties.</p></aside>;
  const position = beatPositionAt(bars, selected.start);
  const hold = durationInBeats(bars, selected.start, selected.end);
  const field = (label: string, value: string | number, setter: (value: string) => void, type = 'text') => <label className="mt-3 block text-[10px] tracking-[.12em] text-slate-500">{label}<input type={type} value={value} onChange={event => setter(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#050816] px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-400" /></label>;
  return <aside className="hidden w-60 shrink-0 overflow-y-auto border-l border-white/10 bg-[#090b1e] p-4 xl:block">
    <div className="border-b border-fuchsia-400 pb-3 text-xs font-bold text-fuchsia-300">INSPECTOR</div>
    <div className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-300/[.06] p-3"><small className="block text-[9px] font-bold uppercase tracking-[.14em] text-cyan-300">Beat placement</small><b className="mt-1 block font-mono text-lg text-white">Bar {position?.bar ?? '—'} · Beat {position?.beat ?? '—'}</b><span className={`mt-1 inline-block rounded-full border px-2 py-1 text-[9px] font-black ${position && !beatOffsetLabel(position.fraction).startsWith('OFF GRID') ? 'border-emerald-300/30 text-emerald-200' : 'border-amber-300/30 text-amber-100'}`}>{position ? beatOffsetLabel(position.fraction) : 'NO POSITION'}</span><p className="mt-2 font-mono text-[10px] text-slate-300">Hold {hold.toFixed(2)} beats</p></div>
    <p className="mt-4 text-[10px] tracking-[.15em] text-slate-500">NOTE PROPERTIES</p>
    <label className="mt-3 block text-[10px] tracking-[.12em] text-slate-500">VOICE PART
      <select value={selected.part} onChange={event => update(selected.id, { part: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-fuchsia-400/30 bg-[#1c1033] px-3 py-2 text-sm text-fuchsia-100">
        {VOICES.map((voice, index) => <option key={voice} value={index}>{voice}</option>)}<option value={-1}>Shared guide</option>
      </select>
    </label>
    {field('PITCH (MIDI)', selected.midi, value => update(selected.id, { midi: Number(value) }), 'number')}
    {field('START', selected.start, value => update(selected.id, { start: Number(value) }), 'number')}
    {field('END', selected.end, value => update(selected.id, { end: Number(value) }), 'number')}
    {field('LYRICS', selected.lyric, value => update(selected.id, { lyric: value }))}
    {selected.expression && <VocalExpressionInspector note={selected} />}
    <label className="mt-4 block text-[10px] tracking-[.12em] text-slate-500">VELOCITY <input type="range" min="0" max="127" value={selected.velocity} onChange={event => update(selected.id, { velocity: Number(event.target.value) })} className="mt-2 w-full accent-fuchsia-400" /></label>
    <div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onDuplicate} className="rounded-lg border border-fuchsia-300/30 px-2 py-2 text-xs text-fuchsia-200">Duplicate</button><button onClick={onDelete} className="rounded-lg border border-rose-300/30 px-2 py-2 text-xs text-rose-200">Remove</button></div>
  </aside>;
}
function VocalExpressionInspector({ note }: { note: SongNote }) {
  const expression = note.expression;
  if (!expression?.contour.length) return null;
  const duration = Math.max(.001, note.end - note.start);
  const pitchPoints = expression.contour.map(point => `${(point.offset / duration) * 200},${22 - Math.max(-100, Math.min(100, point.cents)) * .18}`).join(' ');
  const levelPoints = expression.contour.map(point => `${(point.offset / duration) * 200},${42 - point.level * 18}`).join(' ');
  const signedTuning = `${expression.mean_cents >= 0 ? '+' : ''}${Math.round(expression.mean_cents)}¢`;
  return <section className="mt-4 rounded-xl border border-fuchsia-300/20 bg-fuchsia-300/[.055] p-3">
    <div className="flex items-center justify-between"><b className="text-[10px] uppercase tracking-[.14em] text-fuchsia-200">Captured vocal expression</b><span className="rounded-full border border-cyan-300/20 px-2 py-0.5 text-[8px] font-bold text-cyan-200">YIN contour</span></div>
    <svg className="mt-2 h-12 w-full overflow-visible rounded bg-[#050816]" viewBox="0 0 200 46" preserveAspectRatio="none" aria-label="Detected pitch and loudness contour">
      <line x1="0" x2="200" y1="22" y2="22" stroke="#ffffff20" strokeDasharray="3 3" />
      <polyline points={pitchPoints} fill="none" stroke="#f472d0" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <polyline points={levelPoints} fill="none" stroke="#45e6f5" strokeWidth="1.2" opacity=".8" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="mt-2 grid grid-cols-2 gap-2 text-[9px] text-slate-400">
      <span>Tuning <b className="block text-xs text-white">{signedTuning}</b></span>
      <span>Pitch movement <b className="block text-xs text-white">{Math.round(expression.pitch_spread_cents)}¢ spread</b></span>
      <span>Vibrato <b className="block text-xs text-white">{expression.vibrato_rate_hz ? `${expression.vibrato_rate_hz.toFixed(1)} Hz · ${Math.round(expression.vibrato_depth_cents)}¢` : 'Not stable enough'}</b></span>
      <span>Shape <b className="block text-xs capitalize text-white">{expression.attack} attack · {expression.release} release</b></span>
    </div>
    <p className="mt-2 text-[9px] leading-relaxed text-slate-500">Pink follows tuning and vibrato; cyan follows captured intensity. Note audition uses both contours.</p>
  </section>;
}
function round(value: number) { return Math.round(value * 100) / 100; }
function roundPrecise(value: number) { return Math.round(value * 1000) / 1000; }

function MusicXmlImportDialog({ preview, mapping, setMapping, mode, setMode, onCancel, onApply }: { preview: { fileName: string; result: MusicXmlImport }; mapping: Record<string, number>; setMapping: (next: Record<string, number>) => void; mode: 'replace' | 'append'; setMode: (mode: 'replace' | 'append') => void; onCancel: () => void; onApply: () => void }) {
  const { result, fileName } = preview;
  const counts = [0, 1, 2, 3].map(part => result.sources.filter(source => mapping[source.key] === part).reduce((total, source) => total + source.count, 0));
  const empty = [0, 1, 2, 3].filter(part => counts[part] === 0);
  return <div className="absolute inset-0 z-40 grid place-items-center bg-[#020510]/85 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-label="Import MusicXML" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-emerald-300/30 bg-[#0a1024] p-5 shadow-[0_0_50px_#34d39925]">
    <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold tracking-[.2em] text-emerald-300">MUSICXML IMPORT</p><h2 className="mt-1 text-xl font-semibold">{result.title || fileName}</h2><p className="mt-1 text-xs text-slate-400">{result.notes.length} notes · {result.sources.length} voice{result.sources.length === 1 ? '' : 's'} · {result.lyricCount} syllables · written tempo {Math.round(result.bpm)} bpm</p></div><button onClick={onCancel} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">Cancel</button></div>
    <p className="mt-4 rounded-lg border border-emerald-300/20 bg-emerald-300/5 p-3 text-xs leading-relaxed text-emerald-100"><b>Voices and lyrics come from the score itself.</b> Unlike a MIDI file, nothing here is inferred from pitch: every voice below is a real part in the file, and its syllables are already attached to the right notes. Check the lanes and import.</p>
    {result.warnings.map((warning, index) => <p key={index} className="mt-2 rounded-lg border border-amber-300/25 bg-amber-300/[.06] p-3 text-xs text-amber-100">{warning}</p>)}
    <div className="mt-4 grid gap-2">{result.sources.map(source => <label key={source.key} className="grid items-center gap-2 rounded-lg border border-white/[.07] bg-white/[.025] p-2 text-xs sm:grid-cols-[1fr_190px]">
      <span><b className="text-slate-200">{source.label}</b><span className="mt-1 block text-[10px] text-slate-500">{source.count} notes · {midiNoteName(source.low)}–{midiNoteName(source.high)} · suggested from {source.reason}</span></span>
      <select value={mapping[source.key] ?? 0} onChange={event => setMapping({ ...mapping, [source.key]: Number(event.target.value) })} className="rounded-lg border border-white/10 bg-[#050816] px-3 py-2 text-white">{VOICES.map((voice, index) => <option key={voice} value={index}>{voice}{source.suggestedPart === index ? ' — suggested' : ''}</option>)}</select>
    </label>)}</div>
    <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px]">{VOICES.map((voice, index) => <div key={voice} className="rounded-lg border p-2" style={{ borderColor: `${COLOURS[index]}55`, color: COLOURS[index] }}><b className="block text-base">{counts[index]}</b>{voice}</div>)}</div>
    {empty.length > 0 && <p className="mt-2 text-[11px] text-amber-200">Nothing is going to {empty.map(part => VOICES[part]).join(', ')} — fine for a score with fewer parts; those lanes stay empty.</p>}
    <label className="mt-4 block text-xs text-slate-400">Import action<select value={mode} onChange={event => setMode(event.target.value as 'replace' | 'append')} className="mt-1 w-full rounded-lg border border-white/10 bg-[#050816] px-3 py-2 text-sm text-white"><option value="replace">Replace current arrangement</option><option value="append">Append to current arrangement</option></select></label>
    <div className="mt-5 flex justify-end gap-3"><button onClick={onCancel} className="rounded-lg border border-white/10 px-4 py-2 text-sm">Cancel</button><button onClick={onApply} className="rounded-lg border border-emerald-300/40 bg-emerald-300/15 px-4 py-2 text-sm font-semibold text-emerald-100">Import {result.notes.length} notes</button></div>
  </section></div>;
}
