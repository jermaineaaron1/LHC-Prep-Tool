import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Server-side proxy for Bible passage lookups, mirroring server.gs's
// fetchBiblePassage/fetchFreeBiblePassage_/fetchEsvPassage_ (the Google Apps
// Script backend, unreachable from the Vercel deployment). The response
// shape must match what bbDoFetch() in Index.html already expects
// ({reference, text, translation, verseCount} or {error}) since that
// client-side code is unchanged.
//
// `note` is the one addition: a sentence for the reader when they asked for one
// translation and are being shown another. It used to be glued onto the end of
// the translation name, which rendered as "World English Bible - WEB (set
// ESV_API_KEY in Vercel env vars for ESV)" -- a server configuration note
// dressed up as the name of a translation.
type Passage = {
  reference: string;
  text: string;
  translation: string;
  verseCount: number;
  note?: string;
};
type Failure = { error: string };

const WEB_NAME = 'World English Bible';

// bible-api.com answers 200 when it holds the passage and 404 when it does not.
// Anything else -- 429 while it is busy, a 5xx, a refused connection -- is the
// service having trouble, not the reference being wrong. Reporting those as
// "Could not find passage" sends someone off to correct a reference that was
// already correct: it happened twice while this feature was being tested, on
// Isaiah 55:6-9 and Ezekiel 33:7-9, both of which resolved on a retry seconds
// later. The distinction is the difference between "you typed it wrong" and
// "try again in a moment".
async function fetchFreePassage(
  reference: string,
  translation: string,
  note?: string,
): Promise<Passage | Failure> {
  const url = 'https://bible-api.com/' + encodeURIComponent(reference) + '?translation=' + translation;

  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return { error: 'Could not reach the Bible service. Check the connection and try again.' };
  }

  if (res.status === 404) {
    return { error: 'No passage found for "' + reference + '". Check the book, chapter and verses.' };
  }
  if (!res.ok) {
    return {
      error: res.status === 429
        ? 'The Bible service is busy. Wait a moment and try again — the reference itself is fine.'
        : 'The Bible service is unavailable right now (HTTP ' + res.status + '). Try again shortly.',
    };
  }

  const data = await res.json();
  let text = '';
  if (Array.isArray(data.verses) && data.verses.length > 0) {
    text = data.verses.map((v: any) => '[' + v.verse + '] ' + String(v.text).trim()).join('\n');
  } else {
    text = data.text || '';
  }

  const passage: Passage = {
    reference: data.reference || reference,
    text,
    translation: data.translation_name || translation.toUpperCase(),
    verseCount: Array.isArray(data.verses) ? data.verses.length : 0,
  };
  if (note) passage.note = note;
  return passage;
}

// Every route out of here that cannot serve the ESV still serves the passage,
// and says which text it served and why. Falling back silently would put an
// unmarked translation in front of a congregation.
async function fetchEsvPassage(reference: string): Promise<Passage | Failure> {
  const apiKey = process.env.ESV_API_KEY;
  if (!apiKey) {
    return fetchFreePassage(reference, 'web',
      'Showing the ' + WEB_NAME + '. The ESV needs an API key on the server — set ESV_API_KEY in the Vercel project settings.');
  }

  const url = 'https://api.esv.org/v3/passage/text/?' +
    'q=' + encodeURIComponent(reference) +
    '&include-headings=false' +
    '&include-footnotes=false' +
    '&include-verse-numbers=true' +
    // Crossway's API terms require the ESV text to carry its attribution.
    // This is the API's own mechanism for it -- a short "(ESV)" after the
    // passage -- and it was explicitly switched off. Turned on before the ESV
    // is actually served to anyone.
    '&include-short-copyright=true' +
    '&include-passage-references=false';

  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: 'Token ' + apiKey } });
  } catch {
    return fetchFreePassage(reference, 'web',
      'Showing the ' + WEB_NAME + '. The ESV service could not be reached.');
  }

  // A refused key is worth naming separately: it is the one failure here that a
  // person can actually fix, and it looks identical to every other outage
  // unless it says so.
  if (res.status === 401 || res.status === 403) {
    return fetchFreePassage(reference, 'web',
      'Showing the ' + WEB_NAME + '. The ESV rejected the API key — check ESV_API_KEY in the Vercel project settings.');
  }
  if (res.status === 429) {
    return fetchFreePassage(reference, 'web',
      'Showing the ' + WEB_NAME + '. The ESV daily query limit has been reached.');
  }
  if (!res.ok) {
    return fetchFreePassage(reference, 'web',
      'Showing the ' + WEB_NAME + '. The ESV service returned HTTP ' + res.status + '.');
  }

  const data = await res.json();
  if (!Array.isArray(data.passages) || data.passages.length === 0) {
    return { error: 'No passage found for "' + reference + '". Check the book, chapter and verses.' };
  }

  const rawText: string = data.passages[0].trim();
  const parts = rawText.split(/\[(\d+)\]\s*/);
  const lines: string[] = [];
  let verseCount = 0;
  for (let i = 1; i < parts.length; i += 2) {
    const verseNum = parts[i];
    const verseText = (parts[i + 1] || '').trim().replace(/\s+/g, ' ');
    if (verseText) {
      lines.push('[' + verseNum + '] ' + verseText);
      verseCount++;
    }
  }

  return {
    reference: data.canonical || reference,
    text: lines.length > 0 ? lines.join('\n') : rawText,
    translation: 'English Standard Version (ESV)',
    verseCount: verseCount || lines.length,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const reference = (searchParams.get('reference') || '').trim();
  const translation = (searchParams.get('translation') || 'web').trim().toLowerCase();

  if (!reference) {
    return NextResponse.json({ error: 'Missing reference parameter' }, { status: 400 });
  }

  try {
    const result = translation === 'esv'
      ? await fetchEsvPassage(reference)
      : await fetchFreePassage(reference, translation);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
