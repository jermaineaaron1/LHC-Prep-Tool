// POST /api/parse-liturgy
//
// A liturgy the church wrote in its own document -- a PDF, an Excel sheet,
// an old Word (.doc) file, or a .docx the browser could not make sense of --
// read by Gemini into an order of worship: its sections in order, and in each
// the parts (liturgy, reading, song, text) with the words of each part as
// slides. The Liturgy Library's service page shows the result for checking
// and keeps it as a ready liturgy (service_liturgies) that later services load
// in the Liturgy Builder. This route never writes to the database.
//
// From the operator (2026-11-14): "users can upload their liturgy that is
// organised in their own document and use that as base for future year's
// liturgies ... converted to be used in the Liturgy Builder and LCD". A
// .docx is converted in the browser exactly as written; this route is for
// the rest.
//
// Requires GEMINI_API_KEY (Vercel only). Takes { url } of a file this app
// uploaded (isOwnStorage), as parse-lectionary does.

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { isOwnStorage } from '../_lib/isOwnStorage';

export const runtime = 'nodejs';
// A whole liturgy is a lot of words to write back. 60s is allowed on every
// plan and is what the other document routes use.
export const maxDuration = 60;

const LITURGY_SCHEMA = {
  type: Type.OBJECT,
  description: 'A church service liturgy (order of worship), section by section, in the order of the document.',
  properties: {
    title: { type: Type.STRING, nullable: true, description: 'The name of the service as the document gives it, e.g. "Good Friday Service 2024". Null if it gives none.' },
    sections: {
      type: Type.ARRAY,
      description: 'The sections of the service in order: each heading of the order of worship (Invocation, Confession, Prayer of the Day, Sermon, Benediction...).',
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: 'The section heading as printed, without its number and without who leads it (put that in leader).' },
          leader: { type: Type.STRING, nullable: true, description: 'Who leads this part if the heading says so, e.g. "Pastor Justin". Null if not stated.' },
          parts: {
            type: Type.ARRAY,
            description: 'What happens in this section, in order.',
            items: {
              type: Type.OBJECT,
              properties: {
                kind: { type: Type.STRING, enum: ['liturgy', 'reading', 'song', 'text'], description: 'liturgy: words said or sung by leader and people (prayers, responses, creeds, blessings). reading: a Bible reading. song: a hymn or song. text: anything else to show (a notice, an instruction to the congregation).' },
                title: { type: Type.STRING, description: 'For a reading, the scripture reference (e.g. "John 18:1-19:42"). For a song, its title only. Otherwise a short name for the part, usually the section heading.' },
                slides: {
                  type: Type.ARRAY,
                  description: 'The words of a liturgy or text part, split into projector slides of at most about 6 short lines, breaking where the document breaks a paragraph. Empty for a reading or a song.',
                  items: { type: Type.STRING },
                },
              },
              required: ['kind', 'title', 'slides'],
            },
          },
        },
        required: ['title', 'parts'],
      },
    },
  },
  required: ['sections'],
};

const PROMPT =
  'This document is a church service liturgy: the order of worship for one service, with the words the leader and the ' +
  'congregation say. Turn it into its sections, in the order they appear. Copy the words of each prayer, response, creed and ' +
  'blessing EXACTLY as printed -- same wording, spelling and punctuation -- and keep the speaker markers at the start of lines ' +
  'as printed (for example "L:", "P:", "C:", "A:", "All:"); write "Congregation (C):" as "C:". Split long passages into slides of ' +
  'at most about six short lines, breaking where the document starts a new paragraph or a new speaker. For a Bible reading give ' +
  'only its reference as the title and no slides. For a hymn or song give only its title (without the hymn number) and no slides. ' +
  'Leave out page numbers, headers and footers, the church name, the date, and stage directions such as "(Please stand)". ' +
  'Do not invent anything that is not in the document.';

function extFromUrl(url: string): string {
  const clean = url.split('?')[0].split('#')[0];
  const m = clean.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}

// The words of an old Word 97-2003 (.doc) file. No library here reads the
// format, so the runs of readable text are pulled out of the file -- as
// UTF-16 (how Word keeps most text) and as single bytes (how it keeps plain
// English) -- and the longer reading is kept. Rough: stray fragments from the
// file's other parts can come with it. The model is told so, and the result is
// checked by a person before it is kept.
function legacyDocText(buf: Buffer): string {
  const ok = (c: number) => c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || (c >= 160 && c < 256) ||
    (c >= 0x2010 && c <= 0x2027);
  const keep = (run: string) => (run.match(/[A-Za-z]/g) || []).length >= 6;
  const tidy = (s: string) => s.replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const wide: string[] = [];
  let cur = '';
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const c = buf[i] | (buf[i + 1] << 8);
    if (ok(c)) cur += String.fromCharCode(c === 13 ? 10 : c);
    else { if (cur.length >= 12 && keep(cur)) wide.push(cur); cur = ''; }
  }
  if (cur.length >= 12 && keep(cur)) wide.push(cur);
  const narrow: string[] = [];
  cur = '';
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c === 0x91 || c === 0x92 || c === 0x93 || c === 0x94 || c === 0x96 || c === 0x97) {
      cur += c === 13 ? '\n' : c === 0x91 || c === 0x92 ? "'" : c === 0x93 || c === 0x94 ? '"' : c === 0x96 || c === 0x97 ? '-' : String.fromCharCode(c);
    } else { if (cur.length >= 12 && keep(cur)) narrow.push(cur); cur = ''; }
  }
  if (cur.length >= 12 && keep(cur)) narrow.push(cur);
  const a = tidy(wide.join('\n')), b = tidy(narrow.join('\n'));
  return a.length >= b.length ? a : b;
}

