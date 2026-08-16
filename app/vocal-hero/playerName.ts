'use client';

// One name per device, typed once. Before this, every solo round on the host
// joined as the literal 'Solo Singer' — and because high scores dedup on
// (song, voice, name), every solo attempt by every person collapsed into one
// anonymous row on the board.

export const PLAYER_NAME_KEY = 'vh_player_name';

/** Read on the client only, after mount — localStorage does not exist during
 * prerender, and reading it while rendering would make the first client paint
 * disagree with the server markup. */
export function storedPlayerName(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (window.localStorage.getItem(PLAYER_NAME_KEY) ?? '').slice(0, 40);
  } catch {
    return '';   // private browsing
  }
}

export function rememberPlayerName(name: string): void {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return;   // never remember an empty name over a real one
  try { window.localStorage.setItem(PLAYER_NAME_KEY, trimmed); } catch { /* private browsing */ }
}
