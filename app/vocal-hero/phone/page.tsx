'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { fetchPlayers, fetchSectionScores, fetchSessionByCode, fetchSong, joinSession, resumePlayer, savePlayerRoundStats, subscribeToSession, touchPlayer, updatePlayerLobbyState } from '@/lib/vocal-hero/supabaseClient';
import { PitchEngine } from '@/lib/vocal-hero/pitchEngine';
import { ScoreEngine } from '@/lib/vocal-hero/scoreEngine';
import type { Difficulty, NoteScoreResult } from '@/lib/vocal-hero/scoreEngine';
import { DifficultyPicker, rememberDifficulty, storedDifficulty } from '../DifficultyPicker';
import { LatencyRow } from '../LatencyCalibration';
import { storedLatencySec } from '@/lib/vocal-hero/latency';
import type { GameSession, SectionScore, SessionPlayer, Song, SongNote } from '@/lib/vocal-hero/types';
import { clearTrail, pushTrail } from '@/lib/vocal-hero/trail';
import type { TrailSample } from '@/lib/vocal-hero/trail';
import { RoundReviewPanel } from '../RoundReview';
import { HighScoreBoard } from '../HighScoreBoard';
import { CountInOverlay } from '../CountInOverlay';
import { CanvasLane } from '../CanvasLane';
import { rememberPlayerName, storedPlayerName } from '../playerName';
import { HEARTBEAT_MS, forgetPlayerId, rememberPlayerId, storedPlayerId } from '@/lib/vocal-hero/presence';
import { playEntranceCue } from '@/lib/vocal-hero/cueTones';
import { GuidePlayer, rememberGuideAudio, storedGuideAudio } from '@/lib/vocal-hero/guideTones';
import { useWakeLock } from '@/lib/vocal-hero/useWakeLock';
import { summariseRound } from '@/lib/vocal-hero/review';
import type { RoundReview } from '@/lib/vocal-hero/review';
import { TransposeBadge, TransposePicker, rememberTranspose, storedTranspose, transposeNotes } from '../TransposePicker';
import { WarmUpBadge, WarmUpToggle } from '../WarmUpToggle';
import { isGuideMelody, playableNotes, playablePart } from '@/lib/vocal-hero/songData';
import { measureServerClockOffset } from '@/lib/vocal-hero/clock';
import { detectionRange, livePitchFeedback } from '@/lib/vocal-hero/liveCues';
import { KaraokeLyrics } from '../KaraokeLyrics';

const VOICES = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#ff60bc', '#a965ff', '#22d3ee', '#ffbd45'];


export default function PhonePage() { return <Suspense fallback={<main className="min-h-screen bg-[#030611]" />}><PhoneGame /></Suspense>; }

