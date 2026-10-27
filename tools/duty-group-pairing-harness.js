'use strict';
// Regression harness for "who goes with whom" across duties that come in
// several identical slots.
//
// WHY THIS EXISTS
// A pairing rule is about PEOPLE. "If Audrey sings, Charisse sings" is a
// statement about the music; which of four identical singer rows each of them
// lands in is an accident of the grid. The rules used to match an exact slot
// at both ends, so a rule written against Singer 2 did nothing when Audrey
// turned up in Singer 1, and nothing again when the only free row was
// Singer 3.
//
// THE PART THAT IS EASY TO GET WRONG
// Matching by group is half the job. A group rule is satisfied ONCE. Without
// that, a strict rule demands Charisse in EVERY singer row: she fills
// Singer 2, then Singer 3 is also required to be her, cannot be, and is left
// blank -- so a change meant to make rostering easier would silently cost a
// singer every week. That case is the reason this file exists, and it is
// checked from both directions: satisfied by a sibling means the rule stops
// applying, and NOT satisfied means it still does.
//
// HOW IT WORKS
// It reimplements nothing. It slices the real _dutySiblings and
// _firingPairings out of Index.html and runs them against a stub roster.
//
// USAGE
//   node tools/duty-group-pairing-harness.js
//   node tools/duty-group-pairing-harness.js path/to/file.html
//   node tools/duty-group-pairing-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change,
// where both ends matched one exact slot.
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

const firing = extractFunction('_firingPairings');
const siblings = extractFunction('_dutySiblings');
const roleCat = extractFunction('getRoleCategory');

console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  _firingPairings  ' + (firing ? 'found' : 'ABSENT'));
console.log('  _dutySiblings    ' + (siblings ? 'found' : 'ABSENT'));
console.log('  getRoleCategory  ' + (roleCat ? 'found' : 'ABSENT') + '\n');

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

if (!firing || !roleCat) { console.error('Could not slice the functions under test.'); process.exit(1); }

if (!siblings) {
  if (EXPECT_BROKEN) {
    console.log('(pre-change) there is no group helper: pairings matched one exact slot');
    console.log('\n--expect-broken: the pre-change shape is what passes');
    process.exit(0);
  }
  console.error('_dutySiblings is missing — pairings are back to exact-slot matching.');
  process.exit(1);
}

// ---- the stub roster -------------------------------------------------------
const ROLES = [
  { id: 'preacher', type: 'role' }, { id: 'liturgist', type: 'role' },
  { id: 'singer1', type: 'role' }, { id: 'singer2', type: 'role' },
  { id: 'singer3', type: 'role' }, { id: 'singer4', type: 'role' },
  { id: 'usher1', type: 'role' }, { id: 'usher2', type: 'role' },
  { id: 'pianist', type: 'role' },
  { id: 'h_music', type: 'header' },
];
const DATE = 'Oct_4';
let CELLS = {};
const STATE = { rosterEdits: { get: (k) => CELLS[k] } };
const _nameNorm = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const splitCellPeople = (v) => String(v || '').split('/').map(x => x.trim()).filter(Boolean);
let PAIRINGS = [];

function build() {
  const env = {
    STATE, _nameNorm, splitCellPeople,
    get ROSTER_DUTY_PAIRINGS() { return PAIRINGS; },
    window: { RosterEngine: { ROLES } },
  };
  // getRoleCategory is a plain function; the other two close over the env.
  // _dutySiblings memoises into a variable declared beside it, which the slice
  // does not reach. Supplied fresh per build, so no state leaks between cases.
  const body = 'var _dutySiblingCache = {};\n' + roleCat + '\n' + siblings + '\n' + firing +
    '\nreturn { _firingPairings: _firingPairings, _dutySiblings: _dutySiblings };';
  // The source guards on window.RosterEngine and then reads the BARE global,
  // which is the same object in a browser. Both are supplied so the slice
  // runs exactly as written rather than against a tidied-up version of it.
  const keys = ['STATE', '_nameNorm', 'splitCellPeople', 'ROSTER_DUTY_PAIRINGS', 'window', 'RosterEngine'];
  return new Function(...keys, body)(
    STATE, _nameNorm, splitCellPeople, PAIRINGS, env.window, env.window.RosterEngine);
}

const rule = (over) => Object.assign({
  whenRole: 'singer1', whenPerson: 'Audrey Yap', serviceType: 'all',
  thenRole: 'singer2', thenPeople: ['Charisse Goh'], strict: true,
}, over);
const fire = (slot) => build()._firingPairings(slot, 'contemporary', DATE).length;

// ---------------------------------------------------------------------------
console.log('slots that belong together');
{
  const api = build();
  check('the four singers are one group', api._dutySiblings('singer3'),
    ['singer1', 'singer2', 'singer3', 'singer4']);
  check('ushers are their own group', api._dutySiblings('usher2'), ['usher1', 'usher2']);
  check('a preacher is a group of one', api._dutySiblings('preacher'), ['preacher']);
  check('headers are not duty slots', api._dutySiblings('singer1').indexOf('h_music'), -1);
}

