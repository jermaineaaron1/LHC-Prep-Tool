// GET /api/google-doc?id=<document id>
//
// A Google Doc as a Word (.docx) file, for the Liturgy Library's Make ready,
// which reads it in the browser as it reads an uploaded Word liturgy. See
// _lib/googleDoc.ts for why this exists and what it will fetch (one fixed
// Google address, nothing else). Never writes anything.

import { NextRequest, NextResponse } from 'next/server';
import { gdocExportUrl, looksLikeDocx, GDOC_MAX_BYTES } from '../_lib/googleDoc';

export const runtime = 'nodejs';
export const maxDuration = 30;

const PRIVATE = 'Google would not hand this document over. In Google Docs, press Share and set it to "Anyone with the link can view", then try again.';

export async function GET(req: NextRequest) {
  const url = gdocExportUrl(req.nextUrl.searchParams.get('id') || '');
  if (!url) return NextResponse.json({ error: 'That is not a Google Doc.' }, { status: 400 });
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  } catch {
    return NextResponse.json({ error: 'Google did not answer. Try again in a minute.' }, { status: 504 });
  }
  if (!res.ok) {
    return NextResponse.json({ error: res.status === 404 ? 'Google has no such document. Check the link.' : PRIVATE }, { status: res.status === 404 ? 404 : 403 });
  }
  const tooBig = 'This Google Doc is too large to read here. Download it as Word (.docx) and upload that instead.';
  if (Number(res.headers.get('content-length') || 0) > GDOC_MAX_BYTES) return NextResponse.json({ error: tooBig }, { status: 413 });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > GDOC_MAX_BYTES) return NextResponse.json({ error: tooBig }, { status: 413 });
  // A document only some people may see comes back as Google's sign-in page.
  if (!looksLikeDocx(bytes)) return NextResponse.json({ error: PRIVATE, private: true }, { status: 403 });
  return new NextResponse(Buffer.from(bytes), {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Cache-Control': 'no-store' },
  });
}
