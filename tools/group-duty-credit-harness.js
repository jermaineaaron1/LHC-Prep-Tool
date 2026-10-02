'use strict';
// Regression harness for crediting a duty rostered to a GROUP.
//
// WHY THIS EXISTS
// "All Teachers" is a real roster value meaning every Sunday School teacher on
// file -- confirmed by the user on 2026-10-02 -- and is how a Sunday School
// slot is filled when they all serve together.
//
// Matching a member by name misses it entirely. A duty written that way
// reached NOBODY: not the group, because no one is called that, and not the
// individuals, because their names are not on the row. Their calendars were
// short by it and so were their serving stats.
//
// Measured when this was written: one such row, already past, so nothing was
// missing yet. The next one would have failed the same silent way.
//
// WHAT IS EASY TO GET WRONG
// The mapping exists TWICE, in two runtimes that cannot share code: as
// GROUP_LABELS in app/api/calendar/route.ts (which fills calendars) and as
// ROSTER_GROUP_LABELS in Index.html (which fills the serving stats). If they
// drift, a duty counts in one place and not the other and nobody notices.
// That is the first thing checked here.
//
// Membership is read from roster_names rather than listed anywhere, so it
// cannot go stale when somebody joins or leaves the team.
//
// USAGE
//   node tools/group-duty-credit-harness.js                 # ../Index.html
//   node tools/group-duty-credit-harness.js path/to/file.html
//   node tools/group-duty-credit-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show c79b611:Index.html > x`).
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
const ROUTE = path.join(__dirname, '..', 'app', 'api', 'calendar', 'route.ts');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}

const raw = fs.readFileSync(INDEX, 'utf8');
const lines = raw.split('\n');

