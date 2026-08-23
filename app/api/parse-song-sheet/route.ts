// POST /api/parse-song-sheet
//
// Takes a public URL to a PHOTO of a chord/lyrics sheet (uploaded client-side
// via the existing uploadToSupabase() helper) and asks Gemini to read it into
// the fields the Add Song form needs: title, artist, key, and the lyrics with
// their chords, in this app's own chord-above-lyric format.
//
// This route never writes to the database. It returns a draft for a human to
// review in the Add Song form, and nothing is saved until they press Save.
//
// Two deliberate constraints:
//
//   * Season, feel, style and themes are chosen from vocabularies the CLIENT
//     sends, drawn from the live library. The model picks from those lists or
//     returns null -- it never invents a value. Free text here would fragment
//     the filters, which read the library's own values.
//
//   * Chords are reported by provenance, not just presence. chordsFound means
//     symbols were printed on the page and transcribed. chordsSuggested means
//     the page had none and a plain diatonic accompaniment was proposed from
//     the key -- useful on a hymn score, but a proposal, and the banner in the
//     add-song form says so. The two are never both true, an unproposed
//     suggestion is checked against the key before it is returned, and doubt
//     resolves towards 'suggested' so it reaches the person reviewing it.
//
// Requires GEMINI_API_KEY -- a free key from Google AI Studio
// (https://aistudio.google.com/apikey), no paid plan needed.

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';

export const runtime = 'nodejs';
// Reading a page of music takes the model 20-25s on a busy day. The platform
// default is far shorter than that, so without this the function is killed
// mid-scan and the reader sees a timeout rather than a result.
export const maxDuration = 60;

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  pdf: 'application/pdf',
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  description: 'The song read from the photographed sheet. Use null for anything not legible or not present.',
  properties: {
    title: { type: Type.STRING, nullable: true, description: 'The song title exactly as printed. Null if no title is visible.' },
    artist: { type: Type.STRING, nullable: true, description: 'Author, composer or artist as printed. Null if absent.' },
    key: { type: Type.STRING, nullable: true, description: 'Musical key, chosen from the allowed keys list. Prefer inferring it from the chords themselves rather than a printed key signature. Null if there are no chords and no printed key.' },
    tempo: { type: Type.STRING, nullable: true, description: 'The feel, chosen from the allowed feels list, or null.' },
    style: { type: Type.STRING, nullable: true, description: 'The style, chosen from the allowed styles list, or null.' },
    season: { type: Type.STRING, nullable: true, description: 'Liturgical season, chosen from the allowed seasons list, or null. Only when the text clearly belongs to that season.' },
    themes: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Up to three themes, each chosen from the allowed themes list. Empty array if none clearly apply.' },
    scripture: { type: Type.STRING, nullable: true, description: 'Any scripture reference printed on the sheet, e.g. "Psalm 23". Null if absent.' },
    alternateTitle: { type: Type.STRING, nullable: true, description: 'A second title in brackets or on the line below. Null if there is only one title.' },
    copyright: { type: Type.STRING, nullable: true, description: 'The copyright line as printed, e.g. "(c) 1998 Thankyou Music". Usually small print at the foot of the page. Null if absent.' },
    ccli: { type: Type.STRING, nullable: true, description: 'The CCLI SONG number only, digits alone, from text like "CCLI Song #1234567". Not the licence number. Null if absent.' },
    timeSignature: { type: Type.STRING, nullable: true, description: 'Time signature as printed, e.g. "4/4", "3/4", "6/8". On a score it follows the clef and key signature. Null if absent.' },
    bpm: { type: Type.INTEGER, nullable: true, description: 'Beats per minute only if a number is printed. Null if none is printed -- never estimate one.' },
    capo: { type: Type.STRING, nullable: true, description: 'Any capo instruction as printed, e.g. "Capo 3". Null if absent.' },
    lyrics: { type: Type.STRING, nullable: true, description: 'The full lyrics in the required chord-sheet format, with any chord line -- transcribed or proposed -- written above the lyric line it belongs to. Null if no lyrics are legible.' },
    chordsFound: { type: Type.BOOLEAN, description: 'True only if chord symbols were actually WRITTEN on the sheet and transcribed. False otherwise, including when chords have been suggested instead.' },
    chordsSuggested: { type: Type.BOOLEAN, description: 'True only if no chords were written and you proposed a simple diatonic accompaniment, AND you wrote those chords into the lyrics field as chord lines. Never true at the same time as chordsFound.' },
    hasMusicNotation: { type: Type.BOOLEAN, description: 'True if the page shows actual music notation -- five-line staves with note heads. False for a page of words only, whether typed, printed or handwritten.' },
    versesOnPage: { type: Type.INTEGER, description: 'How many numbered verses are printed on the page. Count the verse numbers you can see (1. 2. 3.) even when they share a staff. 0 if the verses are not numbered.' },
    confidence: { type: Type.STRING, description: 'One of "high", "medium", "low" -- how legible the sheet was overall.' },
    notes: { type: Type.STRING, nullable: true, description: 'One short sentence for the reviewer about anything unclear, cut off, or guessed. Null if the read was clean.' },
  },
  required: ['title', 'artist', 'key', 'tempo', 'style', 'season', 'themes', 'scripture', 'alternateTitle', 'copyright', 'ccli', 'timeSignature', 'bpm', 'capo', 'lyrics', 'chordsFound', 'chordsSuggested', 'hasMusicNotation', 'versesOnPage', 'confidence', 'notes'],
};

// The client hands this route a URL and the server fetches it, so without a
// host check the endpoint will fetch anything reachable from the deployment --
// internal addresses included -- and hand the contents to a model that
// describes them back. Restricting it to our own storage bucket closes that,
// and means an image must be uploaded through the app before it can be
// scanned at all.
function isOwnStorage(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  let allowedHost = '';
  try { allowedHost = configured ? new URL(configured).hostname : ''; } catch { allowedHost = ''; }
  // Fall back to the shape of a Supabase storage host so a missing env var
  // cannot silently open this up to the whole internet.
  return allowedHost
    ? u.hostname === allowedHost
    : /^[a-z0-9-]+\.supabase\.co$/i.test(u.hostname);
}

// A chord line is one whose every token is chord-shaped. Used both to verify
// the model's chordsFound claim and to know which line to keep aligned when
// syllable hyphens are removed from the lyric beneath it.
// Built from a base shape rather than written out flat, because two things a
// hand-annotated hymnal does routinely were failing it, and one bad token
// disqualifies the whole line -- which then gets treated as a lyric and
// wrapped like prose.
//
//   Ab /G      a bass note written apart from the chord it belongs under.
//              On paper the slash sits under the stave where the bass moves,
//              so it is often a token of its own.
//   Db-Ab      two chords in one bar, joined by a dash. Standard shorthand
//              when someone is pencilling changes in above a printed score.
//
// Every part of a dash chain must itself be chord-shaped, which is what keeps
// lyrics out: "A-men" and "well-known" both fail on their second half.
const CHORD_ACCIDENTAL = '(#|b|\u266f|\u266d)?';
const CHORD_BASE = '[A-G]' + CHORD_ACCIDENTAL
  + '(maj|min|m|M|dim|aug|sus|add|alt)?[0-9]*'
  + '(sus[24]|add[29]|maj[79]|b5|b9|#5|#9|#11|b13)*'
  + '(\\/[A-G]' + CHORD_ACCIDENTAL + ')?';
