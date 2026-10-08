'use strict';
// Regression harness for SBQ_READINGS -- the Liturgy page's readings layer.
//
// WHY THIS EXISTS
// The Liturgy dashboard used to read lectionary_readings, which held ONE row.
// The church's readings -- 142 of them across 43 service dates -- were in the
// roster the whole time, under role ids reading1/psalm/reading2/gospel. So the
// page showed four empty cards whatever date you picked, and "the roster and
// the worship order pull their readings from here" could not be true, because
// "here" was a table nobody wrote to.
//
// SBQ_READINGS makes the roster the one store and the Liturgy page its front
// end. That means converting between two date formats on every read and write:
//
//   the roster   service_date "Oct 4" (free text) + a separate year column
//   this page    'YYYY-MM-DD'
//
// WHAT THIS CHECKS
// The conversion both ways, including the forms that already exist in the live
// data ("Mar 1" unpadded, and older rows that stored ISO directly).
//
// And then the thing most likely to go wrong silently: getRange queries by
// YEAR, not by date, because service_date is free text and cannot be compared
// in SQL. The window is narrowed in JavaScript afterwards. If that filter is
// dropped or inverted, the page shows readings from the wrong dates -- which
// looks like data, not like a bug, and is how a reader ends up announcing last
// month's Gospel.
//
// Writes are checked too: a reading written here IS a roster edit, so it has to
// land on the right conflict key and appear in roster_changes beside every
// other edit -- but a change log that fails must never lose the reading.
//
// USAGE
//   node tools/readings-roster-harness.js                 # ../Index.html
//   node tools/readings-roster-harness.js path/to/file.html
//   node tools/readings-roster-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before this layer
// existed (`git show 8eb9dbc:Index.html > x`).
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}

const raw = fs.readFileSync(INDEX, 'utf8');
const lines = raw.split('\n');

// Pull `var SBQ_READINGS = { ... };` out by brace balance.
function extractObject(name) {
  const startIdx = lines.findIndex(l => new RegExp('^\\s*var ' + name + '\\s*=\\s*\\{').test(l));
  if (startIdx < 0) return null;
  let depth = 0, started = false;
  const out = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    out.push(line);
    for (const ch of line) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n'), line: startIdx + 1 };
  }
  throw new Error('unbalanced braces while extracting ' + name);
}

const mod = extractObject('SBQ_READINGS');

console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  SBQ_READINGS @ ' + (mod ? 'line ' + mod.line : 'ABSENT') + '\n');

if (!mod) {
  if (EXPECT_BROKEN) {
    console.log('SBQ_READINGS is absent, as expected for pre-fix source.');
    console.log('The negative control holds: these checks cannot pass without it.');
    process.exit(0);
  }
  console.error('SBQ_READINGS not found. The readings layer is missing.');
  process.exit(1);
}

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

// ---- A Supabase query builder just real enough to record what was asked ----
function makeClient(rows, opts) {
  opts = opts || {};
  const log = { selects: [], upserts: [], inserts: [], filters: [] };
  function builder(table) {
    const f = { table };
    const q = {};
    ['select', 'in', 'neq', 'eq', 'gte', 'lte', 'order'].forEach(m => {
      q[m] = (a, b) => {
        if (m === 'select') log.selects.push({ table, cols: a });
        else f[m] = (f[m] || []).concat([[a, b]]);
        return q;
      };
    });
    q.maybeSingle = () => {
      log.filters.push(f);
      return Promise.resolve({ data: opts.existing === undefined ? null : opts.existing });
    };
    q.upsert = (payload, cfg) => {
      log.upserts.push({ table, payload, cfg });
      const r = opts.upsertError ? { error: { message: opts.upsertError } } : { error: null };
      return Promise.resolve(r);
    };
    q.insert = payload => {
      log.inserts.push({ table, payload });
      return opts.insertError
        ? Promise.reject(new Error(opts.insertError))
        : Promise.resolve({ error: null });
    };
    // Terminal for reads.
    q.then = (res, rej) => {
      log.filters.push(f);
      const out = opts.readError
        ? { error: { message: opts.readError }, data: null }
        : { error: null, data: rows };
      return Promise.resolve(out).then(res, rej);
    };
    return q;
  }
  return { client: { from: builder }, log };
}

