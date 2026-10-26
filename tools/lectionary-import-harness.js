'use strict';
// Regression harness for importing a whole lectionary.
//
// WHY THIS EXISTS
// One PDF fills a season or a year of Sundays, so this writes to many roster
// rows from one upload. The thing that makes that safe rather than reckless
// is what it does when the document disagrees with a reading already saved:
// it shows both and changes nothing until somebody picks.
//
// Two ways that goes wrong, and both are quiet:
//
//   TOO EAGER. Treat a clash as a fill and the import silently replaces a
//   reference somebody set by hand -- across fifty Sundays, with no record
//   on screen of what it used to be.
//
//   TOO FUSSY. Flag "Psalm 34:1-10, 22" against "Psalm 34:1–10,22" as a
//   clash -- an en dash and a space -- and a real year of readings arrives
//   as fifty false conflicts. People then click through conflicts without
//   reading them, which is worse than not flagging at all, because the one
//   genuine disagreement is now hidden in the noise.
//
// So the comparison is loose about punctuation and strict about content,
// and it is RUN here rather than read.
//
// USAGE
//   node tools/lectionary-import-harness.js
//   node tools/lectionary-import-harness.js path/to/file.html
//   node tools/lectionary-import-harness.js <file> --expect-broken
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

function extractFunction(name) {
  const start = lines.findIndex(l => new RegExp('^\\s*function ' + name + '\\s*\\(').test(l));
  if (start < 0) return null;
  let depth = 0, started = false, out = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    out.push(line);
    for (const ch of line) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced braces in ' + name);
}

const stateSrc = extractFunction('_lectSlotState');
const dateSrc = extractFunction('_lectPrettyDate');

console.log('Reading ' + path.basename(INDEX));
console.log('  _lectSlotState    ' + (stateSrc ? 'found' : 'ABSENT'));
console.log('  _lectPrettyDate   ' + (dateSrc ? 'found' : 'ABSENT') + '\n');