// ---------------------------------------------------------------------------
console.log('\na rule is about the people, not the row they land in');
{
  PAIRINGS = [rule()];
  CELLS = { ['singer1__' + DATE]: 'Audrey Yap' };
  check('the trigger fires from the slot it names', fire('singer2'), 1);
  check('...and is answerable from a different slot', fire('singer3'), 1);

  // The trigger moved. Written against Singer 1, Audrey is in Singer 2.
  CELLS = { ['singer2__' + DATE]: 'Audrey Yap' };
  check('the trigger fires wherever that person is singing', fire('singer3'), 1);

  CELLS = { ['liturgist__' + DATE]: 'Audrey Yap' };
  check('but not when she is on an unrelated duty', fire('singer3'), 0);

  CELLS = {};
  check('and not when she is not rostered at all', fire('singer2'), 0);
}

// ---------------------------------------------------------------------------
console.log('\na group rule is satisfied once');
{
  // THE bug this guards. Without it a strict rule wants Charisse in every
  // singer row, and every row after the first is left blank.
  PAIRINGS = [rule()];
  CELLS = { ['singer1__' + DATE]: 'Audrey Yap', ['singer2__' + DATE]: 'Charisse Goh' };
  check('once Charisse is singing, the rule stops constraining', fire('singer3'), 0);
  check('and does not constrain a fourth row either', fire('singer4'), 0);

  // Somebody else in the sibling slot is not an answer.
  CELLS = { ['singer1__' + DATE]: 'Audrey Yap', ['singer2__' + DATE]: 'Gina Tai' };
  check('somebody else in that slot does not satisfy it', fire('singer3'), 1);

  // A shared cell ("A / B") still counts as the named person being present.
  CELLS = { ['singer1__' + DATE]: 'Audrey Yap', ['singer2__' + DATE]: 'Gina Tai / Charisse Goh' };
  check('a shared cell counts as her being there', fire('singer3'), 0);

  // The row being FILLED is about to be overwritten, so whatever is sitting
  // in it cannot count as the rule already being met -- otherwise the rule
  // would switch itself off and Auto-Suggest could drop anyone in.
  CELLS = { ['singer1__' + DATE]: 'Audrey Yap', ['singer3__' + DATE]: 'Charisse Goh' };
  check('the row being filled does not excuse itself', fire('singer3'), 1);
}

// ---------------------------------------------------------------------------
console.log('\nthe old guarantees still hold');
{
  PAIRINGS = [rule({ serviceType: 'traditional' })];
  CELLS = { ['singer1__' + DATE]: 'Audrey Yap' };
  check('a traditional-only rule stays off a contemporary service', fire('singer2'), 0);

  PAIRINGS = [rule({ thenPeople: [] })];
  check('a rule naming nobody does nothing', fire('singer2'), 0);

  PAIRINGS = [rule({ thenRole: 'pianist' })];
  CELLS = { ['singer1__' + DATE]: 'Audrey Yap' };
  check('a rule about the pianist does not touch the singers', fire('singer2'), 0);
  check('...and does reach the pianist', build()._firingPairings('pianist', 'contemporary', DATE).length, 1);

  CELLS = { ['singer1__' + DATE]: '__BLANK__' };
  PAIRINGS = [rule()];
  check('a deliberately blank cell is not a person', fire('singer2'), 0);
}

// ---------------------------------------------------------------------------
console.log('\nthe rest of the Duty Setup screen');
{
  // The settings module runs from _dsEnsureStyle to the end of
  // openDutySettings. Bounded by name rather than by line number, which
  // would rot the first time anything above it moved.
  const from = raw.indexOf('function _dsEnsureStyle');
  const to = raw.indexOf('window.openDutySettings = openDutySettings;');
  const mod = (from >= 0 && to > from) ? raw.slice(from, to) : '';
  check('the Duty Setup module was found', mod.length > 0, true);

  // A browser dialog of this kind is unstyled, centred on the window, and
  // prefixes the question with the site's hostname. Four used to live here.
  // Comments are stripped first: this file and the source both have to
  // NAME the call in order to explain it, and a comment is not a call.
  const code = mod.replace(/^\s*\/\/.*$/gm, '');
  const confirms = (code.match(/(^|[^.\w])confirm\s*\(/g) || []).length;
  check('no native confirm() boxes are left in it', confirms, 0);
  check('it warns about unsaved work through the app\'s toast',
    /_dsAskDiscard/.test(mod) && /showToast/.test(mod), true);

  // Offering a name Auto-Suggest can never choose turns a ticked list -- which
  // is a RESTRICTION -- into a duty that quietly stops being filled.
  check('the people picker consults the exclusion test', /_dsExcluded\s*\(/.test(mod), true);
  check('a name already on the list is kept, not vanished', /ds-gone/.test(mod), true);
  check('the exclusion test is published, not copied',
    /window\.LHC_autoSuggestExcluded\s*=/.test(raw), true);
  check('and the picker reads the published one',
    /window\.LHC_autoSuggestExcluded\s*\(/.test(mod), true);

  // Copying onto a slot that never runs leaves a rule nobody wrote.
  check('copying to sibling slots exists', /_dsCopyToSiblings/.test(mod), true);
  check('and skips slots that do not run on the open service',
    /_autoFillRoleApplies\(id, _dsTeam\)/.test(mod), true);
}

// ---------------------------------------------------------------------------
const failed = results.filter(ok => !ok).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
if (EXPECT_BROKEN) {
  if (!failed) {
    console.log('\nBUT --expect-broken was given and everything passed.');
    console.log('This harness cannot tell the fix from its absence. Do not trust it.');
    process.exit(1);
  }
  console.log('\nFailures above are expected for pre-fix source.');
  process.exit(0);
}
process.exit(failed ? 1 : 0);
