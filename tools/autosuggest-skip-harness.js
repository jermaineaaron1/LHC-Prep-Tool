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

// Slice the `var assignedToday = {}; allRoleDefs.forEach(...)` seeding block.
// The candidate filter only proves assignedToday is OBEYED. This proves it is
// FILLED -- from every role on the date, not merely the ones being filled.
function extractAssignedTodaySeed() {
  const startIdx = lines.findIndex(l => /var assignedToday = \{\};/.test(l));
  if (startIdx < 0) throw new Error('assignedToday seeding not found in ' + path.basename(INDEX));
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '(' || ch === '{') { depth++; started = true; }
      else if (ch === ')' || ch === '}') depth--;
    }
    if (started && depth === 0 && i > startIdx) return { text: out.join('\n'), line: startIdx + 1 };
  }
  throw new Error('unbalanced brackets while extracting the assignedToday seeding');
}

// Slice the block that turns a PIC's people list into a pool restriction.
// The setting is only worth anything if it actually narrows the pool, and a
// restriction that is stored, shown ticked in the settings screen, and then
// ignored by the picker is the failure nobody would see until a name they had
// unticked turned up on a Sunday.
function extractPoolRestriction() {
  const startIdx = lines.findIndex(l => /var allowedPeople = _dutySettingField/.test(l));
  if (startIdx < 0) throw new Error('pool restriction not found in ' + path.basename(INDEX));
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n'), line: startIdx + 1 };
  }
  throw new Error('unbalanced braces while extracting the pool restriction');
}

// The per-duty monthly limit, as the picker resolves it.
function extractCapResolution() {
  const i = lines.findIndex(l => /var monthlyCap = _dutySettingField/.test(l));
  if (i < 0) throw new Error('monthly cap not found in ' + path.basename(INDEX));
  return { text: lines[i].trim() + '\n' + lines[i + 1].trim(), line: i + 1 };
}

// Slice the block that applies pairing rules to the pool.
function extractPairingApply() {
  const startIdx = lines.findIndex(l => /var firing = _firingPairings\(/.test(l));
  if (startIdx < 0) throw new Error('pairing block not found in ' + path.basename(INDEX));
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0 && /\}\);\s*$/.test(lines[i])) return { text: out.join('\n'), line: startIdx + 1 };
  }
  throw new Error('unbalanced braces while extracting the pairing block');
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
const seed = extractAssignedTodaySeed();
const poolRestrict = extractPoolRestriction();
const capResolve = extractCapResolution();
const pairApply = extractPairingApply();
for (const n of fnNames) console.log('  ' + n + ' @ line ' + fns[n].line);
console.log('  AUTOSUGGEST_SKIP_STATUS @ line ' + skipMap.line);
console.log('  runAutoSuggest candidate filter @ line ' + filter.line);
console.log('  assignedToday seeding @ line ' + seed.line);
console.log('  pool restriction @ line ' + poolRestrict.line);
console.log('  monthly cap @ line ' + capResolve.line);
console.log('  pairing rules @ line ' + pairApply.line);

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

// ── 4. Same-service double-booking, end to end ────────────────────────────
// Scenario 3 proves the filter obeys assignedToday. That is only half of it:
// the map has to be FILLED from every role on the date, and topped up after
// each pick, or Auto-Suggest would happily roster one person twice in one
// service and leave the clash for a human to notice by eye.
console.log('\nScenario 4 - Auto-Suggest cannot double-book one service');

function seedAssignedToday(editsByRole, roleIds) {
  const api = makePredicates({});
  const env = {
    allRoleDefs: roleIds.map(id => ({ id })),
    dateKeySuffix: 'Dec_6',
    STATE: { rosterEdits: new Map(Object.entries(editsByRole).map(([r, v]) => [r + '__Dec_6', v])) },
    splitCellPeople: api.splitCellPeople,
    _afKey: n => (n || '').trim().replace(/\s+/g, ' ').toLowerCase(),
    Object, JSON, Map
  };
  const body = seed.text + '\n; return assignedToday;';
  const keys = Object.keys(env);
  return new Function(...keys, body)(...keys.map(k => env[k]));
}

