'use strict';
// Repair: move the Watchnight's roster rows onto the key the grid now reads.
//
// WHAT HAPPENED
// The Watchnight used to share 31 December with whatever else was on that
// date, under the service_date "Dec 31". Splitting it into its own column
// gave it "Dec 31 PM" so that in the years when 31 December is a Sunday the
// morning service and the Watchnight stop overwriting each other.
//
// Nothing moved the rows that already existed. In 2026 that left nineteen of
// them -- preacher, ushers, readers, communion assistants, altar guild,
// singers, pianist, LCD, PA, the service type -- on a key no column reads,
// so a fully rostered Watchnight showed up blank. The split caused this; the
// rows were correct before it and are correct now, just filed under the old
// name.
//
// WHICH ROWS MOVE, AND WHY ONLY THOSE
// Only years where 31 December is NOT a Sunday. In those years the Watchnight
// is the only service on the 31st, so rows on "Dec 31" can only be its own.
//
// When 31 December IS a Sunday -- 2028, 2034, 2045 -- "Dec 31" means the
// morning service and must stay exactly where it is. Moving it would hand
// the morning's rota to the Watchnight, which is the mistake this whole
// split existed to prevent.
//
// It also refuses to move a row onto a key that is already taken, rather
// than overwriting whatever is there.
//
// USAGE
//   node tools/rekey-watchnight-rows.js            # dry run
//   node tools/rekey-watchnight-rows.js --apply    # write
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
const BACKUP = path.join(__dirname, 'backups', 'watchnight-rekey.json');

const OLD = 'Dec 31';
const NEW = 'Dec 31 PM';

async function req(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
  return { ok: res.ok, status: res.status, text, json };
}

let failed = false;
const say = (ok, msg) => { if (!ok) failed = true; console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + msg); };

(async () => {
  console.log(APPLY ? 'APPLYING\n' : 'DRY RUN  (pass --apply to write)\n');

  const q = '/rest/v1/roster?select=id,year,month,role_id,service_date,value&service_date=eq.' + encodeURIComponent(OLD);
  const onOld = (await req(U + q, { headers: H })).json || [];
  const onNewRes = (await req(U + '/rest/v1/roster?select=id,year,role_id&service_date=eq.' + encodeURIComponent(NEW), { headers: H })).json || [];

  const taken = new Set(onNewRes.map(r => r.year + '|' + r.role_id));
  const byYear = {};
  onOld.forEach(r => { (byYear[r.year] = byYear[r.year] || []).push(r); });

  const move = [];
  console.log('rows filed under "' + OLD + '"');
  Object.keys(byYear).sort().forEach(y => {
    const rows = byYear[y];
    const dow = new Date(Date.UTC(+y, 11, 31)).getUTCDay();   // 0 = Sunday
    if (dow === 0) {
      console.log('  keep  ' + y + ': ' + rows.length + ' row(s) — 31 Dec ' + y +
        ' is a Sunday, so these are the morning service');
      return;
    }
    const clash = rows.filter(r => taken.has(r.year + '|' + r.role_id));
    if (clash.length) {
      say(false, y + ': ' + clash.length + ' row(s) would land on a key already in use (' +
        clash.map(c => c.role_id).join(', ') + ')');
      return;
    }
    console.log('  move  ' + y + ': ' + rows.length + ' row(s) — 31 Dec ' + y +
      ' is a ' + ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dow] +
      ', so the Watchnight is the only service that day');
    rows.forEach(r => {
      console.log('          ' + r.role_id.padEnd(18) + JSON.stringify(r.value));
      move.push(r);
    });
  });

  if (failed) { console.log('\nREFUSING — nothing written.'); process.exitCode = 1; return; }
  if (!move.length) { console.log('\nNothing to move.'); return; }

  console.log('\n' + move.length + ' row(s) would move to "' + NEW + '".');
  if (!APPLY) { console.log('\nDry run. Nothing was changed.'); return; }

  // Backed up after validation, merged rather than replaced so a second run
  // cannot shrink the record of the first.
  fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
  let prior = [];
  if (fs.existsSync(BACKUP)) {
    try { prior = JSON.parse(fs.readFileSync(BACKUP, 'utf8')).rows || []; }
    catch (e) { console.error('REFUSING: ' + path.basename(BACKUP) + ' is unreadable.'); process.exitCode = 1; return; }
  }
  const seen = new Set(prior.map(p => p.id));
  const merged = prior.concat(move.filter(r => !seen.has(r.id)).map(r => ({
    id: r.id, year: r.year, month: r.month, role_id: r.role_id,
    was: r.service_date, becomes: NEW, value: r.value
  })));
  fs.writeFileSync(BACKUP, JSON.stringify({
    taken: new Date().toISOString(),
    note: 'Roster rows moved from "' + OLD + '" to "' + NEW + '" so the Watchnight column could see them. ' +
          'To undo: PATCH each id\'s service_date back to `was`.',
    rows: merged
  }, null, 2));
  console.log('\nbacked up to ' + path.relative(ROOT, BACKUP) + '  (' + merged.length + ' row(s) recorded)');

  let moved = 0;
  for (const r of move) {
    const res = await req(U + '/rest/v1/roster?id=eq.' + r.id, {
      method: 'PATCH', headers: H, body: JSON.stringify({ service_date: NEW })
    });
    if (!res.ok) say(false, 'could not move ' + r.role_id + ': ' + res.text.slice(0, 120));
    else moved++;
  }
  console.log('moved ' + moved + '/' + move.length);

  // Read it back rather than trusting the writes.
  const after = (await req(U + '/rest/v1/roster?select=year,role_id,value&service_date=eq.' + encodeURIComponent(NEW), { headers: H })).json || [];
  const left = (await req(U + '/rest/v1/roster?select=year,role_id&service_date=eq.' + encodeURIComponent(OLD), { headers: H })).json || [];
  console.log('\n"' + NEW + '" now holds ' + after.length + ' row(s):');
  after.sort((a, b) => a.role_id.localeCompare(b.role_id))
       .forEach(r => console.log('    ' + r.year + '  ' + r.role_id.padEnd(18) + JSON.stringify(r.value)));
  console.log('\n"' + OLD + '" still holds ' + left.length + ' row(s)' +
    (left.length ? ' (' + [...new Set(left.map(r => r.year))].join(', ') + ' — Sunday years, left alone)' : ''));

  say(moved === move.length, moved === move.length ? 'every planned move landed' : 'some moves did not land');
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error('FAILED ' + e.message); process.exitCode = 1; });
