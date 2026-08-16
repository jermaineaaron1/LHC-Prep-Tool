'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { fetchPlayers, fetchSectionScores, fetchSessionByCode, fetchSong, joinSession, savePlayerRoundStats, subscribeToSession, updatePlayerLobbyState } from '@/lib/vocal-hero/supabaseClient';
import { PitchEngine } from '@/lib/vocal-hero/pitchEngine';
import { ScoreEngine } from '@/lib/vocal-hero/scoreEngine';
import type { Difficulty, NoteScoreResult } from '@/lib/vocal-hero/scoreEngine';
import { DifficultyPicker, rememberDifficulty, storedDifficulty } from '../DifficultyPicker';
import { LatencyRow } from '../LatencyCalibration';
import { storedLatencySec } from '@/lib/vocal-hero/latency';
import type { GameSession, SectionScore, SessionPlayer, Song, SongNote } from '@/lib/vocal-hero/types';
import { SatbLane, clearTrail, pushTrail } from '../SatbLane';
import type { TrailSample } from '../SatbLane';
import { RoundReviewPanel } from '../RoundReview';
import { summariseRound } from '@/lib/vocal-hero/review';
import type { RoundReview } from '@/lib/vocal-hero/review';
import { isGuideMelody, playableNotes, playablePart } from '@/lib/vocal-hero/songData';
import { measureServerClockOffset } from '@/lib/vocal-hero/clock';
import { livePitchFeedback } from '@/lib/vocal-hero/liveCues';
import { KaraokeLyrics } from '../KaraokeLyrics';

const VOICES = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#ff60bc', '#a965ff', '#22d3ee', '#ffbd45'];
const PITCH_RANGES = [{ low: 60, high: 81 }, { low: 53, high: 74 }, { low: 48, high: 67 }, { low: 40, high: 64 }];


export default function PhonePage() { return <Suspense fallback={<main className="min-h-screen bg-[#030611]" />}><PhoneGame /></Suspense>; }

