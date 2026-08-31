import type { DrumStyleId, InstrumentStyleId } from './accompaniment';
import type { SongNote } from './types';

// Suggested arrangements: a starting point, not a verdict.
//
// Each style is a handful of TEXTURES laid across the song in order, so the
// band grows and settles the way a real one does instead of strumming the
// same pattern from first bar to last. The first texture becomes the song's
// opening band; the rest land on the first melody note of each later span,
// which is exactly what a hand-written band instruction would do — so every
// suggestion can be nudged, replaced or undone note by note afterwards.

export type ArrangeEnergy = 'gentle' | 'building' | 'driving';

export interface ArrangementTexture {
  instrument: InstrumentStyleId | 'off';
  drums: DrumStyleId | 'off';
}

export interface ArrangementStyle {
  id: string;
  label: string;
  /** One line the user reads before choosing. */
  blurb: string;
  textures: ArrangementTexture[];
  /** How loudly this style wants the choir to sing, when the voices are
   *  shaped to match it. Without this a prayerful arrangement could be
   *  handed forte dynamics from the instrument picker's setting. */
  energy?: ArrangeEnergy;
}

export const ARRANGEMENT_STYLES: ArrangementStyle[] = [
  {
    id: 'softer',
    label: 'Softer · prayerful',
    energy: 'gentle',
    blurb: 'Fingerpicking and piano, drums held back until late — for reflective and communion songs.',
    textures: [
      { instrument: 'gtr-arp', drums: 'off' },
      { instrument: 'pno-arp', drums: 'off' },
      { instrument: 'gtr-travis', drums: 'cajon-sway' },
      { instrument: 'pad-held', drums: 'off' },
    ],
  },
  {
    id: 'driving',
    label: 'Fuller · driving',
    energy: 'driving',
    blurb: 'Strums into driving eighths with the kit behind them — for celebration and processionals.',
    textures: [
      { instrument: 'gtr-down', drums: 'drum-kit' },
      { instrument: 'gtr-8ths', drums: 'drum-drive' },
      { instrument: 'egtr-8ths', drums: 'drum-drive' },
      { instrument: 'gtr-down', drums: 'drum-kit' },
    ],
  },
  {
    id: 'blues',
    label: 'Bluesy',
    energy: 'building',
    blurb: 'Travis picking over a walking bass, kit straight behind — gritty and unhurried.',
    textures: [
      { instrument: 'gtr-travis', drums: 'cajon-groove' },
      { instrument: 'bass-walk', drums: 'drum-kit' },
      { instrument: 'gtr-down', drums: 'drum-kit' },
      { instrument: 'gtr-travis', drums: 'cajon-sway' },
    ],
  },
  {
    id: 'latin',
    label: 'Latin',
    energy: 'building',
    blurb: 'Cajon throughout with fingerpicked and folk patterns above it.',
    textures: [
      { instrument: 'gtr-arp', drums: 'cajon-groove' },
      { instrument: 'gtr-folk', drums: 'cajon-groove' },
      { instrument: 'gtr-travis', drums: 'cajon-groove' },
      { instrument: 'pno-arp', drums: 'cajon-sway' },
    ],
  },
  {
    id: 'jazz',
    label: 'Jazz',
    energy: 'building',
    blurb: 'Piano comping and a walking bass, brushed kit — loose and conversational.',
    textures: [
      { instrument: 'pno-chords', drums: 'cajon-sway' },
      { instrument: 'bass-walk', drums: 'drum-kit' },
      { instrument: 'pno-arp', drums: 'drum-kit' },
      { instrument: 'pno-chords', drums: 'off' },
    ],
  },
  {
    id: 'contemporary',
    label: 'Contemporary · Hillsong / Elevation',
    energy: 'driving',
    blurb: 'Pad underneath, picked electric on top, kit lifting into the last section.',
    textures: [
      { instrument: 'pad-held', drums: 'off' },
      { instrument: 'egtr-arp', drums: 'drum-kit' },
      { instrument: 'egtr-8ths', drums: 'drum-drive' },
      { instrument: 'pad-held', drums: 'drum-kit' },
    ],
  },
  {
    id: 'worshipband',
    label: 'Worship band · Baloche / Moen',
    energy: 'building',
    blurb: 'Acoustic-led and singable: picking, folk strum, then piano and cajon to close.',
    textures: [
      { instrument: 'gtr-arp', drums: 'off' },
      { instrument: 'gtr-folk', drums: 'cajon-groove' },
      { instrument: 'gtr-down', drums: 'drum-kit' },
      { instrument: 'pno-chords', drums: 'cajon-sway' },
    ],
  },
  {
    id: 'gospel',
    label: 'Gospel',
    energy: 'driving',
    blurb: 'Piano at the centre, brass swelling into the final section.',
    textures: [
      { instrument: 'pno-chords', drums: 'drum-kit' },
      { instrument: 'pno-arp', drums: 'drum-kit' },
      { instrument: 'brs-held', drums: 'drum-drive' },
      { instrument: 'pno-chords', drums: 'drum-kit' },
    ],
  },
  {
    id: 'eastern-blues',
    label: 'Middle Eastern × blues',
    energy: 'building',
    blurb: 'A sustained drone under bluesy picking, hand percussion keeping it moving.',
    textures: [
      { instrument: 'str-held', drums: 'cajon-groove' },
      { instrument: 'gtr-travis', drums: 'cajon-groove' },
      { instrument: 'pad-held', drums: 'cajon-sway' },
      { instrument: 'gtr-travis', drums: 'drum-kit' },
    ],
  },
  {
    id: 'strings',
    label: 'Strings & pad · cinematic',
    energy: 'gentle',
    blurb: 'No rhythm section at all — sustained strings, pad and brass carrying the song.',
    textures: [
      { instrument: 'pad-held', drums: 'off' },
      { instrument: 'str-held', drums: 'off' },
      { instrument: 'brs-held', drums: 'off' },
      { instrument: 'str-held', drums: 'off' },
    ],
  },
];

