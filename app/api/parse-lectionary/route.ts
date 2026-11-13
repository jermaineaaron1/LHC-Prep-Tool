// POST /api/parse-lectionary
// Takes a public URL to a bulletin file (PDF/DOCX/XLSX, uploaded client-side
// via the existing uploadToSupabase() helper, or a link pasted by the user)
// and asks Gemini to identify the 4 lectionary readings for a given date:
// 1st Reading, Psalm, 2nd Reading, Gospel. Returns them as plain scripture
// references (e.g. "Isaiah 6:1-8") for the client to re-run through the
// existing fetchBiblePassage()/SBQ_LECTIONARY.saveSlot() pipeline -- this
// route never writes to the database itself, and never returns passage text.
//
// Requires GEMINI_API_KEY -- a free key from Google AI Studio
// (https://aistudio.google.com/apikey), no paid plan needed. PDF is sent
// natively as inline data (no extraction library needed). DOCX/XLSX are
// extracted to plain text first (mammoth / xlsx) since Gemini's API has no
// native support for those formats.

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { isOwnStorage } from '../_lib/isOwnStorage';

export const runtime = 'nodejs';
// A bulletin is one service and answers in a few seconds. A lectionary is
// a year, and Gemini reading a hundred services takes considerably longer
// than the platform's default. Without this the function is killed
// mid-read and Vercel answers with an HTML error page, which the browser
// then fails to parse as JSON -- so the operator is told
// "Unexpected token '<'" when what happened is "that was too big".
// 60 is what parse-song-sheet and convert-pptx-to-slides already use, and
// is allowed on every plan.
export const maxDuration = 60;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  description: 'The 4 lectionary Bible readings found in the document, as plain scripture references (e.g. "Isaiah 6:1-8", "Psalm 29", "Romans 8:12-17", "John 3:1-17"). Use null for any reading that could not be found.',
  properties: {
    firstReading: { type: Type.STRING, nullable: true, description: 'The Old Testament / first reading reference, or null if not found.' },
    psalm: { type: Type.STRING, nullable: true, description: 'The psalm reading reference, or null if not found.' },
    secondReading: { type: Type.STRING, nullable: true, description: 'The New Testament / epistle / second reading reference, or null if not found.' },
    gospel: { type: Type.STRING, nullable: true, description: 'The Gospel reading reference, or null if not found.' },
  },
  required: ['firstReading', 'psalm', 'secondReading', 'gospel'],
};

// A whole lectionary: many services, each with its own date. The single-date
// schema above stays as it is -- a bulletin for one Sunday is still the
// common case, and asking the model for an array when the document only has
// one service invites it to invent neighbours to fill the list.
const CALENDAR_SCHEMA = {
  type: Type.OBJECT,
  description: 'Every dated service found in the lectionary document, with its four readings.',
  properties: {
    entries: {
      type: Type.ARRAY,
      description: 'One entry per dated service. Empty if the document has no dated services.',
      items: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING, description: 'The service date as YYYY-MM-DD. Required; skip any service whose date cannot be determined.' },
          occasion: { type: Type.STRING, nullable: true, description: 'The name of the day if the document gives one, e.g. "All Saints\' Day", "Advent 2". Null if not stated.' },
          firstReading: { type: Type.STRING, nullable: true, description: 'Old Testament / first reading reference, or null.' },
          psalm: { type: Type.STRING, nullable: true, description: 'Psalm reference, or null.' },
          secondReading: { type: Type.STRING, nullable: true, description: 'Epistle / second reading reference, or null.' },
          gospel: { type: Type.STRING, nullable: true, description: 'Gospel reference, or null.' },
        },
        required: ['date', 'firstReading', 'psalm', 'secondReading', 'gospel'],
      },
    },
  },
  required: ['entries'],
};

// The Prayer of the Day: a document listing, under each service date, the
// prayer said that day (2026-11-13). The words are what is wanted here, not a
// reference -- they go onto the slides and into the bulletin as they stand --
// so the schema asks for the prayer exactly as printed.
const PRAYERS_SCHEMA = {
  type: Type.OBJECT,
  description: 'Every dated service in the document with its Prayer of the Day, word for word.',
  properties: {
    entries: {
      type: Type.ARRAY,
      description: 'One entry per dated service that has a prayer. Empty if there are none.',
      items: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING, description: 'The service date as YYYY-MM-DD. Required; skip any prayer whose date cannot be determined.' },
          occasion: { type: Type.STRING, nullable: true, description: 'The name of the day if the document gives one, e.g. "Christ the King Sunday". Null if not stated.' },
          prayer: { type: Type.STRING, description: 'The Prayer of the Day exactly as printed, word for word, including its closing "Amen." if printed. No heading, no date, no page numbers.' },
        },
        required: ['date', 'prayer'],
      },
    },
  },
  required: ['entries'],
};