function load(rows, opts) {
  const { client, log } = makeClient(rows, opts);
  const sandbox = {
    getSupabaseClient: () => (opts && opts.noClient ? null : client),
    console: { warn() {}, log() {}, error() {} },
    Promise, String, Number, Object, Array, Date, isNaN, JSON
  };
  const fn = new Function(
    'getSupabaseClient', 'console', 'warnings',
    mod.text + '\nreturn SBQ_READINGS;'
  );
  const warnings = [];
  const api = fn(sandbox.getSupabaseClient, { warn: (...a) => warnings.push(a.join(' ')), log() {}, error() {} }, warnings);
  return { api, log, warnings };
}

const { api } = load([]);

// ---- 1. iso -> roster -----------------------------------------------------
console.log('converting a date into the three columns the roster is keyed by');
check('a two-digit day', api.isoToRoster('2026-10-04'),
  { year: 2026, month: 9, serviceDate: 'Oct 4' });
check('January is month 0', api.isoToRoster('2026-01-04'),
  { year: 2026, month: 0, serviceDate: 'Jan 4' });
check('December is month 11', api.isoToRoster('2026-12-25'),
  { year: 2026, month: 11, serviceDate: 'Dec 25' });
check('the day is not zero-padded, matching the live rows', api.isoToRoster('2026-03-01').serviceDate, 'Mar 1');
check('rubbish is refused rather than guessed', api.isoToRoster('not-a-date'), null);
check('an empty string is refused', api.isoToRoster(''), null);
check('a month out of range is refused', api.isoToRoster('2026-13-01'), null);

// ---- 2. roster -> iso -----------------------------------------------------
console.log('\nconverting a roster row back into an ISO date');
check('"Oct 4" with the year column', api.rosterToIso('Oct 4', 2026), '2026-10-04');
check('an unpadded day is padded', api.rosterToIso('Mar 1', 2026), '2026-03-01');
check('a full month name still works', api.rosterToIso('March 1', 2026), '2026-03-01');
check('an older ISO row passes straight through', api.rosterToIso('2026-08-02', 2026), '2026-08-02');
check('a missing year yields nothing, not a wrong date', api.rosterToIso('Oct 4', null), '');
check('an unparseable date yields nothing', api.rosterToIso('All Teachers', 2026), '');
check('an unknown month yields nothing', api.rosterToIso('Xyz 4', 2026), '');

console.log('\nevery month round-trips');
const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let roundTripOk = true;
const roundTripFails = [];
for (let m = 0; m < 12; m++) {
  for (const d of [1, 9, 10, 28]) {
    const iso = '2026-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const k = api.isoToRoster(iso);
    const back = api.rosterToIso(k.serviceDate, k.year);
    if (back !== iso) { roundTripOk = false; roundTripFails.push(iso + ' -> ' + k.serviceDate + ' -> ' + back); }
  }
}
check('48 dates survive iso -> roster -> iso', roundTripOk ? 'all' : roundTripFails, 'all');