type Part = { kind: string; title: string; slides: string[] };
type Section = { title: string; leader?: string | null; parts: Part[] };

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Reading liturgies with AI is not set up on this server (missing GEMINI_API_KEY).' }, { status: 500 });
    }
    // Before the extension, which constrains nothing (see _lib/isOwnStorage).
    if (!isOwnStorage(url)) {
      return NextResponse.json({ error: 'That file is not one this app uploaded. Upload it to the Liturgy Library and try again.' }, { status: 400 });
    }
    const ext = extFromUrl(url);
    if (!['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(ext)) {
      return NextResponse.json({ error: `A .${ext || '?'} file cannot be read as a liturgy. PDF, Word and Excel can.` }, { status: 415 });
    }
    const fileRes = await fetch(url);
    if (!fileRes.ok) {
      return NextResponse.json({ error: `The file could not be downloaded (status ${fileRes.status}).` }, { status: 502 });
    }
    const buf = Buffer.from(await fileRes.arrayBuffer());

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    if (ext === 'pdf') {
      parts.push({ inlineData: { mimeType: 'application/pdf', data: buf.toString('base64') } });
    } else if (ext === 'docx') {
      const mammoth = await import('mammoth');
      const { value: text } = await mammoth.extractRawText({ buffer: buf });
      if (!text || !text.trim()) return NextResponse.json({ error: 'No words could be read from this Word document.' }, { status: 502 });
      parts.push({ text: `Document contents:\n\n${text}` });
    } else if (ext === 'doc') {
      const text = legacyDocText(buf);
      if (text.length < 40) {
        return NextResponse.json({ error: 'No words could be read from this old Word (.doc) file. Open it in Word, save it as .docx, and upload that.' }, { status: 502 });
      }
      parts.push({ text: 'The text below was pulled out of an old Word (.doc) file and may include stray fragments of the file\'s ' +
        'formatting information or other characters. Ignore anything that is not part of the service.\n\nDocument contents:\n\n' + text });
    } else {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buf, { type: 'buffer' });
      const text = workbook.SheetNames.map((name) => `Sheet "${name}":\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`).join('\n\n');
      if (!text.trim()) return NextResponse.json({ error: 'No words could be read from this spreadsheet.' }, { status: 502 });
      parts.push({ text: `Spreadsheet contents (each row a line, cells separated by commas):\n\n${text}` });
    }
    parts.push({ text: PROMPT });

    const ai = new GoogleGenAI({ apiKey });
    // Copying words needs no reasoning, and thinking first costs most of the
    // time a whole liturgy has. A model that will not run without thinking
    // refuses the setting, and is asked again without it.
    const ask = (noThinking: boolean) => ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: LITURGY_SCHEMA,
        ...(noThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    });
    let response;
    try {
      response = await ask(true);
    } catch (err: unknown) {
      if (!/think/i.test(err instanceof Error ? err.message : String(err))) throw err;
      response = await ask(false);
    }
    const raw = response.text;
    if (!raw) return NextResponse.json({ error: 'The AI did not return a liturgy.' }, { status: 502 });
    let parsed: { title?: string | null; sections?: Section[] };
    try { parsed = JSON.parse(raw); } catch {
      return NextResponse.json({ error: 'The AI returned something that could not be read.' }, { status: 502 });
    }
    const kinds = ['liturgy', 'reading', 'song', 'text'];
    const sections = (parsed.sections || []).map((s) => ({
      title: String(s.title || '').replace(/\s+/g, ' ').trim(),
      leader: s.leader ? String(s.leader).trim() : null,
      parts: (s.parts || []).map((p) => ({
        kind: kinds.includes(String(p.kind)) ? String(p.kind) : 'liturgy',
        title: String(p.title || '').replace(/\s+/g, ' ').trim(),
        slides: (Array.isArray(p.slides) ? p.slides : []).map((t) => String(t || '').replace(/\r\n?/g, '\n').trim()).filter(Boolean),
      })).filter((p) => p.title || p.slides.length),
    })).filter((s) => s.title || s.parts.length);
    if (!sections.length) {
      return NextResponse.json({ error: 'No order of worship could be found in this document.' }, { status: 422 });
    }
    return NextResponse.json({ title: parsed.title ? String(parsed.title).trim() : null, sections });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'The liturgy could not be read: ' + msg }, { status: 500 });
  }
}
