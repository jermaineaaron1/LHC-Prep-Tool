'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createSession, fetchAllSongs, fetchPlayers, fetchSectionScores, fetchSessionByCode, fetchSong, joinSession, savePlayerRoundStats,
  scheduleSessionStart, setSessionPaused, subscribeToPlayers, subscribeToSession, updatePlayerLobbyState, updateSong,
} from '@/lib/vocal-hero/supabaseClient';
import type { GameSession, SectionScore, SessionPlayer, Song, SongNote } from '@/lib/vocal-hero/types';
import { SatbLane } from './SatbLane';
import { isGuideMelody, playableNotes, playablePart } from '@/lib/vocal-hero/songData';
import { measureServerClockOffset } from '@/lib/vocal-hero/clock';
import { ArrangementEditor } from './ArrangementEditor';
import { PitchEngine } from '@/lib/vocal-hero/pitchEngine';
import { ScoreEngine } from '@/lib/vocal-hero/scoreEngine';
import type { NoteScoreResult } from '@/lib/vocal-hero/scoreEngine';
import { gameplayNotes, livePitchFeedback } from '@/lib/vocal-hero/liveCues';
import { ChoirKaraokeLyrics, KaraokeLyrics } from './KaraokeLyrics';

const VOICES = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#ff60bc', '#a965ff', '#22d3ee', '#ffbd45'];
const PITCH_RANGES = [{ low: 60, high: 81 }, { low: 53, high: 74 }, { low: 48, high: 67 }, { low: 40, high: 64 }];

