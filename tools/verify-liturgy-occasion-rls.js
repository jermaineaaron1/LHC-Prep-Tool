'use strict';
// Checks that liturgy_occasion_data is still readable AND writable through the
// anon key -- the key the app actually uses.
//
// Run it before and after migrations/2026-10-05_fix_liturgy_occasion_data_rls.sql.
// Both runs must look the same. The failure this guards against is silent:
// enabling RLS without a policy makes Supabase deny everything by default, so
// the table comes back EMPTY rather than erroring, and the Liturgy planning
// notes simply vanish from the screen with nothing in the console.
//
// The write test is a NO-OP: it writes each row's existing data back to itself
// unchanged. That proves the policy permits writes without altering a single
// note.
//
//   node tools/verify-liturgy-occasion-rls.js
//
// Exit code 0 = readable and writable, 1 = something is wrong.

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const U = src.match(/LHC_SUPABASE_URL\s*=\s*'([^']+)'/)[1];
const K = src.match(/LHC_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/)[1];
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' };
const TABLE = 'liturgy_occasion_data';

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label + (detail ? '  -- ' + detail : ''));
}

(async () => {
  console.log('reading ' + TABLE + ' as the app does\n');

  const r = await fetch(U + '/rest/v1/' + TABLE + '?select=*', { headers: H });
  const rows = await r.json();

  check('the read succeeds', r.ok, 'HTTP ' + r.status);
  if (!Array.isArray(rows)) {
    console.log('\n  the server said: ' + JSON.stringify(rows).slice(0, 220));
    console.log('\n' + '='.repeat(60));
    console.log('NOT READABLE. If RLS was just enabled, the policy did not apply --');
    console.log('re-run migrations/2026-10-05_fix_liturgy_occasion_data_rls.sql.');
    process.exit(1);
  }

  check('rows come back', rows.length > 0,
    rows.length + ' occasion(s): ' + rows.map(x => x.occasion_id).join(', '));
  if (rows.length === 0) {
    console.log('\n' + '='.repeat(60));
    console.log('EMPTY. This is the silent failure: RLS is on with no policy that');
    console.log('lets anon read. The Liturgy planning notes will look wiped in the');
    console.log('app. Re-run the migration.');
    process.exit(1);
  }

  const withNotes = rows.filter(x => JSON.stringify(x.data || {}).length > 40);
  check('the notes are still in there', withNotes.length > 0,
    withNotes.length + ' occasion(s) carry planning data');

  // A no-op write: put each row's own data straight back.
  console.log('\nwriting each row back to itself, unchanged');
  let wrote = 0, blocked = 0, lastErr = '';
  for (const row of rows) {
    const res = await fetch(U + '/rest/v1/' + TABLE + '?occasion_id=eq.' + encodeURIComponent(row.occasion_id), {
      method: 'PATCH', headers: H, body: JSON.stringify({ data: row.data })
    });
    if (res.ok) wrote++;
    else { blocked++; lastErr = (await res.text()).slice(0, 120).replace(/\s+/g, ' '); }
  }
  check('every row accepts a write', blocked === 0,
    wrote + ' written, ' + blocked + ' refused' + (lastErr ? ' (' + lastErr + ')' : ''));

  // And nothing actually changed.
  const after = await (await fetch(U + '/rest/v1/' + TABLE + '?select=*', { headers: H })).json();
  const same = Array.isArray(after) && after.length === rows.length &&
    rows.every(b => {
      const a = after.find(x => x.occasion_id === b.occasion_id);
      return a && JSON.stringify(a.data) === JSON.stringify(b.data);
    });
  check('and nothing was altered by the check', same);

  console.log('\n' + '='.repeat(60));
  const pass = results.filter(Boolean).length;
  console.log(pass + '/' + results.length + ' checks passed');
  if (pass === results.length) {
    console.log('The Liturgy planning notes are readable and writable by the app.');
  }
  process.exit(pass === results.length ? 0 : 1);
})();
