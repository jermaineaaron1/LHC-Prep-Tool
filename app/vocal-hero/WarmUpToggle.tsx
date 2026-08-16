'use client';

// Somewhere to sing without it counting. A volunteer who is nervous about
// being measured will try this before they try anything else, and a singer
// checking a phrase does not want three bad attempts on a leaderboard.
//
// Deliberately NOT remembered between sessions, unlike difficulty, delay and
// key: a setting that silently discards a real round would be far worse than
// one that has to be switched on each time.

export function WarmUpToggle({ value, onChange, colour }: {
  value: boolean;
  onChange: (next: boolean) => void;
  colour: string;
}) {
  return <div>
    <p className="text-xs tracking-[.15em] text-slate-400">WARM-UP</p>
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className="mt-2 flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition"
      style={{ borderColor: value ? colour : '#ffffff18', background: value ? `${colour}18` : '#07111d' }}
    >
      <span className="grid h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition"
        style={{ background: value ? colour : '#334155' }}>
        <span className="h-4 w-4 rounded-full bg-[#07111d] transition" style={{ transform: value ? 'translateX(16px)' : 'none' }} />
      </span>
      <span className="min-w-0">
        <b className="block text-sm" style={{ color: value ? colour : '#cbd5e1' }}>
          {value ? 'Nothing is being scored' : 'Sing for the score'}
        </b>
        <small className="block text-[10px] leading-tight text-slate-500">
          {value
            ? 'Every cue still works. No points, no leaderboard, nothing recorded.'
            : 'Points count toward your score and the section leaderboard.'}
        </small>
      </span>
    </button>
  </div>;
}

/** Shown throughout a warm-up round, so nobody sings a real take believing it counts. */
export function WarmUpBadge({ active }: { active: boolean }) {
  if (!active) return null;
  return <span className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-cyan-200">
    Warm-up · not scored
  </span>;
}
