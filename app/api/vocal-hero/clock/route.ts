import { NextResponse } from 'next/server';

/**
 * A tiny no-cache clock endpoint. Clients use the midpoint of this request to
 * estimate the Vercel clock, so a phone's incorrectly set local clock cannot
 * shift a live round.
 */
export async function GET() {
  return NextResponse.json(
    { now: Date.now() },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