export interface ArrangementPlan {
  /** What the band plays from the top of the song. */
  opening: ArrangementTexture;
  /** Later changes, each carried by the melody note that starts its span. */
  changes: Array<{ noteId: string; texture: ArrangementTexture }>;
}

/**
 * Lay a style's textures across the song.
 *
 * Spans are equal slices of the sung music, and each change is pinned to the
 * first melody note at or after its slice — a band instruction only takes
 * effect at a bar line anyway, and pinning it to a real note is what makes it
 * editable in the score afterwards. A song with too few notes to divide
 * simply gets its opening texture and nothing else.
 */
export function buildArrangement(style: ArrangementStyle, notes: SongNote[]): ArrangementPlan {
  const melody = notes
    .filter(note => note.part === 0 || note.part === -1)
    .sort((a, b) => a.start - b.start);
  const line = melody.length ? melody : [...notes].sort((a, b) => a.start - b.start);
  const opening = style.textures[0] ?? { instrument: 'off', drums: 'off' };
  if (line.length < 8 || style.textures.length < 2) return { opening, changes: [] };

  const first = line[0].start;
  const last = line[line.length - 1].end;
  const span = (last - first) / style.textures.length;
  if (span <= 0.5) return { opening, changes: [] };

  const changes: ArrangementPlan['changes'] = [];
  const used = new Set<string>();
  for (let index = 1; index < style.textures.length; index++) {
    const at = first + span * index;
    const carrier = line.find(note => note.start >= at - 0.001 && !used.has(note.id));
    if (!carrier) continue;
    used.add(carrier.id);
    changes.push({ noteId: carrier.id, texture: style.textures[index] });
  }
  return { opening, changes };
}

// ── arranging from the instruments YOU pick ────────────────────────────────
//
// The styles above are recipes someone else wrote. This builds one from the
// players actually in the room: choose the instruments, choose how much
// energy the song wants, and each instrument is voiced from its sparsest
// pattern to its fullest across the song.

export interface InstrumentOption {
  id: string;
  label: string;
  /** Patterns for this instrument, sparsest first. */
  ladder: InstrumentStyleId[];
}

export interface PercussionOption {
  id: string;
  label: string;
  ladder: DrumStyleId[];
}