// ---- 3. getRange narrows the window in JS ---------------------------------
// The query cannot filter by date (service_date is free text), so it fetches a
// whole year and narrows here. This is the check that matters most.
console.log('\nreading a window out of a year of roster rows');
const YEAR_ROWS = [
  { role_id: 'psalm',    service_date: 'Jan 4',  year: 2026, value: 'Psalm 119' },
  { role_id: 'gospel',   service_date: 'Jan 4',  year: 2026, value: 'Luke 2:40-52' },
  { role_id: 'psalm',    service_date: 'Oct 4',  year: 2026, value: 'Psalm 23' },
  { role_id: 'reading1', service_date: 'Oct 4',  year: 2026, value: 'Isaiah 5' },
  { role_id: 'gospel',   service_date: 'Oct 11', year: 2026, value: 'Matthew 21' },
  { role_id: 'psalm',    service_date: 'Dec 25', year: 2026, value: 'Psalm 98' }
];
{
  const { api: a2 } = load(YEAR_ROWS);
  return0(a2);
}
function return0(a2) {
  // A single day.
  a2.getRange('2026-10-04', '2026-10-04').then(r => {
    check('one day returns only that day', Object.keys(r), ['2026-10-04']);
    check('  and both of its readings', r['2026-10-04'],
      { psalm: 'Psalm 23', reading1: 'Isaiah 5' });
  });
  // A month.
  a2.getRange('2026-10-01', '2026-10-31').then(r => {
    check('a month returns both of its service dates', Object.keys(r).sort(),
      ['2026-10-04', '2026-10-11']);
    check('  January is NOT included', r['2026-01-04'], undefined);
    check('  December is NOT included', r['2026-12-25'], undefined);
  });
  // Boundaries are inclusive.
  a2.getRange('2026-10-04', '2026-10-11').then(r => {
    check('both endpoints are inside the window', Object.keys(r).sort(),
      ['2026-10-04', '2026-10-11']);
  });
  a2.getRange('2026-10-05', '2026-10-10').then(r => {
    check('a window between two services is empty', Object.keys(r), []);
  });
}

// The year filter: one year uses eq, a span uses gte/lte.
{
  const { api: a3, log } = load([]);
  a3.getRange('2026-01-01', '2026-12-31').then(() => {
    const f = log.filters[log.filters.length - 1];
    check('a single year is fetched with eq(year)', (f.eq || []).map(x => x[0]), ['year']);
    check('  and not with a range', f.gte, undefined);
  });
}
{
  const { api: a4, log } = load([]);
  a4.getRange('2026-12-01', '2027-01-31').then(() => {
    const f = log.filters[log.filters.length - 1];
    check('a window spanning new year uses gte/lte', [(f.gte || [])[0][1], (f.lte || [])[0][1]], [2026, 2027]);
  });
}

// Only the four reading roles are asked for.
{
  const { api: a5, log } = load([]);
  a5.getRange('2026-01-01', '2026-12-31').then(() => {
    const f = log.filters[log.filters.length - 1];
    check('only the four scripture roles are requested',
      (f.in || [])[0][1], ['reading1', 'psalm', 'reading2', 'gospel']);
  });
}

// A read error must not be swallowed into an empty page.
{
  const { api: a6 } = load([], { readError: 'boom' });
  a6.getRange('2026-01-01', '2026-12-31').then(
    () => check('a read error surfaces rather than looking like no readings', 'resolved', 'rejected'),
    e => check('a read error surfaces rather than looking like no readings', e.message, 'boom')
  );
}

// ---- 4. getServiceDates ---------------------------------------------------
console.log('\nfinding the service dates in a year');
{
  const { api: a7 } = load([
    { service_date: 'Oct 4',  year: 2026 },
    { service_date: 'Oct 4',  year: 2026 },
    { service_date: 'Jan 4',  year: 2026 },
    { service_date: 'bogus',  year: 2026 }
  ]);
  a7.getServiceDates(2026).then(d => {
    check('dates are deduplicated and sorted', d, ['2026-01-04', '2026-10-04']);
    check('  an unparseable service_date is dropped, not guessed', d.indexOf('') < 0, true);
  });
}

