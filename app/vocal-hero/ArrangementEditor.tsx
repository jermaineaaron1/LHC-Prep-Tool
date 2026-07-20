'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Song, SongNote } from '@/lib/vocal-hero/types';
import { playableNotes } from '@/lib/vocal-hero/songData';

const VOICES = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#ff60bc', '#ffae42', '#4ca0ff', '#43e2bb'];
const MIN_MIDI = 42;
const MAX_MIDI = 84;
type EditableSong = Pick<Song, 'id' | 'title' | 'notes'>;
type EditorTool = 'select' | 'draw' | 'erase';
type PlaybackScope = 'all' | 'range' | 'note';
type ArrangementSnapshot = { title: string; notes: SongNote[]; selectedId: string | null; selectedIds: string[]; selectedPart: number; playScope: PlaybackScope; playParts: boolean[]; playRange: { start: number; end: number } };

export function ArrangementEditor({ song, onClose, onSave }: { song: Song; onClose: () => void; onSave: (values: EditableSong) => Promise<void>; }) {
  const [title, setTitle] = useState(song.title);
  const [notes, setNotes] = useState<SongNote[]>(() => playableNotes(song));
  const [selectedId, setSelectedId] = useState<string | null>(() => playableNotes(song)[0]?.id ?? null);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => playableNotes(song)[0]?.id ? [playableNotes(song)[0].id] : []);
  const [selectedPart, setSelectedPart] = useState(0);
  // A 36px/second starting scale keeps individual lyric targets readable; 160px/second
  // gives arrangers up to ten times the former default width for detailed editing.
  const [zoom, setZoom] = useState(36);
  const [saving, setSaving] = useState(false);
  const [tool, setTool] = useState<EditorTool>('select');
  const [playScope, setPlayScope] = useState<PlaybackScope>('all');
  const [playParts, setPlayParts] = useState([true, true, true, true]);
  const [playRange, setPlayRange] = useState({ start: 0, end: 8 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ past: ArrangementSnapshot[]; future: ArrangementSnapshot[] }>({ past: [], future: [] });
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const playbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const selected = notes.find(note => note.id === selectedId) ?? null;
  const duration = Math.max(32, song.duration || 0, ...notes.map(note => note.end + 4));
  const timelineWidth = Math.min(Math.max(duration * zoom, 1600), 48000);
  const visibleBars = Math.min(32, Math.ceil(duration / 2));
  const noteByPart = useMemo(() => VOICES.map((_, index) => notes.filter(note => note.part === index || (note.part === -1 && index === selectedPart))), [notes, selectedPart]);

  useEffect(() => () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current);
    recorderRef.current?.stream.getTracks().forEach(track => track.stop());
    void audioContextRef.current?.close();
  }, []);

  function makeSnapshot(): ArrangementSnapshot { return { title, notes: notes.map(note => ({ ...note })), selectedId, selectedIds: [...selectedIds], selectedPart, playScope, playParts: [...playParts], playRange: { ...playRange } }; }
  function pushHistory() { const snapshot = makeSnapshot(); setHistory(current => ({ past: [...current.past, snapshot].slice(-100), future: [] })); }
  function restoreSnapshot(snapshot: ArrangementSnapshot) { setTitle(snapshot.title); setNotes(snapshot.notes.map(note => ({ ...note }))); setSelectedId(snapshot.selectedId); setSelectedIds([...snapshot.selectedIds]); setSelectedPart(snapshot.selectedPart); setPlayScope(snapshot.playScope); setPlayParts([...snapshot.playParts]); setPlayRange({ ...snapshot.playRange }); }
  function undo() { const previous = history.past.at(-1); if (!previous) return; const current = makeSnapshot(); restoreSnapshot(previous); setHistory({ past: history.past.slice(0, -1), future: [current, ...history.future] }); }
  function redo() { const next = history.future[0]; if (!next) return; const current = makeSnapshot(); restoreSnapshot(next); setHistory({ past: [...history.past, current].slice(-100), future: history.future.slice(1) }); }
  function update(id: string, values: Partial<SongNote>) { pushHistory(); setNotes(current => current.map(note => note.id === id ? { ...note, ...values } : note)); }
  function selectNote(id: string, additive = false) { const note = notes.find(item => item.id === id); if (!note) return; setSelectedPart(note.part < 0 ? 0 : note.part); setSelectedId(id); setSelectedIds(current => additive ? (current.includes(id) ? current.filter(item => item !== id) : [...current, id]) : [id]); setPlayScope('note'); }
  function addNote(part = selectedPart, start = notes.reduce((latest, note) => Math.max(latest, note.end), 0), midi = 60) { pushHistory(); const id = `note-${crypto.randomUUID()}`; setNotes(current => [...current, { id, part, midi, start: round(start), end: round(start + 1), lyric: 'New lyric', velocity: 100 }]); setSelectedPart(part); setSelectedId(id); setSelectedIds([id]); }
  function addAt(part: number, event: React.MouseEvent<HTMLDivElement>) { const bounds = event.currentTarget.getBoundingClientRect(); const start = Math.max(0, (event.clientX - bounds.left) / zoom); const midi = Math.max(MIN_MIDI, Math.min(MAX_MIDI, Math.round(MAX_MIDI - ((event.clientY - bounds.top) / bounds.height) * (MAX_MIDI - MIN_MIDI)))); addNote(part, start, midi); }
  function duplicateSelected() { if (!selected) return; pushHistory(); const id = `note-${crypto.randomUUID()}`; const copy = { ...selected, id, start: round(selected.end + .1), end: round(selected.end + .1 + (selected.end - selected.start)) }; setNotes(current => [...current, copy]); setSelectedId(id); setSelectedIds([id]); setTool('select'); }
  function removeNote(id: string) { pushHistory(); setNotes(current => current.filter(note => note.id !== id)); setSelectedId(current => current === id ? null : current); setSelectedIds(current => current.filter(item => item !== id)); }
  function removeSelected() { if (!selectedIds.length) return; pushHistory(); setNotes(current => current.filter(note => !selectedIds.includes(note.id))); setSelectedId(null); setSelectedIds([]); }
  function beginResizeHistory() { pushHistory(); }
  function resizeNote(id: string, end: number) {
    setNotes(current => {
      const target = current.find(note => note.id === id);
      if (!target) return current;
      const nextEnd = Math.max(round(target.start + .1), round(end));
      const delta = round(nextEnd - target.end);
      if (!delta) return current;
      // Ripple all later targets together so SATB harmony and lyric timing stay aligned.
      return current.map(note => {
        if (note.id === id) return { ...note, end: nextEnd };
        if (note.start >= target.end - .001) return { ...note, start: Math.max(0, round(note.start + delta)), end: Math.max(.1, round(note.end + delta)) };
        return note;
      });
    });
  }
  function clearPlaybackSelections() { setPlayScope('all'); setPlayParts([true, true, true, true]); setPlayRange({ start: 0, end: 8 }); setSelectedId(null); setSelectedIds([]); }
  function selectPlayPart(part: number, additive = false) { setPlayParts(current => additive ? current.map((enabled, index) => index === part ? !enabled : enabled) : VOICES.map((_, index) => index === part)); setPlayScope('all'); setSelectedId(null); setSelectedIds([]); }
  function updateRangeSelection(range: { start: number; end: number }) { setPlayRange(range); const ids = notes.filter(note => note.end >= range.start && note.start <= range.end).map(note => note.id); setSelectedIds(ids); setSelectedId(ids[0] ?? null); }
  function selectRange() { setPlayScope('range'); setPlayParts([true, true, true, true]); setSelectedId(null); }
  function stopPlayback() { if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current); if (playbackTimerRef.current) clearTimeout(playbackTimerRef.current); animationFrameRef.current = null; playbackTimerRef.current = null; void audioContextRef.current?.close(); audioContextRef.current = null; setPlayhead(null); setIsPlaying(false); }
  function previewArrangement() {
    if (isPlaying) { stopPlayback(); return; }
    const enabled = notes.filter(note => note.part < 0 || playParts[note.part]);
    const scoped = playScope === 'note' ? enabled.filter(note => selectedIds.includes(note.id)) : playScope === 'range' ? enabled.filter(note => note.end >= playRange.start && note.start <= playRange.end) : enabled;
    const ordered = [...scoped].sort((a, b) => a.start - b.start);
    if (!ordered.length) return;
    const first = playScope === 'range' ? playRange.start : ordered[0].start;
    const finalTime = playScope === 'range' ? playRange.end : Math.min(first + 20, Math.max(...ordered.map(note => note.end)));
    const preview = ordered.filter(note => note.start <= finalTime && note.end >= first);
    const last = Math.max(.1, finalTime - first);
    const context = new AudioContext();
    audioContextRef.current = context;
    void context.resume();
    preview.forEach(note => {
      const audibleStart = Math.max(note.start, first);
      const at = audibleStart - first;
      const length = Math.max(.07, Math.min(note.end, finalTime) - audibleStart);
      playPianoTone(context, note, context.currentTime + at, length);
    });
    const startedAt = performance.now();
    const tick = () => { setPlayhead(first + ((performance.now() - startedAt) / 1000)); animationFrameRef.current = requestAnimationFrame(tick); };
    setIsPlaying(true); tick();
    playbackTimerRef.current = setTimeout(stopPlayback, last * 1000 + 550);
  }
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
  async function save() { setSaving(true); try { await onSave({ id: song.id, title: title.trim() || song.title, notes: [...notes].sort((a, b) => a.start - b.start).map(note => ({ ...note, start: Math.max(0, round(note.start)), end: Math.max(round(note.start) + .1, round(note.end)) })) }); } finally { setSaving(false); } }

  return <div className="fixed inset-0 z-50 overflow-hidden bg-[#020510] text-slate-100">
    <header className="flex h-16 items-center gap-5 border-b border-white/10 bg-[#070a1b] px-5"><Brand /><nav className="hidden gap-5 text-xs text-slate-400 md:flex"><span>⌂ Home</span><span>♫ Library</span><b className="text-fuchsia-300">♫ Song Editor</b><span>♜ Leaderboards</span><span>♧ Rooms</span></nav><div className="ml-auto flex items-center gap-2"><span className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold text-emerald-300">● LIVE</span><span className="hidden rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400 sm:block">Room Code <b className="ml-1 text-[#ffd15c]">ZHY32</b></span><button onClick={onClose} className="rounded-lg border border-white/15 px-3 py-2 text-xs">Close</button></div></header>
    <div className="flex h-[calc(100vh-64px)] min-h-[620px] overflow-hidden">
      <aside className="hidden w-56 shrink-0 border-r border-white/10 bg-[#070b1e] p-3 lg:block"><p className="text-sm font-semibold">Song Editor</p><div className="mt-1 flex items-center gap-2"><input value={title} onChange={event => setTitle(event.target.value)} className="w-full border-0 bg-transparent text-xs text-slate-300 outline-none" /><span className="text-fuchsia-300">✎</span></div><div className="mt-4 space-y-2">{VOICES.map((voice, index) => <VoiceStrip key={voice} name={voice} index={index} active={selectedPart === index} onClick={() => setSelectedPart(index)} />)}</div><button onClick={() => addNote()} className="mt-3 w-full rounded-lg border border-dashed border-fuchsia-400/40 px-3 py-2 text-xs text-fuchsia-300">＋ Add Voice Target</button><div className="mt-6 border-t border-white/10 pt-4"><p className="text-[10px] tracking-[.16em] text-slate-500">PART MIXER</p><div className="mt-3 grid grid-cols-4 gap-2">{VOICES.map((voice, index) => <div key={voice} className="rounded-lg bg-white/[.04] p-2 text-center"><b style={{ color: COLOURS[index] }}>{voice[0]}</b><div className="mx-auto mt-2 h-14 w-1 rounded-full bg-white/10"><span className="block w-full rounded-full" style={{ height: `${60 + index * 8}%`, background: COLOURS[index], transform: 'translateY(40%)' }} /></div><span className="mt-2 block text-[9px] text-slate-400">M</span></div>)}</div></div></aside>
      <main className="min-w-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_50%_0%,#28135055,transparent_30%),#080b1c]">
        <EditorToolbar tool={tool} setTool={setTool} playScope={playScope} playParts={playParts} onPlayAll={clearPlaybackSelections} onPlayPart={selectPlayPart} playRange={playRange} playhead={playhead} onClearSelection={clearPlaybackSelections} selectedCount={selectedIds.length} onRemove={removeSelected} canUndo={history.past.length > 0} canRedo={history.future.length > 0} onUndo={undo} onRedo={redo} zoom={zoom} setZoom={setZoom} onDuplicate={duplicateSelected} onPlay={previewArrangement} isPlaying={isPlaying} onRecord={() => void toggleRecording()} recording={recording} onPlayTake={playRecordedTake} hasTake={Boolean(recordingUrl)} onSave={() => void save()} saving={saving} />
        {recordError && <div className="border-b border-rose-300/20 bg-rose-400/10 px-4 py-2 text-xs text-rose-200">Microphone: {recordError}</div>}
        <div className="flex h-[calc(100%-110px)] min-h-0"><section className="min-w-0 flex-1 overflow-auto p-3"><div className="mb-3 flex flex-wrap gap-2 text-xs"><Chip label="BPM 120" /><Chip label="Key C Major" /><Chip label="Time 4 / 4" /><span className="ml-auto rounded-lg border border-white/10 px-3 py-2 text-slate-400">Bar / Beat <b className="ml-1 text-white">17.2.3</b></span></div><p className="mb-2 text-[11px] text-slate-500">Drag a note&apos;s right-edge handle to change its length. Shift-click notes for a multi-selection, or drag an empty lane to select all notes in a time range.</p><div className="overflow-x-auto rounded-xl border border-[#7650d8]/30 bg-[#050716]"><div style={{ width: timelineWidth + 74 }}><div className="sticky left-0 z-20 flex h-9 border-b border-white/10 bg-[#0b0d22]"><div className="w-[74px] shrink-0 border-r border-white/10" />{Array.from({ length: visibleBars }, (_, index) => <span key={index} className="border-r border-white/[.07] px-2 pt-2 text-[10px] text-slate-500" style={{ width: zoom * 2 }}>{index * 2 + 1}</span>)}</div>{VOICES.map((voice, index) => <PianoTrack key={voice} name={voice} part={index} notes={noteByPart[index]} selectedId={selectedId} selectedIds={selectedIds} tool={tool} playhead={playhead} selectedRange={playScope === 'range' ? playRange : null} width={timelineWidth} zoom={zoom} onAdd={addAt} onSelect={selectNote} onRemove={removeNote} onResizeStart={beginResizeHistory} onResize={resizeNote} onRangeChange={updateRangeSelection} onRangeEnd={selectRange} onEmptyClick={clearPlaybackSelections} />)}</div></div><Automation notes={notes} /></section><Inspector selected={selected} update={update} onDelete={removeSelected} onDuplicate={duplicateSelected} /></div>
      </main>
    </div>
  </div>;
}

