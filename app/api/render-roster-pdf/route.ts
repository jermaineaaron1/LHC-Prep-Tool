// POST /api/render-roster-pdf
// Renders a standalone HTML document (the roster table, built client-side with
// the same markup/CSS used by Print/PDF) into a real multi-page PDF using
// CloudConvert's Chrome engine. This replaces the old client-side
// html2canvas + manual image-slicing approach for "Share PDF", which kept
// producing pagination bugs (scrambled columns, split rows, dead space,
// disconnected section headers) because it was reimplementing print
// pagination by hand on a screenshot. Chrome's own print engine — the same
// one the working Print/PDF button already relies on via window.print() —
// handles page breaks, "keep together," and section continuity correctly,
// so rendering server-side with that engine sidesteps the whole class of bug.
//
// Requires one env var: CLOUDCONVERT_API_KEY (from cloudconvert.com dashboard)

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface CloudConvertTask {
  name: string;
  status: string;
  result?: { files?: { url: string }[] };
}

export async function POST(req: NextRequest) {
  try {
    const { html } = await req.json();
    if (!html) return NextResponse.json({ error: 'html is required' }, { status: 400 });

    const apiKey = process.env.CLOUDCONVERT_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Server is not configured for PDF rendering (missing CLOUDCONVERT_API_KEY).' },
        { status: 500 }
      );
    }

    const htmlBase64 = Buffer.from(html, 'utf-8').toString('base64');

    // Sync endpoint: waits for the job to finish (up to ~30s) so we can return
    // the result in one round trip — no polling/webhooks needed.
    const jobRes = await fetch('https://sync.api.cloudconvert.com/v2/jobs', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tasks: {
          'import-html': {
            operation: 'import/raw',
            file: htmlBase64,
            filename: 'roster.html',
          },
          'convert-html': {
            operation: 'convert',
            input: 'import-html',
            input_format: 'html',
            output_format: 'pdf',
            engine: 'chrome',
            page_orientation: 'landscape',
            page_size: 'A4',
            margin_top: 0,
            margin_bottom: 0,
            margin_left: 0,
            margin_right: 0,
            print_background: true,
            display_header_footer: false,
          },
          'export-file': { operation: 'export/url', input: 'convert-html' },
        },
      }),
    });

    if (!jobRes.ok) {
      const text = await jobRes.text();
      return NextResponse.json({ error: `CloudConvert job failed: ${text}` }, { status: 502 });
    }

    const job = await jobRes.json();
    const tasks: CloudConvertTask[] = job.data?.tasks ?? [];
    const exportTask = tasks.find((t) => t.name === 'export-file');

    if (!exportTask || exportTask.status !== 'finished' || !exportTask.result?.files?.length) {
      const failed = tasks.find((t) => t.status === 'error');
      return NextResponse.json(
        { error: 'PDF render did not complete', detail: failed ?? exportTask ?? job.data },
        { status: 502 }
      );
    }

    const pdfUrl = exportTask.result.files[0].url;
    const pdfRes = await fetch(pdfUrl);
    if (!pdfRes.ok) {
      return NextResponse.json({ error: 'Could not download rendered PDF' }, { status: 502 });
    }
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

    return new NextResponse(pdfBuffer, {
      headers: { 'Content-Type': 'application/pdf' },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
