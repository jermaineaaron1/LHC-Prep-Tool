import type { SongNote } from './types';

/** Default SATB boundaries. A note at or below a boundary belongs to that part. */
export type SatbMidiRanges = {
  bassMax: number;
  tenorMax: number;
  altoMax: number;
};

export const DEFAULT_SATB_MIDI_RANGES: SatbMidiRanges = {
  bassMax: 52,
  tenorMax: 60,
  altoMax: 67,
};

export type ImportedMidiNote = Omit<SongNote, 'id' | 'part' | 'lyric'> & { sourceTrack: number; channel: number };
type NoteOnEvent = { tick: number; type: 'on'; midi: number; velocity: number; channel: number; track: number };
type NoteOffEvent = { tick: number; type: 'off'; midi: number; velocity: number; channel: number; track: number };
type MidiEvent = NoteOnEvent | NoteOffEvent | { tick: number; type: 'tempo'; microsecondsPerBeat: number };

function u16(bytes: Uint8Array, offset: number) { return (bytes[offset] << 8) | bytes[offset + 1]; }
function u32(bytes: Uint8Array, offset: number) { return ((bytes[offset] * 0x1000000) + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])) >>> 0; }

function variableLength(bytes: Uint8Array, offset: number) {
  let value = 0;
  let position = offset;
  for (let index = 0; index < 4 && position < bytes.length; index += 1) {
    const byte = bytes[position++];
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) return { value, position };
  }
  throw new Error('This MIDI file contains an invalid variable-length value.');
}

function partForMidi(midi: number, ranges: SatbMidiRanges) {
  if (midi <= ranges.bassMax) return 3;
  if (midi <= ranges.tenorMax) return 2;
  if (midi <= ranges.altoMax) return 1;
  return 0;
}

/** Keep editor ranges ordered and within the valid MIDI scale. */
export function normaliseSatbMidiRanges(ranges: SatbMidiRanges): SatbMidiRanges {
  const bassMax = Math.max(0, Math.min(125, Math.round(ranges.bassMax)));
  const tenorMax = Math.max(bassMax + 1, Math.min(126, Math.round(ranges.tenorMax)));
  const altoMax = Math.max(tenorMax + 1, Math.min(127, Math.round(ranges.altoMax)));
  return { bassMax, tenorMax, altoMax };
}

export function midiSourceKey(note: Pick<ImportedMidiNote, 'sourceTrack' | 'channel'>) { return `${note.sourceTrack}:${note.channel}`; }

export function assignMidiParts(notes: ImportedMidiNote[], ranges: SatbMidiRanges, fixedPart: number | null = null, sourceParts: Record<string, number> = {}): SongNote[] {
  const safeRanges = normaliseSatbMidiRanges(ranges);
  return notes.map((note, index) => {
    const mappedPart = sourceParts[midiSourceKey(note)];
    return {
      midi: note.midi,
      start: note.start,
      end: note.end,
      velocity: note.velocity,
      id: `midi-${crypto.randomUUID()}-${index}`,
      part: fixedPart === null ? (mappedPart >= 0 && mappedPart <= 3 ? mappedPart : partForMidi(note.midi, safeRanges)) : fixedPart,
      lyric: '',
    };
  });
}

/**
 * Parse Standard MIDI Files (format 0 and 1). MIDI has note events, not an
 * instrument recording, so piano, guitar and vocal MIDI all use this same
 * accurate timing path.
 */
export function parseMidiNotes(buffer: ArrayBuffer): ImportedMidiNote[] {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 14 || String.fromCharCode(...bytes.slice(0, 4)) !== 'MThd') throw new Error('Choose a Standard MIDI file (.mid or .midi).');
  const headerLength = u32(bytes, 4);
  const division = u16(bytes, 12);
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI is not supported yet. Please export a PPQN MIDI file.');
  if (!division) throw new Error('This MIDI file has no timing division.');

  const events: MidiEvent[] = [];
  let offset = 8 + headerLength;
  let trackIndex = 0;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const length = u32(bytes, offset + 4);
    offset += 8;
    const end = Math.min(bytes.length, offset + length);
    if (id !== 'MTrk') { offset = end; continue; }
    const currentTrack = trackIndex++;
    let position = offset;
    let tick = 0;
    let runningStatus = 0;
    while (position < end) {
      const delta = variableLength(bytes, position);
      tick += delta.value;
      position = delta.position;
      if (position >= end) break;
      let status = bytes[position++];
      let firstData: number | null = null;
      if (status < 0x80) {
        if (!runningStatus) throw new Error('This MIDI file has invalid running status.');
        firstData = status;
        status = runningStatus;
      } else if (status < 0xf0) runningStatus = status;

      if (status === 0xff) {
        if (position >= end) break;
        const type = bytes[position++];
        const value = variableLength(bytes, position);
        position = value.position;
        if (type === 0x51 && value.value === 3 && position + 3 <= end) events.push({ tick, type: 'tempo', microsecondsPerBeat: (bytes[position] << 16) | (bytes[position + 1] << 8) | bytes[position + 2] });
        position = Math.min(end, position + value.value);
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const value = variableLength(bytes, position);
        position = Math.min(end, value.position + value.value);
        continue;
      }
      const command = status & 0xf0;
      const channel = status & 0x0f;
      const dataLength = command === 0xc0 || command === 0xd0 ? 1 : 2;
      const data1 = firstData ?? bytes[position++];
      const data2 = dataLength === 2 ? bytes[position++] : 0;
      if (data1 === undefined || (dataLength === 2 && data2 === undefined)) break;
      if (command === 0x90 && data2 > 0) events.push({ tick, type: 'on', midi: data1, velocity: data2, channel, track: currentTrack });
      if (command === 0x80 || (command === 0x90 && data2 === 0)) events.push({ tick, type: 'off', midi: data1, velocity: data2, channel, track: currentTrack });
    }
    offset = end;
  }

  const tempos = events.filter((event): event is Extract<MidiEvent, { type: 'tempo' }> => event.type === 'tempo').sort((a, b) => a.tick - b.tick);
  const secondsAtTick = (target: number) => {
    let seconds = 0;
    let previousTick = 0;
    let tempo = 500000;
    for (const event of tempos) {
      if (event.tick > target) break;
      seconds += ((event.tick - previousTick) / division) * (tempo / 1000000);
      previousTick = event.tick;
      tempo = event.microsecondsPerBeat;
    }
    return seconds + ((target - previousTick) / division) * (tempo / 1000000);
  };

  const open = new Map<string, Array<Extract<MidiEvent, { type: 'on' }>>>();
  const notes: ImportedMidiNote[] = [];
  for (const event of events.filter((item): item is Extract<MidiEvent, { type: 'on' | 'off' }> => item.type === 'on' || item.type === 'off').sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 1))) {
    const key = `${event.track}:${event.channel}:${event.midi}`;
    if (event.type === 'on') {
      open.set(key, [...(open.get(key) ?? []), event]);
      continue;
    }
    const starts = open.get(key);
    const start = starts?.shift();
    if (!start) continue;
    const startSeconds = secondsAtTick(start.tick);
    const endSeconds = Math.max(startSeconds + 0.05, secondsAtTick(event.tick));
    notes.push({ midi: start.midi, start: Number(startSeconds.toFixed(3)), end: Number(endSeconds.toFixed(3)), velocity: start.velocity, sourceTrack: start.track, channel: start.channel });
  }
  return notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
}
