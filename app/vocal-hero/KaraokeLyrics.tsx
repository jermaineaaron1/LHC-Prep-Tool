'use client';

import type { Song, SongNote } from '@/lib/vocal-hero/types';
import { karaokeCue } from '@/lib/vocal-hero/liveCues';

export function KaraokeLyrics({ song, notes, partIndex, elapsed, compact = false }: { song: Song; notes: SongNote[]; partIndex: number; elapsed: number; compact?: boolean }) {
  const cue = karaokeCue(song, notes, partIndex, elapsed);
  const maxLines = song.backing_track_settings?.karaoke_lyrics?.max_lines ?? 2;
  const clip = `inset(0 ${Math.max(0, 100 - cue.progress * 100)}% 0 0)`;
  return <section className={`rounded-2xl border border-cyan-300/20 bg-[linear-gradient(135deg,#081326,#120d29)] text-center shadow-[0_16px_50px_#02061788] ${compact ? 'p-4' : 'p-5 sm:p-6'}`} aria-label="Karaoke lyrics">
    <p className="text-[10px] font-black uppercase tracking-[.22em] text-cyan-300">{cue.waiting ? 'Coming up' : 'Sing now'}</p>
    <div className={`relative mx-auto mt-2 flex max-w-5xl items-center justify-center ${compact ? 'min-h-16' : maxLines === 1 ? 'min-h-20' : 'min-h-24'}`}>
      <p className={`${compact ? 'text-2xl' : maxLines === 1 ? 'text-2xl sm:text-4xl' : 'text-3xl sm:text-5xl'} max-w-full font-black leading-tight text-slate-200 ${maxLines === 1 ? 'whitespace-nowrap' : ''}`}>{cue.text}</p>
      <p aria-hidden className={`pointer-events-none absolute inset-0 flex items-center justify-center ${compact ? 'text-2xl' : maxLines === 1 ? 'text-2xl sm:text-4xl' : 'text-3xl sm:text-5xl'} max-w-full font-black leading-tight text-[#38bdf8] [text-shadow:0_0_18px_#0ea5e988] ${maxLines === 1 ? 'whitespace-nowrap' : ''}`} style={{ clipPath: clip }}>{cue.text}</p>
    </div>
    <div className="mx-auto mt-3 h-1.5 max-w-4xl overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-[width] duration-75" style={{ width: `${cue.progress * 100}%` }} /></div>
    {!compact && <p className="mt-2 min-h-5 text-sm text-slate-500">{cue.nextText ? `Next: ${cue.nextText}` : 'Follow the target note as it reaches the gold strike line'}</p>}
  </section>;
}
