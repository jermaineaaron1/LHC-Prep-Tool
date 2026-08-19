'use client';

import { useNarrow } from '@/lib/vocal-hero/useNarrow';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createSession, endSession, fetchAllSongs, fetchPlayers, fetchSectionScores, fetchSessionByCode, fetchSong, joinSession, savePlayerRoundStats,
  scheduleSessionStart, setSessionPaused, subscribeToPlayers, subscribeToSession, updatePlayerLobbyState, updateSong,
} from '@/lib/vocal-hero/supabaseClient';
import type { GameSession, SectionScore, SessionPlayer, Song, SongNote } from '@/lib/vocal-hero/types';
import { clearTrail, pushTrail } from '@/lib/vocal-hero/trail';
import type { TrailSample } from '@/lib/vocal-hero/trail';
import { isGuideMelody, playableNotes, playablePart } from '@/lib/vocal-hero/songData';
import { measureServerClockOffset } from '@/lib/vocal-hero/clock';
import { ArrangementEditor } from './ArrangementEditor';
import { MicError, PitchEngine, type MicFailure } from '@/lib/vocal-hero/pitchEngine';
import { ScoreEngine } from '@/lib/vocal-hero/scoreEngine';
import type { NoteScoreResult } from '@/lib/vocal-hero/scoreEngine';
import { RoundReviewPanel } from './RoundReview';
import { HighScoreBoard } from './HighScoreBoard';
import { CountInOverlay } from './CountInOverlay';
import { MicReportButton } from './MicReportButton';
import { CanvasLane } from './CanvasLane';
import { isPresent, lastSeenLabel } from '@/lib/vocal-hero/presence';
import { PracticeStage } from './PracticeStage';
import { weakestPassage } from '@/lib/vocal-hero/review';
import type { WeakPassage } from '@/lib/vocal-hero/review';
import type { LoopRegion } from '@/lib/vocal-hero/transport';
import { rememberPlayerName, storedPlayerName } from './playerName';
import { playEntranceCue } from '@/lib/vocal-hero/cueTones';
import { GuidePlayer, rememberGuideAudio, storedGuideAudio } from '@/lib/vocal-hero/guideTones';
import { useWakeLock } from '@/lib/vocal-hero/useWakeLock';
import { summariseRound } from '@/lib/vocal-hero/review';
import type { RoundReview } from '@/lib/vocal-hero/review';
import { TransposeBadge, TransposePicker, rememberTranspose, storedTranspose, transposeNotes } from './TransposePicker';
import { WarmUpBadge, WarmUpToggle } from './WarmUpToggle';
import { detectionRange, livePitchFeedback } from '@/lib/vocal-hero/liveCues';
import { ChoirKaraokeLyrics, KaraokeLyrics } from './KaraokeLyrics';
import { DifficultyPicker, rememberDifficulty, storedDifficulty } from './DifficultyPicker';
import { LatencyRow } from './LatencyCalibration';
import { storedLatencySec } from '@/lib/vocal-hero/latency';
import type { Difficulty } from '@/lib/vocal-hero/scoreEngine';

/** Words that name the actual fix. ‘Allow the microphone’ is wrong advice for
 *  five of these six, and it was the only sentence solo mode knew. */
const SOLO_MIC_TEXT: Record<MicFailure | 'unknown', string> = {
  blocked: 'Microphone permission was refused for this window. Allow it (padlock or ⋮ menu → Permissions), then try again — an installed app keeps a separate permission from the browser.',
  insecure: 'This page is not on HTTPS, so the browser will not hand out a microphone.',
  unsupported: 'This window offers no microphone API at all. Open the game in your browser — the “Open full screen” button above does exactly that.',
  notfound: 'No microphone was offered by this device. If a headset is plugged in, try removing it.',
  busy: 'Another app is holding the microphone. Close any call, recorder or voice assistant and try again.',
  unknown: 'The microphone could not be started. Reload and try once more.',
};

const VOICES = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const COLOURS = ['#ff60bc', '#a965ff', '#22d3ee', '#ffbd45'];
/** Time allowed after the last note before the round is called finished, so
 * that note's own scoring window closes first. */
