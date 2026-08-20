'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Song } from '@/lib/vocal-hero/types';
import { clearTrail, pushTrail } from '@/lib/vocal-hero/trail';
import { CanvasLane } from './CanvasLane';
import type { TrailSample } from '@/lib/vocal-hero/trail';
import { KaraokeLyrics } from './KaraokeLyrics';
import { MicError, PitchEngine, type MicFailure } from '@/lib/vocal-hero/pitchEngine';
import { rememberWorkingDevice, storedWorkingDevice } from '@/lib/vocal-hero/micReport';
import { isGuideMelody, playableNotes } from '@/lib/vocal-hero/songData';
import { detectionRange, livePitchFeedback } from '@/lib/vocal-hero/liveCues';
import { transposeNotes } from './TransposePicker';
import { useNarrow } from '@/lib/vocal-hero/useNarrow';
import { GuidePlayer } from '@/lib/vocal-hero/guideTones';
import { Transport, phraseAround, type LoopRegion } from '@/lib/vocal-hero/transport';

const VOICES = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#ff60bc', '#a965ff', '#22d3ee', '#ffbd45'];
const SPEEDS = [0.5, 0.6, 0.7, 0.85, 1];

/**
 * Practice: one singer, no room, no score.
 *
 * A scored round is deliberately unforgiving -- it starts when the host says so,
 * runs once, and ends. That is right for a rehearsal and wrong for the singer
 * this tool most needs to help, who wants the same eight bars twenty times,
 * slower, in a key they can actually reach.
 *
 * So this owns a Transport instead of reading the round clock, and is otherwise
 * built from the pieces the game already has: the same lane, the same karaoke
 * line, the same guide tones and the same pitch detection. Nothing here talks to
 * a session, which is what keeps the multiplayer path exactly as it was.
 */