{
  const predicates = makePredicates({});
  const pool = ['Ann Lee', 'Ben Ooi'];

  const seeded = seedAssignedToday({ usher1: 'Ann Lee' }, ['usher1', 'singer1', 'reader1']);
  check('a duty outside this run still blocks',
    runFilter({ pool, predicates, roleId: 'singer1', assignedToday: seeded }), ['Ben Ooi']);

  const pair = seedAssignedToday({ pianist: 'Ann Lee / Ben Ooi' }, ['pianist', 'singer1']);
  check('both people in an "A / B" cell block',
    runFilter({ pool, predicates, roleId: 'singer1', assignedToday: pair }), []);

  // A stray second space must not make one person look like two -- the exact
  // fault that hid Alison Phan on Usher 2 + Singer 1 from clash detection.
  const spaced = seedAssignedToday({ usher1: 'Ann  Lee' }, ['usher1', 'singer1']);
  check('a stray double space still blocks',
    runFilter({ pool, predicates, roleId: 'singer1', assignedToday: spaced }), ['Ben Ooi']);

  // Flower Arrangement is done the day before, so it seeds nobody.
  const flower = seedAssignedToday({ flowerarrangement: 'Ann Lee' }, ['flowerarrangement', 'singer1']);
  check('flower arrangement seeds nobody', Object.keys(flower), []);

  // And the run tops the map up after each pick, so the second role in one
  // run cannot reuse the first role's winner.
  const running = seedAssignedToday({}, ['usher1', 'singer1']);
  check('nothing assigned yet',
    runFilter({ pool, predicates, roleId: 'usher1', assignedToday: running }), pool);
  const recordsWinner = /if \(role\.id !== 'flowerarrangement'\) assignedToday\[winnerKey\] = true;/.test(src);
  check('the run records its own winner in assignedToday', recordsWinner, true);
  if (recordsWinner) {
    running['ann lee'] = true;   // exactly what that line does
    check('the next role in the same run cannot reuse the winner',
      runFilter({ pool, predicates, roleId: 'singer1', assignedToday: running }), ['Ben Ooi']);
  }
}

// ── 5. A PIC's per-duty settings actually bite ────────────────────────────
// TEAM_ROLE_CONFIG only ever SORTED the pool -- someone outside the list could
// still be picked when the list was busy. A PIC's list is the opposite: a hard
// restriction, chosen so Auto-Suggest can never volunteer a name they did not
// approve for that duty. That difference has to be real in the picker, not
// only in the settings screen.
console.log('\nScenario 5 - per-duty settings from the settings screen');

const dutyFns = ['_dutySetting', '_dutySettingField'].map(n => extractFn(n));

function restrictPool(pool, settings, roleId, team) {
  const env = {
    pool: pool.slice(),
    role: { id: roleId || 'pianist' },
    team: team || 'traditional',
    ROSTER_DUTY_SETTINGS: settings,
    _afKey: n => (n || '').trim().replace(/\s+/g, ' ').toLowerCase(),
    Object, JSON
  };
  const body = dutyFns.map(f => f.text).join('\n') + '\n' + poolRestrict.text + '\n; return pool;';
  const keys = Object.keys(env);
  return new Function(...keys, body)(...keys.map(k => env[k]));
}

function resolveCap(settings, roleId, team) {
  const env = {
    role: { id: roleId || 'pianist' },
    team: team || 'traditional',
    ROSTER_DUTY_SETTINGS: settings,
    Object, JSON
  };
  const body = dutyFns.map(f => f.text).join('\n') + '\n' + capResolve.text + '\n; return monthlyCap;';
  const keys = Object.keys(env);
  return new Function(...keys, body)(...keys.map(k => env[k]));
}

{
  const pool = ['Ann Lee', 'Ben Ooi', 'Cara Tan'];

  check('no setting leaves the pool alone', restrictPool(pool, {}), pool);

  const restricted = { 'pianist__traditional': { people: ['Ben Ooi'], monthlyCap: null, applies: null } };
  check('a list is a restriction, not a preference',
    restrictPool(pool, restricted), ['Ben Ooi']);

  // The settings screen offers the duty's own name list, but a PIC can have
  // approved somebody who is not on it yet; dropping them silently would make
  // a ticked box do nothing.
  const outsider = { 'pianist__traditional': { people: ['Dan Foo'], monthlyCap: null, applies: null } };
  check('a name not in the dropdown is still usable',
    restrictPool(pool, outsider), ['Dan Foo']);

  // Whitespace again: the list is stored as typed, the pool comes from the
  // roster, and _afKey is what keeps them the same person.
  const spaced = { 'pianist__traditional': { people: ['Ben  Ooi'], monthlyCap: null, applies: null } };
  check('a stray double space still matches', restrictPool(pool, spaced), ['Ben Ooi']);

  // Service type: the specific row wins, the 'all' row is the fallback.
  const perType = {
    'pianist__all': { people: ['Ann Lee'], monthlyCap: null, applies: null },
    'pianist__contemporary': { people: ['Cara Tan'], monthlyCap: null, applies: null }
  };
  check('the Traditional list falls back to the all-services row',
    restrictPool(pool, perType, 'pianist', 'traditional'), ['Ann Lee']);
  check('the Contemporary list wins where it is set',
    restrictPool(pool, perType, 'pianist', 'contemporary'), ['Cara Tan']);

  check('no cap set means the built-in 2', resolveCap({}), 2);
  check('a cap of 4 is honoured',
    resolveCap({ 'pianist__traditional': { people: null, monthlyCap: 4, applies: null } }), 4);
  check('a nonsense cap falls back to 2',
    resolveCap({ 'pianist__traditional': { people: null, monthlyCap: 0, applies: null } }), 2);
}

