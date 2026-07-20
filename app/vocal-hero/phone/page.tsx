'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  fetchPlayers, fetchSectionScores, fetchSessionByCode, fetchSong, joinSession,
  savePlayerRoundStats, subscribeToSession, updatePlayerLobbyState,
} from '@/lib/vocal-hero/supabaseClient';
import { PitchEngine } from '@/lib/vocal-hero/pitchEngine';
import { ScoreEngine } from '@/lib/vocal-hero/scoreEngine';
import type { GameSession, SectionScore, SessionPlayer, Song } from '@/lib/vocal-hero/types';
import { SatbLane } from '../SatbLane';
import { playableNotes, playablePart } from '@/lib/vocal-hero/songData';

const PARTS = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#ee86b5', '#f3a953', '#72aafb', '#6bd3a5'];

export default function PhonePage() { return <Suspense fallback={<main className="min-h-screen bg-[#050b14]" />}><PhoneGame /></Suspense>; }

function PhoneGame() {
  const params = useSearchParams();
  const [room, setRoom] = useState((params.get('room') ?? '').toUpperCase());
  const [name, setName] = useState('');
  const [partIndex, setPartIndex] = useState(0);
  const [session, setSession] = useState<GameSession | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [player, setPlayer] = useState<SessionPlayer | null>(null);
  const [players, setPlayers] = useState<SessionPlayer[]>([]);
  const [sections, setSections] = useState<SectionScore[]>([]);
  const [error, setError] = useState('');
  const [mic, setMic] = useState<'unknown' | 'checking' | 'ready' | 'blocked'>('unknown');
  const [now, setNow] = useState(Date.now());
  const [pitch, setPitch] = useState(0);
  const [score, setScore] = useState(0);
  const [hits, setHits] = useState<Record<string, boolean>>({});
  const [fullBoard, setFullBoard] = useState(false);
  const pitchRef = useRef<PitchEngine | null>(null);
  const scoreRef = useRef<ScoreEngine | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const startedRef = useRef(false);
  const elapsedRef = useRef(0);
  const cuePlayedRef = useRef(false);

  useEffect(() => () => { pitchRef.current?.stop(); void scoreRef.current?.stop(); unsubRef.current?.(); }, []);
  useEffect(() => {
    if (!session) return;
    const interval = window.setInterval(() => {
      setNow(Date.now());
      void fetchPlayers(session.id).then(setPlayers);
      void fetchSectionScores(session.id).then(setSections).catch(() => setSections([]));
    }, 800);
    return () => window.clearInterval(interval);
  }, [session]);

  const timeline = timelineFor(session, now);
  const songElapsed = timeline.songElapsed;
  const notes = song ? playableNotes(song) : [];
  const part = song ? playablePart(song, partIndex) : null;

  useEffect(() => { elapsedRef.current = songElapsed; }, [songElapsed]);

  useEffect(() => {
    if (timeline.phase !== 'Lead-in · listen' || cuePlayedRef.current || !song) return;
    cuePlayedRef.current = true;
    const first = notes.filter(note => note.part === partIndex || note.part === -1).sort((a, b) => a.start - b.start).slice(0, 2);
    if (!first.length) return;
    const context = new AudioContext();
    first.forEach((note, index) => {
      const oscillator = context.createOscillator(), gain = context.createGain();
      const at = context.currentTime + .08 + index * .65;
      oscillator.frequency.value = PitchEngine.midiToHz(note.midi); oscillator.type = 'sine';
      gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(.16, at + .03); gain.gain.exponentialRampToValueAtTime(.0001, at + .55);
      oscillator.connect(gain).connect(context.destination); oscillator.start(at); oscillator.stop(at + .58);
    });
    window.setTimeout(() => { void context.close(); }, 1800);
  }, [notes, partIndex, song, timeline.phase]);

  useEffect(() => {
    if (!session || !song || !player || !part || timeline.phase !== 'live' || startedRef.current) return;
    startedRef.current = true;
    const scorer = new ScoreEngine({
      part, partIndex, notes, songDuration: song.duration, playerId: player.id, sessionId: session.id,
      onScoreUpdate: (_, total) => setScore(total),
      onNoteResult: result => setHits(previous => ({ ...previous, [result.noteId]: result.points > 0 })),
    });
    scoreRef.current = scorer; scorer.start();
    const engine = new PitchEngine({
      confidenceThreshold: .85, smoothing: .65,
      onPitch: sample => { setPitch(sample.frequency); if (sample.confidence > .85) scorer.scorePitch(sample.frequency, Math.max(0, elapsedRef.current)); },
    });
    pitchRef.current = engine;
    void engine.start().then(() => setMic('ready')).catch(() => setMic('blocked'));
  }, [notes, part, partIndex, player, session, song, timeline.phase]);

  useEffect(() => {
    if (session?.status !== 'playing' || !player) return;
    const interval = window.setInterval(() => {
      const stats = scoreRef.current?.stats;
      if (!stats) return;
      void savePlayerRoundStats({ session_id: session.id, player_id: player.id, score: scoreRef.current?.currentTotal ?? 0, accuracy: stats.accuracy, notes_attempted: stats.attempted, notes_hit: stats.hit });
    }, 3000);
    return () => window.clearInterval(interval);
  }, [player, session?.id, session?.status]);

  useEffect(() => {
    if (session?.status !== 'ended' || !player || !scoreRef.current) return;
    pitchRef.current?.stop();
    const stats = scoreRef.current.stats;
    void scoreRef.current.stop().then(() => savePlayerRoundStats({ session_id: session.id, player_id: player.id, score, accuracy: stats.accuracy, notes_attempted: stats.attempted, notes_hit: stats.hit }));
  }, [player, score, session?.status]);

  async function join(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (!room || !name.trim()) { setError('Enter your room code and name.'); return; }
    try {
      const nextSession = await fetchSessionByCode(room);
      if (!nextSession || nextSession.status === 'ended') throw new Error('That room is unavailable.');
      const nextSong = await fetchSong(nextSession.song_id);
      if (!nextSong) throw new Error('The song was not found.');
      const nextPlayer = await joinSession(nextSession.id, name.trim(), partIndex);
      unsubRef.current = subscribeToSession(nextSession.id, setSession);
      setSession(nextSession); setSong(nextSong); setPlayer(nextPlayer); setPlayers(await fetchPlayers(nextSession.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to join room.'); }
  }

  async function testMic() {
    if (!player) return;
    setMic('checking');
    const test = new PitchEngine({ onPitch: () => {}, smoothing: .6 });
    try { await test.start(); test.stop(); setMic('ready'); await updatePlayerLobbyState(player.id, { ready_at: player.ready_at ?? null, mic_status: 'ready' }); }
    catch { setMic('blocked'); await updatePlayerLobbyState(player.id, { ready_at: player.ready_at ?? null, mic_status: 'blocked' }); }
  }

  async function readyUp() {
    if (!player) return;
    const readyAt = player.ready_at ? null : new Date().toISOString();
    await updatePlayerLobbyState(player.id, { ready_at: readyAt, mic_status: mic === 'ready' ? 'ready' : 'unknown' });
    setPlayer({ ...player, ready_at: readyAt });
  }

  if (!session) return <Join room={room} setRoom={setRoom} name={name} setName={setName} part={partIndex} setPart={setPartIndex} error={error} onJoin={join} />;
  if (session.status === 'lobby') return <PlayerLobby song={song} player={player} part={partIndex} mic={mic} onTest={testMic} onReady={readyUp} />;
  if (session.status === 'ended') return <End score={score} sections={sections} part={partIndex} />;
  return <PlayerStage song={song!} notes={notes} part={partIndex} elapsed={songElapsed} pitch={pitch} score={score} hits={hits} sections={sections} phase={timeline.phase} fullBoard={fullBoard} setFullBoard={setFullBoard} mic={mic} />;
}

function Join({ room, setRoom, name, setName, part, setPart, error, onJoin }: { room: string; setRoom: (value: string) => void; name: string; setName: (value: string) => void; part: number; setPart: (value: number) => void; error: string; onJoin: (event: React.FormEvent) => void }) {
  return <main className="flex min-h-screen items-center bg-[#050b14] px-5 text-[#f7f3e8]" style={{ backgroundImage: 'radial-gradient(circle at 20% 0%, rgba(62,119,174,.28), transparent 42%)' }}><form onSubmit={onJoin} className="mx-auto w-full max-w-md rounded-[2rem] border border-white/10 bg-[#0b1726] p-7 shadow-2xl"><p className="text-xs font-bold uppercase tracking-[.25em] text-[#f6c65b]">Vocal Hero</p><h1 className="mt-2 font-serif text-4xl">Join the choir.</h1><p className="mt-2 text-sm text-slate-400">Your live pitch and performance remain personal.</p><label className="mt-7 block text-xs text-slate-400">Room code<input value={room} onChange={event => setRoom(event.target.value.toUpperCase())} maxLength={5} className="mt-2 w-full rounded-xl border border-white/10 bg-[#07111d] px-4 py-3 text-center font-mono text-2xl tracking-[.35em] outline-none focus:border-[#f6c65b]" /></label><label className="mt-4 block text-xs text-slate-400">Your name<input value={name} onChange={event => setName(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#07111d] px-4 py-3 text-base outline-none focus:border-[#f6c65b]" /></label><p className="mt-5 text-xs font-bold uppercase tracking-[.18em] text-slate-400">Choose your part</p><div className="mt-2 grid grid-cols-2 gap-2">{PARTS.map((voice,index) => <button type="button" key={voice} onClick={() => setPart(index)} className="rounded-xl border px-3 py-3 text-left" style={{ borderColor: part === index ? COLOURS[index] : '#ffffff18', background: part === index ? `${COLOURS[index]}18` : 'transparent', color: part === index ? COLOURS[index] : '#cbd5e1' }}><b>{voice}</b><span className="block text-xs opacity-70">Multiple singers welcome</span></button>)}</div>{error && <p className="mt-4 text-sm text-red-300">{error}</p>}<button className="mt-6 w-full rounded-xl bg-[#f6c65b] py-3 font-bold text-[#07111d]">Join room</button></form></main>;
}

function PlayerLobby({ song, player, part, mic, onTest, onReady }: { song: Song | null; player: SessionPlayer | null; part: number; mic: string; onTest: () => void; onReady: () => void }) { return <main className="flex min-h-screen items-center bg-[#050b14] px-5 text-[#f7f3e8]"><section className="mx-auto w-full max-w-md rounded-[2rem] border border-white/10 bg-[#0b1726] p-7 text-center"><p className="text-xs uppercase tracking-[.22em] text-[#f6c65b]">You are in</p><h1 className="mt-2 font-serif text-3xl">{song?.title}</h1><p className="mt-2" style={{ color: COLOURS[part] }}>Singing {PARTS[part]}</p><div className="mt-7 rounded-2xl border border-white/10 bg-[#07111d] p-4"><p className="text-sm text-slate-300">Microphone check: <b className="capitalize" style={{ color: mic === 'ready' ? '#6bd3a5' : mic === 'blocked' ? '#ef8888' : '#f6c65b' }}>{mic}</b></p><button onClick={onTest} className="mt-3 rounded-lg border border-white/15 px-4 py-2 text-sm">Test microphone</button></div><button onClick={onReady} className="mt-5 w-full rounded-xl bg-[#f6c65b] py-3 font-bold text-[#07111d]">{player?.ready_at ? 'You are ready ✓' : 'I am ready'}</button><p className="mt-5 text-xs text-slate-500">For fairest scoring, sing close to your phone. Avoid Bluetooth headphones when possible.</p></section></main>; }

function PlayerStage({ song, notes, part, elapsed, pitch, score, hits, sections, phase, fullBoard, setFullBoard, mic }: { song: Song; notes: import('@/lib/vocal-hero/types').SongNote[]; part: number; elapsed: number; pitch: number; score: number; hits: Record<string, boolean>; sections: SectionScore[]; phase: string; fullBoard: boolean; setFullBoard: (value: boolean) => void; mic: string }) {
  const lyric = notes.find(note => (note.part === part || note.part === -1) && elapsed >= note.start && elapsed < note.end && note.lyric)?.lyric;
  const note = pitch ? PitchEngine.toNoteName(pitch) : '—';
  return <main className="flex min-h-screen flex-col bg-[#050b14] px-4 pb-5 pt-4 text-[#f7f3e8]" style={{ backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(81,126,210,.2), transparent 38%)' }}><header className="flex items-start justify-between"><div><p className="text-xs text-slate-400">{song.title}</p><p className="font-semibold" style={{ color: COLOURS[part] }}>{PARTS[part]}</p></div><div className="text-right"><p className="font-mono text-3xl text-[#6bd3a5]">{score}</p><p className="text-[10px] uppercase tracking-[.15em] text-slate-500">Personal score</p></div></header><section className="mt-4 rounded-2xl border border-[#f6c65b]/25 bg-[#f6c65b]/[.07] px-4 py-4 text-center"><p className="text-xs uppercase tracking-[.2em] text-[#f6c65b]">{phase}</p><p className="mt-1 min-h-8 text-2xl font-semibold">{lyric || 'Listen · breathe · prepare'}</p></section><div className="mt-3 min-h-[240px] flex-1"><SatbLane partIndex={part} partName={PARTS[part]} colour={COLOURS[part]} elapsed={elapsed} notes={notes} pitchHz={pitch} hitNotes={hits} /></div><div className="mt-3 grid grid-cols-3 gap-2"><Metric label="Detected" value={note} /><Metric label="Mic" value={mic === 'ready' ? 'Ready' : 'Check'} /><Metric label="Team" value={`${Math.round(sections.find(section => section.part_index === part)?.accuracy ?? 0)}%`} /></div><button onClick={() => setFullBoard(!fullBoard)} className="mt-3 rounded-xl border border-white/10 bg-white/[.04] py-2 text-sm">{fullBoard ? 'Return to my part' : 'Show full choir board'}</button>{fullBoard && <div className="mt-3 space-y-2">{PARTS.map((voice,index) => <SatbLane key={voice} compact partIndex={index} partName={voice} colour={COLOURS[index]} elapsed={elapsed} notes={notes} pitchHz={index === part ? pitch : undefined} hitNotes={hits} />)}</div>}</main>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/10 bg-white/[.04] p-2 text-center"><p className="text-[10px] uppercase tracking-[.12em] text-slate-500">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>; }
function End({ score, sections, part }: { score: number; sections: SectionScore[]; part: number }) { return <main className="flex min-h-screen items-center justify-center bg-[#050b14] p-5 text-center text-[#f7f3e8]"><section className="w-full max-w-sm rounded-[2rem] border border-white/10 bg-[#0b1726] p-8"><p className="text-xs uppercase tracking-[.25em] text-[#f6c65b]">Session complete</p><h1 className="mt-2 font-serif text-4xl">Well sung.</h1><p className="mt-6 font-mono text-6xl text-[#6bd3a5]">{score}</p><p className="text-sm text-slate-400">Your personal score</p><p className="mt-6 text-sm">{PARTS[part]} team accuracy: <b>{Math.round(sections.find(section => section.part_index === part)?.accuracy ?? 0)}%</b></p></section></main>; }
function timelineFor(session: GameSession | null, now: number) { if (!session?.playback_starts_at) return { phase: 'Waiting for host', songElapsed: 0 }; const delta = now - new Date(session.playback_starts_at).getTime(); const countdown = session.countdown_seconds ?? 5, lead = session.lead_in_seconds ?? 2; if (delta < 0) return { phase: `Starting in ${Math.ceil(-delta / 1000)}`, songElapsed: 0 }; const seconds = delta / 1000; if (seconds < countdown) return { phase: `Count-in · ${countdown - Math.floor(seconds)}`, songElapsed: 0 }; if (seconds < countdown + lead) return { phase: 'Lead-in · listen', songElapsed: 0 }; return { phase: 'live', songElapsed: seconds - countdown - lead }; }
