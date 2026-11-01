'use strict';
// Harness for whose a drawn remark is, and who is shown it.
//
// WHY THIS EXISTS
// Every drawing in the Songbook's reading view used to be everybody's, so a
// chord sheet that six musicians had marked up showed all six sets of rings
// and arrows to everyone. Now a drawing is its drawer's own until they share
// it (song_marks.owner / owner_name / part / shared). Nobody signs in, so the
// drawer is a name and a part kept on the device, and owner is that name
// folded to one spelling. What has to hold:
//
//   * a reader sees their own drawings, and other people's only once shared;
//   * drawings from before (no owner) stay everybody's;
//   * a reader can hide any one drawer, themselves included, for themselves;
//   * a new stroke is private unless the drawer has switched sharing on;
//   * the rubber never takes somebody else's drawing;
//   * a version made from another copies every drawing, keeping whose it is;
//   * none of it applies until the columns exist.
//
// USAGE
//   node tools/songbook-layers-harness.js
//   node tools/songbook-layers-harness.js path/to/file.html
//   node tools/songbook-layers-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before layers.
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }

const SRC = fs.readFileSync(INDEX, 'utf8');
const lines = SRC.split('\n');
const MIGRATION = path.join(__dirname, '..', 'migrations', '2026-11-01_song_marks_layers.sql');

