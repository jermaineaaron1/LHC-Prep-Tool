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
    ['_occasionKind', '_llCycle', '_llSundayOf', '_llSundaysText', '_llForSunday', '_llDaysToggle', '_llDaysHtml', '_llCycleFor', '_llYearText', '_spForNext', '_spGdocId', '_spUpcomingFor', '_spUseRows', '_spUsePick'].map(fn).join('\n')
  ];
  if (parts.every(Boolean)) {
    S = new Function(parts.join('\n') + '\nfunction getOccasionById(id) { return OCCASIONS.filter(function(o) { return o.id === id; })[0] || null; }' +
      '\nfunction _lfE(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }' +
      '\nreturn { OCCASIONS: OCCASIONS, SUNDAYS: LL_SUNDAYS, sundayOf: _llSundayOf, text: _llSundaysText, forSunday: _llForSunday, toggle: _llDaysToggle, html: _llDaysHtml,' +
      ' cycle: _llCycle, cycleFor: _llCycleFor, yearText: _llYearText, forNext: _spForNext, gdocId: _spGdocId, upcoming: _spUpcomingFor, useRows: _spUseRows, usePick: _spUsePick };')();
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
    /_spForNext\(\(d && d\.rows\) \|\| \[\], sun && sun\.occ === occ \? sun\.key : ''\)/.test(mk) && /\[next\.day, cyc, kind\]/.test(mk) &&
    /data-key="' \+ _lfE\(next\.key\) \+ '" onclick="LiturgyModule\.spUse\(this\.dataset\.id, this\.dataset\.key\)"><i class="fa-solid fa-download" aria-hidden="true"><\/i><span>Use<\/span>/.test(mk) &&
    /How to make this year’s from a past one/.test(mk) && /No Liturgy App File for this Sunday yet\./.test(mk) && /a Year B liturgy from 2023 suits Year B again in 2026/.test(mk));
  const ready = fn('_spReadyHtml');
  check('a ready liturgy shows its Sundays and its year with its letter, and its Sundays can be changed',
    /_llSundaysText\(occId, \(r\.data \|\| \{\}\)\.forDays\)/.test(ready) && /_llCycleFor\(occId, r\.year\)/.test(ready) && /LiturgyModule\.spSundays\(this\.dataset\.id\)/.test(ready));
  const ss = fn('spSundaysSave');
  check('...saved into its own data, with its year, and read back before it is reported', /select\('data'\)\.eq\('id', ed\.id\)/.test(ss) && /delete data\.forDays/.test(ss) &&
    /update\(\{ data: data, year: \+year, updated_at: new Date\(\)\.toISOString\(\) \}\)\.eq\('id', ed\.id\)\.select\('id,data,year'\)/.test(ss) &&
    /if \(String\(w\.data\[0\]\.year\) !== year \|\| \(ed\.hasDays && JSON\.stringify\(back\) !== JSON\.stringify\(ed\.days\)\)\) throw/.test(ss));
  const res = fn('_spResHtml');
  check('each document says when it was added and its year\'s letter, and can be renamed where it is',
    /var added = it\.created \? 'Added ' \+ _lfWhen\(it\.created\) : '';/.test(res) && /y \? _llYearText\(occ\.id, y\) : ''/.test(res) &&
    /onclick="LiturgyModule\.spRename\(this\.dataset\.id\)" aria-label="Rename"/.test(res) && /updateItem\(id, \{ title: name \}\);/.test(fn('spRename')) &&
    /renderService\(\);/.test(fn('spRename')));
  check('a year chip carries its letter (This Year\'s too)', /var cy = y !== '—' \? _llCycleFor\(occ\.id, y\) : '';/.test(res) && /var cyT = _llCycleFor\(occ\.id, thisY\);/.test(res));
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
    /forDays: opts\.days \? opts\.days\.slice\(\) : \(named && named\.occ === occId \? \[named\.key\] : \[\]\)/.test(conv) && /_llDaysHtml\(cv\.occ, cv\.forDays, 'cvDay'\)/.test(draw) &&
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
  // Then (2026-11-15): "give more priority and space for the content ... make
  // it as full screen as possible and a way to exit".
  check('the preview goes full screen: the document alone, the real full screen where the device has one, the window on an iPhone',
    /onclick="LiturgyModule\.lfFull\(\)" aria-label="Full screen"/.test(fn('lfOpen')) && /_lfSetFull\(v, on\);/.test(fn('lfFull')) &&
    /var req = v\.requestFullscreen \|\| v\.webkitRequestFullscreen;/.test(fn('lfFull')) && /if \(r && r\.catch\) r\.catch/.test(fn('lfFull')) &&
    /\.lf-vw--full \.lf-vw__hd, \.lf-vw--full \.lf-vw__ft, \.lf-vw--full \.lf-prev-note \{ display: none; \}/.test(SRC) &&
    /\.lf-vw--full \.lf-vw__card \{ position: relative; width: 100%; max-width: none; height: 100vh; height: 100dvh;/.test(SRC) && /lfFull: lfFull/.test(SRC));
  check('...with a way out: a floating Exit full screen, Esc (which leaves full screen before it closes), and the device\'s own exit',
    /class="lf-vw__exitfull" onclick="LiturgyModule\.lfFull\(\)" aria-label="Leave full screen"/.test(fn('lfOpen')) &&
    /if \(el\.classList\.contains\('lf-vw--full'\)\) \{ e\.preventDefault\(\); lfFull\(\); \} else lfCloseViewer\(\);/.test(fn('lfOpen')) &&
    /document\.addEventListener\('fullscreenchange', _lfFsChange\);/.test(fn('lfFull')) && /if \(v\._wentFs && v\.classList\.contains\('lf-vw--full'\)\) _lfSetFull\(v, false\);/.test(fn('_lfFsChange')) &&
    /if \(v && _lfFsEl\(\) === v\) _lfFsExit\(\);/.test(fn('lfCloseViewer')) && /\.lf-vw--full \.lf-vw__exitfull \{ display: inline-flex;/.test(SRC));

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
      showToast: (msg, kind, opts) => { log.push('toast ' + msg); env.lastUndo = opts && opts.onAction; }, _sp: { occ: 'advent' },
      _spYearOf: (it, occ) => { const f = (env.occFolders[occ] || []).find(x => x.id === it.occasionFolderId); return f ? f.name : ''; },
      _spYearConverted: (id, occ, y) => log.push('converted ' + id + ' ' + y)
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
    check('its Liturgy App Files go to its new year with it, and back with Undo; out of any year, they stay where they are',
      log.indexOf('converted d1 2026') !== -1 && log.indexOf('converted d1 2024') !== -1 && log.filter(l => l.startsWith('converted')).length === 3, log.filter(l => l.startsWith('converted')).join(', '));
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

  // ------------------------------------------------------------ 9. the year, where it is listed
  // "How to assign year?" (2026-11-15): the preview and the drag were not
  // found, a ready liturgy's year was fixed at Make ready, and the folder view
  // repeated the service page.
  console.log('\n9. The year where it is listed; one service, one page');
  const res9 = fn('_spResHtml');
  check('every document row has its year as a button, "No year" when it has none',
    /onclick="LiturgyModule\.spYearMenu\(this, this\.dataset\.id\)" aria-haspopup="menu" title="Change its year"/.test(res9) && /_lfE\(y \|\| 'No year'\)/.test(res9));
  check('...opening its service\'s years, no year folder and a new year, the one it is in ticked',
    /_spYearFolders\(occ\)\.sort/.test(fn('spYearMenu')) && /opt\('', 'No year folder', !cur\)/.test(fn('spYearMenu')) && /data-y="__new"/.test(fn('spYearMenu')) &&
    /f\.id === cur/.test(fn('spYearMenu')) && /if \(y === '__new'\) lfMoveYear\(id, '__new'\); else spMoveYear\(id, y\);/.test(fn('spYearPick')));
  check('...on <body>, kept under its button, gone when the button leaves the screen', /document\.body\.appendChild\(m\);/.test(fn('_spFloat')) &&
    /window\.addEventListener\('scroll', place, true\);/.test(fn('_spFloat')) && /if \(r\.bottom < 0 \|\| r\.top > vh\) \{ _spFloatClose\(menuId\); return; \}/.test(fn('_spFloat')));
  const sun9 = fn('spSundays');
  check('a ready liturgy\'s year can be changed with its Sundays (Year alone where a service has no Sundays to tick)',
    /<input id="spRdYear" type="number"/.test(sun9) && /if \(!r\) return;/.test(sun9) && !/if \(!r \|\| !LL_SUNDAYS\[occ\]\) return;/.test(sun9) &&
    /\(\/\^doc:\/\.test\(String\(r\.made_from \|\| ''\)\) \? 'Sundays' : 'Sundays & year'\)/.test(fn('_spReadyHtml')) &&
    /moved \? ensureOccYearFolder\(ed\.occ, year\)/.test(fn('spSundaysSave')) && /var year = ed\.yearFixed \? _spYearIn\(ed\.year\) : _spYearIn\(_plVal\('spRdYear'\)\);/.test(fn('spSundaysSave')));
  check('one service opens its own page from anywhere that asked for its folder; the folder view keeps the library-wide lists',
    /if \(occId && getOccasionById\(occId\)\) \{/.test(fn('openCollection')) && /openService\(occId, from === 'hub' \? 'hub' : 'services', 'order'\);/.test(fn('openCollection')) &&
    /if \(f\) \{ _sp\.year = f\.name; renderService\(\); \}/.test(fn('openCollection')) && /openLibrary\(special \|\| 'recent', year \|\| ''\);/.test(fn('openCollection')) &&
    !/All files by year folder/.test(res9) && /if \(occ && getOccasionById\(occ\)\) \{ openService\(occ\); return; \}/.test(fn('backToLibrary')));

  // ------------------------------------------------------------ 10. the walk through
  // From the operator (2026-11-15): the readings banner "takes up a lot of
  // space"; "How does the Make Ready Liturgy work? ... what does 'Keep as
  // ready liturgy' mean?"; "can you help to walk through the user with guided
  // animations".
  console.log('\n10. No banner; Make ready explained; a walk through');
  const ren10 = fn('renderService');
  check('the readings banner under the tabs is gone, its styles with it', !/_spStrip/.test(SRC) && !/\.pl-strip/.test(SRC) &&
    /p\.innerHTML = '<div class="ll pl">' \+ head \+ body \+/.test(ren10));
  const draw10 = fn('_cvDraw');
  check('Convert says what it does', /<b>What this does:<\/b> converts the document into a <b>Liturgy App File<\/b> the app can use/.test(draw10) &&
    /The document itself is not changed\./.test(draw10) && /the words are changed in the Liturgy Builder/.test(draw10));
  check('Show me how starts the walk through, which starts by itself once on a device', /onclick="LiturgyModule\.spTour\(\)"><i class="fa-solid fa-person-chalkboard"/.test(fn('_spMakeHtml')) &&
    /if \(tab === 'order' && d && !_spTourDone\(\)\) \{ _spTourMark\(\);/.test(ren10) && /var SP_TOUR_KEY = 'lhc_lit_tour_seen_v1';/.test(SRC) &&
    /localStorage\.setItem\(SP_TOUR_KEY, '1'\)/.test(fn('_spTourMark')));
  const steps10 = fn('_spTourSteps');
  check('five steps on the page itself: the past years, Make ready (or Upload), the ready liturgies, Use, the Liturgy Builder; a missing part is left out',
    /q\('\.sp-res'\)/.test(steps10) && /var mk = q\('\.sp-doc \.sp-btn-maroon'\), use = q\('\.sp-fit \.pl-btn-green'\), rowUse = q\('\.sp-doc \.sp-usebtn'\);/.test(steps10) &&
    /el: rowUse \|\| q\('\.sp-readybox'\), tap: !!rowUse/.test(steps10) &&
    /el: use \|\| q\('\.sp-make'\)/.test(steps10) && /q\('\.sp-make > \.lf-btn\.pl-btn-green'\)/.test(steps10) && /\.filter\(function\(x\) \{ return x\.el; \}\)/.test(steps10));
  check('a spotlight, a pulsing ring, a finger tapping what to press, and a card with Back / Next / Skip that follows the page',
    /ltour__hole/.test(fn('spTour')) && /ltour__ring/.test(fn('spTour')) && /ltour__finger/.test(fn('spTour')) && /LiturgyModule\.spTourGo\(-1\)">Back/.test(fn('spTour')) &&
    /LiturgyModule\.spTourClose\(\)">Skip/.test(fn('spTour')) && /_spTourTimer = setInterval\(function\(\) \{ _spTourPlace\(false\); \}, 250\);/.test(fn('spTour')) &&
    /@keyframes ltourPulse/.test(SRC) && /@keyframes ltourTap/.test(SRC) && /\.ltour\.is-tap \.ltour__finger \{ display: block; \}/.test(SRC) &&
    /prefers-reduced-motion: reduce\) \{\s*\.ltour__ring, \.ltour__finger \{ animation: none; \}/.test(SRC));
  check('Esc and the arrows; the last step closes it; closing stops its timer', /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); _spTourClose\(\); \}/.test(fn('spTour')) &&
    /if \(_spTourAt \+ d >= n\) \{ _spTourClose\(\);/.test(fn('spTourGo')) && /clearInterval\(_spTourTimer\)/.test(fn('_spTourClose')) &&
    /spTour: spTour, spTourGo: spTourGo, spTourClose: _spTourClose/.test(SRC));

  // ------------------------------------------------------------ 11. Convert
  // From the operator (2026-11-15): "say 'Convert to Liturgy App File' and it
  // should sit in the year where it's been assigned and not to any other
  // year. From there, after the conversion, take the user to the set and
  // provide the option to use it for the upcoming year or leave it".
  console.log('\n11. Convert to a Liturgy App File');
  const draw11 = fn('_cvDraw'), res11 = fn('_spResHtml'), conv11 = fn('spConvert'), save11 = fn('cvSave');
  check('it is called what it is: Convert, a Liturgy App File', /Convert to Liturgy App File/.test(draw11) && /<h2 id="cvTtl">Convert to a Liturgy App File<\/h2>/.test(draw11) &&
    /<span>Convert<\/span><\/button>/.test(res11) && /<h2 class="font-cinzel">Liturgy App Files<\/h2>/.test(fn('_spReadyHtml')) && !/Make ready/.test(res11 + draw11 + fn('_spReadyHtml') + fn('_spMakeHtml')) &&
    !/Save as a ready liturgy|Keep as a ready liturgy/.test(SRC));
  check('it sits in its document\'s year: fixed when the document has one; a document with none is given that year with it',
    /var docYear = _spYearOf\(it, occId\), y = docYear \|\| String\(new Date\(\)\.getFullYear\(\)\);/.test(conv11) && /yearFixed: !!docYear,/.test(conv11) &&
    /if \(ty && !cv\.yearFixed\) cv\.year = ty;/.test(fn('_cvRead')) && /cv\.yearFixed\s*\? '<div class="mv-ed__lbl cv-fields__yr cv-fields__yr--fixed">/.test(draw11) &&
    /if \(f && f\.id && !cv\.yearFixed\) \{ _spKeepFolder\(saved\.occasion_id, f\); updateItem\(cv\.itemId, \{ occasionFolderId: f\.id \}\); \}/.test(save11));
  check('...and stays there: its Sundays change, its year follows its document', /fromDoc = \/\^doc:\/\.test\(String\(r\.made_from \|\| ''\)\)/.test(fn('spSundays')) &&
    /It moves when its document does\./.test(fn('spSundays')) && /if \(f\) _spYearConverted\(id, occ, f\.name\);/.test(fn('spMoveYear')) &&
    /\.in\('id', ids\)\.select\('id,year'\)/.test(fn('_spYearConverted')));
  check('after converting: to its set (its year, the file marked), then Use it for the coming Sunday it suits, or Leave it',
    /_sp\.fresh = saved\.id; _sp\.res = 'liturgy'; _sp\.year = String\(saved\.year\);/.test(save11) && /spReady\(\); _spAfterConvert\(saved\.id\);/.test(save11) &&
    /if \(m\) spUseDoc\(m\[1\], \{ fresh: true, fileId: id \}\);/.test(fn('_spAfterConvert')) && /\(u\.fresh \? 'Leave it' : 'Cancel'\)/.test(fn('_spUseDraw')) &&
    /LiturgyModule\.spUseGo\(\)/.test(fn('_spUseDraw')) && /WO\.svlUseFromLibrary\(/.test(fn('spUseGo')));
  if (S) {
    const meta = { '2026-11-29': { day: '1st Sunday of Advent', serviceType: 'Contemporary' }, '2026-12-06': { day: '2nd Sunday of Advent', serviceType: 'Traditional' },
      '2026-12-13': { day: '3rd Sunday of Advent', serviceType: 'Contemporary' }, '2026-12-20': { day: '4th Sunday of Advent', serviceType: 'Traditional' },
      '2026-11-22': { day: 'Christ the King Sunday', serviceType: 'Traditional' }, '2026-11-01': { day: '1st Sunday of Advent' } };
    const occFor = d => /advent/i.test(d) ? 'advent' : 'ordinary-traditional';
    const up = S.upcoming('advent', meta, '2026-11-15', occFor);
    check('the coming services of the kind, in order, each with its kind of service', up.map(u => u.key.slice(5) + u.type[0]).join() === '11-29c,12-06t,12-13c,12-20t', up.map(u => u.key).join());
    const orders = { '2026-12-13': { id: 'o13', type: 'traditional' } };
    const rows11 = S.useRows(up, k => orders[k] || null);
    check('Use lists every coming service, ANY kind (it becomes a Special service), with the Roster\'s kind and its order\'s',
      rows11.map(r => r.key.slice(5) + r.roster[0] + r.kind[0] + (r.order ? 'o' : '')).join() === '11-29cc,12-06tt,12-13cto,12-20tt', JSON.stringify(rows11.map(r => [r.key, r.roster, r.kind])));
    check('the service chosen to begin with: the one asked for, else the first of its Sundays this year, else the first',
      S.usePick(rows11, 'advent', ['advent:4'], '') === '2026-12-20' && S.usePick(rows11, 'advent', [], '') === '2026-11-29' &&
      S.usePick(rows11, 'advent', ['advent:1'], '') === '2026-11-29' && S.usePick(rows11, 'advent', [], '2026-12-13') === '2026-12-13' &&
      S.usePick(rows11, 'advent', ['advent:2'], '') === '2026-12-06' && S.usePick([], 'advent', [], '') === '');
    check('a date the Roster calls Special is one', S.upcoming('advent', { '2026-12-06': { day: '2nd Sunday of Advent', serviceType: 'Special' } }, '2026-11-15', occFor)[0].type === 'special');
    const rows = [{ id: 'trad', year: 2026, order_type: 'traditional', data: {} }, { id: 'cont', year: 2025, order_type: 'contemporary', data: {} }, { id: 'any', year: 2024, order_type: 'special', data: {} }];
    check('This year\'s liturgy offers every Liturgy App File, whatever its kind (any one is used as a Special service)',
      S.forNext(rows, 'advent:2').length === 3 && /_spForNext\(\(d && d\.rows\) \|\| \[\], sun && sun\.occ === occ \? sun\.key : ''\)/.test(fn('_spMakeHtml')));
  }

  // ------------------------------------------------------------ 12. Converted, and Use
  // From the operator (2026-11-15): "I would like to see the converted items
  // where the 'Convert' function is. Then allow the user to 'Use' that
  // converted liturgy to the upcoming service"; and of the first Use window
  // (2026-11-16): "really untidy and unclear. How is the user to choose which
  // service(s) the user wants to use it for? ... Make sure it prompts the
  // user into using it for a particular year's / date's".
  console.log('\n12. Converted, with Use: choose the service');
  const res12 = fn('_spResHtml'), ready12 = fn('_spReadyHtml');
  check('a converted document shows Converted (green, its menu) and Use where Convert was; one not converted keeps Convert',
    /\(conv\.length\s*\? '<button type="button" class="lf-btn sp-btn-sm sp-convd"/.test(res12) && /LiturgyModule\.spConvMenu\(this, this\.dataset\.id\)/.test(res12) &&
    /<span>Converted<\/span>/.test(res12) && /class="lf-btn sp-btn-sm pl-btn-green sp-usebtn"[\s\S]{0,80}onclick="LiturgyModule\.spUseDoc\(this\.dataset\.id\)"/.test(res12) &&
    /: \(canConvert \? '<button type="button" class="lf-btn sp-btn-sm sp-btn-maroon lf-btn--primary"/.test(res12) &&
    /\.lf-btn\.sp-convd \{[^}]*background: #e3f4ea;[^}]*color: #0b5d36;/.test(SRC));
  check('the Liturgy App Files box keeps only what has no document beside it, and is not drawn when that is nothing',
    /return !m \|\| !getItem\(m\[1\]\);/.test(ready12) && /if \(d && !d\.svlGone && !rows\.length\) return '';/.test(ready12));
  check('after converting, its document is marked and scrolled to', /var conv = _spFilesOf\(it\.id\), fresh = _sp\.fresh && conv\.some\(function\(r\) \{ return r\.id === _sp\.fresh; \}\);/.test(res12) && /sp-doc--conv/.test(res12) &&
    /document\.querySelector\('#liturgyServicePanel \.sp-doc\.is-new'\)/.test(fn('spReady')));
  check('a service reached any way reads its year folders (they were read only by the landing page and Services, so a service button left every document at No year)',
    /if \(!_lfFoldersAsked\) \{\s*_lfFoldersAsked = true;\s*var keepOcc = _currentOccasion;\s*_currentOccasion = null;\s*loadOccFolders\(\)\.then\(function\(\) \{ if \(_sp\.occ === occId\) renderService\(\); \}\);/.test(fn('openService')));
  check('Convert again starts on the kind asked for, else the coming service\'s, and on the file\'s Sundays',
    /type: opts\.type \|\| \(\(occ && occ\.id === 'ordinary-contemporary'\) \? 'contemporary'\s*: \(_spData && _spData\.occ === occId && _spData\.next && _spData\.next\.type\) \|\| 'traditional'\)/.test(fn('spConvert')) &&
    /spConvert\(docId, \{ type: type, days: days \}\);/.test(fn('spUseReconvert')));
  check('every Use on the page opens the one window: This year\'s liturgy on its Sunday, the Builder\'s own liturgies, a converted document',
    /if \(m && getItem\(m\[1\]\)\) spUseDoc\(m\[1\], \{ fileId: id, key: key \}\);\s*else _spUseOpen\(\[r\], id, \{ key: key \}\);/.test(fn('spUse')) &&
    /onclick="LiturgyModule\.spUse\(this\.dataset\.id\)"><i class="fa-solid fa-download"/.test(ready12) && !/orderId \? '<button[^']*spUse/.test(fn('_spMakeHtml') + ready12));
  check('WO makes an order for a date as Home\'s + Order does -- its year in its title, never a second for one date -- and lends it, with each date\'s order',
    /var have = _woOrderInfoForIso\(iso\);\s*if \(have\) return Promise\.resolve\(have\.id\);/.test(fn('_woCreateOrderForIso')) &&
    /var title = 'Service - ' \+ d\.getDate\(\) \+ ' ' \+ MO\[d\.getMonth\(\)\] \+ ' ' \+ d\.getFullYear\(\)/.test(fn('_woCreateOrderForIso')) &&
    /addToSavedOrders\(\{ id: r\.id,/.test(fn('_woCreateOrderForIso')) &&
    /orderInfoForIso: _woOrderInfoForIso, createOrderForIso: _woCreateOrderForIso,/.test(SRC));
  check('the window has its own class: .sp-use is an older button\'s nowrap', /class="mv-ed__card sp-usewin"/.test(fn('_spUseDraw')) &&
    /\.pl-ed \.mv-ed__card\.sp-usewin \{[^}]*white-space: normal;/.test(SRC) && /\.sp-usewin__body \{[^}]*overflow-y: auto; overflow-x: hidden;/.test(SRC));
  if (S) {
    try {
      const names = ['_spFilesOf', '_spRow', '_spTypeName', '_spFileTag', '_spUseRows', '_spUsePick', '_spUseExtras', '_spUseDay', '_spUseOpen', '_spAfterConvert', 'spUseDoc', 'spUse',
        '_spUseState', '_spUseReads', '_spUseStep1', '_spUseStep2', '_spSlidesOf', '_spUseLits', '_spUseWordsHtml', '_spUseBrings', '_spUseStep3', '_spUseStep4', '_spUseDraw', 'spUseStep', 'spUseDate', 'spUseFile', 'spUseReadsFrom',
        'spUseExtra', 'spUseSongs', 'spUseComm', 'spUseClose', 'spUseLeave', 'spUseReadings', '_spUseBackBar', 'spUseReturn', '_spPutReadings', 'spUseGo', 'spUseReconvert',
        'spConvMenu', 'spConvAct', '_spFileReadings', '_spRefKey', '_spReadDiff', '_cvBook', '_cvRefOf', '_cvReadingRole', '_cvRoleName'];
      const bodies = names.map(fn);
      if (!bodies.every(Boolean)) throw new Error('missing: ' + names.filter((n, i) => !bodies[i]).join(', '));
      const log = [], els = {}, roster = {}, types = {};
      const mkEl = () => ({ id: '', className: '', innerHTML: '', attrs: {}, addEventListener() {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
        remove() { delete els[this.id]; }, querySelector() { return null; }, contains() { return false; } });
      const orders = { '2026-12-13': { id: 'o13', type: 'contemporary', title: 'Service - 13 Dec 2026' } };
      const tpl = [{ id: 'wo-section-0', title: 'Invocation', serviceSectionId: 'welcome', liturgySectionId: 'invocation', kind: 'single' },
        { id: 'wo-section-1', title: 'Kyrie', serviceSectionId: '', liturgySectionId: 'kyrie', kind: 'single' },
        { id: 'wo-section-2', title: 'Scripture Readings', serviceSectionId: 'scripture', liturgySectionId: 'first-reading', kind: 'group' },
        { id: 'wo-section-3', title: 'Hymn of Response', serviceSectionId: 'response', liturgySectionId: '', kind: 'songs' },
        { id: 'wo-section-4', title: 'Offertory', serviceSectionId: 'offering', liturgySectionId: 'offertory', kind: 'single' },
        { id: 'wo-section-5', title: 'Holy Communion', serviceSectionId: 'communion', liturgySectionId: 'sanctus', kind: 'single' },
        { id: 'wo-section-6', title: 'Post-Communion', serviceSectionId: 'thanksgiving', liturgySectionId: 'post-communion', kind: 'single' }];
      let made = 0, failType = false, failMake = false;
      const env = {
        document: { getElementById: id => els[id] || null, createElement: () => mkEl(), body: { appendChild: el => { els[el.id] = el; } }, activeElement: null },
        window: { WO: {
          orderInfoForIso: k => orders[k] || null, typeSections: () => tpl,
          createOrderForIso: (k, kind, day) => { log.push('make ' + k + ' ' + kind); if (failMake) return Promise.reject(new Error('refused')); made++; orders[k] = { id: 'new-' + k, type: kind }; return Promise.resolve('new-' + k); },
          svlUseFromLibrary: (row, o) => log.push('apply ' + row.id + ' songs=' + o.songs + ' extras=' + o.extras.join('+') +
            (o.use ? ' made=' + o.use.made + ' roster=' + o.use.roster + ' reads=' + o.use.readings.map(r => r.role + ':' + r.was + '>' + r.ref).join(',') : '')) } },
        LiturgyModule: { getAssignedLiturgyForSection: (t, sec) => sec === 'kyrie' ? [{ id: 'k1', title: 'Kyrie (sung)' }] : sec === 'sanctus' ? [{ id: 's1', title: 'Sanctus' }, { id: 's2', title: 'Words of Institution' }] : [] },
        _sp: { occ: 'advent' }, _readingRefsByDate: {},
        getItem: id => ({ d1: { id: 'd1', title: 'Advent liturgy' } })[id] || null,
        showToast: (m) => log.push('toast ' + m), _llOpenInBuilder: (id, then) => { log.push('open ' + id); then && then(); }, llBackToLib: () => log.push('back'),
        openService: occ => log.push('service ' + occ), _spLoad: () => Promise.resolve(), lfOpenDay: k => log.push('readings ' + k),
        spConvert: (id, o) => log.push('convert ' + id + ' ' + JSON.stringify(o)), spPreviewReady: id => log.push('preview ' + id),
        spSundays: id => log.push('sundays ' + id), spDeleteReady: id => log.push('delete ' + id),
        _spFloat: (btn, id, html, forId) => { const m = mkEl(); m.id = id; m.innerHTML = html; m.attrs['data-for'] = forId; els[id] = m; }, _spFloatClose: id => { delete els[id]; },
        _lfShortDate: k => k.slice(5, 10), _lfLongDate: k => 'long ' + k, _lfWhen: v => 'on ' + String(v).slice(0, 10),
        SBQ_READINGS: { SLOTS: [{ role: 'reading1' }, { role: 'psalm' }, { role: 'reading2' }, { role: 'gospel' }],
          getRange: (a, b) => { log.push('reads ' + a + '..' + b); return Promise.resolve(JSON.parse(JSON.stringify(roster))); },
          setReference: (iso, idx, ref) => { const role = ['reading1', 'psalm', 'reading2', 'gospel'][idx]; log.push('roster ' + iso + ' ' + role + ' ' + ref);
            roster[iso] = Object.assign({}, roster[iso] || {}, { [role]: ref }); return Promise.resolve(ref); },
          serviceTypeAt: iso => Promise.resolve(types[iso] != null ? types[iso] : ({ '2026-11-29': 'Contemporary', '2026-12-06': 'Traditional', '2026-12-13': 'Contemporary' })[iso] || ''),
          setServiceType: (iso, v) => { log.push('kind ' + iso + ' ' + v); if (failType) return Promise.reject(new Error('the Roster did not keep it')); types[iso] = v; return Promise.resolve(v); } }
      };
      env.WO = env.window.WO;
      const up = [{ key: '2026-11-29', day: '1st Sunday of Advent', type: 'contemporary' }, { key: '2026-12-06', day: '2nd Sunday of Advent', type: 'traditional' },
        { key: '2026-12-13', day: '3rd Sunday of Advent', type: 'contemporary' }, { key: '2027-11-28', day: '1st Sunday of Advent', type: 'special' }];
      const rows = [{ id: 'trad', occasion_id: 'advent', year: 2025, order_type: 'traditional', made_from: 'doc:d1', updated_at: '2026-11-15T14:00:00Z',
        data: { forDays: ['advent:1'], readings: [{ role: 'reading1', ref: 'Isaiah 40:1-11' }, { role: 'gospel', ref: 'Mark 1:1-8' }],
          sectionLayout: [{ id: 'wo-section-0', title: 'Invocation', serviceSectionId: 'welcome' }, { id: 'wo-section-2', title: 'Scripture Readings', serviceSectionId: 'scripture' }],
          songs: [{ songId: 'g1', title: 'O Come, O Come' }] } },
        { id: 'svl', occasion_id: 'advent', year: 2024, order_type: 'traditional', made_from: 'order:x', data: {} }];
      roster['2026-12-06'] = { reading1: 'Isaiah 40:1-11', psalm: 'Psalm 85', gospel: 'Mark 13:24-37' };
      env._spData = { occ: 'advent', rows, upcoming: up };
      const keys = Object.keys(env);
      const consts = SRC.match(/  var CV_BOOKS = [^\n]*;/)[0] + '\n' + SRC.match(/  var CV_ROLES = [^\n]*;/)[0] + '\n' + SRC.match(/  var SP_USE_STEPS = [^\n]*;/)[0] + '\n' + SRC.match(/  var SP_COMMUNION = [^\n]*;/)[0];
      const U = new Function('OCCASIONS', 'LL_SUNDAYS', '_llSundayOf', '_llForSunday', '_llDaysToggle', '_llDaysHtml', '_llCycle', '_llYearText', 'getOccasionById', '_lfE', ...keys,
        'var _spUse = null, _spUseBack = null;\n' + consts + '\n' + bodies.join('\n') +
        '\nreturn { doc: spUseDoc, use: spUse, step: spUseStep, date: spUseDate, extra: spUseExtra, songs: spUseSongs, comm: spUseComm, from: spUseReadsFrom, leave: spUseLeave, go: spUseGo,' +
        ' readings: spUseReadings, ret: spUseReturn, after: _spAfterConvert, file: spUseFile, menu: spConvMenu, act: spConvAct, state: function() { return _spUse; }, back: function() { return _spUseBack; } };')(
        S.OCCASIONS, S.SUNDAYS, S.sundayOf, S.forSunday, S.toggle, S.html, S.cycle, S.yearText, id => S.OCCASIONS.find(o => o.id === id) || null,
        s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), ...keys.map(k => env[k]));
      const tick = () => new Promise(r => setTimeout(r, 0));
      const html = () => (els.spUse || {}).innerHTML || '';
      U.doc('d1'); await tick();
      check('Use is four steps, one to a page: Service, Readings, Add to it, Confirm -- on Service first, the others not yet open',
        /<span>Service<\/span>/.test(html()) && /<span>Readings<\/span>/.test(html()) && /<span>Add to it<\/span>/.test(html()) && /<span>Confirm<\/span>/.test(html()) &&
        /spu-step is-on" aria-current="step"><span class="spu-step__in"><b>1<\/b>/.test(html()) && !/spUseStep\(3\)">/.test(html().split('spu-acts')[0]) && /<span>Next<\/span>/.test(html()));
      check('...every coming service can be chosen, whatever its kind, saying the Roster\'s kind and that it becomes Special',
        (html().match(/name="spUseDate"/g) || []).length === 4 && !/disabled/.test(html().split('spu-acts')[0]) && /Contemporary on the Roster · no order yet/.test(html()) &&
        /Whichever you choose becomes a <b>Special<\/b> service/.test(html()) && /<p class="spu-yr">2027<\/p>/.test(html()) && U.state().key === '2026-11-29', html().slice(0, 300));
      U.date('2026-12-06'); U.step(2); await tick();
      check('Readings: the liturgy\'s beside the Roster\'s, each slot, the differing one marked; this liturgy\'s chosen; the Readings page there and back',
        /<th scope="row">Gospel<\/th><td>Mark 1:1-8<\/td><td>Mark 13:24-37<\/td>/.test(html()) && /<tr class="is-diff">/.test(html()) && /Isaiah 40:1-11 <i class="fa-solid fa-check"/.test(html()) &&
        /value="liturgy" checked/.test(html()) && /spUseReadings\(this\.dataset\.key\)/.test(html()) && /A button there brings you back here/.test(html()), html().slice(html().indexOf('Readings for'), html().indexOf('Readings for') + 500));
      U.readings('2026-12-06');
      check('...Change goes to the Readings page at that date, and a bar there comes back', log[log.length - 1] === 'readings 2026-12-06' && !els.spUse && !!els.spUseBack &&
        /Back to <b>Use this liturgy<\/b> for 12-06/.test(els.spUseBack.innerHTML));
      U.ret(); await tick(); await tick();
      check('...back at the readings, the same date', !!els.spUse && U.state().step === 2 && U.state().key === '2026-12-06' && !els.spUseBack);
      U.step(3);
      check('Add to it: the Traditional parts it lacks, each with its usual liturgy -- not the readings, not what it has; and its songs',
        /<b>Kyrie<\/b><small>Kyrie \(sung\)<\/small>/.test(html()) && /<b>Holy Communion<\/b><small>Sanctus, Words of Institution<\/small>/.test(html()) &&
        /<b>Hymn of Response<\/b><small>A place for its songs<\/small>/.test(html()) && !/<b>Invocation<\/b>/.test(html()) && !/<b>Scripture Readings<\/b>/.test(html()) &&
        /Its songs \(1\)/.test(html()), html().slice(0, 200));
      U.comm();
      check('...Holy Communion before, during and after in one press', U.state().extras[4] && U.state().extras[5] && U.state().extras[6] && /spu-comm is-on/.test(html()));
      U.extra(1, true); U.step(4);
      check('Confirm says what happens: the date, becoming Special on the Roster, its order made, the liturgy\'s readings put on the Roster, what is added, its songs',
        /<b>long 2026-12-06<\/b> · 2nd Sunday of Advent/.test(html()) && /Becomes a <b>Special<\/b> service on the Roster \(it is Traditional now\)/.test(html()) &&
        /Its order is made, with this liturgy\./.test(html()) && /This liturgy’s readings, <b>put on the Roster<\/b> for 12-06/.test(html()) &&
        /With Kyrie, Offertory, Holy Communion, Post-Communion/.test(html()) && /Its 1 song/.test(html()) && /Use it for 12-06/.test(html()));
      const n0 = log.length; U.go(); for (let i = 0; i < 8; i++) await tick();
      const ran = log.slice(n0).filter(l => !/^reads /.test(l));
      check('Use: the readings on the Roster, the date made Special there, a Special order made, then the Builder with the liturgy in -- in that order',
        ran.join(' | ') === 'roster 2026-12-06 gospel Mark 1:1-8 | kind 2026-12-06 Special | make 2026-12-06 special | toast long 2026-12-06 is a Special service now. Putting the liturgy in… | open new-2026-12-06 | apply trad songs=true extras=1+4+5+6 made=true roster=Traditional reads=gospel:Mark 13:24-37>Mark 1:1-8 | back',
        ran.join(' | '));
      U.use('trad', '2026-12-13'); await tick(); U.step(4);
      check('...a Contemporary date with its order made: Special now, its order takes the liturgy (Undo)', /it is Contemporary now/.test(html()) && /Its order takes this liturgy in place of what it has/.test(html()));
      U.from('roster'); U.songs(false);
      const n1 = log.length; U.go(); for (let i = 0; i < 8; i++) await tick();
      const ran1 = log.slice(n1).filter(l => !/^reads /.test(l) && !/^toast /.test(l));
      check('...its own order kept, nothing made; the Roster\'s readings kept; without its songs -- and noted so, for Remove', ran1.join(' | ') === 'kind 2026-12-13 Special | open o13 | apply trad songs=false extras= made=false roster=Contemporary reads= | back', ran1.join(' | '));
      U.use('trad', '2027-11-28'); await tick(); U.step(4);
      const n2 = log.length; U.go(); for (let i = 0; i < 8; i++) await tick();
      check('a date the Roster already calls Special is not written again', /A <b>Special<\/b> service already/.test(html() || '') || !log.slice(n2).some(l => /^kind /.test(l)), log.slice(n2).join(' | '));
      failType = true;
      U.use('trad', '2026-11-29'); await tick(); U.step(4);
      const n3 = log.length; U.go(); for (let i = 0; i < 8; i++) await tick();
      check('a step that fails leaves the window up, saying which, and opens nothing', !!els.spUse && U.state().busy === false &&
        /Could not make it a Special service on the Roster: the Roster did not keep it/.test(log[log.length - 1]) && !log.slice(n3).some(l => /^open /.test(l)), log.slice(n3).join(' | '));
      failType = false; U.leave();
      U.after('trad'); await tick();
      check('after converting it opens fresh, with Leave it', /Converted\. Use it now\?/.test(html()) && /Leave it<\/button>/.test(html()));
      U.leave();
      U.menu({}, 'd1');
      check('the Converted menu still has its file\'s preview, Sundays and delete, and Convert again', /Preview the app file/.test((els.spConvMenu || {}).innerHTML || '') && /data-act="again"/.test((els.spConvMenu || {}).innerHTML || ''));
      U.act({ getAttribute: k => ({ 'data-act': 'days', 'data-fid': 'trad' })[k] });
      check('...whose items do what they say', log[log.length - 1] === 'sundays trad' && !els.spConvMenu, log[log.length - 1]);
    } catch (e) { check('the Use window runs', false, e.stack); }
  }

  // ------------------------------------------------------------ 13. the pages, as marked up
  // From the operator (2026-11-16), on four marked-up screenshots.
  console.log('\n13. The landing cards, Services, a service\'s banner');
  const hub13 = fn('renderHub');
  check('the landing cards: Readings & Prayers and Liturgy of Services with no line under them; Memories with the operator\'s own',
    /title: 'Readings &amp; Prayers', tag: ''/.test(hub13) && /title: 'Liturgy of Services', tag: ''/.test(hub13) &&
    /title: 'Memories', tag: 'Blast from the past: services for future reference'/.test(hub13) && /\(c\.tag \? '<p>' \+ _lfE\(c\.tag\) \+ '<\/p>' : ''\)/.test(hub13) &&
    !/What the church is hearing'|How we worship'|What we have done together'/.test(hub13));
  // 20px shorter on 2026-11-16, then 30px more the same day (the operator,
  // circling the three: "Make 30px smaller"; asked, each card).
  check('...each 20px shorter, then 30px more (measured: 147 to 117px at 480px wide, 318 to 288px at 1400px), the titles on one line, the bands level',
    /\.ll-card__top \{ display: flex; align-items: center; gap: 12px; padding: 12px 22px 16px; min-height: 92px;/.test(SRC) && /\.ll-card__go \{ align-self: center; margin: 6px 0 8px; display: inline-flex; align-items: center; gap: 10px; min-height: 44px;/.test(SRC) &&
    /\.ll-card__body \{ display: flex; gap: 14px; padding: 6px 22px 4px;/.test(SRC) &&
    /\.ll-card__icon \{ font-size: 2rem; opacity: 0\.95; width: 40px; flex-shrink: 0;/.test(SRC) && /\.ll-card__top h2 \{ margin: 0; font-size: 1\.2rem; font-weight: 700; letter-spacing: 0\.04em; line-height: 1\.25;/.test(SRC) &&
    /\.ll-card__top p \{ margin: 2px 0 0;[^}]*line-height: 1\.35;/.test(SRC) &&
    /\.ll-card__top \{ padding: 10px 16px 16px; min-height: 0; \}/.test(SRC) && /\.ll-card__top \{ padding-top: 8px; padding-bottom: 8px; min-height: 62px; \}/.test(SRC) &&
    /\.ll-card__top h2 \{ font-size: 1\.2rem; \}\s*\.ll-card__top p \{ font-size: 0\.86rem; \}/.test(SRC) && /\.ll-card__go \{ margin: 6px 16px 7px; min-height: 40px;/.test(SRC));
  const svc13 = fn('renderServices'), grid13 = fn('_lsGridHtml');
  check('Services: the cards first, the counts and the library\'s buttons at the foot in one line; no All Services / Favourites chips',
    /_lsGridHtml\(\) \+[\s\S]*foot \+\s*'<\/div>';/.test(svc13) && svc13.indexOf("'<div class=\"ls-bar ls-bar--foot\">'") !== -1 &&
    !/LiturgyModule\.lsSet\(\\'fav\\'/.test(svc13) && !/ls-chips/.test(svc13) && /service collections<\/b>/.test(svc13));
  check('...a starred service is listed first instead', /var shown = _lsFavFirst\(_lsFilter\(/.test(grid13) && (() => {
    try { const f = new Function(fn('_lsFavFirst') + '\nreturn _lsFavFirst;')(); return f([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c']).map(o => o.id).join() === 'c,a,b' && f([{ id: 'a' }], null).length === 1; } catch (e) { return false; }
  })());
  check('a service\'s banner 10px shorter: 2 + 2 off its padding, 6 off its tabs; the documents come before the tip',
    /margin: -6px -6px 0; padding: 16px 22px 18px;/.test(SRC) && /\.pl-tab \{[^}]*min-height: 48px;/.test(SRC) && /\.pl-hero \{ margin: 0 -16px; padding: 12px 16px 14px;/.test(SRC) &&
    /'<\/ul>' \+ tip : '<p class="lf-muted sp-none">'/.test(res12) && /\.sp-docs \+ \.sp-tip \{ margin: 10px 0 0; \}/.test(SRC));

  // ------------------------------------------------------------ 14. the liturgy's readings
  // From the operator (2026-11-16): "what if the readings differ from the
  // lectionary readings that are already mentioned in the Readings page and
  // Roster? The liturgy set should be the one dictating the readings."
  console.log('\n14. The liturgy dictates the readings');
  let R = null;
  try {
    const consts = SRC.match(/  var CV_BOOKS = [^\n]*;/)[0] + '\n' + SRC.match(/  var CV_ROLES = [^\n]*;/)[0];
    R = new Function(consts + '\n' + ['_cvBook', '_cvRefOf', '_cvReadingRole', '_cvReadings', '_cvRoleName', '_spFileReadings', '_spRefKey', '_spReadDiff'].map(fn).join('\n') +
      '\nreturn { ref: _cvRefOf, role: _cvReadingRole, reads: _cvReadings, file: _spFileReadings, key: _spRefKey, diff: _spReadDiff };')();
  } catch (e) { console.log('  (could not build: ' + e.message + ')'); }
  if (R) {
    const refs = [['Isaiah 64:1-9', 'Isaiah 64:1-9'], ['First Reading: Isaiah 61:1-4, 8-11', 'Isaiah 61:1-4, 8-11'], ['Ps 85', 'Psalm 85'], ['1 Cor 1:3\u20139', '1 Corinthians 1:3-9'],
      ['II Peter 3:8-15a', '2 Peter 3:8-15a'], ['Mark 13:24-37.', 'Mark 13:24-37'], ['The Holy Gospel according to St. John 1:6-8, 19-28', 'John 1:6-8, 19-28'], ['Isaiah 64.1-9', 'Isaiah 64:1-9'],
      ['Matt 3:1-12', 'Matthew 3:1-12'], ['John 18:1-19:42', 'John 18:1-19:42'], ['Hymn 217', ''], ['Advent 1', ''], ['Service 2026', ''], ['Phil 4:4-7', 'Philippians 4:4-7']];
    const bad = refs.filter(([t, want]) => R.ref(t) !== want);
    check('a Bible reference is found in a document\'s line and written as the Roster writes one; a hymn number, "Advent 1" or a year is not one',
      !bad.length, bad.map(([t, w]) => t + ' -> ' + R.ref(t) + ' (want ' + w + ')').join('; '));
    check('its slot: what the document calls it when that names one slot, else its book',
      R.role('First Reading', 'Isaiah 64:1-9') === 'reading1' && R.role('The Epistle', 'Romans 13:11-14') === 'reading2' && R.role('Holy Gospel', 'Mark 13:24-37') === 'gospel' &&
      R.role('Psalm of the Day', 'Psalm 80:1-7') === 'psalm' && R.role('', 'Isaiah 2:1-5') === 'reading1' && R.role('', 'Psalm 122') === 'psalm' && R.role('', 'Romans 13:11-14') === 'reading2' &&
      R.role('', 'Matthew 24:36-44') === 'gospel' && R.role('The Readings and Psalm', 'Isaiah 2:1-5') === 'reading1' && R.role('The Readings and Psalm', 'Matthew 24:36-44') === 'gospel' &&
      R.role('Second Reading', 'Isaiah 2:1-5') === 'reading2' && R.role('First Word', 'Luke 23:34') === 'gospel' && R.role('The Second Word', 'Luke 23:43') === 'gospel' &&
      R.role('First Lesson', 'Isaiah 52:13-53:12') === 'reading1');
    const secs = [{ include: true, parts: [{ kind: 'reading', use: true, ref: 'Isaiah 64:1-9', role: 'reading1' }, { kind: 'liturgy', use: true }] },
      { include: false, parts: [{ kind: 'reading', use: true, ref: 'Psalm 1', role: 'psalm' }] },
      { include: true, parts: [{ kind: 'reading', use: true, ref: 'Mark 13:24-37', role: 'gospel' }, { kind: 'reading', use: true, ref: 'Isaiah 9:2', role: 'reading1' },
        { kind: 'reading', use: false, ref: 'Psalm 80', role: 'psalm' }, { kind: 'reading', use: true, ref: '1 Corinthians 1:3-9', role: 'reading2' }] }];
    check('a conversion keeps the first of each slot, from the sections and readings left ticked, in the Roster\'s order',
      JSON.stringify(R.reads(secs)) === JSON.stringify([{ role: 'reading1', ref: 'Isaiah 64:1-9' }, { role: 'reading2', ref: '1 Corinthians 1:3-9' }, { role: 'gospel', ref: 'Mark 13:24-37' }]));
    check('a file\'s readings: a converted one\'s kept list; one saved from the Builder, its scripture parts by their labels',
      R.file({ data: { readings: [{ role: 'gospel', ref: 'Mark 1:1-8' }] } }).length === 1 &&
      JSON.stringify(R.file({ data: { items: [{ itemType: 'liturgy', title: 'Kyrie' }, { itemType: 'scripture', title: 'Isaiah 40:1-11', content: { subLabel: '1st Reading' } },
        { itemType: 'scripture', title: 'Mark 1:1-8', content: { subLabel: 'Gospel' } }] } })) === JSON.stringify([{ role: 'reading1', ref: 'Isaiah 40:1-11' }, { role: 'gospel', ref: 'Mark 1:1-8' }]) &&
      R.file({ data: {} }).length === 0);
    check('the same passage is the same however it is written; only the liturgy\'s that the Roster lacks differ',
      R.key('Psalms 85') === R.key('psalm 85') && R.key('Isaiah 61:1\u20134') === R.key('Isaiah 61:1-4') &&
      JSON.stringify(R.diff([{ role: 'reading1', ref: 'Isaiah 64:1-9' }, { role: 'gospel', ref: 'Mark 13:24-37' }], { reading1: 'Isaiah 64:1-9', gospel: 'Mark 1:1-8', psalm: 'Psalm 80' })) ===
        JSON.stringify([{ role: 'gospel', ref: 'Mark 13:24-37', was: 'Mark 1:1-8' }]));
  }
  const rd14 = fn('_cvRead'), sec14 = fn('_cvSectionOf'), save14 = fn('cvSave');
  check('Convert reads each reading\'s reference -- in its title, or on the line under its heading -- and its slot, and ticks it when found',
    /var ref = p\.kind === 'reading' \? \(_cvRefOf\(p\.title\) \|\| _cvRefOf\(\(p\.slides \|\| \[\]\)\.slice\(0, 2\)\.join\(' '\)\)\) : '';/.test(rd14) &&
    /\(p\.kind === 'reading' && !!role\)/.test(rd14) && /title: after \|\| _cvRefOf\(words\.slice\(0, 2\)\.join\(' '\)\) \|\| before\.trim\(\)/.test(sec14));
  check('...keeps them with the liturgy, READ BACK; and a document\'s second conversion of a kind writes over its first',
    /var reads = _cvReadings\(cv\.secs\);\s*if \(reads\.length\) data\.readings = reads;/.test(save14) &&
    /throw new Error\('the database did not keep its readings'\)/.test(save14) &&
    /\(same \? sb\.from\('service_liturgies'\)\.update\(row\)\.eq\('id', same\.id\)\.select\(\) : sb\.from\('service_liturgies'\)\.insert\(row\)\.select\(\)\)/.test(save14) &&
    /This replaces its ' \+ _lfE\(_spTypeName\(cv\.type\)\)/.test(fn('_cvDraw')));
  check('the review says what each reading is kept as', /'Kept as the ' \+ _cvRoleName\(p\.role\)/.test(fn('_cvDraw')) && /'No Bible reference found: left out'/.test(fn('_cvDraw')) &&
    !/The roster’s reading goes in instead/.test(fn('_cvDraw')));
  check('Use puts them on the Roster one slot at a time and reads them back before going on', /SBQ_READINGS\.setReference\(key, idx, diff\[i\]\.ref\)/.test(fn('_spPutReadings')) &&
    /return SBQ_READINGS\.getRange\(day, day\)/.test(fn('_spPutReadings')) && /throw new Error\('the Roster did not keep '/.test(fn('_spPutReadings')));

  // ------------------------------------------------------------ 15. a Special service
  // From the operator (2026-11-16): "Instead of limiting the liturgy to apply
  // for a certain service just because the roster assigns that date's service
  // as either traditional or contemporary ... If the liturgy is set through
  // here, then the roster will declare this as a 'Special' service".
  console.log('\n15. A liturgy used as a Special service');
  let W = null;
  try {
    W = new Function(['_svlSpecialize', '_svlSongSec', '_svlTradPlace', '_spUseExtras'].map(fn).join('\n') +
      '\nreturn { spec: _svlSpecialize, song: _svlSongSec, place: _svlTradPlace, extras: _spUseExtras };')();
  } catch (e) { console.log('  (could not build: ' + e.message + ')'); }
  if (W) {
    const d = { sectionLayout: [{ id: 'wo-section-0', title: 'Invocation', serviceSectionId: 'welcome' }, { id: 'wo-section-6', title: 'Scripture Readings', serviceSectionId: 'scripture' },
      { id: 'wo-section-doc3', title: 'Lighting the Advent Wreath', serviceSectionId: '' }],
      items: [{ id: 'a', sectionId: 'wo-section-0' }, { id: 'b', sectionId: 'wo-section-6' }, { id: 'c', sectionId: 'wo-section-doc3' }],
      songs: [{ songId: 'g', sections: ['wo-section-0'] }], clearedSections: [{ sectionId: 'wo-section-6' }] };
    const sp = W.spec(d);
    check('its readings section becomes the Special template\'s (wo-section-0); every other numbered section an id of its own, its items, songs and notes with it',
      sp.data.sectionLayout.map(x => x.id).join() === 'wo-section-sp0,wo-section-0,wo-section-doc3' && sp.data.items.map(x => x.sectionId).join() === 'wo-section-sp0,wo-section-0,wo-section-doc3' &&
      sp.data.songs[0].sections[0] === 'wo-section-sp0' && sp.data.clearedSections[0].sectionId === 'wo-section-0' && sp.map['wo-section-6'] === 'wo-section-0' &&
      d.sectionLayout[0].id === 'wo-section-0', JSON.stringify(sp.data.sectionLayout.map(x => x.id)));
    const lay = sp.data.sectionLayout;
    check('a song already in the order follows its section: by id on the same template, else by name, else by kind; nowhere when none',
      W.song('wo-section-0', { title: 'Invocation' }, true, sp.map, lay) === 'wo-section-sp0' &&
      W.song('wo-section-3', { title: 'Lighting the Advent wreath' }, false, sp.map, lay) === 'wo-section-doc3' &&
      W.song('wo-section-5', { title: 'Readings', serviceSectionId: 'scripture' }, false, sp.map, lay) === 'wo-section-0' &&
      W.song('wo-section-9', { title: 'Sermon', serviceSectionId: 'message' }, false, sp.map, lay) === '');
    const trad = [{ title: '1. Invocation', serviceSectionId: 'welcome' }, { title: '5. Kyrie' }, { title: '7. Scripture Readings', serviceSectionId: 'scripture' }, { title: '15. Holy Communion', serviceSectionId: 'communion' }];
    const back = {}; Object.keys(sp.map).forEach(k => { back[sp.map[k]] = k; });
    check('a Traditional part goes after the last of the liturgy\'s sections that comes before it in a Traditional service',
      W.place(lay[0], trad, back, 'traditional') === 0 && W.place(lay[1], trad, back, 'traditional') === 6 && W.place(lay[2], trad, back, 'traditional') === -1 &&
      W.place({ id: 'wo-section-tr3', title: 'Holy Communion' }, trad, {}, 'special') === 3 && W.place({ id: 'x', title: 'Kyrie' }, trad, {}, 'contemporary') === 1);
    const tplX = [{ title: 'Invocation', serviceSectionId: 'welcome' }, { title: 'Confession', serviceSectionId: 'opening-prayer' }, { title: 'Prayer of the Day', serviceSectionId: 'opening-prayer' },
      { title: 'Scripture Readings', serviceSectionId: 'scripture' }, { title: 'Holy Communion', serviceSectionId: 'communion', liturgySectionId: 'sanctus' }];
    const ex = W.extras(tplX, [{ id: 'wo-section-0', title: 'Invocation', serviceSectionId: 'welcome' }, { id: 'wo-section-doc1', title: 'Prayer of the Day', serviceSectionId: 'opening-prayer' }], 'traditional');
    check('the parts it lacks: not one it has by its id, its name or the one kind only it has; never the readings; a kind two share is asked by name',
      ex.map(x => x.title).join() === 'Confession,Holy Communion' && ex[1].lit === 'sanctus' && ex[1].i === 4, JSON.stringify(ex));
  }
  const ap = fn('_svlApply');
  check('the Builder: the order made Special inside the one Undo, its kind in the Undo\'s snapshot',
    /if \(more\.special && currentOrderData\.type !== 'special'\) \{\s*currentOrderData\.type = 'special'; currentOrderType = 'special'; madeSpecial = true;/.test(ap) &&
    /type: o\.type \|\| '',/.test(fn('_lbdSnapshot')) && /if \(snap\.type\) \{ currentOrderData\.type = snap\.type; currentOrderType = snap\.type; \}/.test(fn('_lbdRestore')));
  check('...each Traditional part added with its usual library liturgy, once in the order', /LiturgyModule\.getAssignedLiturgyForSection\('traditional', tpl\.liturgySectionId\)/.test(ap) &&
    /it\.itemType === 'liturgy' && it\.sourceId === lit\.id/.test(ap) && /currentOrderData\.allItems\.push\(_lbdLiturgyItem\(nid, lit\.id, lit\)\)/.test(ap));
  check('...and Use from the Library goes in through it, whatever kind the liturgy was made for', /var sp = _svlSpecialize\(row\.data\);/.test(fn('svlUseFromLibrary')) &&
    /return _svlApply\(sp\.data, x, !!opts\.songs, false, \{ special: true, map: sp\.map, fromType: row\.order_type \|\| 'traditional', extras: opts\.extras \|\| \[\], use: opts\.use \|\| null \}\) \|\| true;/.test(fn('svlUseFromLibrary')) &&
    /svlUseFromLibrary: svlUseFromLibrary,/.test(SRC));
  check('the Roster: a date marked Special, logged and read back, and shown as Special in its row', /setServiceType: function\(iso, value\) \{/.test(SRC) &&
    /role_id: 'service_type', service_date: k\.serviceDate, old_value: oldVal, new_value: v,/.test(SRC) && /throw new Error\('the Roster did not keep it'\)/.test(SRC) &&
    /\(svcValue === 'Special' \? '<button type="button" class="roster-servicetype-btn spec active" data-value="Special">Special<\/button>' : ''\)/.test(SRC));
  check('the service page is slim: All Services a badge, the name, no Sync / Share / Add Item; the files\' tabs small; the add buttons beside the heading',
    /class="pl-hero pl-hero--slim"/.test(fn('renderService')) && !/spSync\(\)|spShare\(\)|spAddMenu\(this\)/.test(fn('renderService')) &&
    /<div class="sp-res__top"><h2 class="font-cinzel">/.test(fn('_spResHtml')) && !/sp-res__bar/.test(fn('_spResHtml')) && /\.pl \.sp-rtab \{ min-height: 30px;/.test(SRC));

  // ------------------------------------------------------------ 16. the coming service's liturgy, here
  // From the operator (2026-11-17): "Shouldn't this place show the preview
  // of the liturgy? And I should be able to make some edits here as well.
  // The changes will be reflected in the Liturgy builder and vice versa",
  // and "When hitting the liturgy builder, help to direct the user back to
  // this page".
  console.log('\n16. This year\'s liturgy shows the service\'s own, and changes it');
  let P = null;
  try {
    P = new Function(['_spOutline', '_spoSlidesOf', '_woLibSlides'].map(fn).join('\n') + '\nreturn { outline: _spOutline, slides: _spoSlidesOf, lib: _woLibSlides };')();
  } catch (e) { console.log('  (could not build: ' + e.message + ')'); }
  if (P) {
    const ol = P.outline([{ id: 's1', title: 'Invocation' }, { id: 's2', title: 'Readings' }, { id: 's3', title: 'Hymn' }], [
      { id: 'a', itemType: 'liturgy', sectionId: 's1', title: 'Invocation', slides: [{ content: 'P: In the name...' }, { content: '  ' }, { content: 'C: Amen.\n' }] },
      { id: 'b', itemType: 'scripture', sectionId: 's2', title: 'Isaiah 64:1-9', slides: [{ content: 'Oh that you would...' }] },
      { id: 'c', itemType: 'song', sectionId: '', title: 'O Come', customizations: { serviceSections: ['s3'] } },
      { id: 'd', itemType: 'content', sectionId: 's1', title: 'Welcome', content: { text: 'Welcome all' }, slides: [] },
      { id: 'e', itemType: 'liturgy', sectionId: 'gone', title: 'Stray', slides: [{ content: 'x' }] }]);
    check('the outline: the sections in order, each part where it is -- a song by its sections -- its words without blank slides, and a part in no section at the end',
      ol.map(x => x.title + ':' + x.parts.map(q => q.kind + '/' + q.id).join('+')).join(' | ') === 'Invocation:liturgy/a+text/d | Readings:reading/b | Hymn:song/c | Not in a section:liturgy/e' &&
      ol[0].parts[0].slides.join('|') === 'P: In the name...|C: Amen.' && ol[0].parts[1].slides[0] === 'Welcome all' && ol[0].parts[0].edit === true && ol[1].parts[0].edit === false,
      JSON.stringify(ol.map(x => [x.title, x.parts.map(q => q.id)])));
    check('words to slides: a line of three dashes or more starts the next; blank lines at a slide\'s ends go; at least one',
      JSON.stringify(P.slides('P: Peace\n---\nC: And also with you\n\n-----\n\n')) === JSON.stringify(['P: Peace', 'C: And also with you']) &&
      JSON.stringify(P.slides('')) === JSON.stringify(['']) && JSON.stringify(P.slides('one\r\n---\r\ntwo')) === JSON.stringify(['one', 'two']));
    const old = [{ index: 0, content: 'A', background: 'bg1', richHtml: '<b>A</b>' }, { index: 1, content: 'B', background: 'bg2', header: 'Verse' }];
    const nx = P.lib(old, ['A', 'B changed', 'C new']);
    check('a slide left as it was keeps its formatting and background; a changed one is plain words with the background of its place; a new one plain',
      nx[0].richHtml === '<b>A</b>' && nx[0].background === 'bg1' && nx[1].content === 'B changed' && !nx[1].richHtml && nx[1].background === 'bg2' && nx[1].header === 'Verse' &&
      nx[2].content === 'C new' && nx[2].background === '' && nx.map(x => x.index).join() === '0,1,2' && old[0].index === 0);
  }
  try {
    const log = [];
    const rows = { it1: { id: 'it1', slides: [{ index: 0, content: 'Old words', background: 'b' }] } };
    let readBack = null;
    const sbFake = { from: t => {
      const q = { _t: t, _upd: null, _id: null,
        select() { return q; }, eq(k, v) { if (k === 'id') q._id = v; return q; }, maybeSingle() { return q; },
        update(v) { q._upd = v; return q; },
        then(ok, bad) {
          let r;
          if (q._t === 'order_items' && q._upd) { rows[q._id].slides = readBack || q._upd.slides; log.push('write item ' + q._id); r = { data: [{ slides: rows[q._id].slides }] }; }
          else if (q._t === 'order_items') r = { data: rows[q._id] || null };
          else { log.push('touch order ' + q._id); r = { data: [] }; }
          return Promise.resolve(r).then(ok, bad);
        } };
      return q;
    } };
    let held = null, active = false, lcd = false, changed = 0;
    let saveSays = true;
    const env = { SBQ: { _sb: () => sbFake, _noteOwnEdit: (id) => log.push('own ' + id) },
      _lbdIsActive: () => active, _woLcdInPage: () => lcd, _soSaveSettled: () => { log.push('save now'); return Promise.resolve(saveSays); },
      _lbdChange: f => { changed++; return f() !== false; } };
    const keys = Object.keys(env);
    const L = new Function(...keys, 'var currentOrderData = null;' + ['_woLibHeld', '_woLibSlides', '_woLibSetSlides'].map(fn).join('\n') +
      '\nreturn { set: _woLibSetSlides, hold: function(o) { currentOrderData = o; } };')(...keys.map(k => env[k]));
    const tick = () => new Promise(r => setTimeout(r, 0));
    let res = null;
    await L.set('o1', 'it1', ['New words', 'Second']).then(r => { res = r; });
    check('not open here: the one row written, read back, the order\'s last_edited moved and noted as this device\'s own',
      res && res.via === 'stored' && rows.it1.slides.length === 2 && rows.it1.slides[0].background === 'b' && log.join() === 'write item it1,own o1,touch order o1' &&
      res.before[0].content === 'Old words', log.join());
    readBack = [{ content: 'something else' }];
    let err = null;
    await L.set('o1', 'it1', ['Again']).catch(e => { err = e; });
    check('...a write the database did not keep is not reported as kept', !!err && /kept something else/.test(err.message), err && err.message);
    readBack = null;
    const order = { id: 'o1', allItems: [{ id: 'it1', slides: [{ index: 0, content: 'Mem', background: '' }] }] };
    L.hold(order); active = true; log.length = 0;
    await L.set('o1', 'it1', ['Mem changed']).then(r => { res = r; });
    check('open in the Builder here: its own copy changed in one Undo step and saved at once -- nothing written past it',
      res.via === 'builder' && res.saved === true && changed === 1 && order.allItems[0].slides[0].content === 'Mem changed' && log.join() === 'save now' && res.before[0].content === 'Mem', log.join());
    saveSays = false;
    await L.set('o1', 'it1', ['Mem again']).then(r => { res = r; });
    check('...and a save that did not land is said to have not landed (the toast must not say Saved)', res.saved === false && changed === 2);
    lcd = true; err = null;
    await L.set('o1', 'it1', ['x']).catch(e => { err = e; });
    check('...open in LCD Projection here: refused, to be changed there (its page is what a save writes)', !!err && /LCD Projection/.test(err.message) && changed === 2);
    lcd = false; active = false; err = null;
    await L.set('o1', 'it1', ['x']).catch(e => { err = e; });
    check('...open here but not in the Builder: refused rather than written behind the copy here', !!err && /Liturgy Builder/.test(err.message));
  } catch (e) { check('the part\'s save runs', false, e.stack); }
  const mk16 = fn('_spMakeHtml'), use16 = fn('_spInUseHtml');
  check('This year\'s liturgy: with its order made, the in-use card; else the files to use, as before',
    /if \(d && d\.order && next\) return _spInUseHtml\(d, next, cyc, kind, list, head\);/.test(mk16) && /How to make this year’s from a past one/.test(mk16) &&
    /'<div class="spi-node spi-node--from"><div class="spi-node__t"><small>' \+ \(used \? 'The liturgy of' : 'Its liturgy'\)/.test(use16) &&
    /'<div class="spi-node__t"><small>' \+ \(used \? 'Used for' : 'For'\)/.test(use16) && /In use<\/span>/.test(use16));
  check('...read from the Builder\'s own copy when it holds the order here, else from the stored order (kept by _spLoad)',
    /var mem = \(window\.WO && WO\.libOutlineOf\) \? WO\.libOutlineOf\(d\.order\.id\) : null;/.test(fn('_spOrderOutline')) &&
    /d\.orderItems = got\.items \|\| \[\];/.test(fn('_spLoad')) && /if \(!_woLibHeld\(orderId\) \|\| !_lbdIsActive\(\) \|\| _woLcdInPage\(\)\) return null;/.test(fn('_woLibOutlineOf')));
  check('...a liturgy part has Edit; the words open in a box, saved through WO.libSetSlides in the Builder\'s copy (_spEdit); readings and songs say where they change',
    /p\.edit && !ed \? '<button type="button" class="spo-pen"/.test(fn('_spoPartHtml')) && /id="spoText"/.test(fn('_spoPartHtml')) &&
    /From the Roster: change it on the Readings page\./.test(fn('_spoPartHtml')) && /its words are in the Songbook/.test(fn('_spoPartHtml')) &&
    /_spEdit\(function\(oid\) \{ return WO\.libSetSlides\(oid, e\.id, _spoSlidesOf\(e\.text\), null, nt && nt !== e\.was \? nt : null\); \}/.test(fn('spoSave')) &&
    /if \(res\.saved === false\) showToast\('Changed in the Liturgy Builder, but it did not save/.test(fn('_spEdit')));
  check('...a save waited on watches the indicator: saved, failed, or not known in time',
    /_soSetSaveStatus\('saving'\);\s+saveImmediately\(\);/.test(fn('_soSaveSettled')) && /if \(_soState === 'failed' \|\| _soState === ''\) return res\(false\);/.test(fn('_soSaveSettled')) &&
    /_soState = state \|\| '';/.test(fn('_soSetSaveStatus')));
  check('the outline closes its own box', /: ''\) \+\s+'<\/div>';/.test(fn('_spOutlineHtml')));
  check('an order with no readings offers this date\'s from the Roster: the Builder opens on it and fills them',
    /\(n\.read \? '' : '<button type="button" class="spo-fill" onclick="LiturgyModule\.spoReadings\(\)"/.test(use16) &&
    /_llOpenInBuilder\(d\.order\.id, function\(\) \{ WO\.lbdFillReadings\(\); \}\)/.test(fn('spoReadings')) && /lbdFillReadings: lbdFillReadings/.test(SRC));
  check('the Builder opened from a service\'s page carries a bar back to it, in the Orders view only, gone when another order is opened; Back saves first',
    /if \(_llShown\('liturgyServicePanel'\) && _sp\.occ\) \{/.test(fn('_llOpenInBuilder')) && /_llBackBar\(\);/.test(fn('_llOpenInBuilder')) &&
    /view\.appendChild\(b\)/.test(fn('_llBackBar')) && /cur !== _llBack\.orderId/.test(fn('_llBackBar')) &&
    /WO\.saveImmediately\(\)/.test(fn('llBackToLib')) && /openService\(b\.occ, b\.from \|\| 'services', 'order'\)/.test(fn('llBackToLib')) &&
    /libOutlineOf: _woLibOutlineOf, libSetSlides: _woLibSetSlides, libPdf: _woLibPdf, libUnuse: _woLibUnuse, libDelete: _woLibDelete, libRestore: _woLibRestore,/.test(SRC));

  // ------------------------------------------------------------ 17. in use: concise, a PDF, Remove
  // From the operator (2026-11-16), on a screenshot of the box: "a better
  // overall design to show that the liturgy which was used based on a
  // previous year is being used for this particular day's service ... more
  // concise and also shareable in PDF format", "Able to delete the liturgy
  // set / And collapse / Expand", and "enable to delete the created liturgy
  // and revert back from Use".
  console.log('\n17. In use: where it came from, folded, a PDF, and Remove');
  check('the liturgy is folded, opened by Show liturgy in the block it is used for (a date tile beside it); open or shut kept on this device; its counts and Expand all / Collapse all inside',
    /'<div class="spi-node spi-node--to">' \+ _spDateTile\(next\.key\)/.test(use16) &&
    /'<button type="button" class="spi-showbtn' \+ \(open \? ' is-on' : ''\) \+ '" aria-expanded="' \+ open \+ '" onclick="LiturgyModule\.spoShow\(\)"><i class="fa-solid fa-list-ol"/.test(use16) &&
    /\(open \? 'Hide liturgy' : 'Show liturgy'\)/.test(use16) && !/spi-ol__hd/.test(use16) &&
    /\(open \? _spOutlineHtml\(ol, cmp\) : ''\)/.test(use16) && /plural\(n\.secs, 'section', 'sections'\)/.test(fn('_spOutlineHtml')) && /var SP_OL_KEY = 'lhc_sp_liturgy_open';/.test(SRC) &&
    /localStorage\.setItem\(SP_OL_KEY, _sp\.olOpen \? '1' : '0'\)/.test(fn('spoShow')) && /olOpen: _spOlPref\(\), change: false/.test(fn('openService')) &&
    /LiturgyModule\.spoOpenAll\(true\)">.*Expand all/.test(fn('_spOutlineHtml')) && /LiturgyModule\.spoOpenAll\(false\)">.*Collapse all/.test(fn('_spOutlineHtml')));
  check('...the Builder, PDF and Share, then another liturgy and Remove (Remove only for a liturgy put in)',
    /spi-act--main" onclick="LiturgyModule\.spEdit\(\)"/.test(use16) && /onclick="LiturgyModule\.spoPdf\(false\)"/.test(use16) && /onclick="LiturgyModule\.spoPdf\(true\)"/.test(use16) &&
    /onclick="LiturgyModule\.spoChange\(\)"/.test(use16) && /\(used \? '<button type="button" class="spi-link spi-link--rm" onclick="LiturgyModule\.spoRemove\(\)">/.test(use16) &&
    /q\('\.sp-make > \.lf-btn\.pl-btn-green'\) \|\| q\('\.sp-make \.spi-act--main'\)/.test(fn('_spTourSteps')));
  let R17 = null;
  try {
    R17 = new Function('_spRefKey', [ 'SP_READ_ROLES' ].map(() => SRC.match(/  var SP_READ_ROLES = [^\n]*;/)[0]).join('\n') + '\n' + ['_spUseRecord', '_spUnusePlan', '_spOlCounts'].map(fn).join('\n') +
      '\nreturn { rec: _spUseRecord, plan: _spUnusePlan, counts: _spOlCounts };')(v => String(v || '').toLowerCase().replace(/[^a-z0-9:]/g, ''));
  } catch (e) { console.log('  (could not build: ' + e.message + ')'); }
  if (R) {
    const recMade = R17.rec({ serviceLiturgy: { id: 'f', use: { at: 't1', made: true, roster: 'Contemporary', readings: [{ role: 'gospel', was: 'Mark 13:24-37', ref: 'Mark 1:1-8' }], songs: ['s1'] } } }, {}, []);
    check('the record Use left: an order it made is deleted, and the Roster\'s kind and readings go back',
      recMade.made === true && recMade.back === false && recMade.roster === 'Contemporary' && recMade.readings.length === 1 && recMade.songs === 1);
    const recBack = R17.rec({ serviceLiturgy: { id: 'f', use: { at: 't2', made: false, roster: null, readings: [] } }, useBefore: { at: 't2', snap: { v: 1 } } }, {}, []);
    const recLost = R17.rec({ serviceLiturgy: { id: 'f', use: { at: 't2', made: false } }, useBefore: { at: 't0', snap: { v: 1 } } }, {}, []);
    check('...an order that was there goes back to what it kept; a restore point from another time is not used', recBack.made === false && recBack.back === true && recLost.none === true);
    const legacy = R17.rec({ serviceLiturgy: { id: 'f' } }, { type: 'special', createdDate: '2026-11-16T03:43:46.901+00:00' }, [
      { role_id: 'service_type', old_value: 'Traditional', new_value: 'Contemporary', changed_at: '2026-10-18T13:37:55.95+00:00' },
      { role_id: 'service_type', old_value: 'Contemporary', new_value: 'Special', changed_at: '2026-11-16T03:43:46.321+00:00' },
      { role_id: 'gospel', old_value: 'Mark 13:24-37', new_value: 'Mark 1:1-8', changed_at: '2026-11-16T03:43:45.100+00:00' }]);
    check('...one put in before the record was kept (the live 29 Nov): Special written in the two minutes before the order was made -> Use made it, from Contemporary',
      legacy.made === true && legacy.legacy === true && legacy.roster === 'Contemporary' && legacy.readings.length === 1 && legacy.readings[0].was === 'Mark 13:24-37', JSON.stringify(legacy));
    const notMine = R17.rec({ serviceLiturgy: { id: 'f' } }, { type: 'special', createdDate: '2026-11-16T05:00:00Z' }, [
      { role_id: 'service_type', old_value: 'Contemporary', new_value: 'Special', changed_at: '2026-11-16T03:43:46.321+00:00' }]);
    check('...an order made at another time, or no liturgy put in at all, is not taken for one Use made', notMine.none === true && R17.rec({}, {}, []) === null &&
      R17.rec({ serviceLiturgy: { id: 'f' } }, { type: 'contemporary', createdDate: '2026-11-16T03:43:46.901Z' }, [{ role_id: 'service_type', new_value: 'Special', changed_at: '2026-11-16T03:43:46.321Z' }]).none === true);
    const pl = R17.plan(recMade, 'Special', { gospel: 'Mark 1:1-8' });
    const pl2 = R17.plan(recMade, 'Traditional', { gospel: 'John 1:1-5' });
    check('the plan: the Roster put back only where nobody changed it since -- its kind while it still says Special, a reading while it is still the liturgy\'s',
      pl.roster === 'Contemporary' && pl.reads.length === 1 && pl.kept.length === 0 && pl2.roster === null && pl2.reads.length === 0 && pl2.kept.length === 1 && R17.plan({ none: true }).none === true);
    const n = R17.counts({ secs: [{ id: 'a', parts: [{ kind: 'liturgy' }, { kind: 'reading' }] }, { id: '', parts: [{ kind: 'song' }, { kind: 'text' }] }] });
    check('...the counts: a part in no section is not a section', n.secs === 1 && n.lit === 2 && n.read === 1 && n.song === 1, JSON.stringify(n));
  }
  // Use keeps the record, and the restore point beside it
  const ap17 = fn('_svlApply');
  check('Use keeps how it came in on the order: whether it made it, the Roster before, the songs it brought; and what the order was, unless Use made it',
    /var useRec = more\.use \|\| \{ made: false \}, usePre = useRec\.made \? null : _svlUseSnap\(\);/.test(ap17) && /addedIds\.push\(entry\.id\);/.test(ap17) &&
    /currentOrderData\.template\.serviceLiturgy\.use = \{ at: useAt, made: !!useRec\.made,/.test(ap17) &&
    /if \(usePre\) currentOrderData\.template\.useBefore = \{ at: useAt, snap: usePre \};/.test(ap17) &&
    /ub: \(o\.template && o\.template\.useBefore\) \|\| null,/.test(fn('_lbdSnapshot')) && /if \('ub' in snap\)/.test(fn('_lbdRestore')));
  let W17 = null;
  try { W17 = new Function(['_svlUnuse'].map(fn).join('\n') + '\nreturn { unuse: _svlUnuse };')(); } catch (e) { console.log('  (could not build: ' + e.message + ')'); }
  if (W) {
    const o = { type: 'special', sectionLayout: [{ id: 'wo-section-0' }, { id: 'wo-section-sp3' }],
      allItems: [{ id: 'a', itemType: 'song' }, { id: 'b', itemType: 'song' }, { id: 'n', itemType: 'song' }, { id: 'svl1', itemType: 'liturgy' }],
      template: { serviceLiturgy: { id: 'f', use: { at: 't' } }, useBefore: { at: 't' }, medleys: [{ id: 'm' }], serviceNotes: 'new' } };
    const songs = [{ id: 'a', serviceSections: ['wo-section-sp3'], sectionId: 'wo-section-sp3' }, { id: 'b' }, { id: 'n', serviceSections: ['x'], sectionId: 'x' }];
    const snap = { type: 'contemporary', layout: [{ id: 'wo-section-0' }, { id: 'wo-section-4' }], items: [{ id: 'old', itemType: 'liturgy' }], cleared: ['c'], svcNotes: 'was', medleys: [],
      svl: null, prevBefore: null, songs: [{ id: 'a', ss: ['wo-section-4'], sid: 'wo-section-4' }] };
    const kept = W17.unuse(o, songs, snap, ['b']);
    check('Remove puts the order back: its kind, sections, parts, notes; the songs it had in their sections; the songs Use brought gone; one added since kept',
      o.type === 'contemporary' && o.sectionLayout.length === 2 && o.allItems.map(x => x.id).join() === 'a,n,old' && o.clearedSections.join() === 'c' &&
      o.template.serviceNotes === 'was' && !('serviceLiturgy' in o.template) && !('useBefore' in o.template) &&
      kept.map(x => x.id).join() === 'a,n' && kept[0].sectionId === 'wo-section-4' && kept[1].sectionId === 'x', JSON.stringify(o));
    const o2 = { type: 'special', allItems: [], template: {} };
    W17.unuse(o2, [], { type: 'special', layout: [], items: [], svl: { id: 'earlier', use: { at: 'e' } }, prevBefore: { at: 'e', snap: {} }, songs: [] }, []);
    check('...and the liturgy it had before, with that one\'s own restore point, comes back too (two Uses taken off one at a time)',
      o2.template.serviceLiturgy.id === 'earlier' && o2.template.useBefore.at === 'e');
  }
  check('Remove: the order first -- deleted when Use made it, put back by the Builder otherwise (here at once, or opened and then back here) -- then the Roster',
    /if \(pl\.made\) \{ say\('Deleting its order…'\); orderP = WO\.libDelete\(id\); \}/.test(fn('spoRemoveGo')) &&
    /else if \(WO\.libOutlineOf && WO\.libOutlineOf\(id\)\) \{ say\('Putting its order back…'\); orderP = WO\.libUnuse\(id\); \}/.test(fn('spoRemoveGo')) &&
    /_llOpenInBuilder\(id, function\(\) \{ WO\.libUnuse\(id\)\.then\(res, rej\); \}\)/.test(fn('spoRemoveGo')) &&
    /SBQ_READINGS\.setServiceType\(key, pl\.roster\)/.test(fn('spoRemoveGo')) && /if \(viaBuilder\) llBackToLib\(\); else _spLoad\(occ\);/.test(fn('spoRemoveGo')));
  check('...a made order is let go of here first, never while LCD Projection has it; a put-back is one Undo, its save waited on',
    /if \(_woLcdInPage\(\)\) return Promise\.reject\(new Error\('it is open in LCD Projection here: close that first'\)\);/.test(fn('_woLibDelete')) &&
    /_forgetDeletedOrder\(orderId\)/.test(fn('_woLibDelete')) && /_lbdChange\(function\(\) \{\s+songOrderSections = _svlUnuse\(/.test(fn('_woLibUnuse')) &&
    /return _soSaveSettled\(12000\)/.test(fn('_woLibUnuse')));
  check('...it asks first, saying exactly what happens, and nothing for a liturgy it has no record of',
    /Take this liturgy off ' \+ _lfE\(when\) \+ '\?/.test(fn('_spRmDraw')) && /The order made for it is deleted/.test(fn('_spRmDraw')) &&
    /goes back to how it was before this liturgy came in/.test(fn('_spRmDraw')) && /cannot be taken off here/.test(fn('_spRmDraw')) && /To have this one back, Use it again\./.test(fn('_spRmDraw')));
  check('Use notes the Roster\'s kind before it writes Special, for Remove', /SBQ_READINGS\.serviceTypeAt\(row\.key\)/.test(fn('spUseGo')) &&
    /use: \{ made: !row\.order, roster: rosterWas,/.test(fn('spUseGo')) && /serviceTypeAt: function\(iso\) \{/.test(SRC));
  // the PDF
  const pdf17 = fn('_woLibPdf'), model17 = fn('_woLibExportModel');
  check('the PDF is the Builder\'s own export: its model when the Builder holds the order here, the same model from the stored rows otherwise',
    /if \(_woLibHeld\(orderId\) && _lbdIsActive\(\) && !_woLcdInPage\(\)\) return _lbdExportModel\(\);/.test(model17) &&
    /paras: _lbdExportParas\(\[words\], \{ song: true \}\)/.test(model17) && /var doc = _lbdExportPdf\(m\);/.test(pdf17));
  check('...Share hands the file to the phone\'s share sheet (WhatsApp, email), in the click; a desk downloads it', /navigator\.canShare\(\{ files: \[file\] \}\)/.test(pdf17) &&
    /navigator\.share\(\{ title: base, text: \(meta && meta\.text\) \|\| base, files: \[file\] \}\)/.test(pdf17) && /_lbdDownload\(blob, name\);/.test(pdf17) &&
    /WO\.libPdf\(d\.order\.id, d\.orderFull, d\.orderItems, meta, !!share\)/.test(fn('spoPdf')));

  // ------------------------------------------------------------ 18. changed from the original
  // From the operator (2026-11-16): "what if the user has modified the
  // content within the ready to use liturgy. Meaning it's no longer the same
  // as the base PDF and what if he/she want to revert back to original?"
  // Asked: per part, plus all at once. And the sketch: a date tile on the
  // left of "Used for", Show liturgy moved into it.
  console.log('\n18. Changed from the original: marked, seen, put back');
  let C18 = null;
  try { C18 = new Function(['_spCompare', '_spDateTile'].map(fn).join('\n').replace('function _spDateTile', SRC.match(/  var SP_MON = [^\n]*;/)[0] + '\nfunction _spDateTile') + '\nreturn { cmp: _spCompare, tile: _spDateTile };')(); }
  catch (e) { console.log('  (could not build: ' + e.message + ')'); }
  if (C18) {
    const sl = (...t) => t.map((c, i) => ({ index: i, content: c, background: '' }));
    const file = [
      { id: 'a', itemType: 'liturgy', sourceId: 'doc_1', sectionId: 'wo-section-0', title: 'Invocation', slides: sl('In the name') },
      { id: 'b', itemType: 'liturgy', sourceId: 'doc_2', sectionId: 'wo-section-1', title: 'Confession', slides: sl('We confess', 'Amen.') },
      { id: 'c', itemType: 'liturgy', sourceId: 'doc_3', sectionId: 'wo-section-1', title: 'Absolution', slides: sl('You are forgiven') },
      { id: 'r', itemType: 'scripture', sourceId: 'x', sectionId: 'wo-section-2', title: 'Isaiah 64', slides: sl('Oh that') },
      { id: 'd', itemType: 'liturgy', sourceId: '', sectionId: 'wo-section-3', title: 'Blessing', slides: sl('The Lord bless you') }];
    const map = { 'wo-section-0': 'wo-section-sp0', 'wo-section-1': 'wo-section-sp1', 'wo-section-3': 'wo-section-sp3' };
    const ord = [
      { id: 'o1', itemType: 'liturgy', sourceId: 'doc_1', sectionId: 'wo-section-sp0', title: 'Invocation', slides: sl('In the name  ') },
      { id: 'o2', itemType: 'liturgy', sourceId: 'doc_2', sectionId: 'wo-section-sp1', title: 'Confession', slides: sl('We confess our sins', 'Amen.') },
      { id: 'o4', itemType: 'liturgy', sourceId: 'lib9', sectionId: 'wo-section-sp1', title: 'Kyrie', slides: sl('Lord have mercy') },
      { id: 'o5', itemType: 'scripture', sourceId: 'y', sectionId: 'wo-section-0', title: 'Mark 1', slides: sl('The beginning') },
      { id: 'o6', itemType: 'liturgy', sourceId: 'lbd_x', sectionId: 'wo-section-sp3', title: 'blessing', slides: sl('The Lord bless you') }];
    const r = C18.cmp(file, ord, map, ['wo-section-sp0', 'wo-section-sp1', 'wo-section-sp3']);
    check('a part is matched to the original by its source id, else by its title; words compared without trailing spaces; readings never',
      r.byItem.o1.st === 'same' && r.byItem.o6.st === 'same' && !r.byItem.o5 && r.byItem.o2.st === 'changed' && r.changed === 1, JSON.stringify(r.byItem));
    check('...the changed part carries the original\'s words; a part not in the original is "added"; one of the original\'s not here is taken out, with its section renamed as the order names it and the part it followed',
      JSON.stringify(r.byItem.o2.orig) === JSON.stringify(['We confess', 'Amen.']) && r.byItem.o4.st === 'added' && r.added === 1 &&
      r.missing.length === 1 && r.missing[0].key === 'doc_3' && r.missing[0].secId === 'wo-section-sp1' && r.missing[0].secOk === true && r.missing[0].after === 'o2', JSON.stringify(r.missing));
    const r3 = C18.cmp([{ id: 'w', itemType: 'liturgy', sourceId: 'doc_7', sectionId: 'wo-section-0', title: 'Wreath', slides: sl('C: Lord,\n    we light this candle\nHymn: Whisper (SUO GAN)') }],
      [{ id: 'ow', itemType: 'liturgy', sourceId: 'doc_7', sectionId: 'wo-section-sp0', title: 'Wreath', slides: sl('C: Lord,\nwe light  this candle\nHymn: Whisper') }], map, ['wo-section-sp0']);
    const r4 = C18.cmp([{ id: 'w', itemType: 'liturgy', sourceId: 'doc_7', sectionId: 'wo-section-0', title: 'Wreath', slides: sl('C: Lord,\nwe light this candle') }],
      [{ id: 'ow', itemType: 'liturgy', sourceId: 'doc_7', sectionId: 'wo-section-sp0', title: 'Wreath', slides: sl('C: Lord,\nwe light two candles') }], map, ['wo-section-sp0']);
    check('...compared as the wall shows the words: indents, runs of spaces and a parenthetical (never projected) are not changes -- the live 29 Nov order\'s Confession and Advent Wreath -- but a word is', r3.byItem.ow.st === 'same' && r3.changed === 0 && r4.byItem.ow.st === 'changed' && r4.byItem.ow.orig[0] === 'C: Lord,\nwe light this candle', JSON.stringify(r3.byItem));
    const r2 = C18.cmp(file, ord.filter(o => o.id !== 'o1'), map, ['wo-section-sp1', 'wo-section-sp3']);
    check('...a part whose section was taken out too cannot be put back in it', r2.missing.find(m => m.key === 'doc_1').secOk === false);
    check('the date tile: the day and the month', /<b>29<\/b><span>Nov<\/span>/.test(C18.tile('2026-11-29')) && C18.tile('') === '');
  }
  let K18 = null;
  try { K18 = new Function(['_woLibKeepBg'].map(fn).join('\n') + '\nreturn _woLibKeepBg;')(); } catch (e) { console.log('  (could not build: ' + e.message + ')'); }
  if (K18) {
    const back = K18([{ content: 'mine', background: 'img1' }, { content: 'x', background: '' }], [{ content: 'A', richHtml: '<b>A</b>' }, { content: 'B', background: 'own' }, { content: 'C' }]);
    check('a part put back takes the original\'s words and formatting, and keeps the background the service gave each place',
      back.length === 3 && back[0].content === 'A' && back[0].richHtml === '<b>A</b>' && back[0].background === 'img1' && back[1].background === 'own' && back[2].background === '' &&
      back.map(x => x.index).join() === '0,1,2');
  }
  try {
    const log = [];
    let held = true, active = true, lcd = false;
    const order = { id: 'o', allItems: [{ id: 's1', itemType: 'song' }, { id: 'o2', itemType: 'liturgy', sectionId: 'sp1', slides: [{ content: 'mine', background: 'bg' }] }, { id: 'o9', itemType: 'liturgy', sectionId: 'sp2', slides: [] }] };
    const env = { _lbdIsActive: () => active, _woLcdInPage: () => lcd, _lbdPfx: () => 'p_', _lbdUid: () => 'u1',
      _woSectionList: () => [{ id: 'sp1' }, { id: 'sp2' }], _soSaveSettled: () => { log.push('save'); return Promise.resolve(true); },
      _lbdChange: f => { log.push('change'); return f() !== false; }, SBQ: { _sb: () => null }, _lbdClearClearedFor: id => log.push('uncleared ' + id) };
    const keys = Object.keys(env);
    const L = new Function(...keys, 'var currentOrderData = null;' + ['_woLibHeld', '_woLibKeepBg', '_woLibSlides', '_woLibSetSlides', '_woLibRestore'].map(fn).join('\n') +
      '\nreturn { restore: _woLibRestore, hold: function(o) { currentOrderData = o; } };')(...keys.map(k => env[k]));
    L.hold(order);
    let res = null;
    await L.restore('o', { put: [{ id: 'o2', slides: [{ content: 'orig' }] }], add: [{ item: { id: 'f3', itemType: 'liturgy', sourceId: 'doc_3', sectionId: 'wo-section-1', slides: [{ content: 'gone' }] }, secId: 'sp1', after: 'o2' },
                                                                                  { item: { id: 'f4', itemType: 'liturgy', sectionId: 'x' }, secId: 'nowhere', after: null }] }).then(r => { res = r; });
    check('Put all back in the Builder\'s copy: one Undo step, the words back with the background kept, a part taken out back after the part it followed, its save waited on; a part with no section left alone',
      res.via === 'builder' && res.put === 1 && res.added === 1 && log.join() === 'change,uncleared sp1,save' && order.allItems[1].slides[0].content === 'orig' && order.allItems[1].slides[0].background === 'bg' &&
      order.allItems[2].id === 'p_svl_u1' && order.allItems[2].sectionId === 'sp1' && order.allItems.length === 4, JSON.stringify(order.allItems.map(x => x.id + '@' + x.sectionId)));
    L.hold(null); let err = null;
    await L.restore('o', { put: [], add: [{ item: { id: 'z' }, secId: 'sp1' }] }).catch(e => { err = e; });
    check('...not held here: a part taken out goes back only through the Builder (the page opens it and asks again)', !!err && err.code === 'builder');
  } catch (e) { check('the put-back runs', false, e.stack); }
  check('the page: a changed part marked Changed, its original to see, Put back the original; a part taken out shown in its section with Put back; a part not in the original says so',
    /spo-tag spo-tag--ch">Changed/.test(fn('_spoPartHtml')) && /LiturgyModule\.spoOrig\(this\.dataset\.id\)/.test(fn('_spoPartHtml')) && /Put back the original/.test(fn('_spoPartHtml')) &&
    /spo-tag spo-tag--gone">Taken out/.test(fn('_spoPartHtml')) && /LiturgyModule\.spoPutGone\(this\.dataset\.key\)/.test(fn('_spoPartHtml')) && /Not in the original/.test(fn('_spoPartHtml')) &&
    /ps\.concat\(gone\[x\.id\] \|\| \[\]\)/.test(fn('_spOutlineHtml')));
  check('...the line under the blocks: Same as the original, or "Modified:" with what changed, See and Reset to original (asked first, the changes named; the readings and songs stay)',
    /Same as the original/.test(fn('_spDiffHtml')) && /LiturgyModule\.spoShowChanged\(\)/.test(fn('_spDiffHtml')) && /LiturgyModule\.spoPutAll\(\)/.test(fn('_spDiffHtml')) &&
    /<b>Modified:<\/b>/.test(fn('_spDiffHtml')) && /Reset to original/.test(fn('_spDiffHtml')) &&
    /title: 'Reset to the original\?'/.test(fn('spoPutAll')) && /The readings and the songs stay\. Undo brings back what was here\./.test(fn('spoPutAll')) &&
    /_spCmpNow\(d, ol\)/.test(use16) && /flow \+ ctop \+ _spDiffHtml\(cmp\) \+ cacts \+ olBox/.test(use16));
  check('...one part put back, or everything, through WO.libRestore in the Builder\'s copy; every change on the page through _spEdit, which opens the Builder once when it does not hold the order and comes back',
    /_spEdit\(function\(oid\) \{ return WO\.libRestore\(oid, \{ put: \[x\] \}\); \}/.test(fn('spoPutBack')) &&
    /_spEdit\(function\(oid\) \{ return WO\.libRestore\(oid, Object\.assign\(\{ unblend: true \}, plan\)\); \}/.test(fn('spoPutAll')) &&
    /if \(WO\.libOutlineOf\(oid\)\) \{/.test(fn('_spEdit')) && /_llOpenInBuilder\(oid, function\(\) \{/.test(fn('_spEdit')) &&
    /report\(res\); llBackToLib\(\); resolve\(true\);/.test(fn('_spEdit')) && !fn('_spRestore'));
  check('...the original is the Liturgy App File it came from (this page\'s, or read once), its sections renamed as a Special order names them',
    /sb\.from\('service_liturgies'\)\.select\('\*'\)\.eq\('id', svl\.id\)\.maybeSingle\(\)/.test(fn('_spOrigRow')) &&
    /WO\.svlSecMap\(row\.data \|\| \{\}, ol\.type, row\.order_type\)/.test(fn('_spCmpNow')) &&
    /if \(orderType !== 'special' \|\| fileType === 'special'\) return \{\};/.test(fn('_woSvlSecMap')));

  // ------------------------------------------------------------ 19. the original, marked, and the way to it
  // From the operator (2026-11-16), on the card: "Label as 'original'" and
  // "link to direct to where the file is".
  console.log('\n19. The original: a badge, and Go to file');
  let T19 = null;
  try { T19 = new Function(fn('_spOrigTarget') + '\nreturn _spOrigTarget;')(); } catch (e) { console.log('  (could not build: ' + e.message + ')'); }
  if (T19) {
    const items = { d1: { id: 'd1', title: 'Advent Week 1 2025', occasionId: 'advent' } };
    const find = id => items[id] || null, yearOf = (it) => (String(it.title).match(/20\d\d/) || [''])[0];
    const t1 = T19({ made_from: 'doc:d1', occasion_id: 'advent' }, 'f1', find, yearOf);
    const t2 = T19({ made_from: 'doc:gone', occasion_id: 'advent' }, 'f1', find, yearOf);
    const t3 = T19({ made_from: 'order:x', occasion_id: 'advent' }, 'f1', find, yearOf);
    check('the original is the document its Liturgy App File was converted from, with its service and year; else the app file itself',
      t1.kind === 'doc' && t1.id === 'd1' && t1.occ === 'advent' && t1.year === '2025' && t1.file === 'f1' && t1.name === 'Advent Week 1 2025' &&
      t2.kind === 'file' && t2.removed === true && t3.kind === 'file' && t3.removed === false && T19({}, '', find, yearOf) === null, JSON.stringify([t1, t2, t3]));
  }
  check('the card: the "The liturgy of" block carries an Original badge and Go to file (Go to file only for a Liturgy App File)',
    /<span class="spi-orig__badge"><i class="fa-solid fa-star" aria-hidden="true"><\/i>Original<\/span>/.test(use16) &&
    /\(svl\.id \? '<button type="button" class="spi-golink" onclick="LiturgyModule\.spoGoOrig\(\)"/.test(use16) && /'<\/div>' \+ orig \+ '<\/div>'/.test(use16) &&
    /var srcs = used \? _spSourcesHtml\(svl, occ\) : '';/.test(use16) && /srcs \+ '<\/div>' \+ orig \+ '<\/div>'/.test(use16));
  check('...Go to file: the document\'s row on its year in the Liturgies tab, lit (the Converted mark) and scrolled to -- on the page of the service it is filed under; no document, the app file\'s preview',
    /_spOrigTarget\(row, svl\.id, getItem, _spYearOf\)/.test(fn('spoGoOrig')) && /spPreviewReady\(t\.id\)/.test(fn('spoGoOrig')) &&
    /if \(t\.occ && t\.occ !== _sp\.occ\) \{ _spFocusNext = focus; openService\(t\.occ, _sp\.from, 'order'\); return; \}/.test(fn('spoGoOrig')) &&
    /_sp\.res = 'liturgy'; _sp\.year = f\.year \|\| ''; _sp\.fresh = f\.fresh;/.test(fn('_spFocusOn')) && /\.sp-doc\.is-new/.test(fn('_spFocusOn')) &&
    /if \(_spFocusNext\) \{/.test(fn('openService')));

  // ------------------------------------------------------------ 20. sections edited, removed, moved; Undo, Redo, Reset
  // From the operator (2026-11-16): "For each of the items in the liturgy,
  // allow the user to edit, remove the section and it's content. Allow to
  // rearrange as well. Ensure that the liturgy will be acknowledged as
  // modified. And is granted the option to reset or original or undo to
  // previous or redo", and the tiles under the card "not necessary".
  console.log('\n20. Sections: rename, remove, reorder; marked; Undo, Redo, Reset');
  check('the tiles under This year\'s liturgy went', !/pl-tiles|pl-tile/.test(fn('_spOrderTab')) && !/pl-tiles|pl-tile/.test(fn('_spResHtml')) &&
    /return '<div class="sp-lib">' \+ _spResHtml\(occ, d, orderId\) \+ '<\/div>';/.test(fn('_spOrderTab')));
  let S20 = null;
  try { S20 = new Function(['_spCompareSecs', '_spCompare', '_spResetPlan', '_spCmpCounts'].map(fn).join('\n') + '\nreturn { secs: _spCompareSecs, parts: _spCompare, plan: _spResetPlan, counts: _spCmpCounts };')(); }
  catch (e) { console.log('  (could not build: ' + e.message + ')'); }
  if (S20) {
    const fileLay = [{ id: 'wo-section-0', title: '1. Invocation' }, { id: 'wo-section-doc1', title: 'Greeting' }, { id: 'wo-section-2', title: 'Scripture Readings', serviceSectionId: 'scripture' },
      { id: 'wo-section-3', title: 'Confession' }, { id: 'wo-section-4', title: 'Blessing' }];
    const map = { 'wo-section-0': 'wo-section-sp0', 'wo-section-2': 'wo-section-0', 'wo-section-3': 'wo-section-sp3', 'wo-section-4': 'wo-section-sp4' };
    const same = S20.secs(fileLay, [{ id: 'wo-section-sp0', title: 'Invocation' }, { id: 'wo-section-doc1', title: 'Greeting' }, { id: 'wo-section-0', title: 'Scripture Readings' },
      { id: 'wo-section-sp3', title: 'Confession' }, { id: 'wo-section-tr5', title: 'Holy Communion' }, { id: 'wo-section-sp4', title: 'Blessing' }], map);
    check('the sections against the original: the same when only the Use\'s own Traditional parts were added; numbers in titles do not count',
      !same.gone.length && !Object.keys(same.renamed).length && !Object.keys(same.moved).length && !Object.keys(same.added).length, JSON.stringify(same));
    const ord = [{ id: 'wo-section-sp3', title: 'Confession' }, { id: 'wo-section-sp0', title: 'The Invocation' }, { id: 'wo-section-0', title: 'Scripture Readings' },
      { id: 'mine', title: 'Testimony' }, { id: 'wo-section-sp4', title: 'Blessing' }];
    const r = S20.secs(fileLay, ord, map);
    check('...a section taken out (after the one it followed), one renamed (with the original name), one moved (off the longest run still in order), one added',
      r.gone.length === 1 && r.gone[0].id === 'wo-section-doc1' && r.gone[0].after === 'wo-section-sp0' && r.gone[0].entry.title === 'Greeting' &&
      r.renamed['wo-section-sp0'] === 'Invocation' && Object.keys(r.moved).join() === 'wo-section-sp3' && Object.keys(r.added).join() === 'mine' &&
      r.order.join() === 'wo-section-sp0,wo-section-doc1,wo-section-0,wo-section-sp3,wo-section-sp4', JSON.stringify(r));
    const sl = (...t) => t.map((c, i) => ({ index: i, content: c }));
    const fileItems = [{ id: 'a', itemType: 'liturgy', sourceId: 'doc_1', sectionId: 'wo-section-0', title: 'Invocation', slides: sl('In the name') },
      { id: 'g', itemType: 'liturgy', sourceId: 'doc_2', sectionId: 'wo-section-doc1', title: 'Greeting', slides: sl('Grace to you') },
      { id: 'c', itemType: 'liturgy', sourceId: 'doc_3', sectionId: 'wo-section-3', title: 'Confession', slides: sl('We confess') }];
    const ordItems = [{ id: 'oa', itemType: 'liturgy', sourceId: 'doc_1', sectionId: 'wo-section-sp4', title: 'Invocation', slides: sl('In the name') },
      { id: 'oc', itemType: 'liturgy', sourceId: 'doc_3', sectionId: 'wo-section-sp3', title: 'Confession', slides: sl('We confess all') },
      { id: 'ox', itemType: 'liturgy', sourceId: 'lib1', sectionId: 'mine', title: 'Testimony', slides: sl('x') },
      { id: 'oy', itemType: 'liturgy', sourceId: 'lib2', sectionId: 'wo-section-sp4', title: 'Extra prayer', slides: sl('y') },
      { id: 'ot', itemType: 'liturgy', sourceId: 'lib3', sectionId: 'wo-section-tr5', title: 'Sanctus', slides: sl('Holy') },
      { id: 'ow', itemType: 'liturgy', sourceId: 'lib4', sectionId: 'wo-section-0', title: 'Alleluia', slides: sl('Alleluia') }];
    const cmp = S20.parts(fileItems, ordItems, map, ord.map(x => x.id));
    cmp.secs = r;
    check('parts: one moved to another section, one changed, one added; the Use\'s Traditional parts and anything in the readings\' place are not changes',
      cmp.byItem.oa.st === 'moved' && cmp.byItem.oa.secId === 'wo-section-sp0' && cmp.byItem.oc.st === 'changed' && cmp.byItem.oy.st === 'added' &&
      !cmp.byItem.ot && !cmp.byItem.ow && cmp.movedParts === 1 && cmp.missing.length === 1 && cmp.missing[0].secId === 'wo-section-doc1', JSON.stringify(cmp.byItem));
    const n = S20.counts(cmp);
    check('...counted for the line: parts changed, moved, added (not the ones in a section added); sections taken out, renamed, moved, added; the Greeting comes back with its section',
      n.changed === 1 && n.moved === 1 && n.added === 1 && n.gone === 0 && n.secGone === 1 && n.renamed === 1 && n.secMoved === 1 && n.secAdded === 1 && n.any === 7, JSON.stringify(n));
    const plan = S20.plan(cmp);
    check('Reset: the words back, the moved part back in its section (its words left), the added part out, the taken-out section and its part back, names and order back, the added section out',
      plan.put.find(x => x.id === 'oc').slides[0].content === 'We confess' && plan.put.find(x => x.id === 'oa').slides === null && plan.put.find(x => x.id === 'oa').secId === 'wo-section-sp0' &&
      plan.drop.join() === 'oy' && plan.add.length === 1 && plan.add[0].secId === 'wo-section-doc1' && plan.layout.add[0].entry.id === 'wo-section-doc1' &&
      plan.layout.titles['wo-section-sp0'] === 'Invocation' && plan.layout.remove.join() === 'mine' && plan.layout.order.length === 5, JSON.stringify(plan.layout));
  }
  let R20 = null;
  try { R20 = new Function(fn('_woLibReorder') + '\nreturn _woLibReorder;')(); } catch (e) { console.log('  (could not build: ' + e.message + ')'); }
  if (R20) {
    const L = [{ id: 'c' }, { id: 'x' }, { id: 'a' }, { id: 'tr' }, { id: 'b' }];
    const re = R20(L, ['a', 'b', 'c']);
    check('the original\'s order put back: an added section stays after the one it followed', re.changed && re.layout.map(x => x.id).join() === 'a,tr,b,c,x', re.layout.map(x => x.id).join());
    check('...already in order: nothing changes', R20([{ id: 'a' }, { id: 'b' }], ['a', 'b']).changed === false);
  }
  try {
    const log = [];
    const lay = [{ id: 's1', title: '1. Gather' }, { id: 's2', title: 'Confession' }, { id: 's3', title: 'Blessing' }];
    const order = { id: 'o', sectionLayout: lay, allItems: [{ id: 'i1', itemType: 'liturgy', sectionId: 's2' }, { id: 'i2', itemType: 'song', sectionId: 's2' }, { id: 'i3', itemType: 'liturgy', sectionId: 's3' }] };
    let active = true;
    const env = { _lbdIsActive: () => active, _woLcdInPage: () => false, _lbdSecIndex: id => order.sectionLayout.findIndex(x => x.id === id),
      _woStripNum: t => String(t).replace(/^\d+\.\s*/, ''), _lbdChange: f => { log.push('change'); return f() !== false; }, _lbdSortSongsByService: () => log.push('sort'),
      _woSectionList: () => order.sectionLayout.map(x => ({ id: x.id })), _woSectionItems: id => order.allItems.filter(x => x.sectionId === id && x.itemType !== 'song'),
      songOrderSections: [{ id: 'sg', serviceSections: ['s2'] }], _woSongSectionIds: (sg) => sg.serviceSections, _lbdUnplaceSong: (sg, id) => log.push('unplace ' + sg.id + ' ' + id),
      _woUserClearedTypes: {}, _soSaveSettled: () => { log.push('save'); return Promise.resolve(true); }, _lbdUndoStack: [1, 2], _lbdRedoStack: [], lbdUndo: () => log.push('undo'), lbdRedo: () => log.push('redo') };
    const keys = Object.keys(env);
    const W = new Function(...keys, 'var currentOrderData = null;' + ['_woLibHeld', '_woLibSection', '_woLibHistory', '_woLibStep'].map(fn).join('\n') +
      '\nreturn { sec: _woLibSection, hist: _woLibHistory, step: _woLibStep, hold: function(o) { currentOrderData = o; } };')(...keys.map(k => env[k]));
    W.hold(order);
    let r = await W.sec('o', 'rename', 's1', '  Gathering  ');
    check('rename: the section\'s name, one Undo step, saved at once; the same name is no change', order.sectionLayout[0].title === 'Gathering' && r.saved === true && log.join() === 'change,save' &&
      (await W.sec('o', 'rename', 's1', 'Gathering')).same === true);
    log.length = 0;
    await W.sec('o', 'move', 's3', -1);
    check('move: one place up, the songs put back in the service\'s order', order.sectionLayout.map(x => x.id).join() === 's1,s3,s2' && log.join() === 'change,sort,save', log.join());
    log.length = 0;
    await W.sec('o', 'remove', 's2');
    check('remove: the section and its parts go; its songs stay in the order without a section (as the Builder\'s Remove)',
      order.sectionLayout.map(x => x.id).join() === 's1,s3' && order.allItems.map(x => x.id).join() === 'i2,i3' && log.join() === 'change,unplace sg s2,save', log.join());
    check('Undo and Redo are the Builder\'s own, offered while it holds the order here', JSON.stringify(W.hist('o')) === '{"undo":2,"redo":0}' &&
      (await W.step('o', true)).saved === true && log.slice(-2).join() === 'undo,save' && (await W.step('o', false)) === false);
    active = false; let err = null;
    await W.sec('o', 'rename', 's1', 'x').catch(e => { err = e; });
    check('...not in the Builder here: refused with code builder (the page opens it and asks again)', !!err && err.code === 'builder' && W.hist('o') === null);
  } catch (e) { check('the section changes run', false, e.stack); }
  try {
    const log = [];
    const order = { id: 'o',
      sectionLayout: [{ id: 'sp3', title: 'Confession' }, { id: 'sp0', title: 'The Invocation', notes: 'mine' }, { id: 'mine', title: 'Testimony' }, { id: 'sp4', title: 'Blessing' }],
      allItems: [{ id: 'oa', itemType: 'liturgy', sectionId: 'sp4', slides: [{ content: 'In the name', background: 'bg' }] }, { id: 'oc', itemType: 'liturgy', sectionId: 'sp3', slides: [{ content: 'We confess all' }] },
                 { id: 'ox', itemType: 'liturgy', sectionId: 'mine', sourceId: 'l1', slides: [] }, { id: 'oy', itemType: 'liturgy', sectionId: 'sp4', sourceId: 'l2', slides: [] }, { id: 's1', itemType: 'song', sectionId: 'mine' }] };
    const env = { _lbdIsActive: () => true, _woLcdInPage: () => false, _lbdPfx: () => 'p_', _lbdUid: () => 'n1', _woStripNum: t => String(t).replace(/^\d+\.\s*/, ''),
      _woSectionList: () => order.sectionLayout.map(x => ({ id: x.id })), _soSaveSettled: () => Promise.resolve(true), _lbdChange: f => { log.push('change'); return f() !== false; },
      _lbdClearClearedFor: id => log.push('uncleared ' + id), _lbdNoteCleared: (sec, src) => log.push('cleared ' + sec + ' ' + src), _lbdSortSongsByService: () => log.push('sort'),
      songOrderSections: [{ id: 's1', serviceSections: ['mine'] }], _woSongSectionIds: sg => sg.serviceSections, _lbdUnplaceSong: (sg, id) => log.push('unplace ' + sg.id + ' ' + id), SBQ: { _sb: () => null } };
    const keys = Object.keys(env);
    const W = new Function(...keys, 'var currentOrderData = null;' + ['_woLibHeld', '_woLibKeepBg', '_woLibSlides', '_woLibSetSlides', '_woLibReorder', '_woLibRestore'].map(fn).join('\n') +
      '\nreturn { restore: _woLibRestore, hold: function(o) { currentOrderData = o; } };')(...keys.map(k => env[k]));
    W.hold(order);
    const res = await W.restore('o', {
      put: [{ id: 'oc', slides: [{ content: 'We confess' }] }, { id: 'oa', slides: null, secId: 'sp0' }],
      add: [{ item: { id: 'g', itemType: 'liturgy', sourceId: 'doc_2', sectionId: 'x', slides: [{ content: 'Grace' }] }, secId: 'doc1', after: null }],
      drop: ['oy'],
      layout: { add: [{ entry: { id: 'doc1', title: 'Greeting' }, after: 'sp0' }], titles: { sp0: 'Invocation' }, order: ['sp0', 'doc1', 'sp3', 'sp4'], remove: ['mine'] } });
    check('Reset in the Builder\'s copy, all in one Undo: the added section out (its song kept without it), the taken-out section back after the one it followed, its name back, the original\'s order (notes kept), the words and the moved part back, the added part out, the Greeting back in its section',
      order.sectionLayout.map(x => x.id + ':' + x.title).join() === 'sp0:Invocation,doc1:Greeting,sp3:Confession,sp4:Blessing' && order.sectionLayout[0].notes === 'mine' &&
      order.allItems.find(x => x.id === 'oc').slides[0].content === 'We confess' && order.allItems.find(x => x.id === 'oa').sectionId === 'sp0' &&
      order.allItems.find(x => x.id === 'oa').slides[0].content === 'In the name' && !order.allItems.some(x => x.id === 'oy' || x.id === 'ox') &&
      order.allItems.some(x => x.id === 'p_svl_n1' && x.sectionId === 'doc1') && log.filter(l => l === 'change').length === 1 &&
      log.indexOf('unplace s1 mine') >= 0 && log.indexOf('uncleared doc1') >= 0 && log.indexOf('cleared sp4 l2') >= 0 && log.indexOf('sort') >= 0 && res.secs >= 3 && res.dropped === 1,
      JSON.stringify({ lay: order.sectionLayout, items: order.allItems.map(x => x.id + '@' + x.sectionId), log }));
  } catch (e) { check('the reset runs', false, e.stack); }
  const out20 = fn('_spOutlineHtml');
  check('the outline: each section\'s pen and bin; Reorder gives it arrows instead (Done to finish); Undo / Redo while the Builder holds the order; the original\'s sections taken out shown in place with Put back',
    /LiturgyModule\.spoSecEdit\(this\.dataset\.id\)/.test(out20) && /LiturgyModule\.spoSecRemove\(this\.dataset\.id\)/.test(out20) &&
    /LiturgyModule\.spoSecMove\(this\.dataset\.id, -1\)/.test(out20) && /LiturgyModule\.spoSecMove\(this\.dataset\.id, 1\)/.test(out20) &&
    /LiturgyModule\.spoReorder\(\)/.test(out20) && /\(reorder \? 'Done' : 'Reorder'\)/.test(out20) &&
    /var hist = \(oid && window\.WO && WO\.libHistory\) \? WO\.libHistory\(oid\) : null;/.test(out20) && /LiturgyModule\.spoUndo\(\)/.test(out20) && /LiturgyModule\.spoRedo\(\)/.test(out20) &&
    /LiturgyModule\.spoPutSec\(this\.dataset\.id\)/.test(out20) && /Renamed<\/span>/.test(out20) && /Moved<\/span>/.test(out20) && /Added<\/span>/.test(out20));
  check('...rename in place (Enter saves, Esc cancels); remove asks first, naming what goes and that songs stay; a move is quiet',
    /id="spoSecName"/.test(out20) && /LiturgyModule\.spoSecSave\(\)/.test(out20) && /WO\.libSection\(oid, 'rename', e\.id, t\)/.test(fn('spoSecSave')) &&
    /window\.lhcAskDelete\(\{ title: 'Remove “' \+ x\.title \+ '”\?'/.test(fn('spoSecRemove')) && /song stays', 'songs stay'\) \+ ' in the order, without a section\. '/.test(fn('spoSecRemove')) &&
    /WO\.libSection\(oid, 'remove', id\)/.test(fn('spoSecRemove')) && /WO\.libSection\(oid, 'move', id, dir < 0 \? -1 : 1\); \}, ''\)/.test(fn('spoSecMove')));
  check('...the page keeps its place (Show all, Reorder) across the trip to the Builder and back',
    /allSecs: _sp\.occ === occId \? !!_sp\.allSecs : false/.test(fn('openService')) && /reorder: _sp\.occ === occId \? !!_sp\.reorder : false/.test(fn('openService')));


  // ------------------------------------------------------------ 21. words for a section, even an empty one
  // From the operator (2026-11-16), circling "Nothing in it yet." under two
  // sections: "make the content editable as well, even if there's none".
  console.log('\n21. Words typed for a section, even an empty one');
  try {
    const log = [];
    const order = { id: 'o', allItems: [{ id: 'a', itemType: 'liturgy', sectionId: 'inv', slides: [{ content: 'In the name' }] }] };
    const env = { _lbdIsActive: () => true, _woLcdInPage: () => false, _lbdPfx: () => 'p_', _lbdUid: () => 'u1', _woStripNum: t => String(t).replace(/^\d+\.\s*/, ''),
      _woSectionList: () => [{ id: 'gather', title: '1. Gather' }, { id: 'inv', title: 'Invocation' }],
      _soSaveSettled: () => Promise.resolve(true), _lbdChange: f => { log.push('change'); return f() !== false; },
      _lbdInsertItem: (it, after) => { log.push('insert after ' + after); order.allItems.push(it); }, _lbdClearClearedFor: id => log.push('uncleared ' + id) };
    const keys = Object.keys(env);
    const W = new Function(...keys, 'var currentOrderData = null;' + ['_woLibHeld', '_woLibAddPart'].map(fn).join('\n') +
      '\nreturn { add: _woLibAddPart, hold: function(o) { currentOrderData = o; } };')(...keys.map(k => env[k]));
    let refused = null;
    await W.add('o', 'gather', ['x'], 'Gather').catch(e => { refused = e; });
    check('words for a section go only into the Builder\'s copy: refused (code builder, so the page opens the Builder) while it does not hold the order',
      !!refused && refused.code === 'builder' && order.allItems.length === 1, refused && refused.message);
    W.hold(order);
    const res = await W.add('o', 'gather', ['L: Come, let us worship', '  ', 'C: The Lord is here'], '');
    const it = order.allItems[order.allItems.length - 1];
    check('...then one part of the service\'s own (source lbd_<uid>), named for its section, its slides the words typed (blank ones dropped), at the end of the section, the section\'s cleared record let go, one Undo, the save waited on',
      res && res.saved === true && res.id === 'p_liturgy_lbd_u1_gather' && it.id === res.id && it.itemType === 'liturgy' && it.sourceId === 'lbd_u1' && it.sectionId === 'gather' &&
      it.title === 'Gather' && it.slides.length === 2 && it.slides[0].content === 'L: Come, let us worship' && it.slides[1].index === 1 && it.slides[1].background === '' &&
      log.filter(l => l === 'change').length === 1 && log.indexOf('insert after null') >= 0 && log.indexOf('uncleared gather') >= 0, JSON.stringify({ it, log }));
    let none = null, gone = null;
    await W.add('o', 'gather', ['  ', ''], 'Gather').catch(e => { none = e; });
    await W.add('o', 'nowhere', ['x'], 'X').catch(e => { gone = e; });
    check('...nothing for no words, or a section no longer in the order', !!none && !!gone && order.allItems.length === 2);
  } catch (e) { check('adding words runs', false, e.stack); }
  try {
    const H = new Function('_sp', '_lfE', fn('_spoAddHtml') + '\nreturn _spoAddHtml;');
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const sec = { id: 'gather', title: 'Gather' };
    const empty = H({}, esc)(sec, true), more = H({}, esc)(sec, false), typing = H({ add: { secId: 'gather', text: 'L: Come', busy: false } }, esc)(sec, true);
    const busy = H({ add: { secId: 'gather', text: 'L: Come', busy: true } }, esc)(sec, true), other = H({ add: { secId: 'inv', text: 'x' } }, esc)(sec, true);
    const sorting = H({ reorder: true }, esc)(sec, true);
    check('an empty section is a box to write in ("Nothing in it yet." / Add words); one with parts has Add words under them; neither while sections are reordered',
      /class="spo-addwords"/.test(empty) && /Nothing in it yet\./.test(empty) && /LiturgyModule\.spoAdd\(this\.dataset\.id\)/.test(empty) && /Add words/.test(empty) &&
      /spo-mini--add/.test(more) && !/spo-addwords/.test(more) && /LiturgyModule\.spoAdd/.test(more) &&
      !/spoAdd\(/.test(sorting) && /Nothing in it yet/.test(sorting) && /spo-addwords/.test(other), empty);
    check('...opened, the words typed in place with who speaks and the slide break explained, Cancel and Save; Saving… while it saves',
      /id="spoAddText"/.test(typing) && />L: Come<\/textarea>/.test(typing) && /LiturgyModule\.spoAddInput\(this\.value\)/.test(typing) && /<b>---<\/b>/.test(typing) && /<b>L:<\/b>/.test(typing) &&
      /LiturgyModule\.spoAddCancel\(\)/.test(typing) && /LiturgyModule\.spoAddSave\(\)/.test(typing) && /Saving…/.test(busy) && / disabled/.test(busy), typing);
  } catch (e) { check('the add box draws', false, e.stack); }
  const out21 = fn('_spOutlineHtml');
  check('every section in the outline offers it (not the parts in no section)',
    /\(x\.id \? _spoAddHtml\(x, !ps\.some\(function\(q\) \{ return q\.kind !== 'gone'; \}\)\) : /.test(out21));
  check('Save goes through the Builder like every change on the page, with Undo on its toast; empty words are refused; the words typed survive a failed trip to the Builder',
    /_spEdit\(function\(oid\) \{ return WO\.libAddPart\(oid, a\.secId, slides, name\); \}/.test(fn('spoAddSave')) && /Type some words first/.test(fn('spoAddSave')) &&
    /add: _sp\.occ === occId && _sp\.add \? Object\.assign\(\{\}, _sp\.add, \{ busy: false \}\) : null/.test(fn('openService')) &&
    /libAddPart: _woLibAddPart/.test(SRC) && /spoAddSave: spoAddSave/.test(SRC));

  // ------------------------------------------------------------ 22. This Year; drag; sections and subsections added
  // From the operator (2026-11-16): "I want the 'This Year' liturgy to have
  // its own tab ... 2026 is 'This Year - 2026'" (asked: the year chip is the
  // tab); "Allow the user to drag and drop to reorder the liturgy parts.
  // Also allow to add sections and even subsections" (asked: a subsection is
  // a named part); and each landing card 30px shorter.
  console.log('\n22. This Year; drag to reorder; sections and subsections added');
  try {
    const TY = new Function(fn('_spThisYear') + '\nreturn _spThisYear;')();
    const cal = String(new Date().getFullYear());
    check('This Year is the coming service\'s year, else the calendar\'s',
      TY({ next: { key: '2026-11-29' } }) === '2026' && TY({ next: { key: '2027-01-06|pm' } }) === '2027' && TY({ next: null }) === cal && TY(null) === cal && TY({ next: { key: 'Nov 29' } }) === cal);
  } catch (e) { check('_spThisYear runs', false, e.stack); }
  const res22 = fn('_spResHtml'), tab22 = fn('_spOrderTab');
  check('the year chips are the tabs: This Year first (its year, its letter, a star), open at first; the past years newest first; All years; + Year',
    /'<button type="button" class="sp-year sp-year--this' \+ \(_sp\.year === 'this' \? ' is-on' : ''\) \+ '" data-y="' \+ _lfE\(thisY\) \+ '" onclick="LiturgyModule\.spYear\(\\'this\\'\)"' \+ drop/.test(res22) &&
    /This Year · ' \+ _lfE\(thisY\)/.test(res22) && /filter\(function\(y\) \{ return y !== '—' && y !== thisY; \}\)\.sort\(\)\.reverse\(\)/.test(res22) &&
    res22.indexOf('sp-year--this') < res22.indexOf('ys.map(') && res22.indexOf('ys.map(') < res22.indexOf('All years</button>') && res22.indexOf('All years</button>') < res22.indexOf('sp-year--add') &&
    /year: 'this', from: from \|\| 'services'/.test(fn('openService')) && /_sp\.res = t; _sp\.year = 'this';/.test(fn('spResTab')));
  check('...a year typed as this year is This Year; a year with nothing in it falls back to it',
    /if \(_sp\.year === thisY\) _sp\.year = 'this';/.test(res22) && /if \(_sp\.year && _sp\.year !== 'this' && !years\[_sp\.year\]\) _sp\.year = 'this';/.test(res22) &&
    /var sel = _sp\.year === 'this' \? thisY : _sp\.year;/.test(res22) && /return !sel \|\| \(_spYearOf\(it, occ\.id\) \|\| '—'\) === sel;/.test(res22));
  check('...This Year holds this year\'s liturgy beside that year\'s documents and app files; the other years only their own; no side column',
    /if \(tab === 'liturgy' && _sp\.year === 'this'\) \{\s*body = '<div class="sp-thisyr"><div class="sp-thisyr__main">' \+ _spMakeHtml\(d, orderId\) \+ '<\/div>'/.test(res22) &&
    /if \(tab === 'liturgy'\) body \+= _spReadyHtml\(d, orderId, sel\);/.test(res22) && /return !year \|\| String\(r\.year \|\| '—'\) === year;/.test(fn('_spReadyHtml')) &&
    !/sp-lib__side|sp-lib__main/.test(tab22) && /\.sp-lib \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/.test(SRC) &&
    /@media \(min-width: 1180px\) \{ \.sp-thisyr \{ grid-template-columns: minmax\(0, 1\.2fr\) minmax\(320px, 1fr\); \} \}/.test(SRC));
  // The WO side, run against stand-ins.
  try {
    const log = [];
    const order = { id: 'o', sectionLayout: [{ id: 'a', title: 'Gather' }, { id: 'b', title: 'Confession' }, { id: 'c', title: 'Kyrie' }],
      allItems: [{ id: 'p_liturgy_l1_a', itemType: 'liturgy', sectionId: 'a', sourceId: 'l1', title: 'Gather' }, { id: 'x2', itemType: 'liturgy', sectionId: 'b', sourceId: 'l2', title: 'Confession' },
                 { id: 's1', itemType: 'song', sectionId: 'b' }, { id: 'r1', itemType: 'scripture', sectionId: 'c', title: 'Psalm 23' }, { id: 'x3', itemType: 'liturgy', sectionId: 'c', sourceId: 'l3', title: 'Kyrie' }] };
    let held = false;
    const lid = id => { for (let k = 0; k < order.sectionLayout.length; k++) if (order.sectionLayout[k].id === id) return k; return -1; };
    const env = { _lbdIsActive: () => held, _woLcdInPage: () => false, _lbdPfx: () => 'p_', _lbdUid: () => 'u1', _woStripNum: t => String(t).replace(/^\d+\.\s*/, ''),
      _woSectionList: () => order.sectionLayout.map(x => ({ id: x.id, title: x.title })), _lbdSecIndex: lid,
      _woSectionItems: id => order.allItems.filter(x => x.sectionId === id && x.itemType !== 'song'), _lbdReadingTaken: (id, t) => order.allItems.some(x => x.sectionId === id && x.itemType === 'scripture' && x.title === t),
      _soSaveSettled: () => Promise.resolve(true), _lbdChange: f => { log.push('change'); return f() !== false; },
      _lbdMoveSectionTo: (id, tgt, after) => { const L = order.sectionLayout, f = lid(id), m = L.splice(f, 1)[0], t = lid(tgt); L.splice(after ? t + 1 : t, 0, m); log.push('moveTo ' + id + (after ? ' after ' : ' before ') + tgt); return true; },
      _lbdClearClearedFor: id => log.push('uncleared ' + id), _lbdNoteCleared: (sec, src) => log.push('cleared ' + sec + ' ' + src), _lbdSortSongsByService: () => {},
      _lbdUnplaceSong: () => {}, songOrderSections: [], _woSongSectionIds: () => [], _woUserClearedTypes: {} };
    const keys = Object.keys(env);
    const W = new Function(...keys, 'var currentOrderData = null;' + ['_woLibHeld', '_woLibSection', '_woLibPart', '_woLibSlides', '_woLibSetSlides'].map(fn).join('\n') +
      '\nreturn { sec: _woLibSection, part: _woLibPart, set: _woLibSetSlides, hold: function(o) { currentOrderData = o; } };')(...keys.map(k => env[k]));
    W.hold(order);
    let refused = null;
    await W.part('o', 'x2', 'move', { secId: 'c' }).catch(e => { refused = e; });
    check('every one of them only in the Builder\'s copy (code builder, so the page opens it first)', !!refused && refused.code === 'builder');
    held = true;
    const add = await W.sec('o', 'add', 'a', { title: '  Lighting  of the Wreath ' });
    const top = await W.sec('o', 'add', '', { title: 'Prelude' });
    let noName = null; await W.sec('o', 'add', 'a', { title: ' ' }).catch(e => { noName = e; });
    check('a new section goes after the one asked (or at the top), named as typed, a new id, one Undo each; a section needs a name',
      order.sectionLayout.map(x => x.title).join('|') === 'Prelude|Gather|Lighting of the Wreath|Confession|Kyrie' && /^wo-section-\d+$/.test(add.id) && /^wo-section-\d+$/.test(top.id) && !!noName,
      JSON.stringify(order.sectionLayout));
    const mv = await W.sec('o', 'moveTo', 'c', { before: 'a' }), last = await W.sec('o', 'moveTo', 'a', { before: '' });
    check('a section dragged to a place: before another, or last (after the last one)',
      log.indexOf('moveTo c before a') >= 0 && log.indexOf('moveTo a after b') >= 0 && order.sectionLayout.map(x => x.id).pop() === 'a' && mv.saved && last.saved, log.join(', '));
    log.length = 0;
    const p1 = await W.part('o', 'x3', 'move', { secId: 'c', before: 'r1' });
    check('a part moved within its section, before another part', order.allItems.filter(x => x.sectionId === 'c').map(x => x.id).join() === 'x3,r1' && p1.saved);
    const p2 = await W.part('o', 'x2', 'move', { secId: 'c', before: '' });
    const moved = order.allItems.find(x => x.sourceId === 'l2');
    check('...into another section, last there: its id names its new section, the section it left is noted, the new one let go (the Builder\'s own rules)',
      moved.sectionId === 'c' && moved.id === 'p_liturgy_l2_c' && p2.id === 'p_liturgy_l2_c' && order.allItems.filter(x => x.sectionId === 'c').map(x => x.sourceId || x.id).join() === 'l3,r1,l2' &&
      log.indexOf('cleared b l2') >= 0 && log.indexOf('uncleared c') >= 0, JSON.stringify(order.allItems) + ' ' + log.join(', '));
    const same = await W.part('o', 'r1', 'move', { secId: 'c', before: 'p_liturgy_l2_c' });
    let twice = null; order.allItems.push({ id: 'y9', itemType: 'liturgy', sectionId: 'a', sourceId: 'l2', title: 'Confession' });
    await W.part('o', 'y9', 'move', { secId: 'c' }).catch(e => { twice = e; });
    check('...where it already is, nothing; a liturgy the section already has, refused', !!(same && same.same) && !!twice && /already has/.test(twice.message));
    log.length = 0;
    await W.part('o', 'y9', 'remove');
    check('a part taken out: gone, its section noted as emptied of it, one Undo', !order.allItems.some(x => x.id === 'y9') && log.join() === 'change,cleared a l2');
    order.allItems.find(x => x.id === 'x3').slides = [{ content: 'Lord have mercy', background: 'bg' }];
    await W.set('o', 'x3', ['Lord have mercy', 'Christ have mercy'], null, '  Kyrie  Eleison ');
    const k3 = order.allItems.find(x => x.id === 'x3');
    check('a part\'s name changes with its words, in the same step', k3.title === 'Kyrie Eleison' && k3.slides.length === 2 && k3.slides[0].background === 'bg');
  } catch (e) { check('the WO side runs', false, e.stack); }
  // The page side.
  try {
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const P = new Function('_sp', '_lfE', fn('_spoPartHtml') + '\nreturn _spoPartHtml;');
    const lit = P({}, esc)({ id: 'i1', kind: 'liturgy', title: 'Absolution', slides: ['x'], edit: true });
    const rd = P({}, esc)({ id: 'r1', kind: 'reading', title: 'Psalm 23', slides: [], edit: false });
    const sg = P({}, esc)({ id: 's1', kind: 'song', title: 'O Come', slides: [], edit: false });
    const ed = P({ edit: { id: 'i1', title: 'Absolution', text: 'x', busy: false } }, esc)({ id: 'i1', kind: 'liturgy', title: 'Absolution', slides: ['x'], edit: true });
    const so = P({ reorder: true }, esc)({ id: 'i1', kind: 'liturgy', title: 'Absolution', slides: ['x'], edit: true });
    check('a liturgy part has a grip and a bin; a reading or a song neither; each part says what it is for the drop',
      /class="spo-grip" data-drag="part" data-id="i1"/.test(lit) && /LiturgyModule\.spoPartRemove\(this\.dataset\.id\)/.test(lit) && / data-part="i1" data-kind="liturgy"/.test(lit) &&
      !/spo-grip|spoPartRemove/.test(rd) && !/spo-grip|spoPartRemove/.test(sg) && / data-kind="song"/.test(sg) && !/spo-grip/.test(so));
    check('...its Edit names it too', /id="spoName"[^>]*value="Absolution"/.test(ed) && /LiturgyModule\.spoName\(this\.value\)/.test(ed) && !/spo-grip/.test(ed));
    const A = new Function('_sp', '_lfE', fn('_spoAddHtml') + '\nreturn _spoAddHtml;');
    const sub = A({ add: { secId: 'k', title: '', empty: false, text: '' } }, esc)({ id: 'k', title: 'Kyrie' }, false);
    check('a section with parts takes a subsection: a name of its own, then its words',
      /New subsection/.test(sub) && /id="spoAddName"/.test(sub) && /e\.g\. Absolution/.test(sub) && /LiturgyModule\.spoAddName\(this\.value\)/.test(sub) &&
      /Add subsection<\/span>/.test(A({}, esc)({ id: 'k', title: 'Kyrie' }, false)) && /Add words<\/b>/.test(A({}, esc)({ id: 'k', title: 'Kyrie' }, true)));
    const S = new Function('_sp', '_lfE', fn('_spoSecAddHtml') + '\nreturn _spoSecAddHtml;');
    const form = S({ secAdd: { title: '', after: 'b', busy: false } }, esc)({ secs: [{ id: 'a', title: 'Gather' }, { id: 'b', title: 'Confession' }, { id: '', title: 'Not in a section' }] });
    check('a new section: its name, and where it goes -- at the top or after any section, the one chosen kept',
      /id="spoSecAddName"/.test(form) && /<option value="">At the top<\/option>/.test(form) && /<option value="b" selected>After 2\. Confession<\/option>/.test(form) &&
      !/Not in a section/.test(form) && /LiturgyModule\.spoSecAddSave\(\)/.test(form) && S({}, esc)({ secs: [] }) === '');
  } catch (e) { check('the page side draws', false, e.stack); }
  const out22 = fn('_spOutlineHtml');
  check('the outline: a grip on every section, the sections marked for the drop, + Section in the tools, the form above the list',
    /class="spo-grip" data-drag="sec"/.test(out22) && /' data-sec="' \+ _lfE\(x\.id\) \+ '"'/.test(out22) && /LiturgyModule\.spoSecAdd\(\)/.test(out22) && /\(reorder \? '' : _spoSecAddHtml\(ol\)\)/.test(out22));
  check('drag: a finger on a grip drags and never scrolls; nothing redraws the page under it; a drop is a change in the Builder\'s copy, a drop where it started none',
    /\.spo-grip \{[^}]*touch-action: none;/.test(SRC) && /if \(_spDrag\) return;/.test(fn('renderService')) && /_spDragBind\(p\);/.test(fn('renderService')) &&
    /if \(ids\.join\('\|'\) === D\.ids\.join\('\|'\)\) \{ renderService\(\); return; \}/.test(fn('_spDragUp')) &&
    /WO\.libSection\(oid, 'moveTo', D\.id, \{ before: before \}\)/.test(fn('_spDragUp')) && /WO\.libPart\(oid, D\.id, 'move', \{ secId: secId, before: bef \}\)/.test(fn('_spDragUp')) &&
    /if \(D\.el\.parentNode === D\.parent && D\.el\.nextSibling === D\.next\) \{ renderService\(\); return; \}/.test(fn('_spDragUp')) &&
    /e\.key === 'Escape'/.test(fn('_spDragKey')) && /window\.scrollBy\(0, step\)/.test(fn('_spDragEdge')));
  check('...a closed section takes a part dropped on its row, last; the section held is kept under the finger while the rows close up',
    /hit\.classList\.add\('is-drop'\); D\.target = hit\.getAttribute\('data-sec'\);/.test(fn('_spDragPlace')) && /root\.classList\.add\('is-sorting'\);/.test(fn('_spDragDown')) &&
    /\.spo\.is-sorting \.spo-parts \{ display: none; \}/.test(SRC) && /libPart: _woLibPart/.test(SRC) && /spoPartRemove: spoPartRemove/.test(SRC) && /spoSecAddSave: spoSecAddSave/.test(SRC));

  // ------------------------------------------------------------ 23. a phone's layout A
  // From the operator (2026-11-16), on a phone screenshot: "this layout looks
  // really busy especially for the mobile version"; of three sketches they
  // chose A, "fewer boxes", and: "Remove the most bottom section text. Just
  // say no documents uploaded (PDF, Word, Google Docs, etc.)".
  console.log('\n23. A phone\'s layout A: fewer boxes');
  const res23 = fn('_spResHtml'), use23 = fn('_spInUseHtml');
  check('one Add on a phone (Upload a liturgy, a Google Doc, a year folder), the desk\'s two buttons beside it hidden there',
    /class="lf-btn sp-btn-sm sp-addm" onclick="LiturgyModule\.spAddDocs\(this\)"/.test(res23) && (SRC.match(/^  function spAddDocs\(/gm) || []).length === 1 &&
    /'up', 'fa-solid fa-file-arrow-up', 'Upload a liturgy \(PDF, Word, Excel\)'/.test(fn('spAddDocs')) && /'gdoc', 'fa-brands fa-google-drive', 'Add a Google Doc'/.test(fn('spAddDocs')) &&
    /if \(act === 'up'\) spUpload\('liturgy'\); else if \(act === 'gdoc'\) spAddGdoc\(\); else if \(act === 'year'\) spNewYear\(\);/.test(fn('spAddDocsAct')) &&
    /#liturgyServicePanel \.sp-res__adds, #liturgyServicePanel \.sp-rtabs \{ display: none; \}/.test(SRC) && /\.sp-addm, \.sp-rsel, \.spi-c, \.spi-c__acts \{ display: none; \}/.test(SRC));
  check('...the kind of file a dropdown at the head of the year chips (and alone for LCD), with each kind\'s count; the year chips one scrolling line',
    /<select class="sp-rsel" aria-label="Which files" onchange="LiturgyModule\.spResTab\(this\.value\)">/.test(res23) && /\(t\[0\] === tab \? ' selected' : ''\)/.test(res23) &&
    /' \(' \+ groups\[t\[0\]\]\.length \+ '\)<\/option>'/.test(res23) && /var chips = '<div class="sp-years">' \+ rsel \+/.test(res23) &&
    /body = '<div class="sp-years sp-years--sel">' \+ rsel \+ '<\/div>' \+ \(list\.length/.test(res23) &&
    /#liturgyServicePanel \.sp-years \{ flex-wrap: nowrap; overflow-x: auto;/.test(SRC));
  check('...the library box itself no box on a phone; this year\'s liturgy one card: the day on its tile, where it came from on one line (Original goes to the file), Show liturgy, the Builder and a menu',
    /#liturgyServicePanel \.sp-res\.ll-box \{ background: transparent; border: 0; box-shadow: none; padding: 0;/.test(SRC) &&
    /'<div class="spi-c__day">' \+ _spDateTile\(next\.key\)/.test(use23) && /\(used \? srcs : '<p class="spi-c__from">/.test(use23) &&
    /class="lf-btn pl-btn-green spi-c__show"/.test(use23) && /LiturgyModule\.spEdit\(\)" title="Open in the Liturgy Builder"/.test(use23) && /LiturgyModule\.spoMore\(this\)/.test(use23) &&
    /#liturgyServicePanel \.sp-make--use \.pl-card__hd, #liturgyServicePanel \.sp-make--use \.spi-flow,\s*#liturgyServicePanel \.sp-make--use \.spi-acts, #liturgyServicePanel \.sp-make--use \.spi-more \{ display: none; \}/.test(SRC) &&
    /flow \+ ctop \+ _spDiffHtml\(cmp\) \+ cacts \+ olBox \+ acts \+ change/.test(use23) && /#liturgyServicePanel \.spi-c__acts \.lf-btn \{ width: auto;/.test(SRC));
  try {
    let html = '';
    const doc = { getElementById: () => null };
    const M = new Function('document', '_spData', '_spOrderOutline', '_spFloat', '_spFloatClose', '_lfE', fn('spoMore') + '\nreturn spoMore;');
    const mk = (tpl, hasOl) => { html = ''; M(doc, { order: { id: 'o' }, orderTpl: tpl }, () => hasOl ? { secs: [] } : null, (b, id, h) => { html = h; }, () => {}, t => t)({}); return html; };
    const a = mk({ serviceLiturgy: { id: 'f1', title: 'Advent' } }, true), b = mk({ serviceLiturgy: { fromOrder: 'x' } }, true), c = mk({}, false);
    check('...its menu: the PDF and sharing it, the original file, another liturgy, and Remove (in red) -- each only where it applies',
      /data-act="pdf"/.test(a) && /data-act="share"/.test(a) && /data-act="orig"/.test(a) && /Change or blend the liturgy/.test(a) && /class="is-danger" data-act="rm"/.test(a) &&
      !/data-act="orig"/.test(b) && /data-act="rm"/.test(b) && !/data-act="pdf"|data-act="rm"/.test(c) && /Choose a Liturgy App File/.test(c));
    check('...and each does what the desk\'s button does',
      /if \(act === 'pdf'\) spoPdf\(false\); else if \(act === 'share'\) spoPdf\(true\);\s*else if \(act === 'orig'\) spoGoOrig\(\); else if \(act === 'change'\) spoChange\(\); else if \(act === 'rm'\) spoRemove\(\);/.test(fn('spoMoreAct')) &&
      /spoMore: spoMore, spoMoreAct: spoMoreAct/.test(SRC));
  } catch (e) { check('the menu draws', false, e.stack); }
  check('a year with nothing uploaded says only "No documents uploaded (PDF, Word, Google Docs, etc.)", with no heading over it',
    /: 'No documents uploaded \(PDF, Word, Google Docs, etc\.\)'\) \+ '<\/p>'/.test(res23) && !/Past years’ are under their years above/.test(res23) &&
    /'<div class="sp-thisyr__docs">' \+ \(shown\.length \? '<h3 class="sp-thisyr__h">/.test(res23));

  // ------------------------------------------------------------ 24. the chooser, and a blend section by section
  // From the operator (2026-11-16): "I have a few concerns about knowing
  // which liturgy to use or how can the user unuse the currently selected
  // liturgy ... or how can the user use a blend of 2 or more". Of the
  // sketches they chose the chooser and a blend made section by section.
  console.log('\n24. The chooser; a blend section by section');
  try {
    const G = new Function('_llForSunday', fn('_spPickGroups') + '\nreturn _spPickGroups;')(new Function(fn('_llForSunday') + '\nreturn _llForSunday;')());
    const rows = [{ id: 'old', year: '2023', title: 'Advent liturgy', data: {} }, { id: 'a3', year: '2025', title: 'Advent 3', data: { forDays: ['advent:3'] } },
                  { id: 'a1', year: '2025', title: 'No Communion', data: { forDays: ['advent:1', 'advent:3'] } }, { id: 'all', year: '2025', title: 'Every Sunday', data: { forDays: [] } }];
    const g = G(rows, 'advent:1');
    check('the chooser: those that suit this Sunday first (ticked for it, then every Sunday, the newest year first), then those made for other Sundays',
      g.suit.map(r => r.id).join() === 'a1,all,old' && g.other.map(r => r.id).join() === 'a3' && G(rows, '').suit.length === 4, JSON.stringify(g));
  } catch (e) { check('the chooser\'s groups run', false, e.stack); }
  const use24 = fn('_spInUseHtml'), pick24 = fn('_spPickDraw');
  check('...opened by Change on the card -- a phone\'s on the day\'s row, a desk\'s under Go to file -- and by "Change or blend the liturgy" in the menu and the desk\'s Use another',
    /class="spi-c__chg" onclick="LiturgyModule\.spoPick\(\)"/.test(use24) && /class="spi-golink spi-chg" onclick="LiturgyModule\.spoPick\(\)"/.test(use24) &&
    /function spoChange\(\) \{ _sp\.change = false; spoPick\(\); \}/.test(SRC) && /used \? 'Change or blend the liturgy' : 'Choose a Liturgy App File'/.test(fn('spoMore')));
  check('...each file with its year, Sundays and kind, the one in use marked, Preview, and Use this for the others (the Use window, on this date); Stop using opens Remove, which shows what changes first',
    />Made for this Sunday</.test(pick24) && />Made for other Sundays</.test(pick24) && /<span class="spk-pill">In use<\/span>/.test(pick24) &&
    /LiturgyModule\.spPreviewReady\(this\.dataset\.id\)/.test(pick24) && /\(on \? '' : '<button[^>]*onclick="LiturgyModule\.spoPickUse\(this\.dataset\.id\)/.test(pick24) &&
    /spoPickClose\(\); if \(key\) spUse\(id, key\);/.test(fn('spoPickUse')) && /spoPickClose\(\); spoRemove\(\);/.test(fn('spoPickStop')) &&
    /\(used \? '<button type="button" class="spk-foot spk-foot--stop" onclick="LiturgyModule\.spoPickStop\(\)">/.test(pick24));
  check('...Blend only when there is another liturgy to take from; else how to have one',
    /rows\.some\(function\(r\) \{ return r\.id !== usedId; \}\)/.test(pick24) && /LiturgyModule\.spoBlend\(\)/.test(pick24) && /To blend, convert another year’s liturgy document first/.test(pick24));
  try {
    const K = new Function(fn('_spBlKey') + '\nreturn _spBlKey;')();
    const M = new Function('_spBlKey', fn('_spBlendModel') + '\nreturn _spBlendModel;')(K);
    const P = new Function(fn('_spBlendPlan') + '\nreturn _spBlendPlan;')();
    const lit = (id, sec, t) => ({ id, itemType: 'liturgy', sectionId: sec, sourceId: 'doc_' + id, title: t, slides: [{ content: t + ' words' }] });
    const secs = [{ id: 's1', title: 'Gather' }, { id: 's2', title: 'Confession' }, { id: 's3', title: 'Kyrie' }, { id: '', title: 'Not in a section' }];
    const rows = [
      { id: 'A', title: 'No Communion', year: '2025', data: { sectionLayout: [{ id: 'a1', title: 'Confession' }, { id: 'a2', title: 'Kyrie' }], items: [lit('1', 'a1', 'Confession'), lit('2', 'a2', 'Kyrie')] } },
      { id: 'B', title: 'Advent liturgy', year: '2023', data: { sectionLayout: [{ id: 'b1', title: '2. CONFESSION & Absolution' }, { id: 'b0', title: '3. Confession' }, { id: 'b2', title: 'Advent Wreath' }, { id: 'b3', title: 'Kyrie' }, { id: 'b4', title: 'Readings' }],
        items: [lit('3', 'b0', 'Confession B'), lit('4', 'b2', 'Wreath'), { id: 'r', itemType: 'scripture', sectionId: 'b4', title: 'Isaiah 64' }, { id: 'sg', itemType: 'song', sectionId: 'b3' }] } }];
    const m = M(secs, rows, 'A');
    const conf = m.secs.find(c => c.id === 's2'), ky = m.secs.find(c => c.id === 's3'), ga = m.secs.find(c => c.id === 's1');
    check('the blend: a section\'s choices are the files with a section of the same name that has words (numbers, case and punctuation aside); a file\'s own section of no words, readings or songs alone, is none',
      K('3. Confession') === 'confession' && K('CONFESSION & Absolution') === 'confession and absolution' &&
      conf.opts.map(o => o.row + ':' + o.sec + (o.inUse ? '*' : '')).join() === 'A:a1*,B:b0' && ky.opts.map(o => o.row).join() === 'A' && !ga.opts.length && m.secs.length === 3,
      JSON.stringify(m.secs.map(c => [c.id, c.opts.map(o => o.row + ':' + o.sec)])));
    check('...the sections only another has, after the nearest section before them that this service has',
      m.extra.length === 1 && m.extra[0].title === 'Advent Wreath' && m.extra[0].opts[0].after === 's2' && m.extra[0].opts[0].row === 'B', JSON.stringify(m.extra));
    const plan = P(m, { s2: 'B|b0', s3: 'A|a2' }, { 'advent wreath': 'B|b2' });
    check('...the plan: each section chosen (its words from that file), each extra section ticked (after its place), and the files taken from -- not the one in use',
      plan.replace.length === 2 && plan.replace[0].secId === 's2' && plan.replace[0].items[0].title === 'Confession B' && plan.add.length === 1 && plan.add[0].after === 's2' &&
      plan.add[0].title === 'Advent Wreath' && plan.from.map(f => f.id).join() === 'B' && P(m, {}, {}).replace.length === 0, JSON.stringify(plan));
  } catch (e) { check('the blend\'s model runs', false, e.stack); }
  try {
    const log = [];
    const order = { id: 'o', template: { serviceLiturgy: { id: 'A', title: 'No Communion', use: { made: true } } },
      sectionLayout: [{ id: 's1', title: 'Gather' }, { id: 's2', title: 'Confession' }, { id: 's3', title: 'Kyrie' }],
      allItems: [{ id: 'x1', itemType: 'liturgy', sectionId: 's2', sourceId: 'doc_1', title: 'Confession' }, { id: 'rd', itemType: 'scripture', sectionId: 's2', title: 'Psalm 51' },
                 { id: 'tx', itemType: 'content', sectionId: 's2', content: { text: 'note' } }, { id: 'x2', itemType: 'liturgy', sectionId: 's3', sourceId: 'doc_2', title: 'Kyrie' }] };
    let held = false, uid = 0;
    const lid = id => { for (let k = 0; k < order.sectionLayout.length; k++) if (order.sectionLayout[k].id === id) return k; return -1; };
    const env = { _lbdIsActive: () => held, _woLcdInPage: () => false, _lbdPfx: () => 'o__', _lbdUid: () => 'u' + (++uid),
      _woSectionList: () => order.sectionLayout.map(x => ({ id: x.id, title: x.title })), _lbdSecIndex: lid,
      _soSaveSettled: () => Promise.resolve(true), _lbdChange: f => { log.push('change'); return f() !== false; },
      _lbdClearClearedFor: id => log.push('uncleared ' + id), _lbdNoteCleared: (sec, src) => log.push('cleared ' + sec + ' ' + src), _lbdSortSongsByService: () => {} };
    const keys = Object.keys(env);
    const W = new Function(...keys, 'var currentOrderData = null;' + ['_woLibHeld', '_woLibBlend'].map(fn).join('\n') +
      '\nreturn { blend: _woLibBlend, hold: function(o) { currentOrderData = o; } };')(...keys.map(k => env[k]));
    W.hold(order);
    let refused = null;
    await W.blend('o', { replace: [{ secId: 's2', items: [] }] }).catch(e => { refused = e; });
    held = true;
    const none = await W.blend('o', {}), logNone = log.length;
    const res = await W.blend('o', {
      replace: [{ secId: 's2', items: [{ id: 'b0', itemType: 'liturgy', sectionId: 'b0', sourceId: 'doc_1', title: 'Confession B', slides: [{ content: 'We confess B' }] }, { id: 'rr', itemType: 'scripture', sectionId: 'b0' }] }],
      add: [{ after: 's2', title: ' Advent  Wreath ', items: [{ id: 'b2', itemType: 'liturgy', sectionId: 'b2', sourceId: 'doc_4', title: 'Wreath', slides: [] }] }],
      from: [{ id: 'B', title: 'Advent liturgy', year: '2023' }, { id: 'A', title: 'No Communion' }] });
    const s2 = order.allItems.filter(x => x.sectionId === 's2'), nw = order.sectionLayout[2];
    const wreath = order.allItems.find(x => x.sectionId === nw.id);
    check('a blend only in the Builder\'s copy (code builder); nothing chosen is nothing done', !!refused && refused.code === 'builder' && none.same === true && logNone === 1);
    check('...a section chosen: its liturgy and texts out (its section noted as emptied of them), the other file\'s liturgy in their place as this order\'s own (a new source id), its reading kept, no reading brought in',
      s2.map(x => x.itemType + ':' + (x.title || '')).join() === 'liturgy:Confession B,scripture:Psalm 51' && /^lbd_u\d+$/.test(s2[0].sourceId) && s2[0].id === 'o__liturgy_' + s2[0].sourceId + '_s2' &&
      log.indexOf('cleared s2 doc_1') >= 0 && log.indexOf('uncleared s2') >= 0 && order.allItems.some(x => x.id === 'x2'), JSON.stringify(order.allItems) + ' ' + log.join());
    check('...a section only another has: added after the one asked, named, its words copied in as this order\'s own',
      order.sectionLayout.map(x => x.title).join() === 'Gather,Confession,Advent Wreath,Kyrie' && /^wo-section-\d+$/.test(nw.id) && wreath && /^lbd_/.test(wreath.sourceId) && wreath.title === 'Wreath');
    check('...one Undo for all of it; the files taken from noted beside the liturgy it came from (not that one), its Use record kept',
      log.filter(l => l === 'change').length === 2 && res.n === 2 && order.template.serviceLiturgy.blend.map(f => f.id).join() === 'B' && order.template.serviceLiturgy.use.made === true && order.template.serviceLiturgy.id === 'A');
  } catch (e) { check('the blend runs', false, e.stack); }
  check('Reset to original lets go of the blend\'s note; the in-use card says what it was blended with',
    /WO\.libRestore\(oid, Object\.assign\(\{ unblend: true \}, plan\)\)/.test(fn('spoPutAll')) && /if \(plan\.unblend && svlR && \(Array\.isArray\(svlR\.blend\) \|\| svlR\.blendMap\)\)/.test(fn('_woLibRestore')) &&
    /delete tplR\.serviceLiturgy\.blend; delete tplR\.serviceLiturgy\.blendMap;/.test(fn('_woLibRestore')) && /libBlend: _woLibBlend/.test(SRC) && /spoBlendGo: spoBlendGo/.test(SRC));
  check('the blend window: a dropdown per section ("As it is" first), "Only this one" where there is no other, the extra sections ticked in, a choice never redrawing the window, Blend n sections',
    /'<option value="">As it is<\/option>'/.test(fn('_spBlendDraw')) && /Only this one/.test(fn('_spBlendDraw')) && /Sections only another liturgy has/.test(fn('_spBlendDraw')) &&
    /if \(bodyNow && scrollWas\) bodyNow\.scrollTop = scrollWas;/.test(fn('_spBlendDraw')) && /WO\.libBlend\(oid, plan\)/.test(fn('spoBlendGo')) &&
    /Choose another liturgy for a section, tick a section to add, or drag them into a new order first/.test(fn('spoBlendGo')));

  // ------------------------------------------------------------ 25. Use comes back; the parts to add; sources; the blend's sources and order
  // From the operator (2026-11-16): "when using a liturgy, it will direct the
  // user to the liturgy builder. Don't do that, rather direct them to the
  // This Year page"; the parts to add "list in order and allow to expand and
  // collapse each"; "a section called sources ... clicking on the badge link
  // will directly open the preview window"; and on the blend page "a badge
  // that shows the source ... double clicking on the badge will open the
  // preview ... expand and collapse ... drag to reorder. Once hit blend, the
  // new draft of the liturgy will be created".
  console.log('\n25. Use comes back; the parts to add; sources; the blend\'s sources and order');
  check('Use puts the liturgy in through the Builder and comes straight back to This Year, once its readings are in; the window says so',
    /WO\.svlUseFromLibrary\(\{ id: f\.id,[\s\S]*?\}\) : null;\s*Promise\.race\(\[Promise\.resolve\(r\), new Promise\(function\(res\) \{ setTimeout\(res, 15000\); \}\)\]\)\.then\(function\(\) \{ llBackToLib\(\); \}\);/.test(fn('spUseGo')) &&
    /return _lbdFillReadings\(\{ quiet: true \}\)\.then\(function\(n\) \{/.test(fn('_svlApply')) && /if \(readings\) \{ showToast\(said, 'success', _woUndoOpts\(\)\); return Promise\.resolve\(true\); \}/.test(fn('_svlApply')) &&
    /Then you are back here, on This Year, with the liturgy in it to read and change\./.test(fn('_spUseStep4')) && !/The Liturgy Builder opens on it after/.test(fn('_spUseStep4')));
  check('...the parts to add: one list in a Traditional service\'s order, each opening in place to the words it brings; a tick keeps the window\'s place',
    /st\.extras\.slice\(\)\.sort\(function\(a, b\) \{ return a\.i - b\.i; \}\)/.test(fn('_spUseStep3')) && /LiturgyModule\.spUseOpen\(\+this\.dataset\.i, this\)/.test(fn('_spUseStep3')) &&
    /'<div class="spu-xrow__words"' \+ \(op \? '' : ' hidden'\) \+ '>' \+ _spUseWordsHtml\(x\)/.test(fn('_spUseStep3')) && /\.spu-extras \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/.test(SRC) &&
    /if \(box\) box\.hidden = !on;/.test(fn('spUseOpen')) && /if \(bodyNow && scrollWas\) bodyNow\.scrollTop = scrollWas;/.test(fn('_spUseDraw')));
  try {
    const LM = { getAssignedLiturgyForSection: (type, sec) => sec === 'communion' ? [{ title: 'Pre-Communion', content: 'P: The Lord be with you.\nC: And also with you.\n═════\nP: Lift up your hearts.' }, { title: 'Contemporary only', serviceType: 'contemporary', content: 'x' }] : [] };
    const UW = new Function('LiturgyModule', '_lfE', fn('_spSlidesOf') + '\n' + fn('_spUseLits') + '\n' + fn('_spUseWordsHtml') + '\nreturn _spUseWordsHtml;')(LM, t => String(t));
    const hc = UW({ lit: 'communion', kind: '' }), so = UW({ lit: '', kind: 'songs' });
    check('...a part\'s words: its library liturgy, slide by slide (a Contemporary one left out); a place for songs says nothing comes with it',
      /<b>Pre-Communion<\/b>/.test(hc) && (hc.match(/<p>/g) || []).length === 2 && /And also with you/.test(hc) && !/Contemporary only/.test(hc) && /A place for its songs: nothing comes with it\./.test(so), hc);
  } catch (e) { check('the parts\' words draw', false, e.stack); }
  try {
    const SH = new Function('_lfE', '_llYearText', fn('_spSourcesHtml') + '\nreturn _spSourcesHtml;')(t => String(t), (o, y) => y + ' · Year A');
    const one = SH({ id: 'f1', title: 'No Communion', year: 2025, occasion: 'advent' }, 'advent');
    const two = SH({ id: 'f1', title: 'No Communion', year: 2025, blend: [{ id: 'f2', title: 'Advent liturgy', year: 2023 }, { title: 'no id' }] }, 'advent');
    const past = SH({ fromOrder: 'o9', title: 'Service 1 Dec 2025' }, 'advent');
    check('Sources on the card: how many, the original starred, each a badge opening its preview; a past service a badge to read',
      /Sources <b>1<\/b>/.test(one) && /class="spi-srcb is-orig" data-id="f1" onclick="LiturgyModule\.spoSrc\(this\.dataset\.id\)"/.test(one) && /<em>Original<\/em>/.test(one) &&
      /Sources <b>2<\/b>/.test(two) && /data-id="f2"/.test(two) && !/no id/.test(two) && /class="spi-srcb is-orig is-past"/.test(past) && SH(null, 'a') === '', two);
  } catch (e) { check('the sources draw', false, e.stack); }
  check('...a badge opens the document the file came from (PDF, Word, Google Doc), else the app file; never the folder',
    /var m = \/\^doc:\(\.\+\)\$\/\.exec\(String\(\(r && r\.made_from\) \|\| ''\)\), doc = m \? getItem\(m\[1\]\) : null;\s*if \(doc\) \{ lfOpen\(doc\.id\); return; \}/.test(fn('spoSrc')) &&
    /if \(r\) \{ _spSvlRowIn\(r\); lfOpen\(id, true\); return; \}/.test(fn('spoSrc')) && !/spoGoOrig/.test(fn('spoSrc')) &&
    /Open its document<\/span>/.test(fn('lfOpen')));
  try {
    const K = new Function(fn('_spBlKey') + '\nreturn _spBlKey;')();
    const M = new Function('_spBlKey', fn('_spBlendModel') + '\nreturn _spBlendModel;')(K);
    const P = new Function(fn('_spBlendPlan') + '\nreturn _spBlendPlan;')();
    const lit = (id, sec, t) => ({ id, itemType: 'liturgy', sectionId: sec, sourceId: 'doc_' + id, title: t, slides: [{ content: t }] });
    const secs = [{ id: 's1', title: 'Gather', parts: [] }, { id: 's2', title: 'Confession', parts: [{ id: 'p', kind: 'liturgy', title: 'Confession', slides: ['We confess'] }, { id: 'r', kind: 'reading', title: 'Ps 51' }] }, { id: 's3', title: 'Kyrie', parts: [] }];
    const rows = [{ id: 'A', title: 'No Communion', year: '2025', data: { sectionLayout: [{ id: 'a1', title: 'Confession' }, { id: 'a2', title: 'Kyrie' }], items: [lit('1', 'a1', 'Confession'), lit('2', 'a2', 'Kyrie')] } },
                  { id: 'B', title: 'Advent', year: '2023', data: { sectionLayout: [{ id: 'b1', title: 'Kyrie' }, { id: 'b2', title: 'Wreath' }], items: [lit('3', 'b1', 'Kyrie B'), lit('4', 'b2', 'Wreath')] } }];
    const m = M(secs, rows, 'A', { s3: { row: 'B', title: 'Advent', year: '2023', secTitle: 'Kyrie' } });
    const by = id => m.secs.find(c => c.id === id);
    check('the blend\'s source badges: a blended section its file, a section the file in use has that file (starred), one only this service has none; the words as it is, readings left out',
      by('s3').src.row === 'B' && by('s3').src.secTitle === 'Kyrie' && by('s2').src.row === 'A' && by('s2').src.orig === true && by('s1').src === null &&
      by('s2').parts.length === 1 && by('s2').parts[0].kind === 'liturgy' && by('s2').opts[0].secTitle === 'Confession', JSON.stringify(m.secs.map(c => [c.id, c.src])));
    const plan = P(m, { s3: 'B|b1' }, { wreath: 'B|b2' }, ['s3', 's2', 'x:wreath', 's1']);
    const same = P(m, {}, {}, ['s1', 's2', 's3']);
    check('...the draft\'s order goes with the plan (a new section by "x:<name>") only when it differs, and where each section\'s words came from',
      plan.order.join() === 's3,s2,x:wreath,s1' && !same.order && plan.add[0].key === 'wreath' && plan.map.s3.row === 'B' && plan.replace[0].secId === 's3' && plan.map['x:wreath'].secTitle === 'Wreath', JSON.stringify(plan));
  } catch (e) { check('the blend\'s sources and order run', false, e.stack); }
  try {
    const log = [];
    const order = { id: 'o', template: { serviceLiturgy: { id: 'A', title: 'No Communion', blendMap: { s9: { row: 'Z' } } } },
      sectionLayout: [{ id: 's1', title: 'Gather' }, { id: 's2', title: 'Confession' }, { id: 's3', title: 'Kyrie' }], allItems: [] };
    let uid = 0;
    const lid = id => { for (let k = 0; k < order.sectionLayout.length; k++) if (order.sectionLayout[k].id === id) return k; return -1; };
    const env = { _lbdIsActive: () => true, _woLcdInPage: () => false, _lbdPfx: () => 'o__', _lbdUid: () => 'u' + (++uid),
      _woSectionList: () => order.sectionLayout.map(x => ({ id: x.id, title: x.title })), _lbdSecIndex: lid,
      _soSaveSettled: () => Promise.resolve(true), _lbdChange: f => { log.push('change'); return f() !== false; },
      _lbdClearClearedFor: () => {}, _lbdNoteCleared: () => {}, _lbdSortSongsByService: () => log.push('sort') };
    const keys = Object.keys(env);
    const W = new Function(...keys, 'var currentOrderData = null;' + ['_woLibHeld', '_woLibBlend'].map(fn).join('\n') +
      '\nreturn { blend: _woLibBlend, hold: function(o) { currentOrderData = o; } };')(...keys.map(k => env[k]));
    W.hold(order);
    const res = await W.blend('o', { add: [{ key: 'wreath', after: 's2', title: 'Wreath', items: [] }], order: ['s3', 's2', 'x:wreath', 's1'],
      map: { s2: { row: 'B', title: 'Advent', secTitle: 'Confession' }, 'x:wreath': { row: 'B', title: 'Advent', secTitle: 'Wreath' } }, from: [{ id: 'B', title: 'Advent' }] });
    const wr = order.sectionLayout.find(x => x.title === 'Wreath'), bm = order.template.serviceLiturgy.blendMap;
    check('a blend makes the draft: its sections in the order dragged (the new one where it was put), one Undo; where each came from noted by the section\'s id here',
      order.sectionLayout.map(x => x.title).join() === 'Kyrie,Confession,Wreath,Gather' && log.filter(l => l === 'change').length === 1 && res.n === 2 &&
      bm.s2.row === 'B' && bm[wr.id].secTitle === 'Wreath' && bm.s9.row === 'Z' && !Object.keys(bm).some(k => /^x:/.test(k)), JSON.stringify(order.sectionLayout) + JSON.stringify(bm));
    log.length = 0;
    const only = await W.blend('o', { order: ['s1', 's2'] });
    check('...a new order alone is a blend too', only.n === 1 && order.sectionLayout.map(x => x.title).join() === 'Gather,Confession,Kyrie,Wreath', JSON.stringify(order.sectionLayout));
  } catch (e) { check('the draft runs', false, e.stack); }
  const bd25 = fn('_spBlendDraw');
  check('the blend window: each row its grip, its number, a heading that opens its words, its source badge and its choice; a section only another has, ticked, joins the list as New with a way out',
    /class="spo-grip spb-grip" data-tok="/.test(bd25) && /LiturgyModule\.spoBlendOpen\(this\.dataset\.tok\)/.test(bd25) && /'<div class="spb-words">' \+ words \+ '<\/div>'/.test(bd25) &&
    /onclick="LiturgyModule\.spoBlendSrc\(this\)" title="Double-tap to preview it, at this section"/.test(bd25) && /<em class="spb-new">New<\/em>/.test(bd25) &&
    /LiturgyModule\.spoBlendAdd\(this\.dataset\.key, false\)/.test(bd25) && /b\.order\.splice\(aft === -1 \? b\.order\.length : aft \+ 1, 0, tk\)/.test(fn('spoBlendAdd')) && /_spBlDragBind\(el\);/.test(bd25));
  check('...a double tap on a badge opens that liturgy\'s preview at the section, lit and its words open; a drag reorders the draft; Blend counts every change',
    /again = _spBlTap\.el === btn && now - _spBlTap\.at < 450/.test(fn('spoBlendSrc')) && /_spOpenSvlAt\(btn\.getAttribute\('data-row'\), btn\.getAttribute\('data-sec'\)\)/.test(fn('spoBlendSrc')) &&
    /li\.classList\.add\('is-hit'\);/.test(fn('_spOpenSvlAt')) && /if \(first\) first\.click\(\);/.test(fn('_spOpenSvlAt')) &&
    /if \(!cancel && _spBl && toks\.join\('\|'\) !== _spBl\.order\.join\('\|'\)\) \{ _spBl\.order = toks; _spBl\.moved = true; \}/.test(fn('_spBlDragBind')) &&
    /return p\.replace\.length \+ p\.add\.length \+ \(p\.order && b\.moved \? 1 : 0\);/.test(fn('_spBlendCount')) && /This is the new draft of this year’s liturgy/.test(fn('spoBlendGo')));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
})();