// ---- 5. setReference writes the roster ------------------------------------
console.log('\nwriting a reading back to the roster');
{
  const { api: a8, log } = load([], { existing: { value: 'Psalm 1' } });
  a8.setReference('2026-10-04', 1, 'Psalm 23').then(() => {
    const up = log.upserts[0];
    check('it writes to the roster table', up.table, 'roster');
    check('  on the roster conflict key', up.cfg.onConflict, 'month,year,role_id,service_date');
    check('  with the slot role', up.payload.role_id, 'psalm');
    check('  the roster date form', up.payload.service_date, 'Oct 4');
    check('  the 0-indexed month', up.payload.month, 9);
    check('  the year', up.payload.year, 2026);
    check('  and the reference', up.payload.value, 'Psalm 23');
    check('the change is logged like any roster edit', log.inserts[0].table, 'roster_changes');
    check('  carrying the previous value', log.inserts[0].payload.old_value, 'Psalm 1');
    check('  and the new one', log.inserts[0].payload.new_value, 'Psalm 23');
  });
}
{
  const { api: a9, log } = load([], { existing: { value: 'Psalm 23' } });
  a9.setReference('2026-10-04', 1, 'Psalm 23').then(() => {
    check('writing the same value again logs nothing', log.inserts.length, 0);
  });
}
{
  const { api: a10, log } = load([], { existing: null });
  a10.setReference('2026-10-04', 3, '  John 3:16  ').then(v => {
    check('the reference is trimmed', log.upserts[0].payload.value, 'John 3:16');
    check('  and returned', v, 'John 3:16');
    check('a first-time write logs an empty old value', log.inserts[0].payload.old_value, '');
  });
}
{
  // Clearing a reading is a legitimate edit, not a no-op.
  const { api: a11, log } = load([], { existing: { value: 'Psalm 23' } });
  a11.setReference('2026-10-04', 1, '').then(() => {
    check('clearing a reading writes an empty value', log.upserts[0].payload.value, '');
    check('  and is logged', log.inserts[0].payload.new_value, '');
  });
}
{
  // The reading is what the user asked to save. A log failure must not lose it.
  const { api: a12 } = load([], { existing: { value: 'old' }, insertError: 'log is down' });
  a12.setReference('2026-10-04', 1, 'Psalm 23').then(
    v => check('a failed change log still saves the reading', v, 'Psalm 23'),
    e => check('a failed change log still saves the reading', 'rejected: ' + e.message, 'Psalm 23')
  );
}
{
  // But a failed WRITE must be reported, or the page claims a save that never happened.
  const { api: a13 } = load([], { existing: null, upsertError: 'write refused' });
  a13.setReference('2026-10-04', 1, 'Psalm 23').then(
    () => check('a failed write is reported', 'resolved', 'rejected'),
    e => check('a failed write is reported', e.message, 'write refused')
  );
}
{
  const { api: a14 } = load([], { existing: null });
  a14.setReference('nonsense', 1, 'Psalm 23').then(
    () => check('a bad date is refused before anything is written', 'resolved', 'rejected'),
    e => check('a bad date is refused before anything is written', /Bad reading slot or date/.test(e.message), true)
  );
  a14.setReference('2026-10-04', 9, 'Psalm 23').then(
    () => check('a slot index out of range is refused', 'resolved', 'rejected'),
    e => check('a slot index out of range is refused', /Bad reading slot or date/.test(e.message), true)
  );
}

// ---- 6. the slot order matches the roster's own ---------------------------
console.log('\nthe four slots line up with the roster roles');
check('slot order is 1st / Psalm / 2nd / Gospel',
  api.SLOTS.map(s => s.role), ['reading1', 'psalm', 'reading2', 'gospel']);

// Everything above is synchronous-resolving, so one tick is enough to settle.
setTimeout(() => {
  console.log('\n' + '='.repeat(60));
  const pass = results.filter(Boolean).length;
  console.log(pass + '/' + results.length + ' checks passed');
  if (EXPECT_BROKEN) {
    if (pass === results.length) {
      console.log('\nBUT --expect-broken was given and everything passed.');
      console.log('This harness cannot tell the fix from its absence. Do not trust it.');
      process.exit(1);
    }
    console.log('\nFailures above are expected for pre-fix source.');
    process.exit(0);
  }
  if (pass === results.length) console.log('The readings layer maps the roster both ways and writes it safely.');
  process.exit(pass === results.length ? 0 : 1);
}, 50);
