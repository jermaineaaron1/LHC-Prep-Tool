import { PitchEngine } from './pitchEngine';
import type { SongNote } from './types';

/** How much of the entrance the reference sounds out. */
export const CUE_NOTE_COUNT = 2;
const SPACING_SEC = .65;
const LENGTH_SEC = .58;

/** The opening notes of one voice's part, in the order they are sung. */
export function entranceNotes(notes: SongNote[], partIndex: number, count = CUE_NOTE_COUNT): SongNote[] {
  return notes
    .filter(note => note.part === partIndex || note.part === -1)
    .sort((a, b) => a.start - b.start)
    .slice(0, count);
}

/**
 * Sound the first notes of a singer's entrance.
 *
 * A number counting down says WHEN to come in but nothing about WHERE: a singer
 * staring at a countdown still has to guess their starting pitch, and a guess at
 * the first note tends to cost the second and third as well. Hearing the actual
 * opening interval turns the entrance into something they can match.
 *
 * Pass notes that have already been transposed — the reference is worthless if
 * it sounds a different pitch from the one the lane is about to ask for.
 */
export function playEntranceCue(context: AudioContext, notes: SongNote[], partIndex: number): void {
  const first = entranceNotes(notes, partIndex);
  if (!first.length) return;
  if (context.state === 'suspended') void context.resume();
  first.forEach((note, index) => {
    const oscillator = context.createOscillator(), gain = context.createGain();
    const at = context.currentTime + .08 + index * SPACING_SEC;
    oscillator.frequency.value = PitchEngine.midiToHz(note.midi);
    // Ramped rather than switched on: a square-edged gain change clicks, and a
    // click is the one sound a singer should not be matching.
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(.16, at + .03);
    gain.gain.exponentialRampToValueAtTime(.0001, at + .55);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + LENGTH_SEC);
  });
}
