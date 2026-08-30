'use client';

import type { SongNote } from './types';
import { choirVoiceFor, warmInstruments } from './sampler';

const KEY = 'vh_guide_audio';

/**
 * Whether this device sounds the written notes during a round.
 *
 * The host defaults ON and a phone defaults OFF, which looks inconsistent until
 * you picture the room: the host is the one machine with speakers everyone can
 * hear, so it plays the part a piano would. Twenty phones each playing their own
 * line into the same room is not accompaniment, it is noise -- but a singer
 * practising alone at home wants exactly that, so the switch is there.
 */
export function storedGuideAudio(fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(KEY);
  return raw === null ? fallback : raw === 'on';
}

export function rememberGuideAudio(on: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, on ? 'on' : 'off');
}

/** Schedule notes this far ahead of the playhead, in seconds. */
const LOOKAHEAD = 0.4;
/** Per-note level. Four parts can sound at once, so this leaves headroom. */
const NOTE_GAIN = 0.085;
/** Choir-vs-triangle loudness trim, lab-calibrated so the guide switching
 *  from the warm-up beep to the recorded voice never jumps the level. */
const CHOIR_GUIDE_GAIN = 3.1;

interface Voice { node: OscillatorNode | AudioBufferSourceNode; gain: GainNode; endsAt: number }

/**
 * Sounds a song's written notes in time with the round.
 *
 * Web Audio cannot be driven from a render loop and stay in time -- scheduling a
 * note at the moment it is due lands it late by however long the frame took. So
 * notes are scheduled AHEAD, against the audio clock, from a coarse timer: each
 * pass hands the hardware everything starting in the next fraction of a second,
 * and the hardware plays them exactly on time regardless of what the main thread
 * is doing. That is also why a dropped frame never makes the guide stutter.
 */
export class GuidePlayer {
  private readonly context: AudioContext;
  private readonly master: GainNode;
  private scheduled = new Set<string>();
  private voices: Voice[] = [];

  constructor(context: AudioContext, level = 0.55) {
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = level;
    this.master.connect(context.destination);
    // Start decoding the recorded choir now, so the guide sings from the
    // first phrase instead of switching voices mid-round.
    warmInstruments(context);
  }

  /**
   * Hand the audio clock every note that begins within the lookahead window.
   * Safe to call as often as you like: each note is scheduled once.
   */
  update(notes: SongNote[], songElapsed: number): void {
    const now = this.context.currentTime;
    for (const note of notes) {
      if (this.scheduled.has(note.id)) continue;
      const delay = note.start - songElapsed;
      if (delay > LOOKAHEAD) continue;
      // Already gone by: a note that started before the guide was switched on,
      // or one missed while the tab was asleep. Mark it done rather than firing
      // it late, which would sound like a mistake rather than a cue.
      if (note.end - songElapsed <= 0.02) { this.scheduled.add(note.id); continue; }
      this.scheduled.add(note.id);

      const at = now + Math.max(0, delay);
      const until = at + Math.max(0.12, note.end - note.start - 0.03);
      const gain = this.context.createGain();
      // A REAL voice when the recording is ready: the guide sings the part
      // on "ah" instead of beeping it. The triangle stays as the warm-up
      // stand-in — it carries over a room and its edge is easy to pitch to.
      const choir = choirVoiceFor(this.context, note.midi);
      let node: OscillatorNode | AudioBufferSourceNode;
      if (choir) {
        const source = this.context.createBufferSource();
        source.buffer = choir.buffer;
        source.playbackRate.value = choir.playbackRate;
        // A held note outlasts the 3.13s recording; loop its sustain so the
        // guide keeps singing instead of dropping out mid-note.
        choir.applyLoop(source);
        const level = NOTE_GAIN * CHOIR_GUIDE_GAIN * choir.makeup;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(level, at + 0.02);
        gain.gain.setValueAtTime(level, Math.max(at + 0.03, until - 0.06));
        gain.gain.exponentialRampToValueAtTime(0.0001, until);
        node = source;
      } else {
        const oscillator = this.context.createOscillator();
        oscillator.type = 'triangle';
        oscillator.frequency.value = 440 * Math.pow(2, (note.midi - 69) / 12);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(NOTE_GAIN, at + 0.02);
        gain.gain.setValueAtTime(NOTE_GAIN, Math.max(at + 0.03, until - 0.06));
        gain.gain.exponentialRampToValueAtTime(0.0001, until);
        node = oscillator;
      }
      node.connect(gain).connect(this.master);
      node.start(at);
      node.stop(until + 0.02);
      this.voices.push({ node, gain, endsAt: until });
    }
    // Forget voices that have finished, so a long song does not accumulate them.
    if (this.voices.length > 64) this.voices = this.voices.filter(v => v.endsAt > now);
  }

  /** Silence everything already queued and allow it to be scheduled again.
   * Used on pause, on a restart, and when the guide is switched off mid-round:
   * without it, notes handed to the hardware keep sounding after the music has
   * stopped. */
  reset(): void {
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now);
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
        voice.node.stop(now + 0.06);
      } catch { /* already stopped */ }
    }
    this.voices = [];
    this.scheduled.clear();
  }

  dispose(): void {
    this.reset();
    try { this.master.disconnect(); } catch { /* already gone */ }
  }
}
