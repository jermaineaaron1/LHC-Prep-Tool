'use client';

import type { Song, SongNote } from '@/lib/vocal-hero/types';
import { karaokeCue } from '@/lib/vocal-hero/liveCues';
import type { KaraokeSegment } from '@/lib/vocal-hero/liveCues';

const VOICES = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#ff60bc', '#a965ff', '#22d3ee', '#ffbd45'];

const SUNG = '#38bdf8';
const UNSUNG = '#cbd5e1';

/**
 * The line, lit fragment by fragment as it is sung.
 *
 * Each fragment carries its own fill rather than the whole line being clipped
 * from the left. A single clip is only correct while the line fits on one row:
 * as soon as it wraps — which is exactly what a sentence-long phrase does — a
 * horizontal clip lights the same fraction of every row at once, so half of the
 * second line glows while the singer is still on the first.
 */
function LyricLine({ segments, fallback, className, sung = SUNG, unsung = UNSUNG }: {
  segments: KaraokeSegment[];
  fallback: string;
  className: string;
  sung?: string;
  unsung?: string;
}) {
  if (!segments.length) return <p className={className} style={{ color: unsung }}>{fallback}</p>;
  return <p className={className}>
    {segments.map((segment, index) => <span key={index}>
      {index > 0 && !segment.joinsPrevious ? ' ' : ''}
      <span
        style={segment.fill >= 1
          ? { color: sung, textShadow: `0 0 18px ${sung}66` }
          : segment.fill <= 0
            ? { color: unsung }
            : {
              // Fills within the syllable itself, so the sweep still reads as
              // continuous without depending on where the line happens to wrap.
              backgroundImage: `linear-gradient(90deg, ${sung} ${segment.fill * 100}%, ${unsung} ${segment.fill * 100}%)`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
      >{segment.text}</span>
    </span>)}
  </p>;
}

export function KaraokeLyrics({ song, notes, partIndex, elapsed, compact = false }: { song: Song; notes: SongNote[]; partIndex: number; elapsed: number; compact?: boolean }) {
  const cue = karaokeCue(song, notes, partIndex, elapsed);
  const maxLines = song.backing_track_settings?.karaoke_lyrics?.max_lines ?? 2;
  const size = compact ? 'text-2xl' : maxLines === 1 ? 'text-2xl sm:text-4xl' : 'text-3xl sm:text-5xl';
  return <section className={`rounded-2xl border border-cyan-300/20 bg-[linear-gradient(135deg,#081326,#120d29)] text-center shadow-[0_16px_50px_#02061788] ${compact ? 'p-4' : 'p-5 sm:p-6'}`} aria-label="Karaoke lyrics">
    <p className="text-[10px] font-black uppercase tracking-[.22em] text-cyan-300">{cue.waiting ? 'Coming up' : 'Sing now'}</p>
    <div className={`mx-auto mt-2 flex max-w-5xl items-center justify-center overflow-hidden ${compact ? 'min-h-16' : maxLines === 1 ? 'min-h-20' : 'min-h-24'}`}>
      <LyricLine
        segments={cue.segments}
        fallback={cue.text}
        className={`${size} max-w-full font-black leading-tight ${maxLines === 1 ? 'whitespace-nowrap' : ''}`}
      />
    </div>
    <div className="mx-auto mt-3 h-1.5 max-w-4xl overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-[width] duration-75" style={{ width: `${cue.progress * 100}%` }} /></div>
    {!compact && <p className="mt-2 min-h-5 text-sm text-slate-500">{cue.nextText ? `Next: ${cue.nextText}` : 'Follow the target note as it reaches the gold strike line'}</p>}
  </section>;
}

/** Host view: one banner for genuinely shared words, otherwise one line per SATB part. */
export function ChoirKaraokeLyrics({ song, notes, elapsed }: { song: Song; notes: SongNote[]; elapsed: number }) {
  const cues = VOICES.map((_, partIndex) => karaokeCue(song, notes, partIndex, elapsed));
  const signatures = cues.map(cue => cue.text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
  if (signatures.every(Boolean) && new Set(signatures).size === 1) {
    return <KaraokeLyrics song={song} notes={notes} partIndex={0} elapsed={elapsed} compact />;
  }

  return <section className="rounded-2xl border border-cyan-300/20 bg-[linear-gradient(135deg,#081326,#120d29)] p-4 shadow-[0_16px_50px_#02061788]" aria-label="SATB choir lyrics">
    <p className="mb-3 text-center text-[10px] font-black uppercase tracking-[.22em] text-cyan-300">Choir lyrics · each singer follows their own part</p>
    <div className="grid gap-2 lg:grid-cols-2">
      {cues.map((cue, partIndex) => <div key={VOICES[partIndex]} className="grid grid-cols-[76px_1fr] items-center overflow-hidden rounded-xl border bg-black/20" style={{ borderColor: `${COLOURS[partIndex]}45` }}>
        <div className="self-stretch border-r px-3 py-3" style={{ borderColor: `${COLOURS[partIndex]}35`, background: `${COLOURS[partIndex]}12` }}>
          <b className="text-lg" style={{ color: COLOURS[partIndex] }}>{VOICES[partIndex][0]}</b>
          <p className="text-[9px] font-black uppercase tracking-wider" style={{ color: COLOURS[partIndex] }}>{VOICES[partIndex]}</p>
        </div>
        <div className="min-w-0 px-3 py-3">
          <LyricLine
            segments={cue.segments}
            fallback={cue.text}
            className="min-h-7 text-sm font-bold leading-snug"
            sung={COLOURS[partIndex]}
            unsung="#e2e8f0"
          />
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full" style={{ width: `${cue.progress * 100}%`, background: COLOURS[partIndex] }} /></div>
        </div>
      </div>)}
    </div>
  </section>;
}
