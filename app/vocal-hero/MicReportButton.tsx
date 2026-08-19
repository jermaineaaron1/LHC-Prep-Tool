'use client';

import { useState } from 'react';
import { PitchEngine } from '@/lib/vocal-hero/pitchEngine';

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
      const env = await PitchEngine.environment();
      let inputs: string[] = [];
      try { inputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput').map(d => d.label || '(unnamed input)'); } catch { inputs = ['(device list unavailable)']; }
      const payload = {
        context,
        at: new Date().toISOString(),
        inIframe: window.self !== window.top,
        userAgent: navigator.userAgent,
        env,
        inputs,
        engine: engine ? {
          running: engine.isRunning, suspended: engine.isSuspended, sampleRate: engine.sampleRate,
          track: engine.trackInfo, recovery: engine.recoveryInfo,
          levelNow: engine.level, dcOffset: engine.dcOffset, levelTrace: trace,
          traceMax: Math.max(0, ...trace), traceAvg: trace.length ? trace.reduce((a, b) => a + b, 0) / trace.length : 0,
        } : null,
      };
      const response = await fetch('/api/vocal-hero/mic-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json() as { code?: string; error?: string };
      if (!response.ok || !data.code) throw new Error(data.error || 'Could not send.');
      setCode(data.code);
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
