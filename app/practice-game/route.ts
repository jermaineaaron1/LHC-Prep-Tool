import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Keep the legacy HTML file in /game as a rollback artefact, while moving
  // the Worship Prep iframe onto the modern React multiplayer experience.
  const destination = new URL(request.url);
  destination.pathname = '/vocal-hero';
  const response = NextResponse.redirect(destination);
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
}
