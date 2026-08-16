import { NextRequest, NextResponse } from 'next/server';
import { getSlidesAccessToken } from '../_lib/rosterCalendar';

export const runtime = 'nodejs';
// Drive does the conversion, and a large deck takes a while.
export const maxDuration = 60;

// Server-side port of server.gs's convertPptxToGoogleSlides() — the companion
// to /api/slide-page-ids, and the half that was missing.
//
// WHY THIS EXISTS. The Supabase bridge at the top of Index.html replaces
// `window.google` wholesale, and _GASRunner's prototype carries only the
// functions its `_B` map lists. convertPptxToGoogleSlides was not one of them,
// so on Vercel `google.script.run…convertPptxToGoogleSlides(url, name)` threw
// "not a function", _convertAndRenderPptx fell straight into its _fallback(),
// and EVERY pptx went through CloudConvert → PDF → pdf.js images instead of
// Google Slides. Nobody noticed because the fallback works.
//
// Worth remembering when reading any guard in that file: the test
//   typeof google !== 'undefined' && google.script && google.script.run
// is TRUE in both deployments. It does not tell Apps Script from Vercel, and it
// says nothing about whether the function being called exists.
//
// The response shape matches the GAS function exactly ({success,
// presentationId, embedUrl} or {error}) because the client hands both to the
// same _onConverted / _fallback handlers it already had. No call site changes.
//
// AUTH. Shares getSlidesAccessToken() with /api/slide-page-ids, which prefers a
// dedicated GOOGLE_SLIDES_REFRESH_TOKEN and falls back to the calendar one.
// Reading a presentation needs presentations.readonly; CREATING one needs a
// Drive write scope as well:
//   https://www.googleapis.com/auth/drive.file
// A token carrying only the read scope is reported as its own case below rather
// than as a generic failure, so whoever hits it is told exactly what to add.

const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const SLIDES_MIME = 'application/vnd.google-apps.presentation';

// Guard against being pointed at arbitrary hosts: this only ever converts a
// file this app itself uploaded to Supabase storage.
function isAllowedSource(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  return u.hostname.endsWith('.supabase.co') || u.hostname.endsWith('.supabase.in');
}

interface DriveFile {
  id?: string;
  error?: { message?: string; status?: string; code?: number };
}

function scopeProblem(status: number, body: string): boolean {
  return (
    status === 403 &&
    (body.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
      body.includes('insufficient authentication scopes') ||
      body.includes('insufficientPermissions'))
  );
}

const NEEDS_SCOPE =
  'The Google account is connected but has not granted permission to create ' +
  'files in Drive. Re-consent GOOGLE_SLIDES_REFRESH_TOKEN (or the shared ' +
  'GOOGLE_REFRESH_TOKEN) with https://www.googleapis.com/auth/drive.file added, ' +
  'then set it in the Vercel environment.';

export async function POST(req: NextRequest) {
  let payload: { url?: string; fileName?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const url = (payload.url || '').trim();
  const fileName = (payload.fileName || 'Presentation').trim();

  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });
  if (!isAllowedSource(url)) {
    return NextResponse.json(
      { error: 'Only files uploaded to this app can be converted.' },
      { status: 400 }
    );
  }

  let accessToken: string;
  try {
    accessToken = await getSlidesAccessToken();
  } catch {
    // Deliberately not echoing the underlying error: it names env vars, and
    // nothing in it helps the operator standing at the projector.
    return NextResponse.json(
      { error: 'The server is not configured to convert presentations (Google OAuth credentials missing).' },
      { status: 500 }
    );
  }

  // 1. Fetch the uploaded .pptx back out of Supabase storage.
  let fileBytes: ArrayBuffer;
  try {
    const src = await fetch(url);
    if (!src.ok) {
      return NextResponse.json(
        { error: 'Could not download file: HTTP ' + src.status },
        { status: 502 }
      );
    }
    fileBytes = await src.arrayBuffer();
  } catch {
    return NextResponse.json({ error: 'Could not download the presentation.' }, { status: 502 });
  }

  // 2. Upload to Drive asking for Google Slides as the target type — Drive
  //    performs the conversion itself, which is what the GAS version relied on
  //    (Drive.Files.insert with mimeType application/vnd.google-apps.presentation).
  const safeName = fileName.replace(/\.(pptx?|ppt)$/i, '') || 'Presentation';
  const boundary = 'lhc' + Date.now().toString(36);
  const meta = JSON.stringify({ name: safeName, mimeType: SLIDES_MIME });

  const head =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;

  const body = new Blob([head, fileBytes, tail], {
    type: `multipart/related; boundary=${boundary}`,
  });

  let created: DriveFile;
  try {
    const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      if (scopeProblem(res.status, text)) {
        return NextResponse.json({ error: NEEDS_SCOPE }, { status: 403 });
      }
      return NextResponse.json(
        { error: 'Google could not convert this presentation.' },
        { status: res.status === 401 ? 401 : 502 }
      );
    }
    created = JSON.parse(text) as DriveFile;
  } catch {
    return NextResponse.json({ error: 'Google could not convert this presentation.' }, { status: 502 });
  }

  if (!created.id) {
    return NextResponse.json({ error: 'Google did not return a presentation.' }, { status: 502 });
  }

  // 3. Make it readable by link, so the per-slide embeds render for the
  //    congregation's screen and not just for the account that owns it.
  //    A failure here is NOT fatal: the deck exists and the operator may still
  //    be signed in, so report success and let the embed fail visibly rather
  //    than throwing away a converted presentation.
  let shared = true;
  try {
    const perm = await fetch(`${DRIVE_FILES}/${created.id}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
    shared = perm.ok;
  } catch {
    shared = false;
  }

  return NextResponse.json({
    success: true,
    presentationId: created.id,
    embedUrl:
      'https://docs.google.com/presentation/d/' +
      created.id +
      '/embed?start=false&loop=false&delayms=3000',
    shared,
    slideCount: 0, // the client asks /api/slide-page-ids for the real page list
  });
}
