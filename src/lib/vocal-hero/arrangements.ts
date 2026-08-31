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
