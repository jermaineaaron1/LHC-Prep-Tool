'use strict';
// Harness for a saved liturgy's year folder in the Liturgy Library, and the
// load window's card text (2026-11-08). From the operator:
//
//   - In "Load a whole liturgy", the date / day / kind line bigger by 10px and
//     bold, and the liturgist's name beside the order's name.
//   - Saving a liturgy for an occasion and a year makes that year's folder
//     under the occasion in the Liturgy Library, to match it.
//
// The year folders are liturgy_occ_folders rows. The Liturgy page's own save
// used to delete every row it did not hold, which would wipe a folder made
// by the builder (or by another device) the next time anybody touched a
// folder there; it now deletes only the folders removed on that device.
//
// USAGE
//   node tools/svl-year-folder-harness.js
//   node tools/svl-year-folder-harness.js <file> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8');
const lines = SRC.split('\n');

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
const fn = n => { try { return extractFn(n); } catch (e) { return ''; } };
const has = re => re.test(SRC);

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}
const tick = () => new Promise(r => setImmediate(r));

// A Supabase client over plain arrays, enough for these queries.
function fakeSb(tables, opts) {
  opts = opts || {};
  const log = [];
  function run(st) {
    const t = tables[st.table] || (tables[st.table] = []);
    const match = row => st.filters.every(f => {
      if (f[0] === 'eq') return row[f[1]] === f[2];
      if (f[0] === 'neq') return row[f[1]] !== f[2];
      if (f[0] === 'in') return f[2].indexOf(row[f[1]]) !== -1;
      if (f[0] === 'notin') return f[2].indexOf(row[f[1]]) === -1;
      return true;
    });
    if (st.op === 'upsert') {
      if (!opts.dropWrites) st.rows.forEach(r => { const i = t.findIndex(x => x.id === r.id); if (i >= 0) t[i] = Object.assign({}, r); else t.push(Object.assign({}, r)); });
      return { error: null, data: st.rows };
    }
    if (st.op === 'delete') { for (let i = t.length - 1; i >= 0; i--) if (match(t[i])) t.splice(i, 1); return { error: null }; }
    return { error: null, data: t.filter(match).map(r => Object.assign({}, r)) };
  }
  function from(table) {
    const st = { table, op: 'select', filters: [], rows: null };
    const api = {
      select() { return api; },
      order() { return api; },
      eq(c, v) { st.filters.push(['eq', c, v]); return api; },
      neq(c, v) { st.filters.push(['neq', c, v]); return api; },
      in(c, v) { st.filters.push(['in', c, v]); return api; },
      not(c, op, v) { st.filters.push(['notin', c, String(v).replace(/^\(|\)$/g, '').split(',').map(x => x.replace(/^"|"$/g, ''))]); return api; },
      upsert(rows) { st.op = 'upsert'; st.rows = rows; return api; },
      insert(rows) { st.op = 'upsert'; st.rows = rows; return api; },
      delete() { st.op = 'delete'; return api; },
      then(res, rej) { log.push(st); return Promise.resolve(run(st)).then(res, rej); }
    };
    return api;
  }
  return { from, log };
}

// The Liturgy page's folder functions, in a scope of their own.
function folderScope(sb, state) {
  const body = ['saveOccFolders', 'deleteOccFolder', 'ensureOccYearFolder', '_occSvlInYear', '_occSvlSorted', '_occSvlShown', 'getOccFoldersForOccasion'].map(fn).join('\n');
  return new Function('S', 'SBQ_LITURGY', 'setTimeout', 'clearTimeout', 'console', 'showToast',
    'var occFolders = S.occFolders, _occFoldersLoaded = S.loaded, _occFoldersGone = S.gone, _currentOccasion = S.cur, _currentOccFolder = S.curFolder, _occSvlRows = S.svlRows, _saveOccFoldersTimer = null;' +
    'var liturgyItems = [];' +
    'function renderOccFolderBar() { S.bars++; } function renderOccasionItems() {} function renderSpecialElements() {} function _occSvlLoad(o) { S.svlLoads.push(o); return Promise.resolve(); }\n' +
    body + '\nreturn { save: typeof saveOccFolders === "function" ? saveOccFolders : null, del: typeof deleteOccFolder === "function" ? deleteOccFolder : null,' +
    ' ensure: typeof ensureOccYearFolder === "function" ? ensureOccYearFolder : null, inYear: typeof _occSvlInYear === "function" ? _occSvlInYear : null,' +
    ' sorted: typeof _occSvlSorted === "function" ? _occSvlSorted : null, shown: typeof _occSvlShown === "function" ? _occSvlShown : null,' +
    ' folders: function() { return occFolders; } };')(
    state, { _sb: () => sb }, f => { f(); return 1; }, () => {}, { log() {}, warn() {} }, () => {});
}
function newState(extra) {
  return Object.assign({ occFolders: {}, loaded: true, gone: {}, cur: null, curFolder: null, svlRows: {}, bars: 0, svlLoads: [] }, extra || {});
}

