'use client';

import type { SongNote } from './types';

// MusicXML import.
//
// MIDI throws away the two things that make building a song hard: it carries no
// lyrics at all, and no voice identity -- which is why the MIDI path has to
// GUESS whether a note is alto or tenor from its pitch. MusicXML carries
// separate voices, their lyrics already broken into syllables, the key and the
// tempo. For a hymn downloaded from a public-domain score library that turns
// "author an arrangement" into "read a file".
//
// This parses the subset real choral scores use: partwise scores, multiple
// staves and voices, chords, ties, rests, backup/forward, tempo changes and
// lyrics with syllabic hyphenation. Repeats and grace notes are reported rather
// than guessed at -- see the warnings below.

const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** MusicXML does not require a tempo, and a score without one still has to play. */
const DEFAULT_BPM = 100;
const VOICE_NAMES = ['Soprano', 'Alto', 'Tenor', 'Bass'];

export interface ImportedXmlNote extends Omit<SongNote, 'id' | 'part'> {
  /** Which staff and voice of which part this came from. */
  sourceKey: string;
}

export interface XmlSource {
  key: string;
  label: string;
  count: number;
  low: number;
  high: number;
  /** Best guess at the SATB lane. */
  suggestedPart: number;
  /** Why that guess was made, so a reviewer can judge it rather than trust it. */
  reason: string;
}

export interface MusicXmlImport {
  title: string;
  notes: ImportedXmlNote[];
  sources: XmlSource[];
  bpm: number;
  lyricCount: number;
  warnings: string[];
}

// ── a very small XML reader ────────────────────────────────────────────────
// Enough for MusicXML and nothing more. Hand-written because the project has no
// XML dependency, and because it must behave identically in the browser and in
// a Node test harness.

export interface XmlNode { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };

