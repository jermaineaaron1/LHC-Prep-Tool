'use strict';
// Harness for a liturgy's Sundays and years, and the service page's tools
// around them (2026-11-15).
//
// From the operator: "What if the one Liturgy I made applies for all sundays
// of Advent or half the sundays in lent and another variation is the other
// half ... Also, how do I refer to the years?" Asked, they chose: tick the
// Sundays a ready liturgy is for, the year with its lectionary year beside it
// ("2026 · Year B"), and Lent, Easter and Epiphany as collections of their
// own. With the same screenshots: the LCD item window in the library's look
// with a preview like the LCD's, files renamed and dated, the preview full
// screen, and a liturgy made from a Google Doc.
//
//   1. Which Sunday a day is: the roster's words and a document's name.
//   2. A liturgy's Sundays: the words for them, ticking, which suit a Sunday.
//   3. The lectionary year of a service in a calendar year.
//   4. The season collections.
//   5. The service page: this year's liturgy, the documents, Make ready.
//   6. The LCD item window, the preview window.
//   7. A Google Doc read as Word (the server's helper, run).
//
// USAGE
//   node tools/liturgy-sundays-harness.js
//   node tools/liturgy-sundays-harness.js <Index.html> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8');
const GLIB = path.join(__dirname, '..', 'app', 'api', '_lib', 'googleDoc.ts');
const GROUTE = path.join(__dirname, '..', 'app', 'api', 'google-doc', 'route.ts');
const GRSRC = fs.existsSync(GROUTE) ? fs.readFileSync(GROUTE, 'utf8') : '';