// A year of Sundays plus festivals is comfortably under this. The cap is
// here so a model that starts repeating itself cannot hand the browser a
// review table with thousands of rows in it.
const MAX_ENTRIES = 400;

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
};

function extFromUrl(url: string): string {
  const clean = url.split('?')[0].split('#')[0];
  const m = clean.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

export async function POST(req: NextRequest) {
  try {
    const { url, readingDate, mode, yearHint } = await req.json();
    // 'calendar' reads a whole lectionary; 'prayers' a document of Prayers
    // of the Day; anything else keeps the original single-service
    // behaviour, so existing callers are unchanged.
    const isCalendar = mode === 'calendar';
    const isPrayers = mode === 'prayers';
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'AI-assisted lectionary extraction is not configured on this server (missing GEMINI_API_KEY). Use the manual reading picker instead.' },
        { status: 500 }
      );
    }

    // Checked BEFORE the extension, because the extension constrains nothing
    // here: http://169.254.169.254/latest/meta-data/x.pdf passes it. Without
    // this the route fetches anything reachable from the deployment and hands
    // it to a model that reports back what it says. Probed against the live
    // site before this was added, it fetched example.com and returned the
    // status, and attempted the link-local address.
    if (!isOwnStorage(url)) {
      return NextResponse.json(
        { error: 'That file is not one this app uploaded. Upload the bulletin again and retry.' },
        { status: 400 }
      );
    }

    const ext = extFromUrl(url);
    const supportedExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx'];
    if (!supportedExts.includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type "${ext || 'unknown'}". Supported: PDF, DOCX, XLSX.` },
        { status: 415 }
      );
    }

    const fileRes = await fetch(url);
    if (!fileRes.ok) {
      return NextResponse.json({ error: `Could not download file from URL (status ${fileRes.status}).` }, { status: 502 });
    }
    const fileBuffer = Buffer.from(await fileRes.arrayBuffer());

    const dateNote = readingDate ? ` The bulletin is for the service on ${readingDate}.` : '';
    const yearNote = yearHint ? ` Where the document gives a day and month without a year, assume ${yearHint}.` : '';

    // Two prompts, because the two jobs fail in opposite directions. Asked
    // for one service, the model must not wander to the next page; asked for
    // a calendar, it must not stop at the first.
    const promptText = isPrayers
      ? `This document lists the Prayer of the Day for church services: each prayer is given under the date of the service it is for. ` +
        `List EVERY dated prayer you can find, in the order they appear. For each one give the date as YYYY-MM-DD, the name of the day ` +
        `if the document gives one, and the prayer itself copied word for word exactly as printed -- keep its wording, spelling and ` +
        `punctuation, and its closing "Amen." if it has one. Join the lines of one prayer into running text; do not include the heading, ` +
        `the date, page numbers or anything that is not the prayer.${yearNote} Skip any prayer whose date you cannot work out rather ` +
        `than guessing one, and do not invent prayers that are not in the document.`
      : isCalendar
      ? `This document is a church lectionary: a table or list of services, each with a date and its appointed readings. ` +
        `List EVERY dated service you can find, in the order they appear. For each one give the date as YYYY-MM-DD and the ` +
        `1st Reading (Old Testament), Psalm, 2nd Reading (Epistle), and Gospel.${yearNote} ` +
        `Report each reading as a plain scripture reference (book, chapter and verses -- e.g. "Isaiah 6:1-8"), never the passage text. ` +
        `Use null for a reading a service does not list. Skip any service whose date you cannot work out rather than guessing one, ` +
        `and do not invent services that are not in the document.`
      : `This document is a church bulletin or lectionary sheet. Identify the 4 lectionary readings assigned for this service: the 1st Reading (Old Testament), the Psalm, the 2nd Reading (Epistle/New Testament), and the Gospel reading.${dateNote} ` +
        `Report each as a plain scripture reference (book, chapter, and verses -- e.g. "Isaiah 6:1-8"), not the passage text itself. If a reading is not present in the document, report it as null.`;

    const ai = new GoogleGenAI({ apiKey });

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    if (ext === 'pdf') {
      parts.push({ inlineData: { mimeType: MIME_TYPES.pdf, data: fileBuffer.toString('base64') } });
    } else if (ext === 'docx' || ext === 'doc') {
      const mammoth = await import('mammoth');
      const { value: text } = await mammoth.extractRawText({ buffer: fileBuffer });
      if (!text || !text.trim()) {
        return NextResponse.json({ error: 'Could not extract any text from this Word document.' }, { status: 502 });
      }
      parts.push({ text: `Document contents:\n\n${text}` });
    } else {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      const sheetTexts = workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name];
        return `Sheet "${name}":\n${XLSX.utils.sheet_to_csv(sheet)}`;
      });
      const text = sheetTexts.join('\n\n');
      if (!text || !text.trim()) {
        return NextResponse.json({ error: 'Could not extract any text from this spreadsheet.' }, { status: 502 });
      }
      parts.push({ text: `Spreadsheet contents:\n\n${text}` });
    }

    parts.push({ text: promptText });

    // A year of prayers is a lot of words to write back -- far more than a
    // year of references -- and the platform stops the function at
    // maxDuration. Reading prayers off a page needs no reasoning, so the
    // model is asked not to think first, which is most of the time saved.
    // A model that will not run without thinking refuses the setting
    // outright, and is then asked again without it.
    const ask = (noThinking: boolean) => ai.models.generateContent({
      // Version-agnostic alias -- always points to the current, non-
      // deprecated flash-tier model, so this route doesn't break every
      // time Google retires an old dated model version (e.g. gemini-2.5-flash
      // was retired for new API keys/projects).
      model: 'gemini-flash-latest',
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: isPrayers ? PRAYERS_SCHEMA : isCalendar ? CALENDAR_SCHEMA : RESPONSE_SCHEMA,
        ...(noThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    });
    let response;
    try {
      response = await ask(isPrayers);
    } catch (err: unknown) {
      if (!isPrayers || !/think/i.test(err instanceof Error ? err.message : String(err))) throw err;
      response = await ask(false);
    }

    const raw = response.text;
    if (!raw) {
      return NextResponse.json({ error: 'AI did not return a structured result.' }, { status: 502 });
    }

    if (isPrayers) {
      let parsed: { entries?: Array<Record<string, string | null>> };
      try {
        parsed = JSON.parse(raw);
      } catch {
        return NextResponse.json({ error: 'AI returned an unparseable result.' }, { status: 502 });
      }
      const seen = new Set<string>();
      const entries = (parsed.entries || [])
        .map((e) => ({
          date: String(e.date || '').trim(),
          occasion: e.occasion ? String(e.occasion).trim() : null,
          // One prayer is running text: the lines of the page joined, the
          // spacing tidied, nothing else changed.
          prayer: String(e.prayer || '').replace(/\s+/g, ' ').trim(),
        }))
        .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date))
        .filter((e) => e.prayer.length > 0)
        // One prayer per date: the first, as the document orders them.
        .filter((e) => (seen.has(e.date) ? false : (seen.add(e.date), true)))
        .sort((a, b) => a.date.localeCompare(b.date));
      const truncated = entries.length > MAX_ENTRIES;
      return NextResponse.json({
        entries: truncated ? entries.slice(0, MAX_ENTRIES) : entries,
        ...(truncated ? { warnings: [`Only the first ${MAX_ENTRIES} prayers were kept.`] } : {}),
        ...(entries.length ? {} : { warnings: ['No dated prayers were found in this document.'] }),
      });
    }

    if (isCalendar) {
      let parsed: { entries?: Array<Record<string, string | null>> };
      try {
        parsed = JSON.parse(raw);
      } catch {
        return NextResponse.json({ error: 'AI returned an unparseable result.' }, { status: 502 });
      }

      const seen = new Set<string>();
      const entries = (parsed.entries || [])
        .map((e) => ({
          date: String(e.date || '').trim(),
          occasion: e.occasion ? String(e.occasion).trim() : null,
          firstReading: e.firstReading || null,
          psalm: e.psalm || null,
          secondReading: e.secondReading || null,
          gospel: e.gospel || null,
        }))
        // A date the client cannot key on is worse than no row: it would show
        // in the review table and then save nowhere.
        .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date))
        // Nothing to offer for this date.
        .filter((e) => e.firstReading || e.psalm || e.secondReading || e.gospel)
        // One row per date. A lectionary that prints a service twice -- a
        // continued page, or morning and evening under one date -- would
        // otherwise give the review table two rows that fight over one key.
        .filter((e) => (seen.has(e.date) ? false : (seen.add(e.date), true)))
        .sort((a, b) => a.date.localeCompare(b.date));

      const truncated = entries.length > MAX_ENTRIES;
      return NextResponse.json({
        entries: truncated ? entries.slice(0, MAX_ENTRIES) : entries,
        ...(truncated ? { warnings: [`Only the first ${MAX_ENTRIES} services were kept.`] } : {}),
        ...(entries.length ? {} : { warnings: ['No dated services were found in this document.'] }),
      });
    }

    let result: {
      firstReading: string | null;
      psalm: string | null;
      secondReading: string | null;
      gospel: string | null;
    };
    try {
      result = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'AI returned an unparseable result.' }, { status: 502 });
    }

    const warnings: string[] = [];
    if (!result.firstReading) warnings.push('1st Reading not found in document');
    if (!result.psalm) warnings.push('Psalm not found in document');
    if (!result.secondReading) warnings.push('2nd Reading not found in document');
    if (!result.gospel) warnings.push('Gospel not found in document');

    return NextResponse.json({
      firstReading: result.firstReading || null,
      psalm: result.psalm || null,
      secondReading: result.secondReading || null,
      gospel: result.gospel || null,
      ...(warnings.length ? { warnings } : {}),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