function PhoneGame() {
  const params = useSearchParams();
  const [room, setRoom] = useState((params.get('room') ?? '').toUpperCase());
  const [name, setName] = useState(''); const [partIndex, setPartIndex] = useState(0);
  const [session, setSession] = useState<GameSession | null>(null); const [song, setSong] = useState<Song | null>(null); const [player, setPlayer] = useState<SessionPlayer | null>(null);
  const [players, setPlayers] = useState<SessionPlayer[]>([]); const [sections, setSections] = useState<SectionScore[]>([]); const [error, setError] = useState('');
  const [mic, setMic] = useState<'unknown' | 'checking' | 'ready' | 'blocked'>('unknown'); const [now, setNow] = useState(Date.now()); const [clockOffset, setClockOffset] = useState(0);
  const [pitch, setPitch] = useState(0); const [score, setScore] = useState(0); const [hits, setHits] = useState<Record<string, boolean>>({}); const [fullBoard, setFullBoard] = useState(false); const [pausedElapsed, setPausedElapsed] = useState(0);
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
  // Every note's result, kept so the end of the round can say something
  // more useful than one number. Collected in a ref for the same reason as
  // the trail: nothing renders from it until the song is over.
  const resultsRef = useRef<NoteScoreResult[]>([]);
  const [review, setReview] = useState<RoundReview | null>(null);
  function setDifficulty(next: Difficulty) { setDifficultyState(next); rememberDifficulty(next); }
  const pitchRef = useRef<PitchEngine | null>(null); const scoreRef = useRef<ScoreEngine | null>(null); const unsubRef = useRef<(() => void) | null>(null); const startedRef = useRef(false); const elapsedRef = useRef(0); const phaseRef = useRef('Waiting'); const lastPitchPaintRef = useRef(0); const cuePlayedRef = useRef(false);
  useEffect(() => () => { pitchRef.current?.stop(); void scoreRef.current?.stop(); unsubRef.current?.(); }, []);
  useEffect(() => { if (!session) return; const interval = window.setInterval(() => { setNow(Date.now()); void fetchPlayers(session.id).then(setPlayers); void fetchSectionScores(session.id).then(setSections).catch(() => setSections([])); }, 900); return () => clearInterval(interval); }, [session]);
  useEffect(() => { if (session?.status !== 'playing') return; let frame = 0, last = 0; const tick = (time: number) => { if (time - last > 33) { setNow(Date.now()); last = time; } frame = requestAnimationFrame(tick); }; frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame); }, [session?.status]);
  const runningTimeline = timelineFor(session, now + clockOffset); const timeline = session?.paused ? { phase: 'Paused', songElapsed: pausedElapsed } : runningTimeline; const notes = useMemo(() => song ? playableNotes(song) : [], [song]); const part = song ? playablePart(song, partIndex) : null;
  useEffect(() => { if (session?.paused) setPausedElapsed(runningTimeline.songElapsed); }, [session?.paused]);
  useEffect(() => { elapsedRef.current = timeline.songElapsed; phaseRef.current = timeline.phase; }, [timeline.phase, timeline.songElapsed]);

  async function startPitchTracking() { if (pitchRef.current?.isRunning) return true; const range = PITCH_RANGES[partIndex] ?? PITCH_RANGES[0]; const engine = new PitchEngine({ bufferSize: 2048, confidenceThreshold: .76, smoothing: .22, minHz: PitchEngine.midiToHz(range.low - 3), maxHz: PitchEngine.midiToHz(range.high + 3), onPitch: sample => { if (performance.now() - lastPitchPaintRef.current > 33) { setPitch(sample.frequency); lastPitchPaintRef.current = performance.now(); } // This sample is the sound of a moment already past: the beat took time to
      // reach the singer's ears, and their answer took time to reach the analyser.
      // Scoring it against the clock as it stands now would mark every note late.
      if (phaseRef.current === 'live' && sample.confidence > .78) { const songTime = Math.max(0, elapsedRef.current - latencyRef.current); scoreRef.current?.scorePitch(sample.frequency, songTime); pushTrail(trailRef.current, songTime, sample.frequency); } } }); pitchRef.current = engine; try { await engine.start(); setMic('ready'); return true; } catch { pitchRef.current = null; setMic('blocked'); return false; } }
  useEffect(() => { if (timeline.phase !== 'Lead-in · listen' || cuePlayedRef.current || !song) return; cuePlayedRef.current = true; const first = notes.filter(note => note.part === partIndex || note.part === -1).sort((a, b) => a.start - b.start).slice(0, 2); if (!first.length) return; const context = new AudioContext({ latencyHint: 'interactive' }); first.forEach((note, index) => { const oscillator = context.createOscillator(), gain = context.createGain(), at = context.currentTime + .08 + index * .65; oscillator.frequency.value = PitchEngine.midiToHz(note.midi); gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(.16, at + .03); gain.gain.exponentialRampToValueAtTime(.0001, at + .55); oscillator.connect(gain).connect(context.destination); oscillator.start(at); oscillator.stop(at + .58); }); window.setTimeout(() => void context.close(), 1800); }, [notes, partIndex, song, timeline.phase]);
  useEffect(() => { if (!session || !song || !player || !part || session.status !== 'playing' || startedRef.current) return; startedRef.current = true; const scorer = new ScoreEngine({ part, partIndex, notes, songDuration: song.duration, playerId: player.id, sessionId: session.id, difficulty, onScoreUpdate: (_, total) => setScore(total), onNoteResult: result => { resultsRef.current.push(result); setHits(current => ({ ...current, [result.noteId]: result.points > 0 })); } }); scoreRef.current = scorer; scorer.start(); void startPitchTracking(); }, [difficulty, notes, part, partIndex, player, session, song]);
  useEffect(() => { if (session?.status !== 'playing' || !player) return; const interval = setInterval(() => { const stats = scoreRef.current?.stats; if (stats) void savePlayerRoundStats({ session_id: session.id, player_id: player.id, score: scoreRef.current?.currentTotal ?? 0, accuracy: stats.accuracy, notes_attempted: stats.attempted, notes_hit: stats.hit }); }, 3000); return () => clearInterval(interval); }, [player, session?.id, session?.status]);
  useEffect(() => { if (session?.status !== 'ended' || !player || !scoreRef.current) return; pitchRef.current?.stop(); setReview(summariseRound(resultsRef.current, notes)); const stats = scoreRef.current.stats; void scoreRef.current.stop().then(() => savePlayerRoundStats({ session_id: session.id, player_id: player.id, score, accuracy: stats.accuracy, notes_attempted: stats.attempted, notes_hit: stats.hit })); }, [player, score, session?.status]);
  async function join(event: React.FormEvent) { event.preventDefault(); if (!room || !name.trim()) { setError('Enter your room code and name.'); return; } try { const next = await fetchSessionByCode(room); if (!next || next.status === 'ended') throw new Error('That room is unavailable.'); const nextSong = await fetchSong(next.song_id); if (!nextSong) throw new Error('Song not found.'); const nextPlayer = await joinSession(next.id, name.trim(), partIndex); setClockOffset(await measureServerClockOffset().catch(() => 0)); unsubRef.current = subscribeToSession(next.id, setSession); clearTrail(trailRef.current); resultsRef.current = []; setReview(null); setSession(next); setSong(nextSong); setPlayer(nextPlayer); setPlayers(await fetchPlayers(next.id)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to join.'); } }
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
      setError(micState === 'blocked'
        ? 'Microphone blocked — allow it in your browser settings and tap ready again. You can still follow the words and notes without scoring.'
        : '');
    }
    const readyAt = goingReady ? new Date().toISOString() : null;
    await updatePlayerLobbyState(player.id, { ready_at: readyAt, mic_status: micState === 'ready' ? 'ready' : micState === 'blocked' ? 'blocked' : 'unknown' });
    setPlayer({ ...player, ready_at: readyAt });
  }
  if (!session) return <Join room={room} setRoom={setRoom} name={name} setName={setName} part={partIndex} setPart={setPartIndex} error={error} join={join} />;
  if (session.status === 'lobby') return <PhoneLobby song={song!} code={session.room_code} part={partIndex} players={players} player={player} mic={mic} testMic={testMic} ready={readyUp} error={error} difficulty={difficulty} setDifficulty={setDifficulty} latencySec={latencySec} applyLatency={applyLatency} />;
  if (session.status === 'ended') return <PhoneEnd score={score} sections={sections} part={partIndex} review={review} />;
  if (timeline.phase === 'Paused') return <PhonePaused song={song!} part={partIndex} />;
  if (timeline.phase !== 'live') return <PhoneCountdown song={song!} part={partIndex} phase={timeline.phase} mic={mic} />;
  return <PhoneLive song={song!} notes={notes} guide={isGuideMelody(notes)} part={partIndex} elapsed={timeline.songElapsed} pitch={pitch} score={score} hits={hits} sections={sections} mic={mic} fullBoard={fullBoard} setFullBoard={setFullBoard} trail={trailRef.current} />;
}