export const ARRANGE_INSTRUMENTS: InstrumentOption[] = [
  { id: 'acoustic', label: '\ud83c\udfb8 Acoustic guitar', ladder: ['gtr-arp', 'gtr-travis', 'gtr-folk', 'gtr-down', 'gtr-8ths'] },
  { id: 'electric', label: '\u26a1 Electric guitar', ladder: ['egtr-arp', 'egtr-arp', 'egtr-8ths', 'egtr-8ths'] },
  { id: 'piano', label: '\ud83c\udfb9 Piano', ladder: ['pno-arp', 'pno-arp', 'pno-chords', 'pno-chords'] },
  { id: 'bass', label: '\ud83c\udfb8 Bass', ladder: ['bass-walk'] },
  { id: 'strings', label: '\ud83c\udfbb Strings', ladder: ['str-held'] },
  { id: 'pad', label: '\ud83c\udf2b\ufe0f Pad', ladder: ['pad-held'] },
  { id: 'brass', label: '\ud83c\udfba Brass', ladder: ['brs-held'] },
];

export const ARRANGE_PERCUSSION: PercussionOption[] = [
  { id: 'kit', label: '\ud83e\udd41 Drum kit', ladder: ['drum-kit', 'drum-kit', 'drum-drive', 'drum-drive'] },
  { id: 'cajon', label: '\ud83e\ude98 Cajon', ladder: ['cajon-sway', 'cajon-groove', 'cajon-groove', 'cajon-groove'] },
];


export const ARRANGE_ENERGIES: Array<{ id: ArrangeEnergy; label: string; blurb: string }> = [
  { id: 'gentle', label: 'Gentle', blurb: 'Stays sparse, percussion only near the end.' },
  { id: 'building', label: 'Building', blurb: 'Opens quietly and grows through the song.' },
  { id: 'driving', label: 'Driving', blurb: 'Full from early on and stays there.' },
];

const SECTIONS = 4;

/**
 * Compose an arrangement from chosen instruments.
 *
 * Each section takes its instrument from the picks in turn, so everyone gets
 * played rather than one instrument holding the whole song. How far up that
 * instrument's ladder the section reaches — and whether percussion has come
 * in yet — is what the energy setting decides.
 */
export function buildFromInstruments(
  instrumentIds: string[],
  percussionId: string | null,
  energy: ArrangeEnergy,
): ArrangementStyle | null {
  const picks = ARRANGE_INSTRUMENTS.filter(item => instrumentIds.includes(item.id));
  const drums = ARRANGE_PERCUSSION.find(item => item.id === percussionId) ?? null;
  if (!picks.length && !drums) return null;

  // How full each section is (0 = sparsest), and where percussion starts.
  const shape: Record<ArrangeEnergy, { rung: number[]; drumsFrom: number }> = {
    gentle: { rung: [0, 0, 1, 0], drumsFrom: 2 },
    building: { rung: [0, 1, 2, 1], drumsFrom: 1 },
    driving: { rung: [1, 2, 3, 2], drumsFrom: 0 },
  };
  const plan = shape[energy];

  const textures: ArrangementTexture[] = [];
  for (let section = 0; section < SECTIONS; section++) {
    const pick = picks.length ? picks[section % picks.length] : null;
    const rung = Math.min(plan.rung[section], (pick?.ladder.length ?? 1) - 1);
    const instrument: ArrangementTexture['instrument'] = pick ? pick.ladder[Math.max(0, rung)] : 'off';
    const drumRung = Math.min(plan.rung[section], (drums?.ladder.length ?? 1) - 1);
    const percussion: ArrangementTexture['drums'] = drums && section >= plan.drumsFrom
      ? drums.ladder[Math.max(0, drumRung)]
      : 'off';
    textures.push({ instrument, drums: percussion });
  }

  const names = [...picks.map(item => item.label), ...(drums ? [drums.label] : [])]
    .map(label => label.replace(/^[^A-Za-z]+/, ''));
  return {
    id: 'custom',
    label: names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(' & '),
    blurb: `Your instruments, ${energy}.`,
    textures,
    energy,
  };
}

