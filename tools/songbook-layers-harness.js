'use strict';
// Harness for whose a drawn remark is, and who is shown it.
//
// WHY THIS EXISTS
// Every drawing in the Songbook's reading view used to be everybody's, so a
// chord sheet that six musicians had marked up showed all six sets of rings
// and arrows to everyone. Now a drawing is its drawer's own until they share
// it (song_marks.owner / owner_name / part / shared). Nobody signs in, so the
// drawer is a name kept on the device, and owner is that name folded to one
// spelling. A stroke goes in for everyone; when the drawer taps Done they
// choose who sees what they drew -- everyone, only them, or one part of the
// band (part). What has to hold:
//
//   * a reader sees their own drawings; other people's when they are for
//     everyone, or for a part the reader has said they play or sing;
//   * drawings from before (no owner) stay everybody's;
//   * a reader can hide any one drawer, themselves included, for themselves;
//   * a new stroke is everyone's, and Done asks who should see it;
//   * the rubber never takes somebody else's drawing;
//   * a version made from another copies every drawing, keeping whose it is;
//   * none of it applies until the columns exist;
//   * the parts a reader plays or sings follow their NAME (drawer_prefs), not
//     the device: giving the name on a new phone brings them back, joined
//     with any ticked there with no name; a phone that changed hands never
//     carries one person's parts into another's; a device with no name, and
//     every device until the table exists, works from the device alone; and
//     every write goes through window._supabase, which the Phone view's
//     read-only client covers.
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
const PREFS_MIGRATION = path.join(__dirname, '..', 'migrations', '2026-11-07_drawer_prefs.sql');

const _sliced = {};
function extractFn(name) {
  if (_sliced[name]) return _sliced[name];
  const head = new RegExp('^  function ' + name + '\\s*\\(');
  const startIdx = lines.findIndex(l => head.test(l));
  if (startIdx < 0) throw new Error('function not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return (_sliced[name] = out.join('\n'));
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}
function extractVar(name) {
  const head = new RegExp('^  var ' + name + ' = ');
  const l = lines.find(x => head.test(x));
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
    ['_sbmPartLabel', '_sbmMeKey', '_sbmLayerKeep', '_sbmLayerPeople', '_sbmDrawerNames', '_sbmAudienceRow', '_sbmAudienceOf'].map(extractFn).join('\n') +
    '\nreturn { label: _sbmPartLabel, key: _sbmMeKey, keep: _sbmLayerKeep, people: _sbmLayerPeople, drawers: _sbmDrawerNames, row: _sbmAudienceRow, aud: _sbmAudienceOf };')();
} catch (e) {
  console.log('  (helpers not present: ' + e.message.split('\n')[0] + ')');
}

console.log('\nWho a drawer is');
if (!L) check('the layer helpers exist', false, 'not in this source');
else {
  check('a name is folded to one spelling: case and spaces', L.key('  Aaron   Tan ') === 'aaron tan' && L.key('AARON TAN') === 'aaron tan');
  check('no name is nobody', L.key('') === '' && L.key(null) === '' && L.key('   ') === '');
  check('every part has its label', L.label('leader') === 'Worship Leader' && L.label('keys') === 'Piano / Keys' && L.label('vocals') === 'Singers' && L.label('nonsense') === '');
}

console.log('\nThe same person on another device');
if (L) {
  const rows = [{ owner: 'grace lim', owner_name: 'Grace Lim' }, { owner: 'grace lim', owner_name: 'grace lim' },
                { owner: 'ben ong', owner_name: 'Ben Ong' }, { owner: null, owner_name: null }];
  check('the names already drawing are offered once each, as first written, A to Z',
    JSON.stringify(L.drawers(rows)) === JSON.stringify(['Ben Ong', 'Grace Lim']), JSON.stringify(L.drawers(rows)));
  check('nobody drawing, nobody offered', L.drawers([]).length === 0 && L.drawers(undefined).length === 0);
}

console.log('\nWho a drawing is for, as the row holds it');
if (L) {
  check('everyone: shared, for no one part', JSON.stringify(L.row('all')) === JSON.stringify({ shared: true, part: null }) &&
    JSON.stringify(L.row(undefined)) === JSON.stringify({ shared: true, part: null }));
  check('only me: not shared', JSON.stringify(L.row('me')) === JSON.stringify({ shared: false, part: null }));
  check('a part of the band: shared, for that part', JSON.stringify(L.row('guitar')) === JSON.stringify({ shared: true, part: 'guitar' }));
  check('and read back the same way', L.aud({ shared: true, part: null }) === 'all' && L.aud({ shared: false, part: null }) === 'me' &&
    L.aud({ shared: true, part: 'drums' }) === 'drums' && L.aud({}) === 'all' && L.aud(null) === 'all');
}

