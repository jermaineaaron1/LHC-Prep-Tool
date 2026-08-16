'use client';

import { formatTime } from '@/lib/vocal-hero/review';
import type { RoundReview, WeakSpot } from '@/lib/vocal-hero/review';

const ADVICE: Record<WeakSpot['worst'], string> = {
  missed: 'never found',
  timing: 'came in late',
  pitch: 'tuning drifted',
  hold: 'let go early',
};

/** What the round is worth saying about it, once it is over. */
export function RoundReviewPanel({ review, colour, compact = false }: {
  review: RoundReview;
  colour: string;
  compact?: boolean;
}) {
  if (!review.notes) return null;
  const percent = review.maxPoints ? Math.round(review.points / review.maxPoints * 100) : 0;

  return <section className={`rounded-2xl border border-white/10 bg-white/[.03] ${compact ? 'p-4' : 'p-5'} text-left`} aria-label="Round review">
    <p className="text-[10px] font-black uppercase tracking-[.2em] text-slate-500">How that round went</p>

    <p className={`mt-3 font-black leading-snug ${compact ? 'text-base' : 'text-xl'}`} style={{ color: colour }}>
      {review.headline}
    </p>

    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
      <Stat label="Timing" value={review.timing} />
      <Stat label="Pitch" value={review.pitch} />
      <Stat label="Hold" value={review.hold} />
    </div>

    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
      <span>{review.found} of {review.notes} notes found</span>
      <span>{review.points} points · {percent}%</span>
      {review.biasWorthMentioning && <span className="text-amber-300">
        {Math.abs(Math.round(review.centsBias))} cents {review.centsBias < 0 ? 'flat' : 'sharp'} on average
      </span>}
      {review.octaveNotes > 0 && <span className="text-amber-300">
        {review.octaveNotes} note{review.octaveNotes === 1 ? '' : 's'} an octave {review.octaveShift < 0 ? 'below' : 'above'}
      </span>}
    </div>

    {review.weakest.length > 0 && <div className="mt-4 border-t border-white/[.07] pt-3">
      <p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-500">Worth another look</p>
      <ul className="mt-2 space-y-1">
        {review.weakest.map(spot => <li key={spot.noteId} className="flex items-center gap-2 text-sm">
          <span className="font-mono text-[11px] text-slate-500">{formatTime(spot.startSec)}</span>
          <span className="min-w-0 flex-1 truncate font-semibold text-slate-200">{spot.lyric}</span>
          <span className="text-xs text-amber-300">{ADVICE[spot.worst]}</span>
        </li>)}
      </ul>
    </div>}
  </section>;
}

function Stat({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  return <div className="rounded-xl bg-black/25 p-2">
    <b className={percent >= 80 ? 'text-emerald-300' : percent >= 50 ? 'text-amber-300' : 'text-slate-400'}>{percent}%</b>
    <small className="mt-1 block text-[9px] uppercase tracking-wider text-slate-500">{label}</small>
  </div>;
}
