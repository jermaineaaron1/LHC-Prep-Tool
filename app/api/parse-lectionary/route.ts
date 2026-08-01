// POST /api/parse-lectionary
// Takes a public URL to a bulletin file (PDF/DOCX/XLSX, uploaded client-side
// via the existing uploadToSupabase() helper, or a link pasted by the user)
// and asks Claude to identify the 4 lectionary readings for a given date:
// 1st Reading, Psalm, 2nd Reading, Gospel. Returns them as plain scripture
// references (e.g. "Isaiah 6:1-8") for the client to re-run through the
// existing fetchBiblePassage()/SBQ_LECTIONARY.saveSlot() pipeline -- this
// route never writes to the database itself, and never returns passage text.
//
// Requires ANTHROPIC_API_KEY. PDF is sent natively as a document content
// block (no extraction library needed). DOCX/XLSX are extracted to plain
// text first (mammoth / xlsx) since Claude's API has no native support for
// those formats.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const REPORT_TOOL = {
  name: 'report_lectionary_readings',
  description:
    'Report the 4 lectionary Bible readings found in the document, as plain scripture references (e.g. "Isaiah 6:1-8", "Psalm 29", "Romans 8:12-17", "John 3:1-17"). Use null for any reading that could not be found in the document.',
  input_schema: {
    type: 'object' as const,
    properties: {
      firstReading: {
        type: ['string', 'null'],
        description: 'The Old Testament / first reading reference, or null if not found.',
      },
      psalm: {
        type: ['string', 'null'],
        description: 'The psalm reading reference, or null if not found.',
      },
      secondReading: {
        type: ['string', 'null'],
        description: 'The New Testament / epistle / second reading reference, or null if not found.',
      },
      gospel: {
        type: ['string', 'null'],
        description: 'The Gospel reading reference, or null if not found.',
      },
    },
    required: ['firstReading', 'psalm', 'secondReading', 'gospel'],
  },
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

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'AI-assisted lectionary extraction is not configured on this server (missing ANTHROPIC_API_KEY). Use the manual reading picker instead.' },
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
      `Report each as a plain scripture reference (book, chapter, and verses -- e.g. "Isaiah 6:1-8"), not the passage text itself. If a reading is not present in the document, report it as null. Call the report_lectionary_readings tool with your findings.`;

    const anthropic = new Anthropic({ apiKey });

    let contentBlock: Anthropic.Messages.ContentBlockParam;

    if (ext === 'pdf') {
      contentBlock = {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: fileBuffer.toString('base64'),
        },
      };
    } else if (ext === 'docx' || ext === 'doc') {
      const mammoth = await import('mammoth');
      const { value: text } = await mammoth.extractRawText({ buffer: fileBuffer });
      if (!text || !text.trim()) {
        return NextResponse.json({ error: 'Could not extract any text from this Word document.' }, { status: 502 });
      }
      contentBlock = { type: 'text', text: `Document contents:\n\n${text}` };
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
      contentBlock = { type: 'text', text: `Spreadsheet contents:\n\n${text}` };
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      tools: [REPORT_TOOL],
      tool_choice: { type: 'tool', name: REPORT_TOOL.name },
      messages: [
        {
          role: 'user',
          content: [contentBlock, { type: 'text', text: promptText }],
        },
      ],
    });

    const toolUse = message.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use'
    );
    if (!toolUse) {
      return NextResponse.json({ error: 'AI did not return a structured result.' }, { status: 502 });
    }

    const result = toolUse.input as {
      firstReading: string | null;
      psalm: string | null;
      secondReading: string | null;
      gospel: string | null;
    };

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