console.log('\nWhat a reader is shown');
if (L) {
  const me = 'aaron tan';
  const mine = { owner: me, shared: false }, mineForBass = { owner: me, shared: true, part: 'bass' };
  const theirs = { owner: 'grace lim', shared: false }, theirsAll = { owner: 'grace lim', shared: true, part: null };
  const forGuitar = { owner: 'grace lim', shared: true, part: 'guitar' };
  const earlier = { owner: null, shared: true }, preMigration = { anchor: 'l:1' };
  check('my own drawing, whoever it is for', L.keep(mine, me, {}, []) === true && L.keep(mineForBass, me, {}, []) === true);
  check('somebody else\'s, for them alone: never', L.keep(theirs, me, {}, ['guitar']) === false);
  check('somebody else\'s, for everyone: yes', L.keep(theirsAll, me, {}, []) === true);
  check('one for the guitar: shown to a guitarist', L.keep(forGuitar, me, {}, ['guitar']) === true && L.keep(forGuitar, me, {}, ['vocals', 'guitar']) === true);
  check('...and to nobody who has not said they play it', L.keep(forGuitar, me, {}, []) === false && L.keep(forGuitar, me, {}, ['drums']) === false &&
    L.keep(forGuitar, me, {}, undefined) === false);
  check('a drawing from before names: everybody\'s', L.keep(earlier, me, {}, []) === true && L.keep(preMigration, me, {}, []) === true);
  check('a reader who has not said who they are sees the everyone and the earlier, never anybody\'s own',
    L.keep(theirsAll, '', {}, []) && L.keep(earlier, '', {}, []) && !L.keep(theirs, '', {}, []) && !L.keep(mine, '', {}, []));
  check('one drawer hidden is hidden, even for my part', L.keep(theirsAll, me, { 'grace lim': true }, []) === false && L.keep(forGuitar, me, { 'grace lim': true }, ['guitar']) === false);
  check('my own can be hidden, by me', L.keep(mine, me, { 'aaron tan': true }, []) === false);
  check('the earlier drawings hide as one', L.keep(earlier, me, { '': true }, []) === false && L.keep(theirsAll, me, { '': true }, []) === true);
  check('nothing hidden, nothing missing', L.keep(theirsAll, me, undefined, undefined) === true && L.keep(null, me, {}, []) === false);
}

console.log('\nThe Layers list');
if (L) {
  const marks = [
    { owner: 'aaron tan', shared: true }, { owner: 'aaron tan', shared: false }, { owner: 'aaron tan', shared: true, part: 'bass' }, { owner: 'aaron tan', shared: true },
    { owner: 'grace lim', owner_name: 'Grace Lim', shared: true, part: 'guitar' },
    { owner: 'grace lim', owner_name: 'Grace Lim', shared: false },
    { owner: 'ben ong', owner_name: 'Ben Ong', shared: true },
    { owner: 'zoe', owner_name: 'Zoe', shared: true, part: 'drums' }, { owner: 'zoe', owner_name: 'Zoe', shared: true, part: 'drums' },
    { owner: null }, { owner: null }
  ];
  const P = L.people(marks, 'aaron tan', ['guitar']);
  check('my own counted by who sees them', P.me.n === 4 && P.me.by.all === 2 && P.me.by.me === 1 && P.me.by.bass === 1, JSON.stringify(P.me));
  check('others listed by what this reader can see: the everyone, and the parts they play',
    P.others.map(p => p.key + ':' + p.n).join(' ') === 'ben ong:1 grace lim:1 :2', P.others.map(p => p.key + ':' + p.n).join(' '));
  check('a drawer\'s drawings for a part say so', P.others.filter(p => p.key === 'grace lim')[0].parts.guitar === true);
  check('somebody whose drawings are all for a part not chosen is not listed, but counted for the hint',
    !P.others.some(p => p.key === 'zoe') && P.elsewhere.drums === 2, JSON.stringify(P.elsewhere));
  check('the earlier drawings last', P.others[P.others.length - 1].key === '');
  check('nothing drawn, nobody listed', L.people([], 'aaron tan', []).others.length === 0 && L.people(undefined, '', undefined).me.n === 0);
}