// ── making the band and the voices agree ───────────────────────────────────
//
// Two directions, and they are not the same job:
//
//   FOLLOW THE VOICES  reads the singing and shapes the band to it. Changes
//   land where the choir breathes, and each phrase gets a texture chosen by
//   how full that phrase actually is - how many parts are singing and how
//   loudly - instead of by the clock.
//
//   SHAPE THE VOICES   goes the other way: it writes the choir's dynamics to
//   match the arrangement's arc. It touches loudness only. Pitches, rhythms
//   and words are never rewritten - an automatic re-voicing of a hymn is a
//   different and much riskier thing, and it is not what this does.

export interface VocalPhrase {
  start: number;
  end: number;
  /** 0 = the thinnest, quietest phrase in the song, 1 = the fullest. */
  fullness: number;
  /** The melody note that opens the phrase. */
  leadNoteId: string;
}

/**
 * Split the singing into phrases.
 *
 * Three readings, in order, because hymn transcriptions differ: the breaths
 * (gaps) if the writing has them; otherwise the WORDS, since a comma or full
 * stop in the lyric is exactly where a phrase closes; otherwise the long
 * notes phrases tend to end on. A song that answers to none of them is
 * divided evenly rather than treated as one long phrase.
 */
export function findVocalPhrases(notes: SongNote[]): VocalPhrase[] {
  const melody = notes
    .filter(note => note.part === 0 || note.part === -1)
    .sort((a, b) => a.start - b.start);
  const line = melody.length ? melody : [...notes].sort((a, b) => a.start - b.start);
  if (!line.length) return [];

  const spans = line.map(note => note.end - note.start).sort((a, b) => a - b);
  const typical = spans[Math.floor(spans.length / 2)] || 0.5;

  const groupBy = (endsPhrase: (note: SongNote, index: number) => boolean): SongNote[][] => {
    const groups: SongNote[][] = [[]];
    line.forEach((note, index) => {
      groups[groups.length - 1].push(note);
      if (endsPhrase(note, index) && index < line.length - 1) groups.push([]);
    });
    return groups.filter(group => group.length);
  };

  // 1. breaths: a gap noticeably longer than the beat the song moves in
  const breath = Math.max(0.28, typical * 1.4);
  let groups = groupBy((note, index) => index + 1 < line.length && line[index + 1].start - note.end >= breath);

  // 2. the words: a lyric ending in punctuation closes its phrase
  if (groups.length < 2) {
    groups = groupBy(note => /[,.;:!?\u2014]$/.test((note.lyric ?? '').trim()));
  }

  // 3. the long notes phrases tend to land on
  if (groups.length < 2) {
    const long = typical * 1.75;
    groups = groupBy(note => note.end - note.start >= long);
  }

  // 4. nothing legible in the writing: divide it evenly
  if (groups.length < 2 && line.length >= 8) {
    const per = Math.ceil(line.length / 4);
    groups = [];
    for (let index = 0; index < line.length; index += per) groups.push(line.slice(index, index + per));
  }

  // Fragments belong to the phrase before them.
  const merged: SongNote[][] = [];
  for (const group of groups) {
    if (merged.length && group.length < 3) merged[merged.length - 1].push(...group);
    else merged.push(group);
  }

  const raw = merged.map(group => {
    const start = group[0].start;
    const end = group[group.length - 1].end;
    const sounding = notes.filter(note => note.start < end - 0.001 && note.end > start + 0.001);
    const parts = new Set(sounding.map(note => (note.part === -1 ? 0 : note.part))).size;
    const meanVelocity = sounding.length
      ? sounding.reduce((sum, note) => sum + note.velocity, 0) / sounding.length
      : 80;
    // Half the weight on how many voices are singing, half on how loudly.
    const score = (Math.min(parts, 4) / 4) * 0.5 + (Math.max(40, Math.min(120, meanVelocity)) - 40) / 80 * 0.5;
    return { start, end, score, leadNoteId: group[0].id };
  });

  const scores = raw.map(item => item.score);
  const low = Math.min(...scores);
  const high = Math.max(...scores);
  const spread = high - low;
  return raw.map((item, index) => ({
    start: item.start,
    end: item.end,
    leadNoteId: item.leadNoteId,
    // With nothing to tell the phrases apart, let the song still rise and
    // fall rather than sitting on one texture from end to end.
    fullness: spread < 0.02
      ? (raw.length < 2 ? 0.5 : index / (raw.length - 1))
      : (item.score - low) / spread,
  }));
}