function extractMethod(name, optional) {
  const startIdx = lines.findIndex(l => new RegExp('^    ' + name + ':\\s*function\\s*\\(').test(l));
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

const freqFor = extractMethod('_enablersFreqFor', true);
const labelsFor = extractMethod('_enablersGroupLabelsFor', true);
console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  _enablersGroupLabelsFor @ ' + (labelsFor ? 'line ' + labelsFor.line : 'ABSENT'));
console.log('  _enablersFreqFor        @ ' + (freqFor ? 'line ' + freqFor.line : 'ABSENT') + '\n');

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

function parseMap(src, varName) {
  const m = src.match(new RegExp(varName + '[^=]*=\\s*\\{([^}]*)\\}'));
  if (!m) return null;
  const out = {};
  m[1].split(',').forEach(pair => {
    const kv = pair.split(':');
    if (kv.length < 2) return;
    const k = kv[0].trim().replace(/^['"]|['"]$/g, '');
    const v = kv[1].trim().replace(/^['"]|['"]$/g, '');
    if (k) out[k] = v;
  });
  return out;
}

// ---------------------------------------------------------------------------
console.log('the two copies of the mapping agree');
{
  const appMap = parseMap(raw, 'ROSTER_GROUP_LABELS');
  const routeMap = fs.existsSync(ROUTE) ? parseMap(fs.readFileSync(ROUTE, 'utf8'), 'GROUP_LABELS') : null;
  if (EXPECT_BROKEN) {
    check('(pre-change) the app had no group mapping', appMap, null);
  } else {
    check('the app has one', !!appMap, true);
    check('the calendar route has one', !!routeMap, true);
    check('they are identical', appMap, routeMap);
    check('"all teachers" means the sundayschool category',
      appMap && appMap['all teachers'], 'sundayschool');
  }
}

// ---------------------------------------------------------------------------
console.log('\na group duty is credited to its members');
if (!freqFor || !labelsFor) {
  if (EXPECT_BROKEN) check('(pre-change) nothing credited a group duty', true, true);
  else check('both helpers exist', false, true);
} else {
  const env = {
    _nameNorm: s => (s || '').trim().replace(/\s+/g, ' ').toLowerCase(),
    _PAIR_SEP: / +\/ +| +& +| +and +/i,
    ROSTER_GROUP_LABELS: { 'all teachers': 'sundayschool' },
    Object: Object, String: String, Date: Date, Math: Math
  };
  env.splitCellPeople = function (value) {
    if (!value || typeof value !== 'string') return [];
    const v = value.trim();
    if (!v || v === '-' || v === '__BLANK__' || v.toUpperCase() === 'TBD') return [];
    return v.split(env._PAIR_SEP).map(s => s.trim()).filter(Boolean);
  };
  const keys = Object.keys(env);
  const api = new Function(...keys,
    'return {' + labelsFor.text + ',\n' + freqFor.text + '};')(...keys.map(k => env[k]));

  // Three Sunday School teachers, one singer who is not one.
  api._enablersCatsCache = {
    'leanne ong': { sundayschool: true },
    'audrey yap': { sundayschool: true },
    'karen tham': { sundayschool: true },
    'dorine nathaniel': { singer: true }
  };
  const thisMonth = new Date().getMonth();
  api._enablersFreqCache = [
    { role_id: 'ssteacher1', month: thisMonth, value: 'Leanne Ong' },
    { role_id: 'ssteacher3', month: thisMonth, value: 'All Teachers' },
    { role_id: 'singer1', month: thisMonth, value: 'Dorine Nathaniel' }
  ];

  check('a teacher is offered the group label',
    api._enablersGroupLabelsFor('Leanne Ong'), ['all teachers']);
  check('a singer is not', api._enablersGroupLabelsFor('Dorine Nathaniel'), []);
  check('somebody unknown is not', api._enablersGroupLabelsFor('Nobody At All'), []);

  check('a named teacher gets her own duty AND the group one',
    api._enablersFreqFor('Leanne Ong').year, 2);
  check('a teacher named nowhere still gets the group duty',
    api._enablersFreqFor('Audrey Yap').year, 1);
  check('and so does the third', api._enablersFreqFor('Karen Tham').year, 1);
  check('the singer is not credited with a Sunday School duty',
    api._enablersFreqFor('Dorine Nathaniel').year, 1);
  check('somebody in no group gets nothing', api._enablersFreqFor('Nobody At All').year, 0);

  // The group row must land under the right role, not be lumped in.
  check('the group duty is counted under its own role',
    api._enablersFreqFor('Audrey Yap').roles, { ssteacher3: 1 });

  // A mentor/trainee cell must still work -- that was here first.
  api._enablersFreqCache.push({ role_id: 'usher1', month: thisMonth, value: 'Audrey Yap / Karen Tham' });
  check('a shared cell still counts for both', api._enablersFreqFor('Audrey Yap').year, 2);
  check('and for the other', api._enablersFreqFor('Karen Tham').year, 2);
}

// ---------------------------------------------------------------------------
// Only meaningful against the live file. route.ts is not versioned alongside
// a historical Index.html handed in on the command line, so checking a past
// Index against today's route compares two different points in time -- which
// is exactly what made the negative control fail the first time it was run.
const LIVE = INDEX === path.join(__dirname, '..', 'Index.html');
console.log('\nthe calendar route fetches them too');
if (!LIVE) {
  console.log('  --   skipped: route.ts is not versioned with the file given');
} else {
  const route = fs.existsSync(ROUTE) ? fs.readFileSync(ROUTE, 'utf8') : '';
  const readsCategories = /from\('roster_names'\)[\s\S]{0,120}?ilike\('name', likePattern\)/.test(route);
  const fetchesGroupRows = /myLabels[\s\S]{0,400}?from\('roster'\)[\s\S]{0,200}?ilike\('value', label\)/.test(route);
  const walksBoth = /for \(const row of \[\.\.\.\(data \|\| \[\]\), \.\.\.groupRows\]\)/.test(route);
  const saysShared = /sharedNote/.test(route);
  if (EXPECT_BROKEN) {
    check('(pre-change) the route fetched no group duties', fetchesGroupRows, false);
  } else {
    check('it reads which categories the member is in', readsCategories, true);
    check('it fetches the duties of groups they belong to', fetchesGroupRows, true);
    check('it walks the member\'s own duties first', walksBoth, true);
    check('it says in the event that the duty is shared', saysShared, true);
  }
}

console.log('\n================================');
const passed = results.filter(Boolean).length;
console.log(passed + '/' + results.length + ' checks passed');
if (passed !== results.length) process.exit(1);