(async () => {
  // ------------------------------------------------------------ 1. the card
  console.log('\n1. The load window: the line under a name, and the liturgist');
  check('the date / day / kind line is 2px bigger (it was 10px; on 2026-11-08 the operator asked for 5px less, then 3px less again), only its date bold',
    has(/\.svl-card__meta \{ margin-top: 6px; font-size: calc\(0\.74rem \+ 2px\); font-weight: 400;/) && has(/\.svl-card__date \{ font-weight: 700;/));
  const card = fn('_svlCardHtml');
  check('the liturgist sits beside the order\'s name, not in that line',
    /\(x\.liturgist \? '<span class="svl-card__lit">/.test(card) && !/'Liturgist: ' \+ x\.liturgist/.test(card));
  check('...styled as a name, in the builder\'s green', has(/\.svl-card__lit \{ display: inline-flex; align-items: center; gap: 6px; font-weight: 500; color: #0b7644; \}/));

  // ------------------------------------------------------------ 2. the year folder
  console.log('\n2. A year folder for the occasion, made on save');
  let ok = false, detail = '';
  try {
    const tables = { liturgy_occ_folders: [{ id: 'f1', occasion_id: 'christmas-eve', name: '2025', sort_order: 0 }] };
    const sb = fakeSb(tables), st = newState({ occFolders: { 'christmas-eve': [{ id: 'f1', name: '2025' }] }, cur: 'christmas-eve' });
    const F = folderScope(sb, st);
    const got = await F.ensure('christmas-eve', 2026);
    const rows = tables.liturgy_occ_folders.filter(r => r.occasion_id === 'christmas-eve');
    ok = got && got.created === true && got.name === '2026' && rows.length === 2 && rows.some(r => r.name === '2026' && r.id === got.id) &&
      F.folders()['christmas-eve'].some(f => f.id === got.id) && st.bars > 0 && st.svlLoads.indexOf('christmas-eve') !== -1;
    detail = JSON.stringify({ got, rows, mem: F.folders(), bars: st.bars });
  } catch (e) { detail = e.message; }
  check('a year with no folder gets one: written, read back, held here, and the open occasion redrawn', ok, detail);

  ok = false; detail = '';
  try {
    const tables = { liturgy_occ_folders: [{ id: 'f9', occasion_id: 'easter', name: ' 2026 ', sort_order: 0 }] };
    const sb = fakeSb(tables), F = folderScope(sb, newState());
    const got = await F.ensure('easter', '2026');
    ok = got && got.created === false && got.id === 'f9' && tables.liturgy_occ_folders.length === 1 && !sb.log.some(q => q.op === 'upsert');
    detail = JSON.stringify({ got, n: tables.liturgy_occ_folders.length });
  } catch (e) { detail = e.message; }
  check('a year that has its folder already is not given a second one', ok, detail);

  ok = false; detail = '';
  try {
    const tables = { liturgy_occ_folders: [{ id: 'f9', occasion_id: 'easter', name: '2026', sort_order: 0 }] };
    const sb = fakeSb(tables), F = folderScope(sb, newState());
    const got = await F.ensure('pentecost', 2026);
    ok = got && got.created === true && tables.liturgy_occ_folders.length === 2 && tables.liturgy_occ_folders[1].occasion_id === 'pentecost';
  } catch (e) { detail = e.message; }
  check('another occasion\'s folder of the same year does not count', ok, detail);

  ok = false; detail = '';
  try {
    const sb = fakeSb({ liturgy_occ_folders: [] }, { dropWrites: true }), F = folderScope(sb, newState());
    await F.ensure('easter', 2026).then(() => { detail = 'it said yes'; }, e => { ok = /did not come back/.test(e.message); detail = e.message; });
  } catch (e) { detail = e.message; }
  check('a folder the database did not keep is reported, not assumed', ok, detail);

  ok = false; detail = '';
  try {
    const tables = { liturgy_occ_folders: [] };
    const st = newState({ occFolders: { easter: [{ id: 'occ-fold-1', name: '2027' }] } });
    const F = folderScope(fakeSb(tables), st);
    const got = await F.ensure('easter', 2027);
    ok = got.id === 'occ-fold-1' && tables.liturgy_occ_folders.length === 1 && F.folders().easter.length === 1;
  } catch (e) { detail = e.message; }
  check('one made here whose save is still waiting keeps its id (no twin)', ok, detail);

  const save = fn('lbdSvlSave'), yf = fn('_svlYearFolder');
  check('the save asks for the folder after the liturgy is read back, and the toast says where it is',
    /return _svlYearFolder\(saved\.occasion_id, saved\.year\)\.then\(function\(f\) \{/.test(save) &&
    save.indexOf("select('id').eq('id', saved.id)") < save.indexOf('_svlYearFolder(') &&
    /, in the Liturgy Library’s ' \+ f\.name \+ ' folder'/.test(save));
  check('a folder that cannot be made never fails the save', /return L\.ensureOccYearFolder\(occ, year\)\.catch\(function\(e\) \{[^\n]*return null; \}\);/.test(yf) &&
    /typeof L\.ensureOccYearFolder !== 'function'/.test(yf));
  check('the Save window says where it will be filed, and follows the occasion and year',
    /<span id="svlWhere">' \+ _lbdEsc\(_svlWhere\(occ, year\)\)/.test(fn('lbdSvlSaveSheet')) &&
    /w\.textContent = _svlWhere\(o\.value, parseInt\(y\.value, 10\)\);/.test(fn('lbdSvlName')) &&
    /'Filed in the Liturgy Library under ' \+ _svlOccLabel\(occ\) \+ ' › ' \+ year/.test(fn('_svlWhere')));

  // ------------------------------------------------------------ 3. folders survive other devices
  console.log('\n3. The Liturgy page\'s save deletes only what it removed');
  ok = false; detail = '';
  try {
    const tables = { liturgy_occ_folders: [
      { id: 'mine', occasion_id: 'easter', name: '2025', sort_order: 0 },
      { id: 'made-elsewhere', occasion_id: 'christmas-eve', name: '2026', sort_order: 0 }] };
    const st = newState({ occFolders: { easter: [{ id: 'mine', name: '2025' }] } });
    const F = folderScope(fakeSb(tables), st);
    F.save(); await tick(); await tick(); await tick();
    ok = tables.liturgy_occ_folders.some(r => r.id === 'made-elsewhere') && tables.liturgy_occ_folders.some(r => r.id === 'mine');
    detail = JSON.stringify(tables.liturgy_occ_folders.map(r => r.id));
  } catch (e) { detail = e.message; }
  check('a folder this device never loaded survives its save', ok, detail);

  ok = false; detail = '';
  try {
    const tables = { liturgy_occ_folders: [
      { id: 'keep', occasion_id: 'easter', name: '2025', sort_order: 0 },
      { id: 'drop', occasion_id: 'easter', name: '2024', sort_order: 1 },
      { id: 'other', occasion_id: 'lent', name: '2026', sort_order: 0 }] };
    const st = newState({ occFolders: { easter: [{ id: 'keep', name: '2025' }, { id: 'drop', name: '2024' }] }, cur: 'easter' });
    const F = folderScope(fakeSb(tables), st);
    F.del('easter', 'drop'); await tick(); await tick(); await tick();
    const ids = tables.liturgy_occ_folders.map(r => r.id);
    ok = ids.indexOf('drop') === -1 && ids.indexOf('keep') !== -1 && ids.indexOf('other') !== -1 && !Object.keys(st.gone).length;
    detail = JSON.stringify({ ids, gone: st.gone });
  } catch (e) { detail = e.message; }
  check('a folder removed here is deleted, and only that one', ok, detail);

  ok = false; detail = '';
  try {
    const tables = { liturgy_occ_folders: [{ id: 'only', occasion_id: 'easter', name: '2025', sort_order: 0 }, { id: 'x2', occasion_id: 'lent', name: '2026' }] };
    const st = newState({ occFolders: { easter: [{ id: 'only', name: '2025' }] }, cur: 'easter' });
    const F = folderScope(fakeSb(tables), st);
    F.del('easter', 'only'); await tick(); await tick(); await tick();
    ok = tables.liturgy_occ_folders.length === 1 && tables.liturgy_occ_folders[0].id === 'x2';
    detail = JSON.stringify(tables.liturgy_occ_folders.map(r => r.id));
  } catch (e) { detail = e.message; }
  check('removing the last folder held here does not empty the whole table', ok, detail);
  const so = fn('saveOccFolders');
  check('no "everything I do not hold" delete is left', !!so && !/\.not\('id', 'in'/.test(so) && !/\.neq\('id', 'x'\)/.test(so));

  // ------------------------------------------------------------ 4. the library lists it
  console.log('\n4. The Liturgy Library lists the whole liturgies, by year folder');
  ok = false; detail = '';
  try {
    const rows = [
      { id: 'a', title: 'Easter 2025', year: 2025, updated_at: '2025-04-01' },
      { id: 'b', title: 'Easter 2026', year: 2026, updated_at: '2026-03-01' },
      { id: 'c', title: 'Easter 2026 (copy)', year: 2026, updated_at: '2026-03-09' }];
    const st = newState({ occFolders: { easter: [{ id: 'y26', name: '2026' }, { id: 'y25', name: '2025' }] }, svlRows: { easter: rows } });
    const F = folderScope(fakeSb({}), st);
    const all = F.shown('easter').map(r => r.id).join(',');
    st.curFolder = 'y26';
    const F2 = folderScope(fakeSb({}), st);
    const y26 = F2.shown('easter').map(r => r.id).join(',');
    ok = all === 'c,b,a' && y26 === 'c,b' && F.inYear('easter', ' 2025 ').length === 1;
    detail = JSON.stringify({ all, y26 });
  } catch (e) { detail = e.message; }
  check('All lists every one, newest year and save first; a year folder lists its year\'s', ok, detail);
  check('the list has its place on the occasion\'s page, and is drawn with its items', has(/<div id="litOccSvlStrip" class="lit-occ-links-strip lit-occ-svl-strip"><\/div>/) &&
    /function renderOccasionItems\(searchQuery\) \{\r?\n    renderOccSvl\(\);/.test(SRC));
  check('opening an occasion, or syncing, reads its whole liturgies', /renderOccFolderBar\(occasionId\); \/\/ auto-seeds current year if none exists\r?\n    _occSvlLoad\(occasionId\);/.test(fn('selectOccasion')) &&
    /if \(_currentOccasion\) _occSvlLoad\(_currentOccasion\);/.test(fn('syncAll')));
  check('a year folder\'s card counts its liturgies beside its files', /var whole = _occSvlInYear\(occId, f\.name\)\.length;/.test(fn('renderOccFolderBar')) &&
    /\(whole \? ' · ' \+ whole \+ ' liturg' \+ \(whole === 1 \? 'y' : 'ies'\) : ''\)/.test(fn('renderOccFolderBar')));
  check('a liturgy opens to its outline, read only when opened', /sb\.from\('service_liturgies'\)\.select\('data'\)\.eq\('id', id\)/.test(fn('toggleOccSvl')) &&
    /W\.svlOutlineHtml\(d, 'lit-svl-outline', 'LiturgyModule\.occSvlItem', 'data-id="' \+ escapeHtml\(r\.id\) \+ '"', ''\)/.test(fn('renderOccSvl')) && /onclick="LiturgyModule\.toggleOccSvl\(this\.dataset\.id\)"/.test(fn('renderOccSvl')));
  check('the pieces are reachable: the folder from the builder, the outline from the library',
    has(/    ensureOccYearFolder: ensureOccYearFolder,\r?\n    toggleOccSvl: toggleOccSvl,/) && has(/    svlOutline: _svlOutline, svlCounts: _svlCounts,/));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
})();
