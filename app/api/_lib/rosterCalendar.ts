import type { SupabaseClient } from '@supabase/supabase-js';

// Shared logic for the roster's Google Calendar integration. Used by both the
// ICS subscribe feed (app/api/calendar/route.ts) and the push-sync routes
// (app/api/calendar-sync, app/api/calendar-reconcile), so duty labels, date
// parsing, and event wording stay identical no matter which path a member
// ends up on.

export const ROLE_LABELS: Record<string, string> = {
  preacher: 'Preacher', liturgist: 'Liturgist',
  usher1: 'Usher 1', usher2: 'Usher 2',
  reader1: 'Reader 1', reader2: 'Reader 2',
  reading1: '1st Reading', psalm: 'Psalm', reading2: '2nd Reading', gospel: 'Gospel',
  communion1: 'Communion Assistant 1', communion2: 'Communion Assistant 2', communion3: 'Communion Assistant 3',
  altar1: 'Altar Guild 1', altar2: 'Altar Guild 2',
  pianist: 'Pianist', guitarist: 'Guitarist', bassist: 'Bassist', drummer: 'Drummer',
  singer1: 'Singer 1', singer2: 'Singer 2', singer3: 'Singer 3', singer4: 'Singer 4',
  lcd: 'LCD Operator', streaming: 'Live Streaming', pa: 'PA System',
  ssteacher1: 'Sunday School Teacher 1', ssteacher2: 'Sunday School Teacher 2', ssteacher3: 'Sunday School Teacher 3',
  flowerarrangement: 'Flower Arrangement',
};

export const MONTH_NUMS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};
export const MONTH_IDX: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function pad(n: number) { return n < 10 ? '0' + n : String(n); }

// roster.value uses several different sentinels for "nobody assigned yet",
// not just an empty string -- __BLANK__ is set when a PIC explicitly clears
// a cell (Index.html's saveChanges), '-' and 'TBD' show up elsewhere in the
// app. Any code reading roster.value directly must treat all of these the
// same way.
export function isBlankValue(v: string | null | undefined): boolean {
  const s = (v || '').trim();
  return s === '' || s === '-' || s === 'TBD' || s === '__BLANK__';
}

export function isSkippedRole(roleId: string): boolean {
  const r = (roleId || '').toLowerCase();
  return !r || r.startsWith('h_') || r === 'liturgical';
}

export function roleLabel(roleId: string): string {
  const r = (roleId || '').toLowerCase();
  return ROLE_LABELS[r] ?? (r.charAt(0).toUpperCase() + r.slice(1));
}

export interface ParsedServiceDate {
  monthNum: string;
  monthIdx: number;
  day: number;
  jsDate: Date;
}

// "Mon D" (e.g. "Feb 18") -- matches app/api/calendar/route.ts's date format
// exactly, since roster.service_date is stored this way.
export function parseServiceDate(dateStr: string, year: number): ParsedServiceDate | null {
  const parts = (dateStr || '').split(' ');
  if (parts.length < 2) return null;
  const monthNum = MONTH_NUMS[parts[0]];
  const monthIdx = MONTH_IDX[parts[0]];
  if (monthNum === undefined || monthIdx === undefined) return null;
  const day = parseInt(parts[1], 10);
  if (isNaN(day)) return null;
  return { monthNum, monthIdx, day, jsDate: new Date(year, monthIdx, day) };
}

export interface EventFields {
  summary: string;
  description: string;
  location: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

// Same 9am-12pm Asia/Kuala_Lumpur slot and wording as the ICS feed's VEVENTs,
// so a member sees identical event text whichever path (ICS or push) they're on.
export function buildEventFields(roleId: string, dateStr: string, year: number): EventFields | null {
  const parsed = parseServiceDate(dateStr, year);
  if (!parsed) return null;
  const { monthNum, day } = parsed;
  const roleName = roleLabel(roleId);
  const dateNum = `${year}-${monthNum}-${pad(day)}`;
  return {
    summary: `${roleName} – LHC Worship`,
    description: `You are serving as ${roleName} at Luther House Chapel on ${dateStr} ${year}.`,
    location: 'Luther House Chapel',
    start: { dateTime: `${dateNum}T09:00:00`, timeZone: 'Asia/Kuala_Lumpur' },
    end: { dateTime: `${dateNum}T12:00:00`, timeZone: 'Asia/Kuala_Lumpur' },
  };
}

// ============================================================
// Google OAuth + Calendar REST helpers (no `googleapis` dependency -- the
// whole integration is 4 REST calls: token refresh, events.insert,
// events.patch, events.delete).
// ============================================================

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getGoogleAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 5000) return cachedToken.token;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Calendar credentials are not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN)');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error('Google token refresh failed: ' + (json.error_description || json.error || res.status));
  }
  cachedToken = { token: json.access_token, expiresAt: now + (json.expires_in || 3600) * 1000 };
  return json.access_token;
}

export class GoogleApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function googleApiFetch(method: string, path: string, accessToken: string, body?: unknown) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  let json: any = null;
  try { json = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const msg = (json && json.error && (json.error.message || JSON.stringify(json.error))) || `HTTP ${res.status}`;
    throw new GoogleApiError(`Google Calendar API ${method} ${path} failed: ${msg}`, res.status);
  }
  return json;
}

