'use client';

import type { SongNote } from '@/lib/vocal-hero/types';

// Practising a line that sits outside your range means straining at the top or
// losing the bottom entirely, and either way the score measures the range
// rather than the singing. Shifting the targets is local to this device: the
// arrangement is untouched, and nobody else's lane moves.

export const TRANSPOSE_KEY = 'vh_transpose';
const LIMIT = 12;

export function storedTranspose(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = Number(window.localStorage.getItem(TRANSPOSE_KEY));
    return Number.isFinite(raw) ? clampTranspose(raw) : 0;
  } catch {
    return 0;   // private browsing
  }
}

export function rememberTranspose(semitones: number): void {
  try { window.localStorage.setItem(TRANSPOSE_KEY, String(clampTranspose(semitones))); } catch { /* private browsing */ }
}

export function clampTranspose(semitones: number): number {
  if (!Number.isFinite(semitones)) return 0;
  return Math.max(-LIMIT, Math.min(LIMIT, Math.round(semitones)));
}

/** A shifted copy. The stored arrangement is never touched — this exists only
 * for the length of a practice round. */
export function transposeNotes(notes: SongNote[], semitones: number): SongNote[] {
  if (!semitones) return notes;
  return notes.map(note => ({ ...note, midi: note.midi + semitones }));
}

export function transposeLabel(semitones: number): string {
  if (!semitones) return 'Written key';
  const octaves = semitones % 12 === 0 ? semitones / 12 : 0;
  if (octaves) return `${octaves > 0 ? '+' : '−'}${Math.abs(octaves)} octave${Math.abs(octaves) === 1 ? '' : 's'}`;
  return `${semitones > 0 ? '+' : '−'}${Math.abs(semitones)} semitone${Math.abs(semitones) === 1 ? '' : 's'}`;
}

export function TransposePicker({ value, onChange, colour, hasBackingTrack }: {
  value: number;
  onChange: (semitones: number) => void;
  colour: string;
  hasBackingTrack: boolean;
}) {
  const step = (delta: number) => onChange(clampTranspose(value + delta));
  return <div>
    <p className="text-xs tracking-[.15em] text-slate-400">PRACTICE KEY</p>
    <div className="mt-2 flex items-center gap-2">
      <button type="button" onClick={() => step(-1)} disabled={value <= -LIMIT}
        aria-label="Down a semitone"
        className="vh-outline-button px-3 text-lg leading-none disabled:opacity-30">−</button>
      <div className="flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-center">
        <b className="text-sm" style={{ color: value ? colour : '#94a3b8' }}>{transposeLabel(value)}</b>
      </div>
      <button type="button" onClick={() => step(1)} disabled={value >= LIMIT}
        aria-label="Up a semitone"
        className="vh-outline-button px-3 text-lg leading-none disabled:opacity-30">+</button>
      {value !== 0 && <button type="button" onClick={() => onChange(0)} className="vh-outline-button whitespace-nowrap text-xs">Reset</button>}
    </div>
    <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
      Moves your targets only — the arrangement and everyone else&apos;s lane stay in the written key.
    </p>
    {value !== 0 && hasBackingTrack && <p className="mt-2 rounded-lg border border-amber-300/30 bg-amber-300/[.08] px-3 py-2 text-[11px] font-semibold text-amber-200">
      ⚠ The backing track cannot move with you. It will sound in the written key while you sing in another — use this without the track, or expect the clash.
    </p>}
  </div>;
}

/** Shown during a round so a shift can never be silently in force. */
export function TransposeBadge({ semitones, colour }: { semitones: number; colour: string }) {
  if (!semitones) return null;
  return <span className="rounded-lg border px-2 py-1 text-[10px] font-black uppercase tracking-wider"
    style={{ borderColor: `${colour}66`, color: colour, background: `${colour}14` }}>
    {transposeLabel(semitones)}
  </span>;
}
