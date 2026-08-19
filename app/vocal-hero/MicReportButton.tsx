'use client';

import { useState } from 'react';
import type { PitchEngine } from '@/lib/vocal-hero/pitchEngine';
import { sendMicReport } from '@/lib/vocal-hero/micReport';

/**
 * One tap gathers everything a dead microphone refuses to say out loud and
 * sends it where the developer can read it, leaving the singer a short code
 * to pass on instead of eight numbers to take down mid-rehearsal.
 *
 * The two seconds of level trace are the heart of it: the singer speaks while
 * it records, so the report distinguishes "no audio ever arrives" from "audio
 * arrives but no pitch locks" -- the two failures every verbal report has
 * collapsed into one.
 */
export function MicReportButton({ getEngine, context }: { getEngine: () => PitchEngine | null; context: string }) {
  const [state, setState] = useState<'idle' | 'recording' | 'sending' | 'done' | 'failed'>('idle');
  const [code, setCode] = useState('');

  async function send() {
    try {
      setState('recording');
      const engine = getEngine();
      const trace: number[] = [];
      if (engine) for (let i = 0; i < 20; i++) { trace.push(Number(engine.level.toFixed(5))); await new Promise(resolve => setTimeout(resolve, 100)); }
      setState('sending');
      setCode(await sendMicReport(engine, context, engine ? trace : undefined));
      setState('done');
    } catch {
      setState('failed');
    }
  }

  if (state === 'done') return <p className="mt-2 rounded-lg border border-emerald-300/30 bg-emerald-950/40 px-2 py-1.5 text-center text-[11px] text-emerald-200">Report sent — code <b className="font-mono text-sm tracking-widest">{code}</b></p>;
  return <button type="button" onClick={() => void send()} disabled={state === 'recording' || state === 'sending'} className="mt-2 w-full rounded-lg border border-cyan-300/30 bg-cyan-950/30 px-2 py-1.5 text-[11px] text-cyan-100 disabled:opacity-60">
    {state === 'recording' ? 'Recording 2s — keep speaking…' : state === 'sending' ? 'Sending…' : state === 'failed' ? 'Failed — tap to try again' : '⇪ Mic not working? Speak, and tap to send a report'}
  </button>;
}
