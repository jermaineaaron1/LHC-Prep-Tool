import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../_lib/supabaseServiceClient';
import { getGoogleAccessToken, syncCell, isBlankValue, type SyncCellKey } from '../_lib/rosterCalendar';

export const runtime = 'nodejs';

interface ReconcileSummary {
  totalChecked: number;
  created: number;
  updated: number;
  deleted: number;
  skippedRole: number;
  skippedNoEmail: number;
  skippedNameNotFound: number;
  noop: number;
  errors: number;
  errorDetails: { key: string; error: string }[];
}

// Daily-cron + manual "Sync Now" backstop. Walks every future roster cell
// plus every existing mapping row and re-runs syncCell on the union, which
// self-heals: a save the instant push missed (closed tab, network blip), a
// bulk write that bypassed the normal save path entirely (e.g.
// cascadeBlankName), or an email added to a member's profile after the fact.
async function runReconciliation(): Promise<ReconcileSummary> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) throw new Error('GOOGLE_CALENDAR_ID is not configured');

  const accessToken = await getGoogleAccessToken();
  const sb = getServiceClient();
  const thisYear = new Date().getFullYear();

  const { data: rosterRows, error: rosterErr } = await sb
    .from('roster')
    .select('role_id, service_date, month, year, value')
    .gte('year', thisYear)
    .limit(5000);
  if (rosterErr) throw new Error('Failed to read roster: ' + rosterErr.message);

  const { data: mapRows, error: mapErr } = await sb
    .from('calendar_sync_events')
    .select('role_id, service_date, month, year')
    .gte('year', thisYear)
    .limit(5000);
  if (mapErr) throw new Error('Failed to read calendar_sync_events: ' + mapErr.message);

  type Row = { role_id: string; service_date: string; month: number; year: number };
  const keyOf = (r: Row) => `${r.year}-${r.month}-${r.role_id}-${r.service_date}`;

  // Union of "has a real assignment today" and "has an existing mapping
  // row" -- the latter half is what lets a blanked/deleted cell get its
  // orphaned Google event cleaned up (syncCell's own blank-value branch
  // handles the deletion once it re-reads the current, now-blank roster row).
  const cellMap = new Map<string, SyncCellKey>();
  (rosterRows || []).forEach((r) => {
    if (isBlankValue(r.value)) return;
    cellMap.set(keyOf(r), { roleId: r.role_id, serviceDate: r.service_date, month: r.month, year: r.year });
  });
  (mapRows || []).forEach((r) => {
    const key = keyOf(r);
    if (!cellMap.has(key)) cellMap.set(key, { roleId: r.role_id, serviceDate: r.service_date, month: r.month, year: r.year });
  });

  const summary: ReconcileSummary = {
    totalChecked: cellMap.size,
    created: 0, updated: 0, deleted: 0,
    skippedRole: 0, skippedNoEmail: 0, skippedNameNotFound: 0, noop: 0, errors: 0,
    errorDetails: [],
  };

  for (const cell of cellMap.values()) {
    const result = await syncCell(sb, accessToken, calendarId, cell);
    switch (result.action) {
      case 'created': summary.created++; break;
      case 'updated': summary.updated++; break;
      case 'deleted': summary.deleted++; break;
      case 'skipped_role': summary.skippedRole++; break;
      case 'noop': summary.noop++; break;
      case 'error':
        summary.errors++;
        summary.errorDetails.push({ key: result.key, error: result.error || 'unknown error' });
        break;
    }
    if (result.syncStatus === 'no_email') summary.skippedNoEmail++;
    if (result.syncStatus === 'name_not_found') summary.skippedNameNotFound++;
  }

  return summary;
}

// Vercel Cron entry point. Guarded by CRON_SECRET when that env var is set
// (Vercel's documented pattern -- it auto-attaches this header when it
// invokes cron paths).
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  try {
    const summary = await runReconciliation();
    console.log('[calendar-reconcile:cron]', JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (e: any) {
    const message = e && e.message ? e.message : String(e);
    console.error('[calendar-reconcile:cron] failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Manual "Sync Now" trigger from the Enablers Calendar tab -- open, no
// secret, matching the rest of this app's routes.
export async function POST() {
  try {
    const summary = await runReconciliation();
    return NextResponse.json(summary);
  } catch (e: any) {
    const message = e && e.message ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
