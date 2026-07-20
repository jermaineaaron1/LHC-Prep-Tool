import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Keep the legacy HTML file in /game as a rollback artefact, while moving
  // the Worship Prep iframe onto the modern React multiplayer experience.
  const response = NextResponse.redirect(new URL('/vocal-hero', request.url));
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
}