function decode(raw: string): string {
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

export function parseXml(source: string): XmlNode {
  // Declarations, doctypes and comments carry nothing we need and complicate
  // every rule below, so they go first.
  const text = source
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/gi, '');

  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const tag = /<\s*(\/?)\s*([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)\s*>/g;
  let match: RegExpExecArray | null;
  let cursor = 0;

  while ((match = tag.exec(text)) !== null) {
    const [whole, closing, name, rawAttrs, selfClosing] = match;
    const between = text.slice(cursor, match.index);
    if (between.trim()) stack[stack.length - 1].text += decode(between);
    cursor = match.index + whole.length;

    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
      continue;
    }

    const attrs: Record<string, string> = {};
    const attr = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let found: RegExpExecArray | null;
    while ((found = attr.exec(rawAttrs)) !== null) attrs[found[1]] = decode(found[2] ?? found[3] ?? '');

    const node: XmlNode = { name, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

const child = (node: XmlNode | undefined, name: string): XmlNode | undefined => node?.children.find(c => c.name === name);
const kids = (node: XmlNode | undefined, name: string): XmlNode[] => node ? node.children.filter(c => c.name === name) : [];
const textOf = (node: XmlNode | undefined): string => (node ? node.text.trim() : '');
const numOf = (node: XmlNode | undefined, fallback = 0): number => {
  const value = Number(textOf(node));
  return Number.isFinite(value) && textOf(node) !== '' ? value : fallback;
};

// ── tempo ──────────────────────────────────────────────────────────────────

interface TempoMark { quarter: number; bpm: number }

/** Seconds elapsed at a position measured in quarter notes, across tempo changes. */
function timeline(marks: TempoMark[]): (quarter: number) => number {
  const sorted = [...marks].sort((a, b) => a.quarter - b.quarter);
  if (!sorted.length || sorted[0].quarter > 0) sorted.unshift({ quarter: 0, bpm: sorted[0]?.bpm ?? DEFAULT_BPM });
  const anchors: Array<TempoMark & { seconds: number }> = [];
  let seconds = 0;
  for (let i = 0; i < sorted.length; i++) {
    anchors.push({ ...sorted[i], seconds });
    const next = sorted[i + 1];
    if (next) seconds += (next.quarter - sorted[i].quarter) * (60 / sorted[i].bpm);
  }
  return (quarter: number) => {
    let anchor = anchors[0];
    for (const candidate of anchors) { if (candidate.quarter <= quarter + 1e-9) anchor = candidate; else break; }
    return anchor.seconds + (quarter - anchor.quarter) * (60 / anchor.bpm);
  };
}

// ── working out which lane a voice belongs in ──────────────────────────────

function partFromName(name: string): number | null {
  const lower = name.toLowerCase();
  if (/sopran|descant|treble|cantus/.test(lower)) return 0;
  if (/alto|contralto|mezzo/.test(lower)) return 1;
  if (/tenor/.test(lower)) return 2;
  if (/bass|bariton/.test(lower)) return 3;
  return null;
}

/** The closed score a hymnal prints: two staves, two voices each, S/A over T/B. */
function partFromStaffVoice(staff: number, voice: number, staffCount: number): number | null {
  if (staffCount !== 2) return null;
  const upper = staff === 1;
  const first = voice % 2 === 1;
  return upper ? (first ? 0 : 1) : (first ? 2 : 3);
}

function partFromPitch(median: number): number {
  if (median >= 67) return 0;
  if (median >= 60) return 1;
  if (median >= 52) return 2;
  return 3;
}

// ── the importer ───────────────────────────────────────────────────────────

export function parseMusicXml(source: string): MusicXmlImport {
  const root = parseXml(source);
  const score = child(root, 'score-partwise');
  const warnings: string[] = [];
  if (!score) {
    if (child(root, 'score-timewise')) throw new Error('This is a timewise MusicXML file. Open it in MuseScore and export again — partwise is what every editor writes by default.');
    throw new Error('That does not look like MusicXML: there is no <score-partwise> element.');
  }

  const title = textOf(child(child(score, 'work'), 'work-title')) || textOf(child(score, 'movement-title')) || '';

  const partNames = new Map<string, string>();
  for (const scorePart of kids(child(score, 'part-list'), 'score-part')) {
    partNames.set(scorePart.attrs.id ?? '', textOf(child(scorePart, 'part-name')) || textOf(child(scorePart, 'part-abbreviation')) || '');
  }

  const parts = kids(score, 'part');
  if (!parts.length) throw new Error('The file has no parts in it.');

  // Tempo is declared inside whichever part happens to carry the direction, but
  // it governs the whole score. Collecting it in quarter notes gives a unit
  // every part agrees on regardless of its own divisions value.
  const tempos: TempoMark[] = [];
  for (const part of parts) {
    let divisions = 1, quarter = 0;
    for (const measure of kids(part, 'measure')) {
      for (const node of measure.children) {
        if (node.name === 'attributes') { const d = numOf(child(node, 'divisions'), 0); if (d > 0) divisions = d; }
        else if (node.name === 'direction' || node.name === 'sound') {
          const sound = node.name === 'sound' ? node : child(node, 'sound');
          const bpm = Number(sound?.attrs.tempo);
          if (Number.isFinite(bpm) && bpm > 0) tempos.push({ quarter, bpm });
        } else if (node.name === 'note') {
          if (child(node, 'chord') || child(node, 'grace')) continue;
          quarter += numOf(child(node, 'duration')) / divisions;
        } else if (node.name === 'backup') quarter -= numOf(child(node, 'duration')) / divisions;
        else if (node.name === 'forward') quarter += numOf(child(node, 'duration')) / divisions;
      }
    }
  }
  const secondsAt = timeline(tempos);
  const bpm = tempos.length ? tempos[0].bpm : DEFAULT_BPM;
  if (!tempos.length) warnings.push('The score carries no tempo, so ' + DEFAULT_BPM + ' bpm was assumed — set the song tempo after importing.');

  const notes: ImportedXmlNote[] = [];
  const staffCounts = new Map<string, number>();
  let lyricCount = 0;
  let sawGrace = false, sawRepeat = false;

  for (const part of parts) {
    const partId = part.attrs.id ?? '';
    let divisions = 1, quarter = 0;
    // A tie can only continue on the same voice at the same pitch, which is
    // exactly the key used here.
    const openTies = new Map<string, ImportedXmlNote>();
    let previousStart = 0;

    for (const measure of kids(part, 'measure')) {
      if (kids(child(measure, 'barline'), 'repeat').length) sawRepeat = true;
      for (const node of measure.children) {
        if (node.name === 'attributes') {
          const d = numOf(child(node, 'divisions'), 0);
          if (d > 0) divisions = d;
          const staves = numOf(child(node, 'staves'), 0);
          if (staves > 0) staffCounts.set(partId, staves);
        } else if (node.name === 'backup') {
          quarter -= numOf(child(node, 'duration')) / divisions;
        } else if (node.name === 'forward') {
          quarter += numOf(child(node, 'duration')) / divisions;
        } else if (node.name === 'note') {
          // Grace notes have no written duration; sounding them would take time
          // the bar does not have and push everything after them late.
          if (child(node, 'grace')) { sawGrace = true; continue; }

          const isChord = Boolean(child(node, 'chord'));
          const duration = numOf(child(node, 'duration')) / divisions;
          const start = isChord ? previousStart : quarter;

          if (child(node, 'rest')) { if (!isChord) quarter += duration; continue; }

          const pitch = child(node, 'pitch');
          if (!pitch) { if (!isChord) quarter += duration; continue; }
          const step = STEP_SEMITONES[textOf(child(pitch, 'step')).toUpperCase()] ?? 0;
          const octave = numOf(child(pitch, 'octave'), 4);
          const alter = numOf(child(pitch, 'alter'), 0);
          const midi = (octave + 1) * 12 + step + alter;

          const voice = Math.max(1, numOf(child(node, 'voice'), 1));
          const staff = Math.max(1, numOf(child(node, 'staff'), 1));
          const sourceKey = partId + ':s' + staff + ':v' + voice;

          const ties = kids(node, 'tie').map(t => t.attrs.type);
          const tieKey = sourceKey + ':' + midi;
          if (ties.includes('stop')) {
            const pending = openTies.get(tieKey);
            if (pending) {
              // A tied note is ONE sung note however many noteheads it is
              // written with. Extending the first is what keeps it that way.
              pending.end = secondsAt(start + duration);
              if (!ties.includes('start')) openTies.delete(tieKey);
              if (!isChord) { previousStart = start; quarter = start + duration; }
              continue;
            }
          }

          let lyric = '';
          const lyricNodes = kids(node, 'lyric');
          const lyricNode = lyricNodes.find(l => !l.attrs.number || l.attrs.number === '1') ?? lyricNodes[0];
          if (lyricNode) {
            const words = kids(lyricNode, 'text').map(t => t.text.trim()).filter(Boolean).join('');
            const syllabic = textOf(child(lyricNode, 'syllabic'));
            // The app's own convention: a word broken across notes keeps its
            // hyphen on the leading fragment.
            lyric = words && (syllabic === 'begin' || syllabic === 'middle') ? words + '-' : words;
            if (lyric) lyricCount++;
          }

          const note: ImportedXmlNote = { midi, start: secondsAt(start), end: secondsAt(start + duration), lyric, velocity: 96, sourceKey };
          notes.push(note);
          if (ties.includes('start')) openTies.set(tieKey, note);

          if (!isChord) { previousStart = start; quarter = start + duration; }
        }
      }
    }
  }

  if (!notes.length) throw new Error('The file parsed, but no sounding notes were found in it.');
  if (sawGrace) warnings.push('Grace notes were skipped: they carry no written duration, and sounding them would push the notes after them late.');
  if (sawRepeat) warnings.push('Repeat marks were ignored — the music is imported once through. Unfold repeats in MuseScore first if you want every verse.');

  // ---- group into sources, each with a suggested lane
  const grouped = new Map<string, ImportedXmlNote[]>();
  for (const note of notes) {
    if (!grouped.has(note.sourceKey)) grouped.set(note.sourceKey, []);
    grouped.get(note.sourceKey)!.push(note);
  }

  const sources: XmlSource[] = [];
  for (const [key, group] of grouped) {
    const [partId, staffPart, voicePart] = key.split(':');
    const staff = Number(staffPart.slice(1)), voice = Number(voicePart.slice(1));
    const name = partNames.get(partId) ?? '';
    const pitches = group.map(n => n.midi).sort((a, b) => a - b);
    const median = pitches[Math.floor(pitches.length / 2)];

    let suggestedPart = partFromName(name);
    let reason = suggestedPart !== null ? 'named "' + name + '"' : '';
    if (suggestedPart === null) {
      suggestedPart = partFromStaffVoice(staff, voice, staffCounts.get(partId) ?? 1);
      if (suggestedPart !== null) reason = 'closed score: staff ' + staff + ', voice ' + voice;
    }
    if (suggestedPart === null) { suggestedPart = partFromPitch(median); reason = 'pitch range'; }

    const label = (name || 'Part ' + partId) + (grouped.size > 1 ? ' · staff ' + staff + ', voice ' + voice : '');
    sources.push({ key, label, count: group.length, low: pitches[0], high: pitches[pitches.length - 1], suggestedPart, reason });
  }
  sources.sort((a, b) => a.suggestedPart - b.suggestedPart || a.key.localeCompare(b.key));

  // Shift the whole score so the music starts where the game expects it to,
  // rather than wherever an anacrusis or a leading rest left it.
  const earliest = Math.min(...notes.map(n => n.start));
  if (earliest > 0) for (const note of notes) { note.start -= earliest; note.end -= earliest; }

  return { title, notes, sources, bpm, lyricCount, warnings };
}

/** Assign each source to an SATB lane and hand back finished notes. */
export function assignXmlParts(notes: ImportedXmlNote[], mapping: Record<string, number>, makeId: () => string): SongNote[] {
  return notes.map(note => {
    const { sourceKey, ...rest } = note;
    return { ...rest, id: makeId(), part: mapping[sourceKey] ?? 0 };
  });
}

export const voiceName = (part: number) => VOICE_NAMES[part] ?? 'Soprano';

// ── .mxl ───────────────────────────────────────────────────────────────────

/**
 * Read a MusicXML file, compressed or not.
 *
 * `.mxl` is a zip, and it is what MuseScore and most score libraries hand you by
 * default, so refusing it would send every user back to re-export. Rather than
 * take a zip dependency for one format, this reads the archive directly and
 * inflates with the platform's own DecompressionStream.
 */
export async function readMusicXmlFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;   // "PK"
  if (!zipped) return new TextDecoder().decode(bytes);

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot open compressed .mxl files. Export as uncompressed MusicXML (.musicxml) instead.');
  }

  const view = new DataView(buffer);
  // The central directory is the only reliable index of a zip: scanning for
  // local headers misreads archives written with data descriptors.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That .mxl file is not a readable archive.');

  const entryCount = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);
  const entries: Array<{ name: string; method: number; offset: number; size: number }> = [];
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(pointer, true) !== 0x02014b50) break;
    const method = view.getUint16(pointer + 10, true);
    const size = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const offset = view.getUint32(pointer + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    entries.push({ name, method, offset, size });
    pointer += 46 + nameLength + extraLength + commentLength;
  }

  const read = async (entry: { name: string; method: number; offset: number; size: number }): Promise<string> => {
    const nameLength = view.getUint16(entry.offset + 26, true);
    const extraLength = view.getUint16(entry.offset + 28, true);
    const start = entry.offset + 30 + nameLength + extraLength;
    const raw = bytes.subarray(start, start + entry.size);
    if (entry.method === 0) return new TextDecoder().decode(raw);
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  };

  // A .mxl names its real score in META-INF/container.xml; the rest of the
  // archive is fonts and images.
  const container = entries.find(e => e.name === 'META-INF/container.xml');
  if (container) {
    const declared = parseXml(await read(container));
    const findRootfile = (node: XmlNode): XmlNode | undefined => {
      if (node.name === 'rootfile') return node;
      for (const c of node.children) { const hit = findRootfile(c); if (hit) return hit; }
      return undefined;
    };
    const path = findRootfile(declared)?.attrs['full-path'];
    const target = path ? entries.find(e => e.name === path) : undefined;
    if (target) return read(target);
  }
  const fallback = entries.find(e => !e.name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(e.name));
  if (!fallback) throw new Error('No MusicXML score was found inside that .mxl file.');
  return read(fallback);
}
