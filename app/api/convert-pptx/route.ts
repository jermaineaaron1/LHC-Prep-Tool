// POST /api/convert-pptx
// Converts an uploaded PPTX (given as a public URL, e.g. a Supabase Storage URL)
// to PDF using a Google service account + Drive API's built-in format conversion.
// The PDF is returned directly so the client can run it through the existing
// PDF.js slide-extraction pipeline (which already syncs the slide viewer,
// Projection Preview, and projection window perfectly).
//
// Requires two env vars (from a Google Cloud service account JSON key):
//   GOOGLE_SA_CLIENT_EMAIL
//   GOOGLE_SA_PRIVATE_KEY   (with literal \n line breaks, as stored by most env UIs)

import { NextRequest, NextResponse } from 'next/server';
import { GoogleAuth } from 'google-auth-library';

export const runtime = 'nodejs';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

function getAuth() {
  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) return null;
  return new GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: [DRIVE_SCOPE],
  });
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });

    const auth = getAuth();
    if (!auth) {
      return NextResponse.json(
        { error: 'Server is not configured for PPTX conversion (missing GOOGLE_SA_CLIENT_EMAIL / GOOGLE_SA_PRIVATE_KEY).' },
        { status: 500 }
      );
    }

    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    if (!token) return NextResponse.json({ error: 'Could not obtain Google access token' }, { status: 500 });

    // 1. Download the original PPTX bytes
    const srcRes = await fetch(url);
    if (!srcRes.ok) {
      return NextResponse.json({ error: `Could not fetch source file (${srcRes.status})` }, { status: 502 });
    }
    const pptxBuffer = Buffer.from(await srcRes.arrayBuffer());

    // 2. Upload to Drive, requesting conversion to Google Slides format
    const boundary = 'lhc_pptx_convert_' + Date.now();
    const metadata = JSON.stringify({ name: 'tmp-' + Date.now() + '.pptx', mimeType: 'application/vnd.google-apps.presentation' });
    const multipartBody = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation\r\n\r\n`
      ),
      pptxBuffer,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      return NextResponse.json({ error: `Drive upload/convert failed: ${text}` }, { status: 502 });
    }
    const uploaded = await uploadRes.json();
    const fileId = uploaded.id;

    try {
      // 3. Export the converted Slides file as PDF
      const exportRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!exportRes.ok) {
        const text = await exportRes.text();
        return NextResponse.json({ error: `PDF export failed: ${text}` }, { status: 502 });
      }
      const pdfBuffer = Buffer.from(await exportRes.arrayBuffer());

      return new NextResponse(pdfBuffer, {
        headers: { 'Content-Type': 'application/pdf' },
      });
    } finally {
      // 4. Clean up the temporary Drive file regardless of export outcome
      fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