// Whitespace/case-tolerant match against roster_member_meta, reusing the
// exact pattern already proven in app/api/calendar/route.ts.
export async function lookupMember(sb: SupabaseClient, name: string): Promise<{ found: boolean; email: string | null }> {
  const pattern = (name || '').trim().replace(/\s+/g, '%');
  if (!pattern) return { found: false, email: null };
  const { data, error } = await sb.from('roster_member_meta').select('email').ilike('name', pattern).limit(1).maybeSingle();
  if (error || !data) return { found: false, email: null };
  return { found: true, email: data.email || null };
}

export interface SyncCellKey {
  roleId: string;
  serviceDate: string;
  month: number;
  year: number;
}

export interface SyncCellResult {
  key: string;
  action: 'skipped_role' | 'noop' | 'created' | 'updated' | 'deleted' | 'error';
  syncStatus?: 'synced' | 'no_email' | 'name_not_found';
  error?: string;
}

async function upsertSyncRow(sb: SupabaseClient, cellKey: SyncCellKey, fields: Record<string, unknown>) {
  await sb.from('calendar_sync_events').upsert(
    {
      role_id: cellKey.roleId,
      service_date: cellKey.serviceDate,
      month: cellKey.month,
      year: cellKey.year,
      updated_at: new Date().toISOString(),
      ...fields,
    },
    { onConflict: 'month,year,role_id,service_date' }
  );
}

// The one idempotent function both /api/calendar-sync and
// /api/calendar-reconcile call. Always re-reads roster.value as ground
// truth (never trusts the caller's payload for what should be written);
// every error is caught and recorded on the mapping row rather than thrown,
// so one bad cell never aborts a batch.
export async function syncCell(
  sb: SupabaseClient,
  accessToken: string,
  calendarId: string,
  cellKey: SyncCellKey
): Promise<SyncCellResult> {
  const { roleId, serviceDate, month, year } = cellKey;
  const keyStr = `${year}-${month}-${roleId}-${serviceDate}`;

  if (isSkippedRole(roleId)) return { key: keyStr, action: 'skipped_role' };

  try {
    const { data: rosterRow } = await sb
      .from('roster')
      .select('value')
      .eq('month', month).eq('year', year).eq('role_id', roleId).eq('service_date', serviceDate)
      .maybeSingle();

    const { data: mapRow } = await sb
      .from('calendar_sync_events')
      .select('*')
      .eq('month', month).eq('year', year).eq('role_id', roleId).eq('service_date', serviceDate)
      .maybeSingle();

    if (!rosterRow && !mapRow) return { key: keyStr, action: 'noop' };

    const rosterValue = rosterRow ? rosterRow.value || '' : '';

    if (isBlankValue(rosterValue)) {
      if (mapRow && mapRow.google_event_id) {
        try {
          await googleApiFetch(
            'DELETE',
            `/calendars/${encodeURIComponent(calendarId)}/events/${mapRow.google_event_id}?sendUpdates=all`,
            accessToken
          );
        } catch (e) {
          // Already gone on Google's side -- fine, still clean up our row.
          if (!(e instanceof GoogleApiError && (e.status === 404 || e.status === 410))) throw e;
        }
      }
      if (mapRow) {
        await sb.from('calendar_sync_events').delete().eq('id', mapRow.id);
        return { key: keyStr, action: 'deleted' };
      }
      return { key: keyStr, action: 'noop' };
    }

    const member = await lookupMember(sb, rosterValue);
    const email = member.email;
    const syncStatus = email ? 'synced' : member.found ? 'no_email' : 'name_not_found';

    const unchanged =
      mapRow &&
      mapRow.google_event_id &&
      mapRow.assigned_name === rosterValue &&
      (mapRow.attendee_email || null) === (email || null) &&
      mapRow.sync_status === syncStatus;

    if (unchanged) return { key: keyStr, action: 'noop', syncStatus };

    const fields = buildEventFields(roleId, serviceDate, year);
    if (!fields) {
      await upsertSyncRow(sb, cellKey, {
        sync_status: 'error',
        last_error: 'Could not parse service_date',
        last_synced_at: new Date().toISOString(),
      });
      return { key: keyStr, action: 'error', error: 'Could not parse service_date' };
    }

    const attendees = email ? [{ email }] : [];
    const reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: 24 * 60 }] };
    const eventBody = {
      summary: fields.summary,
      description: fields.description,
      location: fields.location,
      start: fields.start,
      end: fields.end,
      attendees,
      reminders,
    };

    let eventId: string | undefined = mapRow?.google_event_id || undefined;
    let action: SyncCellResult['action'];

    if (!eventId) {
      const created = await googleApiFetch(
        'POST',
        `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
        accessToken,
        { ...eventBody, status: 'confirmed' }
      );
      eventId = created.id;
      action = 'created';
    } else {
      await googleApiFetch(
        'PATCH',
        `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`,
        accessToken,
        eventBody
      );
      action = 'updated';
    }

    await upsertSyncRow(sb, cellKey, {
      google_event_id: eventId,
      assigned_name: rosterValue,
      attendee_email: email,
      sync_status: syncStatus,
      last_error: null,
      last_synced_at: new Date().toISOString(),
    });

    return { key: keyStr, action, syncStatus };
  } catch (e: any) {
    const msg = e && e.message ? e.message : String(e);
    try {
      await upsertSyncRow(sb, cellKey, { sync_status: 'error', last_error: msg, last_synced_at: new Date().toISOString() });
    } catch { /* best-effort error logging */ }
    return { key: keyStr, action: 'error', error: msg };
  }
}
