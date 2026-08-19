import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/vocal-hero/supabaseClient';

/**
 * Close a round the host walked away from.
 *
 * A session only ever reached 'ended' by playing to completion, so switching
 * songs, going back to the library or closing the tab left it 'playing' for
 * ever. They accumulate: six appeared in a single day, and every one of them
 * shows up as a live room in any listing.
 *
 * Deliberately NOT vh_finalise_session. Finalising promotes the round's scores
 * into the high-score board, and a round the host abandoned part way through is
 * not a performance anybody set a record in -- a half-sung verse would sit above
 * an honest one. A round that actually finishes still finalises, on the path
 * that already does it.
 *
 * Written to be safe from sendBeacon, which fires during page teardown and
 * cannot be awaited: the update is idempotent and a lost call simply leaves the
 * row as it is today.
 */
export async function POST(request: Request) {
  try {
    const { sessionId } = await request.json() as { sessionId?: string };
    if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });

    const { data, error } = await getServiceClient()
      .from('vh_game_sessions')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', sessionId)
      .neq('status', 'ended')          // never re-stamp a round that finished properly
      .select('id')
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, closed: Boolean(data) });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : 'Unable to close the round.' }, { status: 500 });
  }
}
