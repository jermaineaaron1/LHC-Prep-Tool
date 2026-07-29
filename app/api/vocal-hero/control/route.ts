import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/vocal-hero/supabaseClient';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sessionId?: string; paused?: boolean; pauseDurationMs?: number };
    if (!body.sessionId || typeof body.paused !== 'boolean') return NextResponse.json({ error: 'sessionId and paused are required.' }, { status: 400 });
    const supabase = getServiceClient();
    const { data: current, error: readError } = await supabase.from('vh_game_sessions').select('*').eq('id', body.sessionId).single();
    if (readError || !current) return NextResponse.json({ error: readError?.message ?? 'Session not found.' }, { status: 404 });
    const fields: Record<string, unknown> = { paused: body.paused };
    if (!body.paused && current.playback_starts_at) {
      const shift = Math.max(0, Math.min(Number(body.pauseDurationMs) || 0, 24 * 60 * 60 * 1000));
      fields.playback_starts_at = new Date(new Date(current.playback_starts_at).getTime() + shift).toISOString();
    }
    const { data, error } = await supabase.from('vh_game_sessions').update(fields).eq('id', body.sessionId).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : 'Unable to update playback.' }, { status: 500 });
  }
}
