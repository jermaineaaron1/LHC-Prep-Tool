'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BackingTrackClip, BackingTrackSettings, MusicalTimelineSettings, Song, SongNote } from '@/lib/vocal-hero/types';
import { playableNotes } from '@/lib/vocal-hero/songData';
import { assignMidiParts, DEFAULT_SATB_MIDI_RANGES, midiSourceKey, normaliseSatbMidiRanges, parseMidiNotes, type ImportedMidiNote, type SatbMidiRanges } from '@/lib/vocal-hero/midi';
import { supabase } from '@/lib/vocal-hero/supabaseClient';
import { BackingTrackPanel } from './BackingTrackPanel';
import { BackingTrackLane } from './BackingTrackLane';

const VOICES = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#ff60bc', '#ffae42', '#4ca0ff', '#43e2bb'];
const TIMELINE_LABEL_WIDTH = 124;
const PITCH_ROW_HEIGHT = 22;
const PITCH_HEADER_HEIGHT = 34;
const DEFAULT_BPM = 120;
const DEFAULT_BEATS_PER_BAR = 4;
const DEFAULT_BEAT_UNIT = 4;
const DEFAULT_SNAP_DIVISION = 16;
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
function pitchRangeForPart(part: number) {
  const natural = VOICE_MIDI_RANGES[part] ?? VOICE_MIDI_RANGES[0];
  return { min: natural.min, max: natural.max };
}
type EditableSong = Pick<Song, 'id' | 'title' | 'notes' | 'backing_media_url' | 'backing_media_kind' | 'backing_track_settings'>;
type EditorTool = 'select' | 'draw' | 'erase';
type PlaybackScope = 'all' | 'range' | 'note';
type ArrangementSnapshot = { title: string; notes: SongNote[]; musicalTimeline: MusicalTimelineSettings; selectedId: string | null; selectedIds: string[]; selectedPart: number; playScope: PlaybackScope; playParts: boolean[]; playRange: { start: number; end: number } };
type MidiPreview = { fileName: string; notes: ImportedMidiNote[] };
const DEFAULT_TRACK_SETTINGS: BackingTrackSettings = { volume: 1, speed: 1, timeline_offset: 0, trim_start: 0, trim_end: null, loop_start: 0, loop_end: null, loop_enabled: false, skip_regions: [], split_markers: [], media_duration: null, effect: 'none' };

type MusicalState = { bpm: number; numerator: number; denominator: number; tonic: string; mode: string };
type MusicalBeat = { start: number; end: number; beat: number; bar: number; subdivisionStarts: number[] };
type MusicalBar = MusicalState & { start: number; end: number; number: number; beats: MusicalBeat[] };
type BeatPosition = MusicalState & { bar: number; beat: number; fraction: number; start: number; end: number };
type NoteDivision = NonNullable<MusicalTimelineSettings['snap_division']>;
const NOTE_DIVISIONS: Array<{ value: NoteDivision; label: string; short: string }> = [
  { value: 1, label: 'Whole note / semibreve', short: 'Whole' },
  { value: 2, label: 'Half note / minim', short: '1/2' },
  { value: 4, label: 'Quarter note / crotchet', short: '1/4' },
  { value: 8, label: 'Eighth note / quaver', short: '1/8' },
  { value: 16, label: 'Sixteenth note / semiquaver', short: '1/16' },
  { value: 32, label: 'Thirty-second note / demisemiquaver', short: '1/32' },
];

function sortByTime<T extends { at: number }>(items: T[]) { return [...items].sort((a, b) => a.at - b.at); }
function normaliseMusicalTimeline(song: Song, settings: BackingTrackSettings): MusicalTimelineSettings {
  const stored = settings.musical_timeline;
  const ensureBase = <T extends { at: number }>(items: T[], fallback: T) => {
    const valid = sortByTime(items.filter(item => Number.isFinite(item.at) && item.at >= 0));
    return valid.some(item => item.at === 0) ? valid : [fallback, ...valid];
  };
  return {
    tempo_changes: ensureBase(stored?.tempo_changes ?? [], { at: 0, bpm: Math.max(20, Number(song.bpm) || DEFAULT_BPM) }).map(item => ({ ...item, bpm: Math.max(20, Math.min(400, Number(item.bpm) || DEFAULT_BPM)) })),
    meter_changes: ensureBase(stored?.meter_changes ?? [], { at: 0, numerator: Math.max(1, Number(song.time_sig) || DEFAULT_BEATS_PER_BAR), denominator: DEFAULT_BEAT_UNIT }).map(item => ({ ...item, numerator: Math.max(1, Math.min(32, Math.round(Number(item.numerator) || DEFAULT_BEATS_PER_BAR))), denominator: [1, 2, 4, 8, 16, 32].includes(Number(item.denominator)) ? Number(item.denominator) : DEFAULT_BEAT_UNIT })),
    key_changes: ensureBase(stored?.key_changes ?? [], { at: 0, tonic: 'C', mode: 'Major' }).map(item => ({ ...item, tonic: item.tonic || 'C', mode: item.mode || 'Major' })),
    snap_division: NOTE_DIVISIONS.some(item => item.value === stored?.snap_division) ? stored!.snap_division as NoteDivision : DEFAULT_SNAP_DIVISION,
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
  return (60 / (position?.bpm ?? DEFAULT_BPM)) * (4 / division);
}
function snapTimeToGrid(bars: MusicalBar[], time: number, division: NoteDivision, mode: 'round' | 'ceil' | 'floor' = 'round') {
  const safe = Math.max(0, time);
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
  return { ...note, start, end: roundPrecise(start + units * step) };
}
function notesOverlap(a: SongNote, b: SongNote) { return a.part === b.part && a.start < b.end - .0005 && a.end > b.start + .0005; }
function collisionInVoice(candidates: SongNote[], fixed: SongNote[]) {
  const all = [...fixed, ...candidates].sort((a, b) => a.part - b.part || a.start - b.start || a.end - b.end);
  return all.some((note, index) => index > 0 && notesOverlap(all[index - 1], note));
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
      const next = { ...note, start, end: roundPrecise(start + duration) };
      adjusted.set(note.id, next);
      voiceEnd = next.end;
    });
  });
  return input.map(note => adjusted.get(note.id) ?? note);
}

