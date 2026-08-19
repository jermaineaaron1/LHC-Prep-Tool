'use client';

import { useEffect, useState } from 'react';

/**
 * True below Tailwind's `sm` breakpoint — a phone held upright, or the iframe
 * the main app embeds this game in, which is narrower still.
 *
 * Most of the portrait layout is pure CSS, but one thing CSS cannot express:
 * whether the pitch lane should be a fixed 300px strip (desktop, where the
 * page scrolls) or should FILL whatever height the no-scroll phone column has
 * left over. That choice is a prop on CanvasLane, so it needs to exist in JS.
 *
 * Starts false so the server render and the first client render agree; the
 * effect corrects it before the first frame a person could read.
 */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const read = () => setNarrow(media.matches);
    read();
    media.addEventListener('change', read);
    return () => media.removeEventListener('change', read);
  }, []);
  return narrow;
}