const CHORD_SLASH_ONLY = '\\/[A-G]' + CHORD_ACCIDENTAL;
const CHORD_ONE = '(' + CHORD_BASE + '|' + CHORD_SLASH_ONLY + ')';
const CHORD_TOKEN = new RegExp('^' + CHORD_ONE + '(-' + CHORD_ONE + ')*$');

// A token that failed the chord test but still looks like one that was
// misread: a note letter, then at most a few chord-ish characters. "Bbn"
// qualifies; "the", "Amazing" and "me," do not.
const NEARLY_A_CHORD = /^[A-G][A-Za-z0-9#b/\u266d\u266f-]{0,3}$/;

function isChordLine(line: string): boolean {
  const bare = line.trim();
  if (!bare) return false;
  if (/^\[.*\]$/.test(bare)) return false;
  // Chord lines carry directions: "C G C D (G Last time)", "Am F (x2)",
  // "E7 (x2)". Judging the line with the note still in it failed the shape
  // test and sent a real chord line off to be wrapped like prose. The note is
  // set aside and the chords judged on their own.
  //
  // A first attempt demanded two chords once a note was present, to stop a
  // lyric reduced to one word by its own bracket being read as a chord. That
  // rejected "E7 (x2)", which is an ordinary chord line. The shape test is
  // enough on its own: a line has to be nothing but chords to pass it, and a
  // bracket with no chords beside it strips to nothing and fails anyway.
  const hasNote = /\([^)]*\)/.test(bare);
  const stripped = hasNote ? bare.replace(/\([^)]*\)/g, ' ').trim() : bare;
  const tokens = stripped.split(/\s+/).filter(Boolean);
  // The bound is a sanity check, not the safeguard. It used to be 12, which
  // had it backwards: a line of 14 chords over a long lyric is perfectly
  // ordinary, and rejecting it meant the chord line was treated as lyrics and
  // wrapped in half. What actually keeps lyrics out is the shape test below --
  // "Amazing", "Be still" and "Do Re Mi" all fail it, at any length.
  if (!tokens.length || tokens.length > 32) return false;
  const good = tokens.filter((tok) => CHORD_TOKEN.test(tok));
  if (good.length === tokens.length) return true;

  // One misread character must not cost a whole line of chords.
  //
  // Handwriting gets read imperfectly: a pencilled Bbm came back as "Bbn",
  // and because every token had to be chord-shaped, that single letter
  // demoted the entire line into the lyrics -- eight chord lines lost from
  // one page over one character. The same brittleness had already been paid
  // for twice, with "/G" and "Db-Ab".
  //
  // So a line may carry a minority of unrecognised tokens, provided real
  // chords clearly dominate and the strays still look like failed attempts at
  // a chord rather than words: short, starting on a note letter. Prose cannot
  // reach three quarters chord-shaped, which is what keeps lyrics out.
  if (tokens.length < 3 || good.length < 2) return false;
  if (good.length / tokens.length < 0.75) return false;
  return tokens.every((tok) => CHORD_TOKEN.test(tok) || NEARLY_A_CHORD.test(tok));
}
// Suggested chords are checked against the key they claim to be in. A chord
// invented outside the key is the failure mode that matters here: it sounds
// wrong under the congregation, and nobody proofreads a chord chart that
// arrived looking finished. Printed chords are never judged this way -- an
// out-of-key chord on a published sheet is the composer's, and correct.
const PITCH: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

