'use client';

import { useEffect, useRef, useState } from 'react';
import { forgetLatency, isReliable, measureLatency, rememberLatencySec, storedLatencySec } from '@/lib/vocal-hero/latency';
import type { LatencyResult } from '@/lib/vocal-hero/latency';

type Phase = 'idle' | 'listening' | 'done' | 'failed' | 'blocked';

/** The row shown in a lobby: current setting, and a way to measure it. */
export function LatencyRow({ colour, latencySec, onChange }: {
  colour: string;
  latencySec: number;
  onChange: (seconds: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return <div>
    <p className="text-xs tracking-[.15em] text-slate-400">AUDIO DELAY</p>
    <div className="mt-2 flex items-center gap-2">
      <div className="flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
        <b className="text-sm" style={{ color: latencySec > 0 ? colour : '#94a3b8' }}>
          {latencySec > 0 ? `${Math.round(latencySec * 1000)} ms` : 'Not measured'}
        </b>
        <small className="ml-2 text-[10px] text-slate-500">
          {latencySec > 0 ? 'allowed for when scoring' : 'scoring assumes no delay'}
        </small>
      </div>
      <button type="button" onClick={() => setOpen(true)} className="vh-outline-button whitespace-nowrap text-xs">
        {latencySec > 0 ? 'Measure again' : 'Measure'}
      </button>
    </div>
    <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
      Wireless earbuds can delay what you hear by a fifth of a second. Measuring it lets the game credit
      the beat you sang to rather than the one it heard.
    </p>
    {open && <CalibrationDialog colour={colour} onClose={() => setOpen(false)} onChange={onChange} />}
  </div>;
}

function CalibrationDialog({ colour, onClose, onChange }: {
  colour: string;
  onClose: () => void;
  onChange: (seconds: number) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [beat, setBeat] = useState(0);
  const [result, setResult] = useState<LatencyResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run() {
    setPhase('listening'); setBeat(0); setResult(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // Started from this click, so the AudioContext is allowed to make sound.
      const measured = await measureLatency({ onBeat: setBeat, signal: controller.signal });
      setResult(measured);
      setPhase(isReliable(measured) ? 'done' : 'failed');
    } catch (cause) {
      setPhase(cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'blocked' : 'failed');
    }
  }

  function accept() {
    if (!result) return;
    rememberLatencySec(result.latencySec);
    onChange(result.latencySec);
    onClose();
  }

  function clear() {
    forgetLatency();
    onChange(0);
    onClose();
  }

  return <div className="fixed inset-0 z-[80] grid place-items-center bg-[#020510]/90 p-4 backdrop-blur-md"
    onMouseDown={event => { if (event.target === event.currentTarget && phase !== 'listening') onClose(); }}>
    <div className="w-full max-w-md overflow-hidden rounded-3xl border bg-[#090d22] shadow-[0_0_80px_#00000088]" style={{ borderColor: `${colour}55` }}>
      <div className="border-b border-white/10 px-6 py-5">
        <p className="text-[10px] font-black tracking-[.24em]" style={{ color: colour }}>MEASURE YOUR AUDIO DELAY</p>
        <h2 className="mt-2 text-2xl font-black text-white">Clap on every beep</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Six beeps, one a second. Clap along with them — the first is just to find the pulse.
          Do it wearing whatever you will wear while singing, since that is the delay being measured.
        </p>
      </div>

      <div className="grid min-h-44 place-items-center px-6 py-6 text-center">
        {phase === 'idle' && <p className="text-sm text-slate-400">Somewhere reasonably quiet, with the volume up.</p>}

        {phase === 'listening' && <div>
          <p className="text-6xl font-black" style={{ color: colour }}>{beat || '·'}</p>
          <p className="mt-2 text-sm text-slate-400">{beat <= 1 ? 'Find the pulse…' : 'Clap!'}</p>
        </div>}

        {phase === 'done' && result && <div>
          <p className="text-5xl font-black" style={{ color: colour }}>{Math.round(result.latencySec * 1000)} ms</p>
          <p className="mt-2 text-sm text-slate-400">
            from {result.offsets.length} of {result.beats} claps, within {Math.round(result.spreadMs)} ms of each other
          </p>
          <p className="mt-3 text-xs text-slate-500">
            {result.latencySec < 0.03
              ? 'Barely any delay — your setup is already in time.'
              : 'Your singing will now be credited to the beat you sang to.'}
          </p>
        </div>}

        {phase === 'failed' && <div>
          <p className="text-lg font-bold text-amber-300">Not a confident reading</p>
          <p className="mt-2 text-sm text-slate-400">
            {result && result.offsets.length < 3
              ? 'Too few claps were heard. Clap firmly, closer to the microphone.'
              : 'The claps were too uneven to trust. Try again with the beat.'}
          </p>
        </div>}

        {phase === 'blocked' && <p className="text-sm text-rose-300">
          The microphone is blocked. Allow it in your browser settings and try again.
        </p>}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-6 py-4">
        <button type="button" onClick={onClose} disabled={phase === 'listening'} className="vh-outline-button disabled:opacity-40">
          {phase === 'done' ? 'Cancel' : 'Close'}
        </button>
        {storedLatencySec() > 0 && phase !== 'listening' &&
          <button type="button" onClick={clear} className="vh-outline-button">Clear</button>}
        {phase !== 'done' && <button type="button" onClick={run} disabled={phase === 'listening'} className="vh-primary-button min-w-32 disabled:opacity-40">
          {phase === 'listening' ? 'Listening…' : phase === 'idle' ? 'Start' : 'Try again'}
        </button>}
        {phase === 'done' && <button type="button" onClick={accept} className="vh-primary-button min-w-32">Use this</button>}
      </div>
    </div>
  </div>;
}