function PhoneGame() {
  const params = useSearchParams();
  const [room, setRoom] = useState((params.get('room') ?? '').toUpperCase());
  const [name, setName] = useState(''); const [partIndex, setPartIndex] = useState(0);
  // Prefill the nickname typed on this device last time; never overwrite
  // something already being typed.
  useEffect(() => { setName(current => current || storedPlayerName()); }, []);
  const [session, setSession] = useState<GameSession | null>(null); const [song, setSong] = useState<Song | null>(null); const [player, setPlayer] = useState<SessionPlayer | null>(null);
  const [players, setPlayers] = useState<SessionPlayer[]>([]); const [sections, setSections] = useState<SectionScore[]>([]); const [error, setError] = useState('');
  const [mic, setMic] = useState<'unknown' | 'checking' | 'ready' | 'blocked'>('unknown'); const [now, setNow] = useState(Date.now()); const [clockOffset, setClockOffset] = useState(0);
  const [pitch, setPitch] = useState(0);
  // Loudness, separate from pitch. A singer whose voice is arriving but not
  // yet locking a note is in a different situation from one whose microphone
  // delivers nothing at all, and until now the two looked identical.
  const [level, setLevel] = useState(0);
  const [audioBlocked, setAudioBlocked] = useState(false);
  // What the microphone is actually delivering on THIS device. Pitch detection
  // failing on a phone is otherwise impossible to tell apart from a singer
  // being quiet, and the numbers that distinguish them are all hidden inside
  // the engine.
  const [diag, setDiag] = useState({ hz: 0, level: 0, confidence: 0, rate: 0 }); const [score, setScore] = useState(0); const [hits, setHits] = useState<Record<string, boolean>>({}); const [fullBoard, setFullBoard] = useState(false); const [pausedElapsed, setPausedElapsed] = useState(0);
  const [difficulty, setDifficultyState] = useState<Difficulty>('medium');
  // Read after mount so the server-rendered markup and the first client render
  // agree; localStorage does not exist during prerender.
  useEffect(() => { setDifficultyState(storedDifficulty()); }, []);
  // The delay between the singer hearing a beat and this device analysing the
  // note they sang to it. Read after mount, for the same reason as difficulty.
  const [latencySec, setLatencySec] = useState(0);
  const latencyRef = useRef(0);
  useEffect(() => { const stored = storedLatencySec(); setLatencySec(stored); latencyRef.current = stored; }, []);
  function applyLatency(seconds: number) { setLatencySec(seconds); latencyRef.current = seconds; }
  // What the singer actually sang, in song time, for the lane to draw behind
  // the strike line. Mutated in a ref rather than held in state: the lane
  // re-renders from the clock every frame anyway, and routing each microphone
  // sample through state would re-render the page 60 times a second.
  const trailRef = useRef<TrailSample[]>([]);
  /* The reference tone before the entrance used to build its own AudioContext
     inside an effect, with no user gesture anywhere near it. Mobile Safari
     starts such a context suspended and it makes no sound at all, so the one
     moment a singer is handed their starting pitch was silent on iPhones.
     This one is created and resumed on the ready tap and kept for the round. */
  const cueContextRef = useRef<AudioContext | null>(null);
  const pitchValueRef = useRef(0);
  // As on the host: the written line, before any transpose.
  const notesRef = useRef<SongNote[]>([]);
  const clockInputsRef = useRef({ session: null as GameSession | null, clockOffset: 0, paused: false, pausedElapsed: 0 });
  // This singer's own line, sounded in their ear. OFF by default: in a room
  // full of phones each playing a different part, the guide stops being
  // accompaniment and becomes noise. Practising alone with headphones is
  // exactly when it earns its place, so the switch is one tap away.
  const [guideAudio, setGuideAudioState] = useState(false);
  useEffect(() => { setGuideAudioState(storedGuideAudio(false)); }, []);
  function setGuideAudio(on: boolean) { setGuideAudioState(on); rememberGuideAudio(on); }
  // Every note's result, kept so the end of the round can say something
  // more useful than one number. Collected in a ref for the same reason as
  // the trail: nothing renders from it until the song is over.
  const resultsRef = useRef<NoteScoreResult[]>([]);
  const [review, setReview] = useState<RoundReview | null>(null);
  // Shifts this singer's targets only. Held in a ref as well because the
  // pitch engine is built once with a frequency range that has to match the
  // shifted line.
  const [transpose, setTransposeState] = useState(0);
  const transposeRef = useRef(0);
  useEffect(() => { const stored = storedTranspose(); setTransposeState(stored); transposeRef.current = stored; }, []);
  function setTranspose(next: number) { setTransposeState(next); transposeRef.current = next; rememberTranspose(next); }
  // Not remembered between sessions: silently discarding a real round would
  // be far worse than having to switch this on each time.
  const [warmUp, setWarmUp] = useState(false);
  const warmUpRef = useRef(false);
  useEffect(() => { warmUpRef.current = warmUp; }, [warmUp]);
  function setDifficulty(next: Difficulty) { setDifficultyState(next); rememberDifficulty(next); }
  const pitchRef = useRef<PitchEngine | null>(null); const scoreRef = useRef<ScoreEngine | null>(null); const unsubRef = useRef<(() => void) | null>(null); const startedRef = useRef(false); const elapsedRef = useRef(0); const phaseRef = useRef('Waiting'); const lastPitchPaintRef = useRef(0); const cuedRef = useRef({ outer: false, inner: false });
  useEffect(() => () => { pitchRef.current?.stop(); void scoreRef.current?.stop(); unsubRef.current?.(); void cueContextRef.current?.close().catch(() => undefined); }, []);
  // "Still here." Also sent the moment the tab comes back, so someone who
  // glanced at a notification is not shown as missing for another quarter
  // minute.
  useEffect(() => {
    if (!player) return;
    const beat = () => { void touchPlayer(player.id).catch(() => undefined); };
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') beat(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [player?.id]);
  useEffect(() => { if (!session) return; const interval = window.setInterval(() => { setNow(Date.now()); void fetchPlayers(session.id).then(setPlayers); void fetchSectionScores(session.id).then(setSections).catch(() => setSections([])); }, 900); return () => clearInterval(interval); }, [session]);
  useEffect(() => {
    if (session?.status !== 'playing') return;
    let frame = 0, lastPaint = 0;
    const tick = () => {
      const at = Date.now();
      const inputs = clockInputsRef.current;
      const live = timelineFor(inputs.session, at + inputs.clockOffset);
      // Frame-accurate for scoring and for the canvas; the phone used to run
      // these at 30fps because the whole page re-rendered with them.
      elapsedRef.current = inputs.paused ? inputs.pausedElapsed : live.songElapsed;
      phaseRef.current = inputs.paused ? 'Paused' : live.phase;
      if (at - lastPaint > 60) { lastPaint = at; setNow(at); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [session?.status]);
  const runningTimeline = timelineFor(session, now + clockOffset); const timeline = session?.paused ? { phase: 'Paused', songElapsed: pausedElapsed } : runningTimeline; const notes = useMemo(() => transposeNotes(song ? playableNotes(song) : [], transpose), [song, transpose]); notesRef.current = song ? playableNotes(song) : []; const part = song ? playablePart(song, partIndex) : null;
  useEffect(() => { if (session?.paused) setPausedElapsed(runningTimeline.songElapsed); }, [session?.paused]);
  clockInputsRef.current = { session, clockOffset, paused: Boolean(session?.paused), pausedElapsed };
  // Only while no round is running: during one the animation loop owns these.
  useEffect(() => { if (session?.status === 'playing') return; elapsedRef.current = timeline.songElapsed; phaseRef.current = timeline.phase; }, [session?.status, timeline.phase, timeline.songElapsed]);
  /* A restarted round arrives as a new playback_starts_at on the same session.
     Everything per-round has to reset with it: the old scorer belongs to the
     round that created it, the collected results would stack into the next
     review, and the cue guard would silence the second entrance tone. The
     first key seen after joining is recorded without clearing anything --
     that state is already fresh. */
  const roundKeyRef = useRef<string | null>(null);
  const endedSeenRef = useRef(false);
  useEffect(() => { if (session?.status === 'ended') endedSeenRef.current = true; }, [session?.status]);
  useEffect(() => {
    const key = session?.playback_starts_at ?? null;
    if (!key || roundKeyRef.current === key) return;
    const firstRound = roundKeyRef.current === null;
    roundKeyRef.current = key;
    if (firstRound) return;
    /* A RESUME also moves playback_starts_at -- forward by the length of the
       pause, which leaves it still in the PAST while the song plays on. A
       freshly scheduled round lies in the FUTURE. Wiping on any change meant
       one pause erased the first half of the round: the fresh scorer resolved
       every pre-pause note as a miss and a perfect singer was told to drill
       their entrances. Only a genuinely new round may wipe. The ended flag
       covers a restart whose update reached a backgrounded phone late enough
       that its start already lay in the past -- a resume never passes through
       'ended', a restart always does. */
    const startsAhead = new Date(key).getTime() > Date.now() + clockOffset;
    if (!startsAhead && !endedSeenRef.current) return;
    endedSeenRef.current = false;
    void scoreRef.current?.stop(); scoreRef.current = null; startedRef.current = false;
    resultsRef.current = []; setReview(null); clearTrail(trailRef.current);
    setScore(0); setHits({}); cuedRef.current = { outer: false, inner: false };
  }, [clockOffset, session?.playback_starts_at, session?.status]);

  async function startPitchTracking() { if (pitchRef.current?.isRunning) return true; const shift = transposeRef.current; const engine = new PitchEngine({ bufferSize: 2048, confidenceThreshold: .76, smoothing: .22, minHz: PitchEngine.midiToHz(detectionRange(partIndex, shift, notesRef.current).minMidi), maxHz: PitchEngine.midiToHz(detectionRange(partIndex, shift, notesRef.current).maxMidi), onPitch: sample => { pitchValueRef.current = sample.frequency; if (performance.now() - lastPitchPaintRef.current > 90) { setPitch(sample.frequency); setLevel(sample.level ?? 0); setDiag({ hz: sample.frequency, level: sample.level ?? 0, confidence: sample.confidence, rate: pitchRef.current?.sampleRate ?? 0 }); lastPitchPaintRef.current = performance.now(); } // This sample is the sound of a moment already past: the beat took time to
      // reach the singer's ears, and their answer took time to reach the analyser.
      // Scoring it against the clock as it stands now would mark every note late.
      if (phaseRef.current === 'live' && sample.confidence > .78) { const songTime = Math.max(0, elapsedRef.current - latencyRef.current); scoreRef.current?.scorePitch(sample.frequency, songTime); pushTrail(trailRef.current, songTime, sample.frequency); } } }); pitchRef.current = engine; try { await engine.start(); setAudioBlocked(engine.isSuspended); setMic('ready'); return true; } catch { pitchRef.current = null; setMic('blocked'); return false; } }
  // The starting notes, sounded once in each countdown: once while the round is
  // being scheduled, and again once the in-game count begins. Two hearings
  // spaced apart beat one, because the first tells the singer what is coming and
  // the second refreshes it right before they have to produce it.
  //
  // The phase strings tick every second ('Starts in 5', 'Starts in 4'), so the
  // effect re-runs throughout; the per-round flags are what keep each countdown
  // to a single playing.
  useEffect(() => {
    if (!song) return;
    const outer = timeline.phase.startsWith('Starts in'), inner = timeline.phase.startsWith('Count-in');
    if (!outer && !inner) return;
    if (outer ? cuedRef.current.outer : cuedRef.current.inner) return;
    if (outer) cuedRef.current.outer = true; else cuedRef.current.inner = true;
    const context = cueContextRef.current ?? new AudioContext({ latencyHint: 'interactive' });
    playEntranceCue(context, notes, partIndex);
    if (context !== cueContextRef.current) window.setTimeout(() => void context.close(), 1800);
  }, [notes, partIndex, song, timeline.phase]);
  // A singer holds the phone up and never touches it: exactly what a screen
  // timeout punishes. Held from the lobby onward so it covers the countdown too.
  useWakeLock(Boolean(session) && session?.status !== 'ended');
  // The singer's own part, scheduled against the audio clock so a slow frame
  // never puts it out of time. Silenced while paused.
  useEffect(() => {
    if (!guideAudio || !song || session?.status !== 'playing') return;
    const context = cueContextRef.current;
    if (!context) return;
    const mine = notes.filter(note => note.part === partIndex || note.part === -1);
    const guidePlayer = new GuidePlayer(context, .7);
    const timer = window.setInterval(() => {
      if (session?.paused) { guidePlayer.reset(); return; }
      if (phaseRef.current !== 'live') return;
      guidePlayer.update(mine, elapsedRef.current);
    }, 60);
    return () => { window.clearInterval(timer); guidePlayer.dispose(); };
  }, [guideAudio, notes, partIndex, session?.paused, session?.playback_starts_at, session?.status, song]);

  useEffect(() => { if (!session || !song || !player || !part || session.status !== 'playing' || startedRef.current) return; startedRef.current = true; const scorer = new ScoreEngine({ part, partIndex, notes, songDuration: song.duration, playerId: player.id, sessionId: session.id, difficulty, practice: warmUp, onScoreUpdate: (_, total) => setScore(total), onNoteResult: result => { resultsRef.current.push(result); setHits(current => ({ ...current, [result.noteId]: result.points > 0 })); } }); scoreRef.current = scorer; scorer.start(); void startPitchTracking(); }, [difficulty, notes, part, partIndex, player, session, song]);
  useEffect(() => { if (session?.status !== 'playing' || !player) return; const interval = setInterval(() => { const stats = scoreRef.current?.stats; if (stats && !warmUpRef.current) void savePlayerRoundStats({ session_id: session.id, player_id: player.id, score: scoreRef.current?.currentTotal ?? 0, accuracy: stats.accuracy, notes_attempted: stats.attempted, notes_hit: stats.hit }); }, 3000); return () => clearInterval(interval); }, [player, session?.id, session?.status]);
  useEffect(() => { if (session?.status !== 'ended' || !player || !scoreRef.current) return; pitchRef.current?.stop(); setReview(summariseRound(resultsRef.current, notes)); const scorer = scoreRef.current; /* stop() resolves the note still in progress, so both the total and the counts change during it: reading either beforehand loses the last note of every round. The phone was also saving the score STATE, which lags the engine by a render, while the host saved the engine's own total — so the two disagreed. */ void scorer.stop().then(() => { if (warmUpRef.current) return; const stats = scorer.stats; void savePlayerRoundStats({ session_id: session.id, player_id: player.id, score: scorer.currentTotal, accuracy: stats.accuracy, notes_attempted: stats.attempted, notes_hit: stats.hit }); }); }, [player, session?.status]);
  async function join(event: React.FormEvent) { event.preventDefault(); if (!room || !name.trim()) { setError('Enter your room code and name.'); return; } try { const next = await fetchSessionByCode(room); if (!next || next.status === 'ended') throw new Error('That room is unavailable.'); const nextSong = await fetchSong(next.song_id); if (!nextSong) throw new Error('Song not found.'); // Take back this device's existing seat if it still exists, rather than
        // sitting down twice: a reload used to leave the first singer stranded in
        // the lobby and start the newcomer on zero.
        const remembered = storedPlayerId(room);
        const resumed = remembered ? await resumePlayer(next.id, remembered) : null;
        const nextPlayer = resumed ?? await joinSession(next.id, name.trim(), partIndex);
        if (!resumed) rememberPlayerId(room, nextPlayer.id); else setPartIndex(nextPlayer.part_index); rememberPlayerName(name); setClockOffset(await measureServerClockOffset().catch(() => 0)); unsubRef.current?.(); roundKeyRef.current = null; unsubRef.current = subscribeToSession(next.id, setSession); clearTrail(trailRef.current); resultsRef.current = []; setReview(null); setSession(next); setSong(nextSong); setPlayer(nextPlayer); setPlayers(await fetchPlayers(next.id)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to join.'); } }
  async function testMic() { if (!player) return; setMic('checking'); await startPitchTracking(); await updatePlayerLobbyState(player.id, { ready_at: player.ready_at ?? null, mic_status: pitchRef.current?.isRunning ? 'ready' : 'blocked' }); }
  // Tapping ready is the last user gesture before the song starts, and the
  // only one that reliably happens. The microphone is claimed HERE rather than
  // at the downbeat: asking then put the browser's permission dialog over the
  // screen exactly as the song began, and the singer lost the opening bars to
  // it. The start-of-song call stays as a fallback and is a no-op once the
  // engine is already running.
  async function readyUp() {
    if (!player) return;
    const goingReady = !player.ready_at;
    let micState: typeof mic = mic;
    if (goingReady && !pitchRef.current?.isRunning) {
      setMic('checking');
      micState = await startPitchTracking() ? 'ready' : 'blocked';
      try {
        cueContextRef.current ??= new AudioContext({ latencyHint: 'interactive' });
        if (cueContextRef.current.state === 'suspended') await cueContextRef.current.resume();
      } catch { /* no audio output available; the cue simply will not sound */ }
      setError(micState === 'blocked'
        ? 'Microphone blocked — allow it in your browser settings and tap ready again. You can still follow the words and notes without scoring.'
        : '');
    }
    const readyAt = goingReady ? new Date().toISOString() : null;
    await updatePlayerLobbyState(player.id, { ready_at: readyAt, mic_status: micState === 'ready' ? 'ready' : micState === 'blocked' ? 'blocked' : 'unknown' });
    setPlayer({ ...player, ready_at: readyAt });
  }
  if (!session) return <Join room={room} setRoom={setRoom} name={name} setName={setName} part={partIndex} setPart={setPartIndex} error={error} join={join} />;
  if (session.status === 'lobby') return <PhoneLobby song={song!} code={session.room_code} part={partIndex} players={players} player={player} mic={mic} testMic={testMic} ready={readyUp} error={error} difficulty={difficulty} setDifficulty={setDifficulty} latencySec={latencySec} applyLatency={applyLatency} transpose={transpose} setTranspose={setTranspose} hasBackingTrack={!!(song?.audio_url || song?.backing_media_url)} warmUp={warmUp} setWarmUp={setWarmUp} level={level} diag={diag} audioBlocked={audioBlocked} onResume={() => { void pitchRef.current?.resume().then(() => setAudioBlocked(Boolean(pitchRef.current?.isSuspended))); }} />;
  if (session.status === 'ended') return <PhoneEnd song={song!} playerName={name} score={score} sections={sections} part={partIndex} review={review} warmUp={warmUp} />;
  if (timeline.phase === 'Paused') return <PhonePaused song={song!} part={partIndex} />;
  const preRoll = timeline.phase.startsWith('Count-in') || timeline.phase.startsWith('Lead-in');
  if (timeline.phase !== 'live' && !preRoll) return <PhoneCountdown song={song!} part={partIndex} phase={timeline.phase} mic={mic} />;
  return <><PhoneLive song={song!} notes={notes} transpose={transpose} warmUp={warmUp} guide={isGuideMelody(notes)} part={partIndex} elapsed={timeline.songElapsed} pitch={pitch} score={score} hits={hits} sections={sections} mic={mic} fullBoard={fullBoard} setFullBoard={setFullBoard} trail={trailRef.current} guideAudio={guideAudio} setGuideAudio={setGuideAudio} getElapsed={() => elapsedRef.current} getPitch={() => pitchValueRef.current} level={level} />{preRoll && <CountInOverlay phase={timeline.phase} />}</>;
}

function PhoneBrand() { return <b className="text-xl">VOCAL<span className="text-fuchsia-400">Hero</span></b>; }
/**
 * Padding is the larger of the design value and the phone's own safe area, so a
 * notch or a home indicator pushes the content clear without adding a gap on
 * the flat-screened phones that report zero. `min-h-screen` is dropped in favour
 * of the dvh height on .vh-app, which follows the browser bars as they retract.
 */
function PhoneShell({ children }: { children: React.ReactNode }) {
  return <main
    className="vh-app text-slate-100"
    style={{
      paddingLeft: 'max(1rem, env(safe-area-inset-left))',
      paddingRight: 'max(1rem, env(safe-area-inset-right))',
      paddingTop: 'max(1.25rem, env(safe-area-inset-top))',
      paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
    }}
  >
    <header className="flex items-center justify-between border-b border-white/10 pb-4"><span className="text-slate-400">☰</span><PhoneBrand /><span className="text-slate-400">?</span></header>
    {children}
  </main>;
}
function Join({ room, setRoom, name, setName, part, setPart, error, join }: { room: string; setRoom: (v: string) => void; name: string; setName: (v: string) => void; part: number; setPart: (v: number) => void; error: string; join: (event: React.FormEvent) => void }) { return <PhoneShell><form onSubmit={join} className="mx-auto mt-10 max-w-md vh-panel p-5"><p className="text-center text-xs tracking-[.2em] text-fuchsia-300">JOIN LOBBY</p><h1 className="mt-3 text-center text-3xl font-black">Sing your part.</h1><label className="mt-6 block text-xs text-slate-400">Room code<input value={room} onChange={e => setRoom(e.target.value.toUpperCase())} maxLength={5} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-center font-mono text-2xl tracking-[.25em]" /></label><label className="mt-4 block text-xs text-slate-400">Nickname<input value={name} onChange={e => setName(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-base" /></label><p className="mt-5 text-xs tracking-[.15em] text-slate-400">CHOOSE YOUR PART</p><div className="mt-2 grid grid-cols-2 gap-2">{VOICES.map((voice, index) => <button type="button" key={voice} onClick={() => setPart(index)} className="rounded-xl border p-3 text-left" style={{ borderColor: part === index ? COLOURS[index] : '#ffffff18', background: part === index ? `${COLOURS[index]}18` : '#07111d' }}><b className="text-2xl" style={{ color: COLOURS[index] }}>{voice[0]}</b><span className="ml-2 text-sm">{voice}</span></button>)}</div>{error && <p className="mt-4 text-sm text-rose-300">{error}</p>}<button className="vh-start-button mt-6 w-full">JOIN LOBBY</button></form></PhoneShell>; }
function PhoneLobby({ song, code, part, players, player, mic, testMic, ready, error, difficulty, setDifficulty, latencySec, applyLatency, transpose, setTranspose, hasBackingTrack, warmUp, setWarmUp, level, audioBlocked, onResume, diag }: { song: Song; code: string; part: number; players: SessionPlayer[]; player: SessionPlayer | null; mic: string; testMic: () => void; ready: () => void; error: string; difficulty: Difficulty; setDifficulty: (next: Difficulty) => void; latencySec: number; applyLatency: (seconds: number) => void; transpose: number; setTranspose: (next: number) => void; hasBackingTrack: boolean; warmUp: boolean; setWarmUp: (next: boolean) => void; level: number; audioBlocked: boolean; onResume: () => void; diag: { hz: number; level: number; confidence: number; rate: number } }) { return <PhoneShell><div className="mt-5 text-center"><p className="text-sm text-slate-300">{song.title}</p><p className="mt-1 text-xs text-slate-500">{song.artist || 'Vocal Hero arrangement'}</p><p className="mt-4 text-xs text-slate-400">ROOM CODE</p><p className="font-mono text-3xl font-bold tracking-[.25em] text-[#ffd15c]">{code}</p></div><p className="mt-7 text-center text-xs tracking-[.18em] text-slate-400">CHOOSE YOUR PART</p><div className="mt-3 grid grid-cols-2 gap-2">{VOICES.map((voice, index) => <div key={voice} className="rounded-xl border p-3" style={{ borderColor: index === part ? COLOURS[index] : '#ffffff16', background: index === part ? `${COLOURS[index]}14` : '#07111d' }}><b style={{ color: COLOURS[index] }}>{voice[0]} <span className="ml-1 text-sm">{voice}</span></b><p className="mt-2 text-xs text-slate-400">{players.filter(item => item.part_index === index).length} players</p></div>)}</div><div className="mt-5"><DifficultyPicker value={difficulty} onChange={setDifficulty} colour={COLOURS[part]} /></div><div className="mt-5"><LatencyRow colour={COLOURS[part]} latencySec={latencySec} onChange={applyLatency} /></div><div className="mt-5"><TransposePicker value={transpose} onChange={setTranspose} colour={COLOURS[part]} hasBackingTrack={hasBackingTrack} /></div><div className="mt-5"><WarmUpToggle value={warmUp} onChange={setWarmUp} colour={COLOURS[part]} /></div><div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-xs text-slate-400">MIC CHECK</p><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${Math.min(100, Math.round(level * 400))}%` }} /></div><p className="mt-1 text-[10px] text-slate-500">{level > 0.002 ? 'Sound is reaching the app — sing and watch the bar move.' : 'Say something. If the bar stays flat, no audio is arriving.'}</p><div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-white/10 pt-2 font-mono text-[10px] text-slate-500"><span>note</span><b className={diag.hz > 0 ? 'text-emerald-300' : 'text-slate-600'}>{diag.hz > 0 ? PitchEngine.toNoteName(diag.hz) + '  ' + diag.hz.toFixed(1) + ' Hz' : '—'}</b><span>level</span><b className={diag.level > 0.002 ? 'text-emerald-300' : 'text-slate-600'}>{diag.level.toFixed(4)}</b><span>confidence</span><b>{diag.confidence.toFixed(2)}</b><span>sample rate</span><b>{diag.rate ? (diag.rate / 1000).toFixed(1) + ' kHz' : '—'}</b><span>audio</span><b className={audioBlocked ? 'text-amber-300' : 'text-emerald-300'}>{audioBlocked ? 'PAUSED by browser' : mic === 'ready' ? 'running' : 'not started'}</b></div><button onClick={testMic} className={`mt-2 text-sm ${mic === 'blocked' ? 'text-rose-300' : 'text-emerald-300'}`}>● {mic === 'ready' ? 'Microphone detected' : mic === 'blocked' ? 'Microphone blocked — tap to retry' : mic === 'checking' ? 'Checking…' : 'Test microphone'}</button></div>{audioBlocked && <button onClick={onResume} className="mt-3 w-full rounded-xl border border-amber-400/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-100">This browser has paused audio input — tap to switch it back on.</button>}{error && <p className="mt-3 rounded-xl border border-rose-400/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">{error}</p>}<button onClick={ready} className="vh-start-button mt-5 w-full">✓ {player?.ready_at ? 'I’M READY' : 'TAP WHEN READY'}</button><p className="mt-2 text-center text-[10px] text-slate-500">Tapping ready asks for the microphone now, so the permission prompt cannot land on the downbeat.</p></PhoneShell>; }
function PhoneCountdown({ song, part, phase, mic }: { song: Song; part: number; phase: string; mic: string }) { const number = Number(phase.match(/(\d+)/)?.[1] ?? 0); return <PhoneShell><p className="mt-6 text-center text-sm">{song.title}</p><p className="mt-2 text-center text-xs text-slate-400">YOUR PART</p><h1 className="text-center text-2xl font-black" style={{ color: COLOURS[part] }}>{VOICES[part].toUpperCase()} {VOICES[part][0]}</h1><div className="mx-auto mt-12 grid h-60 w-60 place-items-center rounded-full border-2 border-fuchsia-400 bg-fuchsia-400/[.08] shadow-[0_0_55px_#ec4899]"><div className="text-center"><p className="text-8xl font-black text-fuchsia-300">{number || '•'}</p><p className="mt-2 text-sm tracking-[.2em] text-fuchsia-200">GET READY</p></div></div><div className="mt-12 text-center"><p className="text-4xl text-fuchsia-300">◉</p><p className="mt-2 text-sm text-emerald-300">{mic === 'ready' ? 'READY' : 'MIC CHECK'}</p></div><p className="mt-7 text-center text-sm text-slate-300">◉ Eyes on your part <span className="mx-2 text-slate-600">|</span> ≋ Breathe in</p></PhoneShell>; }
function PhonePaused({ song, part }: { song: Song; part: number }) { return <PhoneShell><div className="mx-auto mt-20 max-w-sm text-center"><p className="text-xs font-black uppercase tracking-[.24em] text-cyan-300">Session paused</p><h1 className="mt-4 text-4xl font-black">Take a breath.</h1><p className="mt-3 text-slate-400">{song.title} will resume on every device when the host continues.</p><div className="mx-auto mt-10 grid h-28 w-28 place-items-center rounded-full border border-fuchsia-300/40 bg-fuchsia-300/10 text-5xl" style={{ color: COLOURS[part] }}>Ⅱ</div></div></PhoneShell>; }
function PhoneLive({ song, notes, transpose, warmUp, guide, part, elapsed, pitch, score, hits, sections, mic, fullBoard, setFullBoard, trail, guideAudio, setGuideAudio, getElapsed, getPitch, level }: { song: Song; notes: SongNote[]; transpose: number; warmUp: boolean; guide: boolean; part: number; elapsed: number; pitch: number; score: number; hits: Record<string, boolean>; sections: SectionScore[]; mic: string; fullBoard: boolean; setFullBoard: (value: boolean) => void; trail: TrailSample[]; guideAudio: boolean; setGuideAudio: (on: boolean) => void; getElapsed: () => number; getPitch: () => number; level: number }) {
  const lanePart = guide ? -1 : part;
  const active = notes.find(note => (note.part === lanePart || note.part === -1) && elapsed >= note.start && elapsed < note.end);
  const feedback = livePitchFeedback(active?.midi ?? null, pitch);
  const team = sections.find(section => section.part_index === part);
  return <PhoneShell><div className="mt-5 flex items-center justify-between"><div><p className="text-xs text-slate-400">{song.title}</p><b style={{ color: COLOURS[part] }}>{VOICES[part].toUpperCase()} TEAM</b><div className="mt-1 flex flex-wrap gap-1"><WarmUpBadge active={warmUp} /><TransposeBadge semitones={transpose} colour={COLOURS[part]} /></div></div><div className="text-right"><p className="text-3xl font-black text-fuchsia-300">{score.toLocaleString()}</p><p className="text-[10px] tracking-[.16em] text-slate-500">PERSONAL SCORE</p></div></div><div className="mt-5"><KaraokeLyrics song={song} notes={notes} partIndex={lanePart} elapsed={elapsed} compact /></div><div className="mt-4"><CanvasLane partIndex={lanePart} partName={guide ? 'Melody guide' : VOICES[part]} colour={guide ? '#ff60bc' : COLOURS[part]} getPosition={getElapsed} notes={notes} getPitchHz={getPitch} getLevel={() => level} hitNotes={hits} lookAheadSeconds={4} showLyrics={false} trail={trail} height={210} /></div><section className="vh-panel mt-4 p-4"><div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-wider text-slate-500">You sang</p><b className="text-3xl text-cyan-200">{feedback.detected}</b><p className={`mt-0.5 text-[10px] font-bold ${pitch > 0 ? 'text-emerald-300' : level > 0.01 ? 'text-amber-300' : 'text-slate-600'}`}>{pitch > 0 ? '● hearing you' : level > 0.01 ? '● sound, no note yet' : mic === 'ready' ? '○ no sound reaching the app' : '○ mic not ready'}</p></div><div className="px-2 text-center"><p className={`text-sm font-black ${feedback.state === 'correct' ? 'text-emerald-300' : feedback.state === 'high' || feedback.state === 'low' || feedback.state === 'octave' ? 'text-amber-300' : 'text-slate-400'}`}>{feedback.label}</p><small className="block text-[10px] text-slate-500">{feedback.difference}</small></div><div className="text-right"><p className="text-[10px] uppercase tracking-wider text-slate-500">Target</p><b className="text-3xl text-white">{feedback.target}</b></div></div></section><div className="mt-4 grid grid-cols-2 gap-3"><div className="vh-panel p-3"><p className="text-xs text-slate-400">TEAM ACCURACY</p><b className="text-xl">{Math.round(team?.accuracy ?? 0)}%</b></div><div className="vh-panel p-3"><p className="text-xs text-slate-400">MIC</p><b className="text-xl text-emerald-300">{mic === 'ready' ? 'READY' : 'CHECK'}</b></div></div><button onClick={() => setGuideAudio(!guideAudio)} className={`vh-outline-button mt-4 w-full ${guideAudio ? 'border-emerald-300/40 text-emerald-100' : 'text-slate-400'}`}>{guideAudio ? '♪ Hearing my part — tap to mute' : '♪ Play my part in my ear'}</button>{!guide && <button onClick={() => setFullBoard(!fullBoard)} className="vh-outline-button mt-4 w-full">{fullBoard ? 'Return to my part' : 'Show full choir board'}</button>}{fullBoard && <div className="mt-3 space-y-2">{VOICES.map((voice, index) => <CanvasLane key={voice} partIndex={index} partName={voice} colour={COLOURS[index]} getPosition={getElapsed} notes={notes} getPitchHz={index === part ? getPitch : undefined} hitNotes={hits} lookAheadSeconds={4} height={96} showLyrics={false} />)}</div>}</PhoneShell>;
}
function PhoneEnd({ song, playerName, score, sections, part, review, warmUp }: { song: Song; playerName: string; score: number; sections: SectionScore[]; part: number; review: RoundReview | null; warmUp: boolean }) { return <PhoneShell><div className="mt-28 text-center"><p className="text-xs tracking-[.25em] text-fuchsia-300">SESSION COMPLETE</p><h1 className="mt-3 text-4xl font-black">Every voice counted.</h1><p className="mt-8 text-7xl font-black text-cyan-300">{score}</p><p className="mt-1 text-slate-400">{warmUp ? 'Warm-up · nothing recorded' : 'Your personal score'}</p><p className="mt-7">{VOICES[part]} accuracy <b className="ml-2" style={{ color: COLOURS[part] }}>{Math.round(sections.find(section => section.part_index === part)?.accuracy ?? 0)}%</b></p>{review && <div className="mt-7"><RoundReviewPanel review={review} colour={COLOURS[part]} compact /></div>}{!warmUp && <div className="mt-7 text-left"><HighScoreBoard songId={song.id} highlight={[playerName]} perVoice={3} /></div>}</div></PhoneShell>; }
// Song time runs NEGATIVE through the count-in and lead-in, reaching 0 on the
// downbeat, so the opening notes travel in from the right instead of sitting
// frozen on the strike line. Must stay in step with the host's copy in
// app/vocal-hero/page.tsx -- the two describe the same round, and the only
// intended difference is that the host says 'Live' where the phone says 'live'.
/** Must match the host's constant in app/vocal-hero/page.tsx — see the note there. */
const PRE_ROLL_APPROACH = 3;

function timelineFor(session: GameSession | null, now: number) {
  if (!session?.playback_starts_at) return { phase: 'Waiting', songElapsed: 0 };
  const delta = now - new Date(session.playback_starts_at).getTime();
  const countdown = session.countdown_seconds ?? 5, lead = session.lead_in_seconds ?? 2;
  const preRoll = countdown + lead;
  // Song time runs negative through the pre-roll so the opening notes sweep in
  // from the right, decelerating onto the strike line at the downbeat. Must stay
  // in step with the host's copy in app/vocal-hero/page.tsx — the two describe
  // the same round, and the only intended difference is that the host says
  // 'Live' where the phone says 'live'.
  const glide = (secondsIn: number) => {
    if (preRoll <= 0) return 0;
    const left = Math.max(0, preRoll - secondsIn);
    return -(left + ((PRE_ROLL_APPROACH - 1) / preRoll) * left * left);
  };
  if (delta < 0) return { phase: `Starts in ${Math.ceil(-delta / 1000)}`, songElapsed: glide(0) };
  const seconds = delta / 1000;
  if (seconds < countdown) return { phase: `Count-in ${countdown - Math.floor(seconds)}`, songElapsed: glide(seconds) };
  if (seconds < preRoll) return { phase: 'Lead-in · listen', songElapsed: glide(seconds) };
  return { phase: 'live', songElapsed: seconds - preRoll };
}