export function ArrangementEditor({ song, onClose, onSave }: { song: Song; onClose: () => void; onSave: (values: EditableSong) => Promise<void>; }) {
  const [title, setTitle] = useState(song.title);
  const [notes, setNotes] = useState<SongNote[]>(() => playableNotes(song));
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
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [editorNotice, setEditorNotice] = useState<string | null>(null);
  const [midiPreview, setMidiPreview] = useState<MidiPreview | null>(null);
  const [midiError, setMidiError] = useState<string | null>(null);
  const [midiRanges, setMidiRanges] = useState<SatbMidiRanges>(DEFAULT_SATB_MIDI_RANGES);
  const [midiSourceParts, setMidiSourceParts] = useState<Record<string, number>>({});
  const [midiPart, setMidiPart] = useState<number | null>(null);
  const [midiMode, setMidiMode] = useState<'replace' | 'append'>('replace');
  const [mediaUrl, setMediaUrl] = useState(song.backing_media_url ?? song.audio_url ?? '');
  const [mediaKind, setMediaKind] = useState<'audio' | 'video'>(song.backing_media_kind ?? 'audio');
  const [mediaName, setMediaName] = useState('');
  const [showBackingEditor, setShowBackingEditor] = useState(false);
  const [trackSettings, setTrackSettings] = useState<BackingTrackSettings>({ ...DEFAULT_TRACK_SETTINGS, ...(song.backing_track_settings ?? {}) });
  const [musicalTimeline, setMusicalTimeline] = useState<MusicalTimelineSettings>(() => normaliseMusicalTimeline(song, { ...DEFAULT_TRACK_SETTINGS, ...(song.backing_track_settings ?? {}) }));
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ past: ArrangementSnapshot[]; future: ArrangementSnapshot[] }>({ past: [], future: [] });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
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
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const musicalLatchSignatureRef = useRef('');
  const selected = notes.find(note => note.id === selectedId) ?? null;
  const backingTimelineEnd = trackSettings.clips?.length ? Math.max(...trackSettings.clips.map(clip => clip.timeline_start + (clip.source_end - clip.source_start))) : trackSettings.timeline_offset + Math.max(0, (trackSettings.trim_end ?? trackSettings.media_duration ?? 0) - trackSettings.trim_start);
  const transportEnd = Math.max(.1, song.duration || 0, backingTimelineEnd, ...notes.map(note => note.end));
  const duration = Math.max(32, transportEnd + 4);
  const timelineWidth = Math.min(Math.max(duration * zoom, 1600), 48000);
  const musicalBars = useMemo(() => buildMusicalGrid(duration, musicalTimeline), [duration, musicalTimeline]);
  const musicalBeats = useMemo(() => musicalBars.flatMap(bar => bar.beats), [musicalBars]);
  const cursorMusicalState = musicalStateAt(musicalTimeline, playhead ?? 0);
  const noteByPart = useMemo(() => VOICES.map((_, index) => notes.filter(note => note.part === index || (note.part === -1 && index === selectedPart))), [notes, selectedPart]);
  const selectedNotes = useMemo(() => notes.filter(note => selectedIds.includes(note.id)).sort((a, b) => a.start - b.start || a.part - b.part), [notes, selectedIds]);

  useEffect(() => {
    if (!musicalBars.length) return;
    const signature = JSON.stringify([musicalTimeline.tempo_changes, musicalTimeline.meter_changes, musicalTimeline.snap_division]);
    if (musicalLatchSignatureRef.current === signature) return;
    musicalLatchSignatureRef.current = signature;
    const division = musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION;
    setNotes(current => {
      const latched = quantizeAndResolveNotes(current, musicalBars, division);
      const changed = latched.some((note, index) => Math.abs(note.start - current[index].start) > .0005 || Math.abs(note.end - current[index].end) > .0005);
      if (changed) setEditorNotice(`Arrangement latched to ${NOTE_DIVISIONS.find(item => item.value === division)?.label ?? `1/${division}`} timing; same-voice clashes were moved to the next available grid position.`);
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
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => setIsFullscreen(document.fullscreenElement === editorRootRef.current);
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  async function toggleFullscreen() {
    const root = editorRootRef.current;
    if (!root) return;
    if (document.fullscreenElement === root) await document.exitFullscreen();
    else await root.requestFullscreen();
  }

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
    setEditorNotice(`All notes latched to ${NOTE_DIVISIONS.find(item => item.value === division)?.label ?? `1/${division}`} timing. Same-voice overlaps were moved forward automatically.`);
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

  function makeSnapshot(): ArrangementSnapshot { return { title, notes: notes.map(note => ({ ...note })), musicalTimeline: { tempo_changes: musicalTimeline.tempo_changes.map(item => ({ ...item })), meter_changes: musicalTimeline.meter_changes.map(item => ({ ...item })), key_changes: musicalTimeline.key_changes.map(item => ({ ...item })), snap_division: musicalTimeline.snap_division }, selectedId, selectedIds: [...selectedIds], selectedPart, playScope, playParts: [...playParts], playRange: { ...playRange } }; }
  function pushHistory() { const snapshot = makeSnapshot(); setHistory(current => ({ past: [...current.past, snapshot].slice(-100), future: [] })); }
  function restoreSnapshot(snapshot: ArrangementSnapshot) { setTitle(snapshot.title); setNotes(snapshot.notes.map(note => ({ ...note }))); setMusicalTimeline({ tempo_changes: snapshot.musicalTimeline.tempo_changes.map(item => ({ ...item })), meter_changes: snapshot.musicalTimeline.meter_changes.map(item => ({ ...item })), key_changes: snapshot.musicalTimeline.key_changes.map(item => ({ ...item })), snap_division: snapshot.musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION }); setSelectedId(snapshot.selectedId); setSelectedIds([...snapshot.selectedIds]); setSelectedPart(snapshot.selectedPart); setPlayScope(snapshot.playScope); setPlayParts([...snapshot.playParts]); setPlayRange({ ...snapshot.playRange }); }
  function undo() { const previous = history.past.at(-1); if (!previous) return; const current = makeSnapshot(); restoreSnapshot(previous); setHistory({ past: history.past.slice(0, -1), future: [current, ...history.future] }); }
  function redo() { const next = history.future[0]; if (!next) return; const current = makeSnapshot(); restoreSnapshot(next); setHistory({ past: [...history.past, current].slice(-100), future: history.future.slice(1) }); }
  function update(id: string, values: Partial<SongNote>) {
    const target = notes.find(note => note.id === id);
    if (!target) return;
    const division = musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION;
    const timingChanged = values.start !== undefined || values.end !== undefined || values.part !== undefined;
    const candidate = timingChanged ? quantizeNote({ ...target, ...values }, musicalBars, division) : { ...target, ...values };
    if (collisionInVoice([candidate], notes.filter(note => note.id !== id))) {
      setEditorNotice(`${VOICES[candidate.part] ?? 'This voice'} already has a note in that position. Move or resize the existing target first.`);
      return;
    }
    pushHistory();
    setNotes(current => current.map(note => note.id === id ? candidate : note));
    setEditorNotice(null);
  }
  function selectNote(id: string, additive = false) { const note = notes.find(item => item.id === id); if (!note) return; setSelectedPart(note.part < 0 ? 0 : note.part); setSelectedId(id); setSelectedIds(current => additive ? (current.includes(id) ? current.filter(item => item !== id) : [...current, id]) : [id]); setPlayScope('note'); }
  function addNote(part = selectedPart, start = notes.reduce((latest, note) => Math.max(latest, note.end), 0), midi = 60, end?: number) {
    const state = musicalStateAt(musicalTimeline, start);
    const beatLength = (60 / state.bpm) * (4 / state.denominator);
    const division = musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION;
    const id = `note-${crypto.randomUUID()}`;
    const candidate = quantizeNote({ id, part, midi, start, end: end ?? start + beatLength, lyric: 'New lyric', velocity: 100 }, musicalBars, division);
    if (collisionInVoice([candidate], notes)) {
      setEditorNotice(`${VOICES[part] ?? 'This voice'} already has a note on ${compactBeatLabel(beatPositionAt(musicalBars, candidate.start))}. Notes in one voice cannot overlap.`);
      return;
    }
    pushHistory();
    setNotes(current => [...current, candidate]);
    setSelectedPart(part); setSelectedId(id); setSelectedIds([id]); setEditorNotice(null);
  }
  function addAt(part: number, event: React.MouseEvent<HTMLDivElement>) { const bounds = event.currentTarget.getBoundingClientRect(); const pointerTime = Math.max(0, (event.clientX - bounds.left) / zoom); const beat = musicalBeats.find(item => pointerTime >= item.start && pointerTime < item.end); const range = pitchRangeForPart(part); const row = Math.max(0, Math.min(range.max - range.min, Math.floor((event.clientY - bounds.top - PITCH_HEADER_HEIGHT) / PITCH_ROW_HEIGHT))); addNote(part, beat?.start ?? pointerTime, range.max - row, beat?.end); }
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
  function removeSelected() { if (!selectedIds.length) return; pushHistory(); setNotes(current => current.filter(note => !selectedIds.includes(note.id))); setSelectedId(null); setSelectedIds([]); }
  function beginResizeHistory() { pushHistory(); }
  function beginNoteMove(id: string, clientX: number, clientY: number, additive = false) {
    const target = notes.find(note => note.id === id);
    if (!target) return;
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
    const minimumMidiDelta = Math.max(...targets.map(note => { const part = note.part < 0 ? selectedPart : note.part; return pitchRangeForPart(part).min - active.initial[note.id].midi; }));
    const maximumMidiDelta = Math.min(...targets.map(note => { const part = note.part < 0 ? selectedPart : note.part; return pitchRangeForPart(part).max - active.initial[note.id].midi; }));
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
        if (note.id === id) return { ...note, end: nextEnd };
        if (note.part === target.part && note.start >= target.end - .001) return { ...note, start: Math.max(0, roundPrecise(note.start + delta)), end: Math.max(step, roundPrecise(note.end + delta)) };
        return note;
      });
    });
  }
  function clearPlaybackSelections() { setPlayScope('all'); setPlayParts([true, true, true, true]); setPlayRange({ start: 0, end: 8 }); setRangeParts(null); setSelectedId(null); setSelectedIds([]); }
  function selectAllVoices() { clearPlaybackSelections(); haltPlaybackEngine(); setTransportPosition(0); setIsPaused(false); }
  function selectPlayPart(part: number, additive = false) { setPlayParts(current => additive ? current.map((enabled, index) => index === part ? !enabled : enabled) : VOICES.map((_, index) => index === part)); setPlayScope('all'); setRangeParts(null); setSelectedId(null); setSelectedIds([]); haltPlaybackEngine(); setTransportPosition(0); setIsPaused(false); focusVoice(part); }
  function beginLasso(event: React.PointerEvent<HTMLDivElement>) {
    if ((tool !== 'select' && tool !== 'draw') || event.button !== 0 || (event.target as HTMLElement).closest('[data-note-id]')) return;
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
    if (tool === 'draw') addAt(part, event);
    else if (tool === 'erase') clearPlaybackSelections();
  }

  useEffect(() => {
    const handleClipboardShortcut = (event: KeyboardEvent) => {
      if (midiPreview || showBackingEditor) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if ((key === 'backspace' || key === 'delete') && selectedIds.length) { event.preventDefault(); removeSelected(); return; }
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
      if (key === 'c' && selectedIds.length) { event.preventDefault(); copySelectedNotes(); }
      if (key === 'v' && noteClipboard.length) { event.preventDefault(); pasteCopiedNotes(); }
    };
    window.addEventListener('keydown', handleClipboardShortcut);
    return () => window.removeEventListener('keydown', handleClipboardShortcut);
  }, [midiPreview, noteClipboard, notes, playhead, selectedIds, showBackingEditor]);
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
  function updateTrackClips(clips: BackingTrackClip[]) {
    setTrackSettings(current => {
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
    const next = Math.max(0, Math.min(transportEnd, time));
    playheadRef.current = next;
    setPlayhead(next);
    return next;
  }
  function stopPlayback() { haltPlaybackEngine(); setTransportPosition(0); setIsPaused(false); clearPlaybackSelections(); }
  function pausePlayback() { if (!transportRunningRef.current) return; haltPlaybackEngine(); setIsPaused(true); }
  function finishPlayback(time: number) { haltPlaybackEngine(); setTransportPosition(time); setIsPaused(false); }
  function playbackSelection(forceAll = false) {
    const enabled = forceAll ? notes : notes.filter(note => note.part < 0 || playParts[note.part]);
    const scoped = forceAll || playScope === 'all' ? enabled : playScope === 'note' ? enabled.filter(note => selectedIds.includes(note.id)) : enabled.filter(note => note.end >= playRange.start && note.start <= playRange.end);
    const ordered = [...scoped].sort((a, b) => a.start - b.start);
    const start = forceAll || playScope === 'all' ? 0 : playScope === 'range' ? playRange.start : ordered[0]?.start ?? 0;
    const end = forceAll || playScope === 'all' ? transportEnd : playScope === 'range' ? Math.min(transportEnd, playRange.end) : Math.max(start, ...ordered.map(note => note.end));
    return { ordered, start, end };
  }
  function startPlaybackAt(requestedTime: number, forceAll = false) {
    haltPlaybackEngine();
    const { ordered, start, end } = playbackSelection(forceAll);
    if ((!ordered.length && !mediaUrl) || end <= start) return;
    const requested = Math.max(start, Math.min(end, requestedTime));
    const first = requested >= end - .01 ? start : requested;
    const preview = ordered.filter(note => note.start <= end && note.end >= first);
    const transportRate = Math.max(.5, Math.min(1.5, trackSettings.speed));
    if (preview.length) {
      const context = new AudioContext();
      audioContextRef.current = context;
      void context.resume();
      preview.forEach(note => {
        const audibleStart = Math.max(note.start, first);
        const at = (audibleStart - first) / transportRate;
        const length = Math.max(.07, (Math.min(note.end, end) - audibleStart) / transportRate);
        playPianoTone(context, note, context.currentTime + at, length);
      });
    }
    startBackingTrack(first, transportRate);
    setTransportPosition(first);
    setIsPaused(false);
    const startedAt = performance.now();
    const tick = () => {
      if (!transportRunningRef.current) return;
      const next = Math.min(end, first + ((performance.now() - startedAt) / 1000) * transportRate);
      playheadRef.current = next;
      setPlayhead(next);
      if (next < end) animationFrameRef.current = requestAnimationFrame(tick);
    };
    transportRunningRef.current = true;
    setIsPlaying(true);
    tick();
    playbackTimerRef.current = setTimeout(() => finishPlayback(end), Math.max(.1, (end - first) / transportRate) * 1000 + 80);
  }
  function playFromCursor() { startPlaybackAt(playheadRef.current); }
  function playFromStart() { const selection = playbackSelection(); startPlaybackAt(selection.start); }
  function seekTransport(time: number, forceAll = false) {
    const wasPlaying = transportRunningRef.current;
    haltPlaybackEngine();
    const next = setTransportPosition(time);
    setIsPaused(false);
    if (wasPlaying) startPlaybackAt(next, forceAll);
  }
  function seekFromTimeline(time: number) { clearPlaybackSelections(); seekTransport(time, true); }
  function skipTransport(seconds: number) { seekTransport(playheadRef.current + seconds); }
  async function toggleRecording() {
    if (recording) { recorderRef.current?.stop(); return; }
    setRecordError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Recording is not supported in this browser.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderChunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size) recorderChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        const take = new Blob(recorderChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (take.size) setRecordingUrl(previous => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(take); });
        setRecording(false);
        recorderRef.current = null;
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (error) { setRecordError(error instanceof Error ? error.message : 'Unable to access the microphone.'); setRecording(false); }
  }
  function playRecordedTake() { if (recordingUrl) void new Audio(recordingUrl).play(); }
  async function save() { setSaving(true); try { await onSave({ id: song.id, title: title.trim() || song.title, notes: [...notes].sort((a, b) => a.start - b.start).map(note => ({ ...note, start: Math.max(0, roundPrecise(note.start)), end: Math.max(roundPrecise(note.start) + .001, roundPrecise(note.end)) })), backing_media_url: mediaUrl || undefined, backing_media_kind: mediaUrl ? mediaKind : undefined, backing_track_settings: { ...trackSettings, musical_timeline: musicalTimeline } }); } finally { setSaving(false); } }
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
      setMidiSourceParts({});
      setMidiPreview({ fileName: file.name, notes: parsed });
    } catch (error) { setMidiError(error instanceof Error ? error.message : 'Unable to read this MIDI file.'); }
  }
  function applyMidiImport() {
    if (!midiPreview) return;
    const imported = assignMidiParts(midiPreview.notes, normaliseSatbMidiRanges(midiRanges), midiPart, midiSourceParts);
    const division = musicalTimeline.snap_division ?? DEFAULT_SNAP_DIVISION;
    const merged = midiMode === 'replace' ? imported : [...notes, ...imported];
    const latched = quantizeAndResolveNotes(merged, musicalBars, division);
    pushHistory();
    setNotes(latched);
    setSelectedIds(imported.map(note => note.id));
    setSelectedId(imported[0]?.id ?? null);
    setSelectedPart(imported[0]?.part ?? 0);
    setMidiPreview(null);
    setTool('select');
    setEditorNotice(`Imported MIDI latched to ${NOTE_DIVISIONS.find(item => item.value === division)?.short ?? `1/${division}`}; same-voice clashes were moved to free grid positions.`);
  }

  return <div ref={editorRootRef} className="vh-editor-scrollbars fixed inset-0 z-50 overflow-hidden bg-[#020510] text-slate-100">
    <audio ref={backingMediaRef} src={mediaUrl || undefined} preload="auto" className="hidden" onLoadedMetadata={event => { const media_duration = event.currentTarget.duration; if (Number.isFinite(media_duration)) setTrackSettings(current => current.media_duration === media_duration ? current : { ...current, media_duration }); }} onTimeUpdate={enforceBackingEdits} />
    <header className="flex h-16 items-center gap-5 border-b border-white/10 bg-[#070a1b] px-5"><Brand /><nav className="hidden gap-5 text-xs text-slate-400 md:flex"><span>⌂ Home</span><span>♫ Library</span><b className="text-fuchsia-300">♫ Song Editor</b><span>♜ Leaderboards</span><span>♧ Rooms</span></nav><div className="ml-auto flex items-center gap-2"><span className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold text-emerald-300">● LIVE</span><button onClick={() => void toggleFullscreen()} aria-pressed={isFullscreen} title={isFullscreen ? 'Exit Vocal Hero fullscreen (Esc)' : 'Open the entire Vocal Hero editor fullscreen'} className="rounded-lg border border-fuchsia-300/35 bg-fuchsia-400/10 px-3 py-2 text-xs font-semibold text-fuchsia-100"><span aria-hidden="true" className="mr-1">{isFullscreen ? '⊙' : '⛶'}</span>{isFullscreen ? 'Exit fullscreen' : 'Full screen'}</button><span className="hidden rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400 sm:block">Room Code <b className="ml-1 text-[#ffd15c]">ZHY32</b></span><button onClick={onClose} className="rounded-lg border border-white/15 px-3 py-2 text-xs">Close</button></div></header>
    <div className="flex h-[calc(100vh-64px)] min-h-[620px] overflow-auto">
      <aside className="hidden w-56 shrink-0 border-r border-white/10 bg-[#070b1e] p-3 lg:block"><p className="text-sm font-semibold">Song Editor</p><div className="mt-1 flex items-center gap-2"><input value={title} onChange={event => setTitle(event.target.value)} className="w-full border-0 bg-transparent text-xs text-slate-300 outline-none" /><span className="text-fuchsia-300">✎</span></div><div className="mt-4 space-y-2">{VOICES.map((voice, index) => <VoiceStrip key={voice} name={voice} index={index} active={selectedPart === index} onClick={() => focusVoice(index)} />)}</div><button onClick={() => addNote()} className="mt-3 w-full rounded-lg border border-dashed border-fuchsia-400/40 px-3 py-2 text-xs text-fuchsia-300">＋ Add Voice Target</button><div className="mt-6 border-t border-white/10 pt-4"><p className="text-[10px] tracking-[.16em] text-slate-500">PART MIXER</p><div className="mt-3 grid grid-cols-4 gap-2">{VOICES.map((voice, index) => <div key={voice} className="rounded-lg bg-white/[.04] p-2 text-center"><b style={{ color: COLOURS[index] }}>{voice[0]}</b><div className="mx-auto mt-2 h-14 w-1 rounded-full bg-white/10"><span className="block w-full rounded-full" style={{ height: `${60 + index * 8}%`, background: COLOURS[index], transform: 'translateY(40%)' }} /></div><span className="mt-2 block text-[9px] text-slate-400">M</span></div>)}</div></div></aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(circle_at_50%_0%,#28135055,transparent_30%),#080b1c]">
        <EditorToolbar tool={tool} setTool={setTool} playScope={playScope} playParts={playParts} onPlayAll={selectAllVoices} onPlayPart={selectPlayPart} playRange={playRange} playhead={playhead} onClearSelection={selectAllVoices} selectedCount={selectedIds.length} onRemove={removeSelected} canUndo={history.past.length > 0} canRedo={history.future.length > 0} onUndo={undo} onRedo={redo} zoom={zoom} setZoom={setZoom} onDuplicate={duplicateSelected} onCopy={copySelectedNotes} onPaste={pasteCopiedNotes} clipboardCount={noteClipboard.length} onPlay={playFromCursor} onPlayFromStart={playFromStart} onPause={pausePlayback} onStop={stopPlayback} onSkip={skipTransport} isPlaying={isPlaying} isPaused={isPaused} onRecord={() => void toggleRecording()} recording={recording} onPlayTake={playRecordedTake} hasTake={Boolean(recordingUrl)} onSave={() => void save()} saving={saving} />
        <div className="flex flex-wrap items-center gap-3 border-b border-white/[.06] bg-[#090c20] px-3 py-2 text-xs">
          <button onClick={() => midiInputRef.current?.click()} className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 font-semibold text-cyan-100">Import MIDI</button>
          <button onClick={() => mediaInputRef.current?.click()} disabled={uploadingMedia} className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 font-semibold text-cyan-100 disabled:opacity-50">{uploadingMedia ? 'Uploading…' : mediaUrl ? 'Replace backing track' : 'Upload backing track'}</button>
          <span className="min-w-0 truncate text-slate-500">{mediaUrl ? `${mediaName || 'Backing track'} · synchronized with SATB` : 'Import MIDI notes or add an audio/video backing track.'}</span>
          <input ref={midiInputRef} className="hidden" type="file" accept=".mid,.midi,audio/midi,audio/x-midi" onChange={openMidi} />
          <input ref={mediaInputRef} className="hidden" type="file" accept="audio/*,video/*" onChange={uploadBackingTrack} />
          {mediaError && <p className="text-rose-200">Backing track: {mediaError}</p>}
        </div>
        {recordError && <div className="border-b border-rose-300/20 bg-rose-400/10 px-4 py-2 text-xs text-rose-200">Microphone: {recordError}</div>}
        {midiError && <div className="border-b border-rose-300/20 bg-rose-400/10 px-4 py-2 text-xs text-rose-200">MIDI import: {midiError}</div>}
        {editorNotice && <div className="flex items-center gap-3 border-b border-amber-300/20 bg-amber-300/10 px-4 py-2 text-xs text-amber-100"><span>{editorNotice}</span><button onClick={() => setEditorNotice(null)} aria-label="Dismiss editor notice" className="ml-auto rounded border border-amber-200/20 px-2 py-0.5 text-amber-100">Close</button></div>}
        <div className="flex min-h-0 flex-1">
          <section className="min-w-0 flex-1 overflow-auto p-3">
            <MusicalTimelineControls timeline={musicalTimeline} cursor={playhead ?? 0} state={cursorMusicalState} onTempo={bpm => upsertMusicalEvent('tempo', { bpm })} onMeter={(numerator, denominator) => upsertMusicalEvent('meter', { numerator, denominator })} onKey={(tonic, mode) => upsertMusicalEvent('key', { tonic, mode })} onSnapDivision={changeSnapDivision} onRemove={removeMusicalEvent} />
            <BeatPrecisionPanel selectedNotes={selectedNotes} bars={musicalBars} cursor={playhead ?? 0} clipboardCount={noteClipboard.length} onCopy={copySelectedNotes} onPaste={pasteCopiedNotes} />
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400"><p className="mr-auto max-w-4xl leading-relaxed"><b className="text-slate-200">Select in either Select or Draw mode.</b> Drag a note body left/right for timing and up/down for pitch. Ctrl-click adds individual notes; drag empty space to lasso any notes inside the rectangle. Starts and durations latch to the selected musical note value; a single voice cannot contain overlapping targets.</p><button onClick={() => setCollapsedVoices([true, true, true, true])} className="rounded-md border border-white/10 px-2 py-1 text-slate-300">Collapse all voices</button><button onClick={() => setCollapsedVoices([false, false, false, false])} className="rounded-md border border-white/10 px-2 py-1 text-slate-300">Expand all voices</button></div>
            <div className="overflow-auto rounded-xl border border-[#7650d8]/40 bg-[#050716] shadow-[0_18px_55px_#0008,0_0_30px_#6d28d915]" style={{ maxHeight: 'max(420px, calc(100vh - 290px))' }}>
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
                  {VOICES.map((voice, index) => <PianoTrack key={voice} name={voice} part={index} notes={noteByPart[index]} selectedId={selectedId} selectedIds={selectedIds} tool={tool} playhead={playhead} selectedRange={playScope === 'range' && rangeParts && index >= rangeParts.start && index <= rangeParts.end ? playRange : null} width={timelineWidth} zoom={zoom} bars={musicalBars} collapsed={collapsedVoices[index]} onToggleCollapse={() => setCollapsedVoices(current => current.map((value, part) => part === index ? !value : value))} onAdd={handleLaneClick} onSelect={selectNote} onRemove={removeNote} onNoteMoveStart={beginNoteMove} onNoteMove={moveNote} onNoteMoveEnd={endNoteMove} onResizeStart={beginResizeHistory} onResize={resizeNote} onEmptyClick={clearPlaybackSelections} />)}
                </div>
              </div>
            </div>
            <details className="mt-3 rounded-xl border border-white/10 bg-[#070a18] px-3 py-2 text-xs">
              <summary className="cursor-pointer font-semibold text-slate-300">Arrangement controls: dynamics, breath &amp; part mixer</summary>
              <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_auto]">
                <Automation notes={notes} />
                <div className="grid grid-cols-4 gap-2">{VOICES.map((voice, index) => <button key={voice} onClick={() => focusVoice(index)} className="rounded-lg border px-3 py-2 text-center" style={{ borderColor: `${COLOURS[index]}66`, color: COLOURS[index], background: `${COLOURS[index]}12` }}><b className="block text-base">{voice[0]}</b><span className="text-[10px]">{voice}</span></button>)}</div>
              </div>
            </details>
          </section>
          <Inspector selected={selected} bars={musicalBars} update={update} onDelete={removeSelected} onDuplicate={duplicateSelected} />
        </div>
        {showBackingEditor && <div className="absolute inset-0 z-40 grid place-items-center bg-[#020510]/85 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-label="Backing track editor" className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-cyan-300/30 bg-[#08101f] shadow-[0_0_60px_#22d3ee20]"><header className="flex items-center gap-3 border-b border-white/10 px-5 py-4"><div><p className="text-[10px] font-bold tracking-[.2em] text-cyan-300">BACKING TRACK</p><h2 className="text-lg font-semibold">Audio/video arrangement</h2></div><button onClick={() => setShowBackingEditor(false)} className="ml-auto rounded-lg border border-white/15 px-4 py-2 text-xs">Done</button></header><div className="min-h-0 overflow-y-auto p-4"><BackingTrackPanel url={mediaUrl} kind={mediaKind} fileName={mediaName} settings={trackSettings} setSettings={setTrackSettings} uploading={uploadingMedia} transportTime={playhead} transportPlaying={isPlaying} onUpload={() => mediaInputRef.current?.click()} /></div></section></div>}
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
    `}</style>
  </div>;
}

function Brand() { return <b className="text-xl">VOCAL<span className="text-fuchsia-400">Hero</span></b>; }
function VoiceStrip({ name, index, active, onClick }: { name: string; index: number; active: boolean; onClick: () => void }) { return <button onClick={onClick} className="w-full rounded-xl border p-3 text-left" style={{ borderColor: active ? COLOURS[index] : `${COLOURS[index]}55`, background: active ? `${COLOURS[index]}19` : `${COLOURS[index]}08` }}><div className="flex items-center gap-2"><b className="text-2xl" style={{ color: COLOURS[index] }}>{name[0]}</b><span><b className="block text-xs" style={{ color: COLOURS[index] }}>{name.toUpperCase()}</b><span className="text-[10px] text-slate-500">⌁ mic · active</span></span></div><div className="mt-3 h-1 rounded-full bg-white/10"><span className="block h-full w-2/3 rounded-full" style={{ background: COLOURS[index] }} /></div></button>; }
function MusicalTimelineControls({ timeline, cursor, state, onTempo, onMeter, onKey, onSnapDivision, onRemove }: { timeline: MusicalTimelineSettings; cursor: number; state: MusicalState; onTempo: (bpm: number) => void; onMeter: (numerator: number, denominator: number) => void; onKey: (tonic: string, mode: string) => void; onSnapDivision: (division: NoteDivision) => void; onRemove: (kind: 'tempo' | 'meter' | 'key', at: number) => void }) {
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
  const field = 'rounded-lg border border-white/15 bg-[#070b1d] px-2 py-2 text-sm font-semibold text-white outline-none focus:border-fuchsia-300/70 focus:ring-2 focus:ring-fuchsia-400/15';
  return <details open className="mb-3 rounded-xl border border-fuchsia-300/20 bg-[linear-gradient(135deg,#15102e,#081326)] text-xs shadow-[0_8px_24px_#0006]">
    <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5"><span className="grid h-8 w-8 place-items-center rounded-lg bg-fuchsia-400/15 text-lg text-fuchsia-200">♩</span><span><b className="block text-sm text-white">Musical timeline</b><small className="text-slate-400">Editable BPM, metre and key at the playhead</small></span><span className="ml-auto rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 font-mono text-cyan-100">Cursor {formatClock(cursor)}</span></summary>
    <div className="grid gap-3 border-t border-white/10 p-3 sm:grid-cols-2 xl:grid-cols-[150px_190px_240px_minmax(260px,1fr)]">
      <label className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">Quarter-note BPM<input aria-label="BPM at cursor" value={bpmDraft} onChange={event => setBpmDraft(event.target.value)} onBlur={commitBpm} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} inputMode="numeric" className={`${field} mt-1 w-full`} /></label>
      <label className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">Time signature<span className="mt-1 flex items-center gap-1"><input aria-label="Time signature numerator" value={numeratorDraft} onChange={event => setNumeratorDraft(event.target.value)} onBlur={commitNumerator} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} inputMode="numeric" className={`${field} min-w-0 flex-1 text-center`} /><b className="text-lg text-slate-500">/</b><select aria-label="Time signature denominator" value={state.denominator} onChange={event => onMeter(state.numerator, Number(event.target.value))} className={`${field} min-w-0 flex-1 text-center`}>{[1, 2, 4, 8, 16, 32].map(value => <option key={value}>{value}</option>)}</select></span></label>
      <label className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">Key at cursor<span className="mt-1 flex gap-1"><select aria-label="Key tonic" value={state.tonic} onChange={event => onKey(event.target.value, state.mode)} className={`${field} min-w-0 flex-1`}>{KEY_TONICS.map(value => <option key={value}>{value}</option>)}</select><select aria-label="Key mode" value={state.mode} onChange={event => onKey(state.tonic, event.target.value)} className={`${field} min-w-0 flex-[1.4]`}>{KEY_MODES.map(value => <option key={value}>{value}</option>)}</select></span></label>
      <label className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">Rhythmic latch<span className="mt-1 flex gap-1"><select aria-label="Rhythmic note value" value={timeline.snap_division ?? DEFAULT_SNAP_DIVISION} onChange={event => onSnapDivision(Number(event.target.value) as NoteDivision)} className={`${field} min-w-0 flex-1`}>{NOTE_DIVISIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><button type="button" onClick={() => onSnapDivision(timeline.snap_division ?? DEFAULT_SNAP_DIVISION)} title="Relatch every note to this value" className="rounded-lg border border-fuchsia-300/30 bg-fuchsia-400/10 px-2 text-fuchsia-100">Latch all</button></span></label>
    </div>
    {changes.length > 0 && <div className="flex flex-wrap items-center gap-2 border-t border-white/[.07] px-3 py-2"><span className="mr-1 text-[10px] font-bold uppercase tracking-[.12em] text-slate-500">Later changes</span>{changes.map(change => <button key={`${change.kind}-${change.at}`} onClick={() => onRemove(change.kind, change.at)} title="Remove this musical change" className="rounded-full border border-white/10 bg-white/[.04] px-2.5 py-1 text-slate-300 hover:border-rose-300/40 hover:text-rose-200"><b className="mr-1 text-cyan-200">{formatClock(change.at)}</b>{change.label} ×</button>)}</div>}
  </details>;
}
function BeatPrecisionPanel({ selectedNotes, bars, cursor, clipboardCount, onCopy, onPaste }: { selectedNotes: SongNote[]; bars: MusicalBar[]; cursor: number; clipboardCount: number; onCopy: () => void; onPaste: () => void }) {
  const primary = selectedNotes[0];
  const position = primary ? beatPositionAt(bars, primary.start) : beatPositionAt(bars, cursor);
  const hold = primary ? durationInBeats(bars, primary.start, primary.end) : 0;
  const stateLabel = position ? beatOffsetLabel(position.fraction) : 'NO POSITION';
  const onGrid = stateLabel !== 'NO POSITION' && !stateLabel.startsWith('OFF GRID');
  return <section className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-cyan-300/20 bg-[linear-gradient(90deg,#071729,#11102d)] px-3 py-2.5 text-xs shadow-[0_8px_24px_#0005]" aria-label="Beat precision" aria-live="polite">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 font-mono text-lg font-black text-cyan-100">{position?.beat ?? '·'}</span>
    <span><b className="block text-[10px] uppercase tracking-[.15em] text-cyan-300">{primary ? `${selectedNotes.length} selected note${selectedNotes.length === 1 ? '' : 's'}` : 'Paste destination'}</b><span className="font-semibold text-white">{primary ? `${midiNoteName(primary.midi)} · ${primary.lyric || 'Note'}` : `Playhead ${formatClock(cursor)}`}</span></span>
    <span className="h-8 w-px bg-white/10" />
    <span><small className="block text-[9px] uppercase tracking-[.12em] text-slate-500">Bar · beat</small><b className="font-mono text-base text-white">{compactBeatLabel(position)}</b></span>
    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black tracking-[.08em] ${onGrid ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200' : 'border-amber-300/35 bg-amber-300/10 text-amber-100'}`}>{stateLabel}</span>
    {primary && <><span><small className="block text-[9px] uppercase tracking-[.12em] text-slate-500">Hold length</small><b className="font-mono text-sm text-fuchsia-200">{hold.toFixed(2)} beats</b></span><span><small className="block text-[9px] uppercase tracking-[.12em] text-slate-500">Exact time</small><b className="font-mono text-[11px] text-slate-200">{primary.start.toFixed(3)}s–{primary.end.toFixed(3)}s</b></span></>}
    <span className="ml-auto flex items-center gap-2"><button onClick={onCopy} disabled={!selectedNotes.length} className="rounded-lg border border-cyan-300/25 px-3 py-2 text-cyan-100 disabled:opacity-35">Copy <kbd className="ml-1 text-[9px] text-slate-400">Ctrl+C</kbd></button><button onClick={onPaste} disabled={!clipboardCount} title="Pastes the earliest copied note at the current playhead" className="rounded-lg border border-fuchsia-300/35 bg-fuchsia-300/10 px-3 py-2 text-fuchsia-100 disabled:opacity-35">Paste here <kbd className="ml-1 text-[9px] text-slate-400">Ctrl+V</kbd></button></span>
  </section>;
}
function EditorToolbar({ tool, setTool, playScope, playParts, onPlayAll, onPlayPart, playRange, playhead, onClearSelection, selectedCount, onRemove, canUndo, canRedo, onUndo, onRedo, zoom, setZoom, onDuplicate, onCopy, onPaste, clipboardCount, onPlay, onPlayFromStart, onPause, onStop, onSkip, isPlaying, isPaused, onRecord, recording, onPlayTake, hasTake, onSave, saving }: { tool: EditorTool; setTool: (tool: EditorTool) => void; playScope: PlaybackScope; playParts: boolean[]; onPlayAll: () => void; onPlayPart: (part: number, additive?: boolean) => void; playRange: { start: number; end: number }; playhead: number | null; onClearSelection: () => void; selectedCount: number; onRemove: () => void; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; zoom: number; setZoom: (value: number) => void; onDuplicate: () => void; onCopy: () => void; onPaste: () => void; clipboardCount: number; onPlay: () => void; onPlayFromStart: () => void; onPause: () => void; onStop: () => void; onSkip: (seconds: number) => void; isPlaying: boolean; isPaused: boolean; onRecord: () => void; recording: boolean; onPlayTake: () => void; hasTake: boolean; onSave: () => void; saving: boolean }) {
  const toolButton = (value: EditorTool, label: string) => <button onClick={() => setTool(value)} className={`rounded-lg border px-3 py-2 ${tool === value ? 'border-fuchsia-400/60 bg-fuchsia-500/20 text-fuchsia-100' : 'border-white/10 text-slate-100'}`}>{label}</button>;
  const status = playScope === 'range' ? `Range ${playRange.start.toFixed(2)}s–${playRange.end.toFixed(2)}s` : playScope === 'note' ? `${selectedCount || 1} selected note${selectedCount === 1 ? '' : 's'}` : playParts.every(Boolean) ? 'All voices' : VOICES.filter((_, index) => playParts[index]).join(' + ');
  const formatTime = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds)) % 60).padStart(2, '0')}`;
  return <div className="border-b border-white/10 bg-[#0a0c20] text-xs">
    <div className="flex h-14 items-center gap-2 overflow-x-auto px-3">
      {toolButton('select', 'Select')}{toolButton('draw', 'Draw')}{toolButton('erase', 'Erase')}
      <button onClick={onDuplicate} disabled={!selectedCount} className="rounded-lg border border-white/10 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40">Duplicate</button>
      <button onClick={onCopy} disabled={!selectedCount} title="Copy selected notes (Ctrl/Cmd+C)" className="rounded-lg border border-cyan-300/25 px-3 py-2 text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40">Copy</button>
      <button onClick={onPaste} disabled={!clipboardCount} title="Paste copied notes at the playhead (Ctrl/Cmd+V)" className="rounded-lg border border-fuchsia-300/30 bg-fuchsia-400/[.07] px-3 py-2 text-fuchsia-100 disabled:cursor-not-allowed disabled:opacity-40">Paste{clipboardCount ? ` (${clipboardCount})` : ''}</button>
      <button onClick={onRemove} disabled={!selectedCount} className="rounded-lg border border-rose-300/35 px-3 py-2 text-rose-200 disabled:cursor-not-allowed disabled:opacity-40">Remove{selectedCount > 1 ? ` (${selectedCount})` : ''}</button>
      <span className="h-6 w-px bg-white/10" /><button onClick={onUndo} disabled={!canUndo} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40">Undo</button><button onClick={onRedo} disabled={!canRedo} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40">Redo</button><span className="h-6 w-px bg-white/10" />
      <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">Audition voices</span>
      <button onClick={onPlayAll} className={`rounded-md border px-3 py-2 ${playParts.every(Boolean) && playScope === 'all' ? 'border-fuchsia-300/60 bg-fuchsia-500/15 text-fuchsia-100' : 'border-white/10 text-slate-300'}`}>All SATB</button>
      {VOICES.map((voice, index) => <button key={voice} title="Click for this voice only. Shift-click to add/remove a voice." onClick={event => onPlayPart(index, event.shiftKey)} className="rounded-md border px-3 py-2 font-bold" style={{ borderColor: playParts[index] ? COLOURS[index] : '#ffffff22', color: playParts[index] ? COLOURS[index] : '#64748b', background: playParts[index] ? `${COLOURS[index]}16` : 'transparent' }}>{voice}</button>)}
      <button onClick={onSave} disabled={saving} className="ml-auto rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 font-bold text-cyan-100">{saving ? 'Saving…' : 'Save'}</button>
    </div>
    <div className="flex h-14 items-center gap-2 overflow-x-auto border-t border-white/[.06] px-3">
      <span className="mr-1 whitespace-nowrap text-slate-400">{status}</span>
      {playScope !== 'all' && <button onClick={onClearSelection} className="rounded-md border border-white/10 px-3 py-2 text-slate-200">Clear selection</button>}
      <button onClick={onPlayFromStart} title="Play the current voice selection from its beginning" className="rounded-lg border border-white/15 px-3 py-2 text-slate-100">⏮ From start</button>
      <button onClick={() => onSkip(-5)} title="Rewind five seconds" className="rounded-lg border border-white/10 px-3 py-2 text-slate-200">−5s</button>
      <button onClick={isPlaying ? onPause : onPlay} className={`min-w-20 rounded-lg border px-4 py-2 font-semibold ${isPlaying ? 'border-amber-300/50 bg-amber-300/10 text-amber-100' : 'border-fuchsia-300/50 bg-fuchsia-500/15 text-fuchsia-100'}`}>{isPlaying ? 'Pause' : isPaused ? 'Resume' : 'Play'}</button>
      <button onClick={onStop} title="Stop and return to the start" className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 text-cyan-100">Stop</button>
      <button onClick={() => onSkip(5)} title="Fast-forward five seconds" className="rounded-lg border border-white/10 px-3 py-2 text-slate-200">+5s</button>
      <span className="min-w-16 whitespace-nowrap font-mono text-cyan-200">{formatTime(playhead ?? 0)}</span>
      <button onClick={onRecord} className={`rounded-lg border px-3 py-2 ${recording ? 'border-rose-300 bg-rose-500/20 text-rose-100' : 'border-white/10 text-rose-300'}`}>{recording ? 'Stop recording' : 'Record'}</button>
      {hasTake && <button onClick={onPlayTake} className="rounded-lg border border-emerald-300/30 px-3 py-2 text-emerald-200">Play take</button>}
      <label className="ml-auto flex shrink-0 items-center gap-2 text-slate-400">Zoom <b className="w-8 text-right text-fuchsia-200">{Math.round((zoom / 16) * 10) / 10}x</b><input aria-label="Timeline zoom" type="range" min="16" max="160" step="2" value={zoom} onChange={event => setZoom(Number(event.target.value))} className="accent-fuchsia-400" /></label>
    </div>
  </div>;
}
/* Legacy toolbar retained temporarily for visual regression reference.
function EditorToolbarLegacy({ tool, setTool, playScope, playParts, onPlayAll, onPlayPart, playRange, playhead, onClearSelection, selectedCount, onRemove, canUndo, canRedo, onUndo, onRedo, zoom, setZoom, onDuplicate, onPlay, isPlaying, onRecord, recording, onPlayTake, hasTake, onSave, saving }: { tool: EditorTool; setTool: (tool: EditorTool) => void; playScope: PlaybackScope; playParts: boolean[]; onPlayAll: () => void; onPlayPart: (part: number, additive?: boolean) => void; playRange: { start: number; end: number }; playhead: number | null; onClearSelection: () => void; selectedCount: number; onRemove: () => void; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; zoom: number; setZoom: (value: number) => void; onDuplicate: () => void; onPlay: () => void; isPlaying: boolean; onRecord: () => void; recording: boolean; onPlayTake: () => void; hasTake: boolean; onSave: () => void; saving: boolean }) {
  const toolButton = (value: EditorTool, label: string) => <button onClick={() => setTool(value)} className={`rounded-lg border px-3 py-2 ${tool === value ? 'border-fuchsia-400/60 bg-fuchsia-500/20 text-fuchsia-100' : 'border-white/10 text-slate-100'}`}>{label}</button>;
  const status = playScope === 'range' ? `Range ${playRange.start.toFixed(2)}s–${playRange.end.toFixed(2)}s` : playScope === 'note' ? `${selectedCount || 1} selected note${selectedCount === 1 ? '' : 's'}` : playParts.every(Boolean) ? 'All voices from start' : `${VOICES.filter((_, index) => playParts[index]).join(' + ')} from start`;
  return <div className="border-b border-white/10 bg-[#0a0c20] text-xs"><div className="flex h-14 items-center gap-2 overflow-x-auto px-3">{toolButton('select', 'Select')}{toolButton('draw', 'Draw')}{toolButton('erase', 'Erase')}<button onClick={onDuplicate} disabled={!selectedCount} className="rounded-lg border border-white/10 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40">Duplicate</button><button onClick={onRemove} disabled={!selectedCount} className="rounded-lg border border-rose-300/35 px-3 py-2 text-rose-200 disabled:cursor-not-allowed disabled:opacity-40">Remove{selectedCount > 1 ? ` (${selectedCount})` : ''}</button><span className="h-6 w-px bg-white/10" /><button onClick={onUndo} disabled={!canUndo} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40">Undo</button><button onClick={onRedo} disabled={!canRedo} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40">Redo</button><span className="h-6 w-px bg-white/10" /><span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">Audition voices</span><button onClick={onPlayAll} className={`rounded-md border px-3 py-2 ${playParts.every(Boolean) && playScope === 'all' ? 'border-fuchsia-300/60 bg-fuchsia-500/15 text-fuchsia-100' : 'border-white/10 text-slate-300'}`}>All SATB</button>{VOICES.map((voice, index) => <button key={voice} title="Click for this voice only. Shift-click to add/remove a voice." onClick={event => onPlayPart(index, event.shiftKey)} className="rounded-md border px-3 py-2 font-bold" style={{ borderColor: playParts[index] ? COLOURS[index] : '#ffffff22', color: playParts[index] ? COLOURS[index] : '#64748b', background: playParts[index] ? `${COLOURS[index]}16` : 'transparent' }}>{voice}</button>)}<button onClick={onSave} disabled={saving} className="ml-auto rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 font-bold text-cyan-100">{saving ? 'Saving…' : 'Save'}</button></div><div className="flex h-14 items-center gap-3 overflow-x-auto border-t border-white/[.06] px-3"><span className="whitespace-nowrap text-slate-400">{status}</span>{playScope !== 'all' && <button onClick={onClearSelection} className="rounded-md border border-white/10 px-3 py-2 text-slate-200">Clear selection</button>}<button onClick={onPlay} className={`rounded-lg border px-4 py-2 font-semibold ${isPlaying ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-100' : 'border-fuchsia-300/40 bg-fuchsia-500/10 text-fuchsia-100'}`}>{isPlaying ? 'Stop' : 'Play from start'}</button>{isPlaying && <span className="whitespace-nowrap text-cyan-200">Now {playhead?.toFixed(2)}s</span>}<button onClick={onRecord} className={`rounded-lg border px-3 py-2 ${recording ? 'border-rose-300 bg-rose-500/20 text-rose-100' : 'border-white/10 text-rose-300'}`}>{recording ? 'Stop recording' : 'Record'}</button>{hasTake && <button onClick={onPlayTake} className="rounded-lg border border-emerald-300/30 px-3 py-2 text-emerald-200">Play take</button>}<label className="ml-auto flex shrink-0 items-center gap-2 text-slate-400">Zoom <b className="w-8 text-right text-fuchsia-200">{Math.round((zoom / 16) * 10) / 10}x</b><input aria-label="Timeline zoom" type="range" min="16" max="160" step="2" value={zoom} onChange={event => setZoom(Number(event.target.value))} className="accent-fuchsia-400" /></label></div></div>;
}
*/
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
  return <div className="absolute inset-0 z-40 grid place-items-center bg-[#020510]/85 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-label="Import MIDI" className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-cyan-300/30 bg-[#0a1024] p-5 shadow-[0_0_50px_#27d9ff25]"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold tracking-[.2em] text-cyan-300">MIDI IMPORT</p><h2 className="mt-1 text-xl font-semibold">Review exact note targets</h2><p className="mt-1 text-xs text-slate-400">{preview.fileName} · {preview.notes.length} note events · {midiNoteName(previewLow)}–{midiNoteName(previewHigh)}</p></div><button onClick={onCancel} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">Cancel</button></div><p className="mt-4 rounded-lg border border-cyan-300/20 bg-cyan-300/5 p-3 text-xs leading-relaxed text-cyan-100"><b>Pitch is imported as the exact MIDI note number.</b> PPQN timing and tempo changes are converted with millisecond precision. SATB placement is separate: use source mapping when the file has distinct tracks/channels, or adjust the pitch ceilings for a single merged performance.</p><div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-xs text-slate-400">Overall placement<select value={fixedPart === null ? 'auto' : String(fixedPart)} onChange={event => setFixedPart(event.target.value === 'auto' ? null : Number(event.target.value))} className="mt-1 w-full rounded-lg border border-white/10 bg-[#050816] px-3 py-2 text-sm text-white"><option value="auto">Use source mapping, then pitch range</option>{VOICES.map((voice, index) => <option key={voice} value={index}>Place every note in {voice}</option>)}</select></label><label className="text-xs text-slate-400">Import action<select value={mode} onChange={event => setMode(event.target.value as 'replace' | 'append')} className="mt-1 w-full rounded-lg border border-white/10 bg-[#050816] px-3 py-2 text-sm text-white"><option value="replace">Replace current arrangement</option><option value="append">Append to current arrangement</option></select></label></div>{fixedPart === null && <><div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-200">MIDI track/channel mapping</p><p className="text-[10px] text-slate-500">Overrides pitch guessing</p></div><div className="mt-3 grid gap-2">{sources.map(source => { const low = source.notes.reduce((lowest, note) => Math.min(lowest, note.midi), 127), high = source.notes.reduce((highest, note) => Math.max(highest, note.midi), 0); return <label key={source.key} className="grid items-center gap-2 rounded-lg border border-white/[.07] bg-white/[.025] p-2 text-xs sm:grid-cols-[1fr_190px]"><span><b className="text-slate-200">Track {source.track + 1} · Channel {source.channel + 1}</b><span className="mt-1 block text-[10px] text-slate-500">{source.notes.length} notes · {midiNoteName(low)}–{midiNoteName(high)}</span></span><select value={sourceParts[source.key] ?? -1} onChange={event => setSourceParts({ ...sourceParts, [source.key]: Number(event.target.value) })} className="rounded-lg border border-white/10 bg-[#050816] px-3 py-2 text-white"><option value={-1}>Auto by pitch</option>{VOICES.map((voice, index) => <option key={voice} value={index}>{voice}</option>)}</select></label>; })}</div></div><div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-slate-200">Automatic SATB pitch buckets</p><p className="text-[10px] text-slate-500">Used by sources left on Auto</p></div><div className="mt-3 grid gap-3 sm:grid-cols-3">{([{ key: 'bassMax', label: 'Bass ceiling' }, { key: 'tenorMax', label: 'Tenor ceiling' }, { key: 'altoMax', label: 'Alto ceiling' }] as const).map(({ key, label }) => <label key={key} className="text-xs text-slate-400">{label} <b className="text-cyan-200">{midiNoteName(ranges[key])}</b><input type="number" min="0" max="127" value={ranges[key]} onChange={event => updateRange(key, Number(event.target.value))} className="mt-1 w-full rounded-lg border border-white/10 bg-[#050816] px-3 py-2 text-white" /></label>)}</div><div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px]">{VOICES.map((voice, index) => <div key={voice} className="rounded-lg border p-2" style={{ borderColor: `${COLOURS[index]}55`, color: COLOURS[index] }}><b className="block text-base">{counts[index]}</b>{voice}</div>)}</div></div></>}<div className="mt-5 flex justify-end gap-3"><button onClick={onCancel} className="rounded-lg border border-white/10 px-4 py-2 text-sm">Cancel</button><button onClick={onApply} className="rounded-lg border border-cyan-300/40 bg-cyan-300/15 px-4 py-2 text-sm font-semibold text-cyan-100">Import {preview.notes.length} exact notes</button></div></section></div>;
}
function MusicalGridOverlay({ bars, zoom, labels = false }: { bars: MusicalBar[]; zoom: number; labels?: boolean }) {
  return <span className="pointer-events-none absolute inset-0 z-[2]" aria-hidden="true">{bars.map(bar => <span key={`${bar.number}-${bar.start}`}><i className="absolute inset-y-0 w-0.5 bg-cyan-100/65 shadow-[0_0_10px_#22d3ee45]" style={{ left: bar.start * zoom }} />{bar.beats.map(beat => { const beatWidth = Math.max(1, (beat.end - beat.start) * zoom); return <span key={beat.start} className="absolute inset-y-0 border-l border-slate-200/30" style={{ left: beat.start * zoom, width: beatWidth, background: beat.beat % 2 ? 'linear-gradient(90deg,#67e8f908,transparent)' : 'linear-gradient(90deg,#d8b4fe0b,transparent)' }}><i className="absolute inset-y-0 left-1/2 w-px bg-fuchsia-200/15" />{beat.subdivisionStarts.map(value => <i key={value} className="absolute inset-y-0 w-px bg-slate-300/[.09]" style={{ left: (value - beat.start) * zoom }} />)}{labels && beatWidth >= 27 && <b className="absolute left-1 top-1 rounded bg-[#050817]/80 px-1 font-mono text-[8px] font-semibold text-cyan-100/80">{bar.number}.{beat.beat}</b>}</span>; })}</span>)}</span>;
}
function PianoTrack({ name, part, notes, selectedId, selectedIds, tool, playhead, selectedRange, width, zoom, bars, collapsed, onToggleCollapse, onAdd, onSelect, onRemove, onNoteMoveStart, onNoteMove, onNoteMoveEnd, onResizeStart, onResize }: { name: string; part: number; notes: SongNote[]; selectedId: string | null; selectedIds: string[]; tool: EditorTool; playhead: number | null; selectedRange: { start: number; end: number } | null; width: number; zoom: number; bars: MusicalBar[]; collapsed: boolean; onToggleCollapse: () => void; onAdd: (part: number, event: React.MouseEvent<HTMLDivElement>) => void; onSelect: (id: string, additive?: boolean) => void; onRemove: (id: string) => void; onNoteMoveStart: (id: string, clientX: number, clientY: number, additive?: boolean) => void; onNoteMove: (clientX: number, clientY: number) => boolean; onNoteMoveEnd: () => boolean; onResizeStart: () => void; onResize: (id: string, end: number) => void; onEmptyClick: () => void }) {
  const resizing = useRef<{ id: string; start: number; initialEnd: number; noteStart: number } | null>(null);
  const notePointerActive = useRef(false);
  const suppressNoteClick = useRef(false);
  const range = pitchRangeForPart(part);
  const pitches = Array.from({ length: range.max - range.min + 1 }, (_, index) => range.max - index);
  const laneHeight = PITCH_HEADER_HEIGHT + pitches.length * PITCH_ROW_HEIGHT;
  function beginResize(event: React.PointerEvent<HTMLSpanElement>, note: SongNote) { event.stopPropagation(); onResizeStart(); resizing.current = { id: note.id, start: event.clientX, initialEnd: note.end, noteStart: note.start }; event.currentTarget.setPointerCapture(event.pointerId); }
  function resize(event: React.PointerEvent<HTMLSpanElement>) { const active = resizing.current; if (!active) return; onResize(active.id, Math.max(active.noteStart + .001, active.initialEnd + ((event.clientX - active.start) / zoom))); }
  function finishResize(event: React.PointerEvent<HTMLSpanElement>) { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); resizing.current = null; }
  function beginMove(event: React.PointerEvent<HTMLButtonElement>, note: SongNote) { event.stopPropagation(); if ((tool !== 'select' && tool !== 'draw') || event.button !== 0) return; notePointerActive.current = true; suppressNoteClick.current = true; onNoteMoveStart(note.id, event.clientX, event.clientY, event.ctrlKey || event.metaKey || event.shiftKey); event.currentTarget.setPointerCapture(event.pointerId); }
  function move(event: React.PointerEvent<HTMLButtonElement>) { if (!notePointerActive.current) return; suppressNoteClick.current = onNoteMove(event.clientX, event.clientY) || suppressNoteClick.current; }
  function finishMove(event: React.PointerEvent<HTMLButtonElement>) { if (!notePointerActive.current) return; suppressNoteClick.current = onNoteMoveEnd() || suppressNoteClick.current; notePointerActive.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  if (collapsed) return <div id={`vh-voice-${part}`} className="flex h-14 scroll-mt-3 overflow-hidden border-b border-cyan-100/10" data-voice-part={part}>
    <button onPointerDown={event => event.stopPropagation()} onClick={onToggleCollapse} title={`Expand ${name} piano roll`} className="sticky left-0 z-10 flex w-[124px] shrink-0 items-center gap-2 border-r border-cyan-100/10 bg-[#0c1025] px-2 text-left"><span className="text-lg" style={{ color: COLOURS[part] }}>{name[0]}</span><span><b className="block text-xs" style={{ color: COLOURS[part] }}>{name}</b><small className="text-[9px] text-slate-500">{midiNoteName(range.min)}–{midiNoteName(range.max)}</small></span><span className="ml-auto text-slate-400">▸</span></button>
    <div className="relative bg-[#070a19]" style={{ width }}><MusicalGridOverlay bars={bars} zoom={zoom} />
      {notes.map(note => <span key={note.id} className="pointer-events-none absolute h-2 rounded-full" style={{ left: note.start * zoom, top: 8 + ((range.max - note.midi) / Math.max(1, range.max - range.min)) * 32, width: Math.max(3, (note.end - note.start) * zoom), background: COLOURS[part], boxShadow: selectedIds.includes(note.id) ? `0 0 12px ${COLOURS[part]}` : undefined }} />)}
      {playhead !== null && <span className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white shadow-[0_0_12px_#f4a5ff]" style={{ left: playhead * zoom }} />}
    </div>
  </div>;
  return <div id={`vh-voice-${part}`} className="flex scroll-mt-3 overflow-hidden border-b border-cyan-100/10" data-voice-part={part} style={{ height: laneHeight }}>
    <div className="sticky left-0 z-30 w-[124px] shrink-0 border-r border-cyan-100/15 bg-[#090d20] shadow-[7px_0_18px_#0008]">
      <div className="absolute inset-x-0 top-0 flex h-[34px] items-center gap-1 border-b border-cyan-100/15 bg-[#111631] px-2"><b className="text-[23px] leading-none" style={{ color: COLOURS[part] }}>{name[0]}</b><b className="truncate text-[17px]" style={{ color: COLOURS[part] }}>{name}</b><button onPointerDown={event => event.stopPropagation()} onClick={onToggleCollapse} title={`Collapse ${name} piano roll`} className="ml-auto rounded px-1 text-sm text-slate-400 hover:bg-white/10 hover:text-white">▾</button></div>
      {pitches.map((pitch, index) => { const sharp = [1, 3, 6, 8, 10].includes(pitch % 12); return <span key={pitch} className={`absolute right-1 flex items-center justify-end border font-mono text-[12px] font-bold shadow-sm ${sharp ? 'w-[86px] rounded-l-md border-slate-600 bg-[linear-gradient(90deg,#05070d,#222a3d)] pr-2 text-cyan-100' : 'left-1 rounded-l-md border-slate-300/30 bg-[linear-gradient(90deg,#edf4ff,#aebbd2)] pr-3 text-[#111827]'}`} style={{ top: PITCH_HEADER_HEIGHT + index * PITCH_ROW_HEIGHT + 1, height: PITCH_ROW_HEIGHT - 2 }}><span className="mr-auto ml-2 text-[8px] opacity-55">{sharp ? '♯' : '▏'}</span>{midiNoteName(pitch)}</span>; })}
    </div>
    <div onClick={event => onAdd(part, event)} className={`relative bg-[#060919] ${tool === 'draw' ? 'cursor-crosshair' : tool === 'erase' ? 'cursor-not-allowed' : 'cursor-default'}`} style={{ width, height: laneHeight }}><MusicalGridOverlay bars={bars} zoom={zoom} labels />
      <span className="pointer-events-none absolute inset-x-0 top-0 h-[34px] border-b border-cyan-200/15 bg-[linear-gradient(90deg,rgba(255,255,255,.035),transparent)]" />
      {pitches.map((pitch, index) => <span key={pitch} className={`pointer-events-none absolute inset-x-0 border-b ${[1, 3, 6, 8, 10].includes(pitch % 12) ? 'border-white/[.035] bg-black/25' : pitch % 12 === 0 ? 'border-cyan-100/20 bg-cyan-200/[.025]' : 'border-white/[.075]'}`} style={{ top: PITCH_HEADER_HEIGHT + index * PITCH_ROW_HEIGHT, height: PITCH_ROW_HEIGHT }} />)}
      {selectedRange && <span className="pointer-events-none absolute inset-y-0 z-[1] bg-fuchsia-300/15 ring-1 ring-inset ring-fuchsia-200/60" style={{ left: selectedRange.start * zoom, width: Math.max(2, (selectedRange.end - selectedRange.start) * zoom) }} />}
      {playhead !== null && <span className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white shadow-[0_0_12px_#f4a5ff]" style={{ left: playhead * zoom }} />}
      {notes.filter(note => note.part === part || note.part === -1).map(note => { const active = playhead !== null && playhead >= note.start && playhead < note.end; const inRange = selectedRange && note.end >= selectedRange.start && note.start <= selectedRange.end; const isSelected = selectedIds.includes(note.id); const position = beatPositionAt(bars, note.start); const beatLabel = compactBeatLabel(position); const offsetLabel = position ? beatOffsetLabel(position.fraction) : 'No beat'; return <button key={note.id} data-note-id={note.id} aria-pressed={isSelected} title={`${midiNoteName(note.midi)} · Bar/beat ${beatLabel} · ${offsetLabel} · ${note.start.toFixed(3)}s–${note.end.toFixed(3)}s · drag in any direction`} onPointerDown={event => beginMove(event, note)} onPointerMove={move} onPointerUp={finishMove} onPointerCancel={finishMove} onDoubleClick={event => { event.stopPropagation(); const additive = event.ctrlKey || event.metaKey || event.shiftKey; if (!isSelected || additive) onSelect(note.id, additive); }} onClick={event => { event.stopPropagation(); if (suppressNoteClick.current) { suppressNoteClick.current = false; return; } if (tool === 'erase') onRemove(note.id); else onSelect(note.id, event.ctrlKey || event.metaKey || event.shiftKey); }} className={`absolute z-10 touch-none overflow-visible rounded-md border text-left text-[9px] font-black text-[#07111d] transition-[filter,box-shadow] ${tool === 'select' || tool === 'draw' ? 'cursor-move active:cursor-grabbing' : ''}`} style={{ left: note.start * zoom, top: PITCH_HEADER_HEIGHT + (range.max - note.midi) * PITCH_ROW_HEIGHT + 2, width: Math.max(24, (note.end - note.start) * zoom - 2), height: PITCH_ROW_HEIGHT - 4, background: `linear-gradient(180deg,#ffffffaa 0,#ffffff20 42%,#00000018 100%),${COLOURS[part]}`, borderColor: isSelected ? '#fff' : `${COLOURS[part]}dd`, boxShadow: active ? `0 0 28px 6px ${COLOURS[part]}` : isSelected ? `0 0 0 2px #fff,0 0 22px ${COLOURS[part]}` : `0 4px 8px #000b,0 0 8px ${COLOURS[part]}55`, outline: active ? '2px solid white' : inRange ? '2px solid #f5d0fe' : 'none' }}><span className="flex h-full min-w-0 items-center gap-1 overflow-hidden px-1"><b className="shrink-0 rounded bg-black/65 px-1 py-px text-[8px] text-white">{midiNoteName(note.midi)}</b><em className="truncate not-italic">{note.lyric || 'Note'}</em>{isSelected && <small className="ml-auto shrink-0 rounded bg-white/80 px-1 font-mono text-[8px] text-[#11152a]">{beatLabel}</small>}</span>{tool !== 'erase' && <span aria-label="Drag to resize note" onPointerDown={event => beginResize(event, note)} onPointerMove={resize} onPointerUp={finishResize} onPointerCancel={finishResize} className="absolute -right-1 top-0 h-full w-2 cursor-ew-resize rounded-r bg-white/85 opacity-0 transition-opacity hover:opacity-100 focus:opacity-100" />}</button>; })}
    </div>
  </div>;
}
function Automation({ notes }: { notes: SongNote[] }) { const points = notes.slice(0, 18).map((note, index) => `${index * 55},${20 + (84 - note.midi) * .7}`).join(' '); return <div className="mt-3 rounded-xl border border-white/10 bg-[#060918] p-3"><p className="text-xs text-slate-400">♬ Dynamics <span className="ml-4 text-fuchsia-300">mf</span></p><svg className="mt-2 h-10 w-full" viewBox="0 0 1000 65" preserveAspectRatio="none"><polyline fill="none" stroke="#ff60bc" strokeWidth="2" points={points} /></svg><p className="text-xs text-slate-400">⌁ Breath <span className="ml-4 text-cyan-300">60%</span></p><svg className="mt-1 h-8 w-full" viewBox="0 0 1000 65" preserveAspectRatio="none"><polyline fill="none" stroke="#4ca0ff" strokeWidth="2" points={points} /></svg></div>; }
function playPianoTone(context: AudioContext, note: SongNote, startAt: number, length: number) {
  const frequency = 440 * Math.pow(2, (note.midi - 69) / 12);
  const master = context.createGain();
  const filter = context.createBiquadFilter();
  const velocity = Math.max(.025, Math.min(.12, note.velocity / 1150));
  const releaseAt = startAt + Math.max(.32, length + .28);
  filter.type = 'lowpass';
  filter.frequency.value = Math.min(7200, Math.max(1800, frequency * 8));
  filter.Q.value = .7;
  master.gain.setValueAtTime(.0001, startAt);
  master.gain.exponentialRampToValueAtTime(velocity, startAt + .009);
  master.gain.exponentialRampToValueAtTime(velocity * .36, startAt + .11);
  master.gain.exponentialRampToValueAtTime(.0001, releaseAt);
  master.connect(filter).connect(context.destination);
  [[1, 'triangle', 1], [2, 'sine', .26], [3, 'sine', .12], [4.2, 'sine', .05]].forEach(([ratio, wave, level]) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = wave as OscillatorType;
    oscillator.frequency.value = frequency * Number(ratio);
    gain.gain.value = Number(level);
    oscillator.connect(gain).connect(master);
    oscillator.start(startAt);
    oscillator.stop(releaseAt + .03);
  });
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
    <label className="mt-4 block text-[10px] tracking-[.12em] text-slate-500">VELOCITY <input type="range" min="0" max="127" value={selected.velocity} onChange={event => update(selected.id, { velocity: Number(event.target.value) })} className="mt-2 w-full accent-fuchsia-400" /></label>
    <div className="mt-5 grid grid-cols-2 gap-2"><button onClick={onDuplicate} className="rounded-lg border border-fuchsia-300/30 px-2 py-2 text-xs text-fuchsia-200">Duplicate</button><button onClick={onDelete} className="rounded-lg border border-rose-300/30 px-2 py-2 text-xs text-rose-200">Remove</button></div>
  </aside>;
}
function round(value: number) { return Math.round(value * 100) / 100; }
function roundPrecise(value: number) { return Math.round(value * 1000) / 1000; }
