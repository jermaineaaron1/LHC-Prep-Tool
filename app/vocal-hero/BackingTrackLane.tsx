'use client';

import { useRef, useState } from 'react';
import type { BackingTrackClip, BackingTrackSettings } from '@/lib/vocal-hero/types';

type DragMode = 'move' | 'trim-left' | 'trim-right';
type DragState = { mode: DragMode; x: number; clip: BackingTrackClip };
type MenuState = { x: number; y: number; time: number; clipId: string | null };

export function BackingTrackLane({ url, fileName, width, zoom, playhead, settings, onClipsChange, onOpenSettings }: { url: string; fileName: string; width: number; zoom: number; playhead: number | null; settings: BackingTrackSettings; onClipsChange: (clips: BackingTrackClip[]) => void; onOpenSettings: () => void }) {
  const dragRef = useRef<DragState | null>(null);
  const clipboardRef = useRef<BackingTrackClip | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const mediaEnd = settings.trim_end ?? settings.media_duration ?? (width / zoom);
  const clips = settings.clips !== undefined ? settings.clips : url ? [{ id: 'legacy-base', source_start: settings.trim_start, source_end: Math.max(settings.trim_start + .1, mediaEnd), timeline_start: settings.timeline_offset }] : [];
  const ordered = [...clips].sort((a, b) => a.timeline_start - b.timeline_start);
  const clipEnd = (clip: BackingTrackClip) => clip.timeline_start + (clip.source_end - clip.source_start);
  const totalDuration = settings.media_duration ?? Math.max(0, ...clips.map(clip => clip.source_end));
  const activeClip = playhead === null ? null : ordered.find(clip => playhead >= clip.timeline_start && playhead < clipEnd(clip)) ?? null;
  const currentSourceTime = activeClip && playhead !== null ? activeClip.source_start + (playhead - activeClip.timeline_start) : null;
  const formatTime = (seconds: number | null) => seconds === null || !Number.isFinite(seconds) ? '--:--' : `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds)) % 60).padStart(2, '0')}`;
  const conflicts = (candidate: BackingTrackClip, all: BackingTrackClip[]) => all.some(clip => clip.id !== candidate.id && candidate.timeline_start < clipEnd(clip) - .01 && clipEnd(candidate) > clip.timeline_start + .01);
  const menuClip = menu?.clipId ? ordered.find(clip => clip.id === menu.clipId) ?? null : null;
  const menuClipIndex = menuClip ? ordered.findIndex(clip => clip.id === menuClip.id) : -1;
  const previousClip = menuClipIndex > 0 ? ordered[menuClipIndex - 1] : null;
  const nextClip = menuClipIndex >= 0 && menuClipIndex < ordered.length - 1 ? ordered[menuClipIndex + 1] : null;
  const freshId = () => `clip-${crypto.randomUUID()}`;

  function persist(next: BackingTrackClip[]) { onClipsChange([...next].sort((a, b) => a.timeline_start - b.timeline_start)); }
  function timeAt(clientX: number, node: HTMLElement) { const bounds = node.getBoundingClientRect(); return Math.max(0, (clientX - bounds.left) / zoom); }
  function clipAt(time: number) { return ordered.find(clip => time >= clip.timeline_start && time <= clipEnd(clip)) ?? null; }
  function beginDrag(event: React.PointerEvent<HTMLElement>, clip: BackingTrackClip, mode: DragMode) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); setMenu(null); setSelectedId(clip.id);
    dragRef.current = { mode, x: event.clientX, clip: { ...clip } };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function drag(event: React.PointerEvent<HTMLElement>) {
    const active = dragRef.current; if (!active) return;
    const delta = (event.clientX - active.x) / zoom;
    let candidate = { ...active.clip };
    if (active.mode === 'move') candidate.timeline_start = Math.max(0, Math.round((active.clip.timeline_start + delta) * 100) / 100);
    if (active.mode === 'trim-left') {
      const sourceStart = Math.max(0, Math.min(active.clip.source_end - .1, active.clip.source_start + delta));
      const applied = sourceStart - active.clip.source_start;
      candidate = { ...candidate, source_start: Math.round(sourceStart * 100) / 100, timeline_start: Math.max(0, Math.round((active.clip.timeline_start + applied) * 100) / 100) };
    }
    if (active.mode === 'trim-right') candidate.source_end = Math.round(Math.max(active.clip.source_start + .1, Math.min(settings.media_duration ?? Number.POSITIVE_INFINITY, active.clip.source_end + delta)) * 100) / 100;
    if (!conflicts(candidate, clips)) persist(clips.map(clip => clip.id === candidate.id ? candidate : clip));
  }
  function finishDrag(event: React.PointerEvent<HTMLElement>) { drag(event); dragRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  function splitClip(clip: BackingTrackClip, timelineTime: number) {
    if (timelineTime <= clip.timeline_start + .05 || timelineTime >= clipEnd(clip) - .05) return;
    const sourceSplit = clip.source_start + (timelineTime - clip.timeline_start);
    const left = { ...clip, id: freshId(), source_end: Math.round(sourceSplit * 100) / 100 };
    const right = { ...clip, id: freshId(), source_start: left.source_end, timeline_start: Math.round(timelineTime * 100) / 100 };
    persist(clips.flatMap(item => item.id === clip.id ? [left, right] : [item]));
    setSelectedId(right.id);
  }
  function canJoin(left: BackingTrackClip | null, right: BackingTrackClip | null) { return Boolean(left && right && Math.abs(clipEnd(left) - right.timeline_start) <= .03 && Math.abs(left.source_end - right.source_start) <= .03); }
  function joinClips(left: BackingTrackClip | null, right: BackingTrackClip | null) {
    if (!left || !right || !canJoin(left, right)) return;
    const joined = { ...left, source_end: right.source_end };
    persist(clips.filter(clip => clip.id !== left.id && clip.id !== right.id).concat(joined));
    setSelectedId(joined.id); setMenu(null);
  }
  function nextAvailable(start: number, length: number, existing: BackingTrackClip[]) {
    let candidate = Math.max(0, start);
    for (const clip of [...existing].sort((a, b) => a.timeline_start - b.timeline_start)) {
      if (candidate + length <= clip.timeline_start + .01) break;
      if (candidate < clipEnd(clip) && candidate + length > clip.timeline_start) candidate = clipEnd(clip);
    }
    return Math.round(candidate * 100) / 100;
  }
  function pasteAt(time: number) {
    const copied = clipboardRef.current; if (!copied) return;
    const length = copied.source_end - copied.source_start;
    const pasted = { ...copied, id: freshId(), timeline_start: nextAvailable(time, length, clips) };
    persist([...clips, pasted]); setSelectedId(pasted.id); setMenu(null);
  }
  function openMenu(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault(); const time = timeAt(event.clientX, event.currentTarget); const hit = clipAt(time);
    if (hit) setSelectedId(hit.id); setMenu({ x: event.clientX, y: event.clientY, time, clipId: hit?.id ?? null });
  }
  function handleDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    const time = timeAt(event.clientX, event.currentTarget); const hit = clipAt(time); if (hit) splitClip(hit, time);
  }

  return <div className="flex h-24 border-b border-cyan-300/20 bg-[#061421]">
    <div className="sticky left-0 z-10 flex w-[74px] shrink-0 flex-col justify-center border-r border-cyan-300/20 bg-[#081522] px-2"><b className="text-xs text-cyan-200">TRACK</b><span className="mt-1 truncate text-[9px] text-slate-500">{url ? fileName || 'Backing track' : 'Not loaded'}</span><span className="mt-1 font-mono text-[9px] text-cyan-200">{formatTime(url ? currentSourceTime ?? 0 : null)} / {formatTime(url ? totalDuration : null)}</span><span className="mt-1 text-[8px] text-cyan-400">Drag · trim · right-click</span></div>
    <div onContextMenu={openMenu} onDoubleClick={handleDoubleClick} onPointerDown={() => { setMenu(null); setSelectedId(null); }} className="relative overflow-hidden" style={{ width }}>
      {url ? <>
        {ordered.map((clip, index) => <div key={clip.id} onPointerDown={event => beginDrag(event, clip, 'move')} onPointerMove={drag} onPointerUp={finishDrag} onPointerCancel={finishDrag} className={`absolute inset-y-3 cursor-grab touch-none rounded-md border bg-cyan-300/10 active:cursor-grabbing ${selectedId === clip.id ? 'z-[4] border-white shadow-[0_0_16px_#67e8f966]' : 'z-[2] border-cyan-300/40'}`} style={{ left: clip.timeline_start * zoom, width: Math.max(12, (clip.source_end - clip.source_start) * zoom), backgroundImage: 'repeating-linear-gradient(90deg,transparent 0,transparent 5px,rgba(103,232,249,.38) 6px,rgba(103,232,249,.38) 8px,transparent 9px,transparent 13px)' }}>
          <button aria-label="Trim clip start" title="Drag right to skip the beginning" onPointerDown={event => beginDrag(event, clip, 'trim-left')} onPointerMove={drag} onPointerUp={finishDrag} onPointerCancel={finishDrag} className="absolute inset-y-0 left-0 z-10 w-3 cursor-ew-resize rounded-l bg-cyan-100/80 opacity-70 hover:opacity-100" />
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-[#07101d]/90 px-2 py-1 font-mono text-[9px] text-cyan-100">{index + 1} · {formatTime(activeClip?.id === clip.id ? currentSourceTime : clip.source_start)} / {formatTime(totalDuration)}</span>
          <button aria-label="Trim clip end" title="Drag left to trim the ending" onPointerDown={event => beginDrag(event, clip, 'trim-right')} onPointerMove={drag} onPointerUp={finishDrag} onPointerCancel={finishDrag} className="absolute inset-y-0 right-0 z-10 w-3 cursor-ew-resize rounded-r bg-cyan-100/80 opacity-70 hover:opacity-100" />
        </div>)}
        {settings.split_markers.map((marker, index) => <span key={`${marker}-${index}`} className="pointer-events-none absolute inset-y-2 z-[3] w-px bg-amber-300" style={{ left: marker * zoom }} />)}
        {!ordered.length && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">No clips. Right-click to paste a copied clip.</span>}
      </> : <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">Upload audio or video to add the synchronized backing-track lane.</span>}
      {playhead !== null && <span className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white shadow-[0_0_12px_#67e8f9]" style={{ left: playhead * zoom }} />}
      {menu && <div onPointerDown={event => event.stopPropagation()} className="fixed z-50 w-48 overflow-hidden rounded-lg border border-cyan-300/30 bg-[#08111f] py-1 text-[11px] text-slate-100 shadow-2xl" style={{ left: Math.min(menu.x, window.innerWidth - 205), top: Math.min(menu.y, window.innerHeight - 330) }}>
        {menu.clipId && <><button onClick={() => { const clip = clips.find(item => item.id === menu.clipId); if (clip) splitClip(clip, menu.time); setMenu(null); }} className="block w-full px-3 py-2 text-left hover:bg-white/10">Split here</button><button disabled={!canJoin(previousClip, menuClip)} onClick={() => joinClips(previousClip, menuClip)} className="block w-full px-3 py-2 text-left hover:bg-white/10 disabled:opacity-35">Join with previous</button><button disabled={!canJoin(menuClip, nextClip)} onClick={() => joinClips(menuClip, nextClip)} className="block w-full px-3 py-2 text-left hover:bg-white/10 disabled:opacity-35">Join with next</button><button onClick={() => { const clip = clips.find(item => item.id === menu.clipId); if (clip) clipboardRef.current = { ...clip }; setMenu(null); }} className="block w-full px-3 py-2 text-left hover:bg-white/10">Copy clip</button><button onClick={() => { const clip = clips.find(item => item.id === menu.clipId); if (clip) { clipboardRef.current = { ...clip }; pasteAt(clipEnd(clip)); } }} className="block w-full px-3 py-2 text-left hover:bg-white/10">Duplicate clip</button><button onClick={() => { persist(clips.filter(item => item.id !== menu.clipId)); setSelectedId(null); setMenu(null); }} className="block w-full px-3 py-2 text-left text-rose-200 hover:bg-rose-400/10">Delete clip</button></>}
        <button disabled={!clipboardRef.current} onClick={() => pasteAt(menu.time)} className="block w-full px-3 py-2 text-left hover:bg-white/10 disabled:opacity-40">Paste at {menu.time.toFixed(2)}s</button>
        <button onClick={() => { setMenu(null); onOpenSettings(); }} className="block w-full border-t border-white/10 px-3 py-2 text-left text-cyan-200 hover:bg-white/10">Track settings…</button>
      </div>}
    </div>
  </div>;
}
