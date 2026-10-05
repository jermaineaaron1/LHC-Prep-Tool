import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ROLE_LABELS: Record<string, string> = {
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

const MONTH_NUMS: Record<string, string> = {
  Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
  Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12',
};
const MONTH_IDX: Record<string, number> = {
  Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5,
  Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11,
};

function pad(n: number) { return n < 10 ? '0' + n : String(n); }

function dtstamp() {
  const now = new Date();
  return now.getUTCFullYear() + pad(now.getUTCMonth()+1) + pad(now.getUTCDate()) +
    'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
}

// A duty can be rostered to a GROUP rather than a person. "All Teachers"
// means every Sunday School teacher on file, and is how a Sunday School slot
// is filled when they all serve together.
//
// The feed matches a member by name, so without this a duty written that way
// reached NOBODY's calendar: not the group, because no one is called that,
// and not the individuals, because their names are not on the row. Measured
// 2026-10-02: one such row existed and was already past, so nothing was
// missing yet -- the next one would have failed the same silent way.
//
// The members of a group are whoever is registered under its category in
// roster_names, so this needs no list of its own and cannot go stale when
// somebody joins or leaves.
//
// Keep in step with ROSTER_GROUP_LABELS in Index.html, which credits the
// same duties in the serving-frequency view. The harness checks they match.
const GROUP_LABELS: Record<string, string> = { 'all teachers': 'sundayschool' };

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = (searchParams.get('name') || '').trim();

  if (!name) {
    return new NextResponse('Missing name parameter', { status: 400 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisYear = today.getFullYear();

  // Match names case-insensitively AND tolerant of stray/doubled whitespace
  // (the roster_names picker has had accidental near-duplicate entries like
  // "Alison Phan" vs "Alison  Phan" -- an exact ilike would silently return
  // zero rows for whichever spelling a person's actual duty rows don't use).
  const likePattern = name.replace(/\s+/g, '%');

  // Fetch this person's duties for this year and next (case-insensitive).
  //
  // Pending duties are left out. A name typed into a cell is pending until the
  // PIC ticks Confirm, and the app is explicit that those are two different
  // decisions -- putting someone's name down, and telling them they are on.
  // This feed was doing the telling regardless: 110 cells were pending when
  // this was written and every one of them was already in somebody's calendar,
  // so a person being quietly considered as a replacement had been notified
  // before anyone asked them.
  //
  // `not.is.true` rather than `eq.false` so a row whose flag is NULL still
  // appears. There are none today, but a row inserted without the column set
  // would otherwise vanish from the calendar silently -- and showing a duty
  // that might be tentative is a far better failure than hiding a real one.
  const { data, error } = await sb
    .from('roster')
    .select('role_id, service_date, month, year, value')
    .ilike('value', likePattern)
    .not('pending_confirmation', 'is', true)
    .gte('year', thisYear)
    .order('year')
    .order('month')
    .limit(500);

  if (error) {
    return new NextResponse('Database error', { status: 500 });
  }

  // ...and the duties rostered to a group this member belongs to.
  //
  // Deliberately a second read rather than a cleverer single one: the group
  // a person belongs to lives in roster_names, not on the duty row, so there
  // is nothing to join on. It costs one extra query for a member who is in no
  // group at all, and that query is skipped entirely in that case.
  const groupRows: Array<Record<string, unknown>> = [];
  const { data: myCategories } = await sb
    .from('roster_names')
    .select('category')
    .ilike('name', likePattern);
  const mine = new Set((myCategories || []).map((c: { category: string }) => c.category));
  const myLabels = Object.keys(GROUP_LABELS).filter((label) => mine.has(GROUP_LABELS[label]));
  for (const label of myLabels) {
    const { data: gRows } = await sb
      .from('roster')
      .select('role_id, service_date, month, year, value')
      .ilike('value', label)
      .not('pending_confirmation', 'is', true)
      .gte('year', thisYear)
      .limit(500);
    for (const r of gRows || []) groupRows.push(r);
  }

  const stamp = dtstamp();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Luther House Chapel//Worship Duty Roster//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:LHC Duties – ${name}`,
    `X-WR-CALDESC:Worship duty roster for ${name} at Luther House Chapel`,
    'X-WR-TIMEZONE:Asia/Kuala_Lumpur',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
    // Malaysia (Asia/Kuala_Lumpur) is UTC+8 year-round with no DST, so a single
    // STANDARD offset fully defines it. This pins service times to local time so
    // 9am shows as 9am regardless of the subscriber's or calendar's own timezone.
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Kuala_Lumpur',
    'X-LIC-LOCATION:Asia/Kuala_Lumpur',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:+08',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  const seen = new Set<string>();

  // The member's own rows come first on purpose. A duty they are named for
  // individually AND covered by a group is theirs specifically, and the UID
  // dedupe below keeps whichever is seen first.
  for (const row of [...(data || []), ...groupRows]) {
    const roleId = (row.role_id || '').toLowerCase();
    if (!roleId || roleId.startsWith('h_') || roleId === 'liturgical') continue;

    const dateStr: string = row.service_date || '';
    const parts = dateStr.split(' ');
    if (parts.length < 2) continue;

    const monthNum = MONTH_NUMS[parts[0]];
    const monthIdx = MONTH_IDX[parts[0]];
    if (monthNum === undefined || monthIdx === undefined) continue;

    const day = parseInt(parts[1], 10);
    if (isNaN(day)) continue;

    const rowYear: number = parseInt(row.year, 10) || thisYear;
    const serviceDate = new Date(rowYear, monthIdx, day);
    if (serviceDate < today) continue;

    const uid = `lhc-${roleId}-${rowYear}${monthNum}${pad(day)}`;
    if (seen.has(uid)) continue;
    seen.add(uid);

    const roleName = ROLE_LABELS[roleId] ?? (roleId.charAt(0).toUpperCase() + roleId.slice(1));
    // Worth saying: a duty that arrived through a group is shared, and the
    // member should know they are not the only one expected.
    const rowValue = String((row as { value?: string }).value || '').trim().toLowerCase();
    const sharedNote = GROUP_LABELS[rowValue]
      ? ` This duty is rostered to ${String((row as { value?: string }).value).trim()}, so it is shared.`
      : '';
    const dateNum = `${rowYear}${monthNum}${pad(day)}`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}@lutherhousechapel.org`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Kuala_Lumpur:${dateNum}T090000`,
      `DTEND;TZID=Asia/Kuala_Lumpur:${dateNum}T120000`,
      `SUMMARY:${roleName} – LHC Worship`,
      `DESCRIPTION:You are serving as ${roleName} at Luther House Chapel on ${dateStr} ${rowYear}.${sharedNote}`,
      'LOCATION:Luther House Chapel',
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      `DESCRIPTION:Reminder: ${roleName} duty tomorrow at LHC Worship`,
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');

  return new NextResponse(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="lhc-duties-${encodeURIComponent(name)}.ics"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
