// POST /api/score
// body: { playerId, sessionId, delta }
// Calls vh_increment_player_score RPC — keeps service key server-side.
//
// There is no login here, and adding one would mean an account for every
// visiting singer, which is the opposite of scanning a QR code and singing. So
// the route cannot ask WHO is calling. What it can do is refuse anything that
// does not correspond to a real round in progress: the player must exist, must
// belong to the session named, that session must actually be playing, and the
// points must be a plausible number. That turns "set anyone's score to
// anything, at any time" into "add a believable amount to your own score while
// your own round is running" — worth far less to a mischief-maker, and it
// costs one query.

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/vocal-hero/supabaseClient';

/** Above any real round. A whole five-minute song is a few thousand points,
 * and a flush can legitimately carry a backlog if the network dropped, so this
 * sits well clear of honest play while still refusing an absurd number. */
const MAX_DELTA = 20000;

/** Both ids are uuid columns. Postgres rejects anything else with a type error
 * of its own, which arrived as a 500 carrying the database's message — an
 * internal detail the caller has no business seeing, and worse, a status the
 * client treats as worth retrying, so a corrupt id would be resent for ever.
 * A malformed id is simply not a player. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const { playerId, sessionId, delta } = await req.json();

    if (typeof playerId !== 'string' || typeof sessionId !== 'string' || !playerId || !sessionId) {
      return NextResponse.json({ error: 'playerId, sessionId, delta required' }, { status: 400 });
    }
    if (typeof delta !== 'number' || !Number.isFinite(delta)) {
      return NextResponse.json({ error: 'delta must be a number' }, { status: 400 });
    }
    if (delta <= 0) return NextResponse.json({ ok: true }); // nothing to do
    if (delta > MAX_DELTA) {
      return NextResponse.json({ error: 'delta is larger than any real round' }, { status: 400 });
    }
    if (!UUID.test(playerId) || !UUID.test(sessionId)) {
      return NextResponse.json({ error: 'No such player in that session' }, { status: 403 });
    }

    const sb = getServiceClient();

    // One query settles both questions: is this a real player, and is it
    // theirs to score? A player id from another room, or from a round that has
    // finished, gets nothing.
    const { data: player, error: lookupError } = await sb
      .from('vh_session_players')
      .select('id, session_id, vh_game_sessions(status)')
      .eq('id', playerId)
      .maybeSingle();

    if (lookupError) {
      // The caller gets no detail about the database; the log keeps it.
      console.error('score lookup:', lookupError.message);
      return NextResponse.json({ error: 'Could not verify that player' }, { status: 500 });
    }
    if (!player || player.session_id !== sessionId) {
      return NextResponse.json({ error: 'No such player in that session' }, { status: 403 });
    }

    const joined = player.vh_game_sessions as unknown as { status?: string } | { status?: string }[] | null;
    const status = Array.isArray(joined) ? joined[0]?.status : joined?.status;
    if (status && status !== 'playing') {
      return NextResponse.json({ error: 'That round is not in progress' }, { status: 409 });
    }

    // Increment score
    const { error: rpcErr } = await sb.rpc('vh_increment_player_score', {
      p_id: playerId,
      delta,
    });
    if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

    // Append score event for real-time leaderboard
    const { error: evtErr } = await sb.from('vh_score_events').insert({
      session_id: sessionId,
      player_id:  playerId,
      delta,
    });
    if (evtErr) console.error('score_event insert:', evtErr.message);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