if (!stateSrc) {
  if (EXPECT_BROKEN) {
    console.log('(pre-change) there was no lectionary import: readings could only be');
    console.log('filled one service at a time, from a bulletin for that service.');
    console.log('\n--expect-broken: the pre-change shape is what passes');
    process.exit(0);
  }
  console.error('_lectSlotState is gone — the import can no longer tell a clash from a fill.');
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

// SLOTS is the real order: a swap here would file the Gospel as the Epistle.
const SLOTS = [
  { role: 'reading1', label: '1st Reading' },
  { role: 'psalm', label: 'Psalm' },
  { role: 'reading2', label: '2nd Reading' },
  { role: 'gospel', label: 'Gospel' }
];

function state(existingForDate, slotIdx, incoming) {
  const _lectImport = { existing: { '2026-11-01': existingForDate || {} } };
  const fn = new Function('_lectImport', 'SBQ_READINGS',
    stateSrc + '\nreturn _lectSlotState;')(_lectImport, { SLOTS });
  return fn('2026-11-01', slotIdx, incoming);
}

// ---------------------------------------------------------------------------
console.log('what to do with each slot');
{
  check('an empty slot is filled',
    state({}, 0, 'Revelation 7:9-17').kind, 'empty');
  check('a slot that already says the same thing is left alone',
    state({ reading1: 'Revelation 7:9-17' }, 0, 'Revelation 7:9-17').kind, 'same');
  check('a slot that says something else is a clash',
    state({ reading1: 'Isaiah 25:6-9' }, 0, 'Revelation 7:9-17').kind, 'clash');
  check('a reading the document does not give is nothing to do',
    state({}, 0, null).kind, 'none');
  check('and still nothing to do even where one is saved',
    state({ reading1: 'Isaiah 25:6-9' }, 0, '').kind, 'none');

  // A clash has to carry BOTH, or the review cannot show what it is replacing.
  const c = state({ reading1: 'Isaiah 25:6-9' }, 0, 'Revelation 7:9-17');
  check('a clash carries the saved value', c.current, 'Isaiah 25:6-9');
  check('and the one from the document', c.incoming, 'Revelation 7:9-17');
}

// ---------------------------------------------------------------------------
console.log('\nthe same reading, typed differently, is not a clash');
{
  // Every one of these is the live All Saints psalm against a plausible
  // reprinting of it. Flagging any as a conflict turns a year of readings
  // into a wall of false alarms.
  const SAME = [
    ['Psalm 34:1-10, 22', 'Psalm 34:1-10,22', 'a missing space'],
    ['Psalm 34:1-10, 22', 'Psalm 34:1–10, 22', 'an en dash'],
    ['Psalm 34:1-10, 22', 'Psalm 34:1—10, 22', 'an em dash'],
    ['Psalm 34:1-10, 22', 'PSALM 34:1-10, 22', 'shouting'],
    ['1 John 3:1-3', '1 John 3:1-3.', 'a trailing full stop'],
    ['Matthew 5:1-12', 'Matthew  5:1-12', 'a double space'],
  ];
  SAME.forEach(([a, b, why]) => {
    check('"' + b + '" matches (' + why + ')', state({ psalm: a }, 1, b).kind, 'same');
  });
}

// ---------------------------------------------------------------------------
console.log('\nbut a different reading still is');
{
  // The other half. A comparison loose enough to pass everything would make
  // the whole review theatre.
  const DIFFERENT = [
    ['Psalm 34:1-10, 22', 'Psalm 34:1-10', 'a shorter range'],
    ['Psalm 34:1-10, 22', 'Psalm 34:1-10, 23', 'one verse out'],
    ['Psalm 34:1-10, 22', 'Psalm 43:1-10, 22', 'a different psalm'],
    ['Matthew 5:1-12', 'Mark 5:1-12', 'a different gospel'],
    ['1 John 3:1-3', '2 John 3:1-3', 'a different epistle'],
    ['Isaiah 6:1-8', 'Isaiah 6:1-9', 'one verse longer'],
  ];
  DIFFERENT.forEach(([a, b, why]) => {
    check('"' + b + '" clashes (' + why + ')', state({ psalm: a }, 1, b).kind, 'clash');
  });
}

// ---------------------------------------------------------------------------
console.log('\nthe slot it looks at is the slot it is asked about');
{
  // Reading the wrong role would compare the Gospel against the Epistle and
  // report clashes that are nothing of the sort.
  const saved = { reading1: 'Isaiah 25:6-9', psalm: 'Psalm 24', reading2: '1 John 3:1-3', gospel: 'John 11:32-44' };
  check('slot 0 reads reading1', state(saved, 0, 'Isaiah 25:6-9').kind, 'same');
  check('slot 1 reads psalm', state(saved, 1, 'Psalm 24').kind, 'same');
  check('slot 2 reads reading2', state(saved, 2, '1 John 3:1-3').kind, 'same');
  check('slot 3 reads gospel', state(saved, 3, 'John 11:32-44').kind, 'same');
  check('and slot 3 does not read slot 0', state(saved, 3, 'Isaiah 25:6-9').kind, 'clash');
}

// ---------------------------------------------------------------------------
console.log('\na date the roster has never heard of');
{
  const _lectImport = { existing: {} };
  const fn = new Function('_lectImport', 'SBQ_READINGS',
    stateSrc + '\nreturn _lectSlotState;')(_lectImport, { SLOTS });
  check('every slot is simply empty', fn('2030-01-06', 0, 'Isaiah 60:1-6').kind, 'empty');
}

// ---------------------------------------------------------------------------
if (dateSrc) {
  console.log('\ndates read as dates');
  const pretty = new Function(dateSrc + '\nreturn _lectPrettyDate;')();
  // Built in UTC on purpose: constructing from local time moves the day
  // across the date line for anyone west of Greenwich, so 1 Nov would print
  // as 31 Oct in the review table.
  check('an ISO date becomes a readable one', pretty('2026-11-01'), 'Sun 1 Nov 2026');
  check('and keeps the right weekday in any timezone', pretty('2026-01-01'), 'Thu 1 Jan 2026');
  check('a leap day survives', pretty('2028-02-29'), 'Tue 29 Feb 2028');
  check('something that is not a date is left alone', pretty('not-a-date'), 'not-a-date');
}

// ---------------------------------------------------------------------------
console.log('\nwhat the import is wired to');
{
  // Readings go to the roster. The bulletin importer beside this one spent
  // its whole life writing a table nothing read, so this is worth pinning.
  const save = raw.slice(raw.indexOf('function saveLectionaryImport'));
  const body = save.slice(0, save.indexOf('\n  }\r\n'));
  check('it saves through setReference, like everything else',
    /SBQ_READINGS\.setReference\(j\.date, j\.slot, j\.value\)/.test(body), true);
  check('and never through the text cache', /SBQ_LECTIONARY/.test(body), false);

  // The range it looks up existing readings over must be the smallest and
  // largest date, not the first and last in the array. Built on the array's
  // order it fails silently the moment the entries are not sorted:
  // getRange(later, earlier) matches nothing, every slot reads as empty, and
  // the import offers to add readings over ones already saved -- the
  // conflict check off, with nothing on screen to say so. That is how this
  // was found, with a stub that happened to answer out of order.
  const run = raw.slice(raw.indexOf('function runLectionaryImport'));
  const runBody = run.slice(0, run.indexOf('\n  }\r\n'));
  check('the lookup range is sorted, not positional',
    /var dates = entries\.map\(function\(e\) \{ return e\.date; \}\)\.sort\(\);/.test(runBody), true);
  check('and does not index the array for its bounds',
    /entries\[0\]\.date/.test(runBody), false);

  // Only what was chosen. A selector that caught every radio rather than
  // the checked ones would overwrite every clash with the document.
  check('it collects the ticked fills',
    /checkbox"\]\[data-kind="empty"\]:checked/.test(body), true);
  check('and only the clashes switched to the document',
    /radio"\]\[value="use"\]:checked/.test(body), true);

  // The receipt must not be able to fail the import.
  const fin = raw.slice(raw.indexOf('function _finishLectionaryImport'));
  const finBody = fin.slice(0, fin.indexOf('\n  }\r\n'));
  check('the source record is written after the readings, not before',
    finBody.indexOf('SBQ_LECT_SOURCES.save') > finBody.indexOf('var rec ='), true);
  check('and only when something was actually saved',
    /if \(saved > 0\) SBQ_LECT_SOURCES\.save/.test(finBody), true);
  check('a failed receipt still reports the readings as saved',
    /could not be recorded/.test(finBody), true);

  // Degrading rather than exploding when the migration has not been run.
  check('a missing lectionary_sources table is survivable',
    /_absent: function\(msg\)/.test(raw) && /_soften: function\(err, fallback\)/.test(raw), true);
  check('and says so once, in the console, naming the migration',
    /2026-10-26_add_lectionary_sources\.sql/.test(raw), true);
  check('the migration exists',
    fs.existsSync(path.join(__dirname, '..', 'migrations', '2026-10-26_add_lectionary_sources.sql')), true);
  check('and so does the check it tells you to run',
    fs.existsSync(path.join(__dirname, 'verify-lectionary-sources.js')), true);

  // The server side: one service and a whole calendar are different asks.
  const route = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'parse-lectionary', 'route.ts'), 'utf8');
  check('the route can read a whole calendar', /mode === 'calendar'/.test(route), true);
  check('it still answers the single-service callers unchanged',
    /responseSchema: isCalendar \? CALENDAR_SCHEMA : RESPONSE_SCHEMA/.test(route), true);
  check('it drops entries with no usable date', /\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(e\.date\)/.test(route), true);
  check('it keeps one row per date', /seen\.has\(e\.date\)/.test(route), true);
  check('and still refuses a file this app did not upload', /isOwnStorage\(url\)/.test(route), true);
}

// ---------------------------------------------------------------------------
console.log('\nputting a service back to what the document said');
{
  const planSrc = extractFunction('_lectResetPlan');
  check('there is one place that decides what a reset changes', !!planSrc, true);
  if (planSrc) {
    const plan = (saved, fromDoc) => new Function('_readingRefsByDate', 'SBQ_READINGS',
      planSrc + '\nreturn _lectResetPlan;')({ '2026-11-01': saved || {} }, { SLOTS })('2026-11-01', fromDoc);

    const DOC = { reading1: 'Revelation 7:9-17', psalm: 'Psalm 34:1-10, 22',
                  reading2: '1 John 3:1-3', gospel: 'Matthew 5:1-12' };

    check('a service already matching the document changes nothing', plan(DOC, DOC), []);
    check('one reading edited by hand is the one put back',
      plan(Object.assign({}, DOC, { gospel: 'John 11:32-44' }), DOC).map(c => c.label), ['Gospel']);
    check('and it carries both values, so the prompt can name them',
      plan(Object.assign({}, DOC, { gospel: 'John 11:32-44' }), DOC).map(c => c.from + ' -> ' + c.to),
      ['John 11:32-44 -> Matthew 5:1-12']);
    check('an empty slot the document fills reads as (empty)',
      plan({ reading1: '', psalm: DOC.psalm, reading2: DOC.reading2, gospel: DOC.gospel }, DOC).map(c => c.from),
      ['(empty)']);
    check('a service with nothing saved is put back whole', plan({}, DOC).map(c => c.idx), [0, 1, 2, 3]);

    // The one that would quietly destroy work. The document not mentioning a
    // psalm is not the document saying there is no psalm, so a slot it left
    // blank must never clear a reading somebody added by hand.
    check('a slot the document left blank is left alone',
      plan(DOC, { reading1: DOC.reading1, psalm: '', reading2: '', gospel: DOC.gospel }), []);
    check('even when the saved reading is the only one there',
      plan({ psalm: 'Psalm 23' }, { reading1: '', psalm: '', reading2: '', gospel: '' }), []);

    check('a date the document never covered changes nothing', plan(DOC, {}), []);
    check('and neither does a missing one', plan(DOC, null), []);
  }

  // The button and the reset can only agree by reading the same function.
  const resetSrc = raw.slice(raw.indexOf('function _renderReadingResetButton'));
  const resetBody = resetSrc.slice(0, resetSrc.indexOf('\n  }\r\n'));
  check('the button asks the shared plan', /_lectResetPlan\(iso, found\.slots\)/.test(resetBody), true);
  const doSrc = raw.slice(raw.indexOf('function resetReadingsToLectionary'));
  const doBody = doSrc.slice(0, doSrc.indexOf('\n  }\r\n'));
  check('and so does the reset itself', /_lectResetPlan\(iso, found\.slots\)/.test(doBody), true);
  check('the reset writes to the roster', /SBQ_READINGS\.setReference\(iso, changes\[i\]\.idx/.test(doBody), true);
  check('it asks before changing anything', /customConfirm/.test(doBody), true);
  check('naming each change rather than counting them', /c\.label \+ ': ' \+ c\.from/.test(doBody), true);
  check('it is offered only in Day view', /_renderReadingResetButton\(_currentReadingDate\);/.test(raw), true);

  // A reset needs something to go back TO.
  check('the import stores the document\u2019s own readings', /readings\[e\.date\] = \{/.test(raw), true);
  check('and the source row carries them', /readings: rec\.readings \|\| \{\}/.test(raw), true);
  // Building the map is not the same as handing it over. Dropping the one
  // line that puts it on the record leaves the import looking correct and
  // every future reset with nothing to go back to.
  check('and the import actually hands them to the record',
    /serviceDates: Object\.keys\(dates\)\.sort\(\),\s*readings: readings,/.test(raw), true);
  check('the migration has a column for them',
    fs.readFileSync(path.join(__dirname, '..', 'migrations', '2026-10-26_add_lectionary_sources.sql'), 'utf8')
      .indexOf('readings      jsonb') !== -1, true);
}

// ---------------------------------------------------------------------------
console.log('\na new order opens with its readings in place');
{
  // fillReadingsFromRoster already existed, wired into the roster's service
  // card only. An order made from the New Order dialog -- the usual way --
  // opened with four empty slots beside a roster that had all four.
  const modal = raw.slice(raw.indexOf('function createOrderFromModal'));
  const modalBody = modal.slice(0, modal.indexOf('\n  }\r\n'));
  check('the New Order dialog fills them too',
    /fillReadingsFromRoster\(\{ dateStr: serviceDate, quiet: true \}\)/.test(modalBody), true);
  check('only when the order has a service date',
    /serviceDate && typeof fillReadingsFromRoster/.test(modalBody), true);
  check('and quietly, since no readings yet is normal', /quiet: true/.test(modalBody), true);
  check('the roster service card still does it as well',
    /window\.WO\.fillReadingsFromRoster\(\{ dateStr: serviceDate/.test(raw), true);
}

// ---------------------------------------------------------------------------
const failed = results.filter(ok => !ok).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
