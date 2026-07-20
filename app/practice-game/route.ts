import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Keep the legacy HTML file in /game as a rollback artefact, while moving
  // the Worship Prep iframe onto the modern React multiplayer experience.
  return NextResponse.redirect(new URL('/vocal-hero', request.url));
}
