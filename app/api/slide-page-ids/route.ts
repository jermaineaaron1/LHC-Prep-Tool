import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAccessToken } from '../_lib/rosterCalendar';

export const runtime = 'nodejs';

// Server-side port of server.gs's getSlidePageIds() — the Google Apps Script
// backend is unreachable from the Vercel deployment, so pasting a Google Slides
// link there fell back to a single un-navigable iframe: one embed for the whole
// deck, no per-slide URLs, no filmstrip, no arrow keys.
//
// The response shape matches the GAS function exactly ({success, pageIds, count}
// or {error}), because the client hands both to the same success/failure
// handlers it already had.
//
// AUTH — OAuth only, and this is not a preference. Probed against the live API:
// a request with an API key is refused with "API keys are not supported by this
// API. Expected OAuth2 access token or other authentication credentials that
// assert a principal." So this reuses the GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
// / GOOGLE_REFRESH_TOKEN trio that calendar sync already uses.
//
// That refresh token was minted for Calendar scopes. Until it is re-consented
// with a Slides-capable scope added —
//   https://www.googleapis.com/auth/presentations.readonly
//   (or drive.readonly, which the Slides API also accepts)
// — Google answers PERMISSION_DENIED / ACCESS_TOKEN_SCOPE_INSUFFICIENT, and that
// is reported as its own case rather than as a generic failure, so whoever hits
// it is told what to change. The route is correct and inert until then; the
// client falls back to the single iframe exactly as it does today.

const SLIDES_API = 'https://slides.googleapis.com/v1/presentations/';

// Same character set the client's own URL match accepts.
const PRESENTATION_ID = /^[a-zA-Z0-9-_]+$/;

interface SlidesResponse {
  slides?: { objectId?: string }[];
  error?: { message?: string; status?: string; code?: number };
}

export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get('id') || '').trim();

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (!PRESENTATION_ID.test(id)) {
    return NextResponse.json({ error: 'Not a valid presentation id' }, { status: 400 });
  }

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken();
  } catch {
    // Deliberately not echoing the underlying error: it names env vars, and
    // nothing in it helps the operator standing at the projector.
    return NextResponse.json(
      {
        error: 'The server is not configured to read Google Slides ' +
          '(Google OAuth credentials missing).',
      },
      { status: 500 }
    );
  }

  let res: Response;
  try {
    res = await fetch(SLIDES_API + encodeURIComponent(id) + '?fields=slides.objectId', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'Could not reach the Google Slides API: ' + (e instanceof Error ? e.message : String(e)) },
      { status: 502 }
    );
  }

  const data: SlidesResponse = await res.json().catch(() => ({} as SlidesResponse));

  if (!res.ok) {
    const reason = data.error?.status || '';
    const message = data.error?.message || 'HTTP ' + res.status;

    // The failures worth telling apart, because each has a different fix.
    if (res.status === 401 || res.status === 403) {
      if (/scope|insufficient/i.test(message) || reason === 'PERMISSION_DENIED') {
        return NextResponse.json(
          {
            error: 'The server\'s Google credentials cannot read Slides. Re-consent ' +
              'GOOGLE_REFRESH_TOKEN with https://www.googleapis.com/auth/presentations.readonly added.',
          },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: 'That presentation is not readable. Share it as "Anyone with the link", then try again.' },
        { status: 403 }
      );
    }
    if (res.status === 404) {
      return NextResponse.json(
        { error: 'No presentation found with that link.' },
        { status: 404 }
      );
    }
    return NextResponse.json({ error: 'Google Slides API: ' + message }, { status: 502 });
  }

  const pageIds = (data.slides || [])
    .map((s) => s.objectId)
    .filter((oid): oid is string => typeof oid === 'string' && oid.length > 0);

  // Matches the GAS function, which returns an error rather than an empty list.
  if (pageIds.length === 0) {
    return NextResponse.json({ error: 'No slides found' }, { status: 404 });
  }

  return NextResponse.json(
    { success: true, pageIds, count: pageIds.length },
    // A deck's page ids only change when its slides do, and a stale list costs
    // a re-import, not a wrong projection.
    { headers: { 'Cache-Control': 'private, max-age=300' } }
  );
}
