'use strict';
// One-off repair: remove the six ISO-dated roster rows on 4 and 11 Jan 2026.
//
// WHY
// service_date is free text, and the app normalises an ISO stamp into
// "Jan 4" on read, so these six rows named cells that a canonical "MMM D"
// row already held. The screen showed whichever Postgres returned last, and
// both were counted as duties.
//
// getAllForYear now collapses them on read, so the counting was already
// right. This removed the cause rather than compensating for it, which was
// possible only once somebody confirmed which of the two conflicting rows
// is correct: the canonical one, on both dates.
//
// ALREADY RUN, on 2026-10-08. Kept as the record of what was done and as
// the thing that refuses to do it twice. The rows it removed are in
// backups/iso-roster-rows-2026-01.json.
//
// WHAT IT WILL NOT DO
// It deletes by exact id, never by a pattern or a time window, and only
// after confirming that the canonical row for that same cell exists and
// holds the expected value. If any check fails, nothing is deleted and the
// backup is left alone. A cell whose only row is the ISO one would be data
// loss, so it refuses rather than guesses.
//
// USAGE
//   node tools/remove-iso-roster-rows.js            # dry run
//   node tools/remove-iso-roster-rows.js --apply    # delete
//
// Exit code 0 = did what it was asked, 1 = refused or something is wrong.

const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
const U = src.match(/LHC_SUPABASE_URL\s*=\s*'([^']+)'/)[1];
const K = src.match(/LHC_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/)[1];
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' };
const BACKUP = path.join(__dirname, 'backups', 'iso-roster-rows-2026-01.json');

// The six rows, by id, each with the canonical row that must already cover
// the same cell. Written out rather than discovered, so this can only ever
// touch these six and a surprise in the data stops it.
const PLAN = [
  { id: 7,  cell: 'Jan 4',  role: 'preacher',  expect: 'Rev. Benedict Muthusamy' },
  { id: 8,  cell: 'Jan 4',  role: 'liturgist', expect: 'Pastor Ashley Teter' },
  { id: 9,  cell: 'Jan 4',  role: 'pianist',   expect: 'Luke Yong' },
  { id: 10, cell: 'Jan 4',  role: 'singer1',   expect: 'Alison Phan' },
  { id: 11, cell: 'Jan 11', role: 'preacher',  expect: 'Pastor Ashley Teter' },
  { id: 12, cell: 'Jan 11', role: 'liturgist', expect: 'Aaron Jayaraj' },
];

async function get(query) {
  const r = await fetch(U + '/rest/v1/' + query, { headers: H });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(query + ' -> ' + JSON.stringify(j));
  return j;
}

/** How many rows match, asked of Postgres rather than counted here.
 *
 *  Counting the length of a select is wrong, and quietly so: PostgREST stops
 *  at 1000 rows without saying it has, and the roster is past that. The
 *  first version of this script compared two capped reads, saw 1000 before
 *  and 1000 after a six-row delete, and announced that the delete had
 *  failed when it had in fact succeeded. */
async function count(query) {
  const r = await fetch(U + '/rest/v1/' + query, {
    headers: Object.assign({}, H, { Prefer: 'count=exact', Range: '0-0' }),
  });
  return Number(String(r.headers.get('content-range')).split('/')[1]);
}

/** Save the rows about to be deleted — but never over a fuller file.
 *
 *  This used to write the backup BEFORE validating, and unconditionally. A
 *  later run, correctly refusing because the rows were already gone,
 *  overwrote six saved rows with zero and destroyed the restore path for a
 *  delete that had already happened. A backup a later run can empty is not
 *  a backup. */
function saveBackup(rows) {
  fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
  if (fs.existsSync(BACKUP)) {
    let held;
    try { held = (JSON.parse(fs.readFileSync(BACKUP, 'utf8')).rows || []).length; }
    catch (e) { held = Infinity; }   // unreadable: assume precious, never clobber
    if (held >= rows.length) {
      console.log('backup kept: ' + path.relative(ROOT, BACKUP) + ' already holds ' + held + ' row(s)');
      return;
    }
  }
  fs.writeFileSync(BACKUP, JSON.stringify({
    taken: new Date().toISOString(),
    note: 'Six ISO-dated roster rows on 4 and 11 Jan 2026, removed because a canonical "MMM D" row already held each cell. POST these objects back to /rest/v1/roster to restore them.',
    rows: rows,
  }, null, 2) + '\n');
  console.log('backup written: ' + path.relative(ROOT, BACKUP) + ' (' + rows.length + ' rows)');
}