/**
 * Lay a style over the song by ear rather than by the clock: one instruction
 * per sung phrase, its texture chosen by how full that phrase is.
 *
 * Neighbouring phrases that want the same texture are left alone rather than
 * re-stated, so the score carries a change only where something changes.
 */
export function buildArrangementFollowingVoices(style: ArrangementStyle, notes: SongNote[]): ArrangementPlan {
  const phrases = findVocalPhrases(notes);
  const textures = style.textures;
  const opening = textures[0] ?? { instrument: 'off', drums: 'off' };
  if (phrases.length < 2 || textures.length < 2) return buildArrangement(style, notes);

  const textureFor = (fullness: number) => textures[Math.max(0, Math.min(textures.length - 1, Math.round(fullness * (textures.length - 1))))];
  const changes: ArrangementPlan['changes'] = [];
  let current = textureFor(phrases[0].fullness);
  const openingTexture = current;
  for (let index = 1; index < phrases.length; index++) {
    const texture = textureFor(phrases[index].fullness);
    if (texture.instrument === current.instrument && texture.drums === current.drums) continue;
    changes.push({ noteId: phrases[index].leadNoteId, texture });
    current = texture;
  }
  return { opening: openingTexture ?? opening, changes };
}

/** What the choir should be singing, phrase by phrase, under a given arc. */
export interface VocalShaping {
  noteId: string;
  dynamic: 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff';
  /** Suggested velocity for every note of the phrase. */
  velocity: number;
}

const DYNAMIC_LADDER: Array<{ mark: VocalShaping['dynamic']; velocity: number }> = [
  { mark: 'pp', velocity: 48 },
  { mark: 'p', velocity: 62 },
  { mark: 'mp', velocity: 74 },
  { mark: 'mf', velocity: 88 },
  { mark: 'f', velocity: 102 },
  { mark: 'ff', velocity: 116 },
];

/**
 * Write the choir's dynamics to match an arrangement's energy.
 *
 * Loudness only - the notes, rhythms and words are untouched. Gentle keeps
 * the range low and narrow, driving sits high, building sweeps between them
 * in the shape the phrases already have.
 */
export function buildVocalShaping(energy: ArrangeEnergy, notes: SongNote[]): VocalShaping[] {
  const phrases = findVocalPhrases(notes);
  if (!phrases.length) return [];
  const window: Record<ArrangeEnergy, [number, number]> = {
    gentle: [0, 2],
    building: [1, 4],
    driving: [3, 5],
  };
  const [floor, ceiling] = window[energy];
  return phrases.map(phrase => {
    const step = Math.round(floor + phrase.fullness * (ceiling - floor));
    const rung = DYNAMIC_LADDER[Math.max(0, Math.min(DYNAMIC_LADDER.length - 1, step))];
    return { noteId: phrase.leadNoteId, dynamic: rung.mark, velocity: rung.velocity };
  });
}

// ── the harmony the choir is already singing ───────────────────────────────
//
// The chord-playing styles (every guitar and piano pattern) build their notes
// from the song's chord symbols. A song with none - which is most hymns as
// transcribed - hears drums and nothing else, however carefully it was
// arranged. But an SATB score already CONTAINS its harmony: four parts
// sounding together spell the chord. This reads it back out.

const PITCH_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Chord shapes worth naming. `plain` marks the everyday triads a hymn is
 *  actually built from; anything richer has to earn its place. */
const SHAPES: Array<{ suffix: string; degrees: number[]; plain?: boolean }> = [
  { suffix: '', degrees: [0, 4, 7], plain: true },
  { suffix: 'm', degrees: [0, 3, 7], plain: true },
  { suffix: '7', degrees: [0, 4, 7, 10] },
  { suffix: 'maj7', degrees: [0, 4, 7, 11] },
  { suffix: 'm7', degrees: [0, 3, 7, 10] },
  { suffix: 'dim', degrees: [0, 3, 6] },
  { suffix: 'sus4', degrees: [0, 5, 7] },
  { suffix: '5', degrees: [0, 7] },
];

