'use strict';
// Regression harness for the Watchnight service on 31 December.
//
// WHY THIS EXISTS
// The year closes with a Watchnight service: traditional, with communion,
// every December. It was not in the roster at all, so somebody added the
// column by hand each year or the service went unrostered.
//
// Two things about it are easy to get wrong, and both were got wrong on the
// first attempt here.
//
//   31 December is sometimes a SUNDAY -- 2028, 2034, 2045. getServiceDays
//   merges a special day onto a Sunday that already exists rather than
//   showing the date twice, and the merge branch rebuilds the day object
//   field by field. Anything not named there is dropped. So the service
//   type survived in the years where 31 December is a weekday and silently
//   vanished in the years where it is a Sunday -- which is the harder case
//   to notice and the one nobody would test by hand.
//
//   Christmas Eve and Christmas Day sit on fixed dates too, and neither
//   carries a service type. Watchnight must not quietly give them one.
//
// HOW IT WORKS
// It reimplements nothing: it slices the real getSpecialDays,
// getServiceDays and calculateEaster out of Index.html and runs them.
//
// USAGE
//   node tools/watchnight-service-harness.js
//   node tools/watchnight-service-harness.js path/to/file.html
//   node tools/watchnight-service-harness.js <file> --expect-broken
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }

const raw = fs.readFileSync(INDEX, 'utf8');
const lines = raw.split('\n');

function extractMethod(name) {
  const start = lines.findIndex(l => new RegExp('^    ' + name + ': function').test(l));
  if (start < 0) return null;
  let depth = 0, started = false, out = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    out.push(line);
    for (const ch of line) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n').replace(/,\s*$/, '');
  }
  throw new Error('unbalanced braces in ' + name);
}

const parts = ['getSpecialDays', 'calculateEaster', 'getServiceDays'].map(extractMethod);
if (parts.some(p => !p)) { console.error('Could not slice the roster date methods.'); process.exit(1); }