// ── 6. Who goes with whom ─────────────────────────────────────────────────
// A rule fires off a cell that is already filled -- usually by hand, sometimes
// by an earlier role in the same run. The ways it can quietly not fire are the
// interesting ones: the wrong service type, a name that differs by a space, or
// a trigger person who is the second half of a mentor/trainee cell.
console.log('\nScenario 6 - pairing rules');

const fireFn = extractFn('_firingPairings');

function firing(rules, edits, roleId, team) {
  const api = makePredicates({});
  const env = {
    ROSTER_DUTY_PAIRINGS: rules,
    STATE: { rosterEdits: new Map(Object.entries(edits).map(([r, v]) => [r + '__Dec_6', v])) },
    splitCellPeople: api.splitCellPeople,
    _nameNorm: s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(),
    Object, JSON, Map
  };
  const body = fireFn.text + '\n; return _firingPairings(' +
    JSON.stringify(roleId) + ', ' + JSON.stringify(team) + ', "Dec_6");';
  const keys = Object.keys(env);
  return new Function(...keys, body)(...keys.map(k => env[k]));
}

function applyPairing(rules, edits, pool, roleId, team) {
  const api = makePredicates({});
  const env = {
    pool: pool.slice(),
    role: { id: roleId },
    team: team,
    dateKeySuffix: 'Dec_6',
    ROSTER_DUTY_PAIRINGS: rules,
    STATE: { rosterEdits: new Map(Object.entries(edits).map(([r, v]) => [r + '__Dec_6', v])) },
    splitCellPeople: api.splitCellPeople,
    _nameNorm: s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(),
    _afKey: n => (n || '').trim().replace(/\s+/g, ' ').toLowerCase(),
    self: { _roleWord: r => r },
    Object, JSON, Map
  };
  const body = fireFn.text + '\n' + pairApply.text +
    '\n; return { pool: pool, preferred: pairPreferred ? Object.keys(pairPreferred).sort() : null };';
  const keys = Object.keys(env);
  return new Function(...keys, body)(...keys.map(k => env[k]));
}

{
  const DORINE = { whenRole: 'liturgist', whenPerson: 'Dorine Nathaniel', serviceType: 'all',
                   thenRole: 'drummer', thenPeople: ['Edwin Nathaniel', 'Luke Yong'], strict: false };
  const ALISON = { whenRole: 'singer1', whenPerson: 'Alison Phan', serviceType: 'traditional',
                   thenRole: 'singer2', thenPeople: ['Cynthia Lim', 'Gina Tai'], strict: false };

  check('fires when the named person is on the watched duty',
    firing([DORINE], { liturgist: 'Dorine Nathaniel' }, 'drummer', 'traditional').length, 1);
  check('does not fire for somebody else on that duty',
    firing([DORINE], { liturgist: 'Allan Yip' }, 'drummer', 'traditional').length, 0);
  check('does not fire when the watched duty is empty',
    firing([DORINE], {}, 'drummer', 'traditional').length, 0);
  check('does not fire for a different duty',
    firing([DORINE], { liturgist: 'Dorine Nathaniel' }, 'pianist', 'traditional').length, 0);

  // Service type, from the second example: traditional Sundays only.
  check('a traditional-only rule fires on a traditional Sunday',
    firing([ALISON], { singer1: 'Alison Phan' }, 'singer2', 'traditional').length, 1);
  check('a traditional-only rule stays quiet on a contemporary one',
    firing([ALISON], { singer1: 'Alison Phan' }, 'singer2', 'contemporary').length, 0);

  // The two ways a trigger can be present without matching a plain string.
  check('a stray double space still triggers',
    firing([DORINE], { liturgist: 'Dorine  Nathaniel' }, 'drummer', 'traditional').length, 1);
  check('the trainee half of a paired cell still triggers',
    firing([DORINE], { liturgist: 'Allan Yip / Dorine Nathaniel' }, 'drummer', 'traditional').length, 1);

  const pool = ['Edwin Nathaniel', 'Gabriel Goh', 'Luke Yong'];

  // Soft: prefer, never narrow. A blank drummer is worse than an unfamiliar one.
  const soft = applyPairing([DORINE], { liturgist: 'Dorine Nathaniel' }, pool, 'drummer', 'traditional');
  check('a soft rule leaves everyone eligible', soft.pool, pool);
  check('a soft rule marks who to reach for first',
    soft.preferred, ['edwin nathaniel', 'luke yong']);

  // Strict: only them, and someone named but not in the pool is added rather
  // than silently dropped.
  const strictRule = Object.assign({}, DORINE, { strict: true });
  const strict = applyPairing([strictRule], { liturgist: 'Dorine Nathaniel' }, pool, 'drummer', 'traditional');
  check('a strict rule narrows the pool to the named people',
    strict.pool.sort(), ['Edwin Nathaniel', 'Luke Yong']);

  // Two rules on one duty: whoever satisfies both is the answer.
  const other = { whenRole: 'pianist', whenPerson: 'Esther Lee', serviceType: 'all',
                  thenRole: 'drummer', thenPeople: ['Luke Yong', 'Gabriel Goh'], strict: false };
  const both = applyPairing([DORINE, other],
    { liturgist: 'Dorine Nathaniel', pianist: 'Esther Lee' }, pool, 'drummer', 'traditional');
  check('two soft rules intersect rather than pile up', both.preferred, ['luke yong']);

  check('no rules means no preference',
    applyPairing([], {}, pool, 'drummer', 'traditional').preferred, null);
}

