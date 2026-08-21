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
//   * Chords are reported as found or not found. A photograph of a hymn score
//     with no printed chord symbols has no chords to read, and inventing
//     plausible ones would be worse than returning none.
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
    lyrics: { type: Type.STRING, nullable: true, description: 'The full lyrics in the required chord-sheet format. Null if no lyrics are legible.' },
    chordsFound: { type: Type.BOOLEAN, description: 'True only if chord symbols were actually printed on the sheet and have been transcribed. False for a sheet with lyrics only, or a music score with no chord symbols.' },
    confidence: { type: Type.STRING, description: 'One of "high", "medium", "low" -- how legible the sheet was overall.' },
    notes: { type: Type.STRING, nullable: true, description: 'One short sentence for the reviewer about anything unclear, cut off, or guessed. Null if the read was clean.' },
  },
  required: ['title', 'artist', 'key', 'tempo', 'style', 'season', 'themes', 'scripture', 'alternateTitle', 'copyright', 'ccli', 'timeSignature', 'bpm', 'capo', 'lyrics', 'chordsFound', 'confidence', 'notes'],
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
    try {
      const fileRes = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!fileRes.ok) {
        return NextResponse.json({ error: `Could not download the image (status ${fileRes.status}).` }, { status: 502 });
      }
      fileBuffer = Buffer.from(await fileRes.arrayBuffer());
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
      'LYRICS FORMAT — this matters, the app parses it:',
      '  * Mark each section on its own line in square brackets: [Verse 1], [Chorus],',
      '    [Bridge], [Refrain], [Pre-Chorus], [Tag], [Ending].',
      '  * When chord symbols are printed, put them on their own line directly above',
      '    the lyric line, spaced so each chord sits over the syllable it falls on.',
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
      'What you must NOT do is work chords out from the notes themselves. If no',
      'chord symbols are written anywhere on the page, set chordsFound to false and',
      'return the lyrics with no chord lines at all. Absence of written symbols is',
      'the test -- not whether the page happens to be a score.',
      '',
      'On a score the lyrics sit under the staff, split across notes by hyphens.',
      'Rejoin them ("A- ma- zing" becomes "Amazing").',
      '',
      'ALSO ON THE PAGE, and easy to miss:',
      '  * The copyright line in small print at the foot, and a CCLI song number',
      '    ("CCLI Song #1234567"). Take the SONG number, not the licence number.',
      '  * A time signature after the clef, and a printed tempo such as 72 bpm.',
      '    Only report a BPM that is actually printed -- never estimate one.',
      '  * A capo instruction, and any second title in brackets or underneath.',
      '',
      'LAYOUTS THAT CATCH PEOPLE OUT:',
      '  * Hymnals stack verses: several numbered verses printed under one staff,',
      '    or in a block below it. Each is its own [Verse n] section -- do not',
      '    return only the first.',
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
    const MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
    const callModel = async (model: string) => ai.models.generateContent({
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
      },
    });

    let response;
    let lastErr: unknown = null;
    for (const model of MODELS) {
      try {
        response = await callModel(model);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        // Anything that is not the model being busy is a real failure and
        // should surface immediately rather than burning the next model too.
        if (!/50[0-9]|unavailable|overloaded|high demand|429|rate/i.test(String(err))) throw err;
      }
    }
    if (!response) {
      const quota = /429|quota|rate limit/i.test(String(lastErr));
      return NextResponse.json({
        error: quota
          ? 'The scanning service has hit its rate limit for now. Wait a minute and try again, or add the song manually.'
          : 'Every scanning model is busy right now. Try again in a few minutes, or add the song manually.',
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
    const themes = Array.isArray(result.themes)
      ? (result.themes as unknown[]).map((x) => pick(x, v.themes)).filter((x): x is string => !!x).slice(0, 3)
      : [];

    // chordsFound is the model's own claim about its work, and it has been
    // wrong in both directions -- reporting none while transcribing chord
    // lines, and vice versa. Checking the transcription settles it: a chord
    // line is a line whose every token is chord-shaped.
    const lyricsText = typeof result.lyrics === 'string' ? result.lyrics : '';
    const CHORD = /^[A-G](#|b|♯|♭)?(maj|min|m|M|dim|aug|sus|add|alt)?[0-9]*(sus[24]|add[29]|maj[79]|b5|b9|#5|#9|#11|b13)*(\/[A-G](#|b)?)?$/;
    const chordLineCount = lyricsText.split(/\r?\n/).filter((line) => {
      const tokens = line.trim().split(/\s+/).filter(Boolean);
      if (!tokens.length || tokens.length > 12) return false;
      if (/^\[.*\]$/.test(line.trim())) return false;   // a section header
      return tokens.every((tok) => CHORD.test(tok));
    }).length;
    const chordsActuallyPresent = chordLineCount > 0;

    const dropped: string[] = [];
    if (result.key && !pick(result.key, v.keys)) dropped.push('key');
    if (result.tempo && !pick(result.tempo, v.tempos)) dropped.push('feel');
    if (result.style && !pick(result.style, v.styles)) dropped.push('style');
    if (result.season && !pick(result.season, v.seasons)) dropped.push('season');

    return NextResponse.json({
      title: typeof result.title === 'string' ? result.title.trim() : null,
      artist: typeof result.artist === 'string' ? result.artist.trim() : null,
      key: pick(result.key, v.keys),
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
      lyrics: typeof result.lyrics === 'string' ? result.lyrics : null,
      // What is in the transcription wins over what the model said about it.
      chordsFound: chordsActuallyPresent,
      chordLines: chordLineCount,
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
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
