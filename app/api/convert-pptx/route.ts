// POST /api/convert-pptx
// Converts an uploaded PPTX (given as a public URL, e.g. a Supabase Storage URL)
// to PDF using CloudConvert. The PDF is returned directly so the client can run
// it through the existing PDF.js slide-extraction pipeline (which already syncs
// the slide viewer, Projection Preview, and projection window perfectly) instead
// of the cross-origin Office Online iframe, which can't be synced at all.
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
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });

    const apiKey = process.env.CLOUDCONVERT_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Server is not configured for PPTX conversion (missing CLOUDCONVERT_API_KEY).' },
        { status: 500 }
      );
    }

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
          'import-file': { operation: 'import/url', url },
          'convert-file': { operation: 'convert', input: 'import-file', output_format: 'pdf' },
          'export-file': { operation: 'export/url', input: 'convert-file' },
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
        { error: 'Conversion did not complete', detail: failed ?? exportTask ?? job.data },
        { status: 502 }
      );
    }

    const pdfUrl = exportTask.result.files[0].url;
    const pdfRes = await fetch(pdfUrl);
    if (!pdfRes.ok) {
      return NextResponse.json({ error: 'Could not download converted PDF' }, { status: 502 });
    }
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

    return new NextResponse(pdfBuffer, {
      headers: { 'Content-Type': 'application/pdf' },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