console.log('\nThe wiring');
{
  const has = re => re.test(SRC);
  check('every view reads drawings through the filter',
    has(/function _sbmMarksOf\(base, versionId\) \{ return _sbmLayerFilter\(_sbVerMarks\(_sbmMarks\[base\], versionId\)\); \}/));
  check('the filter does nothing until the columns exist, and knows the reader\'s parts',
    has(/function _sbmLayerFilter\(marks\) \{\r?\n\s*if \(_sbmLayersOk !== true\) return marks \|\| \[\];/) &&
    has(/select\('owner, owner_name, part, shared'\)\.limit\(1\)/) && has(/return _sbmLayerKeep\(m, me && me\.key, hidden, parts\);/));
  check('a new stroke says whose it is, and is everyone\'s',
    has(/if \(me\) \{ mark\.owner = me\.key; mark\.owner_name = me\.name; mark\.part = null; mark\.shared = true; \}/) && !has(/D\.share/));
  check('Done asks who should see what was drawn, and saves the answer on those strokes',
    has(/var drawn = _sbmSessionStrokes\(\);\r?\n\s*_sbmDrawEnd\(\); _sbmRender\(\);/) && has(/if \(drawn\.length && _sbmLayersOk === true\) _sbmAskAudience\(drawn\);/) &&
    has(/sup\.from\('song_marks'\)\.update\(row\)\.in\('id', ids\)/));
  check('the reader says under Layers which parts they play or sing, kept on the device',
    has(/localStorage\.setItem\('lhc_sbm_parts', JSON\.stringify\(a\)\)/) && has(/onclick="WO\.sbmLayerPart\(/));
  check('who is drawing is a name now; who sees it is asked once it is drawn',
    !has(/What you play or sing<\/div>/) && has(/When you finish drawing, you choose who sees it/));
  check('drawing asks who you are first', has(/if \(_sbmLayersOk === true && !_sbmMe\(\)\) \{ sbmWho\(true\); return; \}/));
  check('the rubber leaves somebody else\'s drawing', has(/if \(l\.owner && !l\.mine\) \{ theirs = theirs \|\| l\.ownerName \|\| 'somebody else'; return; \}/));
  check('a new version copies every drawing of the one it came from, each still its drawer\'s',
    has(/var copies = _sbVerMarks\(_sbmMarks\[base\], from\)\.map/) &&
    has(/c\.owner = m\.owner \|\| null; c\.owner_name = m\.owner_name \|\| null; c\.part = m\.part \|\| null; c\.shared = m\.shared !== false;/));
  check('changing who sees all of yours touches only your rows of this song',
    has(/sup\.from\('song_marks'\)\.update\(row\)\.eq\('song_id', base\)\.eq\('owner', me\.key\)/));
  check('the names are read from the database for the whole book, not from what this device loaded',
    has(/sup\.from\('song_marks'\)\.select\('owner, owner_name'\)\.in\('song_id', bases\)/) &&
    has(/_sbmBookDrawers\(\)\.then\(function\(rows\) \{ drawers = _sbmDrawerNames\(rows\); fill\(\); \}\);/));
  check('a name that has drawn before is welcomed back with its count',
    has(/_sbmBookDrawers\(\)\.then\(function\(rows\) \{ return rows\.filter\(function\(m\) \{ return m\.owner === _sbmMeKey\(name\); \}\); \}\);/) &&
    has(/var mine = res\[0\] \|\| \[\], had = mine\.length, J = res\[1\];/) && has(/var as = \(mine\[0\] && mine\[0\]\.owner_name\) \|\| name;/) &&
    has(/var text = _sbmWelcome\(as\.split\(' '\)\[0\], had, J\);/));
  // (On the lyrics card the Type chip sits between them since gotcha 65.)
  check('the Layers chip is drawn beside both Draw chips', (SRC.match(/\+ _sbmDrawChip\(\) \+ (_sbmTypeChip\(noChords\) \+ )?_sbmLayersChip\(\)/g) || []).length === 2);
  const sql = fs.existsSync(MIGRATION) ? fs.readFileSync(MIGRATION, 'utf8') : '';
  check('the migration adds whose and shared, with the earlier rows shared',
    /add column if not exists owner\s+text/.test(sql) && /add column if not exists owner_name text/.test(sql) &&
    /add column if not exists part\s+text/.test(sql) && /add column if not exists shared\s+boolean not null default true/.test(sql));
}

// ---- the parts follow the name ----
//
// Which parts a reader plays or sings (Layers > Drawings meant for) used to
// be the DEVICE's: on a new phone the name brought back your own drawings,
// and drawings other people made for your part stayed hidden until you
// ticked it again. Now they are kept with the name too (drawer_prefs), and
// a change made on one device reaches the others: the name's parts win,
// unless the device holds a change not saved yet (lhc_sbm_parts_dirty).

let J = null;
try {
  J = new Function(extractVar('_SBM_PARTS') + '\n' +
    ['_sbmPartLabel', '_sbmPartsSame', '_sbmPartsJoin', '_sbmWelcome'].map(extractFn).join('\n') +
    '\nreturn { join: _sbmPartsJoin, welcome: _sbmWelcome };')();
} catch (e) {
  console.log('  (parts-follow-the-name helpers not present: ' + e.message.split('\n')[0] + ')');
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\nThe parts follow the name: joining');
if (!J) check('the parts are kept with the name', false, 'not in this source');
else {
  let r = J.join([], '', 'aaron tan', ['guitar', 'vocals']);
  check('a new phone: the name\'s parts come back, in the Layers order', same(r.parts, ['vocals', 'guitar']) && same(r.added, ['vocals', 'guitar']) && !r.mixed && r.moved && !r.write, JSON.stringify(r));
  r = J.join(['bass'], '', 'aaron tan', ['guitar']);
  check('parts ticked here with no name are JOINED with the name\'s, and the row is told', same(r.parts, ['guitar', 'bass']) && same(r.added, ['guitar']) && r.mixed && r.write, JSON.stringify(r));
  r = J.join(['bass'], 'aaron tan', 'aaron tan', ['guitar']);
  check('parts already this name\'s, nothing waiting: the NAME\'s win, so a part unticked on another device stays unticked',
    same(r.parts, ['guitar']) && r.mode === 'saved' && same(r.removed, ['bass']) && same(r.added, ['guitar']) && r.moved && !r.write, JSON.stringify(r));
  r = J.join(['bass'], 'aaron tan', 'aaron tan', ['guitar'], null, true);
  check('...with a change waiting on the device: the DEVICE\'s win, and are written',
    same(r.parts, ['bass']) && r.mode === 'mine' && !r.moved && r.write, JSON.stringify(r));
  r = J.join(['bass'], 'aaron tan', 'aaron tan', null);
  check('...and a name whose row has gone is given the device\'s again', same(r.parts, ['bass']) && r.mode === 'mine' && r.write);
  r = J.join(['bass'], '', 'aaron tan', ['guitar'], null, true);
  check('a change waiting on parts that were nobody\'s still joins: nothing is lost either side', same(r.parts, ['guitar', 'bass']) && r.mode === 'join');
  r = J.join(['keys'], '', 'aaron tan', null);
  check('a name with nothing kept takes the device\'s parts', same(r.parts, ['keys']) && r.write && !r.added.length && !r.moved);
  r = J.join([], '', 'aaron tan', null);
  check('nothing either side: nothing to write', same(r.parts, []) && !r.write && !r.moved);
  r = J.join(['drums'], 'grace lim', 'aaron tan', null);
  check('a phone that changed hands: somebody else\'s parts are NOT carried into this name', same(r.parts, []) && !r.write && r.moved, JSON.stringify(r));
  r = J.join(['drums'], 'grace lim', 'aaron tan', ['guitar'], null, true);
  check('...the new name gets its own alone, whatever the last person had waiting', same(r.parts, ['guitar']) && r.mode === 'theirs' && !r.write && !r.mixed);
  r = J.join([], '', 'aaron tan', ['guitar', 'keys'], { part: 'guitar', on: false });
  check('a part just unticked here is not ticked again by the name\'s, and the row loses it', same(r.parts, ['keys']) && r.write && same(r.added, ['keys']), JSON.stringify(r));
  r = J.join(['drums', 'bass'], 'grace lim', 'aaron tan', ['guitar'], { part: 'bass', on: true });
  check('a part just ticked on a handed-on phone stands; the last person\'s others do not', same(r.parts, ['guitar', 'bass']) && r.write, JSON.stringify(r));
  r = J.join(['guitar', 'vocals'], 'aaron tan', 'aaron tan', ['vocals', 'guitar']);
  check('the same parts in another order: nothing to write, nothing new', !r.write && !r.added.length && !r.moved);
  r = J.join(['guitar', 'guitar', '', null, 7], '', 'aaron tan', ['guitar', 'guitar']);
  check('repeats and junk are tidied away', same(r.parts, ['guitar']) && !r.write, JSON.stringify(r));
  r = J.join(['constructor', 'guitar'], '', 'aaron tan', []);
  check('a part the list does not know sorts last, never breaks the order', same(r.parts, ['guitar', 'constructor']));
  r = J.join('garbage', '', 'aaron tan', { not: 'a list' });
  check('a damaged store reads as no parts', same(r.parts, []) && !r.write);

  console.log('\nThe parts follow the name: what is said');
  check('drawings alone: the welcome is as it was',
    J.welcome('Grace', 3, null) === 'Welcome back, Grace: your 3 drawings in this songbook are showing' &&
    J.welcome('Grace', 1, { added: [] }) === 'Welcome back, Grace: your 1 drawing in this songbook is showing', J.welcome('Grace', 1, null));
  check('parts back on a new phone',
    J.welcome('Aaron', 0, J.join([], '', 'aaron tan', ['guitar', 'vocals'])) === 'Welcome back, Aaron: your parts are back (Singers and Guitar)',
    J.welcome('Aaron', 0, J.join([], '', 'aaron tan', ['guitar', 'vocals'])));
  check('drawings and parts in ONE toast (a second would replace the first)',
    J.welcome('Aaron', 2, J.join([], '', 'aaron tan', ['drums'])) === 'Welcome back, Aaron: your 2 drawings in this songbook are showing, and your parts are back (Drums)');
  check('a join says so',
    J.welcome('Aaron', 0, J.join(['bass', 'keys'], '', 'aaron tan', ['guitar'])) === 'Welcome back, Aaron: your parts are Guitar, Bass and Piano / Keys now: the ones kept with your name and the ones ticked here',
    J.welcome('Aaron', 0, J.join(['bass', 'keys'], '', 'aaron tan', ['guitar'])));
  check('no greeting: a sentence of its own', J.welcome('', 0, J.join([], '', 'k', ['bass'])) === 'Your parts are back (Bass)');
  check('nothing came back: nothing said', J.welcome('Aaron', 0, null) === '' && J.welcome('Aaron', 0, J.join(['bass'], '', 'k', ['bass'])) === '');
  check('a change from another device says so',
    J.welcome('', 0, J.join(['guitar', 'bass'], 'k', 'k', ['guitar'])) === 'Your parts are Guitar now, as chosen on another device' &&
    J.welcome('', 0, J.join(['guitar'], 'k', 'k', [])) === 'Your parts were all unticked on another device',
    J.welcome('', 0, J.join(['guitar', 'bass'], 'k', 'k', ['guitar'])));
  check('...and a device that agrees, or whose own change won, says nothing',
    J.welcome('', 0, J.join(['guitar'], 'k', 'k', ['guitar'])) === '' && J.welcome('', 0, J.join(['bass'], 'k', 'k', ['guitar'], null, true)) === '');
}

// The sync itself, against a stand-in database and storage.
function makeSim(o) {
  o = o || {};
  const store = Object.assign({}, o.store || {});
  const ls = { getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const db = o.db || { table: o.table !== false, rows: JSON.parse(JSON.stringify(o.rows || {})), probes: 0, reads: 0, writes: [], requests: 0, hold: false, held: [], holdReads: false, heldReads: [], failWrites: false };
  const toasts = [], warns = [], hooks = { shown: 0 };
  const sup = {
    from(t) {
      db.requests++;
      if (t !== 'drawer_prefs') throw new Error('unexpected table ' + t);
      const q = { f: {} };
      q.select = () => q; q.limit = () => q; q.eq = (c, v) => { q.f[c] = v; return q; };
      q.then = (a, b) => {
        if (q.f.owner == null) db.probes++; else db.reads++;
        const go = () => !db.table ? { data: null, error: { message: 'relation "public.drawer_prefs" does not exist' } }
          : { data: q.f.owner == null ? Object.keys(db.rows).slice(0, 1).map(k => ({ owner: k })) : (db.rows[q.f.owner] ? [{ parts: db.rows[q.f.owner].slice() }] : []), error: null };
        if (q.f.owner != null && db.holdReads) { const was = go(); return new Promise(res => db.heldReads.push(() => res(was))).then(a, b); }
        return Promise.resolve(go()).then(a, b);
      };
      q.upsert = (row, opt) => {
        db.writes.push({ owner: row.owner, owner_name: row.owner_name, parts: row.parts.slice(), onConflict: opt && opt.onConflict });
        const p = new Promise(r => {
          const fin = () => { const ok = db.table && !db.failWrites; if (ok) db.rows[row.owner] = row.parts.slice(); r({ error: ok ? null : { message: 'no answer' } }); };
          if (db.hold) db.held.push(fin); else fin();
        });
        return { then: (a, b) => p.then(a, b) };
      };
      return q;
    }
  };
  const win = { _supabase: o.noSupabase ? undefined : sup };
  if (o.preview) win.__SBM_PREVIEW = { key: 'x' };
  const fns = ['_sbmPartLabel', '_sbmMeKey', '_sbmMe', '_sbmMyParts', '_sbmPartsOf', '_sbmPartsJoin', '_sbmWelcome',
    '_sbmPartsDirty', '_sbmPartsClean', '_sbmPartsSame',
    '_sbmPrefsSupport', '_sbmPrefsSync', '_sbmPrefsWrite', '_sbmPrefsTicked', '_sbmPrefsNamed', '_sbmPrefsPull', 'sbmLayerPart'];
  const body = extractVar('_SBM_PARTS') + '\n' + extractVar('_sbmPrefsOk') + '\nvar _sbmLayersOk = true;\n' +
    'function _sbmPartsShown() { hooks.shown++; }\n' + fns.map(extractFn).join('\n') +
    '\nreturn { me: _sbmMe, parts: _sbmMyParts, of: _sbmPartsOf, named: _sbmPrefsNamed, pull: _sbmPrefsPull, tick: sbmLayerPart, ok: function() { return _sbmPrefsOk; },' +
    ' dirty: function() { return localStorage.getItem("lhc_sbm_parts_dirty"); }, unthrottle: function() { _sbmPrefsPulledAt = 0; } };';
  const api = new Function('window', 'localStorage', 'showToast', 'console', 'hooks', body)(
    win, ls, (m, t) => toasts.push(m), { warn: m => warns.push(m), log() {} }, hooks);
  api.name = n => { store.lhc_sbm_me = JSON.stringify({ name: n }); };
  return { api, db, store, toasts, warns, hooks, win };
}
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };

(async () => {
  let ok = true;
  try { makeSim(); } catch (e) { ok = false; }
  console.log('\nThe parts follow the name: the sync');
  if (!ok) check('the sync can be run', false, 'not in this source');
  else {
    // Until the migration is run: nothing, quietly.
    let s = makeSim({ table: false, store: { lhc_sbm_parts: '["bass"]' } });
    s.api.name('Aaron Tan');
    let r; try { r = await s.api.named(null, s.api.me()); await flush(); s.api.tick('guitar'); await flush(); } catch (e) { r = e; }
    check('without the table: nothing written, nothing thrown, nothing said, the device keeps working',
      r === null && s.db.writes.length === 0 && s.toasts.length === 0 && s.api.ok() === false && same(s.api.parts(), ['bass', 'guitar']) && s.db.probes === 1,
      JSON.stringify({ r: String(r), writes: s.db.writes.length, toasts: s.toasts, parts: s.api.parts(), probes: s.db.probes }));

    // A new phone: the name brings its parts back.
    s = makeSim({ rows: { 'aaron tan': ['guitar', 'vocals'] } });
    s.api.name('Aaron Tan');
    r = await s.api.named(null, s.api.me()); await flush();
    check('a new phone: giving the name brings its parts back, and the device notes whose they are',
      same(s.api.parts(), ['vocals', 'guitar']) && s.api.of() === 'aaron tan' && r && same(r.added, ['vocals', 'guitar']) && s.db.writes.length === 0 && s.hooks.shown === 0,
      JSON.stringify({ parts: s.api.parts(), of: s.api.of(), writes: s.db.writes }));

    // Ticked here before a name: joined, and the row is told.
    s = makeSim({ rows: { 'aaron tan': ['guitar'] }, store: { lhc_sbm_parts: '["bass"]' } });
    s.api.name('aaron   TAN');
    r = await s.api.named(null, s.api.me()); await flush();
    check('parts ticked before the name are joined with the name\'s, and saved for it',
      same(s.api.parts(), ['guitar', 'bass']) && s.db.writes.length === 1 && same(s.db.writes[0].parts, ['guitar', 'bass']) &&
      s.db.writes[0].owner === 'aaron tan' && s.db.writes[0].owner_name === 'aaron TAN' && s.db.writes[0].onConflict === 'owner' && r.mixed,
      JSON.stringify(s.db.writes));

    // A phone changing hands.
    s = makeSim({ rows: { 'aaron tan': ['guitar'] }, store: { lhc_sbm_me: JSON.stringify({ name: 'Grace Lim' }), lhc_sbm_parts: '["drums"]' } });
    const grace = s.api.me();
    s.api.name('Aaron Tan');
    await s.api.named(grace, s.api.me()); await flush();
    check('a phone handed on: the first name\'s parts are kept with THAT name, and the new name gets only its own',
      same(s.db.rows['grace lim'], ['drums']) && same(s.db.rows['aaron tan'], ['guitar']) && same(s.api.parts(), ['guitar']) && s.api.of() === 'aaron tan' &&
      !s.db.writes.some(w => w.owner === 'aaron tan'),
      JSON.stringify({ rows: s.db.rows, parts: s.api.parts(), writes: s.db.writes }));
    s.api.name('Grace Lim');
    await s.api.named({ name: 'Aaron Tan', key: 'aaron tan' }, s.api.me()); await flush();
    check('...and handed back, the first name\'s parts come back, the second\'s not mixed in',
      same(s.api.parts(), ['drums']) && same(s.db.rows['aaron tan'], ['guitar']) && same(s.db.rows['grace lim'], ['drums']), JSON.stringify({ parts: s.api.parts(), rows: s.db.rows }));
    s = makeSim({ store: { lhc_sbm_me: JSON.stringify({ name: 'Grace Lim' }), lhc_sbm_parts: '["drums"]', lhc_sbm_parts_of: 'grace lim' }, rows: { 'grace lim': ['drums'] } });
    const g2 = s.api.me(); s.api.name('Ben Ong');
    r = await s.api.named(g2, s.api.me()); await flush();
    check('a new name with nothing kept starts with no parts, not the last person\'s, and says the screen must be redrawn',
      same(s.api.parts(), []) && s.db.writes.length === 0 && r && r.moved && !r.added.length, JSON.stringify({ parts: s.api.parts(), writes: s.db.writes, r }));

    // Ticking under Layers.
    s = makeSim({ rows: { 'aaron tan': ['guitar'] }, store: { lhc_sbm_me: JSON.stringify({ name: 'Aaron Tan' }), lhc_sbm_parts: '["guitar"]', lhc_sbm_parts_of: 'aaron tan' } });
    s.api.tick('keys'); await flush();
    check('a part ticked is saved for the name too', same(s.db.writes.map(w => w.parts), [['guitar', 'keys']]) && same(s.db.rows['aaron tan'], ['guitar', 'keys']), JSON.stringify(s.db.writes));
    s.api.tick('guitar'); await flush();
    check('...and one unticked; once saved, nothing is left waiting', same(s.db.rows['aaron tan'], ['keys']) && s.api.dirty() === null, JSON.stringify({ rows: s.db.rows, dirty: s.api.dirty() }));
    s.db.hold = true;
    s.api.tick('bass'); await flush(); s.api.tick('drums'); await flush(); s.api.tick('bass'); await flush();
    const inFlight = s.db.writes.length;
    s.db.held.splice(0).forEach(f => f()); await flush();
    s.db.held.splice(0).forEach(f => f()); await flush();
    check('quick ticks: one write at a time, and the last one wins',
      inFlight === 3 && s.db.writes.length === 4 && same(s.db.writes[3].parts, ['keys', 'drums']) && same(s.db.rows['aaron tan'], ['keys', 'drums']),
      JSON.stringify({ inFlight, writes: s.db.writes.map(w => w.parts) }));

    s = makeSim({ rows: { 'aaron tan': ['guitar', 'keys'] }, store: { lhc_sbm_me: JSON.stringify({ name: 'Aaron Tan' }), lhc_sbm_parts: '["guitar"]' } });
    s.api.tick('guitar'); await flush();
    check('the first tick on a device joins with the name\'s first, then puts the tick on top',
      same(s.api.parts(), ['keys']) && same(s.db.rows['aaron tan'], ['keys']) && s.api.of() === 'aaron tan' && s.toasts.length === 1,
      JSON.stringify({ parts: s.api.parts(), rows: s.db.rows, toasts: s.toasts }));

    s = makeSim({ rows: { 'aaron tan': ['guitar'] }, store: { lhc_sbm_parts: '[]' } });
    s.api.tick('bass'); await flush();
    check('a device with no name: the tick stays on the device, and nothing is asked of the database',
      same(s.api.parts(), ['bass']) && s.db.requests === 0 && s.api.of() === '', JSON.stringify({ parts: s.api.parts(), requests: s.db.requests }));

    s = makeSim({ preview: true, rows: { 'aaron tan': ['guitar'] }, store: { lhc_sbm_me: JSON.stringify({ name: 'Aaron Tan' }), lhc_sbm_parts: '["bass"]' } });
    s.api.tick('keys'); await s.api.named(null, s.api.me()); s.api.pull(); await flush();
    check('the Phone view syncs nothing', s.db.requests === 0, 'requests: ' + s.db.requests);

    // The first page after the table appears, on a device named before.
    s = makeSim({ rows: { 'aaron tan': ['guitar'] }, store: { lhc_sbm_me: JSON.stringify({ name: 'Aaron Tan' }), lhc_sbm_parts: '["bass"]' } });
    s.api.pull(); await flush();
    check('a device named before parts followed names joins them once, and says so',
      same(s.api.parts(), ['guitar', 'bass']) && same(s.db.rows['aaron tan'], ['guitar', 'bass']) && s.api.of() === 'aaron tan' && s.toasts.length === 1 && s.hooks.shown === 1,
      JSON.stringify({ parts: s.api.parts(), rows: s.db.rows, toasts: s.toasts }));
    const reads = s.db.reads;
    s.api.pull(); await flush();
    check('...and only once', s.db.reads === reads && s.db.probes === 1);

    // Another name given while the first page's join is still being read,
    // and that read coming back LAST.
    s = makeSim({ rows: { 'aaron tan': ['guitar'], 'ben ong': ['drums'] }, store: { lhc_sbm_me: JSON.stringify({ name: 'Aaron Tan' }), lhc_sbm_parts: '[]' } });
    s.db.holdReads = true;
    s.api.pull(); await flush();
    const stale = s.db.heldReads.shift();
    const a = s.api.me(); s.api.name('Ben Ong');
    const named = s.api.named(a, s.api.me()); await flush();
    while (s.db.heldReads.length) { s.db.heldReads.shift()(); await flush(); }
    await named;
    const before = JSON.stringify([s.api.parts(), s.api.of()]);
    if (stale) { stale(); await flush(); }
    check('a name given mid-read wins: the earlier name\'s read, coming back last, changes nothing',
      !!stale && before === JSON.stringify([['drums'], 'ben ong']) && same(s.api.parts(), ['drums']) && s.api.of() === 'ben ong',
      JSON.stringify({ stale: !!stale, before, parts: s.api.parts(), of: s.api.of() }));
  }

  console.log('\nThe parts follow the name: a change on one phone reaching the other');
  if (ok) {
    const aaron = JSON.stringify({ name: 'Aaron Tan' });
    const A = makeSim({ store: { lhc_sbm_me: aaron, lhc_sbm_parts: '[]' } });
    A.api.tick('guitar'); await flush(); A.api.tick('bass'); await flush();
    check('phone A ticks Guitar and Bass: kept with the name, nothing left waiting',
      same(A.db.rows['aaron tan'], ['guitar', 'bass']) && A.api.dirty() === null && A.api.of() === 'aaron tan', JSON.stringify({ rows: A.db.rows, dirty: A.api.dirty() }));
    const B = makeSim({ db: A.db });
    B.api.name('Aaron Tan'); await B.api.named(null, B.api.me()); await flush();
    B.api.tick('bass'); await flush();
    check('phone B gives the name, gets both, and unticks Bass', same(B.api.parts(), ['guitar']) && same(A.db.rows['aaron tan'], ['guitar']));
    const A2 = makeSim({ db: A.db, store: A.store });   // phone A opens the songbook again
    A2.api.pull(); await flush();
    check('a part unticked on one phone stays unticked on the other, and it says so',
      same(A2.api.parts(), ['guitar']) && same(A.db.rows['aaron tan'], ['guitar']) && A2.toasts[0] === 'Your parts are Guitar now, as chosen on another device' && A2.hooks.shown === 1,
      JSON.stringify({ parts: A2.api.parts(), rows: A.db.rows, toasts: A2.toasts }));
    const A3 = makeSim({ db: A.db, store: A.store }), w3 = A.db.writes.length;
    A3.api.name('Aaron Tan');
    const j3 = await A3.api.named(A3.api.me(), A3.api.me()); await flush();
    check('...and giving the same name again there takes the name\'s, not a join of the two',
      same(A3.api.parts(), ['guitar']) && j3 && j3.mode === 'saved' && A.db.writes.length === w3, JSON.stringify({ parts: A3.api.parts(), j3 }));

    const s = makeSim({ rows: { 'aaron tan': ['guitar', 'bass'] }, store: { lhc_sbm_me: aaron, lhc_sbm_parts: '["guitar","bass"]', lhc_sbm_parts_of: 'aaron tan' } });
    s.db.failWrites = true;
    s.api.tick('bass'); await flush();
    check('a tick whose save fails leaves the device marked as holding a change', s.api.dirty() === 'aaron tan' && same(s.db.rows['aaron tan'], ['guitar', 'bass']));
    s.db.failWrites = false;
    const s2 = makeSim({ db: s.db, store: s.store });
    s2.api.pull(); await flush();
    check('...and next time the device\'s change wins: the part stays unticked, is saved, and nothing is said',
      same(s2.api.parts(), ['guitar']) && same(s.db.rows['aaron tan'], ['guitar']) && s2.api.dirty() === null && s2.toasts.length === 0,
      JSON.stringify({ parts: s2.api.parts(), rows: s.db.rows, dirty: s2.api.dirty(), toasts: s2.toasts }));

    const t = makeSim({ rows: { 'aaron tan': ['guitar'] }, store: { lhc_sbm_me: aaron, lhc_sbm_parts: '["guitar"]', lhc_sbm_parts_of: 'aaron tan' } });
    t.db.holdReads = true;
    t.api.pull(); await flush();
    const late = t.db.heldReads.shift();
    t.db.holdReads = false;
    t.api.tick('keys'); await flush();
    if (late) { late(); await flush(); }
    check('a read that left before a tick cannot undo it, even when the tick was saved first',
      !!late && same(t.api.parts(), ['guitar', 'keys']) && same(t.db.rows['aaron tan'], ['guitar', 'keys']),
      JSON.stringify({ late: !!late, parts: t.api.parts(), rows: t.db.rows }));

    const h = makeSim({ rows: { 'grace lim': ['drums'] }, store: { lhc_sbm_me: JSON.stringify({ name: 'Grace Lim' }), lhc_sbm_parts: '["drums","keys"]', lhc_sbm_parts_of: 'grace lim', lhc_sbm_parts_dirty: 'grace lim' } });
    const g = h.api.me(); h.api.name('Aaron Tan');
    await h.api.named(g, h.api.me()); await flush();
    check('a phone handed on with a change not saved: the change is kept with its own name first',
      same(h.db.rows['grace lim'], ['keys', 'drums']) && same(h.api.parts(), []) && !h.db.rows['aaron tan'], JSON.stringify({ rows: h.db.rows, parts: h.api.parts() }));

    const p = makeSim({ rows: { 'aaron tan': ['guitar'] }, store: { lhc_sbm_me: aaron, lhc_sbm_parts: '["guitar"]', lhc_sbm_parts_of: 'aaron tan' } });
    p.api.pull(); await flush(); p.api.pull(); await flush();
    const twice = p.db.reads;
    p.api.unthrottle(); p.api.pull(); await flush();
    check('read back at most once in 30 seconds', twice === 1 && p.db.reads === 2, 'reads: ' + twice + ' then ' + p.db.reads);
  }

  console.log('\nThe parts follow the name: the wiring');
  {
    const has = re => re.test(SRC);
    const body = n => { try { return extractFn(n); } catch (e) { return ''; } };
    check('a tick under Layers is kept with the name', has(/try \{ localStorage\.setItem\('lhc_sbm_parts', JSON\.stringify\(a\)\); \} catch \(e\) \{\}\r?\n\s*_sbmPrefsTicked\(p, i === -1\);/));
    check('giving a name brings its parts back with its drawings, in one toast, and redraws when they change',
      has(/Promise\.all\(\[drawn, _sbmPrefsNamed\(was, me\)\]\)/) && has(/if \(J && J\.moved\) _sbmPartsShown\(\);\r?\n\s*var text = _sbmWelcome/));
    check('a device named before is joined, and a named one reads its parts back, once the layers are found',
      has(/function\(r2\) \{ _sbmLayersOk = !r2\.error; if \(_sbmLayersOk\) _sbmPrefsPull\(\); return true; \}/));
    check('opening Layers reads the name\'s parts back too', /\n\s*if \(me\) _sbmPrefsPull\(\);/.test(body('sbmLayers')));
    check('a tick marks the device as holding a change until it is saved',
      /_sbmPrefsTicks\+\+;\r?\n\s*try \{ localStorage\.setItem\('lhc_sbm_parts_dirty', me\.key\); \} catch \(e\) \{\}/.test(body('_sbmPrefsTicked')) &&
      /_sbmPartsClean\(me\.key\)/.test(body('_sbmPrefsWrite')) && /var dirty = _sbmPartsDirty\(me\.key\) \|\| ticks !== _sbmPrefsTicks;/.test(body('_sbmPrefsSync')));
    check('the table is probed once, and its absence turns the feature off',
      has(/sup\.from\('drawer_prefs'\)\.select\('owner'\)\.limit\(1\)/) && /_sbmPrefsOk = !!\(r && !r\.error\)/.test(body('_sbmPrefsSupport')) &&
      /_sbmPrefsOk !== true/.test(body('_sbmPrefsSync')) && /_sbmPrefsOk !== true/.test(body('_sbmPrefsWrite')));
    const all = (SRC.match(/\.from\('drawer_prefs'\)/g) || []).length, viaSup = (SRC.match(/\bsup\.from\('drawer_prefs'\)/g) || []).length;
    check('every request for drawer_prefs goes through window._supabase (the Phone view\'s guard covers it)',
      all === 3 && viaSup === 3 && ['_sbmPrefsSupport', '_sbmPrefsSync', '_sbmPrefsWrite'].every(n => /var sup = window\._supabase/.test(body(n))) &&
      !/rest\/v1\/drawer_prefs/.test(SRC), 'from: ' + all + ', via sup: ' + viaSup);
    check('a save names the row it is for', /\.upsert\(\{ owner: me\.key, owner_name: me\.name, parts: sent, updated_at: new Date\(\)\.toISOString\(\) \}, \{ onConflict: 'owner' \}\)/.test(body('_sbmPrefsWrite')));
    const note = body('_sbmWhoNote');
    check('"How does it know who I am?" says the parts go with the name, once they do',
      /It is kept with your name as well as on this device/.test(note) && /var kept = _sbmPrefsOk === true;/.test(note) && !/also kept on this device/.test(note));
    check('the who sheet says so too', has(/Your drawings and the parts you choose under Layers carry this name/));
    const sql = fs.existsSync(PREFS_MIGRATION) ? fs.readFileSync(PREFS_MIGRATION, 'utf8') : '';
    check('the migration makes the table, one row per name',
      /create table if not exists public\.drawer_prefs/.test(sql) && /owner\s+text primary key/.test(sql) && /owner_name\s+text/.test(sql) &&
      /parts\s+text\[\] not null default '\{\}'/.test(sql) && /updated_at\s+timestamptz not null default now\(\)/.test(sql));
    check('...and lets the page\'s key read, add and change rows (RLS with no policy reads as empty)',
      /enable row level security/.test(sql) && /for select\s+using \(true\)/.test(sql) && /for insert\s+with check \(true\)/.test(sql) &&
      /for update\s+using \(true\)\s+with check \(true\)/.test(sql) && !/for delete/.test(sql));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has layers (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL  the harness itself threw: ' + (e && e.stack || e)); process.exit(EXPECT_BROKEN ? 0 : 1); });

