'use client';

import type { SongNote } from '@/lib/vocal-hero/types';

const DEFAULT_RANGE = [36, 84];

function hzToMidi(hz: number) { return 69 + 12 * Math.log2(hz / 440); }

/**
 * DOM-based pitch highway. It deliberately avoids a canvas so the track stays
 * legible in iframes, mobile WebViews, and browsers that delay canvas painting.
 */
export function SatbLane({
  partIndex, partName, colour, elapsed, notes, pitchHz, playerCount, hitNotes = {}, compact = false,
  lookAheadSeconds = compact ? 5 : 10, showLyrics = !compact,
}: {
  partIndex: number;
  partName: string;
  colour: string;
  elapsed: number;
  notes: SongNote[];
  pitchHz?: number;
  playerCount?: number;
  hitNotes?: Record<string, boolean>;
  compact?: boolean;
  lookAheadSeconds?: number;
  showLyrics?: boolean;
}) {
  const partNotes = notes.filter(note => note.part === partIndex || note.part === -1);
  const pitches = partNotes.map(note => note.midi);
  let low = pitches.length ? Math.min(...pitches) - 2 : DEFAULT_RANGE[0];
  let high = pitches.length ? Math.max(...pitches) + 2 : DEFAULT_RANGE[1];
  if (high - low < 12) { const middle = (high + low) / 2; low = middle - 6; high = middle + 6; }

  const cursor = 12;
  const trackWidth = 88;
  const yFor = (midi: number) => 93 - ((midi - low) / (high - low)) * 86;
  const visible = partNotes.filter(note => note.end >= elapsed - .6 && note.start <= elapsed + lookAheadSeconds);
  const pitchY = pitchHz && pitchHz > 0 ? Math.max(5, Math.min(95, yFor(hzToMidi(pitchHz)))) : null;

  return (
    <section className={`flex overflow-hidden rounded-2xl border border-white/10 bg-[#08111f] ${compact ? 'h-16' : 'h-[116px]'}`} aria-label={`${partName} pitch lane`}>
      <div className="flex w-24 shrink-0 flex-col items-center justify-center border-r border-white/10 px-2" style={{ background: `${colour}18` }}>
        <strong className={compact ? 'text-base' : 'text-xl'} style={{ color: colour }}>{partName[0]}</strong>
        <span className="text-[10px] font-semibold uppercase tracking-[.16em]" style={{ color: colour }}>{partName}</span>
        {playerCount !== undefined && <span className="mt-1 text-xs text-slate-300">{playerCount} singers</span>}
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden bg-[#08111f]" style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent calc(20% - 1px), rgba(113,144,177,.18) 20%)' }}>
        <div className="absolute inset-y-0 z-20 w-[3px] bg-[#f6c65b] shadow-[0_0_14px_#f6c65b]" style={{ left: `${cursor}%` }} aria-label="Strike line" />
        <div className="absolute inset-y-0 border-l border-dashed border-white/10" style={{ left: '50%' }} />
        {visible.map(note => {
          const left = cursor + ((note.start - elapsed) / lookAheadSeconds) * trackWidth;
          const width = Math.max(3, ((note.end - note.start) / lookAheadSeconds) * trackWidth - .5);
          const past = note.end <= elapsed;
          const result = hitNotes[note.id];
          const fill = past ? (result ? '#65d6a4' : '#44566d') : colour;
          return <div key={note.id} className="absolute flex min-w-[8px] items-center overflow-hidden rounded-md px-1.5 text-[10px] font-bold text-[#07111d]" style={{ left: `${left}%`, top: `${yFor(note.midi)}%`, width: `${width}%`, height: compact ? 15 : 23, transform: 'translateY(-50%)', background: fill, boxShadow: `0 0 10px ${fill}66`, opacity: past && !result ? .45 : 1 }}>
            {showLyrics && width > 12 ? note.lyric : ''}
          </div>;
        })}
        {pitchY !== null && <div className="absolute z-30 h-4 w-4 rounded-full border-2 border-white bg-[#07111d] shadow-[0_0_16px_#fff]" style={{ left: `calc(${cursor}% - 7px)`, top: `${pitchY}%`, transform: 'translateY(-50%)', boxShadow: `0 0 18px ${colour}` }} aria-label="Detected pitch" />}
        {!partNotes.length && <p className="absolute inset-0 grid place-items-center text-xs text-slate-500">No playable notes in this song</p>}
        <div className="absolute bottom-1 right-3 text-[9px] font-semibold uppercase tracking-[.14em] text-slate-500">next {lookAheadSeconds}s</div>
      </div>
    </section>
  );
}