const END_TAIL_SEC = 2.5;

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
  const [scoresFor, setScoresFor] = useState<Song | null>(null);
  // The solo singer's name, remembered per device. Read after mount like the
  // other stored settings.
  const [soloName, setSoloName] = useState('');
  useEffect(() => { setSoloName(storedPlayerName()); }, []);
  const [creatingSong, setCreatingSong] = useState(false);
  const [soloPart, setSoloPart] = useState<number | null>(null);
  // Practice runs entirely on its own transport with no session behind it,
  // which is what keeps the multiplayer round path exactly as it was.
  const [practiceSong, setPracticeSong] = useState<Song | null>(null);
  const [practiceLoop, setPracticeLoop] = useState<LoopRegion | null>(null);
  const [practicePart, setPracticePart] = useState<number | undefined>(undefined);
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
  // Scoring tolerance was defined in CENT_TOLERANCE from the start but never
  // passed, so every singer was silently locked to medium. It is local to the
  // scoring device, so the solo singer picks their own.
  const [difficulty, setDifficultyState] = useState<Difficulty>('medium');
  useEffect(() => { setDifficultyState(storedDifficulty()); }, []);
  function setDifficulty(next: Difficulty) { setDifficultyState(next); rememberDifficulty(next); }
  // The delay between the singer hearing a beat and this device analysing the
  // note they sang to it. Kept in a ref as well, because the pitch callback is
  // created once and would otherwise capture the value it started with.
  const [latencySec, setLatencySec] = useState(0);
  const latencyRef = useRef(0);
  useEffect(() => { const stored = storedLatencySec(); setLatencySec(stored); latencyRef.current = stored; }, []);
  function applyLatency(seconds: number) { setLatencySec(seconds); latencyRef.current = seconds; }
  // What the singer actually sang, in song time, for the lane to draw behind
  // the strike line. Held in a ref and mutated in place: the lane re-renders
  // every frame from the clock anyway, and pushing this through state would
  // re-render the whole page for each microphone sample.
  const trailRef = useRef<TrailSample[]>([]);
  // Every note's result, kept so the end of a round can say something more
  // useful than one number. Collected in a ref: nothing renders from it
  // until the song is over.
  const resultsRef = useRef<NoteScoreResult[]>([]);
  const [soloReview, setSoloReview] = useState<RoundReview | null>(null);
  // Shifts this singer's targets only. Read after mount like the other
  // per-device settings, and held in a ref too because the pitch engine is
  // built once with a frequency range that has to match the shifted line.
  const [transpose, setTransposeState] = useState(0);
  const transposeRef = useRef(0);
  useEffect(() => { const stored = storedTranspose(); setTransposeState(stored); transposeRef.current = stored; }, []);
  function setTranspose(next: number) { setTransposeState(next); transposeRef.current = next; rememberTranspose(next); }
  // Not remembered between sessions: silently discarding a real round would
  // be far worse than having to switch this on each time.
  const [warmUp, setWarmUp] = useState(false);
  const warmUpRef = useRef(false);
  useEffect(() => { warmUpRef.current = warmUp; }, [warmUp]);
  const listeners = useRef<Array<() => void>>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const openedRoomRef = useRef(false);
  const soloPitchRef = useRef<PitchEngine | null>(null);
  // WHY the microphone failed, kept beside the fact that it did. Every failure
  // used to surface as the same permission sentence, which sent singers to a
  // settings screen that already said Allow.
  const soloMicReasonRef = useRef<MicFailure | null>(null);
  const soloScoreRef = useRef<ScoreEngine | null>(null);
  const soloScoreStartedRef = useRef(false);
  const soloElapsedRef = useRef(0);
  const soloPhaseRef = useRef('Waiting');
  const soloLastPitchPaintRef = useRef(0);
  const cueContextRef = useRef<AudioContext | null>(null);
  // The written line, UNtransposed: detectionRange applies the shift itself,
  // so handing it already-shifted notes would count the transpose twice.
  const notesRef = useRef<SongNote[]>([]);
  // The live pitch, for the canvas to draw at 60fps. The state copy below is
  // throttled for the text readout, which nobody reads that fast.
  const soloPitchValueRef = useRef(0);
  const soloLevelRef = useRef(0);
  // Whatever the clock loop needs, refreshed on each render so the loop never
  // closes over a stale session or a stale pause.
  const clockInputsRef = useRef({ session: null as GameSession | null, clockOffset: 0, gamePaused: false, pausedElapsed: 0 });
  // The written notes, sounded through whatever speakers this machine has.
  // On by default here: the host is the one device in the room everybody can
  // hear, so it plays the part a piano would at a rehearsal.
  const [guideAudio, setGuideAudioState] = useState(true);
  useEffect(() => { setGuideAudioState(storedGuideAudio(true)); }, []);
  function setGuideAudio(on: boolean) { setGuideAudioState(on); rememberGuideAudio(on); }
  const cuedRef = useRef({ outer: false, inner: false });
  const pauseStartedRef = useRef(0);
  const endedRef = useRef(false);
  // When the round is over: past the written duration and the last note alike,
  // plus a tail so the final note's own scoring window can close.
  const finishesAt = useMemo(() => {
    if (!song) return Number.POSITIVE_INFINITY;
    const lastNote = playableNotes(song).reduce((latest, note) => Math.max(latest, note.end), 0);
    return Math.max(song.duration || 0, lastNote) + END_TAIL_SEC;
  }, [song]);
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
  useEffect(() => () => { listeners.current.forEach(close => close()); soloPitchRef.current?.stop(); void soloScoreRef.current?.stop(); void cueContextRef.current?.close().catch(() => undefined); }, []);
  /* A room now closes ONLY when the host says so -- 'Back to menu', or picking
     a different song. Nothing automatic.

     Two earlier attempts were both worse than the accumulation they were meant
     to prevent. Closing on visibilitychange killed the room the instant the
     host tab lost focus, which is what happens the moment anyone opens the
     phone URL in a second tab; two rooms died inside two minutes. Closing on
     pagehide was subtler but still wrong, because a refresh is not leaving.

     An abandoned room lingering is untidy. A room that vanishes while singers
     are joining it is broken, and tidiness is not worth that. */
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
    let lastPaint = 0;
    const tick = () => {
      const at = Date.now();
      const inputs = clockInputsRef.current;
      const live = timelineFor(inputs.session, at + inputs.clockOffset);
      // Scoring reads these, so they must stay frame-accurate: at the throttled
      // render rate below they would be up to 50ms stale, which is a third of
      // the perfect-onset window.
      soloElapsedRef.current = inputs.gamePaused ? inputs.pausedElapsed : live.songElapsed;
      soloPhaseRef.current = inputs.gamePaused ? 'Paused' : live.phase;
      // The lane draws itself from the refs above; this is only for the text.
      if (at - lastPaint > 50) { lastPaint = at; setNow(at); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [session?.status]);
  // Refreshed every render; read by the animation loop above.
  clockInputsRef.current = { session, clockOffset, gamePaused, pausedElapsed };
  // While no round is running the loop is not mounted, so the refs are kept
  // in step here for the lobby and the review.
  useEffect(() => { if (session?.status === 'playing') return; soloElapsedRef.current = timeline.songElapsed; soloPhaseRef.current = timeline.phase; }, [session?.status, timeline.phase, timeline.songElapsed]);
  // Finish the round when the song runs out.
  //
  // Nothing did this. endSession() existed and was called from nowhere, and the
  // timeline had no end: past the lead-in it returned Live for ever with the
  // elapsed time climbing. So a session never reached 'ended', and everything
  // waiting on that never happened -- the review, the phones' closing screen,
  // the final save, the last flush -- while the microphone stayed open long
  // after the singing stopped.
  //
  // The host owns the clock that started the round, so the host ends it, and
  // the phones learn through the subscription they already have.
  useEffect(() => {
    if (session?.status !== 'playing' || !song || endedRef.current) return;
    if (timeline.phase !== 'Live') return;
    if (timeline.songElapsed < finishesAt) return;
    endedRef.current = true;
    audioRef.current?.pause();
    void endSession(session.id).catch(() => { endedRef.current = false; });
  }, [finishesAt, session?.id, session?.status, song, timeline.phase, timeline.songElapsed]);
  useEffect(() => {
    if (session?.paused && !gamePaused) {
      setPausedElapsed(runningTimeline.songElapsed); setGamePaused(true); pauseStartedRef.current = Date.now(); audioRef.current?.pause();
    }
  }, [session?.paused]);
  useEffect(() => {
    if (!session || !song || !soloPlayer || soloPart === null || session.status !== 'playing' || soloScoreStartedRef.current) return;
    soloScoreStartedRef.current = true;
    const scorer = new ScoreEngine({
      part: playablePart(song, soloPart), partIndex: soloPart, notes: transposeNotes(playableNotes(song), transpose), songDuration: song.duration,
      playerId: soloPlayer.id, sessionId: session.id, difficulty, practice: warmUp,
      onScoreUpdate: (_, total) => setSoloScore(total),
      onNoteResult: result => { resultsRef.current.push(result); setSoloHits(current => ({ ...current, [result.noteId]: result.points > 0 })); setSoloLastResult(result); },
    });
    soloScoreRef.current = scorer;
    scorer.start();
  }, [difficulty, session, soloPart, soloPlayer, song, transpose, warmUp]);
  useEffect(() => {
    if (session?.status !== 'playing' || !soloPlayer) return;
    const interval = window.setInterval(() => {
      const stats = soloScoreRef.current?.stats;
      if (!stats || warmUpRef.current) return;
      void savePlayerRoundStats({ session_id: session.id, player_id: soloPlayer.id, score: soloScoreRef.current?.currentTotal ?? 0, accuracy: stats.accuracy, notes_attempted: stats.attempted, notes_hit: stats.hit });
    }, 3000);
    return () => window.clearInterval(interval);
  }, [session?.id, session?.status, soloPlayer]);
  useEffect(() => {
    if (session?.status !== 'ended' || !soloPlayer) return;
    soloPitchRef.current?.stop();
    if (song) setSoloReview(summariseRound(resultsRef.current, transposeNotes(playableNotes(song), transposeRef.current)));
    const scorer = soloScoreRef.current;
    if (!scorer) return;
    // stop() resolves the note still in progress, so the counts change during
    // it. Read beforehand, they omitted the last note of every round.
    void scorer.stop().then(() => {
      if (warmUpRef.current) return;
      const stats = scorer.stats;
      void savePlayerRoundStats({ session_id: session.id, player_id: soloPlayer.id, score: scorer.currentTotal, accuracy: stats.accuracy, notes_attempted: stats.attempted, notes_hit: stats.hit });
    });
  }, [session?.id, session?.status, soloPlayer]);

  // The host screen is usually a projector or a laptop left alone on a stand.
  useWakeLock(Boolean(session) && session?.status !== 'ended');

  /* A round only ever ended by playing to the finish, so every abandoned one
     stayed 'playing' and showed up as a live room. Every exit closes it now.
     Beacon rather than fetch on teardown: the browser will not wait for a
     promise while the page is going away. */
  function closeRound(sessionId: string | undefined, viaBeacon = false) {
    if (!sessionId) return;
    const body = JSON.stringify({ sessionId });
    if (viaBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/vocal-hero/abandon', new Blob([body], { type: 'application/json' }));
      return;
    }
    void fetch('/api/vocal-hero/abandon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => undefined);
  }

  async function chooseSong(next: Song) {
    try {
      soloPitchRef.current?.stop(); void soloScoreRef.current?.stop(); soloScoreRef.current = null; soloScoreStartedRef.current = false;
      setSoloPart(null); setSoloPlayer(null); setSoloMic('unknown'); setSoloPitch(0); setSoloScore(0); setSoloHits({}); setSoloLastResult(null); setSoloFullBoard(false); clearTrail(trailRef.current); resultsRef.current = []; setSoloReview(null); endedRef.current = false;
      setGamePaused(false); setPausedElapsed(0); pauseStartedRef.current = 0;
      cuedRef.current = { outer: false, inner: false };
      // Picking a different song abandons the room this one was in.
      closeRound(session?.id);
      const created = await createSession(next.id, 'worship-host');
      listeners.current.forEach(close => close());
      listeners.current = [subscribeToPlayers(created.id, setPlayers), subscribeToSession(created.id, setSession)];
      setSong(next); setSession(created); setPlayers(await fetchPlayers(created.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create room.'); }
  }
  async function startSoloPitchTracking(part: number) {
    if (soloPitchRef.current?.isRunning) return true;
    setSoloMic('checking');
    const shift = transposeRef.current;
    const engine = new PitchEngine({ bufferSize: 2048, confidenceThreshold: .76, smoothing: .22, minHz: PitchEngine.midiToHz(detectionRange(part, shift, notesRef.current).minMidi), maxHz: PitchEngine.midiToHz(detectionRange(part, shift, notesRef.current).maxMidi), onPitch: sample => {
      if (performance.now() - soloLastPitchPaintRef.current > 33) { setSoloPitch(sample.frequency); soloLastPitchPaintRef.current = performance.now(); }
      // This sample is the sound of a moment already past: the beat took time to
      // reach the singer's ears, and their answer took time to reach the analyser.
      // Scoring it against the clock as it stands now would mark every note late.
      soloPitchValueRef.current = sample.frequency;
      soloLevelRef.current = sample.level ?? 0;
      if (soloPhaseRef.current === 'Live' && sample.confidence > .78) {
        const songTime = Math.max(0, soloElapsedRef.current - latencyRef.current);
        soloScoreRef.current?.scorePitch(sample.frequency, songTime);
        pushTrail(trailRef.current, songTime, sample.frequency);
      }
    } });
    soloPitchRef.current = engine;
    try { await engine.start(); setSoloMic('ready'); return true; }
    catch (cause) { soloPitchRef.current = null; setSoloMic('blocked'); soloMicReasonRef.current = cause instanceof MicError ? cause.reason : 'unknown'; return false; }
  }
  async function startSolo(part: number) {
    if (!session || !song || soloStarting !== null) return;
    setSoloStarting(part); setError('');
    try {
      if (backingTrackUrl && audioRef.current) {
        audioRef.current.muted = true;
        void audioRef.current.play().then(() => { if (!audioRef.current) return; audioRef.current.pause(); audioRef.current.currentTime = 0; audioRef.current.muted = false; }).catch(() => undefined);
      }
      if (!await startSoloPitchTracking(part)) throw new Error(SOLO_MIC_TEXT[soloMicReasonRef.current ?? 'unknown']);
      const singerName = soloName.trim().slice(0, 40) || 'Solo Singer';
      rememberPlayerName(singerName === 'Solo Singer' ? '' : singerName);
      const joined = await joinSession(session.id, singerName, part);
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
      // Built here, inside the click, because an AudioContext created later
      // starts suspended under browser autoplay rules and the reference notes
      // would never sound. Both countdowns are armed again for the new round.
      cueContextRef.current ??= new AudioContext({ latencyHint: 'interactive' });
      if (cueContextRef.current.state === 'suspended') void cueContextRef.current.resume();
      cuedRef.current = { outer: false, inner: false };
      if (backingTrackUrl && audioRef.current) {
        audioRef.current.muted = true; await audioRef.current.play(); audioRef.current.pause(); audioRef.current.currentTime = 0; audioRef.current.muted = false;
      }
      const scheduled = await scheduleSessionStart(session.id);
      setGamePaused(false); setPausedElapsed(0); pauseStartedRef.current = 0;
      // Starting a round clears the record of the one before it. Rounds can
      // end now, and the lobby's start button can be pressed again -- without
      // this, a restarted round inherited endedRef from the last one and could
      // never finish, and a repeated solo round would stack its results onto
      // the previous review.
      endedRef.current = false;
      resultsRef.current = [];
      setSoloReview(null);
      clearTrail(trailRef.current);
      setSoloScore(0); setSoloHits({}); setSoloLastResult(null);
      // The solo scorer belongs to the round that created it; the effect that
      // builds one runs again once the new round is playing.
      void soloScoreRef.current?.stop(); soloScoreRef.current = null; soloScoreStartedRef.current = false;
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
        // Pausing during the count-in captures a negative song time, and a
        // negative currentTime is not a valid seek.
        audioRef.current.currentTime = Math.max(0, Math.min(pausedElapsed, Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : pausedElapsed));
        void audioRef.current.play().catch(() => setError('Press Resume again to allow backing-track playback.'));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to resume the session.'); }
  }

  function returnToLibrary() {
    closeRound(session?.id);
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    soloPitchRef.current?.stop(); soloPitchRef.current = null;
    void soloScoreRef.current?.stop(); soloScoreRef.current = null; soloScoreStartedRef.current = false;
    listeners.current.forEach(close => close()); listeners.current = [];
    setSession(null); setSong(null); setPlayers([]); setSections([]);
    setSoloPart(null); setSoloPlayer(null); setSoloMic('unknown'); setSoloPitch(0); setSoloScore(0); setSoloHits({}); setSoloLastResult(null); setSoloFullBoard(false); clearTrail(trailRef.current); resultsRef.current = []; setSoloReview(null); endedRef.current = false;
    setGamePaused(false); setPausedElapsed(0); pauseStartedRef.current = 0;
  }

  const notes = useMemo(() => song ? playableNotes(song) : [], [song]);
  notesRef.current = notes;
  const soloNotes = useMemo(() => transposeNotes(notes, transpose), [notes, transpose]);
  // The starting notes, sounded once in each countdown: once while the round is
  // being scheduled, and again once the in-game count begins. Two hearings
  // spaced apart beat one -- the first says what is coming, the second refreshes
  // it right before the singer has to produce it.
  //
  // Solo only. In a multiplayer room every phone plays its own singer's part,
  // and the host speaker sounding one voice's notes would be the wrong pitch for
  // three quarters of the room.
  //
  // The phase string ticks every second ('Count-in 5', 'Count-in 4'), so this
  // re-runs throughout; the per-round flags keep each countdown to one playing.
  useEffect(() => {
    if (soloPart === null || !song || session?.status !== 'playing') return;
    const outer = timeline.phase.startsWith('Starts in'), inner = timeline.phase.startsWith('Count-in');
    if (!outer && !inner) return;
    if (outer ? cuedRef.current.outer : cuedRef.current.inner) return;
    if (outer) cuedRef.current.outer = true; else cuedRef.current.inner = true;
    const context = cueContextRef.current ?? new AudioContext({ latencyHint: 'interactive' });
    playEntranceCue(context, soloNotes, soloPart);
    if (context !== cueContextRef.current) window.setTimeout(() => void context.close(), 1800);
  }, [session?.status, soloNotes, soloPart, song, timeline.phase]);

  // Sound the arrangement in time with the round.
  //
  // Driven by a coarse timer rather than the render loop: notes are handed to
  // the audio clock ahead of time, so a slow frame delays nothing. Suppressed
  // when the song has a real backing track, which would otherwise play
  // underneath it, and reset on pause so queued notes do not sound on into
  // the silence.
  useEffect(() => {
    if (!guideAudio || !song || session?.status !== 'playing' || backingTrackUrl) return;
    const context = cueContextRef.current;
    if (!context) return;
    const player = new GuidePlayer(context);
    const timer = window.setInterval(() => {
      if (gamePaused) { player.reset(); return; }
      if (!soloPhaseRef.current.startsWith('Live')) return;
      player.update(soloNotes, soloElapsedRef.current);
    }, 60);
    return () => { window.clearInterval(timer); player.dispose(); };
  }, [backingTrackUrl, gamePaused, guideAudio, session?.status, session?.playback_starts_at, song, soloNotes]);

  const phoneUrl = session ? `${window.location.origin}/vocal-hero/phone?room=${session.room_code}` : '';
  // The musical count-in and lead-in happen INSIDE the game: lanes visible,
  // bar frozen at zero, the count carried by an overlay. Only the scheduled
  // start ('Starts in N') keeps the full-screen countdown, so a round counts
  // down once instead of twice back to back.
  const preRoll = session?.status === 'playing' && (timeline.phase.startsWith('Count-in') || timeline.phase.startsWith('Lead-in'));
  const stage = session?.status === 'playing' && song
      ? timeline.phase === 'Live' || timeline.phase === 'Paused' || preRoll
      ? soloPlayer && soloPart !== null
        ? <SoloLiveStage getElapsed={() => soloElapsedRef.current} getPitch={() => soloPitchValueRef.current} getLevel={() => soloLevelRef.current} song={song} notes={soloNotes} transpose={transpose} warmUp={warmUp} part={soloPart} elapsed={timeline.songElapsed} pitch={soloPitch} score={soloScore} hits={soloHits} lastResult={soloLastResult} sections={sections} mic={soloMic} fullBoard={soloFullBoard} setFullBoard={setSoloFullBoard} trail={trailRef.current} getEngine={() => soloPitchRef.current} />
        : <LiveStage getElapsed={() => soloElapsedRef.current} song={song} notes={notes} players={players} sections={sections} elapsed={timeline.songElapsed} />
      : soloPlayer && soloPart !== null
        ? <SoloCountdownStage song={song} part={soloPart} phase={timeline.phase} mic={soloMic} getLevel={() => soloLevelRef.current} getEngine={() => soloPitchRef.current} />
        : <CountdownStage song={song} players={players} phase={timeline.phase} />
    : session?.status === 'ended' && song && soloReview && soloPart !== null
      ? <SoloReviewStage song={song} part={soloPart} score={soloScore} review={soloReview} warmUp={warmUp} playerName={soloPlayer?.player_name ?? 'Solo Singer'}
        weakest={soloPart === null ? null : weakestPassage(soloNotes, resultsRef.current, soloPart)}
        onPractiseWeakest={passage => {
          /* A score says how it went; it does not say where to go back to, and
             "sing it all again" is not practice. This opens the phrase that went
             worst, already looping, with the playhead on it. */
          setPracticeLoop({ start: passage.start, end: passage.end });
          setPracticePart(soloPart ?? 0);
          setPracticeSong(song);
        }} onDone={returnToLibrary} />
    : session?.status === 'ended' && song
      ? <HostRoundEndStage song={song} players={players} sections={sections} onAgain={() => void start()} onDone={returnToLibrary} />
    : session && song
      ? <Lobby song={song} session={session} players={players} phoneUrl={phoneUrl} onStart={start} onStartSolo={startSolo} soloStarting={soloStarting} difficulty={difficulty} setDifficulty={setDifficulty} latencySec={latencySec} applyLatency={applyLatency} transpose={transpose} setTranspose={setTranspose} warmUp={warmUp} setWarmUp={setWarmUp} soloName={soloName} setSoloName={setSoloName} />
      : practiceSong
        ? <PracticeStage song={practiceSong} initialLoop={practiceLoop} initialPart={practicePart} onExit={() => { setPracticeSong(null); setPracticeLoop(null); setPracticePart(undefined); }} />
        : <SongPicker songs={songs} onChoose={chooseSong} onEdit={setEditingSong} onCreate={() => setShowCreateSong(true)} onScores={setScoresFor} onPractice={setPracticeSong} />;

  return <main className="vh-app min-h-screen overflow-x-hidden text-slate-100">
    {backingTrackUrl && <audio ref={audioRef} preload="auto" src={backingTrackUrl} className="hidden" />}
    <header className="vh-topbar"><Brand /><span className="vh-divider" /><span className="text-xs tracking-[.2em] text-slate-400">{session ? 'LIVE SESSION' : 'SONG LIBRARY'}</span><span className="vh-live-dot">Live</span><div className="ml-auto flex flex-wrap items-center justify-end gap-2">{session?.status === 'playing' && <button onClick={gamePaused ? resumeGame : pauseGame} className="vh-outline-button border-cyan-300/35 text-cyan-100">{gamePaused ? '▶ Resume' : 'Ⅱ Pause'}</button>}{session?.status === 'playing' && !backingTrackUrl && <button onClick={() => setGuideAudio(!guideAudio)} title="Play the written notes out loud so singers can hear the line" className={`vh-outline-button ${guideAudio ? 'border-emerald-300/40 text-emerald-100' : 'text-slate-400'}`}>{guideAudio ? '♪ Guide on' : '♪ Guide off'}</button>}{session && <button onClick={returnToLibrary} className="vh-outline-button">← Back to menu</button>}{session && <RoomCode code={session.room_code} />}<button onClick={() => window.open(session ? `/vocal-hero?fullscreen=1&room=${session.room_code}` : '/vocal-hero?fullscreen=1', '_blank', 'noopener')} className="vh-outline-button">Open full screen</button></div></header>
    {error && <p className="border-y border-rose-400/30 bg-rose-950/50 px-5 py-3 text-sm text-rose-200">{error}</p>}
    {stage}
    {preRoll && <CountInOverlay phase={timeline.phase} />}
    {editingSong && <ArrangementEditor song={editingSong} onClose={() => setEditingSong(null)} onSave={saveArrangement} />}
    {showCreateSong && <CreateSongDialog creating={creatingSong} onCancel={() => setShowCreateSong(false)} onCreate={createNewSong} />}
    {scoresFor && <HighScoresDialog song={scoresFor} onClose={() => setScoresFor(null)} />}
  </main>;
}

function Brand() { return <div className="text-lg font-black tracking-tight sm:text-2xl">VOCAL<span className="bg-gradient-to-r from-cyan-300 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">Hero</span></div>; }
function RoomCode({ code }: { code: string }) { return <div className="hidden rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-400 sm:block">Room code <b className="ml-2 font-mono tracking-wider text-[#ffd15c]">{code}</b></div>; }
function SongArt() { return <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl sm:h-24 sm:w-24 sm:rounded-2xl border border-cyan-300/30 bg-[radial-gradient(circle_at_70%_25%,#38bdf866,transparent_35%),linear-gradient(145deg,#172554,#0b1022_55%,#581c8733)] text-2xl shadow-[0_0_30px_#5b21b633] sm:text-4xl">♫</div>; }
function SongDetails({ song }: { song: Song }) { return <div className="flex min-w-0 items-center gap-4"><SongArt /><div className="min-w-0"><h1 className="truncate text-lg font-bold sm:text-2xl">{song.title}</h1><p className="mt-0.5 truncate text-xs text-slate-400 sm:mt-1 sm:text-sm">{song.artist ? `Arr. by ${song.artist}` : 'Vocal Hero arrangement'}</p><div className="mt-1.5 flex flex-wrap gap-2 sm:mt-3"><Badge label={formatDuration(song.duration)} /><Badge label={`${song.time_sig ?? '4/4'}`} /></div></div></div>; }
// The minutes were rounded rather than floored, so a 3:30 song was labelled
// 4:30, and the `|| 3` fallback meant any song under 30 seconds claimed to be
// three minutes long. Rounding the total first also keeps 3:59.7 from
// rendering as "3:60".
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function Badge({ label }: { label: string }) { return <span className="rounded-lg border border-cyan-300/20 bg-cyan-300/[.05] px-2 py-1 text-xs text-cyan-200">{label}</span>; }

function SongPicker({ songs, onChoose, onEdit, onCreate, onScores, onPractice }: { songs: Song[]; onChoose: (song: Song) => void; onEdit: (song: Song) => void; onCreate: () => void; onScores: (song: Song) => void; onPractice: (song: Song) => void }) {
  return <section className="mx-auto max-w-6xl px-3 py-6 sm:px-5 sm:py-14"><div className="flex flex-wrap items-end justify-between gap-6"><div><p className="text-xs font-bold tracking-[.26em] text-fuchsia-300">VOCAL HERO LIBRARY</p><h1 className="mt-2 max-w-3xl text-3xl font-black tracking-tight sm:mt-3 sm:text-5xl lg:text-7xl">Build a room.<br /><span className="text-cyan-300">Raise every voice.</span></h1></div><button onClick={onCreate} className="vh-primary-button w-full sm:w-auto sm:min-w-52 sm:text-base">＋ Create new song</button></div><div className="mt-6 grid grid-cols-1 gap-3 sm:mt-10 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">{songs.map(song => <article key={song.id} className="vh-panel p-4 sm:p-5"><div className="mb-3 flex justify-end">{song.status === 'draft' && <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[.16em] text-amber-200">Draft</span>}</div><SongDetails song={song} /><div className="mt-4 flex flex-wrap gap-2 sm:mt-5 sm:flex-nowrap"><button onClick={() => onScores(song)} title="Best scores ever set on this song" className="vh-outline-button px-3">🏆</button><button onClick={() => onEdit(song)} className="vh-outline-button flex-1 basis-[calc(100%-3.4rem)] sm:basis-auto">{song.status === 'draft' ? 'Continue editing' : 'Edit arrangement'}</button><button onClick={() => onPractice(song)} disabled={song.status !== 'ready'} title="Practise alone: loop a phrase, slow it down, change the key. Nothing is scored." className="vh-outline-button flex-1 basis-[45%] sm:basis-auto border-emerald-300/40 text-emerald-100 disabled:opacity-40">Practise</button><button onClick={() => onChoose(song)} disabled={song.status !== 'ready'} title={song.status === 'ready' ? 'Open a multiplayer lobby' : 'Add at least one note and save before opening a lobby'} className="vh-primary-button flex-1 basis-[45%] sm:basis-auto disabled:cursor-not-allowed disabled:opacity-35">{song.status === 'ready' ? 'Open lobby' : 'Finish setup'}</button></div></article>)}</div>{!songs.length && <div className="vh-panel mt-10 grid place-items-center px-6 py-16 text-center"><p className="text-xl font-semibold">Your Vocal Hero library is empty.</p><p className="mt-2 text-sm text-slate-400">Create a song, then draw notes or import MIDI in the arrangement editor.</p><button onClick={onCreate} className="vh-primary-button mt-6">＋ Create your first song</button></div>}</section>;
}

function HighScoresDialog({ song, onClose }: { song: Song; onClose: () => void }) {
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-[#020510]/85 p-4 backdrop-blur-md" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label="High scores" className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-amber-300/30 bg-[#090d22] shadow-[0_0_80px_#f59e0b22]">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-5">
        <div><p className="text-[10px] font-bold tracking-[.24em] text-amber-300">HIGH SCORES</p><h2 className="mt-1 text-2xl font-black">{song.title}</h2></div>
        <button onClick={onClose} className="rounded-lg border border-white/15 px-4 py-2 text-xs">Close</button>
      </header>
      <div className="p-5"><HighScoreBoard songId={song.id} perVoice={10} /></div>
    </section>
  </div>;
}

function CreateSongDialog({ creating, onCancel, onCreate }: { creating: boolean; onCancel: () => void; onCreate: (title: string, artist: string) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-[#020510]/85 p-4 backdrop-blur-md" onMouseDown={event => { if (event.target === event.currentTarget && !creating) onCancel(); }}><form onSubmit={event => { event.preventDefault(); if (title.trim()) void onCreate(title.trim(), artist.trim()); }} className="w-full max-w-lg overflow-hidden rounded-3xl border border-fuchsia-300/30 bg-[radial-gradient(circle_at_80%_0%,#3b1c6b88,transparent_38%),#090d22] shadow-[0_0_80px_#d946ef33]"><div className="border-b border-white/10 px-6 py-5"><p className="text-[10px] font-bold tracking-[.24em] text-fuchsia-300">NEW VOCAL HERO SONG</p><h2 className="mt-2 text-2xl font-black">Create a blank arrangement</h2><p className="mt-2 text-sm text-slate-400">Start with the song details, then draw notes, import MIDI, or add a synchronized backing track.</p></div><div className="space-y-4 px-6 py-5"><label className="block text-xs font-semibold text-slate-300">Song title <span className="text-fuchsia-300">*</span><input autoFocus required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Great Is Thy Faithfulness" className="mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-base text-white outline-none transition focus:border-fuchsia-300/70 focus:ring-2 focus:ring-fuchsia-400/15" /></label><label className="block text-xs font-semibold text-slate-300">Artist or arranger <span className="font-normal text-slate-500">(optional)</span><input maxLength={160} value={artist} onChange={event => setArtist(event.target.value)} placeholder="Name shown in the library" className="mt-2 w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3 text-base text-white outline-none transition focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-400/15" /></label><div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.05] p-3 text-xs leading-relaxed text-cyan-100">The song is saved immediately as a draft. It becomes ready for a lobby after you add at least one note and save the arrangement.</div></div><div className="flex justify-end gap-3 border-t border-white/10 px-6 py-4"><button type="button" onClick={onCancel} disabled={creating} className="vh-outline-button disabled:opacity-40">Cancel</button><button type="submit" disabled={creating || !title.trim()} className="vh-primary-button min-w-36 disabled:cursor-not-allowed disabled:opacity-40">{creating ? 'Creating…' : 'Create & edit'}</button></div></form></div>;
}

function Lobby({ song, session, players, phoneUrl, onStart, onStartSolo, soloStarting, difficulty, setDifficulty, latencySec, applyLatency, transpose, setTranspose, warmUp, setWarmUp, soloName, setSoloName }: { song: Song; session: GameSession; players: SessionPlayer[]; phoneUrl: string; onStart: () => void; onStartSolo: (part: number) => void; soloStarting: number | null; difficulty: Difficulty; setDifficulty: (next: Difficulty) => void; latencySec: number; applyLatency: (seconds: number) => void; transpose: number; setTranspose: (next: number) => void; warmUp: boolean; setWarmUp: (next: boolean) => void; soloName: string; setSoloName: (next: string) => void }) {
  const ready = players.filter(player => player.ready_at && !player.is_spectator).length;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&bgcolor=ffffff&color=070b1a&data=${encodeURIComponent(phoneUrl)}`;
  // On a phone the four round settings are a page of controls between the
  // singer and the start button, and they all have sensible defaults.
  const [showSettings, setShowSettings] = useState(false);
  return <section className="mx-auto max-w-[1500px] px-3 py-3 sm:px-5 sm:py-6"><div className="vh-panel grid grid-cols-1 gap-4 p-4 sm:gap-6 sm:p-5 lg:grid-cols-[.78fr_1.2fr] lg:p-7"><SongDetails song={song} /><div className="flex items-center gap-4 sm:grid sm:grid-cols-[1fr_.9fr] sm:gap-5"><div className="shrink-0 text-center"><p className="hidden text-xs tracking-[.2em] text-fuchsia-200 sm:block">SCAN TO JOIN THE LOBBY</p><img src={qr} alt="QR code to join this Vocal Hero lobby" className="mx-auto h-[88px] w-[88px] rounded-xl border-2 border-fuchsia-400 bg-white p-1 shadow-[0_0_22px_#e879f9aa] sm:mt-3 sm:h-48 sm:w-48 sm:rounded-2xl sm:border-4 sm:p-2 sm:shadow-[0_0_40px_#e879f9aa]" /></div><div className="min-w-0 flex-1 text-left sm:text-center"><p className="text-[10px] font-bold tracking-[.18em] text-fuchsia-200 sm:hidden">SCAN — OR TYPE THE CODE</p><p className="mt-1 font-mono text-3xl font-black tracking-[.14em] text-[#ffd15c] sm:hidden">{session.room_code}</p><p className="mt-2 text-2xl font-black sm:mt-0 sm:text-6xl"><span className="text-fuchsia-400">{players.length}</span><span className="text-slate-500"> / 40</span><span className="ml-2 text-xs font-normal text-slate-400 sm:hidden">joined</span></p><p className="mt-1 hidden text-sm text-slate-300 sm:block">joined</p><div className="mt-5 hidden rounded-xl border border-fuchsia-400/30 bg-fuchsia-400/[.06] p-3 text-sm text-slate-200 sm:block">Scan to join <span className="mx-2 text-fuchsia-300">•</span> choose a part <span className="mx-2 text-cyan-300">•</span> tap ready</div></div></div></div>
    <section className="mt-5 overflow-hidden rounded-2xl border border-cyan-300/25 bg-[radial-gradient(circle_at_85%_20%,#22d3ee1f,transparent_32%),linear-gradient(110deg,#07162d,#171038)] p-4 shadow-[0_14px_45px_#02061788]" aria-label="Solo practice"><div className="flex flex-wrap items-center gap-4"><div className="min-w-56 flex-1"><p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">No phone needed</p><h2 className="mt-1 text-xl font-black text-white">Start solo practice</h2><p className="mt-1 text-xs leading-relaxed text-slate-400">Choose your voice. This device will request the microphone, join as <b className="text-slate-200">{soloName.trim() || 'Solo Singer'}</b>, and begin the synchronized countdown automatically.</p><label className="mt-2 block text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">Your name<input value={soloName} onChange={event => setSoloName(event.target.value)} maxLength={40} placeholder="Shown on the leaderboard and high scores" className="mt-1 block w-full rounded-lg sm:max-w-xs border border-white/15 bg-black/25 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/60" /></label></div><div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-4">{VOICES.map((voice, index) => <button key={voice} type="button" disabled={soloStarting !== null} onClick={() => onStartSolo(index)} className="group min-w-28 rounded-xl border bg-black/20 px-3 py-3 text-left transition hover:-translate-y-0.5 hover:bg-white/[.06] disabled:cursor-wait disabled:opacity-45" style={{ borderColor: `${COLOURS[index]}66`, boxShadow: `inset 0 0 20px ${COLOURS[index]}0d` }}><span className="flex items-center gap-2"><b className="text-2xl" style={{ color: COLOURS[index] }}>{voice[0]}</b><span><b className="block text-xs text-white">{voice}</b><small className="text-[9px] text-slate-500">{soloStarting === index ? 'Starting…' : 'Sing this part'}</small></span></span></button>)}</div></div><button type="button" onClick={() => setShowSettings(!showSettings)} className="mt-3 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-semibold text-slate-300 sm:hidden">⚙ Round settings {showSettings ? '▴' : '▾'}</button><div className={(showSettings ? 'grid' : 'hidden') + ' mt-3 grid-cols-1 gap-4 border-t border-white/[.07] pt-4 sm:mt-4 sm:grid sm:grid-cols-2'}><DifficultyPicker value={difficulty} onChange={setDifficulty} colour="#22d3ee" /><LatencyRow colour="#22d3ee" latencySec={latencySec} onChange={applyLatency} /><TransposePicker value={transpose} onChange={setTranspose} colour="#22d3ee" hasBackingTrack={!!(song.audio_url || song.backing_media_url)} /><WarmUpToggle value={warmUp} onChange={setWarmUp} colour="#22d3ee" /></div><p className="mt-3 hidden text-[10px] text-slate-500 sm:block">Headphones are recommended so the backing track does not enter the same microphone used for pitch scoring.</p></section>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3 lg:grid-cols-4">{VOICES.map((voice, index) => <LobbyVoice key={voice} name={voice} index={index} players={players} />)}</div>
    <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 sm:mt-5 sm:gap-4"><div className="hidden rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-400 sm:block">Lobby chat will appear here when live chat is enabled.</div><button onClick={onStart} disabled={!players.some(player => !player.is_spectator)} className="vh-start-button">⌁ START PERFORMANCE <span className="ml-3 text-sm text-cyan-100">{ready} ready</span></button><div className="hidden text-sm text-slate-400 sm:block">Host can start when singers are ready.</div></footer></section>;
}

function LobbyVoice({ name, index, players }: { name: string; index: number; players: SessionPlayer[] }) { const members = players.filter(player => player.part_index === index && !player.is_spectator); const ready = members.filter(player => player.ready_at).length;
  // Counted separately from readiness: a singer can be ready and then walk out.
  const present = members.filter(player => isPresent(player.last_seen_at, player.joined_at)).length; return <article className="vh-voice-card" style={{ '--voice': COLOURS[index] } as React.CSSProperties}><div className="flex items-center justify-between"><div className="flex items-center gap-2 sm:gap-3"><b className="text-2xl sm:text-4xl" style={{ color: COLOURS[index] }}>{name[0]}</b><div><h2 className="font-bold" style={{ color: COLOURS[index] }}>{name.toUpperCase()}</h2><p className="text-xs text-slate-400">{members.length} players</p></div></div><span className="text-xs" style={{ color: COLOURS[index] }}>Ready {ready}/{members.length}{present < members.length ? ` · ${members.length - present} away` : ''}</span></div><div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full" style={{ background: COLOURS[index], width: `${members.length ? ready / members.length * 100 : 0}%` }} /></div><div className="mt-3 space-y-2">{members.slice(0, 7).map(player => { const here = isPresent(player.last_seen_at, player.joined_at); return <div key={player.id} className={`flex items-center gap-2 text-sm ${here ? '' : 'opacity-45'}`}><Avatar name={player.player_name} colour={COLOURS[index]} /><span className="min-w-0 flex-1 truncate">{player.player_name}</span>{!here && <span className="text-[10px] text-slate-500">{lastSeenLabel(player.last_seen_at)}</span>}<span title={here ? 'In the room' : 'Not answering'} className={`h-2 w-2 rounded-full ${!here ? 'bg-slate-700' : player.mic_status === 'ready' ? 'bg-emerald-400' : 'bg-slate-600'}`} /></div>; })}{!members.length && <p className="py-2 text-center text-[10px] text-slate-500 sm:py-6 sm:text-xs">Waiting for singers</p>}</div></article>; }
function Avatar({ name, colour }: { name: string; colour: string }) { return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold text-[#07111d]" style={{ background: colour }}>{name.slice(0, 1).toUpperCase()}</span>; }

function CountdownStage({ song, players, phase }: { song: Song; players: SessionPlayer[]; phase: string }) { const number = Number(phase.match(/(\d+)/)?.[1] ?? 0); return <section className="mx-auto max-w-[1500px] px-3 py-3 sm:px-5 sm:py-7"><div className="vh-panel relative overflow-hidden p-4 sm:p-6"><SongDetails song={song} /><div className="absolute inset-x-0 top-24 hidden justify-center lg:flex">{VOICES.map((voice, index) => <div key={voice} className="w-1/4 border-y border-white/10 px-5 py-4 text-sm" style={{ color: COLOURS[index] }}>{voice.toUpperCase()}<span className="float-right text-slate-500">••••••</span></div>)}</div><div className="relative mx-auto mt-3 grid h-[180px] max-w-xl place-items-center text-center sm:mt-7 sm:h-[430px]"><div className="vh-count-ring"><div><p className="text-[9px] tracking-[.35em] text-fuchsia-200 sm:text-xs">GET READY</p><p className="mt-1 text-[40px] font-black leading-none sm:mt-3 sm:text-[10rem] text-transparent [text-shadow:0_0_40px_#ec4899] bg-gradient-to-br from-fuchsia-400 via-violet-400 to-cyan-300 bg-clip-text">{number || '•'}</p><p className="text-xs font-semibold text-fuchsia-200 sm:text-lg">{phase.includes('Lead') ? 'Breathe in' : 'SONG BEGINS IN'}</p></div></div></div><div className="mx-auto grid max-w-4xl grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">{VOICES.map((voice, index) => { const count = players.filter(player => player.part_index === index && !player.is_spectator).length; const ready = players.filter(player => player.part_index === index && player.ready_at).length; return <div key={voice} className="vh-ready-card" style={{ borderColor: `${COLOURS[index]}88` }}><b style={{ color: COLOURS[index] }}>{voice}</b><span>{ready}/{count}</span><p className="mt-2 text-xs text-emerald-300">✓ READY</p></div>; })}</div><footer className="mt-4 text-center text-xs text-slate-300 sm:mt-6 sm:text-sm">◉ Eyes on your part <span className="mx-4 text-slate-600">|</span> ≋ Breathe in</footer></div></section>; }

/** A loudness bar that repaints itself on its own animation frame, writing
 *  straight to the DOM. The playhead rule applies to the microphone too:
 *  nothing that moves sixty times a second may live in React state. */
function LiveMeter({ getLevel, colour = '#34d399' }: { getLevel: () => number; colour?: string }) {
  const barRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (barRef.current) barRef.current.style.width = Math.min(100, Math.round(getLevel() * 400)) + '%';
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getLevel]);
  return <span className="block h-1.5 w-full min-w-16 max-w-32 overflow-hidden rounded-full bg-white/10"><span ref={barRef} className="block h-full rounded-full" style={{ background: colour, width: '0%' }} /></span>;
}

/** The numbers that tell a silent microphone apart from a resting singer,
 *  shown where the SOLO player actually is. They existed only on the phone
 *  page's join screen -- a page a solo player never visits, which is why every
 *  report of a dead microphone has arrived without them. */
function SoloMicDiag({ getEngine, getLevel }: { getEngine: () => PitchEngine | null; getLevel: () => number }) {
  const [line, setLine] = useState('');
  useEffect(() => {
    let env = { standalone: false, permission: 'unknown' };
    void PitchEngine.environment().then(next => { env = next; });
    const timer = window.setInterval(() => {
      const engine = getEngine();
      if (!engine) { setLine('mic not started'); return; }
      const track = engine.trackInfo;
      setLine([
        'level ' + getLevel().toFixed(4),
        (engine.sampleRate ? (engine.sampleRate / 1000).toFixed(1) + ' kHz' : 'no context'),
        'dc ' + engine.dcOffset.toFixed(3),
        'capture ' + engine.captureMode,
        'audio ' + (engine.isSuspended ? 'PAUSED' : 'running'),
        track ? `input "${track.label || 'unnamed'}"${track.muted ? ' MUTED BY OS' : ''} ${track.state}` : 'no track',
        env.standalone ? 'installed app' : 'browser tab',
        'permission ' + env.permission,
      ].join(' · '));
    }, 400);
    return () => window.clearInterval(timer);
  }, [getEngine, getLevel]);
  return <div className="mx-auto mt-2 max-w-md"><p className="text-center font-mono text-[9px] leading-relaxed text-slate-500">{line}</p><MicReportButton getEngine={getEngine} context="solo-countdown" /></div>;
}

function SoloCountdownStage({ song, part, phase, mic, getLevel, getEngine }: { song: Song; part: number; phase: string; mic: string; getLevel: () => number; getEngine: () => PitchEngine | null }) {
  const number = Number(phase.match(/(\d+)/)?.[1] ?? 0);
  return <section className="mx-auto max-w-[1100px] px-3 py-3 sm:px-5 sm:py-7"><div className="vh-panel overflow-hidden p-4 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-4"><SongDetails song={song} /><div className="rounded-xl border px-3 py-1.5 text-right sm:px-4 sm:py-3" style={{ borderColor: `${COLOURS[part]}55`, background: `${COLOURS[part]}0d` }}><p className="text-[9px] uppercase tracking-[.18em] text-slate-500 sm:text-[10px]">Solo voice</p><b className="text-base sm:text-xl" style={{ color: COLOURS[part] }}>{VOICES[part]}</b></div></div><div className="mx-auto mt-3 grid min-h-[180px] max-w-xl place-items-center text-center sm:mt-7 sm:min-h-[430px]"><div className="vh-count-ring"><div><p className="text-[9px] tracking-[.35em] sm:text-xs" style={{ color: COLOURS[part] }}>SOLO PRACTICE</p><p className="mt-1 text-[40px] font-black leading-none sm:mt-3 sm:text-[10rem] text-transparent [text-shadow:0_0_40px_#ec4899] bg-gradient-to-br from-fuchsia-400 via-violet-400 to-cyan-300 bg-clip-text">{number || '•'}</p><p className="text-xs font-semibold text-fuchsia-200 sm:text-lg">{phase.includes('Lead') ? 'Listen · breathe · prepare' : 'SONG BEGINS IN'}</p></div></div></div><footer className="flex flex-wrap items-center justify-center gap-2 text-xs sm:gap-4 sm:text-sm"><span className="flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/[.08] px-2.5 py-1 text-emerald-200 sm:px-3 sm:py-1.5">● {mic === 'ready' ? 'Mic' : 'Checking mic'} <LiveMeter getLevel={getLevel} /></span><span className="text-slate-400">Eyes on your {VOICES[part]} line</span></footer><SoloMicDiag getEngine={getEngine} getLevel={getLevel} /></div></section>;
}

function SoloLiveStage({ song, notes, transpose, warmUp, part, elapsed, getElapsed, getPitch, getLevel, pitch, score, hits, lastResult, sections, mic, fullBoard, setFullBoard, trail, getEngine }: { song: Song; notes: SongNote[]; transpose: number; warmUp: boolean; part: number; elapsed: number; getElapsed: () => number; getPitch: () => number; getLevel: () => number; pitch: number; score: number; hits: Record<string, boolean>; lastResult: NoteScoreResult | null; sections: SectionScore[]; mic: string; fullBoard: boolean; setFullBoard: (value: boolean) => void; trail: TrailSample[]; getEngine: () => PitchEngine | null }) {
  const narrow = useNarrow();
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
  return <section className="mx-auto flex h-[calc(100dvh-45px)] w-full max-w-[1350px] flex-col overflow-hidden px-2 py-2 sm:block sm:h-auto sm:overflow-visible sm:px-5 sm:py-6"><div className="flex min-h-0 flex-1 flex-col gap-2 sm:grid sm:grid-cols-1 sm:gap-4 xl:grid-cols-[1fr_300px]"><div className="flex min-h-0 flex-1 flex-col sm:block"><div className="vh-panel flex shrink-0 flex-wrap items-center gap-2 p-2 sm:gap-5 sm:p-4"><div className="hidden min-w-0 sm:block"><SongDetails song={song} /></div><div className="ml-auto flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end sm:gap-5"><div className="text-right"><p className="text-[10px] uppercase tracking-[.18em] text-slate-500">Your voice</p><b className="text-lg" style={{ color: COLOURS[part] }}>{VOICES[part]}</b><div className="mt-1 flex flex-wrap justify-end gap-1"><WarmUpBadge active={warmUp} /><TransposeBadge semitones={transpose} colour={COLOURS[part]} /></div></div><div className="text-right"><p className="text-2xl font-black text-fuchsia-300 sm:text-3xl">{score.toLocaleString()}</p><p className="text-[9px] uppercase tracking-[.15em] text-slate-500">Personal score</p></div></div></div><div className="mt-1 flex shrink-0 items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/25 px-2.5 py-1.5 sm:hidden"><b className="text-base font-black text-cyan-200">{feedback.detected}</b><span className={`min-w-0 truncate text-center text-[11px] font-black ${feedback.state === 'correct' ? 'text-emerald-300' : feedback.state === 'high' || feedback.state === 'low' || feedback.state === 'octave' ? 'text-amber-300' : 'text-slate-500'}`}>{feedback.label}</span><b className="text-base font-black text-white">{feedback.target}</b></div><div className="mt-1 flex shrink-0 items-center gap-2 px-1 sm:hidden"><span className="text-[8px] uppercase tracking-[.18em] text-slate-500">Hearing you</span><div className="flex-1"><LiveMeter getLevel={getLevel} colour="#34d399" /></div><SoloAudioResume getEngine={getEngine} /></div><div className="mt-1 shrink-0 sm:mt-4"><KaraokeLyrics song={song} notes={notes} partIndex={lanePart} elapsed={elapsed} compact={narrow} /></div><div className="mt-1 min-h-[140px] flex-1 sm:mt-4 sm:min-h-0 sm:flex-none"><CanvasLane partIndex={lanePart} partName={guide ? 'Melody guide' : VOICES[part]} colour={guide ? '#ff60bc' : COLOURS[part]} getPosition={getElapsed} notes={notes} getPitchHz={getPitch} getLevel={getLevel} hitNotes={hits} lookAheadSeconds={7} showLyrics trail={trail} height={300} fill={narrow} /></div>{!guide && <button onClick={() => setFullBoard(!fullBoard)} className="vh-outline-button mt-4 hidden sm:inline-block">{fullBoard ? 'Hide full choir board' : 'Show full choir board'}</button>}{fullBoard && <div className="mt-3 hidden space-y-2 sm:block">{VOICES.map((voice, index) => <CanvasLane key={voice} partIndex={index} partName={voice} colour={COLOURS[index]} getPosition={getElapsed} notes={notes} getPitchHz={index === part ? getPitch : undefined} hitNotes={hits} lookAheadSeconds={5} height={120} showLyrics={false} />)}</div>}</div><aside className="vh-panel hidden h-fit p-5 sm:block"><p className="text-[10px] uppercase tracking-[.2em] text-slate-500">Live singing coach</p><div className="mt-4 space-y-3"><div className="rounded-xl border border-cyan-300/20 bg-cyan-300/[.04] p-4"><p className="text-xs text-slate-400">You sang / target</p><div className="mt-2 flex items-end justify-between"><b className="text-3xl text-cyan-200">{feedback.detected}</b><span className="text-slate-500">→</span><b className="text-3xl text-white">{feedback.target}</b></div><p className={`mt-3 text-sm font-black ${feedback.state === 'correct' ? 'text-emerald-300' : feedback.state === 'high' || feedback.state === 'low' || feedback.state === 'octave' ? 'text-amber-300' : 'text-slate-400'}`}>{feedback.label}</p><small className="text-slate-500">{feedback.difference} · {feedback.instruction}{feedback.cents !== null ? ` · target offset ${Math.abs(feedback.cents)} cents` : ''}</small></div><div className="rounded-xl border border-white/10 bg-white/[.035] p-4"><div className="flex items-center justify-between"><p className="text-xs text-slate-400">Last completed note</p><b className={lastResult?.points ? 'text-emerald-300' : 'text-slate-400'}>{resultLabel}</b></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><Metric label="Timing" value={lastResult ? lastResult.onset : 0} /><Metric label="Pitch" value={lastResult ? lastResult.pitch : 0} /><Metric label="Hold" value={lastResult ? lastResult.hold : 0} /></div>{octaveNotice && <p className="mt-3 rounded-lg border border-amber-300/30 bg-amber-300/[.08] px-3 py-2 text-xs font-semibold text-amber-200">⚠ {octaveNotice}</p>}</div><div className="grid grid-cols-2 gap-3"><div className="rounded-xl border border-white/10 bg-white/[.035] p-3"><p className="text-xs text-slate-400">Session accuracy</p><b className="mt-1 block text-2xl" style={{ color: COLOURS[part] }}>{Math.round(section?.accuracy ?? 0)}%</b></div><div className="rounded-xl border border-emerald-300/20 bg-emerald-300/[.05] p-3"><p className="text-xs text-slate-400">Microphone</p><b className="mt-1 block text-sm text-emerald-300">{mic === 'ready' ? '● READY' : 'CHECK MIC'}</b></div></div></div></aside></div></section>;
}

/** Where a finished solo round lands. It used to drop straight back to the
 * lobby, so everything the round had just measured was gone before the singer
 * could read any of it. */
function SoloReviewStage({ song, part, score, review, warmUp, playerName, onDone, weakest, onPractiseWeakest }: {
  song: Song; part: number; score: number; review: RoundReview; warmUp: boolean; playerName: string; onDone: () => void;
  weakest: WeakPassage | null; onPractiseWeakest: (passage: WeakPassage) => void;
}) {
  return <section className="mx-auto max-w-[900px] px-3 py-4 sm:px-5 sm:py-10">
    <div className="vh-panel p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SongDetails song={song} />
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[.18em] text-slate-500">{VOICES[part]} · round complete</p>
          {warmUp && <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-cyan-300">Warm-up · nothing recorded</p>}
          <p className="text-3xl font-black text-fuchsia-300 sm:text-5xl">{score.toLocaleString()}</p>
        </div>
      </div>
      <div className="mt-6"><RoundReviewPanel review={review} colour={COLOURS[part]} /></div>
      {!warmUp && <div className="mt-4"><HighScoreBoard songId={song.id} highlight={[playerName]} /></div>}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">{weakest && <button onClick={() => onPractiseWeakest(weakest)} title="Loop just this phrase, at whatever speed you like" className="vh-outline-button min-w-40 border-emerald-300/40 text-emerald-100">⟲ Practise the weakest phrase</button>}<button onClick={onDone} className="vh-primary-button min-w-40">Back to the library</button></div>
    </div>
  </section>;
}

/** Appears only when the browser has paused the AudioContext -- the one
 *  silent-microphone cause a singer can fix with a tap. Polled at 2Hz; it is a
 *  boolean about the audio graph, not a frame-rate value. */
function SoloAudioResume({ getEngine }: { getEngine: () => PitchEngine | null }) {
  const [suspended, setSuspended] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setSuspended(Boolean(getEngine()?.isSuspended)), 500);
    return () => window.clearInterval(timer);
  }, [getEngine]);
  if (!suspended) return null;
  return <button onClick={() => void getEngine()?.resume()} className="rounded-lg border border-amber-400/40 bg-amber-950/40 px-2 py-0.5 text-[9px] font-bold text-amber-100">audio paused — tap</button>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-black/20 p-2"><b className={value >= .65 ? 'text-emerald-300' : value > 0 ? 'text-amber-300' : 'text-slate-500'}>{Math.round(value * 100)}%</b><small className="mt-1 block text-[9px] uppercase tracking-wider text-slate-500">{label}</small></div>; }

function LiveStage({ song, notes, players, sections, elapsed, getElapsed }: { song: Song; notes: SongNote[]; players: SessionPlayer[]; sections: SectionScore[]; elapsed: number; getElapsed: () => number }) {
  const guide = isGuideMelody(notes);
  const sectionList = [...sections].sort((a, b) => b.accuracy - a.accuracy);
  return <section className="mx-auto max-w-[1500px] px-3 py-3 sm:px-5 sm:py-6">
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_330px]">
      <div>
        <div className="vh-panel mb-4 flex flex-wrap items-center gap-5 p-4">
          <SongDetails song={song} />
          <div className="ml-auto text-right"><p className="text-xs tracking-[.2em] text-slate-400">NOW PLAYING</p><p className="text-2xl font-bold text-cyan-200">{elapsed.toFixed(1)}s</p></div>
        </div>
        <div className="mb-4">{guide ? <KaraokeLyrics song={song} notes={notes} partIndex={-1} elapsed={elapsed} compact /> : <ChoirKaraokeLyrics song={song} notes={notes} elapsed={elapsed} />}</div>
        <div className="space-y-3">
          {guide ? <><p className="vh-guide-notice">Shared melody guide · author true SATB targets in Edit arrangement to show independent harmony lanes.</p><CanvasLane partIndex={-1} partName="Melody guide" colour="#ff60bc" getPosition={getElapsed} notes={notes} height={280} /></> : VOICES.map((voice, index) => <CanvasLane key={voice} partIndex={index} partName={voice} colour={COLOURS[index]} getPosition={getElapsed} notes={notes} height={150} showLyrics={false} playerCount={players.filter(player => player.part_index === index && !player.is_spectator).length} />)}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Leaderboard players={players} />
          <div className="vh-panel p-4"><p className="text-xs tracking-[.2em] text-slate-400">SECTION BLEND</p><div className="mt-4 grid grid-cols-4 gap-2">{VOICES.map((voice, index) => <div key={voice} className="rounded-xl bg-white/[.04] p-3 text-center"><b style={{ color: COLOURS[index] }}>{voice[0]}</b><p className="mt-1 text-xs text-slate-400">{Math.round(sections.find(item => item.part_index === index)?.accuracy ?? 0)}%</p></div>)}</div></div>
        </div>
      </div>
      <aside className="vh-panel h-fit p-5"><p className="text-xs tracking-[.2em] text-slate-400">LIVE SECTION BATTLE</p><div className="mt-4 space-y-3">{sectionList.length ? sectionList.map((section, rank) => <div key={section.part_index} className="rounded-xl border border-white/10 bg-white/[.035] p-3"><div className="flex items-center justify-between"><b style={{ color: COLOURS[section.part_index] }}>#{rank + 1} {VOICES[section.part_index]}</b><b>{Math.round(section.accuracy)}%</b></div><div className="mt-2 h-1.5 rounded-full bg-white/10"><span className="block h-full rounded-full" style={{ width: `${section.accuracy}%`, background: COLOURS[section.part_index] }} /></div></div>) : <p className="text-sm text-slate-500">Scores will appear as singers perform.</p>}</div></aside>
    </div>
  </section>;
}
/** Where a finished multiplayer round lands. Until rounds could end this was
 * unreachable; once they could, the host dropped straight back to the lobby
 * and the results vanished before anyone had read them. The choir has just
 * sung — the least the host screen can do is say how it went. */
function HostRoundEndStage({ song, players, sections, onAgain, onDone }: {
  song: Song; players: SessionPlayer[]; sections: SectionScore[]; onAgain: () => void; onDone: () => void;
}) {
  const singers = players.filter(player => !player.is_spectator);
  const ranked = [...sections].sort((a, b) => b.accuracy - a.accuracy);
  const winner = ranked.length && ranked[0].accuracy > 0 ? ranked[0] : null;
  const topSingers = [...singers].sort((a, b) => b.score - a.score);
  return <section className="mx-auto max-w-[1100px] px-3 py-4 sm:px-5 sm:py-8">
    <div className="vh-panel p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SongDetails song={song} />
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-[.18em] text-slate-500">Round complete</p>
          <p className="text-2xl font-black text-cyan-200">{singers.length} singer{singers.length === 1 ? '' : 's'}</p>
        </div>
      </div>

      {winner && <div className="mt-6 rounded-2xl border p-4 text-center" style={{ borderColor: `${COLOURS[winner.part_index]}66`, background: `${COLOURS[winner.part_index]}12` }}>
        <p className="text-[10px] font-black uppercase tracking-[.24em] text-slate-400">Section of the round</p>
        <p className="mt-1 text-3xl font-black" style={{ color: COLOURS[winner.part_index] }}>{VOICES[winner.part_index]} · {Math.round(winner.accuracy)}%</p>
      </div>}

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4">
          <p className="text-[10px] font-black uppercase tracking-[.2em] text-slate-500">Section standings</p>
          <div className="mt-3 space-y-2">
            {ranked.length ? ranked.map((section, rank) => <div key={section.part_index} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between">
                <b style={{ color: COLOURS[section.part_index] }}>#{rank + 1} {VOICES[section.part_index]}</b>
                <span className="text-sm text-slate-300">{Math.round(section.accuracy)}% · {section.active_players} singer{section.active_players === 1 ? '' : 's'}</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-white/10"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, section.accuracy)}%`, background: COLOURS[section.part_index] }} /></div>
            </div>) : <p className="py-6 text-center text-sm text-slate-500">No section scores were recorded this round.</p>}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[.03] p-4">
          <p className="text-[10px] font-black uppercase tracking-[.2em] text-slate-500">Singers</p>
          <div className="mt-3 space-y-2">
            {topSingers.slice(0, 8).map((player, index) => <div key={player.id} className="flex items-center gap-2 text-sm">
              <span className="w-5 text-slate-500">{index + 1}</span>
              <Avatar name={player.player_name} colour={COLOURS[player.part_index] ?? '#94a3b8'} />
              <span className="min-w-0 flex-1 truncate">{player.player_name}</span>
              <span className="text-[10px] uppercase tracking-wider" style={{ color: COLOURS[player.part_index] ?? '#94a3b8' }}>{VOICES[player.part_index] ?? ''}</span>
              <b className="w-16 text-right font-mono">{player.score.toLocaleString()}</b>
            </div>)}
            {!topSingers.length && <p className="py-6 text-center text-sm text-slate-500">Nobody joined this round.</p>}
          </div>
        </div>
      </div>

      <div className="mt-5"><HighScoreBoard songId={song.id} highlight={singers.map(player => player.player_name)} /></div>

      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button onClick={onDone} className="vh-outline-button">Back to the library</button>
        <button onClick={onAgain} className="vh-primary-button min-w-44">Sing it again</button>
      </div>
      <p className="mt-2 text-right text-[10px] text-slate-500">Singing again starts a fresh round in the same room — everyone's phone follows by itself, and the scoreboard starts from zero.</p>
    </div>
  </section>;
}

function Leaderboard({ players }: { players: SessionPlayer[] }) { return <div className="vh-panel p-4"><div className="flex items-center justify-between"><p className="text-xs tracking-[.2em] text-slate-400">INDIVIDUAL LEADERBOARD</p><span className="text-xs text-fuchsia-300">Host only</span></div><div className="mt-3 space-y-2">{[...players].sort((a, b) => b.score - a.score).slice(0, 5).map((player, index) => <div key={player.id} className="flex items-center gap-2 text-sm"><span className="w-4 text-slate-500">{index + 1}</span><Avatar name={player.player_name} colour={COLOURS[player.part_index]} /><span className="flex-1 truncate">{player.player_name}</span><b className="font-mono">{player.score.toLocaleString()}</b></div>)}</div></div>; }

// Song time runs NEGATIVE through the count-in and lead-in, reaching exactly 0
// on the downbeat.
//
// The lane places every note at (note.start - elapsed) / lookAhead, so a
// negative elapsed parks the opening notes off to the right and walks them in,
// arriving at the strike line on the beat -- the singer watches the first note
// approach and knows when to come in. Pinned at 0 for the whole pre-roll, those
// notes instead sat motionless ON the strike line, which reads as "the game is
// already running and I have missed the start".
//
// Nothing scores early as a result: both the host and the phone gate the
// microphone on the PHASE being live, never on the clock.
/**
 * How far out the notes begin the count-in, as a multiple of the pre-roll.
 *
 * Raise it and they start further right and sweep in faster; 1 is a plain
 * constant-speed approach. The trip from the right edge to the strike line is a
 * fixed distance -- one lane look-ahead -- so the only way to shorten it is to
 * run song time quicker than the clock and hand back at the downbeat.
 */
const PRE_ROLL_APPROACH = 3;

function timelineFor(session: GameSession | null, now: number) {
  if (!session?.playback_starts_at) return { phase: 'Waiting', songElapsed: 0 };
  const delta = now - new Date(session.playback_starts_at).getTime();
  const countdown = session.countdown_seconds ?? 5, lead = session.lead_in_seconds ?? 2;
  const preRoll = countdown + lead;
  // Song time through the pre-roll: negative, easing from PRE_ROLL_APPROACH x
  // further out up to exactly 0 on the downbeat.
  //
  // The lane places notes at (note.start - elapsed) / lookAhead, so a negative
  // elapsed parks the opening notes off to the right and walks them in. The
  // quadratic term makes that walk a sweep -- quick while they are far out,
  // decelerating to exactly gameplay speed as they reach the strike line, so
  // the handover to real time is invisible instead of a lurch.
  //
  // Nothing scores early as a result: host and phone both gate the microphone
  // on the PHASE being live, never on the clock.
  const glide = (secondsIn: number) => {
    if (preRoll <= 0) return 0;
    const left = Math.max(0, preRoll - secondsIn);
    return -(left + ((PRE_ROLL_APPROACH - 1) / preRoll) * left * left);
  };
  if (delta < 0) return { phase: `Starts in ${Math.ceil(-delta / 1000)}`, songElapsed: glide(0) };
  const seconds = delta / 1000;
  if (seconds < countdown) return { phase: `Count-in ${countdown - Math.floor(seconds)}`, songElapsed: glide(seconds) };
  if (seconds < preRoll) return { phase: 'Lead-in · listen', songElapsed: glide(seconds) };
  return { phase: 'Live', songElapsed: seconds - preRoll };
}
