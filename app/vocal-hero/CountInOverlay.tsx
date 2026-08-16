'use client';

/**
 * The count-in, shown over the live stage instead of as a second full-screen
 * countdown.
 *
 * A round used to count down twice: once while the server-scheduled start
 * approached ("Starts in 5…1") and again for the musical count-in
 * ("Count-in 5…1") — ten seconds of full-screen numbers before a note was
 * seen. The first countdown keeps its screen; the second now happens inside
 * the game, lanes visible and the bar frozen at zero, with this overlay
 * carrying the count.
 */
export function CountInOverlay({ phase }: { phase: string }) {
  const number = phase.match(/(\d+)/)?.[1] ?? null;
  const leadIn = phase.startsWith('Lead-in');
  return <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center">
    <div className="rounded-3xl border border-white/10 bg-[#020510]/65 px-10 py-5 text-center shadow-[0_0_60px_#00000088] backdrop-blur-[2px]">
      {leadIn
        ? <>
          <p className="text-3xl text-cyan-200">♪</p>
          <p className="mt-1 text-xs font-black uppercase tracking-[.26em] text-cyan-200">Listen — your starting note</p>
        </>
        : <>
          <p className="bg-gradient-to-br from-fuchsia-400 via-violet-400 to-cyan-300 bg-clip-text text-7xl font-black leading-none text-transparent">{number ?? '•'}</p>
          <p className="mt-1 text-[10px] font-black uppercase tracking-[.26em] text-fuchsia-200">Get ready — the bar moves at zero</p>
        </>}
    </div>
  </div>;
}
