'use client';

import { useEffect, useRef, useState } from 'react';
import type { BackingTrackSettings } from '@/lib/vocal-hero/types';

export function BackingTrackPanel({ url, kind, fileName, settings, setSettings, uploading, onUpload }: { url: string; kind: 'audio' | 'video'; fileName: string; settings: BackingTrackSettings; setSettings: React.Dispatch<React.SetStateAction<BackingTrackSettings>>; uploading: boolean; onUpload: () => void }) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const graphRef = useRef<{ context: AudioContext; source: MediaElementAudioSourceNode; filter: BiquadFilterNode; gain: GainNode } | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sectionStart, setSectionStart] = useState(0);
  const [sectionEnd, setSectionEnd] = useState(4);
  const update = (values: Partial<BackingTrackSettings>) => setSettings(current => ({ ...current, ...values }));
  const field = (label: string, value: number, setter: (value: number) => void) => <label className="text-[10px] text-slate-400">{label}<input type="number" min="0" step="0.1" value={Number.isFinite(value) ? value : 0} onChange={event => setter(Number(event.target.value))} className="mt-1 w-full rounded-md border border-white/10 bg-[#050816] px-2 py-1.5 text-xs text-white" /></label>;

  useEffect(() => () => { const graph = graphRef.current; if (graph) { graph.source.disconnect(); void graph.context.close(); graphRef.current = null; } }, [url]);
  useEffect(() => {
    const graph = graphRef.current;
    if (graph) {
      graph.gain.gain.value = settings.volume;
      graph.filter.type = settings.effect === 'warm' ? 'lowpass' : 'highshelf';
      graph.filter.frequency.value = settings.effect === 'warm' ? 2400 : 2600;
      graph.filter.gain.value = settings.effect === 'bright' ? 8 : 0;
    }
    if (mediaRef.current) mediaRef.current.playbackRate = settings.speed;
  }, [settings.volume, settings.speed, settings.effect]);

  function configureGraph() {
    const media = mediaRef.current;
    if (!media) return;
    if (!graphRef.current) {
      const context = new AudioContext();
      const source = context.createMediaElementSource(media);
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.connect(filter).connect(gain).connect(context.destination);
      graphRef.current = { context, source, filter, gain };
    }
    const graph = graphRef.current;
    graph.gain.gain.value = settings.volume;
    graph.filter.type = settings.effect === 'warm' ? 'lowpass' : 'highshelf';
    graph.filter.frequency.value = settings.effect === 'warm' ? 2400 : 2600;
    graph.filter.gain.value = settings.effect === 'bright' ? 8 : 0;
    void graph.context.resume();
  }
  function enforceArrangement() {
    const media = mediaRef.current;
    if (!media) return;
    const now = media.currentTime;
    const skip = settings.skip_regions.find(region => now >= region.start && now < region.end);
    if (skip) { media.currentTime = skip.end; return; }
    if (settings.loop_enabled && settings.loop_end !== null && now >= settings.loop_end) { media.currentTime = settings.loop_start; return; }
    if (settings.trim_end !== null && now >= settings.trim_end) { media.pause(); media.currentTime = settings.trim_start; }
  }
  function togglePlayback() {
    const media = mediaRef.current;
    if (!media) return;
    configureGraph();
    if (media.paused) {
      if (media.currentTime < settings.trim_start || (settings.trim_end !== null && media.currentTime >= settings.trim_end)) media.currentTime = settings.trim_start;
      media.playbackRate = settings.speed;
      void media.play();
    } else media.pause();
  }
  function range() { return { start: Math.max(0, Math.min(sectionStart, sectionEnd - .05)), end: Math.max(sectionStart + .05, sectionEnd) }; }
  function splitAtPlayhead() { update({ split_markers: [...settings.split_markers, position].sort((a, b) => a - b) }); }
  function addSkip() { update({ skip_regions: [...settings.skip_regions, range()].sort((a, b) => a.start - b.start) }); }
  function loopSection() { const selected = range(); update({ loop_start: selected.start, loop_end: selected.end, loop_enabled: true }); }

  return <div className="mt-3 rounded-xl border border-cyan-300/20 bg-black/20 p-3">
    <div className="flex flex-wrap items-center gap-3"><button onClick={onUpload} disabled={uploading} className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 font-semibold text-cyan-100 disabled:opacity-50">{uploading ? 'Uploading…' : url ? 'Replace audio / video' : 'Upload audio / video'}</button><span className="text-slate-400">{url ? `${fileName || 'Shared backing track'} · ${kind}` : 'No backing track uploaded yet'}</span>{url && <><button onClick={togglePlayback} className="rounded-lg border border-white/10 px-3 py-2">{playing ? 'Pause' : 'Preview'}</button><span className="font-mono text-cyan-200">{position.toFixed(1)} / {duration.toFixed(1)}s</span></>}</div>
    {url && <><div className="mt-3 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(460px,2fr)]"><div className="overflow-hidden rounded-lg border border-white/10 bg-black">{kind === 'video' ? <video ref={node => { mediaRef.current = node; }} src={url} controls className="max-h-48 w-full" onLoadedMetadata={event => { setDuration(event.currentTarget.duration); setSectionEnd(event.currentTarget.duration); }} onTimeUpdate={event => { setPosition(event.currentTarget.currentTime); enforceArrangement(); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} /> : <div className="grid h-32 place-items-center bg-[radial-gradient(circle,#11446d,#050816_65%)] text-cyan-100"><span>♫ Audio backing track</span><audio ref={node => { mediaRef.current = node; }} src={url} onLoadedMetadata={event => { setDuration(event.currentTarget.duration); setSectionEnd(event.currentTarget.duration); }} onTimeUpdate={event => { setPosition(event.currentTarget.currentTime); enforceArrangement(); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} /></div>}</div><div className="grid gap-3 sm:grid-cols-3"><label className="text-[10px] text-slate-400">Volume <b className="ml-1 text-cyan-200">{Math.round(settings.volume * 100)}%</b><input type="range" min="0" max="1.4" step="0.01" value={settings.volume} onChange={event => update({ volume: Number(event.target.value) })} className="mt-2 w-full accent-cyan-300" /></label><label className="text-[10px] text-slate-400">Speed <b className="ml-1 text-cyan-200">{settings.speed.toFixed(2)}×</b><input type="range" min="0.5" max="1.5" step="0.01" value={settings.speed} onChange={event => { const speed = Number(event.target.value); update({ speed }); if (mediaRef.current) mediaRef.current.playbackRate = speed; }} className="mt-2 w-full accent-fuchsia-400" /></label><label className="text-[10px] text-slate-400">Sound effect<select value={settings.effect} onChange={event => { const effect = event.target.value as BackingTrackSettings['effect']; update({ effect }); configureGraph(); }} className="mt-1 w-full rounded-md border border-white/10 bg-[#050816] px-2 py-1.5 text-xs text-white"><option value="none">Clean</option><option value="warm">Warm low-pass</option><option value="bright">Bright lift</option></select></label></div></div>
    <div className="mt-3 grid gap-3 rounded-lg border border-white/[.08] bg-[#070a18] p-3 lg:grid-cols-[1fr_1fr_1fr_auto]"><div className="grid grid-cols-2 gap-2">{field('Trim start', settings.trim_start, value => update({ trim_start: value }))}{field('Trim end', settings.trim_end ?? duration, value => update({ trim_end: value }))}</div><div className="grid grid-cols-2 gap-2">{field('Section start', sectionStart, setSectionStart)}{field('Section end', sectionEnd, setSectionEnd)}</div><div className="flex flex-wrap items-end gap-2"><button onClick={splitAtPlayhead} className="rounded-md border border-white/10 px-2 py-1.5">Split at playhead</button><button onClick={addSkip} className="rounded-md border border-amber-300/30 px-2 py-1.5 text-amber-100">Skip section</button><button onClick={loopSection} className="rounded-md border border-fuchsia-300/30 px-2 py-1.5 text-fuchsia-100">Loop section</button></div><label className="flex items-end gap-2 text-[11px] text-slate-300"><input type="checkbox" checked={settings.loop_enabled} onChange={event => update({ loop_enabled: event.target.checked })} /> Repeat loop</label></div>
    <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-400"><span>Splits: {settings.split_markers.length ? settings.split_markers.map(marker => `${marker.toFixed(1)}s`).join(', ') : 'none'}</span><span>·</span><span>Skipped: {settings.skip_regions.length ? settings.skip_regions.map(region => `${region.start.toFixed(1)}–${region.end.toFixed(1)}s`).join(', ') : 'none'}</span>{settings.skip_regions.length > 0 && <button onClick={() => update({ skip_regions: [] })} className="text-rose-200">Clear skips</button>}</div></>}
  </div>;
}