export function PracticeStage({ song, onExit, initialLoop, initialPart }: { song: Song; onExit: () => void; initialLoop?: LoopRegion | null; initialPart?: number }) {
  const [part, setPart] = useState(initialPart ?? 0);
  const [transpose, setTranspose] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoopRegion] = useState<LoopRegion | null>(null);
  // Arriving straight from a round with a passage to fix: the loop is set and
  // the playhead put at its start, so the singer presses play and is already
  // on the bit that went wrong rather than hunting for it.
  const appliedInitialRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [mic, setMic] = useState<'unknown' | 'checking' | 'ready' | 'blocked'>('unknown');
  // Practice is where a singer is alone with the thing and has nobody to ask,
  // so a mic that fails silently here is worse than in a room. Same reasoning
  // as the phone: keep WHY it failed, not just that it did.
  const [micReason, setMicReason] = useState<MicFailure | null>(null);
  const [standalone, setStandalone] = useState(false);
  useEffect(() => { void PitchEngine.environment().then(env => setStandalone(env.standalone)); }, []);
  const [guideAudio, setGuideAudio] = useState(true);
  // The AudioContext cannot exist until the first tap -- browsers refuse one
  // without a gesture. The guide effect below read the ref and gave up when it
  // was still null, and nothing in its deps changed when Play finally created
  // one, so the tones never sounded at all. This is what re-runs it.
  const [audioReady, setAudioReady] = useState(false);
  const narrow = useNarrow();
  // Speed and key matter, but not sixty times a minute -- on a phone they fold
  // away so the lane gets the height instead.
  const [showTools, setShowTools] = useState(false);

  const transportRef = useRef(new Transport());
  const contextRef = useRef<AudioContext | null>(null);
  const pitchRef = useRef<PitchEngine | null>(null);
  const trailRef = useRef<TrailSample[]>([]);
  const positionRef = useRef(0);
  const lapRef = useRef(0);
  const paintRef = useRef(0);
  // The canvas reads these every frame. Keeping the playhead and the detected
  // pitch out of React state is what lets the lane run at 60fps while the page
  // around it renders at reading speed.
  const pitchValueRef = useRef(0);
  const levelRef = useRef(0);
  const lastTextPaintRef = useRef(0);

  const allNotes = useMemo(() => transposeNotes(playableNotes(song), transpose), [song, transpose]);
  const guide = isGuideMelody(allNotes);
  const lanePart = guide ? -1 : part;
  const myNotes = useMemo(() => allNotes.filter(note => note.part === lanePart || note.part === -1), [allNotes, lanePart]);
  const duration = useMemo(() => Math.max(song.duration || 0, ...allNotes.map(note => note.end)) + 1, [song.duration, allNotes]);

  // One clock for the whole screen. Everything below reads this, so the lane,
  // the words, the tones and the microphone can never disagree about where the
  // music is.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const now = Date.now();
      const sample = transportRef.current.sample(now);
      positionRef.current = sample.position;
      lapRef.current = sample.lap;
      // The lane draws itself from the ref above. Only the WORDS and the note
      // readout are React, and nobody reads either sixty times a second -- so
      // this costs twelve renders instead of sixty, and the animation is not
      // affected by any of them.
      if (now - lastTextPaintRef.current > 80) { lastTextPaintRef.current = now; setPosition(sample.position); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (appliedInitialRef.current || !initialLoop) return;
    appliedInitialRef.current = true;
    transportRef.current.setLoop(initialLoop, Date.now());
    transportRef.current.seek(initialLoop.start, Date.now());
    setLoopRegion(transportRef.current.loopRegion);
    setPosition(initialLoop.start);
  }, [initialLoop]);

  // Guide tones, scheduled against the audio clock and re-armed each lap: the
  // second time round the loop must sound, and the scheduler remembers what it
  // has already played.
  useEffect(() => {
    if (!guideAudio) return;
    const context = contextRef.current;
    if (!context) return;
    const player = new GuidePlayer(context);
    let lastLap = lapRef.current;
    let lastPosition = positionRef.current;
    const timer = window.setInterval(() => {
      if (!transportRef.current.isPlaying) { player.reset(); return; }
      // A lap, or any backwards jump from a seek, means the notes ahead are ones
      // it has already scheduled and must be allowed to schedule again.
      if (lapRef.current !== lastLap || positionRef.current < lastPosition - 0.25) player.reset();
      lastLap = lapRef.current;
      lastPosition = positionRef.current;
      player.update(myNotes, positionRef.current);
    }, 60);
    return () => { window.clearInterval(timer); player.dispose(); };
  }, [guideAudio, myNotes, audioReady]);

  useEffect(() => () => { pitchRef.current?.stop(); void contextRef.current?.close().catch(() => undefined); }, []);
  // The detector is built once, with a frequency band fixed at that moment. A
  // key change moves the notes out from under it, so it has to be rebuilt --
  // otherwise the readout and the trail quietly stop working with nothing on
  // screen to explain why.
  const firstBandRef = useRef(true);
  useEffect(() => {
    if (firstBandRef.current) { firstBandRef.current = false; return; }
    if (!pitchRef.current) return;
    pitchRef.current.stop();
    pitchRef.current = null;
    setMic('unknown');
    if (transportRef.current.isPlaying) void startMic();
  }, [transpose, part]);

  async function ensureAudio() {
    contextRef.current ??= new AudioContext({ latencyHint: 'interactive' });
    if (contextRef.current.state === 'suspended') await contextRef.current.resume();
    setAudioReady(true);
  }

  async function startMic() {
    if (pitchRef.current?.isRunning) return;
    setMic('checking');
    const band = detectionRange(part, transpose, playableNotes(song));
    const engine = new PitchEngine({
      bufferSize: 2048, confidenceThreshold: .76, smoothing: .22,
      initialDeviceId: storedWorkingDevice(), onWorkingDevice: rememberWorkingDevice,
      minHz: PitchEngine.midiToHz(band.minMidi),
      maxHz: PitchEngine.midiToHz(band.maxMidi),
      onPitch: sample => {
        pitchValueRef.current = sample.frequency;
        levelRef.current = sample.level ?? 0;
        if (performance.now() - paintRef.current > 90) { setPitch(sample.frequency); paintRef.current = performance.now(); }
        if (sample.confidence > .78 && transportRef.current.isPlaying) pushTrail(trailRef.current, positionRef.current, sample.frequency);
      },
    });
    try { await engine.start(); pitchRef.current = engine; setMicReason(null); setMic('ready'); }
    catch (cause) { pitchRef.current = null; setMicReason(cause instanceof MicError ? cause.reason : 'unknown'); setMic('blocked'); }
  }

  async function togglePlay() {
    await ensureAudio();
    void startMic();
    const now = Date.now();
    if (transportRef.current.isPlaying) { transportRef.current.pause(now); setPlaying(false); }
    else { transportRef.current.play(now); setPlaying(true); }
  }

  function seekTo(next: number) {
    clearTrail(trailRef.current);
    transportRef.current.seek(next, Date.now());
    setPosition(next);
  }

  function applySpeed(rate: number) {
    transportRef.current.setRate(rate, Date.now());
    setSpeed(transportRef.current.currentRate);
  }

  function applyLoop(region: LoopRegion | null) {
    clearTrail(trailRef.current);
    transportRef.current.setLoop(region, Date.now());
    setLoopRegion(transportRef.current.loopRegion);
  }

  /** Loop the phrase the playhead is sitting in — the common case, one tap. */
  function loopThisPhrase() {
    applyLoop(phraseAround(myNotes, positionRef.current));
  }

  const target = myNotes.find(note => position >= note.start && position < note.end) ?? null;
  const feedback = livePitchFeedback(target?.midi ?? null, pitch);
  const colour = guide ? '#ff60bc' : COLOURS[part];
  const pct = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;

  return <div className="mx-auto flex h-[calc(100dvh-45px)] w-full max-w-6xl flex-col overflow-hidden px-2 py-2 sm:block sm:h-auto sm:overflow-visible sm:px-5 sm:py-5">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 sm:gap-3">
      <div>
        <p className="hidden text-[10px] font-black uppercase tracking-[.22em] text-emerald-300 sm:block">Practice · nothing is scored</p>
        <h1 className="max-w-[55vw] truncate text-sm font-semibold sm:max-w-none sm:text-xl">{song.title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setGuideAudio(!guideAudio)} className={`vh-outline-button ${guideAudio ? 'border-emerald-300/40 text-emerald-100' : 'text-slate-400'}`}>{guideAudio ? '♪ Guide on' : '♪ Guide off'}</button>
        <button onClick={onExit} className="vh-outline-button">← Back to library</button>
      </div>
    </div>

    {!guide && <div className="mt-2 flex shrink-0 gap-1.5 overflow-x-auto pb-1 sm:mt-4 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:pb-0">
      {VOICES.map((voice, index) => <button key={voice} onClick={() => { setPart(index); pitchRef.current?.stop(); pitchRef.current = null; setMic('unknown'); }}
        className="shrink-0 rounded-xl border px-3 py-1.5 text-xs font-semibold sm:px-4 sm:py-2 sm:text-sm"
        style={{ borderColor: index === part ? COLOURS[index] : '#ffffff20', background: index === part ? `${COLOURS[index]}18` : 'transparent', color: index === part ? COLOURS[index] : '#94a3b8' }}>{voice}</button>)}
    </div>}

    <div className="mt-1 shrink-0 sm:mt-4"><KaraokeLyrics song={song} notes={allNotes} partIndex={lanePart} elapsed={position} compact={narrow} /></div>
    <div className="mt-1 min-h-[120px] flex-1 sm:mt-4 sm:min-h-0 sm:flex-none"><CanvasLane partIndex={lanePart} partName={guide ? 'Melody guide' : VOICES[part]} colour={colour} notes={allNotes} getPosition={() => positionRef.current} getPitchHz={() => pitchValueRef.current} getLevel={() => levelRef.current} trail={trailRef.current} lookAheadSeconds={7} height={280} fill={narrow} /></div>

    {/* The scrubber doubles as the loop display: a singer should be able to see
        the region they are repeating, not just be inside it. */}
    <div className="mt-2 shrink-0 sm:mt-4">
      <div className="relative h-7 w-full overflow-hidden rounded-xl border border-white/10 bg-black/30 sm:h-9">
        {loop && duration > 0 && <div className="absolute inset-y-0 bg-emerald-300/20 ring-1 ring-inset ring-emerald-300/40"
          style={{ left: `${(loop.start / duration) * 100}%`, width: `${((loop.end - loop.start) / duration) * 100}%` }} />}
        <div className="absolute inset-y-0 w-[2px] bg-[#f6c65b] shadow-[0_0_10px_#f6c65b]" style={{ left: `${pct}%` }} />
        <input type="range" min={0} max={Math.max(0.1, duration)} step={0.05} value={position}
          onChange={event => seekTo(Number(event.target.value))}
          aria-label="Seek" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500"><span>{position.toFixed(1)}s</span>{loop && <span className="text-emerald-300">looping {loop.start.toFixed(1)}–{loop.end.toFixed(1)}s</span>}<span>{duration.toFixed(0)}s</span></div>
    </div>

    <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2 sm:mt-4 sm:gap-3">
      <button onClick={() => void togglePlay()} className="vh-primary-button px-4 py-2 sm:px-6 sm:py-3 sm:text-base">{playing ? 'Ⅱ Pause' : '▶ Play'}</button>
      <button onClick={() => seekTo(Math.max(0, positionRef.current - 4))} className="vh-outline-button">↺ <span className="hidden sm:inline">Back </span>4s</button>
      <button onClick={loopThisPhrase} className="vh-outline-button border-emerald-300/40 text-emerald-100">⟲ Loop<span className="hidden sm:inline"> this phrase</span></button>
      {loop && <button onClick={() => applyLoop(null)} className="vh-outline-button">Clear loop</button>}
      <button onClick={() => setShowTools(!showTools)} className="vh-outline-button sm:hidden">⚙ {showTools ? 'Hide' : 'Speed & key'}</button><span className="text-xs text-slate-500">{mic === 'ready' ? '● mic live' : mic === 'blocked' ? '● mic blocked' : mic === 'checking' ? '● checking mic' : '○ mic starts with play'}</span>{mic === 'blocked' && micReason && <p className="mt-2 rounded-xl border border-amber-400/30 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-100">{micReason === 'insecure' ? 'This page is not on HTTPS, so the browser will not hand out a microphone.' : micReason === 'unsupported' ? (standalone ? 'This installed app window offers no microphone API. Open the app in your browser instead.' : 'This browser offers no microphone API.') : micReason === 'notfound' ? 'No microphone was offered by this device.' : micReason === 'busy' ? 'Another app is holding the microphone — close any call or recorder and press play again.' : standalone ? 'The installed app was refused the microphone. It keeps a separate permission from your browser, so allowing it in Chrome does not cover this window.' : 'Permission was refused. Allow the microphone for this site, then reload.'}</p>}
    </div>

    <div className={(showTools ? 'grid' : 'hidden') + ' mt-2 shrink-0 grid-cols-1 gap-2 sm:mt-4 sm:grid sm:grid-cols-2 sm:gap-4'}>
      <div className="vh-panel p-4">
        <p className="text-[10px] uppercase tracking-[.18em] text-slate-500">Speed</p>
        <div className="mt-2 flex flex-wrap gap-2">{SPEEDS.map(rate => <button key={rate} onClick={() => applySpeed(rate)}
          className={`rounded-lg border px-3 py-2 text-sm ${Math.abs(speed - rate) < 0.001 ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-100' : 'border-white/10 text-slate-300'}`}>{Math.round(rate * 100)}%</button>)}</div>
        <p className="mt-2 text-[10px] text-slate-500">The notes keep their pitch — only the clock slows.</p>
      </div>
      <div className="vh-panel p-4">
        <p className="text-[10px] uppercase tracking-[.18em] text-slate-500">Key</p>
        <div className="mt-2 flex items-center gap-2">
          <button onClick={() => setTranspose(Math.max(-6, transpose - 1))} className="vh-outline-button">−</button>
          <b className="min-w-16 text-center text-lg">{transpose === 0 ? 'Written' : (transpose > 0 ? '+' : '') + transpose}</b>
          <button onClick={() => setTranspose(Math.min(6, transpose + 1))} className="vh-outline-button">+</button>
          {transpose !== 0 && <button onClick={() => setTranspose(0)} className="vh-outline-button">Reset</button>}
        </div>
        <p className="mt-2 text-[10px] text-slate-500">Shifts the whole part, so a line that sits too high becomes singable.</p>
      </div>
    </div>

    <section className="vh-panel mt-2 flex shrink-0 items-center justify-between p-2 sm:mt-4 sm:p-4">
      <div><p className="text-[10px] uppercase tracking-wider text-slate-500">You sang</p><b className="text-lg text-cyan-200 sm:text-3xl">{feedback.detected}</b></div>
      <div className="px-2 text-center"><p className={`text-sm font-black ${feedback.state === 'correct' ? 'text-emerald-300' : feedback.state === 'high' || feedback.state === 'low' || feedback.state === 'octave' ? 'text-amber-300' : 'text-slate-400'}`}>{feedback.label}</p><small className="hidden text-[10px] text-slate-500 sm:block">{feedback.difference}</small></div>
      <div className="text-right"><p className="text-[10px] uppercase tracking-wider text-slate-500">Target</p><b className="text-lg text-white sm:text-3xl">{feedback.target}</b></div>
    </section>
  </div>;
}
