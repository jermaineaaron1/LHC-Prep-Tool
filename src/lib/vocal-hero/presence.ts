'use client';

// Who is actually in the room, and who merely was.
//
// Joining always INSERTED a row, and the phone never remembered which row was
// its own. So a reload, a dropped signal or a locked screen produced a SECOND
// singer with the same name and a score of zero, while the first sat in the
// lobby for ever. Old sessions in the library still show it: "Aaron:0,
// Aaron:41" is one person who reloaded once.
//
// Two halves fix it. The device remembers its player id per room, so it can ask
// to resume rather than to join; and a heartbeat says "still here", so a host
// can tell a singer who left from one who is simply quiet between verses.

const KEY = 'vh_player_ids';

/** How often a phone says it is still there. */
export const HEARTBEAT_MS = 15_000;
/** Three missed beats. Long enough to ride out a tunnel, short enough that a
 *  leader counting voices is not counting someone who went home. */
export const STALE_AFTER_MS = 45_000;

type Remembered = Record<string, string>;

function read(): Remembered {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(window.localStorage.getItem(KEY) || '{}') as Remembered; }
  catch { return {}; }
}

/** The player id this device used in this room, if any. */
export function storedPlayerId(roomCode: string): string | null {
  return read()[roomCode.toUpperCase()] ?? null;
}

/** Keyed by room, so joining a second room never inherits the first one's seat. */
export function rememberPlayerId(roomCode: string, playerId: string): void {
  if (typeof window === 'undefined') return;
  const all = read();
  all[roomCode.toUpperCase()] = playerId;
  // A phone used for years of Sundays should not accumulate every room it has
  // ever seen; the newest handful is all that can still be resumed.
  const keys = Object.keys(all);
  if (keys.length > 12) for (const key of keys.slice(0, keys.length - 12)) delete all[key];
  try { window.localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode */ }
}

export function forgetPlayerId(roomCode: string): void {
  if (typeof window === 'undefined') return;
  const all = read();
  delete all[roomCode.toUpperCase()];
  try { window.localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode */ }
}

/**
 * Is this singer still with us?
 *
 * `last_seen_at` is null for anyone who joined before heartbeats existed, and
 * for a phone that has only just arrived. Falling back to the join time is what
 * stops the lobby declaring a room full of ghosts the moment this ships.
 */
export function isPresent(
  lastSeenAt: string | null | undefined,
  joinedAt: string | null | undefined,
  now: number = Date.now(),
  staleAfterMs: number = STALE_AFTER_MS
): boolean {
  const stamp = lastSeenAt ?? joinedAt;
  if (!stamp) return true;                 // nothing to judge on; assume present
  const at = Date.parse(stamp);
  if (!Number.isFinite(at)) return true;
  return now - at < staleAfterMs;
}

/** How long ago, in words a leader can act on. */
export function lastSeenLabel(lastSeenAt: string | null | undefined, now: number = Date.now()): string {
  if (!lastSeenAt) return 'not seen yet';
  const at = Date.parse(lastSeenAt);
  if (!Number.isFinite(at)) return 'not seen yet';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'here';
  if (seconds < 90) return 'a minute ago';
  if (seconds < 3600) return Math.round(seconds / 60) + ' min ago';
  return Math.round(seconds / 3600) + 'h ago';
}
