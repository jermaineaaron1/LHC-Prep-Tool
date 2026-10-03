'use strict';
// Regression harness for reading a whole year of roster rows in pages.
//
// WHY THIS EXISTS
// PostgREST stops at 1000 rows and says nothing about it: no error, no flag,
// just a short answer. 2026 has 1047 roster rows, so a single request quietly
// dropped 47 and two things downstream believed the short count.
//
//   The Enablers serving-frequency view understated 25 people's duty counts,
//   one of them by two.
//
//   runAutoSuggest picks who serves next FROM those counts. Its whole purpose
//   is spreading duties fairly, and it was deciding from an incomplete
//   history -- able to put somebody forward who had just served and skip
//   somebody who had not.
//
// Neither showed any sign of being wrong, which is the dangerous part: a
// truncated read looks exactly like a smaller roster.
//
// WHAT THIS CHECKS
// Mostly the boundaries, because that is where paging goes wrong: a last page
// that is exactly full, an empty table, a single page, and an error partway
// through. It also checks that no second unpaginated read of this shape has
// reappeared, since the fix was to have one function do it for everybody.
//
// USAGE
//   node tools/year-pagination-harness.js                 # ../Index.html
//   node tools/year-pagination-harness.js path/to/file.html
//   node tools/year-pagination-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the fix
// (`git show d0fc77d:Index.html > x`).
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

const fn = extractMethod('getAllForYear', true);
console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  getAllForYear @ ' + (fn ? 'line ' + fn.line : 'ABSENT') + '\n');

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

// A Supabase query builder just real enough to page against.
function makeClient(total, opts) {
  opts = opts || {};
  const calls = [];
  const builder = () => {
    const q = {};
    ['select', 'eq', 'neq', 'order'].forEach(m => { q[m] = () => q; });
    q.range = (from, to) => {
      calls.push([from, to]);
      const rows = [];
      for (let i = from; i <= to && i < total; i++) rows.push({ id: i, value: 'p' + i, month: 0, role_id: 'r' });
      const result = opts.failAt !== undefined && calls.length - 1 === opts.failAt
        ? { error: { message: 'boom' }, data: null }
        : { error: null, data: rows };
      return Promise.resolve(result);
    };
    return q;
  };
  return { client: { from: () => builder() }, calls };
}

function build(total, opts) {
  const { client, calls } = makeClient(total, opts);
  const env = { SBQ_ROSTER: { _sb: () => client }, Promise: Promise, Error: Error };
  const keys = Object.keys(env);
  const api = new Function(...keys, 'return {' + fn.text + '};')(...keys.map(k => env[k]));
  return { api, calls };
}

(async () => {
  console.log('a year is read whole, however many rows it has');
  if (!fn) {
    if (EXPECT_BROKEN) check('(pre-fix) there was no paginated reader', true, true);
    else check('getAllForYear exists', false, true);
  } else if (EXPECT_BROKEN) {
    check('(pre-fix) it did not page', /\.range\(/.test(fn.text), false);
  } else {
    {
      const { api, calls } = build(1047);
      const rows = await api.getAllForYear(2026);
      check('1047 rows all arrive', rows.length, 1047);
      check('it took two requests', calls.length, 2);
      check('the pages do not overlap', calls, [[0, 999], [1000, 1999]]);
    }
    {
      // The nastiest case: a last page that is exactly full.
      const { api, calls } = build(2000);
      const rows = await api.getAllForYear(2026);
      check('an exactly-full last page is not mistaken for the end', rows.length, 2000);
      check('so it asks once more and gets nothing', calls.length, 3);
    }
    {
      const { api, calls } = build(1000);
      const rows = await api.getAllForYear(2026);
      check('exactly 1000 rows still needs a second look', rows.length, 1000);
      check('and that is two requests', calls.length, 2);
    }
    {
      const { api, calls } = build(42);
      const rows = await api.getAllForYear(2026);
      check('a short year takes one request', calls.length, 1);
      check('and returns all of it', rows.length, 42);
    }
    {
      const { api, calls } = build(0);
      const rows = await api.getAllForYear(2026);
      check('an empty year returns nothing without looping', rows.length, 0);
      check('in one request', calls.length, 1);
    }
    {
      // A failure on the SECOND page must not quietly return the first.
      const { api } = build(1047, { failAt: 1 });
      let threw = false, partial = null;
      try { partial = await api.getAllForYear(2026); } catch (e) { threw = true; }
      check('an error partway through is raised, not swallowed', threw, true);
      check('and no partial result is handed back', partial, null);
    }
    {
      const { api } = build(1047);
      const rows = await api.getAllForYear(2026);
      check('no row is duplicated across pages',
        new Set(rows.map(r => r.id)).size, rows.length);
    }
  }

  console.log('\nthere is only one read of this shape');
  {
    // The Enablers view used to run its own, which is how the two drifted.
    const ownQuery = /from\('roster'\)\s*\.select\('role_id, month, value, service_date'\)\s*\.eq\('year'/.test(raw);
    const viaHelper = /SBQ_ROSTER\.getAllForYear\(year\)/.test(raw);
    const ordered = fn ? /\.order\('id'\)/.test(fn.text) : false;
    if (EXPECT_BROKEN) {
      check('(pre-fix) the Enablers view ran its own query', ownQuery, true);
    } else {
      check('the Enablers view no longer runs its own', ownQuery, false);
      check('it reads through the paginated one', viaHelper, true);
      check('pages are ordered, so they cannot overlap or skip', ordered, true);
    }
  }

  console.log('\n================================');
  const passed = results.filter(Boolean).length;
  console.log(passed + '/' + results.length + ' checks passed');
  if (passed !== results.length) process.exit(1);
})();
