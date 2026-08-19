import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/vocal-hero/supabaseClient';

const BUCKET = 'vocal-hero-media';
// A report is a handful of numbers and device labels. Anything bigger is not
// a report.
const MAX_REPORT_BYTES = 16 * 1024;

/**
 * Stores a microphone diagnostic report where a developer can actually read
 * it. Every report of a dead microphone so far has arrived as "it doesn't
 * work" -- without the numbers that distinguish a refused permission from a
 * suspended context from an OS-muted track -- because the person seeing them
 * is holding a phone mid-rehearsal, not taking dictation. The app now sends
 * the numbers itself and shows a short code to say aloud instead.
 *
 * Same no-login posture as the media route: the payload is size-capped, must
 * parse as a JSON object, and lands under a server-minted name, so the worst
 * an abuser gets is writing small JSON files into a folder nobody serves as
 * HTML.
 */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_REPORT_BYTES) return NextResponse.json({ error: 'Report too large.' }, { status: 413 });
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Report must be JSON.' }, { status: 400 }); }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return NextResponse.json({ error: 'Report must be a JSON object.' }, { status: 400 });

    const code = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const path = `mic-reports/${code}.json`;
    const body = JSON.stringify({ ...parsed, receivedAt: new Date().toISOString() });
    const storage = getServiceClient().storage.from(BUCKET);
    const { error } = await storage.upload(path, new Blob([body], { type: 'application/json' }), { upsert: false, contentType: 'application/json' });
    if (error) throw new Error(error.message);
    // The same report also lands at a FIXED path. Relaying an 8-character
    // code turned out to be the step every field report stalled on; a
    // constant address means the developer fetches the newest report
    // unprompted. Best-effort -- the coded copy above already succeeded.
    await storage.upload('mic-reports/latest.json', new Blob([body], { type: 'application/json' }), { upsert: true, contentType: 'application/json' }).then(() => undefined, () => undefined);
    return NextResponse.json({ code });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to store the report.' }, { status: 500 });
  }
}
