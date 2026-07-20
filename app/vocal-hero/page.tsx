'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createSession, fetchAllSongs, fetchPlayers, fetchSectionScores, fetchSessionByCode, fetchSong, scheduleSessionStart, updateSong,
  subscribeToPlayers, subscribeToSession,
} from '@/lib/vocal-hero/supabaseClient';
import type { GameSession, SectionScore, SessionPlayer, Song, SongNote } from '@/lib/vocal-hero/types';
import { SatbLane } from './SatbLane';
import { isGuideMelody, playableNotes } from '@/lib/vocal-hero/songData';
import { measureServerClockOffset } from '@/lib/vocal-hero/clock';
import { ArrangementEditor } from './ArrangementEditor';

const VOICES = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#ff60bc', '#a965ff', '#22d3ee', '#ffbd45'];

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
  const listeners = useRef<Array<() => void>>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const openedRoomRef = useRef(false);

  useEffect(() => { void fetchAllSongs().then(rows => setSongs(rows.filter(row => row.status === 'ready'))).catch(() => setError('Unable to load ready songs.')); }, []);
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
  useEffect(() => () => listeners.current.forEach(close => close()), []);
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

  async function chooseSong(next: Song) {
    try {
      const created = await createSession(next.id, 'worship-host');
      listeners.current.forEach(close => close());
      listeners.current = [subscribeToPlayers(created.id, setPlayers), subscribeToSession(created.id, setSession)];
      setSong(next); setSession(created); setPlayers(await fetchPlayers(created.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create room.'); }
  }
  async function saveArrangement(values: Pick<Song, 'id' | 'title' | 'notes' | 'backing_media_url' | 'backing_media_kind' | 'backing_track_settings'>) {
    if (!editingSong) return;
    try {
      const saved = await updateSong(editingSong.id, { title: values.title, notes: values.notes, backing_media_url: values.backing_media_url, backing_media_kind: values.backing_media_kind, backing_track_settings: values.backing_track_settings, audio_url: values.backing_media_url });
      setSongs(current => current.map(item => item.id === saved.id ? saved : item));
      setEditingSong(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save the arrangement.'); throw cause; }
  }
  async function start() {
    if (!session) return;
    try {
      if (song?.audio_url && audioRef.current) {
        audioRef.current.muted = true; await audioRef.current.play(); audioRef.current.pause(); audioRef.current.currentTime = 0; audioRef.current.muted = false;
      }
      const scheduled = await scheduleSessionStart(session.id);
      setSession(scheduled);
      if (song?.audio_url && audioRef.current && scheduled.playback_starts_at) {
        const startAt = new Date(scheduled.playback_starts_at).getTime() + ((scheduled.countdown_seconds ?? 5) + (scheduled.lead_in_seconds ?? 2)) * 1000;
        window.setTimeout(() => void audioRef.current?.play(), Math.max(0, startAt - (Date.now() + clockOffset)));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to schedule the session.'); }
  }

  const timeline = timelineFor(session, now + clockOffset);
  const notes = song ? playableNotes(song) : [];
  const phoneUrl = session ? `${window.location.origin}/vocal-hero/phone?room=${session.room_code}` : '';
  const stage = session?.status === 'playing' && song
    ? timeline.phase === 'Live'
      ? <LiveStage song={song} notes={notes} players={players} sections={sections} elapsed={timeline.songElapsed} />
      : <CountdownStage song={song} players={players} phase={timeline.phase} />
    : session && song
      ? <Lobby song={song} session={session} players={players} phoneUrl={phoneUrl} onStart={start} audioRef={audioRef} />
      : <SongPicker songs={songs} onChoose={chooseSong} onEdit={setEditingSong} />;

  return <main className="vh-app min-h-screen text-slate-100">
    <header className="vh-topbar"><Brand /><span className="vh-divider" /><span className="text-xs tracking-[.2em] text-slate-400">{session ? 'LIVE SESSION' : 'SONG LIBRARY'}</span><span className="vh-live-dot">Live</span><div className="ml-auto flex items-center gap-2">{session && <RoomCode code={session.room_code} />}<button onClick={() => window.open(session ? `/vocal-hero?fullscreen=1&room=${session.room_code}` : '/vocal-hero?fullscreen=1', '_blank', 'noopener')} className="vh-outline-button">Open full screen</button></div></header>
    {error && <p className="border-y border-rose-400/30 bg-rose-950/50 px-5 py-3 text-sm text-rose-200">{error}</p>}
    {stage}
    {editingSong && <ArrangementEditor song={editingSong} onClose={() => setEditingSong(null)} onSave={saveArrangement} />}
  </main>;
}

function Brand() { return <div className="text-2xl font-black tracking-tight">VOCAL<span className="bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">Hero</span></div>; }
function RoomCode({ code }: { code: string }) { return <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-400">Room code <b className="ml-2 font-mono tracking-wider text-[#ffd15c]">{code}</b></div>; }
function SongArt() { return <div className="grid h-24 w-24 shrink-0 place-items-center rounded-2xl border border-cyan-300/30 bg-[radial-gradient(circle_at_70%_25%,#38bdf866,transparent_35%),linear-gradient(145deg,#172554,#0b1022_55%,#581c8733)] text-4xl shadow-[0_0_30px_#5b21b633]">♫</div>; }
function SongDetails({ song }: { song: Song }) { return <div className="flex min-w-0 items-center gap-4"><SongArt /><div><h1 className="truncate text-2xl font-bold">{song.title}</h1><p className="mt-1 text-sm text-slate-400">{song.artist ? `Arr. by ${song.artist}` : 'Vocal Hero arrangement'}</p><div className="mt-3 flex flex-wrap gap-2"><Badge label={`${Math.round(song.duration / 60) || 3}:${String(Math.round(song.duration % 60) || 0).padStart(2, '0')}`} /><Badge label={`${song.time_sig ?? '4/4'}`} /><Badge label="Medium" /></div></div></div>; }
function Badge({ label }: { label: string }) { return <span className="rounded-lg border border-cyan-300/20 bg-cyan-300/[.05] px-2 py-1 text-xs text-cyan-200">{label}</span>; }

function SongPicker({ songs, onChoose, onEdit }: { songs: Song[]; onChoose: (song: Song) => void; onEdit: (song: Song) => void }) {
  return <section className="mx-auto max-w-6xl px-5 py-14"><p className="text-xs font-bold tracking-[.26em] text-fuchsia-300">VOCAL HERO LIBRARY</p><h1 className="mt-3 max-w-3xl text-5xl font-black tracking-tight sm:text-7xl">Build a room.<br /><span className="text-cyan-300">Raise every voice.</span></h1><div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{songs.map(song => <article key={song.id} className="vh-panel p-5"><SongDetails song={song} /><div className="mt-5 flex gap-2"><button onClick={() => onEdit(song)} className="vh-outline-button flex-1">Edit arrangement</button><button onClick={() => onChoose(song)} className="vh-primary-button flex-1">Open lobby</button></div></article>)}</div>{!songs.length && <p className="mt-10 text-slate-400">No ready songs yet.</p>}</section>;
}

function Lobby({ song, session, players, phoneUrl, onStart, audioRef }: { song: Song; session: GameSession; players: SessionPlayer[]; phoneUrl: string; onStart: () => void; audioRef: React.RefObject<HTMLAudioElement | null> }) {
  const ready = players.filter(player => player.ready_at && !player.is_spectator).length;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&bgcolor=ffffff&color=070b1a&data=${encodeURIComponent(phoneUrl)}`;
  return <section className="mx-auto max-w-[1500px] px-5 py-6"><div className="vh-panel grid gap-6 p-5 lg:grid-cols-[.78fr_1.2fr] lg:p-7"><SongDetails song={song} /><div className="grid items-center gap-5 sm:grid-cols-[1fr_.9fr]"><div className="text-center"><p className="text-xs tracking-[.2em] text-fuchsia-200">SCAN TO JOIN THE LOBBY</p><img src={qr} alt="QR code to join this Vocal Hero lobby" className="mx-auto mt-3 h-48 w-48 rounded-2xl border-4 border-fuchsia-400 bg-white p-2 shadow-[0_0_40px_#e879f9aa]" /></div><div className="text-center"><p className="text-6xl font-black"><span className="text-fuchsia-400">{players.length}</span><span className="text-slate-500"> / 40</span></p><p className="mt-1 text-sm text-slate-300">joined</p><div className="mt-5 rounded-xl border border-fuchsia-400/30 bg-fuchsia-400/[.06] p-3 text-sm text-slate-200">Scan to join <span className="mx-2 text-fuchsia-300">•</span> choose a part <span className="mx-2 text-cyan-300">•</span> tap ready</div></div></div></div>
    <div className="mt-5 grid gap-3 lg:grid-cols-4">{VOICES.map((voice, index) => <LobbyVoice key={voice} name={voice} index={index} players={players} />)}</div>
    {song.audio_url && <audio ref={audioRef} preload="auto" src={song.audio_url} className="hidden" />}
    <footer className="mt-5 flex flex-wrap items-center justify-between gap-4"><div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-400">Lobby chat will appear here when live chat is enabled.</div><button onClick={onStart} disabled={!players.some(player => !player.is_spectator)} className="vh-start-button">⌁ START PERFORMANCE <span className="ml-3 text-sm text-cyan-100">{ready} ready</span></button><div className="text-sm text-slate-400">Host can start when singers are ready.</div></footer></section>;
}

function LobbyVoice({ name, index, players }: { name: string; index: number; players: SessionPlayer[] }) { const members = players.filter(player => player.part_index === index && !player.is_spectator); const ready = members.filter(player => player.ready_at).length; return <article className="vh-voice-card" style={{ '--voice': COLOURS[index] } as React.CSSProperties}><div className="flex items-center justify-between"><div className="flex items-center gap-3"><b className="text-4xl" style={{ color: COLOURS[index] }}>{name[0]}</b><div><h2 className="font-bold" style={{ color: COLOURS[index] }}>{name.toUpperCase()}</h2><p className="text-xs text-slate-400">{members.length} players</p></div></div><span className="text-xs" style={{ color: COLOURS[index] }}>Ready {ready}/{members.length}</span></div><div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full" style={{ background: COLOURS[index], width: `${members.length ? ready / members.length * 100 : 0}%` }} /></div><div className="mt-3 space-y-2">{members.slice(0, 7).map(player => <div key={player.id} className="flex items-center gap-2 text-sm"><Avatar name={player.player_name} colour={COLOURS[index]} /><span className="min-w-0 flex-1 truncate">{player.player_name}</span><span className={`h-2 w-2 rounded-full ${player.mic_status === 'ready' ? 'bg-emerald-400' : 'bg-slate-600'}`} /></div>)}{!members.length && <p className="py-6 text-center text-xs text-slate-500">Waiting for singers</p>}</div></article>; }
function Avatar({ name, colour }: { name: string; colour: string }) { return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold text-[#07111d]" style={{ background: colour }}>{name.slice(0, 1).toUpperCase()}</span>; }

function CountdownStage({ song, players, phase }: { song: Song; players: SessionPlayer[]; phase: string }) { const number = Number(phase.match(/(\d+)/)?.[1] ?? 0); return <section className="mx-auto max-w-[1500px] px-5 py-7"><div className="vh-panel relative overflow-hidden p-6"><SongDetails song={song} /><div className="absolute inset-x-0 top-24 hidden justify-center lg:flex">{VOICES.map((voice, index) => <div key={voice} className="w-1/4 border-y border-white/10 px-5 py-4 text-sm" style={{ color: COLOURS[index] }}>{voice.toUpperCase()}<span className="float-right text-slate-500">••••••</span></div>)}</div><div className="relative mx-auto mt-7 grid h-[430px] max-w-xl place-items-center text-center"><div className="vh-count-ring"><div><p className="text-xs tracking-[.35em] text-fuchsia-200">GET READY</p><p className="mt-3 text-[10rem] font-black leading-none text-transparent [text-shadow:0_0_40px_#ec4899] bg-gradient-to-br from-fuchsia-400 via-violet-400 to-cyan-300 bg-clip-text">{number || '•'}</p><p className="text-lg font-semibold text-fuchsia-200">{phase.includes('Lead') ? 'Breathe in' : 'SONG BEGINS IN'}</p></div></div></div><div className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-4">{VOICES.map((voice, index) => { const count = players.filter(player => player.part_index === index && !player.is_spectator).length; const ready = players.filter(player => player.part_index === index && player.ready_at).length; return <div key={voice} className="vh-ready-card" style={{ borderColor: `${COLOURS[index]}88` }}><b style={{ color: COLOURS[index] }}>{voice}</b><span>{ready}/{count}</span><p className="mt-2 text-xs text-emerald-300">✓ READY</p></div>; })}</div><footer className="mt-6 text-center text-sm text-slate-300">◉ Eyes on your part <span className="mx-4 text-slate-600">|</span> ≋ Breathe in</footer></div></section>; }

function LiveStage({ song, notes, players, sections, elapsed }: { song: Song; notes: SongNote[]; players: SessionPlayer[]; sections: SectionScore[]; elapsed: number }) { const guide = isGuideMelody(notes); const sectionList = [...sections].sort((a, b) => b.accuracy - a.accuracy); return <section className="mx-auto max-w-[1500px] px-5 py-6"><div className="grid gap-5 xl:grid-cols-[1fr_330px]"><div><div className="vh-panel mb-4 flex flex-wrap items-center gap-5 p-4"><SongDetails song={song} /><div className="ml-auto text-right"><p className="text-xs tracking-[.2em] text-slate-400">NOW PLAYING</p><p className="text-2xl font-bold text-cyan-200">{elapsed.toFixed(1)}s</p></div></div><div className="space-y-3">{guide ? <><p className="vh-guide-notice">Shared melody guide · author true SATB targets in Edit arrangement to show independent harmony lanes.</p><SatbLane partIndex={-1} partName="Melody guide" colour="#ff60bc" elapsed={elapsed} notes={notes} playerCount={players.length} /></> : VOICES.map((voice, index) => <SatbLane key={voice} partIndex={index} partName={voice} colour={COLOURS[index]} elapsed={elapsed} notes={notes} playerCount={players.filter(player => player.part_index === index && !player.is_spectator).length} />)}</div><div className="mt-4 grid gap-3 lg:grid-cols-2"><Leaderboard players={players} /><div className="vh-panel p-4"><p className="text-xs tracking-[.2em] text-slate-400">SECTION BLEND</p><div className="mt-4 grid grid-cols-4 gap-2">{VOICES.map((voice, index) => <div key={voice} className="rounded-xl bg-white/[.04] p-3 text-center"><b style={{ color: COLOURS[index] }}>{voice[0]}</b><p className="mt-1 text-xs text-slate-400">{Math.round(sections.find(item => item.part_index === index)?.accuracy ?? 0)}%</p></div>)}</div></div></div></div><aside className="vh-panel h-fit p-5"><p className="text-xs tracking-[.2em] text-slate-400">LIVE SECTION BATTLE</p><div className="mt-4 space-y-3">{sectionList.length ? sectionList.map((section, rank) => <div key={section.part_index} className="rounded-xl border border-white/10 bg-white/[.035] p-3"><div className="flex items-center justify-between"><b style={{ color: COLOURS[section.part_index] }}>#{rank + 1} {VOICES[section.part_index]}</b><b>{Math.round(section.accuracy)}%</b></div><div className="mt-2 h-1.5 rounded-full bg-white/10"><span className="block h-full rounded-full" style={{ width: `${section.accuracy}%`, background: COLOURS[section.part_index] }} /></div></div>) : <p className="text-sm text-slate-500">Scores will appear as singers perform.</p>}</div></aside></div></section>; }
function Leaderboard({ players }: { players: SessionPlayer[] }) { return <div className="vh-panel p-4"><div className="flex items-center justify-between"><p className="text-xs tracking-[.2em] text-slate-400">INDIVIDUAL LEADERBOARD</p><span className="text-xs text-fuchsia-300">Host only</span></div><div className="mt-3 space-y-2">{[...players].sort((a, b) => b.score - a.score).slice(0, 5).map((player, index) => <div key={player.id} className="flex items-center gap-2 text-sm"><span className="w-4 text-slate-500">{index + 1}</span><Avatar name={player.player_name} colour={COLOURS[player.part_index]} /><span className="flex-1 truncate">{player.player_name}</span><b className="font-mono">{player.score.toLocaleString()}</b></div>)}</div></div>; }

function timelineFor(session: GameSession | null, now: number) { if (!session?.playback_starts_at) return { phase: 'Waiting', songElapsed: 0 }; const delta = now - new Date(session.playback_starts_at).getTime(); const countdown = session.countdown_seconds ?? 5, lead = session.lead_in_seconds ?? 2; if (delta < 0) return { phase: `Starts in ${Math.ceil(-delta / 1000)}`, songElapsed: 0 }; const seconds = delta / 1000; if (seconds < countdown) return { phase: `Count-in ${countdown - Math.floor(seconds)}`, songElapsed: 0 }; if (seconds < countdown + lead) return { phase: 'Lead-in · listen', songElapsed: 0 }; return { phase: 'Live', songElapsed: seconds - countdown - lead }; }
