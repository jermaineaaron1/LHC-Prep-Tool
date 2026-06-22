import { NextResponse, NextRequest } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Serve the LHC Worship Prep single-page app at the root.
// When ?name= is present (playlist share links), inject dynamic OG title
// so WhatsApp/social previews show the songbook name instead of the generic title.
export async function GET(request: NextRequest) {
  let html = await readFile(path.join(process.cwd(), 'dist', 'index.html'), 'utf8');

  const { searchParams } = new URL(request.url);
  const playlistName = searchParams.get('name');

  if (playlistName) {
    const title = 'LHC Worship Prep — ' + playlistName;
    const desc = 'Open to play this worship playlist in LHC Worship Prep.';
    const ogTags =
      `<meta property="og:title" content="${esc(title)}">` +
      `<meta property="og:description" content="${esc(desc)}">` +
      `<meta property="og:type" content="website">`;
    html = html
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
      .replace('</title>', `</title>\n  ${ogTags}`);
  }

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
