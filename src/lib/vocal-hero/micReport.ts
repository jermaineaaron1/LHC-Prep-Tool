'use client';

import { PitchEngine } from './pitchEngine';

/** Bumped by hand in every microphone-related change. Shown in the
 *  diagnostics panel and stamped into every report, because "is the phone
 *  even running the new code?" has cost this investigation at least two
 *  rounds of guessing. */
export const ENGINE_BUILD = 'scale-3';

/** Gathers everything a dead microphone refuses to say out loud. The caller
 *  supplies the level trace (recorded while the singer speaks) or lets this
 *  record its own. */
export async function sendMicReport(engine: PitchEngine | null, context: string, trace?: number[]): Promise<string> {
  const levels = trace ?? [];
  if (!trace && engine) for (let i = 0; i < 20; i++) { levels.push(Number(engine.level.toFixed(5))); await new Promise(resolve => setTimeout(resolve, 100)); }
  const env = await PitchEngine.environment();
  let inputs: string[] = [];
  try { inputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput').map(d => d.label || '(unnamed input)'); } catch { inputs = ['(device list unavailable)']; }
  const payload = {
    build: ENGINE_BUILD,
    context,
    at: new Date().toISOString(),
    inIframe: window.self !== window.top,
    userAgent: navigator.userAgent,
    env,
    inputs,
    engine: engine ? {
      running: engine.isRunning, suspended: engine.isSuspended, sampleRate: engine.sampleRate, capture: engine.captureMode,
      track: engine.trackInfo, recovery: engine.recoveryInfo, inputScale: engine.inputScale, confidenceNow: engine.confidence,
      rawWindow: engine.sampleWindow(1024),
      levelNow: engine.level, dcOffset: engine.dcOffset, levelTrace: levels,
      traceMax: Math.max(0, ...levels), traceAvg: levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : 0,
    } : null,
  };
  const response = await fetch('/api/vocal-hero/mic-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json() as { code?: string; error?: string };
  if (!response.ok || !data.code) throw new Error(data.error || 'Could not send the report.');
  return data.code;
}

let autoReportArmed = false;

/**
 * Watches a freshly started engine and files a report by itself if the
 * microphone is in one of the known bad states. Every round of this
 * investigation has stalled on the same step -- the person holding the phone
 * cannot be expected to relay numbers mid-rehearsal -- so on anomaly the
 * numbers now walk themselves out. Fires at most once per page load.
 *
 * The five-second grace period lets the audio thread spin up, permission
 * banners settle, and the singer actually make a sound.
 */
export function armAutoMicReport(getEngine: () => PitchEngine | null): void {
  if (autoReportArmed) return;
  autoReportArmed = true;
  void (async () => {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const engine = getEngine();
    if (!engine?.isRunning) return;
    const trace: number[] = [];
    for (let i = 0; i < 30; i++) { trace.push(Number(engine.level.toFixed(5))); await new Promise(resolve => setTimeout(resolve, 100)); }
    const max = Math.max(0, ...trace);
    const reason =
      engine.isSuspended ? 'suspended' :
      Math.abs(engine.dcOffset) > 1 ? 'huge-dc' :
      max > 1.5 ? 'not-audio-scale' :
      max < 0.003 ? 'running-but-silent' :
      engine.inputScale > 2 && engine.confidence < 0.3 ? 'audio-but-no-pitch' : null;
    if (!reason) return;
    try { await sendMicReport(engine, 'auto:' + reason, trace); } catch { /* diagnostics must never break the game */ }
  })();
}