function chordRoot(chord: string): number | null {
  const m = String(chord).replace(/\u266f/g, '#').replace(/\u266d/g, 'b').match(/^([A-G])(#|b)?/);
  if (!m) return null;
  const p = PITCH[m[1] + (m[2] || '')];
  return p === undefined ? null : p;
}

// Every chord in the transcription that does not belong to the stated key.
// Quality is not judged, only the root -- a major chord where a minor was
// wanted is a matter of taste, but an Eb in the key of G is a mistake.
function outOfKeyChords(text: string, key: string | null): string[] {
  const km = String(key || '').match(/^([A-G])(#|b|\u266f|\u266d)?\s*(m|min|minor)?/i);
  if (!km) return [];                        // no key read: nothing to check against
  const acc = (km[2] || '').replace('\u266f', '#').replace('\u266d', 'b');
  const tonic = PITCH[km[1].toUpperCase() + acc];
  if (tonic === undefined) return [];
  const scale = (km[3] ? MINOR_STEPS : MAJOR_STEPS).map((s) => (tonic + s) % 12);
  const bad = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!isChordLine(line)) continue;
    for (const token of line.match(/\S+/g) || []) {
      // A slash chord is only as good as both of its halves.
      for (const half of token.split('/')) {
        const r = chordRoot(half);
        if (r !== null && !scale.includes(r)) { bad.add(token); break; }
      }
    }
  }
  return [...bad];
}


// Work the key out from the chords when the model did not read it.
//
// The key signature is four flats in one corner of a photograph and the model
// misses it perhaps one scan in six -- the sheet comes back correct in every
// other respect and with no key at all. But the chords were transcribed, and
// a page of Ab, Bbm, Cm, Db, Eb and Fm can only be in one or two keys. That is
// arithmetic, not judgement, so it does not need the model.
//
// Only keys containing EVERY chord are considered. Where several do -- Ab and
// Db both hold all six of those -- the tonic is settled by the chord the music
// ends on, then the one it begins on, which is how tonality works in the hymns
// this reads. Anything still ambiguous is left null: a wrong key transposes the
// whole song, so silence is much the cheaper mistake.
const PITCH_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function inferKeyFromChords(text: string): string | null {
  const tokens = text.split(/\r?\n/).filter(isChordLine).join(' ').match(/\S+/g) || [];
  const roots: number[] = [];
  for (const tok of tokens) {
    // The chord proper, not its bass note: an inversion does not change the key.
    const r = chordRoot(tok.split('/')[0]);
    if (r !== null) roots.push(r);
  }
  const distinct = [...new Set(roots)];
  // Two chords fit too many keys to mean anything.
  if (distinct.length < 3) return null;

  const fits: number[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    const scale = MAJOR_STEPS.map((s) => (tonic + s) % 12);
    if (distinct.every((r) => scale.includes(r))) fits.push(tonic);
  }
  if (!fits.length) return null;                     // a misread chord, most likely
  if (fits.length === 1) return PITCH_NAMES[fits[0]];

  const last = roots[roots.length - 1];
  if (fits.includes(last)) return PITCH_NAMES[last];
  const first = roots[0];
  if (fits.includes(first)) return PITCH_NAMES[first];
  return null;
}
// Words that follow a dash as themselves rather than as the tail of a split
// word. Deliberately excludes anything that is also a common syllable -- "to"
// (in-to), "so" (al-so), "out" (with-out) -- because the two failures are not
// equal. A missed join leaves "with - out" on screen where the reviewer sees
// and fixes it; a wrong join silently welds "Jesus - my" into "Jesusmy".
const STANDALONE_AFTER_DASH = new Set([
  'and', 'my', 'the', 'of', 'he', 'she', 'we', 'you', 'your', 'they', 'their',
  'them', 'his', 'her', 'him', 'our', 'but', 'yet', 'when', 'where', 'what',
  'who', 'will', 'with', 'from', 'that', 'this', 'these', 'those', 'there',
  'then', 'than', 'are', 'was', 'were', 'have', 'has', 'had', 'not', 'all',
  'any', 'may', 'shall', 'should', 'would', 'could', 'lord', 'god', 'jesus',
  'christ', 'holy', 'praise', 'glory', 'grace', 'love', 'come', 'let',
]);

// Genuinely hyphenated words, which keep their hyphen. Everything else with
// a hyphen in it is treated as a word the engraver split across two notes.
//
// That is the right default for this material: across the test corpus every
// hyphen the model returned was a syllable split -- "un-known", "de-gree",
// "faith-ful", "dark-ness", "Jor-dan", "pit-y" -- and not one was a real
// compound. The list exists for the case that has not turned up yet, and is
// meant to grow when one does. A word wrongly joined shows up as nonsense in
// a draft somebody is about to read; a hyphen wrongly kept is the thing this
// feature was asked to stop doing.
const KEEP_HYPHEN = new Set([
  'well-known', 'well-loved', 'well-pleased', 'well-being', 'god-given',
  'heaven-sent', 'blood-bought', 'thrice-holy', 'ever-present', 'ever-living',
  'new-found', 'far-off', 'age-old', 'hard-won', 'self-same', 'twenty-four',
]);

// Spans to delete from a lyric line: a hyphen with whitespace beside it,
// joining two word characters. "lead - eth" is one word the engraver split
// across notes. "well-known", with no spaces, is a real compound and stays.
function hyphenRanges(lyric: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const re = /(\w)(\s*-\s*)(\w)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lyric)) !== null) {
    // A tight hyphen used to be skipped outright, on the theory that only a
    // spaced one could be a syllable split. The model emits both spacings for
    // the same split, so that theory cost 19 unjoined words across seven test
    // sheets. Asking the prompt to fix it did not work -- the count came back
    // 28 -- so the rule is enforced here instead, where it is not a matter of
    // the model being in the mood to comply.
    // A real compound keeps its hyphen however the page spaced it. This used
    // to be checked only for a tight hyphen, on the reasoning that a spaced one
    // must be a syllable split -- but a compound broken across a line ending,
    // "A well-" / "known hymn", becomes "well- known" once the lines are
    // merged, and the tight-only test let that through and welded it into
    // "wellknown". The list is short and explicit, so consulting it either way
    // costs nothing and cannot swallow a genuine split.
    const around = lyric.slice(0, m.index + 1).match(/[A-Za-z\u2019']+$/);
    const rest = lyric.slice(m.index + m[1].length + m[2].length).match(/^[A-Za-z\u2019']+/);
    const whole = ((around ? around[0] : m[1]) + '-' + (rest ? rest[0] : m[3])).toLowerCase();
    if (KEEP_HYPHEN.has(whole)) {
      // Keep the hyphen, lose the gaps. A compound the page broke across a
      // line comes back as "well- known", which is neither the split it looks
      // like nor the word it is. Deleting only the whitespace either side of
      // the hyphen leaves "well-known" and moves any chords by the same
      // amount, exactly as joining a real split does.
      const sepStart = m.index + m[1].length;
      const dash = m[2].indexOf('-');
      if (dash > 0) ranges.push({ start: sepStart, end: sepStart + dash });
      const tailStart = sepStart + dash + 1;
      const tailEnd = sepStart + m[2].length;
      if (tailEnd > tailStart) ranges.push({ start: tailStart, end: tailEnd });
      re.lastIndex = sepStart;
      continue;
    }
    // A dash used as punctuation is not a split word. Two tells, both cheap:
    // the next word starts with a capital ("Holy - Holy", "Jesus - My"), or it
    // is a word that stands on its own ("- and", "- my").
    const after = lyric.slice(m.index + m[1].length + m[2].length).split(/\s/)[0] || '';
    const bare = after.replace(/[^A-Za-z']/g, '');
    if (/^[A-Z]/.test(after)) continue;
    if (STANDALONE_AFTER_DASH.has(bare.toLowerCase())) continue;
    const start = m.index + m[1].length;
    ranges.push({ start, end: start + m[2].length });
    re.lastIndex = start;
  }
  return ranges;
}

// Pull the chord line left by the same amount. Chord text is never destroyed:
// if the span covers chord characters, spaces after it are taken instead, so
// the symbol shifts intact and stays over its syllable.
function shiftChordLine(chordLine: string, ranges: Array<{ start: number; end: number }>): string {
  const chars = chordLine.split('');
  for (let i = ranges.length - 1; i >= 0; i--) {
    const { start, end } = ranges[i];
    let need = end - start;
    // A space may only go if one remains between its neighbours. Taking the
    // last space between two chords welds them together -- "Dm E7" came out
    // as "DmE7", which is not a chord at all. Alignment drifting a character
    // is the lesser harm, so the shift stops short instead.
    const removable = (p: number) =>
      chars[p] === ' ' && !(p > 0 && chars[p - 1] !== ' ' && p + 1 < chars.length && chars[p + 1] !== ' ');
    for (let p = Math.min(end, chars.length) - 1; p >= start && need > 0; p--) {
      if (removable(p)) { chars.splice(p, 1); need--; }
    }
    let p = start;
    while (need > 0 && p < chars.length) {
      if (removable(p)) { chars.splice(p, 1); need--; } else { p++; }
    }
  }
  return chars.join('').replace(/\s+$/, '');
}

function joinSyllables(text: string): string {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (isChordLine(lines[i]) || /^\[.*\]$/.test(lines[i].trim())) continue;
    const ranges = hyphenRanges(lines[i]);
    if (!ranges.length) continue;
    if (i > 0 && isChordLine(lines[i - 1])) lines[i - 1] = shiftChordLine(lines[i - 1], ranges);
    let out = lines[i];
    for (let r = ranges.length - 1; r >= 0; r--) out = out.slice(0, ranges[r].start) + out.slice(ranges[r].end);
    lines[i] = out;
  }
  return lines.join('\n');
}

// When the barlines cannot be counted -- a photo with no staff, or a model
// that ran a line on -- lyrics are wrapped here instead: keep words together
// up to a comma, otherwise cap the line at seven words. A line already inside
// that is left untouched.
// Ten, not the seven this started at. Seven was chosen before there was any
// data; re-wrapping the whole scanned corpus at each cap showed it breaking
// far more than it needed to. Ten cuts the line count by a fifth, lifts the
// average line from 5.3 words to 6.7, and still produces no line longer than
// ten words -- because commas break earlier anyway, and they are the breaks
// that matter. Eleven and twelve buy almost no further reduction and start
// producing genuinely long lines.
const MAX_WORDS = 10;

function tokensOf(line: string): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

// Lay tokens back out at their columns.
function render(tokens: Array<{ text: string; start: number }>): string {
  let out = '';
  for (const t of tokens) {
    if (t.start > out.length) {
      out += ' '.repeat(t.start - out.length);
    } else if (out.length) {
      // Two chords must never touch. Rebasing a dense chord line can push one
      // token's column back onto the previous token's text, and appending
      // there welded them into a single invalid chord -- "Am F" came out as
      // "AmF". A chord shifts right rather than merge.
      out += ' ';
    }
    out += t.text;
  }
  return out;
}

// Put back together what the engraver took apart.
//
// reflowLines only ever splits: it takes a line that ran on too long and cuts
// it at a comma or the word cap. Nothing joined a line that was too SHORT, and
// a score produces those constantly, because the model transcribes each staff
// system as its own line. A verse came back as "and did my" / "Sovereign die?"
// / "whole" / "O," -- fragments that are not phrases, broken where the page ran
// out of width rather than where the singer breathes.
//
// A line is merged into the next unless it ends where a line should end: a
// full stop, question or exclamation always ends one, and a comma does too --
// that is the break the singer was asked for. The exception is a fragment of
// one or two words, which is not a phrase however it is punctuated, so a
// stranded "O," rejoins the line it belongs to.
//
// Merging first and splitting afterwards is what makes the result even: the
// text is gathered back into phrases, then cut again at commas and the word
// cap, so every line is filled to the same rule instead of to the width of
// whatever staff it was printed on.
const ENDS_A_LINE = /[.!?]["'\u2019]?$/;
const ENDS_A_CLAUSE = /[,;:]["'\u2019]?$/;

function mergeBrokenLines(text: string): string {
  const src = text.split(/\r?\n/);

  // A chord line and the lyric beneath it move together or not at all.
  type Unit = { raw?: string; chord?: string; lyric?: string };
  const units: Unit[] = [];
  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    const bare = line.trim();
    if (!bare || /^\[.*\]$/.test(bare)) { units.push({ raw: line }); continue; }
    if (isChordLine(line)) {
      const next = src[i + 1];
      if (next !== undefined && next.trim() && !isChordLine(next) && !/^\[.*\]$/.test(next.trim())) {
        units.push({ chord: line, lyric: next });
        i++;
      } else {
        units.push({ raw: line });
      }
      continue;
    }
    units.push({ lyric: line });
  }

  const out: Unit[] = [];
  for (const unit of units) {
    const prev = out[out.length - 1];
    const canMerge = prev && prev.lyric !== undefined && unit.lyric !== undefined;
    if (canMerge) {
      const left = (prev.lyric as string).replace(/\s+$/, '');
      const words = left.split(/\s+/).filter(Boolean).length;
      const fragment = words > 0 && words <= 2;
      const finished = ENDS_A_LINE.test(left) || (ENDS_A_CLAUSE.test(left) && !fragment);
      if (!finished && left) {
        const shift = left.length + 1;
        const chords = [
          ...(prev.chord ? tokensOf(prev.chord) : []),
          ...(unit.chord ? tokensOf(unit.chord).map((c) => ({ ...c, start: c.start + shift })) : []),
        ];
        prev.lyric = left + ' ' + (unit.lyric as string).replace(/^\s+/, '');
        prev.chord = chords.length ? render(chords) : undefined;
        continue;
      }
    }
    out.push({ ...unit });
  }

  const lines: string[] = [];
  for (const u of out) {
    if (u.raw !== undefined) { lines.push(u.raw); continue; }
    if (u.chord) lines.push(u.chord);
    if (u.lyric !== undefined) lines.push(u.lyric);
  }
  return lines.join('\n');
}
// Where to cut a line that is too long. Prefer the last comma at or before the
// word cap -- that is where the singer breathes. Otherwise cut at the cap.
function breakAfter(line: string): number {
  const w = tokensOf(line);
  if (w.length <= MAX_WORDS) return -1;
  for (let i = Math.min(MAX_WORDS, w.length) - 1; i >= 0; i--) {
    if (/[,;:]$/.test(w[i].text)) return w[i].end;
  }
  // Cutting exactly at the cap can leave a one or two word orphan on the next
  // line -- which is the raggedness this whole pass exists to remove, so
  // creating it here would be self-defeating. When the overflow is that small,
  // the line is split down the middle instead and both halves read as phrases:
  // eight words break 4 and 4, not 7 and 1.
  const overflow = w.length - MAX_WORDS;
  const cut = overflow <= 2 ? Math.ceil(w.length / 2) : MAX_WORDS;
  return w[cut - 1].end;
}

function reflowLines(text: string): string {
  const src = text.split(/\r?\n/);
  const out: string[] = [];

  for (let i = 0; i < src.length; i++) {
    const line = src[i];

    // A chord line is emitted by the lyric it sits above, so skip it here.
    // Skip a chord line only when a LYRIC follows it -- that lyric will emit
    // it. Above a section header there is no lyric to ride with, and skipping
    // there dropped the chord entirely.
    const next = i + 1 < src.length ? src[i + 1] : '';
    const nextIsLyric = !!next.trim() && !isChordLine(next) && !/^\[.*\]$/.test(next.trim());
    if (isChordLine(line) && nextIsLyric) continue;

    if (!line.trim() || /^\[.*\]$/.test(line.trim()) || isChordLine(line)) { out.push(line); continue; }

    let chords: Array<{ text: string; start: number; end: number }> | null =
      (i > 0 && isChordLine(src[i - 1])) ? tokensOf(src[i - 1]) : null;
    let lyric = line;
    let base = 0;              // absolute column in the ORIGINAL line

    for (;;) {
      const cut = breakAfter(lyric);
      if (cut < 0) break;

      const tailStart = cut + (lyric.slice(cut).length - lyric.slice(cut).replace(/^\s+/, '').length);

      if (chords) {
        // A chord belongs to the head only if it starts before the head's text
        // ENDS. One sitting in the gap after the comma is over the next phrase,
        // not the one just finished, so it travels with the tail.
        const head = chords.filter((t) => t.start - base < cut);
        let tail = chords.filter((t) => t.start - base >= cut);
        // A direction like (x2) annotates the phrase it was written on. Left to
        // partition on position it could be carried to the next line and end up
        // stranded there alone, a bracket floating between two lyrics. It stays
        // with the chords it was written beside.
        if (tail.length && tail.every((x) => /^\(.*\)$/.test(x.text))) {
          head.push(...tail);
          tail = [];
        }
        const headLine = render(head.map((t) => ({ ...t, start: t.start - base })));
        if (headLine.trim()) out.push(headLine);
        chords = tail;
      }
      out.push(lyric.slice(0, cut).replace(/\s+$/, ''));

      lyric = lyric.slice(tailStart);
      base += tailStart;
    }

    if (chords && chords.length) {
      const last = render(chords.map((t) => ({ ...t, start: Math.max(0, t.start - base) })));
      if (last.trim()) out.push(last);
    }
    out.push(lyric);
  }
  return out.join('\n');
}

// A last pass for presentation. None of this changes a word or a chord; it
// settles how the page reads. The library shows why it is needed: [Chorus]
// appears 54 times and [CHORUS] 5 more, [Verse 1] 28 times and [VERSE 1]
// twice, so the same section is written three ways across one shelf of songs.
function tidy(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));

  const out: string[] = [];
  for (const line of lines) {
    const bare = line.trim();

    // Section headers in one voice: [CHORUS] and [chorus] both become
    // [Chorus], and a stray [Verse1] gains its space.
    if (/^\[.+\]$/.test(bare)) {
      let name = bare.slice(1, -1).trim().replace(/\s+/g, ' ');
      name = name.replace(/^([a-z]+)(\d)/i, '$1 $2');
      name = name.split(' ').map((w) =>
        /^\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      ).join(' ');
      // Pre-Chorus keeps its capital on both halves.
      name = name.replace(/-([a-z])/g, (_, c) => '-' + c.toUpperCase());
      // One blank line before a header, never at the very top.
      if (out.length && out[out.length - 1].trim()) out.push('');
      out.push('[' + name + ']');
      continue;
    }

    // Never more than one blank line in a row, and none to open with.
    if (!bare) {
      if (!out.length || !out[out.length - 1].trim()) continue;
      out.push('');
      continue;
    }
    out.push(line);
  }

  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\n');
}

function extFromUrl(url: string): string {
  const clean = url.split('?')[0].split('#')[0];
  const m = clean.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

// Capped: the vocabularies arrive from the client, and an oversized list would
// inflate the prompt (and the bill) without improving the read.
function list(label: string, items: unknown): string {
  const arr = (Array.isArray(items) ? items : [])
    .filter((x): x is string => typeof x === 'string' && !!x.trim())
    .slice(0, 120)
    .map((x) => x.slice(0, 60));
  if (!arr.length) return `${label}: (none defined - always return null for this field)`;
  return `${label}: ${arr.join(' | ')}`;
}

export async function POST(req: NextRequest) {
  // Stage timings, reported on every response. A scan that takes forty
  // seconds and one that takes four look identical from the outside, and
  // without knowing which stage ate the time -- or which model answered --
  // a slow scan can only be guessed at.
  const t0 = Date.now();
  let fetchMs = 0;
  const attempts: Array<{ model: string; ms: number; ok: boolean; err?: string }> = [];
  let escalation: { attempted: boolean; ms: number; taken: boolean } = { attempted: false, ms: 0, taken: false };
  try {
    const { url, vocab } = await req.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Scanning is not configured on this server (missing GEMINI_API_KEY). Add the song manually instead.' },
        { status: 500 }
      );
    }

    if (!isOwnStorage(url)) {
      return NextResponse.json(
        { error: 'That image is not one this app uploaded. Take or choose the photo again.' },
        { status: 400 }
      );
    }

    const ext = extFromUrl(url);
    const mime = MIME_TYPES[ext];
    if (!mime) {
      return NextResponse.json(
        { error: `Unsupported file type "${ext || 'unknown'}". Photograph or upload a JPG, PNG, WEBP, HEIC or PDF.` },
        { status: 400 }
      );
    }

    // Its own try/catch: an unreachable host throws rather than returning a
    // response, and without this the outer handler reports it as the opaque
    // "Scan failed: fetch failed".
    let fileBuffer: Buffer;
    const tFetch = Date.now();
    try {
      const fileRes = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!fileRes.ok) {
        return NextResponse.json({ error: `Could not download the image (status ${fileRes.status}).` }, { status: 502 });
      }
      fileBuffer = Buffer.from(await fileRes.arrayBuffer());
      fetchMs = Date.now() - tFetch;
    } catch {
      return NextResponse.json({ error: 'Could not reach the uploaded image. Check the connection and try again.' }, { status: 502 });
    }

    // ~18MB of base64 is well inside the inline-data limit; a phone photo is
    // far smaller, but a scanned PDF can be large.
    if (fileBuffer.byteLength > 14 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'That file is too large to scan. Try a single page, or a photo rather than a scan.' },
        { status: 413 }
      );
    }

    const v = vocab || {};
    const promptText = [
      'You are reading a photograph of a worship song sheet for a Lutheran church.',
      'It is usually a chord sheet: lyrics with chord symbols printed above the words.',
      'It may instead be a plain lyrics sheet, or a music score with staves.',
      '',
      'Transcribe what is actually on the page. Do not complete a song from memory,',
      'do not correct the wording, and do not add verses that are not shown.',
      '',
      'LINE BREAKS FOLLOW THE MUSIC, NOT THE PAGE:',
      '  * Each line of lyrics covers TWO BARS. In 4/4 that is eight beats; in',
      '    3/4, six. Start a new line at every second barline.',
      '  * Use the barlines on the staff to decide this, not where the printed',
      '    text happens to wrap.',
      '  * If there is no staff and no barlines to count -- a plain chord sheet --',
      '    keep the printed line breaks instead.',
      '  * Failing both, end the line at a comma, or after seven words at most.',
      '',
      'WORDS ARE WHOLE, NEVER SPLIT:',
      '  * A score hyphenates words across notes: "lead - eth", "bless - ed".',
      '    Those hyphens belong to the engraving, not the word. Write "leadeth",',
      '    "blessed". Never emit a hyphen that only splits a word across notes.',
      '  * A genuine compound keeps its hyphen: "well-known" stays "well-known".',
      '',
      'A CHORD SITS OVER THE SYLLABLE IT FALLS ON:',
      '  * When a chord changes partway through a word, put the symbol above that',
      '    syllable -- not above the start of the word.',
      '  * Count characters. The first character of the chord symbol goes directly',
      '    above the first letter of the syllable it lands on.',
      '  * Worked example. G7/C falls on the "eth" of "leadeth", so:',
      '',
      '        C       G7/C',
      '        He leadeth me',
      '',
      '    The G is above the t of leadeth, inside that syllable -- not above',
      '    the l where the word begins.',
      '',
      'LYRICS FORMAT — this matters, the app parses it:',
      '  * Mark each section on its own line in square brackets: [Verse 1], [Chorus],',
      '    [Bridge], [Refrain], [Pre-Chorus], [Tag], [Ending].',
      '  * Whenever there are chords at all -- read off the page or proposed by',
      '    you -- put them on their own line directly above the lyric line, spaced',
      '    so each chord sits over the syllable it falls on. A chord you propose',
      '    is written into the lyrics exactly like one you transcribed. There is',
      '    no second format and no separate field for them.',
      '  * Keep the original line breaks. Separate sections with a blank line.',
      '  * Never write chord symbols inline inside the lyric text.',
      '',
      'RECOGNISING CHORD SYMBOLS — handwritten counts exactly as much as printed.',
      'A chord symbol is a short token standing on its own, not a word in a lyric:',
      '  * a capital A to G, optionally followed by # or b (or ♯ / ♭),',
      '  * optionally a quality: m, min, maj, maj7, M7, 7, 6, 9, 11, 13, sus, sus2,',
      '    sus4, add9, dim, aug, +, °, ø, alt, and combinations like m7, m9,',
      '    maj9, 7sus4, 13b9, m7b5,',
      '  * optionally a slash bass: D/F#, G/B, C/E.',
      'They appear above a staff, above a lyric line, or in a row of their own, and',
      'are often pencilled in by hand above the notes. A scattering of isolated',
      'capital letters with sharps, flats or those qualities IS a chord line -- read',
      'them, whether they are engraved or handwritten, neat or scrawled.',
      '',
      'On a score, a chord symbol sits horizontally above the note it belongs to.',
      'Use that horizontal position to work out which word or syllable of the lyric',
      'underneath it falls on, and place it above that word in your output.',
      '',
      'Set hasMusicNotation true if the page shows five-line staves with note',
      'heads on them, false if it is words only. Answer for the page in front of',
      'you, not for what the song usually looks like.',
      '',
      'TRANSCRIBED CHORDS VERSUS SUGGESTED ONES -- keep these apart.',
      'If chord symbols ARE written on the page, transcribe those and only those.',
      'Never adjust them, never add to them, and set chordsSuggested to false.',
      '',
      'If NO chord symbols are written anywhere -- a hymn score with staves and',
      'nothing above them -- you may propose a simple accompaniment instead. Set',
      'chordsFound to false and chordsSuggested to true. Rules for proposing:',
      '  * Work from the key and the notes on the page. Do not recall the song',
      '    from memory, and do not copy a harmonisation you have seen elsewhere.',
      '  * Stay diatonic to the key. Plain triads: I, ii, iii, IV, V, vi. A V7',
      '    at a cadence is welcome. Nothing beyond that -- no borrowed chords,',
      '    no extensions, no reharmonisation. A congregation is going to sing',
      '    it and a volunteer is going to play it.',
      '  * One chord per bar is the default; two where the harmony plainly',
      '    moves mid-bar. Resist more.',
      '  * Begin on I and end each verse on I or V. Cadence conventionally.',
      '  * Place each chord over the syllable that falls on the beat it starts.',
      '  * If you cannot read the key confidently, propose nothing at all:',
      '    leave the lyrics bare, both flags false, and say so in notes. A bare',
      '    sheet costs a musician a few minutes; a wrong chord costs a Sunday.',
      '',
      'WRITE THE PROPOSED CHORDS INTO THE LYRICS FIELD. This is the step that',
      'gets missed. Saying in notes that you worked out a C major harmonisation',
      'is not proposing chords -- the app reads the lyrics field and nothing',
      'else, so a note about chords arrives as a sheet with no chords on it.',
      'Setting chordsSuggested true without chord lines in the lyrics is wrong.',
      '',
      'A verse of a hymn in C, with nothing printed above the staff, comes back',
      'looking like this -- chord line, then lyric line, alternating:',
      '',
      '[Verse 1]',
      'C               F         C',
      'When peace like a river attendeth my way,',
      'C            G7        C',
      'When sorrows like sea billows roll;',
      '',
      'Not like this, which is the mistake to avoid:',
      '',
      '[Verse 1]',
      'When peace like a river attendeth my way,',
      'When sorrows like sea billows roll;',
      '(with notes saying "chords suggested in C major")',
      '',
      'On a score the lyrics sit under the staff, split across notes by hyphens.',
      'Rejoin them. The engraver splits a word so each syllable sits under its',
      'own note; the word itself is not hyphenated and must not come back that',
      'way. This applies however the split is spaced -- with gaps or without:',
      '  "A- ma- zing"  "A - maz - ing"  "A-maz-ing"   all become  "Amazing"',
      '  "lead - eth"   "lead-eth"                   both become "leadeth"',
      '  "un-known"  "faith-ful"  "con-tent"  "Jor-dan"  "pit-y"  likewise.',
      'A genuine hyphenated word keeps its hyphen, but those are rare in hymns',
      'and a syllable split is not one. When in doubt, join.',
      '',
      'ALSO ON THE PAGE, and easy to miss:',
      '  * The copyright line in small print at the foot, and a CCLI song number',
      '    ("CCLI Song #1234567"). Take the SONG number, not the licence number.',
      '  * A time signature after the clef, and a printed tempo such as 72 bpm.',
      '    Only report a BPM that is actually printed -- never estimate one.',
      '  * A capo instruction, and any second title in brackets or underneath.',
      '',
      'COUNT THE VERSES FIRST. Before transcribing anything, look for the verse',
      'numbers on the page -- 1. 2. 3. down the left of the lyric block, or before',
      'the first word of each line. Put that count in versesOnPage, then make sure',
      'your lyrics contain exactly that many [Verse n] sections. A page with five',
      'numbered verses and one verse in the output is the single most common way',
      'this goes wrong.',
      '',
      'A hymnal stacks its verses under one staff, like this:',
      '',
      '    1. A - las!  and did  my  Sa - vior bleed,',
      '    2. Was  it   for crimes that  I   have done,',
      '    3. Well might the sun  in  dark - ness hide,',
      '',
      'Those are three verses, not one line of three. Read across for verse 1,',
      'then across again for verse 2, and return:',
      '',
      '    [Verse 1]',
      '    Alas! and did my Savior bleed,',
      '',
      '    [Verse 2]',
      '    Was it for crimes that I have done,',
      '',
      '    [Verse 3]',
      '    Well might the sun in darkness hide,',
      '',
      'The chords above the staff belong to all of them, so repeat the chord line',
      'over each verse rather than only the first.',
      '',
      'LAYOUTS THAT CATCH PEOPLE OUT:',
      '  * Two columns: read the whole left column down, then the right. Never',
      '    read straight across the gutter.',
      '  * Repeat directions (D.C., D.S., Repeat chorus, x2) are instructions, not',
      '    lyrics. Keep them out of the words and mention them in notes instead.',
      '  * A chorus printed once stays printed once, however often it is sung.',
      '',
      'CONTROLLED VALUES — for the fields below you must choose from these exact',
      'lists or return null. Never invent a value that is not listed.',
      list('Allowed keys', v.keys),
      list('Allowed feels', v.tempos),
      list('Allowed styles', v.styles),
      list('Allowed seasons', v.seasons),
      list('Allowed themes', v.themes),
      '',
      'Prefer inferring the key from the chords themselves. Only set season when the',
      'text plainly belongs to it. Leave anything you are unsure of as null -- a',
      'person is about to review this, and a blank field costs them less than a',
      'wrong one.',
    ].join('\n');

    const ai = new GoogleGenAI({ apiKey });

    // Fall through models rather than retrying one: an overloaded model stays
    // overloaded, so a second attempt at the same one just fails again slower.
    // Lite leads on measurement, not preference -- flash spent ~35s returning
    // UNAVAILABLE before lite answered, which put a successful scan at 60s.
    // Lite alone answers in about 7s and reading a page of chords and words is
    // well within it; flash covers the case where lite is the busy one.
    // The platform kills the function at maxDuration and answers with an HTML
    // error page, which is not JSON and says nothing useful. Worse, a single
    // slow call would sit there consuming the entire budget, so the fallback
    // model -- the whole point of having one -- never got a turn: measured over
    // 21 scans, 5 died at 60s and not one of them ever reached the second model.
    //
    // So the request keeps its own deadline, comfortably inside the platform's,
    // and hands each model a slice of it. A page that answers in the usual few
    // seconds is untouched; a slow one now gets a second, independent attempt
    // instead of one long doomed wait.
    const HARD_DEADLINE_MS = 54000;
    const budgetLeft = () => HARD_DEADLINE_MS - (Date.now() - t0);

    const MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
    const callModel = async (model: string, budgetMs: number) => ai.models.generateContent({
      // Version-agnostic alias, matching the lectionary route: always the
      // current flash-tier model, so a retired dated version cannot break this.
      model,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: mime, data: fileBuffer.toString('base64') } },
          { text: promptText },
        ],
      }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        // Transcription, not composition. Left unset, this model samples at
        // temperature 1.0, and it showed: two scans of one sheet agreed on
        // about three quarters of their chord symbols, and chord-line counts
        // swung by seven across repeats of the same photograph. Nothing about
        // reading a page off a photo is helped by creative sampling -- the
        // chords are already printed, and the words are the words.
        temperature: 0,
        // Ours, not the platform's: an abort we raise is catchable and leaves
        // time to try something else.
        abortSignal: AbortSignal.timeout(Math.max(1000, budgetMs)),
      },
    });

    let response;
    let lastErr: unknown = null;
    let answeredBy = MODELS[0];
    for (let mi = 0; mi < MODELS.length; mi++) {
      const model = MODELS[mi];
      const isLast = mi === MODELS.length - 1;
      // The last model may use everything that is left. An earlier one is
      // capped so there is still a usable slice behind it -- 30s covers every
      // scan we have measured that succeeded at all.
      const budget = isLast ? budgetLeft() : Math.min(30000, budgetLeft() - 18000);
      if (budget < 5000) break;                 // too little left to be worth starting
      const tModel = Date.now();
      try {
        response = await callModel(model, budget);
        attempts.push({ model, ms: Date.now() - tModel, ok: true });
        answeredBy = model;
        lastErr = null;
        break;
      } catch (err) {
        attempts.push({ model, ms: Date.now() - tModel, ok: false, err: String(err).slice(0, 120) });
        lastErr = err;
        // Anything that is not the model being busy is a real failure and
        // should surface immediately rather than burning the next model too.
        // Our own abort counts as "busy" -- it means this model did not answer
        // in the time it was given, which is exactly when the next one is worth
        // a try. Without this the abort would be rethrown as a hard failure.
        if (!/50[0-9]|unavailable|overloaded|high demand|429|rate|abort|timeout|timed out/i.test(String(err))) throw err;
      }
    }
    if (!response) {
      const quota = /429|quota|rate limit/i.test(String(lastErr));
      const slow = /abort|timeout|timed out/i.test(String(lastErr));
      return NextResponse.json({
        error: quota
          ? 'The scanning service has hit its rate limit for now. Wait a minute and try again, or add the song manually.'
          : slow
            ? 'The scan is taking longer than this page can wait for. Busy pages -- several verses, handwritten chords -- sometimes do. Try again; it usually goes through.'
            : 'Every scanning model is busy right now. Try again in a few minutes, or add the song manually.',
        // Same stage timings a successful scan reports. Without them a failure
        // is a sentence with no evidence behind it, and working out whether the
        // models were slow or the service refused means reproducing it by hand.
        timings: { totalMs: Date.now() - t0, fetchMs, bytes: fileBuffer.byteLength, attempts, escalation },
      }, { status: 503 });
    }

    const raw = response.text;
    if (!raw) {
      return NextResponse.json({ error: 'The scan did not return a readable result. Try a clearer photo.' }, { status: 502 });
    }

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'The scan returned an unreadable result. Try again, or add the song manually.' }, { status: 502 });
    }

    // Belt and braces: the schema asks the model to stay inside the vocabularies,
    // but a returned value is only trusted if it really is in the list. Anything
    // else is dropped rather than shown as though it came from the sheet.
    const pick = (value: unknown, allowed: unknown): string | null => {
      if (typeof value !== 'string' || !value.trim()) return null;
      const arr = Array.isArray(allowed) ? allowed : [];
      const hit = arr.find((a) => typeof a === 'string' && a.toLowerCase() === value.trim().toLowerCase());
      return typeof hit === 'string' ? hit : null;
    };

    // Keys need their own matcher. The library lists a key as "G# / A\u266d" --
    // one option covering both spellings -- while a model reading four flats off
    // a page writes "Ab", as any musician would. Exact matching threw that away,
    // and a scan that had read the key signature correctly came back with no key
    // at all: one sheet in seven, for a difference of notation.
    //
    // So each side of the slash is tried on its own, with the printed accidentals
    // normalised to plain # and b, and a trailing "major" ignored.
    const pickKey = (value: unknown, allowed: unknown): string | null => {
      const exact = pick(value, allowed);
      if (exact) return exact;
      if (typeof value !== 'string' || !value.trim()) return null;
      const norm = (s: string) => s
        .replace(/\u266f/g, '#').replace(/\u266d/g, 'b')
        .replace(/\s*(major|maj)\s*$/i, '')
        .trim().toLowerCase();
      const want = norm(value);
      if (!want) return null;
      const arr = Array.isArray(allowed) ? allowed : [];
      const hit = arr.find((a) => typeof a === 'string'
        && a.split('/').some((half) => norm(half) === want));
      return typeof hit === 'string' ? hit : null;
    };

    const lyricsText = typeof result.lyrics === 'string' ? result.lyrics : '';

    // The engraving's hyphens are removed here rather than only asked for,
    // because a model that leaves one in produces "lead - eth" in the editor.
    // Removing them shortens the lyric line, so every chord to the right has to
    // move left by the same number of characters or it ends up over the wrong
    // syllable. joinSyllables does both together.
    // Order matters: join the split words first, then wrap. Wrapping first
    // would count "lead" and "eth" as two of the seven words.
    // Join split words, wrap over-long lines, then settle the presentation.
    // Merge before splitting: gather the fragments back into phrases, then cut
    // them again to one rule, so the lines come out even.
    // joinSyllables runs twice, and the second pass is not belt and braces.
    // It works a line at a time, so a word the engraver split across a line
    // ending -- "Grace un-" / "known!" -- has nothing after the hyphen to join
    // to on the first pass. mergeBrokenLines then stitches the lines together
    // and the two halves become neighbours for the first time, which is where
    // "un- known", "pit - y" and "faith- ful" were coming from in real scans.
    // The pass is idempotent -- nothing is left to join the second time round --
    // so running it again costs a scan of the text and fixes the whole class.
    let joined = tidy(reflowLines(joinSyllables(mergeBrokenLines(joinSyllables(lyricsText)))));

    // Reading chord symbols already printed on a page is OCR, which the small
    // model does well and fast. Reading notes off a stave and working out the
    // harmony is a different job, and lite mostly declines it -- which is why a
    // scanned hymn score came back as bare lyrics.
    //
    // So: when the fast model finds no chords on a page that does have staves
    // and notes, ask the larger one once. The notation test is what keeps this
    // cheap -- a typed lyric sheet has no chords either, and escalating on that
    // would spend twenty seconds proving there is nothing to analyse.
    // Nothing is spent in the common cases: a sheet with chords printed on it
    // never reaches here, nor does a page with no music on it. It is skipped
    // when too little of the sixty second budget is left to finish, since a
    // timeout would lose the lyrics already read -- half an answer beats none.
    // What the model said was on the page, against what it actually returned.
    // A page it counted five verses on that comes back with one is a truncated
    // read, and it announced the discrepancy itself.
    const sectionsIn = (s: string) => (s.match(/^\[.+\]$/gm) || []).length;
    const versesClaimed = typeof result.versesOnPage === 'number' ? result.versesOnPage : 0;
    const versesShort = versesClaimed > 1 && sectionsIn(joined) < versesClaimed;

    const ESCALATE_BUDGET_MS = 22000;
    let escalatedTo: string | null = null;
    if (
      (versesShort || (!joined.split(/\r?\n/).some(isChordLine) && result.hasMusicNotation === true))
      && answeredBy !== MODELS[MODELS.length - 1]
      && Date.now() - t0 < ESCALATE_BUDGET_MS
    ) {
      escalation = { attempted: true, ms: 0, taken: false };
      const tEsc = Date.now();
      try {
        const better = await callModel(MODELS[MODELS.length - 1], budgetLeft());
        const betterRaw = better.text;
        if (betterRaw) {
          const second = JSON.parse(betterRaw) as Record<string, unknown>;
          const secondLyrics = typeof second.lyrics === 'string' ? second.lyrics : '';
          const secondJoined = tidy(reflowLines(joinSyllables(mergeBrokenLines(joinSyllables(secondLyrics)))));
          // Only taken if it actually did better -- more verses when verses were
          // missing, chords when chords were missing. A second answer that fixes
          // neither is discarded and the first stands.
          const improved = versesShort
            ? sectionsIn(secondJoined) > sectionsIn(joined)
            : secondJoined.split(/\r?\n/).some(isChordLine);
          if (improved) {
            joined = secondJoined;
            result = second;
            escalatedTo = MODELS[MODELS.length - 1];
            escalation.taken = true;
          }
        }
      } catch {
        // The first answer is already good enough to return; a failed second
        // attempt must not turn a usable scan into an error.
      }
      escalation.ms = Date.now() - tEsc;
    }

    // chordsFound is the model's claim about its own work, and it has been
    // wrong in both directions. The transcription settles it -- counted after
    // joining, since that is the text the reader will actually get.
    const chordsActuallyPresent = joined.split(/\r?\n/).some(isChordLine);

    // Chords the model read off the page, versus chords it worked out from
    // the key. Both are chords in the same text; only the provenance differs,
    // and the reviewer needs to be told which they are looking at. Only a
    // positive claim of printed chords counts as one -- anything less certain
    // is reported as suggested, so the doubt reaches the reviewer instead of
    // being resolved silently in the scanner's favour.
    const chordsPrinted = chordsActuallyPresent && result.chordsFound === true;
    const chordsSuggested = chordsActuallyPresent && !chordsPrinted;
    // The model first; the chords only when it read no key at all. A key it
    // did read is never second-guessed -- it saw the signature and this has
    // only seen the chords.
    let suggestedKey = pickKey(result.key, v.keys);
    let keyInferred = false;
    // Whenever there is no usable key -- the model returned none, or returned
    // something the library does not list. An unmatched string is no more
    // trustworthy than nothing, and the first version of this only covered the
    // nothing case, so a sheet came back keyless with the chords sitting right
    // there saying A-flat.
    if (!suggestedKey) {
      const guess = inferKeyFromChords(joined);
      const matched = guess ? pickKey(guess, v.keys) : null;
      if (matched) { suggestedKey = matched; keyInferred = true; }
    }
    const outOfKey = chordsSuggested ? outOfKeyChords(joined, suggestedKey) : [];

    // Read after any escalation, not before: everything else is read off
    // result when the response is built, but themes were being computed early,
    // which would have taken them from the answer that was thrown away.
    const themes = Array.isArray(result.themes)
      ? (result.themes as unknown[]).map((x) => pick(x, v.themes)).filter((x): x is string => !!x).slice(0, 3)
      : [];

    const dropped: string[] = [];
    if (result.key && !pickKey(result.key, v.keys)) dropped.push('key');
    if (result.tempo && !pick(result.tempo, v.tempos)) dropped.push('feel');
    if (result.style && !pick(result.style, v.styles)) dropped.push('style');
    if (result.season && !pick(result.season, v.seasons)) dropped.push('season');

    return NextResponse.json({
      title: typeof result.title === 'string' ? result.title.trim() : null,
      artist: typeof result.artist === 'string' ? result.artist.trim() : null,
      key: suggestedKey,
      // Told apart from a key read off the signature, because a reviewer
      // checking a transposition should know which they are looking at.
      ...(keyInferred ? { keyInferred: true } : {}),
      tempo: pick(result.tempo, v.tempos),
      style: pick(result.style, v.styles),
      season: pick(result.season, v.seasons),
      themes,
      scripture: typeof result.scripture === 'string' ? result.scripture.trim() : null,
      alternateTitle: typeof result.alternateTitle === 'string' ? result.alternateTitle.trim() : null,
      copyright: typeof result.copyright === 'string' ? result.copyright.trim() : null,
      // Digits only: sheets print "CCLI Song #1234567" and the field wants the number.
      ccli: typeof result.ccli === 'string' ? (result.ccli.replace(/\D+/g, '') || null) : null,
      timeSignature: typeof result.timeSignature === 'string' ? result.timeSignature.trim() : null,
      // A printed tempo, never an estimated one; anything outside a plausible
      // range is a misread rather than a marking.
      bpm: (typeof result.bpm === 'number' && result.bpm >= 30 && result.bpm <= 260) ? Math.round(result.bpm) : null,
      capo: typeof result.capo === 'string' ? result.capo.trim() : null,
      lyrics: joined || null,
      // What is in the transcription wins over what the model said about it.
      chordsFound: chordsPrinted,
      ...(escalatedTo ? { escalatedTo } : {}),
      timings: {
        totalMs: Date.now() - t0,
        fetchMs,
        bytes: fileBuffer.byteLength,
        attempts,
        escalation,
      },
      chordsSuggested,
      // The page had more verses on it than came back. Reported even after an
      // escalation, because the second read can fall short too, and a hymn
      // quietly missing four of its five verses is worth saying out loud.
      ...(versesClaimed ? { versesOnPage: versesClaimed } : {}),
      ...(versesClaimed > 1 && sectionsIn(joined) < versesClaimed
        ? { versesMissing: versesClaimed - sectionsIn(joined) } : {}),
      // Sent so the form can say something useful when there are no chords:
      // a page of words has none to find, a score that yielded none is a
      // different problem with a different remedy.
      hasMusicNotation: result.hasMusicNotation === true,
      ...(outOfKey.length ? { outOfKey } : {}),
      chordLines: joined.split(/\r?\n/).filter(isChordLine).length,
      confidence: typeof result.confidence === 'string' ? result.confidence : 'low',
      notes: typeof result.notes === 'string' ? result.notes.trim() : null,
      ...(dropped.length ? { droppedFields: dropped } : {}),
    });
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : 'Unknown error';
    // Provider errors arrive as a JSON blob; nobody should have to parse one
    // to learn that the scanner is busy.
    const msg = /unavailable|overloaded|high demand/i.test(raw)
      ? 'The scanning service is busy right now. Try again in a moment, or add the song manually.'
      : /429|quota|rate limit/i.test(raw)
        ? 'The scanning service has hit its rate limit for now. Try again shortly, or add the song manually.'
        : /api key|permission|unauthenticated|401|403/i.test(raw)
          ? 'The scanning service rejected the credentials on this server. Add the song manually and let an admin know.'
          : 'The scan could not be completed. Add the song manually instead.';
    return NextResponse.json({
      error: msg,
      timings: { totalMs: Date.now() - t0, fetchMs, attempts, escalation },
    }, { status: 502 });
  }
}
