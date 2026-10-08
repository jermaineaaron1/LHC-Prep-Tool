'use strict';
// Regression harness for the one rule that keeps a pencilled-in name private.
//
// WHY THIS EXISTS
// A name typed into a roster cell is PENDING until the PIC ticks Confirm. The
// app is explicit that these are two different decisions -- putting somebody's
// name down, and telling them they are on duty. The in-app comment even said
// pending meant "no calendar push yet".
//
// It did not. The ICS feed selected every roster row with a value and never
// looked at the flag. Measured 2026-10-05: 110 cells were pending and every
// one of them was already in somebody's subscribed calendar. A person being
// quietly considered as a replacement for a service had been notified before
// anyone had asked them.
//
// WHAT THIS CHECKS
// That BOTH roster reads in the feed exclude pending rows -- the member's own
// duties and the duties rostered to a group they belong to. Two reads, one
// rule; a fix applied to only the first would leave group duties leaking, and
// group duties are exactly the ones a PIC is least likely to check.
//
// And that the filter is `not('pending_confirmation', 'is', true)` rather than
// `eq(false)` or `neq(true)`. That is not style. A row whose flag is NULL --
// one inserted by hand, or by a migration that predates the column -- is
// matched by neither `eq.false` nor `neq.true`, so it would disappear from
// every calendar with nothing to show it had. `not.is.true` keeps it. Showing
// a duty that might be tentative is a far better failure than hiding a real
// one, and this is the line that chooses which way it fails.
//
// USAGE
//   node tools/calendar-pending-harness.js                 # ../app/api/calendar/route.ts
//   node tools/calendar-pending-harness.js path/to/route.ts
//   node tools/calendar-pending-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the fix
// (`git show b859e6b:app/api/calendar/route.ts > x`).
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const ROUTE = args.find(a => !a.startsWith('--')) ||
  path.join(__dirname, '..', 'app', 'api', 'calendar', 'route.ts');

if (!fs.existsSync(ROUTE)) {
  console.error('No such file: ' + ROUTE);
  process.exit(1);
}

const src = fs.readFileSync(ROUTE, 'utf8');

// Each `.from('roster')` read, as the chained call text that follows it, up to
// the terminating semicolon. Comments are stripped first so a filter mentioned
// only in prose cannot satisfy the check.
function rosterQueries(text) {
  const noComments = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  const out = [];
  const re = /\.from\(\s*'roster'\s*\)/g;
  let m;
  while ((m = re.exec(noComments))) {
    const rest = noComments.slice(m.index);
    const end = rest.indexOf(';');
    out.push(rest.slice(0, end === -1 ? 400 : end));
  }
  return out;
}

const queries = rosterQueries(src);

console.log('Reading ' + path.basename(ROUTE) + ':');
console.log('  roster queries found: ' + queries.length + '\n');

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label + (detail ? '  -- ' + detail : ''));
}

// The feed reads the roster twice on purpose: a member's own duties, and the
// duties rostered to a group they are in. Both must filter.
check('the feed reads the roster twice (own duties + group duties)',
  queries.length === 2, queries.length + ' found');

const PENDING = /\.not\(\s*'pending_confirmation'\s*,\s*'is'\s*,\s*true\s*\)/;
const WEAK = /\.(eq|neq)\(\s*'pending_confirmation'\s*,/;

queries.forEach((q, i) => {
  const which = i === 0 ? "the member's own duties" : 'duties rostered to a group';
  const has = PENDING.test(q);
  check(which + ' exclude pending rows', has,
    has ? '' : (WEAK.test(q) ? 'uses eq/neq, which drops NULL rows too' : 'no pending filter at all'));
});

const weakAnywhere = WEAK.test(queries.join('\n'));
check('no query uses eq/neq on the flag (they would hide NULL rows)', !weakAnywhere);

// A NULL flag must be treated as "confirmed", not hidden. This is the whole
// reason for `not.is.true`, so it is asserted directly rather than implied.
check('the filter keeps rows whose flag is NULL',
  queries.every(q => !/pending_confirmation/.test(q) || PENDING.test(q)));

// And the feed must still be reading the roster at all -- a harness that
// passes because the queries vanished would be worse than no harness.
check('the feed still selects the columns an event is built from',
  queries.every(q => /role_id/.test(q) && /service_date/.test(q)));

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
if (pass === results.length) console.log('A pending duty stays out of the calendar until it is confirmed.');
process.exit(pass === results.length ? 0 : 1);