function Brand() { return <b className="text-xl">VOCAL<span className="text-fuchsia-400">Hero</span></b>; }
function Chip({ label }: { label: string }) { return <span className="rounded-lg border border-white/10 bg-white/[.035] px-3 py-2 text-slate-400">{label}</span>; }
function VoiceStrip({ name, index, active, onClick }: { name: string; index: number; active: boolean; onClick: () => void }) { return <button onClick={onClick} className="w-full rounded-xl border p-3 text-left" style={{ borderColor: active ? COLOURS[index] : `${COLOURS[index]}55`, background: active ? `${COLOURS[index]}19` : `${COLOURS[index]}08` }}><div className="flex items-center gap-2"><b className="text-2xl" style={{ color: COLOURS[index] }}>{name[0]}</b><span><b className="block text-xs" style={{ color: COLOURS[index] }}>{name.toUpperCase()}</b><span className="text-[10px] text-slate-500">⌁ mic · active</span></span></div><div className="mt-3 h-1 rounded-full bg-white/10"><span className="block h-full w-2/3 rounded-full" style={{ background: COLOURS[index] }} /></div></button>; }
function EditorToolbar({ tool, setTool, playScope, playParts, onPlayAll, onPlayPart, playRange, playhead, onClearSelection, selectedCount, onRemove, canUndo, canRedo, onUndo, onRedo, zoom, setZoom, onDuplicate, onPlay, isPlaying, onRecord, recording, onPlayTake, hasTake, onSave, saving }: { tool: EditorTool; setTool: (tool: EditorTool) => void; playScope: PlaybackScope; playParts: boolean[]; onPlayAll: () => void; onPlayPart: (part: number, additive?: boolean) => void; playRange: { start: number; end: number }; playhead: number | null; onClearSelection: () => void; selectedCount: number; onRemove: () => void; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; zoom: number; setZoom: (value: number) => void; onDuplicate: () => void; onPlay: () => void; isPlaying: boolean; onRecord: () => void; recording: boolean; onPlayTake: () => void; hasTake: boolean; onSave: () => void; saving: boolean }) {
  const toolButton = (value: EditorTool, label: string) => <button onClick={() => setTool(value)} className={`rounded-lg border px-3 py-2 ${tool === value ? 'border-fuchsia-400/60 bg-fuchsia-500/20 text-fuchsia-100' : 'border-white/10 text-slate-100'}`}>{label}</button>;
  const status = playScope === 'range' ? `Range ${playRange.start.toFixed(2)}s–${playRange.end.toFixed(2)}s` : playScope === 'note' ? `${selectedCount || 1} selected note${selectedCount === 1 ? '' : 's'}` : playParts.every(Boolean) ? 'All voices from start' : `${VOICES.filter((_, index) => playParts[index]).join(' + ')} from start`;
  return <div className="border-b border-white/10 bg-[#0a0c20] text-xs"><div className="flex h-14 items-center gap-2 overflow-x-auto px-3">{toolButton('select', 'Select')}{toolButton('draw', 'Draw')}{toolButton('erase', 'Erase')}<button onClick={onDuplicate} disabled={!selectedCount} className="rounded-lg border border-white/10 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40">Duplicate</button><button onClick={onRemove} disabled={!selectedCount} className="rounded-lg border border-rose-300/35 px-3 py-2 text-rose-200 disabled:cursor-not-allowed disabled:opacity-40">Remove{selectedCount > 1 ? ` (${selectedCount})` : ''}</button><span className="h-6 w-px bg-white/10" /><button onClick={onUndo} disabled={!canUndo} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40">Undo</button><button onClick={onRedo} disabled={!canRedo} className="rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40">Redo</button><span className="h-6 w-px bg-white/10" /><span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">Audition voices</span><button onClick={onPlayAll} className={`rounded-md border px-3 py-2 ${playParts.every(Boolean) && playScope === 'all' ? 'border-fuchsia-300/60 bg-fuchsia-500/15 text-fuchsia-100' : 'border-white/10 text-slate-300'}`}>All SATB</button>{VOICES.map((voice, index) => <button key={voice} title="Click for this voice only. Shift-click to add/remove a voice." onClick={event => onPlayPart(index, event.shiftKey)} className="rounded-md border px-3 py-2 font-bold" style={{ borderColor: playParts[index] ? COLOURS[index] : '#ffffff22', color: playParts[index] ? COLOURS[index] : '#64748b', background: playParts[index] ? `${COLOURS[index]}16` : 'transparent' }}>{voice}</button>)}<button onClick={onSave} disabled={saving} className="ml-auto rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 font-bold text-cyan-100">{saving ? 'Saving…' : 'Save'}</button></div><div className="flex h-14 items-center gap-3 overflow-x-auto border-t border-white/[.06] px-3"><span className="whitespace-nowrap text-slate-400">{status}</span>{playScope !== 'all' && <button onClick={onClearSelection} className="rounded-md border border-white/10 px-3 py-2 text-slate-200">Clear selection</button>}<button onClick={onPlay} className={`rounded-lg border px-4 py-2 font-semibold ${isPlaying ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-100' : 'border-fuchsia-300/40 bg-fuchsia-500/10 text-fuchsia-100'}`}>{isPlaying ? 'Stop' : 'Play from start'}</button>{isPlaying && <span className="whitespace-nowrap text-cyan-200">Now {playhead?.toFixed(2)}s</span>}<button onClick={onRecord} className={`rounded-lg border px-3 py-2 ${recording ? 'border-rose-300 bg-rose-500/20 text-rose-100' : 'border-white/10 text-rose-300'}`}>{recording ? 'Stop recording' : 'Record'}</button>{hasTake && <button onClick={onPlayTake} className="rounded-lg border border-emerald-300/30 px-3 py-2 text-emerald-200">Play take</button>}<label className="ml-auto flex shrink-0 items-center gap-2 text-slate-400">Zoom <b className="w-8 text-right text-fuchsia-200">{Math.round((zoom / 16) * 10) / 10}x</b><input aria-label="Timeline zoom" type="range" min="16" max="160" step="2" value={zoom} onChange={event => setZoom(Number(event.target.value))} className="accent-fuchsia-400" /></label></div></div>;
}
function PianoTrack({ name, part, notes, selectedId, selectedIds, tool, playhead, selectedRange, width, zoom, onAdd, onSelect, onRemove, onResizeStart, onResize, onRangeChange, onRangeEnd, onEmptyClick }: { name: string; part: number; notes: SongNote[]; selectedId: string | null; selectedIds: string[]; tool: EditorTool; playhead: number | null; selectedRange: { start: number; end: number } | null; width: number; zoom: number; onAdd: (part: number, event: React.MouseEvent<HTMLDivElement>) => void; onSelect: (id: string, additive?: boolean) => void; onRemove: (id: string) => void; onResizeStart: () => void; onResize: (id: string, end: number) => void; onRangeChange: (range: { start: number; end: number }) => void; onRangeEnd: () => void; onEmptyClick: () => void }) {
  const resizing = useRef<{ id: string; start: number; initialEnd: number; noteStart: number } | null>(null);
  const selecting = useRef<{ start: number } | null>(null);
  const timeAt = (event: React.PointerEvent<HTMLDivElement>) => Math.max(0, (event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom);
  function beginResize(event: React.PointerEvent<HTMLSpanElement>, note: SongNote) { event.stopPropagation(); onResizeStart(); resizing.current = { id: note.id, start: event.clientX, initialEnd: note.end, noteStart: note.start }; event.currentTarget.setPointerCapture(event.pointerId); }
  function resize(event: React.PointerEvent<HTMLSpanElement>) { const active = resizing.current; if (!active) return; onResize(active.id, Math.max(active.noteStart + .1, active.initialEnd + ((event.clientX - active.start) / zoom))); }
  function finishResize(event: React.PointerEvent<HTMLSpanElement>) { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); resizing.current = null; }
  function beginRange(event: React.PointerEvent<HTMLDivElement>) { if (tool !== 'select' || event.button !== 0) return; const start = timeAt(event); selecting.current = { start }; event.currentTarget.setPointerCapture(event.pointerId); onRangeChange({ start, end: start }); }
  function moveRange(event: React.PointerEvent<HTMLDivElement>) { const active = selecting.current; if (!active) return; const end = timeAt(event); onRangeChange({ start: Math.min(active.start, end), end: Math.max(active.start, end) }); }
  function endRange(event: React.PointerEvent<HTMLDivElement>) { const active = selecting.current; if (!active) return; const end = timeAt(event); if (Math.abs(end - active.start) >= .1) onRangeEnd(); else onEmptyClick(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); selecting.current = null; }
  return <div className="flex h-32 border-b border-white/10"><div className="sticky left-0 z-10 flex w-[74px] shrink-0 flex-col justify-center border-r border-white/10 bg-[#0a0c1c] px-2"><b style={{ color: COLOURS[part] }}>{name[0]} <span className="text-xs">{name}</span></b><span className="mt-1 text-[9px] text-slate-500">C6<br />A5<br />F4<br />C3</span></div><div onPointerDown={beginRange} onPointerMove={moveRange} onPointerUp={endRange} onClick={event => { if (tool === 'draw') onAdd(part, event); }} className={`relative ${tool === 'draw' ? 'cursor-crosshair' : tool === 'erase' ? 'cursor-not-allowed' : 'cursor-text'}`} style={{ width, backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent 15px, rgba(145,165,220,.12) 16px), repeating-linear-gradient(to right, transparent 0, transparent ${zoom - 1}px, rgba(145,165,220,.10) ${zoom}px)` }}>{selectedRange && <span className="pointer-events-none absolute inset-y-0 z-[1] bg-fuchsia-300/15 ring-1 ring-inset ring-fuchsia-200/60" style={{ left: selectedRange.start * zoom, width: Math.max(2, (selectedRange.end - selectedRange.start) * zoom) }} />}{playhead !== null && <span className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white shadow-[0_0_12px_#f4a5ff]" style={{ left: playhead * zoom }} />}{notes.filter(note => note.part === part || note.part === -1).map(note => { const active = playhead !== null && playhead >= note.start && playhead < note.end; const inRange = selectedRange && note.end >= selectedRange.start && note.start <= selectedRange.end; return <button key={note.id} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (tool === 'erase') onRemove(note.id); else onSelect(note.id, event.shiftKey); }} className="absolute z-10 overflow-visible rounded-md px-1 text-left text-[10px] font-bold text-[#07111d] shadow-[0_0_13px]" style={{ left: note.start * zoom, top: `${Math.max(3, Math.min(86, 92 - ((note.midi - MIN_MIDI) / (MAX_MIDI - MIN_MIDI)) * 84))}%`, width: Math.max(18, (note.end - note.start) * zoom - 2), height: 15, transform: 'translateY(-50%)', background: COLOURS[part], color: '#07111d', boxShadow: active ? `0 0 28px 6px ${COLOURS[part]}` : selectedId === note.id ? `0 0 20px ${COLOURS[part]}` : undefined, outline: active ? '2px solid white' : selectedId === note.id || inRange ? '2px solid #f5d0fe' : 'none' }}><span className="block overflow-hidden whitespace-nowrap">{note.lyric}</span>{tool !== 'erase' && <span aria-label="Drag to resize note" onPointerDown={event => beginResize(event, note)} onPointerMove={resize} onPointerUp={finishResize} onPointerCancel={finishResize} className="absolute -right-1 top-0 h-full w-2 cursor-ew-resize rounded-r bg-white/75 opacity-0 transition-opacity hover:opacity-100 focus:opacity-100" />}</button>; })}</div></div>;
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
function Inspector({ selected, update, onDelete, onDuplicate }: { selected: SongNote | null; update: (id: string, values: Partial<SongNote>) => void; onDelete: () => void; onDuplicate: () => void }) {
  if (!selected) return <aside className="hidden w-60 shrink-0 border-l border-white/10 bg-[#090b1e] p-4 xl:block"><p className="text-xs tracking-[.18em] text-slate-500">INSPECTOR</p><p className="mt-6 text-sm text-slate-400">Select a note to edit its properties.</p></aside>;
  const field = (label: string, value: string | number, setter: (value: string) => void, type = 'text') => <label className="mt-3 block text-[10px] tracking-[.12em] text-slate-500">{label}<input type={type} value={value} onChange={event => setter(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#050816] px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-400" /></label>;
  return <aside className="hidden w-60 shrink-0 overflow-y-auto border-l border-white/10 bg-[#090b1e] p-4 xl:block">
    <div className="border-b border-fuchsia-400 pb-3 text-xs font-bold text-fuchsia-300">INSPECTOR</div>
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
