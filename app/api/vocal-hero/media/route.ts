import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/vocal-hero/supabaseClient';

const BUCKET = 'vocal-hero-media';
const MAX_FILE_BYTES = 500 * 1024 * 1024;

/** Creates a short-lived direct-to-Storage upload URL; the media bytes never pass through Vercel. */
export async function POST(request: Request) {
  try {
    const body = await request.json() as { songId?: string; fileName?: string; contentType?: string; size?: number };
    const size = Number(body.size);
    if (!body.songId || !body.fileName || !body.contentType || !Number.isFinite(size)) return NextResponse.json({ error: 'songId, fileName, contentType and size are required.' }, { status: 400 });
    if (!/^(audio|video)\//.test(body.contentType)) return NextResponse.json({ error: 'Only audio and video files can be used as backing tracks.' }, { status: 415 });
    if (size <= 0 || size > MAX_FILE_BYTES) return NextResponse.json({ error: 'Backing tracks must be between 1 byte and 500 MB.' }, { status: 413 });
    const safeName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100) || 'backing-track';
    const path = `songs/${body.songId}/${crypto.randomUUID()}-${safeName}`;
    const storage = getServiceClient().storage.from(BUCKET);
    const { data, error } = await storage.createSignedUploadUrl(path, { upsert: false });
    if (error || !data) throw new Error(error?.message || 'Could not prepare the backing-track upload.');
    const { data: publicData } = storage.getPublicUrl(path);
    return NextResponse.json({ bucket: BUCKET, path, token: data.token, publicUrl: publicData.publicUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to prepare media upload.' }, { status: 500 });
  }
}
