import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../_lib/supabaseServiceClient';
import { getGoogleAccessToken, syncCell, type SyncCellKey } from '../_lib/rosterCalendar';

export const runtime = 'nodejs';

// Instant push: called fire-and-forget by the roster editor right after a
// successful save (Index.html's RosterEngine.saveChanges). Never lets a
// Calendar-side failure surface as an HTTP error the caller has to handle
// specially -- the Supabase roster write has already committed by the time
// this runs, so a failure here just means "the daily reconciliation will
// catch it," not "the save failed."
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const cellsRaw = Array.isArray(body?.cells) ? body.cells : [];
  if (!cellsRaw.length) return NextResponse.json({ results: [] });

  const seen = new Set<string>();
  const cells: SyncCellKey[] = [];
  for (const c of cellsRaw) {
    if (!c || typeof c.roleId !== 'string' || typeof c.date !== 'string' || typeof c.month !== 'number' || typeof c.year !== 'number') continue;
    const key = `${c.year}-${c.month}-${c.roleId}-${c.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push({ roleId: c.roleId, serviceDate: c.date, month: c.month, year: c.year });
  }
  if (!cells.length) return NextResponse.json({ results: [] });

  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) {
    return NextResponse.json({ error: 'GOOGLE_CALENDAR_ID is not configured' }, { status: 500 });
  }

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken();
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }

  const sb = getServiceClient();
  const results = [];
  // Sequential, not parallel -- expected volume is a handful of cells per
  // save, well within Google's rate limits, and sequential keeps error
  // handling/logging simple.
  for (const cell of cells) {
    results.push(await syncCell(sb, accessToken, calendarId, cell));
  }

  return NextResponse.json({ results });
}