function PhoneBrand() { return <b className="text-xl">VOCAL<span className="text-fuchsia-400">Hero</span></b>; }
function PhoneShell({ children }: { children: React.ReactNode }) { return <main className="vh-app min-h-screen px-4 pb-6 pt-5 text-slate-100"><header className="flex items-center justify-between border-b border-white/10 pb-4"><span className="text-slate-400">☰</span><PhoneBrand /><span className="text-slate-400">?</span></header>{children}</main>; }
function Join({ room, setRoom, name, setName, part, setPart, error, join }: { room: string; setRoom: (v: string) => void; name: string; setName: (v: string) => void; part: number; setPart: (v: number) => void; error: string; join: (event: React.FormEvent) => void }) { return <PhoneShell><form onSubmit={join} className="mx-auto mt-10 max-w-md vh-panel p-5"><p className="text-center text-xs tracking-[.2em] text-fuchsia-300">JOIN LOBBY</p><h1 className="mt-3 text-center text-3xl font-black">Sing your part.</h1><label className="mt-6 block text-xs text-slate-400">Room code<input value={room} onChange={e => setRoom(e.target.value.toUpperCase())} maxLength={5} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-center font-mono text-2xl tracking-[.25em]" /></label><label className="mt-4 block text-xs text-slate-400">Nickname<input value={name} onChange={e => setName(e.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-base" /></label><p className="mt-5 text-xs tracking-[.15em] text-slate-400">CHOOSE YOUR PART</p><div className="mt-2 grid grid-cols-2 gap-2">{VOICES.map((voice, index) => <button type="button" key={voice} onClick={() => setPart(index)} className="rounded-xl border p-3 text-left" style={{ borderColor: part === index ? COLOURS[index] : '#ffffff18', background: part === index ? `${COLOURS[index]}18` : '#07111d' }}><b className="text-2xl" style={{ color: COLOURS[index] }}>{voice[0]}</b><span className="ml-2 text-sm">{voice}</span></button>)}</div>{error && <p className="mt-4 text-sm text-rose-300">{error}</p>}<button className="vh-start-button mt-6 w-full">JOIN LOBBY</button></form></PhoneShell>; }
function PhoneLobby({ song, code, part, players, player, mic, testMic, ready, error, difficulty, setDifficulty, latencySec, applyLatency }: { song: Song; code: string; part: number; players: SessionPlayer[]; player: SessionPlayer | null; mic: string; testMic: () => void; ready: () => void; error: string; difficulty: Difficulty; setDifficulty: (next: Difficulty) => void; latencySec: number; applyLatency: (seconds: number) => void }) { return <PhoneShell><div className="mt-5 text-center"><p className="text-sm text-slate-300">{song.title}</p><p className="mt-1 text-xs text-slate-500">{song.artist || 'Vocal Hero arrangement'}</p><p className="mt-4 text-xs text-slate-400">ROOM CODE</p><p className="font-mono text-3xl font-bold tracking-[.25em] text-[#ffd15c]">{code}</p></div><p className="mt-7 text-center text-xs tracking-[.18em] text-slate-400">CHOOSE YOUR PART</p><div className="mt-3 grid grid-cols-2 gap-2">{VOICES.map((voice, index) => <div key={voice} className="rounded-xl border p-3" style={{ borderColor: index === part ? COLOURS[index] : '#ffffff16', background: index === part ? `${COLOURS[index]}14` : '#07111d' }}><b style={{ color: COLOURS[index] }}>{voice[0]} <span className="ml-1 text-sm">{voice}</span></b><p className="mt-2 text-xs text-slate-400">{players.filter(item => item.part_index === index).length} players</p></div>)}</div><div className="mt-5"><DifficultyPicker value={difficulty} onChange={setDifficulty} colour={COLOURS[part]} /></div><div className="mt-5"><LatencyRow colour={COLOURS[part]} latencySec={latencySec} onChange={applyLatency} /></div><div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4"><p className="text-xs text-slate-400">MIC CHECK</p><button onClick={testMic} className={`mt-2 text-sm ${mic === 'blocked' ? 'text-rose-300' : 'text-emerald-300'}`}>● {mic === 'ready' ? 'Microphone detected' : mic === 'blocked' ? 'Microphone blocked — tap to retry' : mic === 'checking' ? 'Checking…' : 'Test microphone'}</button></div>{error && <p className="mt-3 rounded-xl border border-rose-400/30 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">{error}</p>}<button onClick={ready} className="vh-start-button mt-5 w-full">✓ {player?.ready_at ? 'I’M READY' : 'TAP WHEN READY'}</button><p className="mt-2 text-center text-[10px] text-slate-500">Tapping ready asks for the microphone now, so the permission prompt cannot land on the downbeat.</p></PhoneShell>; }
function PhoneCountdown({ song, part, phase, mic }: { song: Song; part: number; phase: string; mic: string }) { const number = Number(phase.match(/(\d+)/)?.[1] ?? 0); return <PhoneShell><p className="mt-6 text-center text-sm">{song.title}</p><p className="mt-2 text-center text-xs text-slate-400">YOUR PART</p><h1 className="text-center text-2xl font-black" style={{ color: COLOURS[part] }}>{VOICES[part].toUpperCase()} {VOICES[part][0]}</h1><div className="mx-auto mt-12 grid h-60 w-60 place-items-center rounded-full border-2 border-fuchsia-400 bg-fuchsia-400/[.08] shadow-[0_0_55px_#ec4899]"><div className="text-center"><p className="text-8xl font-black text-fuchsia-300">{number || '•'}</p><p className="mt-2 text-sm tracking-[.2em] text-fuchsia-200">GET READY</p></div></div><div className="mt-12 text-center"><p className="text-4xl text-fuchsia-300">◉</p><p className="mt-2 text-sm text-emerald-300">{mic === 'ready' ? 'READY' : 'MIC CHECK'}</p></div><p className="mt-7 text-center text-sm text-slate-300">◉ Eyes on your part <span className="mx-2 text-slate-600">|</span> ≋ Breathe in</p></PhoneShell>; }
function PhonePaused({ song, part }: { song: Song; part: number }) { return <PhoneShell><div className="mx-auto mt-20 max-w-sm text-center"><p className="text-xs font-black uppercase tracking-[.24em] text-cyan-300">Session paused</p><h1 className="mt-4 text-4xl font-black">Take a breath.</h1><p className="mt-3 text-slate-400">{song.title} will resume on every device when the host continues.</p><div className="mx-auto mt-10 grid h-28 w-28 place-items-center rounded-full border border-fuchsia-300/40 bg-fuchsia-300/10 text-5xl" style={{ color: COLOURS[part] }}>Ⅱ</div></div></PhoneShell>; }
function PhoneLive({ song, notes, guide, part, elapsed, pitch, score, hits, sections, mic, fullBoard, setFullBoard, trail }: { song: Song; notes: SongNote[]; guide: boolean; part: number; elapsed: number; pitch: number; score: number; hits: Record<string, boolean>; sections: SectionScore[]; mic: string; fullBoard: boolean; setFullBoard: (value: boolean) => void; trail: TrailSample[] }) {
  const lanePart = guide ? -1 : part;
  const active = notes.find(note => (note.part === lanePart || note.part === -1) && elapsed >= note.start && elapsed < note.end);
  const feedback = livePitchFeedback(active?.midi ?? null, pitch);
  const team = sections.find(section => section.part_index === part);
  return <PhoneShell><div className="mt-5 flex items-center justify-between"><div><p className="text-xs text-slate-400">{song.title}</p><b style={{ color: COLOURS[part] }}>{VOICES[part].toUpperCase()} TEAM</b></div><div className="text-right"><p className="text-3xl font-black text-fuchsia-300">{score.toLocaleString()}</p><p className="text-[10px] tracking-[.16em] text-slate-500">PERSONAL SCORE</p></div></div><div className="mt-5"><KaraokeLyrics song={song} notes={notes} partIndex={lanePart} elapsed={elapsed} compact /></div><div className="mt-4"><SatbLane partIndex={lanePart} partName={guide ? 'Melody guide' : VOICES[part]} colour={guide ? '#ff60bc' : COLOURS[part]} elapsed={elapsed} notes={notes} pitchHz={pitch} hitNotes={hits} lookAheadSeconds={4} showLyrics={false} trail={trail} /></div><section className="vh-panel mt-4 p-4"><div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-wider text-slate-500">You sang</p><b className="text-3xl text-cyan-200">{feedback.detected}</b></div><div className="px-2 text-center"><p className={`text-sm font-black ${feedback.state === 'correct' ? 'text-emerald-300' : feedback.state === 'high' || feedback.state === 'low' ? 'text-amber-300' : 'text-slate-400'}`}>{feedback.label}</p><small className="block text-[10px] text-slate-500">{feedback.difference}</small></div><div className="text-right"><p className="text-[10px] uppercase tracking-wider text-slate-500">Target</p><b className="text-3xl text-white">{feedback.target}</b></div></div></section><div className="mt-4 grid grid-cols-2 gap-3"><div className="vh-panel p-3"><p className="text-xs text-slate-400">TEAM ACCURACY</p><b className="text-xl">{Math.round(team?.accuracy ?? 0)}%</b></div><div className="vh-panel p-3"><p className="text-xs text-slate-400">MIC</p><b className="text-xl text-emerald-300">{mic === 'ready' ? 'READY' : 'CHECK'}</b></div></div>{!guide && <button onClick={() => setFullBoard(!fullBoard)} className="vh-outline-button mt-4 w-full">{fullBoard ? 'Return to my part' : 'Show full choir board'}</button>}{fullBoard && <div className="mt-3 space-y-2">{VOICES.map((voice, index) => <SatbLane key={voice} compact partIndex={index} partName={voice} colour={COLOURS[index]} elapsed={elapsed} notes={notes} pitchHz={index === part ? pitch : undefined} hitNotes={hits} lookAheadSeconds={4} />)}</div>}</PhoneShell>;
}
function PhoneEnd({ score, sections, part, review }: { score: number; sections: SectionScore[]; part: number; review: RoundReview | null }) { return <PhoneShell><div className="mt-28 text-center"><p className="text-xs tracking-[.25em] text-fuchsia-300">SESSION COMPLETE</p><h1 className="mt-3 text-4xl font-black">Every voice counted.</h1><p className="mt-8 text-7xl font-black text-cyan-300">{score}</p><p className="mt-1 text-slate-400">Your personal score</p><p className="mt-7">{VOICES[part]} accuracy <b className="ml-2" style={{ color: COLOURS[part] }}>{Math.round(sections.find(section => section.part_index === part)?.accuracy ?? 0)}%</b></p>{review && <div className="mt-7"><RoundReviewPanel review={review} colour={COLOURS[part]} compact /></div>}</div></PhoneShell>; }
function timelineFor(session: GameSession | null, now: number) { if (!session?.playback_starts_at) return { phase: 'Waiting', songElapsed: 0 }; const delta = now - new Date(session.playback_starts_at).getTime(); const countdown = session.countdown_seconds ?? 5, lead = session.lead_in_seconds ?? 2; if (delta < 0) return { phase: `Starts in ${Math.ceil(-delta / 1000)}`, songElapsed: 0 }; const seconds = delta / 1000; if (seconds < countdown) return { phase: `Count-in ${countdown - Math.floor(seconds)}`, songElapsed: 0 }; if (seconds < countdown + lead) return { phase: 'Lead-in · listen', songElapsed: 0 }; return { phase: 'live', songElapsed: seconds - countdown - lead }; }
