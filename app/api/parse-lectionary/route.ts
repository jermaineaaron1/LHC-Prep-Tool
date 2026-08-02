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

export const runtime = 'nodejs';

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
    const { url, readingDate } = await req.json();
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
    const promptText =
      `This document is a church bulletin or lectionary sheet. Identify the 4 lectionary readings assigned for this service: the 1st Reading (Old Testament), the Psalm, the 2nd Reading (Epistle/New Testament), and the Gospel reading.${dateNote} ` +
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

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const raw = response.text;
    if (!raw) {
      return NextResponse.json({ error: 'AI did not return a structured result.' }, { status: 502 });
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