const RE = new Function('return {' +
  'MONTHS_SHORT: ' + JSON.stringify(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']) + ',' +
  'DEFAULT_COLORS: ' + JSON.stringify({0:'Green',1:'Green',2:'Purple',3:'White',4:'White',5:'Green',6:'Green',7:'Green',8:'Green',9:'Red',10:'Green',11:'Purple'}) + ',' +
  parts.join(',') + '};')();

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

const watchnightIn = (year, month) =>
  RE.getServiceDays(year, month).find(d => d.name === 'Watchnight Service') || null;

console.log('Reading ' + path.basename(INDEX) + '\n');

if (!watchnightIn(2026, 11)) {
  if (EXPECT_BROKEN) {
    console.log('(pre-change) December had no Watchnight service.');
    console.log('\n--expect-broken: the pre-change shape is what passes');
    process.exit(0);
  }
  console.error('No Watchnight service in December.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
console.log('every December has one, and only December');
{
  // A long run of years, so a leap year or an unusual weekday cannot hide.
  const years = [];
  for (let y = 2024; y <= 2045; y++) years.push(y);
  check('every year 2024-2045 has a Watchnight',
    years.filter(y => !watchnightIn(y, 11)), []);
  check('always on the 31st',
    years.filter(y => watchnightIn(y, 11).date.getDate() !== 31), []);
  check('and only once', years.filter(y =>
    RE.getServiceDays(y, 11).filter(d => d.name === 'Watchnight Service').length !== 1), []);

  const otherMonths = [];
  for (let m = 0; m < 11; m++) if (watchnightIn(2026, m)) otherMonths.push(m);
  check('no other month has one', otherMonths, []);
}

// ---------------------------------------------------------------------------
console.log('\nit is a traditional service, in every year');
{
  const years = [];
  for (let y = 2024; y <= 2045; y++) years.push(y);
  // THE bug. The merge branch and the push branch rebuild the day object
  // separately, and the first version only carried the type through one.
  check('the service type survives in every year',
    years.filter(y => watchnightIn(y, 11).fixedServiceType !== 'Traditional'), []);

  const sundayYears = years.filter(y => new Date(y, 11, 31).getDay() === 0);
  check('some of those years put the 31st on a Sunday', sundayYears.length > 0, true);
  check('and the Sunday ones keep it too',
    sundayYears.filter(y => watchnightIn(y, 11).fixedServiceType !== 'Traditional'), []);

  check('it is white, as Christmas season', watchnightIn(2026, 11).color, 'White');
  check('and reads as a special service', watchnightIn(2026, 11).type, 'special');
}

// ---------------------------------------------------------------------------
console.log('\nwhen the 31st is a Sunday that is two services');
{
  // There is a morning service and a Watchnight that night, and they are
  // two services. Christmas Eve on a Sunday is NOT the same case -- that is
  // one service with a name -- so it must still fold into a single column,
  // which is checked here too.
  const dec2028 = RE.getServiceDays(2028, 11);
  check('31 Dec 2028 is a Sunday', new Date(2028, 11, 31).getDay(), 0);
  const onThe31st = dec2028.filter(d => d.date.getDate() === 31);
  check('and gets two columns', onThe31st.length, 2);
  check('the morning service first', onThe31st[0].type, 'sunday');
  check('the Watchnight after it', onThe31st[1].name, 'Watchnight Service');

  // They can be two columns only because they have two keys: every roster
  // cell is roleId__<dateStr>, so one key would be one column wearing two
  // names and the evening duties would overwrite the morning's.
  check('with keys that cannot collide',
    onThe31st[0].dateStr !== onThe31st[1].dateStr, true);
  check('the morning keeps the plain date', onThe31st[0].dateStr, 'Dec 31');
  check('and the Watchnight is the evening one', onThe31st[1].dateStr, 'Dec 31 PM');

  // The key never changes shape with the weekday. One that was 'Dec 31' in
  // some years and 'Dec 31 PM' in others would be far worse to debug than a
  // constant one, and would strand the data saved under the other spelling.
  const allYears = [];
  for (let y = 2024; y <= 2045; y++) allYears.push(y);
  check('and is the same in every year',
    allYears.filter(y => watchnightIn(y, 11).dateStr !== 'Dec 31 PM'), []);

  // What must NOT change: a named Sunday is still one service.
  const eveOnSunday = allYears.filter(y => new Date(y, 11, 24).getDay() === 0);
  check('some years put Christmas Eve on a Sunday', eveOnSunday.length > 0, true);
  check('and it is still one column', eveOnSunday.filter(y =>
    RE.getServiceDays(y, 11).filter(d => d.date.getDate() === 24).length !== 1), []);
}

// ---------------------------------------------------------------------------
console.log('\nnothing else was given a service type');
{
  const years = [2026, 2027, 2028];
  const strays = [];
  years.forEach(y => {
    for (let m = 0; m < 12; m++) {
      RE.getServiceDays(y, m).forEach(d => {
        if (d.fixedServiceType && d.name !== 'Watchnight Service') {
          strays.push(y + '/' + (m + 1) + ' ' + (d.displayName || d.dateStr));
        }
      });
    }
  });
  check('Christmas Eve, Christmas Day and the Sundays still choose', strays, []);
}

// ---------------------------------------------------------------------------
console.log('\nthe grid is told to use it');
{
  // Setting the type is what makes communion appear: the communion duties
  // are ruled out of contemporary services only, so a traditional one gets
  // them automatically. Checked where the Sunday pattern is applied.
  const at = raw.indexOf('var sundayOrdinal = 0;');
  const block = at >= 0 ? raw.slice(at, at + 1400) : '';
  check('the applier reads the day\'s own type', /day\.fixedServiceType/.test(block), true);
  check('and never overwrites a choice already made', /if \(hasType\) return;/.test(block), true);
  check('communion is excluded from contemporary services only',
    /communion1: \['contemporary'\]/.test(raw), true);
  // Watchnight takes the other branch now, so the merge line is not asserted
  // as though it were exercised. What IS asserted is the rule that makes the
  // split work at all.
  check('a special with its own key is never folded into another day',
    /if \(!special\.dateStr\) \{/.test(raw), true);
}

// ---------------------------------------------------------------------------
const failed = results.filter(ok => !ok).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
