'use strict';
// Regression harness for counting a duty once when two rows record it.
//
// WHY THIS EXISTS
// The roster is keyed by service_date, which is free text, and the app
// normalises an ISO stamp into "Jan 4" on READ. So a row stored as
// "2026-01-04T08:00:00.000Z" and a row stored as "Jan 4" name the same cell.
// The screen only ever shows one of them -- with no ORDER BY, whichever
// Postgres hands back last -- but getAllForYear returned BOTH, and nothing
// downstream deduplicated.
//
// That is not a cosmetic problem. Both rows counted as duties, so six
// people's 2026 totals were each inflated by one, and those totals are what
// runAutoSuggest reads to decide who serves next. An inflated count makes
// somebody look busier than they are and quietly sends the duty to someone
// else -- in a feature whose entire purpose is sharing duties out fairly.
//
// The six rows themselves were left alone by decision (repairing them needs
// somebody to remember who led a service nine months ago). This fixes the
// counting, which does not need anybody to remember anything.
//
// WHAT THIS CHECKS
// That one cell yields one row; that the winner is chosen by a rule rather
// than by arrival order, since the two rows can name different people; and
// that rows naming genuinely different cells are never merged -- which is
// the failure that would silently erase real duties, and is far worse than
// the bug being fixed.
//
// USAGE
//   node tools/duty-count-dedupe-harness.js
//   node tools/duty-count-dedupe-harness.js path/to/Index.html
//   node tools/duty-count-dedupe-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the fix
// (`git show HEAD:Index.html > old.html`), where getAllForYear handed back
// every row it read.
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

function extractMethod(name, optional) {
  const startIdx = lines.findIndex(l => new RegExp('^  ' + name + ':\\s*function\\s*\\(').test(l));
  if (startIdx < 0) {
    if (optional) return null;
    throw new Error('method not found: ' + name);
  }
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n').replace(/,\s*$/, ''), line: startIdx + 1 };
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}

const dedupe = extractMethod('_oneRowPerCell', true);
const forYear = extractMethod('getAllForYear', true);
// The real normaliser, lifted from the source rather than reimplemented here,
// so this cannot pass against a copy that has drifted from the shipped one.
const normSrc = (raw.match(/var _MONTH_ABBR =[\s\S]*?\nvar _normSvcDate = function[\s\S]*?\n\};/) || [''])[0];

console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  _oneRowPerCell  @ ' + (dedupe ? 'line ' + dedupe.line : 'ABSENT'));
console.log('  getAllForYear   @ ' + (forYear ? 'line ' + forYear.line : 'ABSENT'));
console.log('  _normSvcDate    @ ' + (normSrc ? 'found' : 'ABSENT') + '\n');

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

if (!dedupe || !normSrc) {
  if (EXPECT_BROKEN) {
    console.log('(pre-fix) getAllForYear handed back every row it read, so a cell');
    console.log('recorded twice counted as two duties.');
    check('(pre-fix) nothing collapsed rows onto cells', dedupe, null);
    console.log('\n--expect-broken: the pre-fix shape is what passes');
    process.exit(results.every(Boolean) ? 0 : 1);
  }
  console.error('_oneRowPerCell or _normSvcDate is missing — duties are being counted per ROW again.');
  process.exit(1);
}

const env = { SBQ_ROSTER: {}, Promise: Promise, Error: Error };
const keys = Object.keys(env);
const api = new Function(...keys,
  normSrc + ';return {' + dedupe.text + (forYear ? ',' + forYear.text : '') + '};')(...keys.map(k => env[k]));
env.SBQ_ROSTER._oneRowPerCell = api._oneRowPerCell;

const row = (role, date, value, month, year) =>
  ({ role_id: role, service_date: date, value: value, month: month === undefined ? 0 : month, year: year || 2026 });
const names = rows => rows.map(r => r.value);

// ---------------------------------------------------------------------------
console.log('one cell, one row');
{
  check('nothing to collapse', names(api._oneRowPerCell([
    row('liturgist', 'Jan 4', 'Allan'), row('preacher', 'Jan 4', 'Benedict'),
  ])), ['Allan', 'Benedict']);

  // The live shape: an ISO import sitting on top of a canonical row.
  check('an ISO row and a canonical row are one cell', api._oneRowPerCell([
    row('liturgist', 'Jan 4', 'Ashley'),
    row('liturgist', '2026-01-04T08:00:00.000Z', 'Allan Yip'),
  ]).length, 1);

  check('four rows naming two cells come back as two', api._oneRowPerCell([
    row('preacher', 'Jan 4', 'Benedict'),
    row('preacher', '2026-01-04T08:00:00.000Z', 'Benedict'),
    row('liturgist', 'Jan 11', 'Aaron'),
    row('liturgist', '2026-01-11T08:00:00.000Z', 'Cynthia'),
  ]).length, 2);

  check('an empty year collapses to nothing', api._oneRowPerCell([]), []);
}

