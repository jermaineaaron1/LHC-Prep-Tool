// POST /api/render-roster-pdf
// Renders a standalone HTML document into a real, high-fidelity file using
// CloudConvert's Chrome engine. Two output shapes share this one route:
//   - format omitted or 'pdf' (default): the full roster table -> multi-page
//     PDF, landscape A4. This replaced the old client-side html2canvas +
//     manual image-slicing approach for "Share PDF", which kept producing
//     pagination bugs (scrambled columns, split rows, dead space,
//     disconnected section headers) because it was reimplementing print
//     pagination by hand on a screenshot.
//   - format: 'png': a single bounded-size element (e.g. one mobile service
//     card) -> a PNG "picture," for WhatsApp image shares where the user
//     wants a faithful capture of exactly what's on screen, not a
//     redesigned graphic. No pagination concerns at this size, so the same
//     real-Chrome-engine approach applies cleanly without PDF-only page
//     options (page_size/orientation/margins are meaningless for an image
//     and are omitted for this branch).
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
    const { html, format } = await req.json();
    if (!html) return NextResponse.json({ error: 'html is required' }, { status: 400 });
    const isImage = format === 'png';

    const apiKey = process.env.CLOUDCONVERT_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: `Server is not configured for ${isImage ? 'image' : 'PDF'} rendering (missing CLOUDCONVERT_API_KEY).` },
        { status: 500 }
      );
    }

    const htmlBase64 = Buffer.from(html, 'utf-8').toString('base64');

    // Sync endpoint: waits for the job to finish (up to ~30s) so we can return
    // the result in one round trip — no polling/webhooks needed.
    const convertTask = isImage
      ? {
          operation: 'convert',
          input: 'import-html',
          input_format: 'html',
          output_format: 'png',
          engine: 'chrome',
          // Renders at 2x for a crisp, retina-quality image. No page_size/
          // orientation/margins here (PDF-only concepts) -- CloudConvert's
          // HTML-to-image conversion auto-sizes to the rendered content's
          // natural dimensions, which is what "capture exactly this element"
          // needs, given the source HTML is sized to its content already.
          zoom: 2,
          print_background: true,
        }
      : {
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
        };

    const jobRes = await fetch('https://sync.api.cloudconvert.com/v2/jobs', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tasks: {
          'import-html': {
            operation: 'import/base64',
            file: htmlBase64,
            filename: 'roster.html',
          },
          'convert-html': convertTask,
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
        { error: `${isImage ? 'Image' : 'PDF'} render did not complete`, detail: failed ?? exportTask ?? job.data },
        { status: 502 }
      );
    }

    const fileUrl = exportTask.result.files[0].url;
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) {
      return NextResponse.json({ error: `Could not download rendered ${isImage ? 'image' : 'PDF'}` }, { status: 502 });
    }
    const fileBuffer = Buffer.from(await fileRes.arrayBuffer());

    return new NextResponse(fileBuffer, {
      headers: { 'Content-Type': isImage ? 'image/png' : 'application/pdf' },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
