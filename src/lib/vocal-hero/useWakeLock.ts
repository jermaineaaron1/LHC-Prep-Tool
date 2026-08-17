'use client';

import { useEffect } from 'react';

interface WakeLockSentinel { released: boolean; release(): Promise<void> }

/**
 * Holds the screen awake while `active`.
 *
 * A singer holds the phone up and does not touch it for a minute or more, which
 * is exactly the behaviour a screen timeout is designed to punish: the display
 * dims in the middle of a verse and the lane goes with it. Nothing in the round
 * depends on the screen staying lit -- scoring carries on regardless -- but the
 * singer cannot see what to sing.
 *
 * The lock is dropped by the browser whenever the tab is hidden, so it is taken
 * again on return; without that, one glance at a notification would end it for
 * the rest of the round. Unsupported or refused is not an error worth showing:
 * the round works, the screen may simply dim as it did before.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined') return;
    const api = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> } }).wakeLock;
    if (!api) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (sentinel && !sentinel.released) return;
      try {
        const lock = await api.request('screen');
        if (cancelled) { void lock.release().catch(() => undefined); return; }
        sentinel = lock;
      } catch {
        // Denied, or the tab was not visible at the moment of asking.
      }
    };

    void acquire();
    const onVisibility = () => { if (document.visibilityState === 'visible') void acquire(); };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => undefined);
      sentinel = null;
    };
  }, [active]);
}
