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
        '_spUseState', '_spUseReads', '_spUseStep1', '_spUseStep2', '_spUseBrings', '_spUseStep3', '_spUseStep4', '_spUseDraw', 'spUseStep', 'spUseDate', 'spUseFile', 'spUseReadsFrom',
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
          svlUseFromLibrary: (row, o) => log.push('apply ' + row.id + ' songs=' + o.songs + ' extras=' + o.extras.join('+')) } },
        LiturgyModule: { getAssignedLiturgyForSection: (t, sec) => sec === 'kyrie' ? [{ id: 'k1', title: 'Kyrie (sung)' }] : sec === 'sanctus' ? [{ id: 's1', title: 'Sanctus' }, { id: 's2', title: 'Words of Institution' }] : [] },
        _sp: { occ: 'advent' }, _readingRefsByDate: {},
        getItem: id => ({ d1: { id: 'd1', title: 'Advent liturgy' } })[id] || null,
        showToast: (m) => log.push('toast ' + m), _llOpenInBuilder: (id, then) => { log.push('open ' + id); then && then(); },
        openService: occ => log.push('service ' + occ), _spLoad: () => Promise.resolve(), lfOpenDay: k => log.push('readings ' + k),
        spConvert: (id, o) => log.push('convert ' + id + ' ' + JSON.stringify(o)), spPreviewReady: id => log.push('preview ' + id),
        spSundays: id => log.push('sundays ' + id), spDeleteReady: id => log.push('delete ' + id),
        _spFloat: (btn, id, html, forId) => { const m = mkEl(); m.id = id; m.innerHTML = html; m.attrs['data-for'] = forId; els[id] = m; }, _spFloatClose: id => { delete els[id]; },
        _lfShortDate: k => k.slice(5, 10), _lfLongDate: k => 'long ' + k, _lfWhen: v => 'on ' + String(v).slice(0, 10),
        SBQ_READINGS: { SLOTS: [{ role: 'reading1' }, { role: 'psalm' }, { role: 'reading2' }, { role: 'gospel' }],
          getRange: (a, b) => { log.push('reads ' + a + '..' + b); return Promise.resolve(JSON.parse(JSON.stringify(roster))); },
          setReference: (iso, idx, ref) => { const role = ['reading1', 'psalm', 'reading2', 'gospel'][idx]; log.push('roster ' + iso + ' ' + role + ' ' + ref);
            roster[iso] = Object.assign({}, roster[iso] || {}, { [role]: ref }); return Promise.resolve(ref); },
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
        ran.join(' | ') === 'roster 2026-12-06 gospel Mark 1:1-8 | kind 2026-12-06 Special | make 2026-12-06 special | toast long 2026-12-06 is a Special service now. Opening its order… | open new-2026-12-06 | apply trad songs=true extras=1+4+5+6',
        ran.join(' | '));
      U.use('trad', '2026-12-13'); await tick(); U.step(4);
      check('...a Contemporary date with its order made: Special now, its order takes the liturgy (Undo)', /it is Contemporary now/.test(html()) && /Its order takes this liturgy in place of what it has/.test(html()));
      U.from('roster'); U.songs(false);
      const n1 = log.length; U.go(); for (let i = 0; i < 8; i++) await tick();
      const ran1 = log.slice(n1).filter(l => !/^reads /.test(l) && !/^toast /.test(l));
      check('...its own order kept, nothing made; the Roster\'s readings kept; without its songs', ran1.join(' | ') === 'kind 2026-12-13 Special | open o13 | apply trad songs=false extras=', ran1.join(' | '));
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
  check('...each 20px shorter (measured: 167 to 147px at 480px wide, 337 to 318px on a desk), the titles on one line, the bands level',
    /\.ll-card__top \{ display: flex; align-items: center; gap: 12px; padding: 16px 22px 20px; min-height: 108px;/.test(SRC) && /\.ll-card__go \{ align-self: center; margin: 8px 0 12px;/.test(SRC) &&
    /\.ll-card__icon \{ font-size: 2rem; opacity: 0\.95; width: 40px; flex-shrink: 0;/.test(SRC) && /\.ll-card__top h2 \{ margin: 0; font-size: 1\.2rem;/.test(SRC) &&
    /\.ll-card__top \{ padding: 10px 16px 16px; min-height: 0; \}/.test(SRC) && /\.ll-card__top \{ padding-bottom: 10px; min-height: 79px; \}/.test(SRC) &&
    /\.ll-card__top h2 \{ font-size: 1\.2rem; \}\s*\.ll-card__top p \{ font-size: 0\.86rem; \}/.test(SRC) && /\.ll-card__go \{ margin: 8px 16px 12px;/.test(SRC));
  const svc13 = fn('renderServices'), grid13 = fn('_lsGridHtml');
  check('Services: the cards first, the counts and the library\'s buttons at the foot in one line; no All Services / Favourites chips',
    /_lsGridHtml\(\) \+[\s\S]*foot \+\s*'<\/div>';/.test(svc13) && svc13.indexOf("'<div class=\"ls-bar ls-bar--foot\">'") !== -1 &&
    !/LiturgyModule\.lsSet\(\\'fav\\'/.test(svc13) && !/ls-chips/.test(svc13) && /service collections<\/b>/.test(svc13));
  check('...a starred service is listed first instead', /var shown = _lsFavFirst\(_lsFilter\(/.test(grid13) && (() => {
    try { const f = new Function(fn('_lsFavFirst') + '\nreturn _lsFavFirst;')(); return f([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c']).map(o => o.id).join() === 'c,a,b' && f([{ id: 'a' }], null).length === 1; } catch (e) { return false; }
  })());
  check('a service\'s banner 10px shorter: 2 + 2 off its padding, 6 off its tabs; the documents come before the tip',
    /margin: -6px -6px 0; padding: 16px 22px 18px;/.test(SRC) && /\.pl-tab \{[^}]*min-height: 48px;/.test(SRC) && /\.pl-hero \{ margin: 0 -16px; padding: 12px 16px 14px;/.test(SRC) &&
    /'<\/ul>' \+ tip : '<p class="lf-muted">'/.test(res12) && /\.sp-docs \+ \.sp-tip \{ margin: 10px 0 0; \}/.test(SRC));

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
    /_svlApply\(sp\.data, x, !!opts\.songs, false, \{ special: true, map: sp\.map, fromType: row\.order_type \|\| 'traditional', extras: opts\.extras \|\| \[\] \}\);/.test(fn('svlUseFromLibrary')) &&
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
  const mk16 = fn('_spMakeHtml');
  check('This year\'s liturgy: with its order made, ITS liturgy -- where it came from, the outline, and another file folded under it; else the files to use',
    /var ol = \(d && d\.order\) \? _spOrderOutline\(d\) : null;/.test(mk16) && /'Its liturgy: <b>' \+ _lfE\(svl\.title\) \+ '<\/b>'/.test(mk16) &&
    /state \+ \(ol \? _spOutlineHtml\(ol\)/.test(mk16) && /<summary>Use another Liturgy App File for it<\/summary>/.test(mk16) && /: list\) \+/.test(mk16));
  check('...read from the Builder\'s own copy when it holds the order here, else from the stored order (kept by _spLoad)',
    /var mem = \(window\.WO && WO\.libOutlineOf\) \? WO\.libOutlineOf\(d\.order\.id\) : null;/.test(fn('_spOrderOutline')) &&
    /d\.orderItems = got\.items \|\| \[\];/.test(fn('_spLoad')) && /if \(!_woLibHeld\(orderId\) \|\| !_lbdIsActive\(\) \|\| _woLcdInPage\(\)\) return null;/.test(fn('_woLibOutlineOf')));
  check('...a liturgy part has Edit; the words open in a box, saved through WO.libSetSlides with Undo; readings and songs say where they change',
    /p\.edit && !ed \? '<button type="button" class="spo-pen"/.test(fn('_spoPartHtml')) && /id="spoText"/.test(fn('_spoPartHtml')) &&
    /From the Roster: change it on the Readings page\./.test(fn('_spoPartHtml')) && /its words are in the Songbook/.test(fn('_spoPartHtml')) &&
    /WO\.libSetSlides\(oid, e\.id, _spoSlidesOf\(e\.text\)\)/.test(fn('spoSave')) && /WO\.libSetSlides\(oid, e\.id, null, res\.before\)/.test(fn('spoSave')) &&
    /if \(res\.saved === false\) \{ showToast\('Changed in the Liturgy Builder, but it did not save/.test(fn('spoSave')));
  check('...a save waited on watches the indicator: saved, failed, or not known in time',
    /_soSetSaveStatus\('saving'\);\s+saveImmediately\(\);/.test(fn('_soSaveSettled')) && /if \(_soState === 'failed' \|\| _soState === ''\) return res\(false\);/.test(fn('_soSaveSettled')) &&
    /_soState = state \|\| '';/.test(fn('_soSetSaveStatus')));
  check('the outline closes its own box', /: ''\) \+\s+'<\/div>';/.test(fn('_spOutlineHtml')));
  check('an order with no readings offers this date\'s from the Roster: the Builder opens on it and fills them',
    /\(n\.read \? '' : '<button type="button" class="spo-fill" onclick="LiturgyModule\.spoReadings\(\)"/.test(fn('_spOutlineHtml')) &&
    /_llOpenInBuilder\(d\.order\.id, function\(\) \{ WO\.lbdFillReadings\(\); \}\)/.test(fn('spoReadings')) && /lbdFillReadings: lbdFillReadings/.test(SRC));
  check('the Builder opened from a service\'s page carries a bar back to it, in the Orders view only, gone when another order is opened; Back saves first',
    /if \(_llShown\('liturgyServicePanel'\) && _sp\.occ\) \{/.test(fn('_llOpenInBuilder')) && /_llBackBar\(\);/.test(fn('_llOpenInBuilder')) &&
    /view\.appendChild\(b\)/.test(fn('_llBackBar')) && /cur !== _llBack\.orderId/.test(fn('_llBackBar')) &&
    /WO\.saveImmediately\(\)/.test(fn('llBackToLib')) && /openService\(b\.occ, b\.from \|\| 'services', 'order'\)/.test(fn('llBackToLib')) &&
    /libOutlineOf: _woLibOutlineOf, libSetSlides: _woLibSetSlides, currentOrderId:/.test(SRC));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
})();
