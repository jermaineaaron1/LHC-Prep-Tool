import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

export async function GET() {
  let html = await readFile(
    path.join(process.cwd(), 'game', 'vocal-hero.html'),
    'utf8'
  );

  // Inject Supabase credentials into the placeholder variables
  const sbUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? '';
  const sbKey  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  html = html
    .replace("'__SB_URL__'", JSON.stringify(sbUrl))
    .replace("'__SB_KEY__'", JSON.stringify(sbKey));

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
