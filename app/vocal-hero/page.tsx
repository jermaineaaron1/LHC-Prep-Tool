'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createSession, fetchAllSongs, fetchPlayers, fetchSectionScores, fetchSessionByCode, fetchSong, scheduleSessionStart,
  subscribeToPlayers, subscribeToSession,
} from '@/lib/vocal-hero/supabaseClient';
import type { GameSession, SectionScore, SessionPlayer, Song } from '@/lib/vocal-hero/types';
import { SatbLane } from './SatbLane';
import { isGuideMelody, playableNotes } from '@/lib/vocal-hero/songData';
import { measureServerClockOffset } from '@/lib/vocal-hero/clock';

const PARTS = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#ee86b5', '#f3a953', '#72aafb', '#6bd3a5'];

export default function VocalHeroHostPage() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [song, setSong] = useState<Song | null>(null);
  const [session, setSession] = useState<GameSession | null>(null);
  const [players, setPlayers] = useState<SessionPlayer[]>([]);
  const [sections, setSections] = useState<SectionScore[]>([]);
  const [now, setNow] = useState(Date.now());
  const [clockOffset, setClockOffset] = useState(0);
  const [error, setError] = useState('');
  const [showIndividuals, setShowIndividuals] = useState(false);
  const listeners = useRef<Array<() => void>>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const openedRoomRef = useRef(false);

  useEffect(() => { void fetchAllSongs().then(rows => setSongs(rows.filter(row => row.status === 'ready'))).catch(() => setError('Unable to load ready songs.')); }, []);
  useEffect(() => { void measureServerClockOffset().then(setClockOffset).catch(() => undefined); }, []);
  useEffect(() => {
    const roomCode = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('room');
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
    }, 1000);
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
    setError('');
    try {
      const created = await createSession(next.id, 'worship-host');
      listeners.current.forEach(close => close());
      listeners.current = [
        subscribeToPlayers(created.id, setPlayers),
        subscribeToSession(created.id, setSession),
      ];
      setSong(next); setSession(created); setPlayers(await fetchPlayers(created.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create room.'); }
  }

  async function start() {
    if (!session) return;
    try {
      // A successful user gesture unlocks the host speaker element before the
      // scheduled count-in. This is more reliable than a delayed autoplay call.
      if (song?.audio_url && audioRef.current) {
        audioRef.current.muted = true;
        await audioRef.current.play();
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.muted = false;
      }
      const scheduled = await scheduleSessionStart(session.id);
      setSession(scheduled);
      if (song?.audio_url && audioRef.current && scheduled.playback_starts_at) {
        const startAt = new Date(scheduled.playback_starts_at).getTime() + ((scheduled.countdown_seconds ?? 5) + (scheduled.lead_in_seconds ?? 2)) * 1000;
        window.setTimeout(() => { void audioRef.current?.play(); }, Math.max(0, startAt - (Date.now() + clockOffset)));
      }
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to schedule the session.'); }
  }

  const timeline = useMemo(() => timelineFor(session, now + clockOffset), [clockOffset, session, now]);
  const songTime = Math.max(0, timeline.songElapsed);
  const notes = song ? playableNotes(song) : [];
  const currentLyric = notes.find(note => (note.part === 0 || note.part === -1) && songTime >= note.start && songTime < note.end && note.lyric)?.lyric;
  const phoneUrl = session && typeof window !== 'undefined' ? `${window.location.origin}/vocal-hero/phone?room=${session.room_code}` : '';

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050b14] text-[#f7f3e8]" style={{ backgroundImage: 'radial-gradient(circle at 15% 0%, rgba(62,119,174,.25), transparent 36%), radial-gradient(circle at 90% 100%, rgba(75,165,126,.18), transparent 35%)' }}>
      <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b border-white/10 bg-[#07111de6] px-4 backdrop-blur-lg sm:px-7">
        <div className="font-serif text-xl font-bold tracking-tight">VOCAL<span className="text-[#f6c65b]">Hero</span></div>
        {song && <p className="min-w-0 flex-1 truncate text-sm text-slate-300">{song.title}{song.artist ? ` · ${song.artist}` : ''}</p>}
        {session && <span className="rounded-full border border-[#f6c65b]/30 bg-[#f6c65b]/10 px-3 py-1 font-mono text-xs tracking-widest text-[#f6c65b]">{session.room_code}</span>}
        <button onClick={() => window.open(session ? `/vocal-hero?fullscreen=1&room=${session.room_code}` : '/vocal-hero?fullscreen=1', '_blank', 'noopener')} className="rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold hover:bg-white/10">Open full screen</button>
      </header>

      {error && <p className="border-b border-red-500/40 bg-red-950/50 px-6 py-3 text-sm text-red-200">{error}</p>}

      {!session && <SongPicker songs={songs} onChoose={chooseSong} />}
      {session && song && session.status === 'lobby' && <Lobby song={song} session={session} players={players} phoneUrl={phoneUrl} onStart={start} audioRef={audioRef} />}
      {session && song && session.status === 'playing' && (
        <HostStage song={song} notes={notes} guideOnly={isGuideMelody(notes)} players={players} sections={sections} elapsed={songTime} phase={timeline.phase} lyric={currentLyric} showIndividuals={showIndividuals} setShowIndividuals={setShowIndividuals} />
      )}
      {session?.status === 'ended' && <Results players={players} sections={sections} />}
    </main>
  );
}

function SongPicker({ songs, onChoose }: { songs: Song[]; onChoose: (song: Song) => void }) {
  return <section className="mx-auto max-w-4xl px-5 py-16">
    <p className="text-xs font-bold uppercase tracking-[.28em] text-[#f6c65b]">Choir practice</p>
    <h1 className="mt-3 font-serif text-5xl font-semibold sm:text-7xl">Open a room.<br />Raise every voice.</h1>
    <p className="mt-5 max-w-xl text-slate-300">Select a prepared song to create a QR-enabled choir room. Every singer receives a private pitch view and personal result.</p>
    <div className="mt-10 grid gap-3 sm:grid-cols-2">
      {songs.map(song => <button key={song.id} onClick={() => onChoose(song)} className="rounded-2xl border border-white/10 bg-white/[.045] p-5 text-left transition hover:-translate-y-0.5 hover:border-[#f6c65b]/50 hover:bg-white/[.07]">
        <div className="flex items-start justify-between gap-3"><div><h2 className="font-serif text-xl">{song.title}</h2><p className="mt-1 text-sm text-slate-400">{song.artist || 'Worship arrangement'}</p></div><span className="text-[#f6c65b]">Start →</span></div>
        <div className="mt-5 flex gap-1.5">{PARTS.map((part, index) => <span key={part} className="h-1.5 flex-1 rounded-full" style={{ background: COLOURS[index] }} />)}</div>
      </button>)}
      {!songs.length && <p className="text-slate-400">No ready songs yet. Complete a song in the Vocal Hero library first.</p>}
    </div>
  </section>;
}

function Lobby({ song, session, players, phoneUrl, onStart, audioRef }: { song: Song; session: GameSession; players: SessionPlayer[]; phoneUrl: string; onStart: () => void; audioRef: React.RefObject<HTMLAudioElement | null> }) {
  const ready = players.filter(player => player.ready_at && !player.is_spectator).length;
  const qr = phoneUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&bgcolor=07111d&color=f7f3e8&data=${encodeURIComponent(phoneUrl)}` : '';
  return <section className="mx-auto grid max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[.9fr_1.1fr]">
    <aside className="rounded-3xl border border-white/10 bg-[#0b1726] p-7 text-center shadow-2xl">
      {qr && <img src={qr} alt="QR code to join this Vocal Hero room" className="mx-auto h-56 w-56 rounded-2xl" />}
      <p className="mt-5 text-xs uppercase tracking-[.25em] text-slate-400">Scan or enter room</p><p className="mt-2 font-mono text-5xl font-bold tracking-[.2em] text-[#f6c65b]">{session.room_code}</p>
      <p className="mt-3 break-all text-xs text-slate-500">{phoneUrl}</p>
    </aside>
    <div className="rounded-3xl border border-white/10 bg-white/[.04] p-7">
      <p className="text-xs font-bold uppercase tracking-[.25em] text-[#f6c65b]">Room ready</p><h1 className="mt-2 font-serif text-4xl">{song.title}</h1><p className="mt-1 text-slate-400">{song.artist || 'Worship arrangement'}</p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">{PARTS.map((part, index) => {
        const members = players.filter(player => player.part_index === index && !player.is_spectator);
        const partReady = members.filter(player => player.ready_at).length;
        return <div key={part} className="rounded-2xl border border-white/10 bg-[#08111f] p-4" style={{ boxShadow: `inset 3px 0 ${COLOURS[index]}` }}><div className="flex justify-between"><b>{part}</b><span className="text-sm" style={{ color: COLOURS[index] }}>{partReady}/{members.length} ready</span></div><p className="mt-3 min-h-5 text-xs text-slate-400">{members.length ? members.map(player => `${player.player_name}${player.mic_status === 'ready' ? ' ◉' : ''}`).join(' · ') : 'Waiting for singers'}</p></div>;
      })}</div>
      {song.audio_url && <div className="mt-4 rounded-2xl border border-white/10 bg-[#07111d] p-4"><p className="mb-2 text-xs uppercase tracking-[.17em] text-slate-400">Host speaker backtrack</p><audio ref={audioRef} controls preload="auto" src={song.audio_url} className="w-full" /></div>}
      <div className="mt-7 flex items-center justify-between gap-4 rounded-2xl border border-[#f6c65b]/20 bg-[#f6c65b]/[.07] p-4"><p className="text-sm text-slate-200"><b>{ready}</b> singers ready · host can start at any time</p><button onClick={onStart} disabled={!players.some(player => !player.is_spectator)} className="rounded-xl bg-[#f6c65b] px-5 py-3 font-bold text-[#07111d] disabled:opacity-40">Start 5-second count-in</button></div>
    </div>
  </section>;
}

function HostStage({ song, notes, guideOnly, players, sections, elapsed, phase, lyric, showIndividuals, setShowIndividuals }: { song: Song; notes: import('@/lib/vocal-hero/types').SongNote[]; guideOnly: boolean; players: SessionPlayer[]; sections: SectionScore[]; elapsed: number; phase: string; lyric?: string; showIndividuals: boolean; setShowIndividuals: (value: boolean) => void }) {
  return <section className="mx-auto max-w-[1600px] px-4 py-5">
    <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto]"><div className="rounded-2xl border border-white/10 bg-white/[.04] px-5 py-3"><span className="text-xs uppercase tracking-[.2em] text-[#f6c65b]">{phase}</span><p className="mt-1 min-h-8 text-2xl font-semibold sm:text-3xl">{lyric || 'Listen for the lead-in'}</p></div><button onClick={() => setShowIndividuals(!showIndividuals)} className="rounded-2xl border border-white/10 bg-[#0b1726] px-4 text-sm">{showIndividuals ? 'Hide individual scores' : 'Host analytics'}</button></div>
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <div className="space-y-3">{guideOnly
        ? <><div className="rounded-xl border border-[#f6c65b]/20 bg-[#f6c65b]/[.06] px-4 py-2 text-sm text-[#f7df9b]">Shared melody guide · one target is shown for each lyric. Add a SATB arrangement in the editor to show separate harmony lanes.</div><SatbLane partIndex={-1} partName="Melody guide" colour="#f6c65b" elapsed={elapsed} notes={notes} /></>
        : PARTS.map((part, index) => <SatbLane key={part} partIndex={index} partName={part} colour={COLOURS[index]} elapsed={elapsed} notes={notes} playerCount={players.filter(player => player.part_index === index && !player.is_spectator).length} />)}</div>
      <aside className="rounded-3xl border border-white/10 bg-[#0b1726] p-5"><h2 className="font-serif text-2xl">Choir board</h2><div className="mt-4 space-y-3">{PARTS.map((part, index) => { const score = sections.find(item => item.part_index === index); return <div key={part} className="rounded-xl bg-white/[.04] p-3"><div className="flex justify-between"><b style={{ color: COLOURS[index] }}>{part}</b><span>{score ? `${Math.round(score.accuracy)}%` : '—'}</span></div><p className="mt-1 text-xs text-slate-400">Normalized team accuracy · {score?.active_players ?? 0} active</p></div>; })}</div>
      {showIndividuals && <div className="mt-6 border-t border-white/10 pt-4"><p className="text-xs uppercase tracking-[.18em] text-slate-400">Private host analytics</p>{[...players].sort((a,b) => b.score-a.score).slice(0, 12).map(player => <p key={player.id} className="mt-2 flex justify-between text-sm"><span>{player.player_name}</span><span className="font-mono text-[#6bd3a5]">{player.score}</span></p>)}</div>}</aside>
    </div>
  </section>;
}

function Results({ players, sections }: { players: SessionPlayer[]; sections: SectionScore[] }) { return <section className="mx-auto max-w-3xl px-5 py-16 text-center"><p className="text-xs font-bold uppercase tracking-[.3em] text-[#f6c65b]">Session complete</p><h1 className="mt-3 font-serif text-5xl">Every voice counted.</h1><div className="mt-8 grid gap-3 sm:grid-cols-2">{PARTS.map((part,index) => <div key={part} className="rounded-2xl border border-white/10 bg-white/[.04] p-5"><b style={{ color: COLOURS[index] }}>{part}</b><p className="mt-2 text-3xl font-semibold">{Math.round(sections.find(item => item.part_index === index)?.accuracy ?? 0)}%</p><p className="text-xs text-slate-400">normalized team accuracy</p></div>)}</div><p className="mt-8 text-sm text-slate-400">{players.length} player results have been saved for host review.</p></section>; }

function timelineFor(session: GameSession | null, now: number) {
  if (!session?.playback_starts_at) return { phase: 'Waiting', songElapsed: 0 };
  const until = new Date(session.playback_starts_at).getTime() - now;
  const countdown = session.countdown_seconds ?? 5, leadIn = session.lead_in_seconds ?? 2;
  if (until > 0) return { phase: `Starts in ${Math.ceil(until / 1000)}`, songElapsed: 0 };
  const sinceStart = -until / 1000;
  if (sinceStart < countdown) return { phase: `Count-in · ${countdown - Math.floor(sinceStart)}`, songElapsed: 0 };
  if (sinceStart < countdown + leadIn) return { phase: 'Lead-in · listen', songElapsed: 0 };
  return { phase: 'Live', songElapsed: sinceStart - countdown - leadIn };
}