function extractFn(name) {
  const startIdx = lines.findIndex(l => new RegExp('^  function ' + name + '\\s*\\(').test(l));
  if (startIdx < 0) throw new Error('function not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}
function extractVar(name) {
  const l = lines.find(x => new RegExp('^  var ' + name + ' = ').test(x));
  if (!l) throw new Error('var not found: ' + name);
  return l;
}

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

let L = null;
try {
  L = new Function(extractVar('_SBM_PARTS') + '\n' +
    ['_sbmPartLabel', '_sbmMeKey', '_sbmLayerKeep', '_sbmLayerPeople', '_sbmDrawerNames'].map(extractFn).join('\n') +
    '\nreturn { label: _sbmPartLabel, key: _sbmMeKey, keep: _sbmLayerKeep, people: _sbmLayerPeople, drawers: _sbmDrawerNames };')();
} catch (e) {
  console.log('  (helpers not present: ' + e.message.split('\n')[0] + ')');
}

console.log('\nWho a drawer is');
if (!L) check('the layer helpers exist', false, 'not in this source');
else {
  check('a name is folded to one spelling: case and spaces', L.key('  Aaron   Tan ') === 'aaron tan' && L.key('AARON TAN') === 'aaron tan');
  check('no name is nobody', L.key('') === '' && L.key(null) === '' && L.key('   ') === '');
  check('every part has its label', L.label('keys') === 'Piano / Keys' && L.label('vocals') === 'Singer' && L.label('nonsense') === '');
}

console.log('\nThe same person on another device');
if (L) {
  const rows = [{ owner: 'grace lim', owner_name: 'Grace Lim' }, { owner: 'grace lim', owner_name: 'grace lim' },
                { owner: 'ben ong', owner_name: 'Ben Ong' }, { owner: null, owner_name: null }];
  check('the names already drawing are offered once each, as first written, A to Z',
    JSON.stringify(L.drawers(rows)) === JSON.stringify(['Ben Ong', 'Grace Lim']), JSON.stringify(L.drawers(rows)));
  check('nobody drawing, nobody offered', L.drawers([]).length === 0 && L.drawers(undefined).length === 0);
}

console.log('\nWhat a reader is shown');
if (L) {
  const me = 'aaron tan';
  const mine = { owner: me, shared: false }, mineShared = { owner: me, shared: true };
  const theirs = { owner: 'grace lim', shared: false }, theirsShared = { owner: 'grace lim', shared: true };
  const earlier = { owner: null, shared: true }, preMigration = { anchor: 'l:1' };
  check('my own drawing, even unshared', L.keep(mine, me, {}) === true);
  check('somebody else\'s, unshared: never', L.keep(theirs, me, {}) === false);
  check('somebody else\'s, shared: yes', L.keep(theirsShared, me, {}) === true);
  check('a drawing from before names: everybody\'s', L.keep(earlier, me, {}) === true && L.keep(preMigration, me, {}) === true);
  check('a reader who has not said who they are still sees the shared and the earlier, never anybody\'s private',
    L.keep(theirsShared, '', {}) && L.keep(earlier, '', {}) && !L.keep(theirs, '', {}) && !L.keep(mine, '', {}));
  check('one drawer hidden is hidden', L.keep(theirsShared, me, { 'grace lim': true }) === false);
  check('my own can be hidden, by me', L.keep(mine, me, { 'aaron tan': true }) === false && L.keep(mineShared, me, { 'aaron tan': true }) === false);
  check('the earlier drawings hide as one', L.keep(earlier, me, { '': true }) === false && L.keep(theirsShared, me, { '': true }) === true);
  check('hiding nobody hides nothing', L.keep(theirsShared, me, undefined) === true && L.keep(null, me, {}) === false);
}

console.log('\nThe Layers list');
if (L) {
  const marks = [
    { owner: 'aaron tan', shared: false }, { owner: 'aaron tan', shared: true }, { owner: 'aaron tan', shared: false },
    { owner: 'grace lim', owner_name: 'Grace Lim', part: 'guitar', shared: true },
    { owner: 'grace lim', owner_name: 'Grace Lim', part: 'guitar', shared: false },
    { owner: 'ben ong', owner_name: 'Ben Ong', part: 'leader', shared: true },
    { owner: 'zoe', owner_name: 'Zoe', part: 'guitar', shared: false },
    { owner: null }, { owner: null }
  ];
  const P = L.people(marks, 'aaron tan');
  check('my own counted, private and shared', P.me.n === 3 && P.me.shared === 1, JSON.stringify(P.me));
  check('others listed by what they shared only', P.others.map(p => p.key + ':' + p.n).join(' ') === 'ben ong:1 grace lim:1 :2',
    P.others.map(p => p.key + ':' + p.n).join(' '));
  check('somebody with nothing shared is not listed at all', !P.others.some(p => p.key === 'zoe'));
  check('the leader first, the earlier drawings last', P.others[0].part === 'leader' && P.others[P.others.length - 1].key === '');
  check('a drawer keeps the name they wrote', P.others[1].name === 'Grace Lim');
  check('nothing drawn, nobody listed', L.people([], 'aaron tan').others.length === 0 && L.people(undefined, '').me.n === 0);
}

console.log('\nThe wiring');
{
  const has = re => re.test(SRC);
  check('every view reads drawings through the filter',
    has(/function _sbmMarksOf\(base, versionId\) \{ return _sbmLayerFilter\(_sbVerMarks\(_sbmMarks\[base\], versionId\)\); \}/));
  check('the filter does nothing until the columns exist',
    has(/function _sbmLayerFilter\(marks\) \{\r?\n\s*if \(_sbmLayersOk !== true\) return marks \|\| \[\];/) &&
    has(/select\('owner, owner_name, part, shared'\)\.limit\(1\)/));
  check('a new stroke says whose it is, and is private unless sharing is on',
    has(/if \(me\) \{ mark\.owner = me\.key; mark\.owner_name = me\.name; mark\.part = me\.part \|\| null; mark\.shared = !!D\.share; \}/) &&
    has(/share: saved\.share === true,/));
  check('drawing asks who you are first', has(/if \(_sbmLayersOk === true && !_sbmMe\(\)\) \{ sbmWho\(true\); return; \}/));
  check('the rubber leaves somebody else\'s drawing', has(/if \(l\.owner && !l\.mine\) \{ theirs = theirs \|\| l\.ownerName \|\| 'somebody else'; return; \}/));
  check('a new version copies every drawing of the one it came from, each still its drawer\'s',
    has(/var copies = _sbVerMarks\(_sbmMarks\[base\], from\)\.map/) &&
    has(/c\.owner = m\.owner \|\| null; c\.owner_name = m\.owner_name \|\| null; c\.part = m\.part \|\| null; c\.shared = m\.shared !== false;/));
  check('sharing all of yours touches only your rows of this song',
    has(/update\(\{ shared: !!on \}\)\.eq\('song_id', base\)\.eq\('owner', me\.key\)/));
  check('the names are read from the database for the whole book, not from what this device loaded',
    has(/sup\.from\('song_marks'\)\.select\('owner, owner_name'\)\.in\('song_id', bases\)/) &&
    has(/_sbmBookDrawers\(\)\.then\(function\(rows\) \{ drawers = _sbmDrawerNames\(rows\); fill\(\); \}\);/));
  check('a name that has drawn before is welcomed back with its count',
    has(/var mine = rows\.filter\(function\(m\) \{ return m\.owner === _sbmMeKey\(name\); \}\), had = mine\.length;/) && has(/var as = \(mine\[0\] && mine\[0\]\.owner_name\) \|\| name;/));
  check('the Layers chip is drawn beside both Draw chips', (SRC.match(/\+ _sbmDrawChip\(\) \+ _sbmLayersChip\(\)/g) || []).length === 2);
  const sql = fs.existsSync(MIGRATION) ? fs.readFileSync(MIGRATION, 'utf8') : '';
  check('the migration adds whose and shared, with the earlier rows shared',
    /add column if not exists owner\s+text/.test(sql) && /add column if not exists owner_name text/.test(sql) &&
    /add column if not exists part\s+text/.test(sql) && /add column if not exists shared\s+boolean not null default true/.test(sql));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (EXPECT_BROKEN) {
  if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has layers (or the harness has no teeth)'); process.exit(1); }
  console.log('--expect-broken: failures above are the expected ones');
  process.exit(0);
}
process.exit(fail ? 1 : 0);
