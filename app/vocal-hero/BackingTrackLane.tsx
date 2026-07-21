'use client';

import type { BackingTrackSettings } from '@/lib/vocal-hero/types';

export function BackingTrackLane({ url, fileName, width, zoom, playhead, settings }: { url: string; fileName: string; width: number; zoom: number; playhead: number | null; settings: BackingTrackSettings }) {
  const trimEnd = settings.trim_end ?? (width / zoom);
  return <div className="flex h-20 border-b border-cyan-300/20 bg-[#061421]">
    <div className="sticky left-0 z-10 flex w-[74px] shrink-0 flex-col justify-center border-r border-cyan-300/20 bg-[#081522] px-2"><b className="text-xs text-cyan-200">TRACK</b><span className="mt-1 truncate text-[9px] text-slate-500">{url ? fileName || 'Backing track' : 'Not loaded'}</span></div>
    <div className="relative overflow-hidden" style={{ width }}>
      {url ? <>
        <div className="absolute inset-y-3 rounded-md border border-cyan-300/30 bg-cyan-300/10" style={{ left: Math.max(0, settings.trim_start * zoom), width: Math.max(4, (trimEnd - settings.trim_start) * zoom), backgroundImage: 'repeating-linear-gradient(90deg,transparent 0,transparent 5px,rgba(103,232,249,.38) 6px,rgba(103,232,249,.38) 8px,transparent 9px,transparent 13px)' }} />
        {settings.skip_regions.map((region, index) => <span key={`${region.start}-${region.end}-${index}`} title={`Skipped ${region.start.toFixed(1)}–${region.end.toFixed(1)}s`} className="absolute inset-y-3 z-[2] rounded bg-rose-500/30 ring-1 ring-inset ring-rose-300/50" style={{ left: region.start * zoom, width: Math.max(3, (region.end - region.start) * zoom) }} />)}
        {settings.split_markers.map((marker, index) => <span key={`${marker}-${index}`} className="absolute inset-y-2 z-[3] w-px bg-amber-300" style={{ left: marker * zoom }} />)}
        {settings.loop_enabled && settings.loop_end !== null && <span title="Loop region" className="absolute inset-y-1 z-[1] rounded border border-fuchsia-300/70 bg-fuchsia-400/10" style={{ left: settings.loop_start * zoom, width: Math.max(3, (settings.loop_end - settings.loop_start) * zoom) }} />}
        <span className="absolute left-3 top-1/2 z-[4] -translate-y-1/2 rounded bg-[#07101d]/85 px-2 py-1 text-[10px] text-cyan-100">Synchronized backing track · {settings.speed.toFixed(2)}× · offset {settings.timeline_offset >= 0 ? '+' : ''}{settings.timeline_offset.toFixed(2)}s</span>
      </> : <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">Upload audio or video to add the synchronized backing-track lane.</span>}
      {playhead !== null && <span className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white shadow-[0_0_12px_#67e8f9]" style={{ left: playhead * zoom }} />}
    </div>
  </div>;
}