// ---------------------------------------------------------------------------
console.log('\nthe survivor is chosen by rule, not by arrival order');
{
  // This matters because the two rows can name DIFFERENT people: whoever
  // survives is who gets credited with the duty. Arrival order is whatever
  // Postgres felt like, which is how the screen came to show a different
  // name depending on the day you looked.
  check('the canonical row wins when it arrives first', names(api._oneRowPerCell([
    row('liturgist', 'Jan 4', 'Ashley'),
    row('liturgist', '2026-01-04T08:00:00.000Z', 'Allan Yip'),
  ])), ['Ashley']);

  check('the canonical row wins when it arrives second', names(api._oneRowPerCell([
    row('liturgist', '2026-01-04T08:00:00.000Z', 'Allan Yip'),
    row('liturgist', 'Jan 4', 'Ashley'),
  ])), ['Ashley']);

  check('with no canonical row at all, the later one wins', names(api._oneRowPerCell([
    row('liturgist', '2026-01-04T08:00:00.000Z', 'First'),
    row('liturgist', '2026-01-04T09:30:00.000Z', 'Second'),
  ])), ['Second']);

  check('duplicates that agree need no tiebreak', names(api._oneRowPerCell([
    row('pianist', 'Jan 4', 'Luke Yong'),
    row('pianist', '2026-01-04T08:00:00.000Z', 'Luke Yong'),
  ])), ['Luke Yong']);

  // A surviving row keeps its own fields, not a merge of both.
  const kept = api._oneRowPerCell([
    row('liturgist', '2026-01-04T08:00:00.000Z', 'Allan Yip'),
    row('liturgist', 'Jan 4', 'Ashley'),
  ])[0];
  check('the survivor keeps the canonical date string', kept.service_date, 'Jan 4');
}

// ---------------------------------------------------------------------------
console.log('\ndifferent cells are never merged');
{
  // Erasing a real duty would be a worse bug than counting one twice, so
  // these matter more than everything above.
  check('two roles on one date stay two', api._oneRowPerCell([
    row('liturgist', 'Jan 4', 'A'), row('preacher', 'Jan 4', 'B'),
  ]).length, 2);

  check('one role on two dates stays two', api._oneRowPerCell([
    row('liturgist', 'Jan 4', 'A'), row('liturgist', 'Jan 11', 'B'),
  ]).length, 2);

  check('the same date in two months stays two', api._oneRowPerCell([
    row('liturgist', 'Jan 4', 'A', 0), row('liturgist', 'Feb 4', 'B', 1),
  ]).length, 2);

  check('the same cell in two years stays two', api._oneRowPerCell([
    row('liturgist', 'Jan 4', 'A', 0, 2025), row('liturgist', 'Jan 4', 'B', 0, 2026),
  ]).length, 2);

  // 4 and 11 January are different services; an ISO stamp for one must not
  // land on the other.
  check('ISO stamps for different days stay apart', api._oneRowPerCell([
    row('liturgist', '2026-01-04T08:00:00.000Z', 'A'),
    row('liturgist', '2026-01-11T08:00:00.000Z', 'B'),
  ]).length, 2);

  check('a whole clean year passes through untouched', api._oneRowPerCell(
    Array.from({ length: 200 }, (_, i) => row('r' + (i % 20), 'Jan ' + (1 + (i % 10)), 'p' + i, Math.floor(i / 20)))
  ).length, 200);

  check('order of first appearance is preserved', names(api._oneRowPerCell([
    row('c', 'Jan 4', 'third'), row('a', 'Jan 4', 'first'), row('b', 'Jan 4', 'second'),
  ])), ['third', 'first', 'second']);
}

// ---------------------------------------------------------------------------
console.log('\nthe duty count that started all this');
{
  // Six rows, two of them a duplicated cell: the shape the live data is in.
  const live = [
    row('liturgist', 'Jan 4', 'Allan Yip'),
    row('liturgist', '2026-01-04T08:00:00.000Z', 'Allan Yip'),
    row('preacher', 'Jan 11', 'Allan Yip'),
    row('usher1', 'Jan 18', 'Allan Yip'),
  ];
  const countFor = rows => rows.filter(r => r.value === 'Allan Yip').length;
  check('counted per row, he served four times', countFor(live), 4);
  check('counted per cell, he served three', countFor(api._oneRowPerCell(live)), 3);
}

// ---------------------------------------------------------------------------
if (forYear) {
  console.log('\ngetAllForYear is where it happens, so every caller gets it');
  // Both callers -- the Enablers frequency view and runAutoSuggest -- read
  // through this one function, so collapsing here is what makes a third
  // caller safe by default.
  const pageRows = [
    row('liturgist', 'Jan 4', 'Ashley'),
    row('liturgist', '2026-01-04T08:00:00.000Z', 'Allan Yip'),
    row('preacher', 'Jan 4', 'Benedict'),
  ];
  const builder = () => {
    const q = {};
    ['select', 'eq', 'neq', 'order'].forEach(m => { q[m] = () => q; });
    q.range = (from) => Promise.resolve({ error: null, data: from === 0 ? pageRows : [] });
    return q;
  };
  env.SBQ_ROSTER._sb = () => ({ from: () => builder() });
  api.getAllForYear(2026).then(rows => {
    check('three rows in, two cells out', rows.length, 2);
    check('and the canonical name is the one credited', names(rows), ['Ashley', 'Benedict']);
    finish();
  }).catch(err => { check('getAllForYear did not throw: ' + err.message, false, true); finish(); });
} else {
  finish();
}

function finish() {
  const failed = results.filter(ok => !ok).length;
  console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
  process.exit(failed ? 1 : 0);
}