export interface InferredChord { at: number; symbol: string }

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

/** The scale the song mostly lives in, so a chord built from notes outside it
 *  has to be clearly right before it is named. */
function scaleOf(notes: SongNote[]): Set<number> {
  const weight = new Array(12).fill(0);
  for (const note of notes) weight[((note.midi % 12) + 12) % 12] += Math.max(0.05, note.end - note.start);
  let best = { fit: -1, steps: MAJOR_STEPS, tonic: 0 };
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const steps of [MAJOR_STEPS, MINOR_STEPS]) {
      const inScale = new Set(steps.map(step => (tonic + step) % 12));
      let fit = 0;
      for (let pc = 0; pc < 12; pc++) fit += inScale.has(pc) ? weight[pc] : -weight[pc] * 1.2;
      if (fit > best.fit) best = { fit, steps, tonic };
    }
  }
  return new Set(best.steps.map(step => (best.tonic + step) % 12));
}

/**
 * Read a chord per bar from what the voices actually sing.
 *
 * Each pitch class is weighted by how long it sounds in the bar, the lowest
 * voice is given extra weight because the bass is what names a chord, and
 * every shape is scored on what it explains minus what it leaves out. Bars
 * that keep the previous chord are not re-stated.
 */
export function inferChordsFromVoices(
  notes: SongNote[],
  bars: Array<{ start: number; end: number }>,
): InferredChord[] {
  // Hymns commonly change harmony inside the bar, so read each half-bar; a
  // half that agrees with the one before simply is not re-stated.
  const windows: Array<{ start: number; end: number }> = [];
  for (const bar of bars) {
    const length = bar.end - bar.start;
    if (length > 1.2) {
      const middle = bar.start + length / 2;
      windows.push({ start: bar.start, end: middle }, { start: middle, end: bar.end });
    } else windows.push({ start: bar.start, end: bar.end });
  }

  const scale = scaleOf(notes);
  const out: InferredChord[] = [];
  let previous = '';
  for (const span of windows) {
    const sounding = notes.filter(note => note.start < span.end - 0.001 && note.end > span.start + 0.001);
    if (sounding.length < 2) continue;

    const weight = new Array(12).fill(0);
    let lowest = Number.POSITIVE_INFINITY;
    let lowestPc = -1;
    for (const note of sounding) {
      const held = Math.min(note.end, span.end) - Math.max(note.start, span.start);
      if (held <= 0) continue;
      const pc = ((note.midi % 12) + 12) % 12;
      weight[pc] += held;
      if (note.midi < lowest) { lowest = note.midi; lowestPc = pc; }
    }
    const total = weight.reduce((sum, value) => sum + value, 0);
    if (total <= 0) continue;

    let best = { score: -Infinity, symbol: '' };
    for (let root = 0; root < 12; root++) {
      for (const shape of SHAPES) {
        const inChord = new Set(shape.degrees.map(degree => (root + degree) % 12));
        let explained = 0;
        let stray = 0;
        for (let pc = 0; pc < 12; pc++) {
          if (weight[pc] <= 0) continue;
          if (inChord.has(pc)) explained += weight[pc];
          else stray += weight[pc];
        }
        // The bass names the chord; a plain triad is what a hymn is built
        // from; and a fourth note must explain a good deal more to be worth
        // naming, or every passing tone turns the song into sevenths.
        const bassBonus = lowestPc === root ? total * 0.35 : 0;
        const plainBonus = shape.plain ? total * 0.1 : 0;
        const extension = Math.max(0, shape.degrees.length - 3) * total * 0.22;
        const thin = shape.degrees.length < 3 ? total * 0.12 : 0;
        const outOfKey = shape.degrees.filter(degree => !scale.has((root + degree) % 12)).length;
        const score = explained - stray * 1.15 + bassBonus + plainBonus - extension - thin - outOfKey * total * 0.14;
        if (score > best.score) best = { score, symbol: PITCH_NAMES[root] + shape.suffix };
      }
    }
    if (!best.symbol || best.symbol === previous) continue;
    previous = best.symbol;
    out.push({ at: span.start, symbol: best.symbol });
  }
  return out;
}
