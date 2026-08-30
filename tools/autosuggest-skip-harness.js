'use strict';
// Regression harness for who Auto-Suggest is allowed to roster.
//
// WHY THIS EXISTS
// Auto-Suggest is PIC-only, and the roster module keeps its own private STATE,
// so `STATE.picMode` cannot be set from the console -- there is no way to drive
// runAutoSuggest from a browser session without the real PIC password. That
// leaves the exclusion rule (occasional / inactive / suspended are never
// auto-picked) with no reachable end-to-end test, which is exactly the kind of
// rule that rots silently: if the filter line is dropped, nothing on screen
// looks wrong, a Pastor simply starts appearing on the roster again.
//
// HOW IT WORKS
// Same approach as bg-repin-harness.js: it does not reimplement anything. It
// slices the REAL source text of the predicate and of runAutoSuggest's own
// candidate filter out of Index.html and executes that text against stubs. If
// someone edits those, this runs the edited version.
//
// USAGE
//   node tools/autosuggest-skip-harness.js                  # checks ../Index.html
//   node tools/autosuggest-skip-harness.js path/to/file.html
//   node tools/autosuggest-skip-harness.js <file> --expect-broken
//
// --expect-broken is the negative control: it asserts the exclusion is ABSENT,
// and is meant to be pointed at pre-fix source (e.g.
// `git show <rev>:Index.html > x`). A harness that passes on broken code proves
// nothing, so if you extend this, keep checking it still fails without the fix.
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

const src = fs.readFileSync(INDEX, 'utf8');
const lines = src.split('\n');

const results = [];
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(ok);
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')'));
}

// Slice a top-level `  function NAME(` out of the roster IIFE by brace balance.
function extractFn(name) {
  const startIdx = lines.findIndex(l => new RegExp('^  function ' + name + '\\s*\\(').test(l));
  if (startIdx < 0) throw new Error('function not found in ' + path.basename(INDEX) + ': ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n'), line: startIdx + 1 };
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}

// Slice a `var NAME = <literal>;` single-line declaration.
function extractVar(name) {
  const idx = lines.findIndex(l => new RegExp('^\\s*var ' + name + '\\s*=').test(l));
  if (idx < 0) throw new Error('var not found: ' + name);
  return { text: lines[idx].trim(), line: idx + 1 };
}

// Slice runAutoSuggest's own `var candidates = pool.filter(function(name) {...});`
// so the test runs the shipped filter rather than a copy of it.
function extractCandidateFilter() {
  const startIdx = lines.findIndex(l => /var candidates = pool\.filter\(function\(name\) \{/.test(l));
  if (startIdx < 0) throw new Error('candidate filter not found in ' + path.basename(INDEX));
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '(' || ch === '{') { depth++; started = true; }
      else if (ch === ')' || ch === '}') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n'), line: startIdx + 1 };
  }
  throw new Error('unbalanced brackets while extracting the candidate filter');
}

// ── 1. The predicate itself ────────────────────────────────────────────────
console.log('Extracted from ' + path.basename(INDEX) + ':');

const fnNames = ['getMemberStatus', '_suspensionLapsed', 'isAutoSuggestExcluded', '_rotationTagFor', 'splitCellPeople', 'cellPrimary', 'cellTrainee', 'joinCellPeople'];
if (EXPECT_BROKEN) {
  const missing = fnNames.filter(n => !new RegExp('^  function ' + n + '\\s*\\(', 'm').test(src));
  console.log('  (pre-fix source: missing ' + (missing.join(', ') || 'nothing') + ')');
  if (!missing.includes('isAutoSuggestExcluded')) {
    throw new Error('--expect-broken, but isAutoSuggestExcluded is already present');
  }
  if (/isAutoSuggestExcluded\(name\)/.test(src)) {
    throw new Error('--expect-broken, but the candidate filter already calls isAutoSuggestExcluded');
  }
  console.log('\n================================');
  console.log('confirmed pre-fix: no status exclusion anywhere');
  process.exit(0);
}

const fns = {};
for (const n of fnNames) fns[n] = extractFn(n);
const skipMap = extractVar('AUTOSUGGEST_SKIP_STATUS');
const pairSep = extractVar('_PAIR_SEP');
const filter = extractCandidateFilter();
for (const n of fnNames) console.log('  ' + n + ' @ line ' + fns[n].line);
console.log('  AUTOSUGGEST_SKIP_STATUS @ line ' + skipMap.line);
console.log('  runAutoSuggest candidate filter @ line ' + filter.line);

