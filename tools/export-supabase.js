'use strict';
// Snapshot the Supabase tables to versioned JSON under backups/.
//
// WHY THIS EXISTS
// Supabase Pro includes daily backups kept for 7 days; Point-in-Time Recovery
// is a $100/month add-on, which is poor value for a handful of worship orders.
// This is the cheap middle: a full copy of the data, in a place the church
// controls, with git history as the retention policy. Every run overwrites the
// same files, so each commit is a restore point and git stores only the delta.
//
// It is deliberately independent of Supabase. A backup that lives inside the
// system it is backing up protects against approximately nothing.
//
// THE THING THAT MAKES THIS NOT A LIE
// PostgREST returns at most 1000 rows per request and says nothing about the
// rest. Measured on this project: a plain fetch of roster_changes returned
// 1000 of 7432 rows, and of roster 1000 of 1089 -- so the obvious one-request
// implementation would have committed a backup missing 87% of the change log
// while looking perfectly healthy. Every table is therefore paged, and the row
// count is checked against the server's own count before anything is written.
// A short read fails the run rather than overwriting a good snapshot with a
// truncated one.
//
// USAGE
//   node tools/export-supabase.js            # write backups/
//   node tools/export-supabase.js --check    # verify only, write nothing
//
// Credentials come from SUPABASE_URL / SUPABASE_ANON_KEY when set, and are
// otherwise read out of Index.html -- the same anon key the browser already
// receives, so there is no secret here to leak. Reading it from the source of
// truth means a rotated key does not quietly break the backups.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'backups');
const CHECK_ONLY = process.argv.includes('--check');
const PAGE = 1000;

// Every table the app reads or writes. Trim this list if a table stops being
// worth keeping -- roster_changes is an append-only audit log and is by far the
// largest and churniest, so it is the first candidate if the diffs get noisy.
const TABLES = [
  'orders', 'order_items', 'order_media_links',
  'songs', 'song_themes', 'song_layouts', 'song_recordings',
  'songbooks', 'songbook_entries',
  'roster', 'roster_changes', 'roster_names', 'roster_member_meta',
  'roster_unavailability', 'roster_name_merge_dismissals',
  'liturgy_items', 'liturgy_folders', 'liturgy_occ_folders', 'liturgy_occasion_data',
  'lectionary_readings', 'announcements', 'idea_inbox', 'pic_users',
  'projection_settings', 'projection_versions', 'projection_media',
  'lhc_backgrounds'
];

function credentials() {
  let url = process.env.SUPABASE_URL;
  let key = process.env.SUPABASE_ANON_KEY;
  if (url && key) return { url, key };
  const src = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
  const u = src.match(/LHC_SUPABASE_URL\s*=\s*'([^']+)'/);
  const k = src.match(/LHC_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/);
  if (!u || !k) {
    throw new Error('Could not find LHC_SUPABASE_URL / LHC_SUPABASE_ANON_KEY in Index.html, ' +
      'and SUPABASE_URL / SUPABASE_ANON_KEY are not set.');
  }
  return { url: u[1], key: k[1] };
}

// PostgREST reports the true total in Content-Range as "start-end/total".
function totalFrom(res) {
  const cr = res.headers.get('content-range') || '';
  const n = cr.split('/')[1];
  return n && n !== '*' ? parseInt(n, 10) : null;
}

async function fetchTable(url, key, table) {
  const headers = { apikey: key, Authorization: 'Bearer ' + key };

  const head = await fetch(`${url}/rest/v1/${table}?select=*`, {
    method: 'HEAD',
    headers: Object.assign({ Prefer: 'count=exact', Range: '0-0' }, headers)
  });
  if (!head.ok && head.status !== 206) {
    throw new Error(`${table}: count failed with HTTP ${head.status}`);
  }
  const expected = totalFrom(head);

  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
      headers: Object.assign({ Range: `${from}-${from + PAGE - 1}` }, headers)
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`${table}: page at ${from} failed with HTTP ${res.status}`);
    }
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error(`${table}: expected an array, got ${typeof page}`);
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  // The whole point. A short read means the snapshot would be a quiet lie.
  if (expected !== null && rows.length !== expected) {
    throw new Error(`${table}: read ${rows.length} rows but the server reports ${expected}. ` +
      'Refusing to write a truncated snapshot.');
  }
  return { rows, expected };
}

// Stable output, so a diff means the data changed and not that a key or a row
// moved. Rows sort by id when there is one; keys are always alphabetical.
function stable(rows) {
  const sorted = rows.slice().sort((a, b) => {
    const ka = a && a.id !== undefined ? String(a.id) : JSON.stringify(a);
    const kb = b && b.id !== undefined ? String(b.id) : JSON.stringify(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return JSON.stringify(sorted, (k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce((o, kk) => { o[kk] = v[kk]; return o; }, {});
    }
    return v;
  }, 2) + '\n';
}

(async function main() {
  const { url, key } = credentials();
  if (!CHECK_ONLY) fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = { takenAt: new Date().toISOString(), source: url, tables: {} };
  const problems = [];
  let written = 0;

  for (const table of TABLES) {
    try {
      const { rows } = await fetchTable(url, key, table);
      manifest.tables[table] = rows.length;
      if (!CHECK_ONLY) {
        const file = path.join(OUT_DIR, table + '.json');
        const next = stable(rows);
        const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
        if (prev !== next) { fs.writeFileSync(file, next); written++; }
      }
      console.log(`  ok    ${table} (${rows.length} rows)`);
    } catch (e) {
      problems.push(e.message);
      console.error(`  FAIL  ${e.message}`);
    }
  }

  if (problems.length) {
    console.error(`\n${problems.length} table(s) failed. Nothing was committed for those.`);
    process.exit(1);
  }

  if (!CHECK_ONLY) {
    // The manifest carries the timestamp, so it changes every run. Written last
    // and only when something else did, or every run would be a commit saying
    // nothing happened.
    if (written > 0) {
      fs.writeFileSync(path.join(OUT_DIR, '_manifest.json'),
        JSON.stringify(manifest, null, 2) + '\n');
    }
    console.log(`\n${written === 0 ? 'No changes' : written + ' table(s) changed'}.`);
  } else {
    console.log('\nAll tables read in full.');
  }
})().catch(e => { console.error(e); process.exit(1); });
