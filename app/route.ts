import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

// Serve the LHC Worship Prep single-page app at the root.
// The worship app is a self-contained HTML file — all CSS/JS is inline
// or loaded from CDNs — so returning raw HTML works perfectly here.
export async function GET() {
  const html = await readFile(path.join(process.cwd(), 'dist', 'index.html'), 'utf8');
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
