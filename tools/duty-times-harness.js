'use strict';
// Regression harness for WHEN each duty happens, and therefore what counts as
// a clash.
//
// WHY THIS EXISTS
// Clashes used to be decided by CLASH_EXCEPTION_PAIRS -- a hand-kept list of
// pairs that were allowed. With 23 duties there are 253 possible pairs, so the
// list was never going to be complete, and Usher + Reader went red for no
// better reason than that nobody had added it. Each duty now declares which
// parts of the service it occupies, and an overlap is what makes a clash.
//
// The risk in that change runs the other way: a seeding mistake could turn a
// pairing the church has always been fine with into a red warning on somebody's
// roster, and nobody would know it was the model's fault rather than theirs. So
// this asserts, one by one, that every pair the old list allowed is still quiet.
//
// HOW IT WORKS
// Like the other harnesses here, it reimplements nothing: it slices the REAL
// SERVICE_SEGMENTS, DUTY_SEGMENTS_DEFAULT, CLASH_EXCEPTION_PAIRS and the four
// methods out of Index.html and runs them.
//
// USAGE
//   node tools/duty-times-harness.js                 # checks ../Index.html
//   node tools/duty-times-harness.js path/to/file.html
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const INDEX = process.argv.slice(2).find(a => !a.startsWith('--')) ||
              path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }

const src = fs.readFileSync(INDEX, 'utf8');
const lines = src.split(/\r?\n/);

const results = [];
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(ok);
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')'));
}

// Slice `    NAME:` out of the RosterEngine object literal by bracket balance,
// so the test runs the shipped definition rather than a copy of it.
function extractMember(name) {
  const startIdx = lines.findIndex(l => new RegExp('^    ' + name + ':').test(l));
  if (startIdx < 0) throw new Error('member not found in ' + path.basename(INDEX) + ': ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{' || ch === '[' || ch === '(') { depth++; started = true; }
      else if (ch === '}' || ch === ']' || ch === ')') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n'), line: startIdx + 1 };
  }
  throw new Error('unbalanced brackets while extracting: ' + name);
}

const members = ['SERVICE_SEGMENTS', 'DUTY_SEGMENTS_DEFAULT', 'CLASH_EXCEPTION_PAIRS',
                 '_clashDutyCategory', '_dutySegments', '_dutiesOverlap', '_clashIsExcepted'];
console.log('Extracted from ' + path.basename(INDEX) + ':');
const sliced = {};
for (const m of members) {
  sliced[m] = extractMember(m);
  console.log('  ' + m + ' @ line ' + sliced[m].line);
}

// Rebuild just enough of the engine for those members to run.
const engineSrc = 'var RE = {\n' +
  members.map(m => sliced[m].text.replace(/,\s*$/, '')).join(',\n') +
  '\n};\n; return RE;';
const RE = new Function('Object', 'JSON', engineSrc)(Object, JSON);
RE._dutySegmentOverrides = null;

function overlap(a, b) { return RE._dutiesOverlap.call(RE, a, b); }
function clashes(a, b) {
  return overlap(a, b) && !RE._clashIsExcepted.call(RE, [a, b]);
}

// One duty id per clash category, so the pairs below read like the old list did.
const ID = {
  preacher: 'preacher', liturgist: 'liturgist', usher: 'usher1', reader: 'reader1',
  communion: 'communion2', altar: 'altar1', pianist: 'pianist', guitarist: 'guitarist',
  bassist: 'bassist', drummer: 'drummer', singer: 'singer1', lcd: 'lcd', pa: 'pa',
  livestream: 'streaming', sundayschool: 'ssteacher1', flowerarrangement: 'flowerarrangement'
};

console.log('\nScenario 1 - every duty has an answer');
{
  const cats = Object.keys(ID);
  check('no duty category is unaccounted for',
    cats.filter(c => !(c in RE.DUTY_SEGMENTS_DEFAULT)), []);

  const known = RE.SERVICE_SEGMENTS.map(s => s.id);
  const bogus = [];
  for (const c of Object.keys(RE.DUTY_SEGMENTS_DEFAULT)) {
    for (const s of RE.DUTY_SEGMENTS_DEFAULT[c]) if (!known.includes(s)) bogus.push(c + ':' + s);
  }
  check('no duty points at a segment that does not exist', bogus, []);

  check('_clashDutyCategory still maps the ids used here',
    cats.filter(c => RE._clashDutyCategory.call(RE, ID[c]) !== c), []);
}

console.log('\nScenario 2 - everything the old list allowed is still quiet');
{
  // Verbatim from CLASH_EXCEPTION_PAIRS as it stood before duties had times.
  // If a seeding change turns any of these red, it is a regression on a real
  // roster, not a discovery.
  const wasAllowed = [
    ['singer', 'communion'], ['singer', 'altar'], ['livestream', 'altar'],
    ['livestream', 'communion'], ['liturgist', 'communion'], ['preacher', 'communion'],
    ['reader', 'singer'], ['pianist', 'liturgist'], ['guitarist', 'liturgist'],
    ['preacher', 'pianist'], ['usher', 'communion'], ['usher', 'altar'],
    ['reader', 'communion'], ['pa', 'communion']
  ];
  for (const [a, b] of wasAllowed) {
    check(a + ' + ' + b + ' stays clash-free', clashes(ID[a], ID[b]), false);
  }
}

console.log('\nScenario 3 - one person, one moment');
{
  check('two Ushers is one person twice at the welcome', clashes('usher1', 'usher2'), true);
  check('Reader 1 and Reader 2 are both in the readings', clashes('reader1', 'reader2'), true);
  check('a Singer cannot also be playing the piano', clashes('singer1', 'pianist'), true);
  check('the Liturgist cannot also be reading', clashes('liturgist', 'reader1'), true);
  check('the LCD desk cannot also be at the lectern', clashes('lcd', 'reader1'), true);
  check('Sunday School runs through the readings', clashes('ssteacher1', 'reader1'), true);
}

console.log('\nScenario 4 - two duties, different moments');
{
  check('Usher then Reader is fine', clashes('usher1', 'reader1'), false);
  check('Usher then Singer is fine', clashes('usher1', 'singer1'), false);
  check('Preacher and Reader are fine', clashes('preacher', 'reader1'), false);
  check('Sunday School after welcoming is fine', clashes('ssteacher1', 'usher1'), false);

  // Flower Arrangement is done the day before, so it collides with nothing.
  // That used to need a special case in the clash code; now it is an empty
  // list, which is the same statement made once instead of everywhere.
  check('Flower Arrangement has no segments', RE.DUTY_SEGMENTS_DEFAULT.flowerarrangement, []);
  const flowerClashes = Object.keys(ID)
    .filter(c => c !== 'flowerarrangement' && clashes('flowerarrangement', ID[c]));
  check('Flower Arrangement never clashes with anything', flowerClashes, []);
}

console.log('\n================================');
const passed = results.filter(Boolean).length;
console.log(passed + '/' + results.length + ' checks passed');
process.exit(passed === results.length ? 0 : 1);