function extractFrom(text, startRe) {
  const ls = text.split('\n');
  const startIdx = ls.findIndex(l => startRe.test(l));
  if (startIdx < 0) throw new Error('not found: ' + startRe);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < ls.length; i++) {
    out.push(ls[i]);
    for (const ch of ls[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced braces: ' + startRe);
}
const fn = n => { try { return extractFrom(SRC, new RegExp('^  function ' + n + '\\s*\\(')); } catch (e) { return ''; } };
const blk = re => { const m = SRC.match(re); return m ? m[0] : ''; };

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

// The pure pieces, run against the page's own occasion list.
let S = null;
try {
  const parts = [
    blk(/  var OCCASIONS = \[[\s\S]*?\r?\n  \];/), blk(/  var LL_ORD = [^\n]*;/), (() => { try { return extractFrom(SRC, /^  var LL_SUNDAYS = \{/); } catch (e) { return ''; } })(),
    blk(/  var LL_LATE = [^\n]*;/),
    ['_occasionKind', '_llCycle', '_llSundayOf', '_llSundaysText', '_llForSunday', '_llDaysToggle', '_llDaysHtml', '_llCycleFor', '_llYearText', '_spForNext', '_spGdocId'].map(fn).join('\n')
  ];
  if (parts.every(Boolean)) {
    S = new Function(parts.join('\n') + '\nfunction getOccasionById(id) { return OCCASIONS.filter(function(o) { return o.id === id; })[0] || null; }' +
      '\nfunction _lfE(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }' +
      '\nreturn { OCCASIONS: OCCASIONS, SUNDAYS: LL_SUNDAYS, sundayOf: _llSundayOf, text: _llSundaysText, forSunday: _llForSunday, toggle: _llDaysToggle, html: _llDaysHtml,' +
      ' cycle: _llCycle, cycleFor: _llCycleFor, yearText: _llYearText, forNext: _spForNext, gdocId: _spGdocId };')();
  } else console.log('  (the pieces are not all on the page)');
} catch (e) { S = null; console.log('  (could not build: ' + e.message + ')'); }

(async () => {
  // ------------------------------------------------------------ 1. which Sunday
  console.log('\n1. Which Sunday a day is');
  check('the pieces are on the page', !!S);
  if (S) {
    const k = d => { const r = S.sundayOf(d); return r ? r.key : null; };
    check('the roster\'s own words: Advent, Lent, after Easter', k('1st Sunday of Advent') === 'advent:1' && k('4th Sunday of Advent') === 'advent:4' &&
      k('3rd Sunday in Lent') === 'lent:3' && k('5th Sunday in Lent') === 'lent:5' && k('1st Sunday after Easter') === 'easter-season:1' && k('6th Sunday after Easter') === 'easter-season:6');
    check('the newer numbering: the 3rd Sunday OF Easter is the 2nd after it', k('3rd Sunday of Easter') === 'easter-season:2' && k('2nd Sunday of Easter') === 'easter-season:1');
    check('Epiphany: the day, the Baptism of our Lord, the Sundays after, the Transfiguration', k('The Epiphany of Our Lord') === 'epiphany:0' &&
      k('Baptism of Our Lord') === 'epiphany:1' && k('1st Sunday after Epiphany') === 'epiphany:1' && k('4th Sunday after the Epiphany') === 'epiphany:4' &&
      k('Transfiguration of Our Lord') === 'epiphany:last');
    check('a document\'s own name: "1st Sunday Advent (Communion)", "Second Sunday in Lent"', k('1st Sunday Advent (Communion)') === 'advent:1' && k('Second Sunday in Lent') === 'lent:2');
    check('Easter Day, Palm Sunday, a Sunday after Pentecost and Christmas are no season\'s Sunday', k('Easter Sunday') === null && k('Palm Sunday') === null &&
      k('5th Sunday after Pentecost') === null && k('Christmas Day') === null && k('') === null && k('9th Sunday of Advent') === null);
    const a = S.sundayOf('2nd Sunday of Advent');
    check('...with its name and its short name', a && a.label === '2nd Sunday of Advent' && a.short === 'Advent 2' && a.occ === 'advent');
  }

  // ------------------------------------------------------------ 2. a liturgy's Sundays
  console.log('\n2. Which Sundays a liturgy is for');
  if (S) {
    check('in a few words; none, or all four, is every Sunday', S.text('advent', ['advent:1', 'advent:3']) === 'Advent 1, Advent 3' &&
      S.text('advent', []) === 'All Sundays' && S.text('advent', null) === 'All Sundays' && S.text('advent', ['advent:1', 'advent:2', 'advent:3', 'advent:4']) === 'All Sundays' &&
      S.text('good-friday', []) === '');
    check('a liturgy for no Sundays in particular suits every Sunday; one ticked for some suits only those',
      S.forSunday(undefined, 'advent:2') && S.forSunday([], 'advent:2') && S.forSunday(['advent:2'], 'advent:2') && !S.forSunday(['advent:1', 'advent:3'], 'advent:2') &&
      S.forSunday(['advent:1'], ''));
    let d = S.toggle('advent', [], 'advent:3');
    d = S.toggle('advent', d, 'advent:1');
    const two = d.join();
    d = S.toggle('advent', d, 'advent:2'); d = S.toggle('advent', d, 'advent:4');
    check('ticking keeps the season\'s order; all of them ticked is every Sunday again; "All Sundays" empties it', two === 'advent:1,advent:3' && d.length === 0 &&
      S.toggle('advent', ['advent:2'], '*').length === 0 && S.toggle('advent', ['advent:2'], 'advent:2').length === 0 && S.toggle('lent', ['advent:2'], 'lent:1').join() === 'lent:1');
    const h = S.html('advent', ['advent:2'], 'cvDay');
    check('drawn as boxes to tick: All Sundays, then each, the ticked ones on', /onchange="LiturgyModule\.cvDay\('\*'\)">All Sundays<\/label>/.test(h) &&
      (h.match(/class="ll-day( is-on)?"/g) || []).length === 4 && /class="ll-day is-on" title="2nd Sunday of Advent"><input type="checkbox" checked data-k="advent:2"/.test(h));
    const rows = [
      { id: 'all-2023', year: 2023, data: {} },
      { id: 'c13-2026', year: 2026, data: { forDays: ['advent:1', 'advent:3'] } },
      { id: 'n24-2026', year: 2026, data: { forDays: ['advent:2', 'advent:4'] } },
      { id: 'all-2026', year: 2026, data: {} },
      { id: 'c1-2024', year: 2024, data: { forDays: ['advent:1'] } }];
    check('for the coming Sunday: those ticked for it first, then those for every Sunday, newest year first',
      S.forNext(rows, 'advent:1').map(r => r.id).join() === 'c13-2026,c1-2024,all-2026,all-2023' &&
      S.forNext(rows, 'advent:2').map(r => r.id).join() === 'n24-2026,all-2026,all-2023', S.forNext(rows, 'advent:1').map(r => r.id).join());
  }

  // ------------------------------------------------------------ 3. the lectionary year
  console.log('\n3. The lectionary year');
  if (S) {
    check('Advent and Christmas begin the next church year; the rest are in the one before', S.cycleFor('advent', 2026) === 'Year B' &&
      S.cycleFor('christmas-eve', 2026) === 'Year B' && S.cycleFor('easter', 2026) === 'Year A' && S.cycleFor('good-friday', 2025) === 'Year C' &&
      S.cycleFor('maundy-thursday', 2024) === 'Year B' && S.cycleFor('lent', 2027) === 'Year B', [S.cycleFor('advent', 2026), S.cycleFor('easter', 2026), S.cycleFor('good-friday', 2025)].join());
    check('...as the page\'s own date strip has it (29 Nov 2026 is Year B)', S.cycle('2026-11-29') === S.cycleFor('advent', 2026));
    check('a funeral, a midweek, Mother\'s Day or no year has none', S.cycleFor('funeral', 2026) === '' && S.cycleFor('midweek', 2026) === '' &&
      S.cycleFor('mothers-day', 2026) === '' && S.cycleFor('advent', '') === '' && S.cycleFor('nowhere', 2026) === '');
    check('"2026 · Year B", or the year alone', S.yearText('advent', 2026) === '2026 · Year B' && S.yearText('funeral', 2026) === '2026' && S.yearText('advent', '') === '');
  }

  // ------------------------------------------------------------ 4. the season collections
  console.log('\n4. Lent, Easter and Epiphany as collections');
  if (S) {
    const ids = S.OCCASIONS.map(o => o.id);
    check('beside Advent Sundays, in the church year\'s order', ids.indexOf('epiphany') > ids.indexOf('watchnight') && ids.indexOf('epiphany') < ids.indexOf('ash-wednesday') &&
      ids.indexOf('lent') > ids.indexOf('ash-wednesday') && ids.indexOf('lent') < ids.indexOf('palm-sunday') && ids.indexOf('easter-season') === ids.indexOf('easter') + 1);
    check('...as points of the church year, with their Sundays to tick', ['epiphany', 'lent', 'easter-season', 'advent'].every(id => {
      const o = S.OCCASIONS.find(x => x.id === id); return o && !o.kind && (S.SUNDAYS[id] || []).length > 3; }) && S.SUNDAYS.lent.length === 5 && S.SUNDAYS['easter-season'].length === 6);
  }
  check('each has its usual checklist, a place in the library\'s season filter, and the older pickers', /    'lent':           \[ \{id:'confession'/.test(SRC) &&
    /'epiphany': 'epiphany', 'lent': 'lent', 'easter-season': 'easter',/.test(SRC) && /qaOccOpt\('easter-season'/.test(SRC) && /occOpt\('lent',/.test(SRC) &&
    /'watchnight','epiphany','ash-wednesday','lent',/.test(SRC));
  const save = fn('lbdSvlSave');
  check('Save over in the Builder keeps the Sundays a liturgy was ticked for', /select\('data'\)\.eq\('id', from\.id\)/.test(save) &&
    /if \(was && Array\.isArray\(was\.forDays\) && was\.forDays\.length\) row\.data\.forDays = was\.forDays\.slice\(\);/.test(save));

  // ------------------------------------------------------------ 5. the service page
  console.log('\n5. The service page');
  const mk = fn('_spMakeHtml');
  check('This year\'s liturgy: the coming Sunday with its lectionary year, the ready liturgies for it with Use, and how to make one',
    /_spForNext\(\(d && d\.rows\) \|\| \[\], sun && sun\.occ === occ \? sun\.key : ''\)/.test(mk) && /\[next\.day, cyc\]/.test(mk) &&
    /onclick="LiturgyModule\.spUse\(this\.dataset\.id\)"><i class="fa-solid fa-download" aria-hidden="true"><\/i><span>Use<\/span>/.test(mk) &&
    /How to make this year’s from a past one/.test(mk) && /No ready liturgy for this Sunday yet\./.test(mk) && /a Year B liturgy from 2023 suits Year B again in 2026/.test(mk));
  const ready = fn('_spReadyHtml');
  check('a ready liturgy shows its Sundays and its year with its letter, and its Sundays can be changed',
    /_llSundaysText\(occId, \(r\.data \|\| \{\}\)\.forDays\)/.test(ready) && /_llCycleFor\(occId, r\.year\)/.test(ready) && /LiturgyModule\.spSundays\(this\.dataset\.id\)/.test(ready));
  const ss = fn('spSundaysSave');
  check('...saved into its own data and read back before it is reported', /select\('data'\)\.eq\('id', ed\.id\)/.test(ss) && /delete data\.forDays/.test(ss) &&
    /update\(\{ data: data, updated_at: new Date\(\)\.toISOString\(\) \}\)\.eq\('id', ed\.id\)\.select\('id,data'\)/.test(ss) &&
    /if \(JSON\.stringify\(back\) !== JSON\.stringify\(ed\.days\)\) throw/.test(ss));
  const res = fn('_spResHtml');
  check('each document says when it was added and its year\'s letter, and can be renamed where it is',
    /var added = it\.created \? 'Added ' \+ _lfWhen\(it\.created\) : '';/.test(res) && /y \? _llYearText\(occ\.id, y\) : ''/.test(res) &&
    /onclick="LiturgyModule\.spRename\(this\.dataset\.id\)" aria-label="Rename"/.test(res) && /updateItem\(id, \{ title: name \}\);/.test(fn('spRename')) &&
    /renderService\(\);/.test(fn('spRename')));
  check('a year chip carries its letter', /var cy = y && y !== '—' \? _llCycleFor\(occ\.id, y\) : '';/.test(res));
  check('a Google Doc can be added as a liturgy, filed in its year, and made ready', /onclick="LiturgyModule\.spAddGdoc\(\)"/.test(res) &&
    /tags: \['link', 'liturgy-doc'\]/.test(fn('spAddGdocSave')) && /ensureOccYearFolder\(occ, year\)/.test(fn('spAddGdocSave')) &&
    /spConvert\(item\.id\)/.test(fn('spAddGdocSave')) && /\|\| !!_spGdocId\(it\.fileUrl\)\)/.test(res));
  if (S) {
    check('...known by its address alone', S.gdocId('https://docs.google.com/document/d/1xfXfgJeJgWAKoBOUKjxTF4OvGmWDQpBZJxniSpBa5kI/edit?usp=drive_link') === '1xfXfgJeJgWAKoBOUKjxTF4OvGmWDQpBZJxniSpBa5kI' &&
      S.gdocId('https://docs.google.com/document/u/0/d/1xfXfgJeJgWAKoBOUKjxTF4OvGmWDQpBZJxniSpBa5kI/view') === '1xfXfgJeJgWAKoBOUKjxTF4OvGmWDQpBZJxniSpBa5kI' &&
      S.gdocId('https://docs.google.com/spreadsheets/d/1xfXfgJeJgWAKoBOUKjxTF4OvGmWDQpBZJxniSpBa5kI') === '' && S.gdocId('https://evil.example/document/d/x') === '');
  }
  const conv = fn('spConvert'), rd = fn('_cvRead'), draw = fn('_cvDraw'), keep = fn('cvSave');
  check('Make ready reads a Google Doc as Word, through the server; it is not offered to the AI, which reads only our own files',
    /fetch\(cv\.gdoc \? '\/api\/google-doc\?id=' \+ encodeURIComponent\(cv\.gdoc\) : cv\.url\)/.test(rd) && /WO\.docxParas\(ab\)/.test(rd) &&
    /cv\.how === 'word' && !cv\.gdoc \?/.test(draw) && /\(cv\.gdoc \? '' : ' Not right\?/.test(draw));
  check('...says why when Google will not hand it over', /throw new Error\(j\.error \|\| \(cv\.gdoc \? 'Google would not hand the document over'/.test(rd));
  check('Make ready asks which Sundays, starting from the one the document is named for, and keeps them with the liturgy',
    /forDays: named && named\.occ === occId \? \[named\.key\] : \[\]/.test(conv) && /_llDaysHtml\(cv\.occ, cv\.forDays, 'cvDay'\)/.test(draw) &&
    /if \(LL_SUNDAYS\[cv\.occ\] && cv\.forDays && cv\.forDays\.length\) data\.forDays = cv\.forDays\.slice\(\);/.test(keep) &&
    /_cv\.forDays = _llDaysToggle\(_cv\.occ, _cv\.forDays, key\);/.test(fn('cvDay')));
  check('...and shows the year\'s letter as the year is typed', /<small id="cvCyc">' \+ _lfE\(_llCycleFor\(cv\.occ, cv\.year\)\)/.test(draw) &&
    /if \(k === 'year'\) \{ var c = document\.getElementById\('cvCyc'\); if \(c\) c\.textContent = _llCycleFor\(_cv\.occ, _cv\.year\); \}/.test(fn('cvSet')));
  check('Keep as a ready liturgy reads in black: the Make ready window is on <body>, where the maroon was never defined',
    /\.cv \.lf-btn\.sp-btn-maroon, \.cv \.lf-btn--primary\.sp-btn-maroon \{ background: #e9b949; border-color: #d4a53a; color: #111; \}/.test(SRC));

  // ------------------------------------------------------------ 6. the windows
  console.log('\n6. The LCD item window and the preview window');
  const prev = fn('updatePreviewFromPanes');
  check('the LCD item window previews through the projector\'s own renderer, at the LCD\'s size, wrapping', /WO\.projectionHtml\(slideContent\)/.test(prev) &&
    /_litLcdFit\(previewText\);/.test(prev) && /WO\.projectionTextSettings\(\)/.test(fn('_litLcdSettings')) &&
    /projectionTextSettings: function\(\) \{ loadTextSettings\(\); return JSON\.parse\(JSON\.stringify\(textSettings\)\); \},/.test(SRC) &&
    /w \* \(parseFloat\(t\.fontSize\) \|\| 6\.5\) \/ 100/.test(fn('_litLcdFit')) && /while \(el\.scrollHeight > box\.clientHeight \+ 1 && px > min/.test(fn('_litLcdFit')));
  check('...on a 16:9 screen with the LCD\'s gold edge and SAFE ZONE; the preview-only Size / Colour / Style went',
    /<div class="lit-lcd" id="liturgyPreviewScreen">/.test(SRC) && /\.lit-lcd \{ position: relative; margin: 0 16px 12px; aspect-ratio: 16 \/ 9;/.test(SRC) &&
    /<span class="lit-lcd__tag" aria-hidden="true">SAFE ZONE<\/span>/.test(SRC) && !/id="previewFontSize"/.test(SRC) && !/id="previewFontColor"/.test(SRC));
  check('...in the Liturgy Library\'s colours', /#liturgyModal \.modal-header \{ background: radial-gradient\(circle at 88% 20%/.test(SRC) &&
    /#liturgyModal \.modal-btn-primary \{ background: #1f4d36;/.test(SRC) && /#liturgyModal \.liturgy-editor-container \{ background: #fbf7ef; \}/.test(SRC));
  check('the preview window goes full screen and back (the window, as an iPhone has no element full screen)',
    /onclick="LiturgyModule\.lfFull\(\)" aria-label="Full screen"/.test(fn('lfOpen')) && /var on = v\.classList\.toggle\('lf-vw--full'\);/.test(fn('lfFull')) &&
    /\.lf-vw--full \.lf-vw__card \{ width: 100%; max-width: none; height: 100vh; height: 100dvh;/.test(SRC) && /lfFull: lfFull/.test(SRC));

  // ------------------------------------------------------------ 7. a Google Doc
  console.log('\n7. A Google Doc, read as Word');
  let G = null;
  try {
    const ts = require('typescript');
    const js = ts.transpileModule(fs.readFileSync(GLIB, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
    const mod = { exports: {} };
    new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
    G = mod.exports;
  } catch (e) { G = null; console.log('  (googleDoc.ts could not be compiled: ' + e.message + ')'); }
  check('the helper is there', !!(G && G.gdocExportUrl));
  if (G && G.gdocExportUrl) {
    check('only Google\'s export address for a document id, and nothing else', G.gdocExportUrl('1xfXfgJeJgWAKoBOUKjxTF4OvGmWDQpBZJxniSpBa5kI') ===
      'https://docs.google.com/document/d/1xfXfgJeJgWAKoBOUKjxTF4OvGmWDQpBZJxniSpBa5kI/export?format=docx' &&
      G.gdocExportUrl('../../x') === null && G.gdocExportUrl('abc/def?g=1') === null && G.gdocExportUrl('') === null && G.gdocExportUrl('short') === null);
    check('a .docx is known by the zip it is; Google\'s sign-in page is not one', G.looksLikeDocx(Uint8Array.from([0x50, 0x4b, 3, 4, 20])) &&
      !G.looksLikeDocx(new TextEncoder().encode('<!DOCTYPE html><html>Sign in')) && !G.looksLikeDocx(new Uint8Array(0)));
  }
  check('the route fetches only that address, refuses a page that is not a .docx, and says how to share it', !!GRSRC &&
    /const url = gdocExportUrl\(req\.nextUrl\.searchParams\.get\('id'\) \|\| ''\);/.test(GRSRC) && /if \(!url\) return NextResponse\.json\(\{ error: 'That is not a Google Doc\.' \}, \{ status: 400 \}\);/.test(GRSRC) &&
    /if \(!looksLikeDocx\(bytes\)\) return NextResponse\.json\(\{ error: PRIVATE, private: true \}, \{ status: 403 \}\);/.test(GRSRC) &&
    /Anyone with the link can view/.test(GRSRC) && /signal: AbortSignal\.timeout\(20000\)/.test(GRSRC) && /Number\(res\.headers\.get\('content-length'\) \|\| 0\) > GDOC_MAX_BYTES/.test(GRSRC));

  // ------------------------------------------------------------ 8. year folders
  // "How do I move files from one year to another? also how do I create year
  // folders?" (2026-11-15): + Year, a year in the preview, a drag onto a chip.
  console.log('\n8. Year folders: made, and moved into');
  try {
    const log = [], items = { d1: { id: 'd1', title: 'Advent Liturgy', occasionId: 'advent', occasionFolderId: null } };
    const env = {
      occFolders: { advent: [{ id: 'f26', name: '2026' }, { id: 'fx', name: 'Choir things' }] },
      getItem: id => items[id], updateItem: (id, patch) => { Object.assign(items[id], patch); log.push('update ' + id + ' ' + JSON.stringify(patch)); },
      ensureOccYearFolder: (occ, y) => { log.push('ensure ' + occ + ' ' + y); return Promise.resolve({ id: 'f' + y.slice(2), name: y, created: true }); },
      lfCloseViewer: () => log.push('close'), renderService: () => log.push('render'), _lfRefreshSoon: () => {},
      showToast: (msg, kind, opts) => { log.push('toast ' + msg); env.lastUndo = opts && opts.onAction; }, _sp: { occ: 'advent' }
    };
    const names = ['_spYearFolders', '_spKeepFolder', '_spYearIn', 'spMoveYear', 'spYearOver', 'spYearDrop', 'spDragStart'];
    const bodies = names.map(fn);
    if (!bodies.every(Boolean)) throw new Error('missing: ' + names.filter((n, i) => !bodies[i]).join(', '));
    const Y = new Function(...Object.keys(env).filter(k => k !== 'lastUndo'), bodies.join('\n') + '\nreturn { folders: _spYearFolders, yearIn: _spYearIn, move: spMoveYear, over: spYearOver, drop: spYearDrop, drag: spDragStart };')(
      ...Object.keys(env).filter(k => k !== 'lastUndo').map(k => env[k]));
    check('a service\'s year folders are those named as years; a year typed is four figures from 1990 to 2100',
      Y.folders('advent').map(f => f.name).join() === '2026' && Y.yearIn(' 2025 ') === '2025' && Y.yearIn('25') === '' && Y.yearIn('2200') === '' && Y.yearIn('Easter') === '');
    Y.move('d1', '2026');
    const toExisting = items.d1.occasionFolderId;
    await Y.move('d1', '2024'); await new Promise(r => setTimeout(r, 0));
    const toNew = items.d1.occasionFolderId, made = log.some(l => l === 'ensure advent 2024'), kept = env.occFolders.advent.some(f => f.id === 'f24');
    env.lastUndo && env.lastUndo();
    const undone = items.d1.occasionFolderId;
    Y.move('d1', '');
    const cleared = items.d1.occasionFolderId;
    const n = log.filter(l => l.startsWith('update')).length;
    Y.move('d1', '');
    check('moved into a year\'s folder; a year with none gets one first and keeps it; Undo puts it back; no year takes it out',
      toExisting === 'f26' && toNew === 'f24' && made && kept && undone === 'f26' && cleared === null, JSON.stringify({ toExisting, toNew, made, kept, undone, cleared }));
    check('...and a move to where it already is changes nothing', log.filter(l => l.startsWith('update')).length === n && /is already in no year folder/.test(log[log.length - 1]));
    let prevented = 0;
    const chip = { getAttribute: () => '—', classList: { add() {}, remove() {} } };
    Y.over({ dataTransfer: { types: ['Files'] }, preventDefault: () => prevented++ }, chip);
    const other = prevented;
    Y.over({ dataTransfer: { types: ['text/plain', 'application/x-lhc-item'], dropEffect: '' }, preventDefault: () => prevented++ }, chip);
    items.d1.occasionFolderId = 'f26';
    Y.drop({ dataTransfer: { getData: t => t === 'application/x-lhc-item' ? 'd1' : '' }, preventDefault() {} }, chip);
    const set = {}; Y.drag({ dataTransfer: { setData: (t, v) => { set[t] = v; } } }, 'd1');
    check('a row dragged onto a year chip moves there ("No year" takes it out); a file from the desktop is not taken for a row',
      other === 0 && prevented === 1 && items.d1.occasionFolderId === null && set['application/x-lhc-item'] === 'd1');
  } catch (e) { check('the year folder pieces run', false, e.message); }
  const res8 = fn('_spResHtml');
  check('the chips show every year folder, empty ones too, then + Year; each takes a row dropped on it',
    /_spYearFolders\(occ\.id\)\.forEach\(function\(f\) \{ years\[f\.name\] = true; \}\);/.test(res8) && /onclick="LiturgyModule\.spNewYear\(\)" title="Make a year folder"/.test(res8) &&
    /ondrop="LiturgyModule\.spYearDrop\(event, this\)"/.test(res8) && /draggable="true" ondragstart="LiturgyModule\.spDragStart\(event, this\.dataset\.id\)"/.test(res8) &&
    !/var chips = ys\.length > 1/.test(res8));
  check('+ Year asks for the year, refuses anything else, and makes the folder in the database', /_spAskYear\('New year folder', occ\)/.test(fn('spNewYear')) &&
    /ensureOccYearFolder\(occ, y\)/.test(fn('spNewYear')) && /A year folder is a year/.test(fn('spNewYear')));
  check('a file\'s preview has its year to change: its folders, no year folder, or a new year', /acts \+= _lfYearPick\(item\) \+/.test(fn('lfOpen')) &&
    /<option value="__new">A new year…<\/option>/.test(fn('_lfYearPick')) && /No year folder/.test(fn('_lfYearPick')) && /spMoveYear\(id, v\)/.test(fn('lfMoveYear')));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
})();
