import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Server-side proxy for Bible passage lookups, mirroring server.gs's
// fetchBiblePassage/fetchFreeBiblePassage_/fetchEsvPassage_ (the Google Apps
// Script backend, unreachable from the Vercel deployment). The response
// shape must match what bbDoFetch() in Index.html already expects
// ({reference, text, translation, verseCount} or {error}) since that
// client-side code is unchanged.
async function fetchFreePassage(reference: string, translation: string, note?: string) {
  const url = 'https://bible-api.com/' + encodeURIComponent(reference) + '?translation=' + translation;
  const res = await fetch(url);
  if (!res.ok) {
    return { error: 'Could not find passage: ' + reference };
  }
  const data = await res.json();
  let text = '';
  if (Array.isArray(data.verses) && data.verses.length > 0) {
    text = data.verses.map((v: any) => '[' + v.verse + '] ' + String(v.text).trim()).join('\n');
  } else {
    text = data.text || '';
  }
  return {
    reference: data.reference || reference,
    text,
    translation: (data.translation_name || translation.toUpperCase()) + (note ? ' - ' + note : ''),
    verseCount: Array.isArray(data.verses) ? data.verses.length : 0,
  };
}

async function fetchEsvPassage(reference: string) {
  const apiKey = process.env.ESV_API_KEY;
  if (!apiKey) {
    return fetchFreePassage(reference, 'web', 'WEB (set ESV_API_KEY in Vercel env vars for ESV)');
  }

  const url = 'https://api.esv.org/v3/passage/text/?' +
    'q=' + encodeURIComponent(reference) +
    '&include-headings=false' +
    '&include-footnotes=false' +
    '&include-verse-numbers=true' +
    '&include-short-copyright=false' +
    '&include-passage-references=false';

  const res = await fetch(url, { headers: { Authorization: 'Token ' + apiKey } });
  if (!res.ok) {
    return fetchFreePassage(reference, 'web', 'WEB (ESV API error)');
  }
  const data = await res.json();
  if (!Array.isArray(data.passages) || data.passages.length === 0) {
    return { error: 'Could not find passage: ' + reference };
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