export default function VocalHeroHostPage() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [song, setSong] = useState<Song | null>(null);
  const [session, setSession] = useState<GameSession | null>(null);
  const [players, setPlayers] = useState<SessionPlayer[]>([]);
  const [sections, setSections] = useState<SectionScore[]>([]);
  const [now, setNow] = useState(Date.now());
  const [clockOffset, setClockOffset] = useState(0);
  const [error, setError] = useState('');
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [showCreateSong, setShowCreateSong] = useState(false);
  const [creatingSong, setCreatingSong] = useState(false);
  const [soloPart, setSoloPart] = useState<number | null>(null);
  const [soloPlayer, setSoloPlayer] = useState<SessionPlayer | null>(null);
  const [soloStarting, setSoloStarting] = useState<number | null>(null);
  const [soloMic, setSoloMic] = useState<'unknown' | 'checking' | 'ready' | 'blocked'>('unknown');
  const [soloPitch, setSoloPitch] = useState(0);
  const [soloScore, setSoloScore] = useState(0);
  const [soloHits, setSoloHits] = useState<Record<string, boolean>>({});
  const [soloLastResult, setSoloLastResult] = useState<NoteScoreResult | null>(null);
  const [soloFullBoard, setSoloFullBoard] = useState(false);
  const [gamePaused, setGamePaused] = useState(false);
  const [pausedElapsed, setPausedElapsed] = useState(0);
  const listeners = useRef<Array<() => void>>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const openedRoomRef = useRef(false);
  const soloPitchRef = useRef<PitchEngine | null>(null);
  const soloScoreRef = useRef<ScoreEngine | null>(null);
  const soloScoreStartedRef = useRef(false);
  const soloElapsedRef = useRef(0);
  const soloPhaseRef = useRef('Waiting');
  const soloLastPitchPaintRef = useRef(0);
  const pauseStartedRef = useRef(0);
  const runningTimeline = timelineFor(session, now + clockOffset);
  const timeline = gamePaused ? { phase: 'Paused', songElapsed: pausedElapsed } : runningTimeline;
  const backingTrackUrl = song?.audio_url || song?.backing_media_url || '';

  useEffect(() => { void fetchAllSongs().then(rows => setSongs(rows.filter(row => row.status === 'ready' || row.status === 'draft'))).catch(() => setError('Unable to load the song library.')); }, []);
  useEffect(() => { void measureServerClockOffset().then(setClockOffset).catch(() => undefined); }, []);
  useEffect(() => {
    const roomCode = new URLSearchParams(window.location.search).get('room');
    if (!roomCode || openedRoomRef.current) return;
    openedRoomRef.current = true;
    void (async () => {
      const existing = await fetchSessionByCode(roomCode);
      if (!existing) { setError('The requested room was not found.'); return; }
      const currentSong = await fetchSong(existing.song_id);
      if (!currentSong) { setError('The room song was not found.'); return; }
      listeners.current = [subscribeToPlayers(existing.id, setPlayers), subscribeToSession(existing.id, setSession)];
      setSong(currentSong); setSession(existing); setPlayers(await fetchPlayers(existing.id));
    })();
  }, []);
  useEffect(() => () => { listeners.current.forEach(close => close()); soloPitchRef.current?.stop(); void soloScoreRef.current?.stop(); }, []);
  useEffect(() => {
    if (!session) return;
    const interval = window.setInterval(() => {
      void fetchPlayers(session.id).then(setPlayers);
      void fetchSectionScores(session.id).then(setSections).catch(() => setSections([]));
      setNow(Date.now());
    }, 800);
    return () => window.clearInterval(interval);
  }, [session]);
  useEffect(() => {
    if (session?.status !== 'playing') return;
    let frame = 0;
    const tick = () => { setNow(Date.now()); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [session?.status]);
  useEffect(() => { soloElapsedRef.current = timeline.songElapsed; soloPhaseRef.current = timeline.phase; }, [timeline.phase, timeline.songElapsed]);
  useEffect(() => {
    if (session?.paused && !gamePaused) {
      setPausedElapsed(runningTimeline.songElapsed); setGamePaused(true); pauseStartedRef.current = Date.now(); audioRef.current?.pause();
    }
  }, [session?.paused]);
  useEffect(() => {
    if (!session || !song || !soloPlayer || soloPart === null || session.status !== 'playing' || soloScoreStartedRef.current) return;
    soloScoreStartedRef.current = true;
    const scorer = new ScoreEngine({
      part: playablePart(song, soloPart), partIndex: soloPart, notes: playableNotes(song), songDuration: song.duration,
      playerId: soloPlayer.id, sessionId: session.id,
      onScoreUpdate: (_, total) => setSoloScore(total),
      onNoteResult: result => { setSoloHits(current => ({ ...current, [result.noteId]: result.points > 0 })); setSoloLastResult(result); },
    });
    soloScoreRef.current = scorer;
    scorer.start();
  }, [session, soloPart, soloPlayer, song]);
  useEffect(() => {
    if (session?.status !== 'playing' || !soloPlayer) return;
    const interval = window.setInterval(() => {
      const stats = soloScoreRef.current?.stats;
      if (!stats) return;
      void savePlayerRoundStats({ session_id: session.id, player_id: soloPlayer.id, score: soloScoreRef.current?.currentTotal ?? 0, accuracy: stats.accuracy, notes_attempted: stats.attempted, notes_hit: stats.hit });
    }, 3000);
    return () => window.clearInterval(interval);
  }, [session?.id, session?.status, soloPlayer]);
  useEffect(() => {
    if (session?.status !== 'ended' || !soloPlayer) return;
    soloPitchRef.current?.stop();
    const scorer = soloScoreRef.current;
    if (!scorer) return;
    const stats = scorer.stats;
    void scorer.stop().then(() => savePlayerRoundStats({ session_id: session.id, player_id: soloPlayer.id, score: scorer.currentTotal, accuracy: stats.accuracy, notes_attempted: stats.attempted, notes_hit: stats.hit }));
  }, [session?.id, session?.status, soloPlayer]);

  async function chooseSong(next: Song) {
    try {
      soloPitchRef.current?.stop(); void soloScoreRef.current?.stop(); soloScoreRef.current = null; soloScoreStartedRef.current = false;
      setSoloPart(null); setSoloPlayer(null); setSoloMic('unknown'); setSoloPitch(0); setSoloScore(0); setSoloHits({}); setSoloLastResult(null); setSoloFullBoard(false);
      setGamePaused(false); setPausedElapsed(0); pauseStartedRef.current = 0;
      const created = await createSession(next.id, 'worship-host');
      listeners.current.forEach(close => close());
      listeners.current = [subscribeToPlayers(created.id, setPlayers), subscribeToSession(created.id, setSession)];
      setSong(next); setSession(created); setPlayers(await fetchPlayers(created.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create room.'); }
  }
  async function startSoloPitchTracking(part: number) {
    if (soloPitchRef.current?.isRunning) return true;
    setSoloMic('checking');
    const range = PITCH_RANGES[part] ?? PITCH_RANGES[0];
    const engine = new PitchEngine({ bufferSize: 2048, confidenceThreshold: .76, smoothing: .22, minHz: PitchEngine.midiToHz(range.low - 3), maxHz: PitchEngine.midiToHz(range.high + 3), onPitch: sample => {
      if (performance.now() - soloLastPitchPaintRef.current > 33) { setSoloPitch(sample.frequency); soloLastPitchPaintRef.current = performance.now(); }
      if (soloPhaseRef.current === 'Live' && sample.confidence > .78) soloScoreRef.current?.scorePitch(sample.frequency, Math.max(0, soloElapsedRef.current));
    } });
    soloPitchRef.current = engine;
    try { await engine.start(); setSoloMic('ready'); return true; }
    catch { soloPitchRef.current = null; setSoloMic('blocked'); return false; }
  }
  async function startSolo(part: number) {
    if (!session || !song || soloStarting !== null) return;
    setSoloStarting(part); setError('');
    try {
      if (backingTrackUrl && audioRef.current) {
        audioRef.current.muted = true;
        void audioRef.current.play().then(() => { if (!audioRef.current) return; audioRef.current.pause(); audioRef.current.currentTime = 0; audioRef.current.muted = false; }).catch(() => undefined);
      }
      if (!await startSoloPitchTracking(part)) throw new Error('Microphone access is required for solo scoring. Please allow the microphone and try again.');
      const joined = await joinSession(session.id, 'Solo Singer', part);
      const readyAt = new Date().toISOString();
      await updatePlayerLobbyState(joined.id, { ready_at: readyAt, mic_status: 'ready' });
      const readyPlayer = { ...joined, ready_at: readyAt, mic_status: 'ready' as const };
      setSoloPart(part); setSoloPlayer(readyPlayer); setPlayers(current => [...current.filter(player => player.id !== readyPlayer.id), readyPlayer]);
      await start();
    } catch (cause) { soloPitchRef.current?.stop(); soloPitchRef.current = null; setSoloMic('unknown'); setError(cause instanceof Error ? cause.message : 'Unable to start solo practice.'); }
    finally { setSoloStarting(null); }
  }
  async function saveArrangement(values: Pick<Song, 'id' | 'title' | 'notes' | 'timed_lyrics' | 'backing_media_url' | 'backing_media_kind' | 'backing_track_settings'>) {
    if (!editingSong) return;
    try {
      const saved = await updateSong(editingSong.id, { title: values.title, notes: values.notes, timed_lyrics: values.timed_lyrics, backing_media_url: values.backing_media_url, backing_media_kind: values.backing_media_kind, backing_track_settings: values.backing_track_settings, audio_url: values.backing_media_url, status: values.notes?.length ? 'ready' : 'draft' });
      setSongs(current => current.some(item => item.id === saved.id) ? current.map(item => item.id === saved.id ? saved : item) : [saved, ...current]);
      setEditingSong(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save the arrangement.'); throw cause; }
  }
  async function createNewSong(title: string, artist: string) {
    setCreatingSong(true); setError('');
    try {
      const response = await fetch('/api/songs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, artist, tags: 'vocal-hero-manual' }) });
      const created = await response.json() as Song & { error?: string };
      if (!response.ok) throw new Error(created.error ?? 'Unable to create the song.');
      setSongs(current => [created, ...current.filter(item => item.id !== created.id)]);
      setShowCreateSong(false);
      setEditingSong(created);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create the song.'); }
    finally { setCreatingSong(false); }
  }
  async function start() {
    if (!session) return;
    try {
      if (backingTrackUrl && audioRef.current) {
        audioRef.current.muted = true; await audioRef.current.play(); audioRef.current.pause(); audioRef.current.currentTime = 0; audioRef.current.muted = false;
      }
      const scheduled = await scheduleSessionStart(session.id);
      setGamePaused(false); setPausedElapsed(0); pauseStartedRef.current = 0;
      setSession(scheduled);
      if (backingTrackUrl && audioRef.current && scheduled.playback_starts_at) {
        const startAt = new Date(scheduled.playback_starts_at).getTime() + ((scheduled.countdown_seconds ?? 5) + (scheduled.lead_in_seconds ?? 2)) * 1000;
        window.setTimeout(() => void audioRef.current?.play(), Math.max(0, startAt - (Date.now() + clockOffset)));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to schedule the session.'); }
  }

  async function pauseGame() {
    if (session?.status !== 'playing' || gamePaused) return;
    setPausedElapsed(runningTimeline.songElapsed);
    pauseStartedRef.current = Date.now();
    setGamePaused(true);
    audioRef.current?.pause();
    try { setSession(await setSessionPaused(session.id, true)); }
    catch (cause) { setGamePaused(false); setError(cause instanceof Error ? cause.message : 'Unable to pause the session.'); }
  }

  async function resumeGame() {
    if (!gamePaused || !session) return;
    const pauseDuration = Math.max(0, Date.now() - pauseStartedRef.current);
    try {
      const updated = await setSessionPaused(session.id, false, pauseDuration);
      setSession(updated); pauseStartedRef.current = 0; setGamePaused(false);
      if (backingTrackUrl && audioRef.current) {
        audioRef.current.currentTime = Math.min(pausedElapsed, Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : pausedElapsed);
        void audioRef.current.play().catch(() => setError('Press Resume again to allow backing-track playback.'));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to resume the session.'); }
  }

  function returnToLibrary() {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    soloPitchRef.current?.stop(); soloPitchRef.current = null;
    void soloScoreRef.current?.stop(); soloScoreRef.current = null; soloScoreStartedRef.current = false;
    listeners.current.forEach(close => close()); listeners.current = [];
    setSession(null); setSong(null); setPlayers([]); setSections([]);
    setSoloPart(null); setSoloPlayer(null); setSoloMic('unknown'); setSoloPitch(0); setSoloScore(0); setSoloHits({}); setSoloLastResult(null); setSoloFullBoard(false);
    setGamePaused(false); setPausedElapsed(0); pauseStartedRef.current = 0;
  }

  const notes = useMemo(() => song ? gameplayNotes(song, playableNotes(song)) : [], [song]);
  const phoneUrl = session ? `${window.location.origin}/vocal-hero/phone?room=${session.room_code}` : '';
  const stage = session?.status === 'playing' && song
      ? timeline.phase === 'Live' || timeline.phase === 'Paused'
      ? soloPlayer && soloPart !== null
        ? <SoloLiveStage song={song} notes={notes} part={soloPart} elapsed={timeline.songElapsed} pitch={soloPitch} score={soloScore} hits={soloHits} lastResult={soloLastResult} sections={sections} mic={soloMic} fullBoard={soloFullBoard} setFullBoard={setSoloFullBoard} />
        : <LiveStage song={song} notes={notes} players={players} sections={sections} elapsed={timeline.songElapsed} />
      : soloPlayer && soloPart !== null
        ? <SoloCountdownStage song={song} part={soloPart} phase={timeline.phase} mic={soloMic} />
        : <CountdownStage song={song} players={players} phase={timeline.phase} />
    : session && song
      ? <Lobby song={song} session={session} players={players} phoneUrl={phoneUrl} onStart={start} onStartSolo={startSolo} soloStarting={soloStarting} />
      : <SongPicker songs={songs} onChoose={chooseSong} onEdit={setEditingSong} onCreate={() => setShowCreateSong(true)} />;

  return <main className="vh-app min-h-screen text-slate-100">
    {backingTrackUrl && <audio ref={audioRef} preload="auto" src={backingTrackUrl} className="hidden" />}
    <header className="vh-topbar"><Brand /><span className="vh-divider" /><span className="text-xs tracking-[.2em] text-slate-400">{session ? 'LIVE SESSION' : 'SONG LIBRARY'}</span><span className="vh-live-dot">Live</span><div className="ml-auto flex flex-wrap items-center justify-end gap-2">{session?.status === 'playing' && <button onClick={gamePaused ? resumeGame : pauseGame} className="vh-outline-button border-cyan-300/35 text-cyan-100">{gamePaused ? '▶ Resume' : 'Ⅱ Pause'}</button>}{session && <button onClick={returnToLibrary} className="vh-outline-button">← Back to menu</button>}{session && <RoomCode code={session.room_code} />}<button onClick={() => window.open(session ? `/vocal-hero?fullscreen=1&room=${session.room_code}` : '/vocal-hero?fullscreen=1', '_blank', 'noopener')} className="vh-outline-button">Open full screen</button></div></header>
    {error && <p className="border-y border-rose-400/30 bg-rose-950/50 px-5 py-3 text-sm text-rose-200">{error}</p>}
    {stage}
    {editingSong && <ArrangementEditor song={editingSong} onClose={() => setEditingSong(null)} onSave={saveArrangement} />}
    {showCreateSong && <CreateSongDialog creating={creatingSong} onCancel={() => setShowCreateSong(false)} onCreate={createNewSong} />}
  </main>;
}

function Brand() { return <div className="text-2xl font-black tracking-tight">VOCAL<span className="bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">Hero</span></div>; }
function RoomCode({ code }: { code: string }) { return <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-400">Room code <b className="ml-2 font-mono tracking-wider text-[#ffd15c]">{code}</b></div>; }
function SongArt() { return <div className="grid h-24 w-24 shrink-0 place-items-center rounded-2xl border border-cyan-300/30 bg-[radial-gradient(circle_at_70%_25%,#38bdf866,transparent_35%),linear-gradient(145deg,#172554,#0b1022_55%,#581c8733)] text-4xl shadow-[0_0_30px_#5b21b633]">♫</div>; }
function SongDetails({ song }: { song: Song }) { return <div className="flex min-w-0 items-center gap-4"><SongArt /><div><h1 className="truncate text-2xl font-bold">{song.title}</h1><p className="mt-1 text-sm text-slate-400">{song.artist ? `Arr. by ${song.artist}` : 'Vocal Hero arrangement'}</p><div className="mt-3 flex flex-wrap gap-2"><Badge label={`${Math.round(song.duration / 60) || 3}:${String(Math.round(song.duration % 60) || 0).padStart(2, '0')}`} /><Badge label={`${song.time_sig ?? '4/4'}`} /><Badge label="Medium" /></div></div></div>; }
function Badge({ label }: { label: string }) { return <span className="rounded-lg border border-cyan-300/20 bg-cyan-300/[.05] px-2 py-1 text-xs text-cyan-200">{label}</span>; }

function SongPicker({ songs, onChoose, onEdit, onCreate }: { songs: Song[]; onChoose: (song: Song) => void; onEdit: (song: Song) => void; onCreate: () => void }) {
  return <section className="mx-auto max-w-6xl px-5 py-14"><div className="flex flex-wrap items-end justify-between gap-6"><div><p className="text-xs font-bold tracking-[.26em] text-fuchsia-300">VOCAL HERO LIBRARY</p><h1 className="mt-3 max-w-3xl text-5xl font-black tracking-tight sm:text-7xl">Build a room.<br /><span className="text-cyan-300">Raise every voice.</span></h1></div><button onClick={onCreate} className="vh-primary-button min-w-52 text-base">＋ Create new song</button></div><div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{songs.map(song => <article key={song.id} className="vh-panel p-5"><div className="mb-3 flex justify-end">{song.status === 'draft' && <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[.16em] text-amber-200">Draft</span>}</div><SongDetails song={song} /><div className="mt-5 flex gap-2"><button onClick={() => onEdit(song)} className="vh-outline-button flex-1">{song.status === 'draft' ? 'Continue editing' : 'Edit arrangement'}</button><button onClick={() => onChoose(song)} disabled={song.status !== 'ready'} title={song.status === 'ready' ? 'Open a multiplayer lobby' : 'Add at least one note and save before opening a lobby'} className="vh-primary-button flex-1 disabled:cursor-not-allowed disabled:opacity-35">{song.status === 'ready' ? 'Open lobby' : 'Finish setup'}</button></div></article>)}</div>{!songs.length && <div className="vh-panel mt-10 grid place-items-center px-6 py-16 text-center"><p className="text-xl font-semibold">Your Vocal Hero library is empty.</p><p className="mt-2 text-sm text-slate-400">Create a song, then draw notes or import MIDI in the arrangement editor.</p><button onClick={onCreate} className="vh-primary-button mt-6">＋ Create your first song</button></div>}</section>;
}

function CreateSongDialog({ creating, onCancel, onCreate }: { creating: boolean; onCancel: () => void; onCreate: (title: string, artist: string) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-[#020510]/85 p-4 backdrop-blur-md" onMouseDown={event => { if (event.target === event.currentTarget && !creating) onCancel(); }}><form onSubmit={event => { event.preventDefault(); if (title.trim()) void onCreate(title.trim(), artist.trim()); }} className="w-full max-w-lg overflow-hidden rounded-3xl border border-fuchsia-300/30 bg-[radial-gradient(circle_at_80%_0%,#3b1c6b88,transparent_38%),#090d22] shadow-[0_0_80px_#d946ef33]"><div className="border-b border-white/10 px-6 py-5"><p className="text-[10px] font-bold tracking-[.24em] text-fuchsia-300">NEW VOCAL HERO SONG</p><h2 className="mt-2 text-2xl font-black">Create a blank arrangement</h2><p className="mt-2 text-sm text-slate-400">Start with the song details, then draw notes, import MIDI, or add a synchronized backing track.</p></div><div className="space-y-4 px-6 py-5"><label className="block text-xs font-semibold text-slate-300">Song title <span className="text-fuchsia-300">*</span><input autoFocus required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Great Is Thy Faithfulness" className="mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-base text-white outline-none transition focus:border-fuchsia-300/70 focus:ring-2 focus:ring-fuchsia-400/15" /></label><label className="block text-xs font-semibold text-slate-300">Artist or arranger <span className="font-normal text-slate-500">(optional)</span><input maxLength={160} value={artist} onChange={event => setArtist(event.target.value)} placeholder="Name shown in the library" className="mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-base text-white outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-400/15" /></label><div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.05] p-3 text-xs leading-relaxed text-cyan-100">The song is saved immediately as a draft. It becomes ready for a lobby after you add at least one note and save the arrangement.</div></div><div className="flex justify-end gap-3 border-t border-white/10 px-6 py-4"><button type="button" onClick={onCancel} disabled={creating} className="vh-outline-button disabled:opacity-40">Cancel</button><button type="submit" disabled={creating || !title.trim()} className="vh-primary-button min-w-36 disabled:cursor-not-allowed disabled:opacity-40">{creating ? 'Creating…' : 'Create & edit'}</button></div></form></div>;
}

function Lobby({ song, session, players, phoneUrl, onStart, onStartSolo, soloStarting }: { song: Song; session: GameSession; players: SessionPlayer[]; phoneUrl: string; onStart: () => void; onStartSolo: (part: number) => void; soloStarting: number | null }) {
  const ready = players.filter(player => player.ready_at && !player.is_spectator).length;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&bgcolor=ffffff&color=070b1a&data=${encodeURIComponent(phoneUrl)}`;
  return <section className="mx-auto max-w-[1500px] px-5 py-6"><div className="vh-panel grid gap-6 p-5 lg:grid-cols-[.78fr_1.2fr] lg:p-7"><SongDetails song={song} /><div className="grid items-center gap-5 sm:grid-cols-[1fr_.9fr]"><div className="text-center"><p className="text-xs tracking-[.2em] text-fuchsia-200">SCAN TO JOIN THE LOBBY</p><img src={qr} alt="QR code to join this Vocal Hero lobby" className="mx-auto mt-3 h-48 w-48 rounded-2xl border-4 border-fuchsia-400 bg-white p-2 shadow-[0_0_40px_#e879f9aa]" /></div><div className="text-center"><p className="text-6xl font-black"><span className="text-fuchsia-400">{players.length}</span><span className="text-slate-500"> / 40</span></p><p className="mt-1 text-sm text-slate-300">joined</p><div className="mt-5 rounded-xl border border-fuchsia-400/30 bg-fuchsia-400/[.06] p-3 text-sm text-slate-200">Scan to join <span className="mx-2 text-fuchsia-300">•</span> choose a part <span className="mx-2 text-cyan-300">•</span> tap ready</div></div></div></div>
    <section className="mt-5 overflow-hidden rounded-2xl border border-cyan-300/25 bg-[radial-gradient(circle_at_85%_20%,#22d3ee1f,transparent_32%),linear-gradient(110deg,#07162d,#171038)] p-4 shadow-[0_14px_45px_#02061788]" aria-label="Solo practice"><div className="flex flex-wrap items-center gap-4"><div className="min-w-56 flex-1"><p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">No phone needed</p><h2 className="mt-1 text-xl font-black text-white">Start solo practice</h2><p className="mt-1 text-xs leading-relaxed text-slate-400">Choose your voice. This device will request the microphone, join as <b className="text-slate-200">Solo Singer</b>, and begin the synchronized countdown automatically.</p></div><div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-4">{VOICES.map((voice, index) => <button key={voice} type="button" disabled={soloStarting !== null} onClick={() => onStartSolo(index)} className="group min-w-28 rounded-xl border bg-black/20 px-3 py-3 text-left transition hover:-translate-y-0.5 hover:bg-white/[.06] disabled:cursor-wait disabled:opacity-45" style={{ borderColor: `${COLOURS[index]}66`, boxShadow: `inset 0 0 20px ${COLOURS[index]}0d` }}><span className="flex items-center gap-2"><b className="text-2xl" style={{ color: COLOURS[index] }}>{voice[0]}</b><span><b className="block text-xs text-white">{voice}</b><small className="text-[9px] text-slate-500">{soloStarting === index ? 'Starting…' : 'Sing this part'}</small></span></span></button>)}</div></div><p className="mt-3 border-t border-white/[.07] pt-3 text-[10px] text-slate-500">Headphones are recommended so the backing track does not enter the same microphone used for pitch scoring.</p></section>
    <div className="mt-5 grid gap-3 lg:grid-cols-4">{VOICES.map((voice, index) => <LobbyVoice key={voice} name={voice} index={index} players={players} />)}</div>
    <footer className="mt-5 flex flex-wrap items-center justify-between gap-4"><div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-400">Lobby chat will appear here when live chat is enabled.</div><button onClick={onStart} disabled={!players.some(player => !player.is_spectator)} className="vh-start-button">⌁ START PERFORMANCE <span className="ml-3 text-sm text-cyan-100">{ready} ready</span></button><div className="text-sm text-slate-400">Host can start when singers are ready.</div></footer></section>;
}

function LobbyVoice({ name, index, players }: { name: string; index: number; players: SessionPlayer[] }) { const members = players.filter(player => player.part_index === index && !player.is_spectator); const ready = members.filter(player => player.ready_at).length; return <article className="vh-voice-card" style={{ '--voice': COLOURS[index] } as React.CSSProperties}><div className="flex items-center justify-between"><div className="flex items-center gap-3"><b className="text-4xl" style={{ color: COLOURS[index] }}>{name[0]}</b><div><h2 className="font-bold" style={{ color: COLOURS[index] }}>{name.toUpperCase()}</h2><p className="text-xs text-slate-400">{members.length} players</p></div></div><span className="text-xs" style={{ color: COLOURS[index] }}>Ready {ready}/{members.length}</span></div><div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full" style={{ background: COLOURS[index], width: `${members.length ? ready / members.length * 100 : 0}%` }} /></div><div className="mt-3 space-y-2">{members.slice(0, 7).map(player => <div key={player.id} className="flex items-center gap-2 text-sm"><Avatar name={player.player_name} colour={COLOURS[index]} /><span className="min-w-0 flex-1 truncate">{player.player_name}</span><span className={`h-2 w-2 rounded-full ${player.mic_status === 'ready' ? 'bg-emerald-400' : 'bg-slate-600'}`} /></div>)}{!members.length && <p className="py-6 text-center text-xs text-slate-500">Waiting for singers</p>}</div></article>; }
function Avatar({ name, colour }: { name: string; colour: string }) { return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold text-[#07111d]" style={{ background: colour }}>{name.slice(0, 1).toUpperCase()}</span>; }

function CountdownStage({ song, players, phase }: { song: Song; players: SessionPlayer[]; phase: string }) { const number = Number(phase.match(/(\d+)/)?.[1] ?? 0); return <section className="mx-auto max-w-[1500px] px-5 py-7"><div className="vh-panel relative overflow-hidden p-6"><SongDetails song={song} /><div className="absolute inset-x-0 top-24 hidden justify-center lg:flex">{VOICES.map((voice, index) => <div key={voice} className="w-1/4 border-y border-white/10 px-5 py-4 text-sm" style={{ color: COLOURS[index] }}>{voice.toUpperCase()}<span className="float-right text-slate-500">••••••</span></div>)}</div><div className="relative mx-auto mt-7 grid h-[430px] max-w-xl place-items-center text-center"><div className="vh-count-ring"><div><p className="text-xs tracking-[.35em] text-fuchsia-200">GET READY</p><p className="mt-3 text-[10rem] font-black leading-none text-transparent [text-shadow:0_0_40px_#ec4899] bg-gradient-to-br from-fuchsia-400 via-violet-400 to-cyan-300 bg-clip-text">{number || '•'}</p><p className="text-lg font-semibold text-fuchsia-200">{phase.includes('Lead') ? 'Breathe in' : 'SONG BEGINS IN'}</p></div></div></div><div className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-4">{VOICES.map((voice, index) => { const count = players.filter(player => player.part_index === index && !player.is_spectator).length; const ready = players.filter(player => player.part_index === index && player.ready_at).length; return <div key={voice} className="vh-ready-card" style={{ borderColor: `${COLOURS[index]}88` }}><b style={{ color: COLOURS[index] }}>{voice}</b><span>{ready}/{count}</span><p className="mt-2 text-xs text-emerald-300">✓ READY</p></div>; })}</div><footer className="mt-6 text-center text-sm text-slate-300">◉ Eyes on your part <span className="mx-4 text-slate-600">|</span> ≋ Breathe in</footer></div></section>; }

function SoloCountdownStage({ song, part, phase, mic }: { song: Song; part: number; phase: string; mic: string }) {
  const number = Number(phase.match(/(\d+)/)?.[1] ?? 0);
  return <section className="mx-auto max-w-[1100px] px-5 py-7"><div className="vh-panel overflow-hidden p-6"><div className="flex flex-wrap items-center justify-between gap-4"><SongDetails song={song} /><div className="rounded-xl border px-4 py-3 text-right" style={{ borderColor: `${COLOURS[part]}55`, background: `${COLOURS[part]}0d` }}><p className="text-[10px] uppercase tracking-[.18em] text-slate-500">Solo voice</p><b className="text-xl" style={{ color: COLOURS[part] }}>{VOICES[part]}</b></div></div><div className="mx-auto mt-7 grid min-h-[430px] max-w-xl place-items-center text-center"><div className="vh-count-ring"><div><p className="text-xs tracking-[.35em]" style={{ color: COLOURS[part] }}>SOLO PRACTICE</p><p className="mt-3 text-[10rem] font-black leading-none text-transparent [text-shadow:0_0_40px_#ec4899] bg-gradient-to-br from-fuchsia-400 via-violet-400 to-cyan-300 bg-clip-text">{number || '•'}</p><p className="text-lg font-semibold text-fuchsia-200">{phase.includes('Lead') ? 'Listen · breathe · prepare' : 'SONG BEGINS IN'}</p></div></div></div><footer className="flex flex-wrap items-center justify-center gap-4 text-sm"><span className="rounded-full border border-emerald-300/25 bg-emerald-300/[.08] px-3 py-1.5 text-emerald-200">● {mic === 'ready' ? 'Microphone ready' : 'Checking microphone'}</span><span className="text-slate-400">Eyes on your {VOICES[part]} line</span></footer></div></section>;
}

function SoloLiveStage({ song, notes, part, elapsed, pitch, score, hits, lastResult, sections, mic, fullBoard, setFullBoard }: { song: Song; notes: SongNote[]; part: number; elapsed: number; pitch: number; score: number; hits: Record<string, boolean>; lastResult: NoteScoreResult | null; sections: SectionScore[]; mic: string; fullBoard: boolean; setFullBoard: (value: boolean) => void }) {
  const guide = isGuideMelody(notes);
  const lanePart = guide ? -1 : part;
  const laneNotes = notes.filter(note => note.part === lanePart || note.part === -1).sort((a, b) => a.start - b.start);
  const active = laneNotes.find(note => elapsed >= note.start && elapsed < note.end);
  const feedback = livePitchFeedback(active?.midi ?? null, pitch);
  const section = sections.find(item => item.part_index === part);
  const resultLabel = !lastResult ? 'Waiting for first note' : lastResult.points > 0 ? 'Note scored' : 'No points';
  // An octave-out note still scores — the singer just has to be told, or they
  // practise a different line to a perfect score and never find out.
  const octaves = Math.abs(lastResult?.octaveShift ?? 0);
  const octaveNotice = octaves
    ? `Right note, ${octaves === 1 ? 'an octave' : `${octaves} octaves`} ${(lastResult!.octaveShift) < 0 ? 'below' : 'above'} the written line`
    : '';
  return <section className="mx-auto max-w-[1350px] px-5 py-6"><div className="grid gap-4 xl:grid-cols-[1fr_300px]"><div><div className="vh-panel flex flex-wrap items-center gap-5 p-4"><SongDetails song={song} /><div className="ml-auto flex items-center gap-5"><div className="text-right"><p className="text-[10px] uppercase tracking-[.18em] text-slate-500">Your voice</p><b className="text-lg" style={{ color: COLOURS[part] }}>{VOICES[part]}</b></div><div className="text-right"><p className="text-3xl font-black text-fuchsia-300">{score.toLocaleString()}</p><p className="text-[9px] uppercase tracking-[.15em] text-slate-500">Personal score</p></div></div></div><div className="mt-4"><KaraokeLyrics song={song} notes={notes} partIndex={lanePart} elapsed={elapsed} /></div><div className="mt-4"><SatbLane partIndex={lanePart} partName={guide ? 'Melody guide' : VOICES[part]} colour={guide ? '#ff60bc' : COLOURS[part]} elapsed={elapsed} notes={notes} pitchHz={pitch} hitNotes={hits} lookAheadSeconds={7} showLyrics /></div>{!guide && <button onClick={() => setFullBoard(!fullBoard)} className="vh-outline-button mt-4">{fullBoard ? 'Hide full choir board' : 'Show full choir board'}</button>}{fullBoard && <div className="mt-3 space-y-2">{VOICES.map((voice, index) => <SatbLane key={voice} compact partIndex={index} partName={voice} colour={COLOURS[index]} elapsed={elapsed} notes={notes} pitchHz={index === part ? pitch : undefined} hitNotes={hits} lookAheadSeconds={5} />)}</div>}</div><aside className="vh-panel h-fit p-5"><p className="text-[10px] uppercase tracking-[.2em] text-slate-500">Live singing coach</p><div className="mt-4 space-y-3"><div className="rounded-xl border border-cyan-300/20 bg-cyan-300/[.04] p-4"><p className="text-xs text-slate-400">You sang / target</p><div className="mt-2 flex items-end justify-between"><b className="text-3xl text-cyan-200">{feedback.detected}</b><span className="text-slate-500">→</span><b className="text-3xl text-white">{feedback.target}</b></div><p className={`mt-3 text-sm font-black ${feedback.state === 'correct' ? 'text-emerald-300' : feedback.state === 'high' || feedback.state === 'low' ? 'text-amber-300' : 'text-slate-400'}`}>{feedback.label}</p><small className="text-slate-500">{feedback.difference} · {feedback.instruction}{feedback.cents !== null ? ` · target offset ${Math.abs(feedback.cents)} cents` : ''}</small></div><div className="rounded-xl border border-white/10 bg-white/[.035] p-4"><div className="flex items-center justify-between"><p className="text-xs text-slate-400">Last completed note</p><b className={lastResult?.points ? 'text-emerald-300' : 'text-slate-400'}>{resultLabel}</b></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="Timing" value={lastResult ? lastResult.onset : 0} /><Metric label="Pitch" value={lastResult ? lastResult.pitch : 0} /><Metric label="Hold" value={lastResult ? lastResult.hold : 0} /></div>{octaveNotice && <p className="mt-3 rounded-lg border border-amber-300/30 bg-amber-300/[.08] px-3 py-2 text-xs font-semibold text-amber-200">⚠ {octaveNotice}</p>}</div><div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-white/10 bg-white/[.035] p-3"><p className="text-xs text-slate-400">Session accuracy</p><b className="mt-1 block text-2xl" style={{ color: COLOURS[part] }}>{Math.round(section?.accuracy ?? 0)}%</b></div><div className="rounded-xl border border-emerald-300/20 bg-emerald-300/[.05] p-3"><p className="text-xs text-slate-400">Microphone</p><b className="mt-1 block text-sm text-emerald-300">{mic === 'ready' ? '● READY' : 'CHECK MIC'}</b></div></div></div></aside></div></section>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-black/20 p-2"><b className={value >= .65 ? 'text-emerald-300' : value > 0 ? 'text-amber-300' : 'text-slate-500'}>{Math.round(value * 100)}%</b><small className="mt-1 block text-[9px] uppercase tracking-wider text-slate-500">{label}</small></div>; }

function LiveStage({ song, notes, players, sections, elapsed }: { song: Song; notes: SongNote[]; players: SessionPlayer[]; sections: SectionScore[]; elapsed: number }) {
  const guide = isGuideMelody(notes);
  const sectionList = [...sections].sort((a, b) => b.accuracy - a.accuracy);
  return <section className="mx-auto max-w-[1500px] px-5 py-6">
    <div className="grid gap-5 xl:grid-cols-[1fr_330px]">
      <div>
        <div className="vh-panel mb-4 flex flex-wrap items-center gap-5 p-4">
          <SongDetails song={song} />
          <div className="ml-auto text-right"><p className="text-xs tracking-[.2em] text-slate-400">NOW PLAYING</p><p className="text-2xl font-bold text-cyan-200">{elapsed.toFixed(1)}s</p></div>
        </div>
        <div className="mb-4">{guide ? <KaraokeLyrics song={song} notes={notes} partIndex={-1} elapsed={elapsed} compact /> : <ChoirKaraokeLyrics song={song} notes={notes} elapsed={elapsed} />}</div>
        <div className="space-y-3">
          {guide ? <><p className="vh-guide-notice">Shared melody guide · author true SATB targets in Edit arrangement to show independent harmony lanes.</p><SatbLane partIndex={-1} partName="Melody guide" colour="#ff60bc" elapsed={elapsed} notes={notes} playerCount={players.length} /></> : VOICES.map((voice, index) => <SatbLane key={voice} partIndex={index} partName={voice} colour={COLOURS[index]} elapsed={elapsed} notes={notes} playerCount={players.filter(player => player.part_index === index && !player.is_spectator).length} />)}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <Leaderboard players={players} />
          <div className="vh-panel p-4"><p className="text-xs tracking-[.2em] text-slate-400">SECTION BLEND</p><div className="mt-4 grid grid-cols-4 gap-2">{VOICES.map((voice, index) => <div key={voice} className="rounded-xl bg-white/[.04] p-3 text-center"><b style={{ color: COLOURS[index] }}>{voice[0]}</b><p className="mt-1 text-xs text-slate-400">{Math.round(sections.find(item => item.part_index === index)?.accuracy ?? 0)}%</p></div>)}</div></div>
        </div>
      </div>
      <aside className="vh-panel h-fit p-5"><p className="text-xs tracking-[.2em] text-slate-400">LIVE SECTION BATTLE</p><div className="mt-4 space-y-3">{sectionList.length ? sectionList.map((section, rank) => <div key={section.part_index} className="rounded-xl border border-white/10 bg-white/[.035] p-3"><div className="flex items-center justify-between"><b style={{ color: COLOURS[section.part_index] }}>#{rank + 1} {VOICES[section.part_index]}</b><b>{Math.round(section.accuracy)}%</b></div><div className="mt-2 h-1.5 rounded-full bg-white/10"><span className="block h-full rounded-full" style={{ width: `${section.accuracy}%`, background: COLOURS[section.part_index] }} /></div></div>) : <p className="text-sm text-slate-500">Scores will appear as singers perform.</p>}</div></aside>
    </div>
  </section>;
}
function Leaderboard({ players }: { players: SessionPlayer[] }) { return <div className="vh-panel p-4"><div className="flex items-center justify-between"><p className="text-xs tracking-[.2em] text-slate-400">INDIVIDUAL LEADERBOARD</p><span className="text-xs text-fuchsia-300">Host only</span></div><div className="mt-3 space-y-2">{[...players].sort((a, b) => b.score - a.score).slice(0, 5).map((player, index) => <div key={player.id} className="flex items-center gap-2 text-sm"><span className="w-4 text-slate-500">{index + 1}</span><Avatar name={player.player_name} colour={COLOURS[player.part_index]} /><span className="flex-1 truncate">{player.player_name}</span><b className="font-mono">{player.score.toLocaleString()}</b></div>)}</div></div>; }

function timelineFor(session: GameSession | null, now: number) { if (!session?.playback_starts_at) return { phase: 'Waiting', songElapsed: 0 }; const delta = now - new Date(session.playback_starts_at).getTime(); const countdown = session.countdown_seconds ?? 5, lead = session.lead_in_seconds ?? 2; if (delta < 0) return { phase: `Starts in ${Math.ceil(-delta / 1000)}`, songElapsed: 0 }; const seconds = delta / 1000; if (seconds < countdown) return { phase: `Count-in ${countdown - Math.floor(seconds)}`, songElapsed: 0 }; if (seconds < countdown + lead) return { phase: 'Lead-in · listen', songElapsed: 0 }; return { phase: 'Live', songElapsed: seconds - countdown - lead }; }