(async () => {
  console.log(APPLY ? '*** APPLYING — rows will be deleted ***\n' : 'Dry run. Nothing will be deleted.\n');

  const ids = PLAN.map(p => p.id);
  const doomed = await get('roster?select=*&id=in.(' + ids.join(',') + ')&order=id');
  const canonical = await get('roster?select=*&month=eq.0&year=eq.2026&service_date=in.("Jan 4","Jan 11")&order=id');

  let safe = true;
  const fail = m => { safe = false; console.log('  REFUSE  ' + m); };

  console.log('the six rows to remove');
  if (doomed.length !== PLAN.length) fail('expected ' + PLAN.length + ' rows by id, found ' + doomed.length);
  for (const plan of PLAN) {
    const row = doomed.find(r => r.id === plan.id);
    if (!row) { fail('id ' + plan.id + ' is not there'); continue; }
    // It must still be the ISO row this plan was written for: if somebody
    // has edited it since, the plan no longer describes what is there.
    if (!/^\d{4}-\d{2}-\d{2}T/.test(row.service_date)) { fail('id ' + plan.id + ' is no longer ISO-dated: ' + JSON.stringify(row.service_date)); continue; }
    if (row.role_id !== plan.role) { fail('id ' + plan.id + ' is ' + row.role_id + ', not ' + plan.role); continue; }

    const keeper = canonical.find(r => r.service_date === plan.cell && r.role_id === plan.role);
    if (!keeper) { fail('id ' + plan.id + ' has no canonical row for ' + plan.cell + ' ' + plan.role + ' — deleting it would lose the cell'); continue; }
    if (String(keeper.value).trim() !== plan.expect) {
      fail('canonical ' + plan.cell + ' ' + plan.role + ' holds ' + JSON.stringify(keeper.value) + ', expected ' + JSON.stringify(plan.expect));
      continue;
    }
    const same = String(row.value).trim() === plan.expect;
    console.log('  ok    id ' + String(plan.id).padStart(3) + '  ' + plan.cell.padEnd(7) + plan.role.padEnd(11) +
      JSON.stringify(row.value).padEnd(28) + (same ? 'duplicate of' : 'superseded by') + ' id ' + keeper.id + ' ' + JSON.stringify(keeper.value));
  }

  // Nothing is written, saved or deleted until every check has passed.
  if (!safe) { console.log('\nChecks failed. Nothing deleted, backup untouched.'); process.exit(1); }

  console.log('');
  saveBackup(doomed);
  if (!APPLY) { console.log('\nAll checks pass. Re-run with --apply to delete.'); return; }

  const before = await count('roster?select=id');
  const response = await fetch(U + '/rest/v1/roster?id=in.(' + ids.join(',') + ')', {
    method: 'DELETE', headers: Object.assign({}, H, { Prefer: 'return=representation' }),
  });
  const deleted = await response.json();
  if (!Array.isArray(deleted)) throw new Error('delete failed: ' + JSON.stringify(deleted));
  console.log('\ndeleted ' + deleted.length + ' row(s): ' + deleted.map(r => r.id).join(', '));

  // Verify by side effect, not by the response: assert the rows are gone,
  // the keepers are untouched, and nothing else went with them.
  const after = await count('roster?select=id');
  const stillIso = await count('roster?select=id&service_date=like.*T*');
  const keepers = await get('roster?select=id,role_id,service_date,value&month=eq.0&year=eq.2026&service_date=in.("Jan 4","Jan 11")&order=id');
  console.log('\nverification');
  console.log('  rows ' + before + ' -> ' + after + '  (expected -' + PLAN.length + ')');
  console.log('  ISO-dated rows remaining: ' + stillIso);
  let ok = after === before - PLAN.length && stillIso === 0;
  for (const plan of PLAN) {
    const keeper = keepers.find(r => r.service_date === plan.cell && r.role_id === plan.role);
    const good = keeper && String(keeper.value).trim() === plan.expect;
    if (!good) ok = false;
    console.log('  ' + (good ? 'ok  ' : 'BAD ') + plan.cell.padEnd(7) + plan.role.padEnd(11) + (keeper ? JSON.stringify(keeper.value) : 'MISSING'));
  }
  console.log('\n' + (ok ? 'Done. The cells still read as they did; only the duplicates are gone.'
    : 'SOMETHING IS WRONG — restore from ' + path.relative(ROOT, BACKUP)));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });
