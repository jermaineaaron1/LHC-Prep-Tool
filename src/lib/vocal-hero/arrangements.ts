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
}

export const ARRANGEMENT_STYLES: ArrangementStyle[] = [
  {
    id: 'softer',
    label: 'Softer · prayerful',
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

export type ArrangeEnergy = 'gentle' | 'building' | 'driving';

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
  };
}