// ── 7. When two PIC settings disagree ─────────────────────────────────────
// Both of these are things a PIC sets, and the screen describes each of them as
// absolute: the approved list says Auto-Suggest can "never volunteer a name they
// did not approve", and a strict rule says "only them". Put a name in one and not
// the other and something has to give. This runs the two real blocks in the order
// Auto-Suggest runs them, so whichever wins, it is on the record.
console.log('\nScenario 7 - an approved list against a strict pairing rule');

function restrictThenPair(settings, rules, edits, pool, roleId, team) {
  const api = makePredicates({});
  const env = {
    pool: pool.slice(),
    role: { id: roleId },
    team: team,
    dateKeySuffix: 'Dec_6',
    ROSTER_DUTY_SETTINGS: settings,
    ROSTER_DUTY_PAIRINGS: rules,
    STATE: { rosterEdits: new Map(Object.entries(edits).map(([r, v]) => [r + '__Dec_6', v])) },
    splitCellPeople: api.splitCellPeople,
    _nameNorm: s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(),
    _afKey: n => (n || '').trim().replace(/\s+/g, ' ').toLowerCase(),
    self: { _roleWord: r => r },
    Object, JSON, Map
  };
  const body = dutyFns.map(f => f.text).join('\n') + '\n' + fireFn.text + '\n' +
    poolRestrict.text + '\n' + pairApply.text + '\n; return pool.slice().sort();';
  const keys = Object.keys(env);
  return new Function(...keys, body)(...keys.map(k => env[k]));
}

{
  const pool = ['Edwin Nathaniel', 'Gabriel Goh', 'Luke Yong'];
  // The PIC approved only Edwin for Drummer on a traditional Sunday.
  const approved = { 'drummer__traditional': { people: ['Edwin Nathaniel'], monthlyCap: null, applies: null } };
  const edits = { liturgist: 'Dorine Nathaniel' };

  check('the approved list alone narrows to the approved name',
    restrictThenPair(approved, [], edits, pool, 'drummer', 'traditional'), ['Edwin Nathaniel']);

  // A strict rule naming somebody the PIC did NOT approve for this duty.
  const strictOther = { whenRole: 'liturgist', whenPerson: 'Dorine Nathaniel', serviceType: 'all',
                        thenRole: 'drummer', thenPeople: ['Luke Yong'], strict: true };
  // KNOWN GAP: the strict block re-adds any named person missing from the pool,
  // which at this point includes people the approved list just removed. So the
  // pairing rule wins and Luke is rostered although he was never approved for
  // Drummer -- with nothing on screen saying the two settings disagreed.
  check('a strict rule re-admits a name the approved list had excluded',
    restrictThenPair(approved, [strictOther], edits, pool, 'drummer', 'traditional'), ['Luke Yong']);

  // The benign case, for contrast: the rule names somebody already approved.
  const strictSame = Object.assign({}, strictOther, { thenPeople: ['Edwin Nathaniel'] });
  check('a strict rule agreeing with the list changes nothing',
    restrictThenPair(approved, [strictSame], edits, pool, 'drummer', 'traditional'), ['Edwin Nathaniel']);

  // A SOFT rule must never widen the pool -- it only ranks.
  const softOther = Object.assign({}, strictOther, { strict: false });
  check('a soft rule respects the approved list',
    restrictThenPair(approved, [softOther], edits, pool, 'drummer', 'traditional'), ['Edwin Nathaniel']);
}

console.log('\n================================');
const passed = results.filter(Boolean).length;
console.log(passed + '/' + results.length + ' checks passed');
if (passed !== results.length) process.exit(1);