function makePredicates(statusByName) {
  const env = { ROSTER_MEMBER_STATUS: statusByName, Object, JSON,
    _nameNorm: (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase() };
  const body = skipMap.text + '\n' + pairSep.text + '\n' + fnNames.map(n => fns[n].text).join('\n\n') +
    '\n; return { getMemberStatus, _suspensionLapsed, isAutoSuggestExcluded, _rotationTagFor, splitCellPeople, cellPrimary, cellTrainee, joinCellPeople, AUTOSUGGEST_SKIP_STATUS };';
  const keys = Object.keys(env);
  return new Function(...keys, body)(...keys.map(k => env[k]));
}

console.log('\nScenario 1 - the predicate, one status at a time');
{
  const api = makePredicates({
    Occasional: { status: 'occasional' },
    Inactive:   { status: 'inactive' },
    Suspended:  { status: 'suspended' },
    Active:     { status: 'active' },
    NewlyJoined:{ status: 'newly_joined' }
    // "Unknown" is deliberately absent -> getMemberStatus defaults to active
  });
  check('occasional is excluded',   api.isAutoSuggestExcluded('Occasional'), true);
  check('inactive is excluded',     api.isAutoSuggestExcluded('Inactive'), true);
  check('suspended is excluded',    api.isAutoSuggestExcluded('Suspended'), true);
  check('active is NOT excluded',   api.isAutoSuggestExcluded('Active'), false);
  check('newly joined is NOT excluded', api.isAutoSuggestExcluded('NewlyJoined'), false);
  // The default matters more than it looks: every name that has never been
  // opened in Enablers has no status row at all, which is most of the roster.
  check('name with no status row is NOT excluded', api.isAutoSuggestExcluded('Unknown'), false);
}

console.log('\nScenario 2 - the badge that makes the exclusion visible');
{
  const api = makePredicates({
    Occasional: { status: 'occasional' },
    Inactive:   { status: 'inactive' },
    Suspended:  { status: 'suspended' },
    Active:     { status: 'active' }
  });
  check('occasional badge', (api._rotationTagFor('Occasional') || {}).label, 'Occasional');
  check('inactive badge',   (api._rotationTagFor('Inactive')   || {}).label, 'Inactive');
  check('suspended badge',  (api._rotationTagFor('Suspended')  || {}).label, 'Stood down');
  check('active has no badge', api._rotationTagFor('Active'), null);
  check('unknown has no badge', api._rotationTagFor('Nobody'), null);
  // Anyone Auto-Suggest skips must SAY so, or the only symptom is a name that
  // quietly stops appearing.
  const skipped = Object.keys(api.AUTOSUGGEST_SKIP_STATUS);
  const unlabelled = skipped.filter(s => {
    const probe = makePredicates({ X: { status: s } });
    return probe._rotationTagFor('X') === null;
  });
  check('every skipped status carries a badge', unlabelled, []);
}

console.log('\nScenario 2b - a suspension that has run out');
{
  // Enablers writes the suspension end month as "YYYY-MM", and nothing read
  // it back until status started excluding people. Left unread, a suspension
  // that lapsed months ago would keep someone out of every automatic pick
  // indefinitely -- silently, since the only symptom is a name that quietly
  // stops appearing. Judged against the month being ROSTERED, not today, so
  // filling April includes someone whose suspension ran to March.
  const api = makePredicates({
    Ends3:     { status: 'suspended',  suspendedTo: '2026-03' },
    OpenEnded: { status: 'suspended' },
    Junk:      { status: 'suspended',  suspendedTo: 'not-a-month' },
    Gone:      { status: 'inactive',   suspendedTo: '2020-01' },
    Occ:       { status: 'occasional', suspendedTo: '2020-01' }
  });
  check('inside the window   -> skipped', api.isAutoSuggestExcluded('Ends3', 2026, 1), true);
  check('final month itself  -> skipped', api.isAutoSuggestExcluded('Ends3', 2026, 2), true);
  check('the month after     -> allowed', api.isAutoSuggestExcluded('Ends3', 2026, 3), false);
  check('the following year  -> allowed', api.isAutoSuggestExcluded('Ends3', 2027, 0), false);
  check('an earlier year     -> skipped', api.isAutoSuggestExcluded('Ends3', 2025, 11), true);
  check('no end date         -> skipped', api.isAutoSuggestExcluded('OpenEnded', 2099, 0), true);
  check('unparseable date    -> skipped', api.isAutoSuggestExcluded('Junk', 2099, 0), true);
  check('no month supplied   -> skipped', api.isAutoSuggestExcluded('Ends3'), true);
  // The end date belongs to suspension alone; it must not readmit anyone else.
  check('inactive ignores suspendedTo',   api.isAutoSuggestExcluded('Gone', 2099, 0), true);
  check('occasional ignores suspendedTo', api.isAutoSuggestExcluded('Occ', 2099, 0), true);
  // A badge that outlives the rule is worse than no badge: it would say
  // "Stood down" about someone Auto-Suggest is already rostering again.
  check('badge inside the window', (api._rotationTagFor('Ends3', 2026, 1) || {}).label, 'Stood down');
  check('badge lapses with the rule', api._rotationTagFor('Ends3', 2026, 3), null);
  check('open-ended stays badged', (api._rotationTagFor('OpenEnded', 2099, 0) || {}).label, 'Stood down');
}

console.log('\nScenario 2c - mentor / trainee cells');
{
  const api = makePredicates({});
  const S = api.splitCellPeople;
  // Two people share a duty when someone is being brought into it. Every
  // person-aware rule -- clashes, the monthly cap, availability, status,
  // serving counts -- reads this, so the split has to be exactly right.
  check('a pair splits into two people', S('Beatrice Tye / Vincent Jayaraj'), ['Beatrice Tye', 'Vincent Jayaraj']);
  check('a lone name stays one',         S('Bruce Kong'), ['Bruce Kong']);
  check('blank cell yields nobody',      S('-'), []);
  check('__BLANK__ yields nobody',       S('__BLANK__'), []);
  check('TBD yields nobody',             S('TBD'), []);
  check('empty yields nobody',           S(''), []);
  // The separator needs a space on BOTH sides. This real Preacher entry means
  // "with", and a looser rule would invent "Rev Devasadan Consecrating)".
  check('"(W/ ...)" is never split',      S('Rev Benedict Muthusamy\\n(W/ Rev Devasadan Consecrating)').length, 1);
  check('a bare A/B is never split',      S('A/B'), ['A/B']);
  // The roster was written by hand long before there was a control for it,
  // so these two forms are real: "Esther & Yee Ching" on Pianist and
  // "Eva and Charrise" on Liturgist.
  check('ampersand splits',               S('Esther Lee & Yee Ching'), ['Esther Lee', 'Yee Ching']);
  check('the word and splits',            S('Eva Muthusamy and Charrise Goh'), ['Eva Muthusamy', 'Charrise Goh']);
  check('capital AND splits',             S('A AND B'), ['A', 'B']);
  // ...but only with a space each side, so ordinary names survive.
  check('"Anand" is one name',            S('Anand Kumar'), ['Anand Kumar']);
  check('"Alexander" is one name',        S('Alexander Tan'), ['Alexander Tan']);
  check('"A&B" unspaced is one name',     S('A&B'), ['A&B']);
  check('a three-way split still yields 3', S('A / B & C').length, 3);
  check('extra spaces still split',       S('A  /  B'), ['A', 'B']);
  check('primary of a pair',              api.cellPrimary('A / B'), 'A');
  check('trainee of a pair',              api.cellTrainee('A / B'), 'B');
  check('trainee of a lone name is empty',api.cellTrainee('A'), '');
  // Joining clamps to two: picking a leftover composite as the trainee once
  // produced a three-name cell in testing.
  check('join makes a pair',              api.joinCellPeople('A', 'B'), 'A / B');
  check('join with no trainee',           api.joinCellPeople('A', ''), 'A');
  check('join refuses to duplicate',      api.joinCellPeople('A', 'A'), 'A');
  check('join clamps a composite trainee',api.joinCellPeople('A', 'B / C'), 'A / B');
  check('join clamps a composite lead',   api.joinCellPeople('A / B', 'C'), 'A / C');
}

// ── 3. The filter as runAutoSuggest actually runs it ───────────────────────
console.log('\nScenario 3 - runAutoSuggest\'s own candidate filter');

function runFilter(opts) {
  const env = {
    pool: opts.pool,
    role: { id: opts.roleId || 'preacher' },
    assignedToday: opts.assignedToday || {},
    dateStr: 'Aug 9',
    category: 'preacher',
    STATE: { rosterYear: 2026 },
    _afKey: n => (n || '').trim().replace(/\s+/g, ' ').toLowerCase(),
    isPersonUnavailable: n => !!(opts.unavailable || {})[n],
    isAutoSuggestExcluded: opts.predicates.isAutoSuggestExcluded,
    Object, JSON
  };
  const body = filter.text + '\n; return candidates;';
  const keys = Object.keys(env);
  return new Function(...keys, body)(...keys.map(k => env[k]));
}

{
  const predicates = makePredicates({
    'Ps. Occasional':  { status: 'occasional' },
    'Rev. Inactive':   { status: 'inactive' },
    'Mr. Suspended':   { status: 'suspended' },
    'Mrs. Regular':    { status: 'active' }
  });
  const pool = ['Ps. Occasional', 'Rev. Inactive', 'Mr. Suspended', 'Mrs. Regular', 'Ms. NoRecord'];

  check('only rosterable people survive the filter',
    runFilter({ pool, predicates }), ['Mrs. Regular', 'Ms. NoRecord']);

  // The pre-existing rules must still hold alongside the new one.
  check('already serving today is still excluded',
    runFilter({ pool, predicates, assignedToday: { 'mrs. regular': true } }), ['Ms. NoRecord']);
  check('date-range unavailability is still excluded',
    runFilter({ pool, predicates, unavailable: { 'Ms. NoRecord': true } }), ['Mrs. Regular']);

  // Flower Arrangement happens the day before the service, so it alone ignores
  // assignedToday -- but never the status exclusion.
  check('flowerarrangement ignores assignedToday but not status',
    runFilter({ pool, predicates, roleId: 'flowerarrangement', assignedToday: { 'mrs. regular': true } }),
    ['Mrs. Regular', 'Ms. NoRecord']);

  // An all-excluded pool must come back empty rather than relaxing the rule:
  // this is a hard exclusion, not a ranking penalty.
  check('a wholly excluded pool yields nobody',
    runFilter({ pool: ['Ps. Occasional', 'Rev. Inactive'], predicates }), []);
}

console.log('\n================================');
const passed = results.filter(Boolean).length;
console.log(passed + '/' + results.length + ' checks passed');
if (passed !== results.length) process.exit(1);
