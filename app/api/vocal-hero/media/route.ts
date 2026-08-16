import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/vocal-hero/supabaseClient';

const BUCKET = 'vocal-hero-media';
const MAX_FILE_BYTES = 500 * 1024 * 1024;

/** The songId becomes part of the storage path as well as a lookup key, so a
 * malformed one is refused before it can nest junk under arbitrary path
 * segments or reach Postgres as a uuid type error — the same lesson the score
 * route learned. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Creates a short-lived direct-to-Storage upload URL; the media bytes never
 * pass through Vercel.
 *
 * There is no login in this app, so the route cannot ask WHO is uploading.
 * What it can do is refuse anything that does not correspond to a real song:
 * the id must be well formed and must name a row that actually exists in the
 * library. That turns "anyone can mint 500 MB upload URLs under any path, for
 * ever" into "an upload must attach to an existing song" — friction rather
 * than auth, stated plainly, since song ids are readable by anyone using the
 * app. The gain is that malformed floods and junk paths are refused outright
 * and every stored file sits under an enumerable song.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json() as { songId?: string; fileName?: string; contentType?: string; size?: number };
    const size = Number(body.size);
    if (!body.songId || !body.fileName || !body.contentType || !Number.isFinite(size)) return NextResponse.json({ error: 'songId, fileName, contentType and size are required.' }, { status: 400 });
    if (!/^(audio|video)\//.test(body.contentType)) return NextResponse.json({ error: 'Only audio and video files can be used as backing tracks.' }, { status: 415 });
    if (size <= 0 || size > MAX_FILE_BYTES) return NextResponse.json({ error: 'Backing tracks must be between 1 byte and 500 MB.' }, { status: 413 });
    if (!UUID.test(body.songId)) return NextResponse.json({ error: 'No such song.' }, { status: 404 });

    const sb = getServiceClient();
    const { data: song, error: lookupError } = await sb.from('vh_songs').select('id').eq('id', body.songId).maybeSingle();
    if (lookupError) {
      // The caller gets no database detail; the log keeps it.
      console.error('media upload song lookup:', lookupError.message);
      return NextResponse.json({ error: 'Could not verify that song.' }, { status: 500 });
    }
    if (!song) return NextResponse.json({ error: 'No such song.' }, { status: 404 });

    const safeName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100) || 'backing-track';
    const path = `songs/${body.songId}/${crypto.randomUUID()}-${safeName}`;
    const storage = sb.storage.from(BUCKET);
    const { data, error } = await storage.createSignedUploadUrl(path, { upsert: false });
    if (error || !data) throw new Error(error?.message || 'Could not prepare the backing-track upload.');
    const { data: publicData } = storage.getPublicUrl(path);
    return NextResponse.json({ bucket: BUCKET, path, token: data.token, publicUrl: publicData.publicUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to prepare media upload.' }, { status: 500 });
  }
}
