'use client';

import type { Difficulty } from '@/lib/vocal-hero/scoreEngine';

// Scoring tolerance is per singer and evaluated on their own device, so each
// one picks their own. CENT_TOLERANCE has defined these three all along and
// nothing ever passed a value, so every singer was silently locked to medium.
const DIFFICULTIES: Array<{ id: Difficulty; label: string; hint: string }> = [
  { id: 'easy',   label: 'Easy',   hint: 'within a semitone' },
  { id: 'medium', label: 'Medium', hint: 'within a quarter tone' },
  { id: 'hard',   label: 'Hard',   hint: 'close to exact' },
];

export const DIFFICULTY_KEY = 'vh_difficulty';

/** Read on the client only — localStorage does not exist during prerender, and
 * reading it while rendering would make the first client paint disagree with
 * the server markup. */
export function storedDifficulty(): Difficulty {
  if (typeof window === 'undefined') return 'medium';
  try {
    const saved = window.localStorage.getItem(DIFFICULTY_KEY);
    return saved === 'easy' || saved === 'hard' || saved === 'medium' ? saved : 'medium';
  } catch {
    return 'medium';   // private browsing
  }
}

export function rememberDifficulty(next: Difficulty): void {
  try { window.localStorage.setItem(DIFFICULTY_KEY, next); } catch { /* private browsing */ }
}

export function DifficultyPicker({ value, onChange, colour }: {
  value: Difficulty;
  onChange: (next: Difficulty) => void;
  colour: string;
}) {
  return <div>
    <p className="text-xs tracking-[.15em] text-slate-400">SCORING TOLERANCE</p>
    <div className="mt-2 grid grid-cols-3 gap-2">
      {DIFFICULTIES.map(option => {
        const active = value === option.id;
        return <button
          key={option.id}
          type="button"
          aria-pressed={active}
          onClick={() => onChange(option.id)}
          className="rounded-xl border px-2 py-2 text-center transition hover:bg-white/[.04]"
          style={{ borderColor: active ? colour : '#ffffff18', background: active ? `${colour}18` : '#07111d' }}
        >
          <b className="block text-sm" style={{ color: active ? colour : '#cbd5e1' }}>{option.label}</b>
          <small className="mt-0.5 block text-[9px] leading-tight text-slate-500">{option.hint}</small>
        </button>;
      })}
    </div>
  </div>;
}
