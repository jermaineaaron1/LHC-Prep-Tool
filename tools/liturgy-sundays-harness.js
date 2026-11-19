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
    /_spForNext\(\(d && d\.rows\) \|\| \[\], sun && sun\.occ === occ \? sun\.key : ''\)/.test(mk) && /\[kind, cyc\]/.test(mk) &&
    /data-key="' \+ _lfE\(next\.key\) \+ '" onclick="LiturgyModule\.spUse\(this\.dataset\.id, this\.dataset\.key\)"><i class="fa-solid fa-download" aria-hidden="true"><\/i><span>Use<\/span>/.test(mk) &&
    /How to make this year’s from a past one/.test(mk) && /No Liturgy App File for this Sunday yet\./.test(mk) && /a Year B liturgy from 2023 suits Year B again in 2026/.test(mk));
  const ready = fn('_spAppRow') + fn('spDocAct') + fn('spConvAct');
  // Since 2026-11-17 a file is a row (its document's, or its own): its year
  // with its letter there, its Sundays from its menu.
  check('a ready liturgy shows its year with its letter, and its Sundays are changed from its menu',
    /_llCycleFor\(occId, r\.year\)/.test(ready) && /else if \(act === 'days'\) spSundays\(id\);/.test(ready) && /else if \(act === 'days'\) spSundays\(fid\);/.test(ready));
  const ss = fn('spSundaysSave');
  check('...saved into its own data, with its year, and read back before it is reported', /select\('data'\)\.eq\('id', ed\.id\)/.test(ss) && /delete data\.forDays/.test(ss) &&
    /update\(\{ data: data, year: \+year, updated_at: new Date\(\)\.toISOString\(\) \}\)\.eq\('id', ed\.id\)\.select\('id,data,year'\)/.test(ss) &&
    /if \(String\(w\.data\[0\]\.year\) !== year \|\| \(ed\.hasDays && JSON\.stringify\(back\) !== JSON\.stringify\(ed\.days\)\)\) throw/.test(ss));
  const res = fn('_spResHtml') + fn('_spDocRow');
  check('each document says when it was added and its year\'s letter, and can be renamed where it is',
    /var added = it\.created \? 'Added ' \+ _lfWhen\(it\.created\) : '';/.test(res) && /var yc = y \? _llCycleFor\(occId, y\) : '';/.test(res) &&
    /else if \(act === 'rename'\) spRename\(id\);/.test(fn('spDocAct')) && /updateItem\(id, \{ title: name \}\);/.test(fn('spRename')) &&
    /renderService\(\);/.test(fn('spRename')));
  check('a year chip carries its letter (This Year\'s too)', /var letter = function\(y\) \{ var c = y && y !== '—' \? _llCycleFor\(occ\.id, y\) : ''; return c \? c\.slice\(-1\) : ''; \};/.test(res) && /var cyT = _llCycleFor\(occ\.id, thisY\);/.test(res));
  check('a Google Doc can be added as a liturgy, filed in its year, and made ready', /'gdoc', 'fa-brands fa-google-drive', 'Add a Google Doc'/.test(fn('spAddDocs')) &&
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
  const res8 = fn('_spResHtml') + fn('_spDocRow');
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
  const res9 = fn('_spResHtml') + fn('_spDocRow');
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
    /item\('days', 'fa-calendar-check', LL_SUNDAYS\[_sp\.occ\] \? 'Sundays & year' : 'Year'\)/.test(fn('spDocMenu')) &&
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
    /q\('\.svp-lib'\)/.test(steps10) && /var mk = q\('\.sp-doc \.sp-btn-maroon'\), use = q\('\.sp-fit \.pl-btn-green'\), rowUse = q\('\.sp-doc \.sp-usebtn'\);/.test(steps10) &&
    /el: rowUse \|\| q\('\.svp-files'\), tap: !!rowUse/.test(steps10) && /el: mk \|\| q\('\.svp-add'\), tap: true/.test(steps10) &&
    /el: use \|\| q\('\.sp-make'\)/.test(steps10) && /q\('\.svp-act \.svp-builder'\)/.test(steps10) && /\.filter\(function\(x\) \{ return x\.el; \}\)/.test(steps10));
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
  const draw11 = fn('_cvDraw'), res11 = fn('_spResHtml') + fn('_spDocRow'), conv11 = fn('spConvert'), save11 = fn('cvSave');
  check('it is called what it is: Convert, a Liturgy App File', /Convert to Liturgy App File/.test(draw11) && /<h2 id="cvTtl">Convert to a Liturgy App File<\/h2>/.test(draw11) &&
    /<span>Convert<\/span><\/button>/.test(res11) && /'Liturgy App File'/.test(fn('_spAppRow')) && !/Make ready/.test(res11 + draw11 + fn('_spAppRow') + fn('_spMakeHtml')) &&
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
  const res12 = fn('_spResHtml') + fn('_spDocRow'), ready12 = fn('_spAppRow');
  check('a converted document shows Converted (green, its menu) and Use where Convert was; one not converted keeps Convert',
    /var state = conv\.length\s*\? '<button type="button" class="lf-btn sp-btn-sm sp-convd"/.test(res12) && /LiturgyModule\.spConvMenu\(this, this\.dataset\.id\)/.test(res12) &&
    /<span>Converted<\/span>/.test(res12) && /class="lf-btn sp-btn-sm pl-btn-green sp-usebtn"[\s\S]{0,80}onclick="LiturgyModule\.spUseDoc\(this\.dataset\.id\)"/.test(res12) &&
    /: \(canConvert \? '<button type="button" class="lf-btn sp-btn-sm sp-btn-maroon lf-btn--primary"/.test(res12) &&
    /\.lf-btn\.sp-convd \{[^}]*background: #e3f4ea;[^}]*color: #0b5d36;/.test(SRC));
  // 2026-11-17: a year's app files are a section of their own, every one
  // of them (converted or saved), before its documents (section 29).
  // 2026-11-17, again: no Liturgy App Files section ("Remove the section");
  // a file is seen through its document, and one with no document is a row.
  check('no Liturgy App Files section: a file is seen through its document, and one with no document is a row of the list',
    !fn('_spReadyHtml') && /apps\.map\(function\(r\) \{ return _spAppRow\(r, occ\.id\); \}\)/.test(res12) &&
    /return \(!m \|\| !getItem\(m\[1\]\)\) && \(!sel \|\| String\(r\.year \|\| '—'\) === sel\);/.test(res12) && !/sp-readybox/.test(res12));
  check('after converting, its document is marked and scrolled to', /var conv = tab === 'liturgy' \? _spFilesOf\(it\.id\) : \[\], fresh = _sp\.fresh && conv\.some\(function\(r\) \{ return r\.id === _sp\.fresh; \}\);/.test(res12) && /sp-doc--conv/.test(res12) &&
    /document\.querySelector\('#liturgyServicePanel \.sp-doc\.is-new'\)/.test(fn('spReady')));
  check('a service reached any way reads its year folders (they were read only by the landing page and Services, so a service button left every document at No year)',
    /if \(!_lfFoldersAsked\) \{\s*_lfFoldersAsked = true;\s*var keepOcc = _currentOccasion;\s*_currentOccasion = null;\s*loadOccFolders\(\)\.then\(function\(\) \{ if \(_sp\.occ === occId\) renderService\(\); \}\);/.test(fn('openService')));
  check('Convert again starts on the kind asked for, else the coming service\'s, and on the file\'s Sundays',
    /type: opts\.type \|\| \(\(occ && occ\.id === 'ordinary-contemporary'\) \? 'contemporary'\s*: \(_spData && _spData\.occ === occId && _spData\.next && _spData\.next\.type\) \|\| 'traditional'\)/.test(fn('spConvert')) &&
    /spConvert\(docId, \{ type: type, days: days \}\);/.test(fn('spUseReconvert')));
  check('every Use on the page opens the one window: This year\'s liturgy on its Sunday, the Builder\'s own liturgies, a converted document',
    /if \(m && getItem\(m\[1\]\)\) spUseDoc\(m\[1\], \{ fileId: id, key: key \}\);\s*else _spUseOpen\(\[r\], id, \{ key: key \}\);/.test(fn('spUse')) &&
    /onclick="LiturgyModule\.spUse\(this\.dataset\.id\)" title="Use it for a coming service"><i class="fa-solid fa-download"/.test(ready12) && !/orderId \? '<button[^']*spUse/.test(fn('_spMakeHtml') + ready12));
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
        'spConvMenu', 'spConvAct', '_spFileReadings', '_spRefKey', '_spReadDiff', '_cvBook', '_cvRefOf', '_cvReadingRole', '_cvRoleName',
        '_spBlKey', '_spSimNorm', '_spShingles', '_spShOf', '_spSimOf', '_spNameAlike', '_spSecTexts', '_spLikeOf', '_spUsePieces', '_spUseLikeHtml', '_spUseSuppHtml',
        'spUseAll', 'spUseSupp', 'spUseSuppSec', '_spCmpRows', '_spCmpLines', 'spUseCompare', 'spUseCmpHl', 'spUseCmpClose', '_spUsesFor', '_spUsesOf'];
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
      const consts = SRC.match(/  var CV_BOOKS = [^\n]*;/)[0] + '\n' + SRC.match(/  var CV_ROLES = [^\n]*;/)[0] + '\n' + SRC.match(/  var SP_USE_STEPS = [^\n]*;/)[0] + '\n' + SRC.match(/  var SP_COMMUNION = [^\n]*;/)[0] + '\n' + SRC.match(/  var SP_SIM_STOP = [^\n]*;/)[0] + '\n' + SRC.match(/  var _spShMemo = [^\n]*;/)[0];
      const U = new Function('OCCASIONS', 'LL_SUNDAYS', '_llSundayOf', '_llForSunday', '_llDaysToggle', '_llDaysHtml', '_llCycle', '_llYearText', 'getOccasionById', '_lfE', ...keys,
        'var _spUse = null, _spUseBack = null;\n' + consts + '\n' + bodies.join('\n') +
        '\nreturn { doc: spUseDoc, use: spUse, step: spUseStep, date: spUseDate, extra: spUseExtra, songs: spUseSongs, comm: spUseComm, from: spUseReadsFrom, leave: spUseLeave, go: spUseGo,' +
        ' readings: spUseReadings, ret: spUseReturn, after: _spAfterConvert, file: spUseFile, menu: spConvMenu, act: spConvAct, all: spUseAll, supp: spUseSupp, suppSec: spUseSuppSec, cmp: spUseCompare, hl: spUseCmpHl,' +
        ' state: function() { return _spUse; }, back: function() { return _spUseBack; } };')(
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
      // Every part ticked at first (2026-11-17, section 29); Select none, then
      // the flow as before.
      const offered29 = (html().match(/ data-i="\d+" onchange="LiturgyModule\.spUseExtra/g) || []).length, ticked29 = Object.keys(U.state().extras).length;
      const both29 = /Select all<\/button>/.test(html()) && /Select none<\/button>/.test(html());
      U.all('trad', false);
      check('...every part ticked at first; Select none takes every tick away', offered29 >= 3 && ticked29 === offered29 && both29 &&
        !Object.keys(U.state().extras).length && !/spu-comm is-on/.test(html()), offered29 + ' offered, ' + ticked29 + ' ticked');
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
      U.use('trad', '2026-12-13'); await tick(); U.all('trad', false); U.step(4);
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
    /title: 'Memories', tag: 'Blast from the past: services for future reference'/.test(hub13) && /\(c\.tag \? '<span class="ll-card__tag">' \+ _lfE\(c\.tag\) \+ '<\/span>' : ''\)/.test(hub13) &&
    !/What the church is hearing'|How we worship'|What we have done together'/.test(hub13));
  // 20px shorter on 2026-11-16, then 30px more the same day (the operator,
  // circling the three: "Make 30px smaller"; asked, each card).
  // 20px shorter, then 30px more, on 2026-11-16; on 2026-11-17 each card
  // became its header alone, 20px shorter again (section 29).
  // ...and 5px taller again the same day (section 31): 47px and 77px.
  // ...and bigger and glossy the same day (section 34): 72px and 104px.
  check('...each card its header alone (measured: 62 to 42px at 480px wide, 92 to 72px on a desk; then 47 and 77; then 72 and 104)',
    /\.ll-card__top \{ position: relative; display: flex; align-items: center; gap: 16px; padding: 14px 18px 14px 16px; min-height: 104px;/.test(SRC) &&
    /\.ll-card__top \{ padding: 10px 12px; min-height: 72px; gap: 12px; \}/.test(SRC) && !/\.ll-card__go \{/.test(SRC) && !/\.ll-card__body \{/.test(SRC));
  const svc13 = fn('renderServices'), grid13 = fn('_lsGridHtml');
  check('Services: the cards first, the counts and the library\'s buttons at the foot in one line; no All Services / Favourites chips',
    /_lsGridHtml\(\) \+[\s\S]*foot \+\s*'<\/div>';/.test(svc13) && svc13.indexOf("'<div class=\"ls-bar ls-bar--foot\">'") !== -1 &&
    !/LiturgyModule\.lsSet\(\\'fav\\'/.test(svc13) && !/ls-chips/.test(svc13) && /service collections<\/b>/.test(svc13));
  check('...a starred service is listed first instead', /var shown = _lsFavFirst\(_lsFilter\(/.test(grid13) && (() => {
    try { const f = new Function(fn('_lsFavFirst') + '\nreturn _lsFavFirst;')(); return f([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c']).map(o => o.id).join() === 'c,a,b' && f([{ id: 'a' }], null).length === 1; } catch (e) { return false; }
  })());
  check('a service\'s banner 10px shorter: 2 + 2 off its padding, 6 off its tabs; the documents come before the tip',
    /margin: -6px -6px 0; padding: 16px 22px 18px;/.test(SRC) && /\.pl-tab \{[^}]*min-height: 48px;/.test(SRC) && /\.pl-hero \{ margin: 0 -16px; padding: 12px 16px 14px;/.test(SRC) &&
    /'<\/ul>' \+ tip\s*: '<p class="lf-muted sp-none svp-none">'/.test(res12) && /\.svp-box \.sp-tip \{ margin: 0;/.test(SRC));

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
    /return _svlApply\(sp\.data, x, !!opts\.songs, false, \{ special: true, map: sp\.map, fromType: row\.order_type \|\| 'traditional', extras: opts\.extras \|\| \[\], supp: opts\.supp \|\| \[\], use: opts\.use \|\| null \}\) \|\| true;/.test(fn('svlUseFromLibrary')) &&
    /svlUseFromLibrary: svlUseFromLibrary,/.test(SRC));
  check('the Roster: a date marked Special, logged and read back, and shown as Special in its row', /setServiceType: function\(iso, value\) \{/.test(SRC) &&
    /role_id: 'service_type', service_date: k\.serviceDate, old_value: oldVal, new_value: v,/.test(SRC) && /throw new Error\('the Roster did not keep it'\)/.test(SRC) &&
    /\(svcValue === 'Special' \? '<button type="button" class="roster-servicetype-btn spec active" data-value="Special">Special<\/button>' : ''\)/.test(SRC));
  check('the service page is slim: All Services a badge, the name, no Sync / Share / Add Item; + Add beside the Liturgy Library\'s heading',
    /class="pl-hero pl-hero--slim"/.test(fn('renderService')) && !/spSync\(\)|spShare\(\)|spAddMenu\(this\)/.test(fn('renderService')) &&
    /<div class="svp-hd__t"><h2 id="svpLibT">Liturgy Library<\/h2>/.test(fn('_spResHtml')) && !/sp-res__bar/.test(fn('_spResHtml')) &&
    /<button type="button" class="svp-add" onclick="LiturgyModule\.spAddDocs\(this\)"/.test(fn('_spResHtml')));

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
  check('This year\'s liturgy: with its order made, the Active Liturgy; else the files to use, as before',
    /if \(d && d\.order && next\) return _spInUseHtml\(d, next, cyc, kind, list\);/.test(mk16) && /How to make this year’s from a past one/.test(mk16) &&
    /_spActHd\(used \? 'Ready for Church Use' : 'Written in the Builder', used \? '' : 'is-plain'\)/.test(use16) &&
    /'<div class="svp-act__day">' \+ _spDateTile\(next\.key\)/.test(use16) && /<h3>Active Liturgy<\/h3>/.test(fn('_spActHd')));
  check('...read from the Builder\'s own copy when it holds the order here, else from the stored order (kept by _spLoad)',
    /var mem = \(window\.WO && WO\.libOutlineOf\) \? WO\.libOutlineOf\(d\.order\.id\) : null;/.test(fn('_spOrderOutline')) &&
    /d\.orderItems = got\.items \|\| \[\];/.test(fn('_spLoad')) && /if \(!_woLibHeld\(orderId\) \|\| !_lbdIsActive\(\) \|\| _woLcdInPage\(\)\) return null;/.test(fn('_woLibOutlineOf')));
  check('...the liturgy window: a liturgy part\'s words typed in place; readings and songs say where they change; a save made in the Builder that did not land says so',
    /'<textarea class="spp-text" data-k="' \+ k \+ '"/.test(fn('_spPadPartHtml')) && /From the Roster/.test(fn('_spPadPartHtml')) && /Words in the Songbook/.test(fn('_spPadPartHtml')) &&
    /if \(res\.saved === false\) showToast\('Changed in the Liturgy Builder, but it did not save/.test(fn('_spEdit')));
  check('...a save waited on watches the indicator: saved, failed, or not known in time',
    /_soSetSaveStatus\('saving'\);\s+saveImmediately\(\);/.test(fn('_soSaveSettled')) && /if \(_soState === 'failed' \|\| _soState === ''\) return res\(false\);/.test(fn('_soSaveSettled')) &&
    /_soState = state \|\| '';/.test(fn('_soSetSaveStatus')));
  check('the window closes its own box', /'<div class="spp-foot">' \+ _spPadFootHtml\(P, plan\) \+ '<\/div>' \+\s+'<\/div>';/.test(fn('_spPadDraw')));
  check('an order with no readings offers this date\'s from the Roster: the Builder opens on it and fills them',
    /n\.read \? '' : '<button type="button" class="spo-fill" onclick="LiturgyModule\.spoReadings\(\)"/.test(use16) &&
    /_llOpenInBuilder\(d\.order\.id, function\(\) \{ WO\.lbdFillReadings\(\); \}\)/.test(fn('spoReadings')) && /lbdFillReadings: lbdFillReadings/.test(SRC));
  check('the Builder opened from a service\'s page carries a bar back to it, in the Orders view only, gone when another order is opened; Back saves first',
    /if \(_llShown\('liturgyServicePanel'\) && _sp\.occ\) \{/.test(fn('_llOpenInBuilder')) && /_llBackBar\(\);/.test(fn('_llOpenInBuilder')) &&
    /view\.appendChild\(b\)/.test(fn('_llBackBar')) && /cur !== _llBack\.orderId/.test(fn('_llBackBar')) &&
    /saved = WO\.libSaveNow\(12000\);\s*else if \(window\.WO && WO\.saveImmediately\) WO\.saveImmediately\(\);/.test(fn('llBackToLib')) && /openService\(b\.occ, b\.from \|\| 'services', 'order'\)/.test(fn('llBackToLib')) &&
    /libOutlineOf: _woLibOutlineOf, libTplOf: _woLibTplOf, libSaveNow: function\(ms\) \{ return _soSaveSettled\(ms\); \}, libSetSlides: _woLibSetSlides, libPdf: _woLibPdf, libUnuse: _woLibUnuse, libDelete: _woLibDelete, libRestore: _woLibRestore,/.test(SRC));

  // ------------------------------------------------------------ 17. in use: concise, a PDF, Remove
  // From the operator (2026-11-16), on a screenshot of the box: "a better
  // overall design to show that the liturgy which was used based on a
  // previous year is being used for this particular day's service ... more
  // concise and also shareable in PDF format", "Able to delete the liturgy
  // set / And collapse / Expand", and "enable to delete the created liturgy
  // and revert back from Use".
  console.log('\n17. In use: where it came from, folded, a PDF, and Remove');
  // Show liturgy opens the liturgy window now (section 32): the card holds
  // no list, and keeps nothing on the device about one.
  check('Show Liturgy on the Active Liturgy (beside the Builder and ⋯) opens the liturgy window; the card holds no list',
    /'<div class="svp-act__day">' \+ _spDateTile\(next\.key\)/.test(use16) &&
    /'<button type="button" class="lf-btn svp-show" aria-haspopup="dialog" onclick="LiturgyModule\.spoShow\(\)"/.test(use16) && /<span>Show Liturgy<\/span>/.test(use16) &&
    !/Hide liturgy/.test(use16) && !/_spOutlineHtml/.test(SRC) && !/SP_OL_KEY|olOpen/.test(SRC) && /function spoShow\(\) \{ spoPad\(false\); \}/.test(SRC) && !/spi-ol__hd/.test(use16));
  check('...the Builder, and ⋯ for the PDF, Share, the original file, another liturgy and Remove (Remove only for a liturgy put in)',
    /class="lf-btn svp-builder" onclick="LiturgyModule\.spEdit\(\)"/.test(use16) && /class="lf-btn svp-more" onclick="LiturgyModule\.spoMore\(this\)"/.test(use16) &&
    /item\('pdf', 'fa-file-pdf', 'Download the PDF'\) \+ item\('share', 'fa-share-nodes', 'Share the PDF'\)/.test(fn('spoMore')) &&
    /\(used \? item\('rm', 'fa-trash-can', 'Remove from this service', true\) : ''\)/.test(fn('spoMore')) &&
    /q\('\.svp-act \.svp-builder'\)/.test(fn('_spTourSteps')));
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
  check('the window: a changed part marked Changed, its Original to see and a revert; a part taken out shown in its section with Put back; a part new or not in the original says so',
    /spo-tag spo-tag--ch">Changed/.test(fn('_spPadPartTags')) && /LiturgyModule\.spoPadOrig\(this\.dataset\.k\)/.test(fn('_spPadPartTags')) && /LiturgyModule\.spoPadRevertPart\(this\.dataset\.k\)/.test(fn('_spPadPartTags')) &&
    /spo-tag spo-tag--gone">Taken out/.test(fn('_spPadSecHtml')) && /LiturgyModule\.spoPadPutPart\(this\.dataset\.m\)/.test(fn('_spPadSecHtml')) &&
    /\(p\.id \? 'Not in the original' : 'New'\)/.test(fn('_spPadPartTags')));
  check('...the line under the blocks: Same as the original, or "Modified:" with what changed, See and Reset to original (asked first, the changes named; the readings and songs stay)',
    /Same as the original/.test(fn('_spDiffHtml')) && /LiturgyModule\.spoShowChanged\(\)/.test(fn('_spDiffHtml')) && /LiturgyModule\.spoPutAll\(\)/.test(fn('_spDiffHtml')) &&
    /<b>Modified:<\/b>/.test(fn('_spDiffHtml')) && /Reset to original/.test(fn('_spDiffHtml')) &&
    /title: 'Reset to the original\?'/.test(fn('spoPutAll')) && /The readings and the songs stay\. Undo brings back what was here\./.test(fn('spoPutAll')) &&
    /_spCmpNow\(d, ol\)/.test(use16) && /'<div class="svp-act__src">' \+ src \+ '<\/div>' \+ _spDiffHtml\(cmp\) \+ reads \+ acts \+ change/.test(use16));
  check('...everything put back from the card (Reset to original) through WO.libRestore in the Builder\'s copy; the window\'s Save through _spEdit too, which opens the Builder once when it does not hold the order and comes back',
    /_spEdit\(function\(oid\) \{ return WO\.libRestore\(oid, Object\.assign\(\{ unblend: true, origId: c\.cmp\.origId \}, plan\)\); \}/.test(fn('spoPutAll')) &&
    /_spEdit\(function\(oid\) \{ return WO\.libPad\(oid, plan\); \}/.test(fn('spoPadSave')) &&
    /if \(WO\.libOutlineOf\(oid\)\) \{/.test(fn('_spEdit')) && /_llOpenInBuilder\(oid, function\(\) \{/.test(fn('_spEdit')) &&
    /report\(res\); llBackToLib\(\); resolve\(true\);/.test(fn('_spEdit')) && !fn('_spRestore') && !fn('spoPutBack') && !fn('spoPutGone') && !fn('spoPutSec'));
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
  check('the card: its source is the original, badged Original, and ⋯ goes to the file (for a Liturgy App File)',
    /var src = used \? _spSourcesHtml\(svl, occ\) :/.test(use16) && /\(x\.orig \? '<em>Original<\/em>' : ''\)/.test(fn('_spSourcesHtml')) &&
    /\(used && svl\.id \? item\('orig', 'fa-folder-open', 'Go to the original file'\) : ''\)/.test(fn('spoMore')));
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
    /return '<div class="sp-lib svp">' \+ _spResHtml\(occ, d, orderId\) \+ '<\/div>';/.test(fn('_spOrderTab')));
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
  // The card's pen, bin, Reorder and drag went with its list (2026-11-17):
  // the liturgy window does all of it (section 32).
  const pad20 = fn('_spPadSecHtml'), draw20 = fn('_spPadDraw');
  check('the window: each section\'s name typed in place, its fold and its bin; its own Undo and Redo; the original\'s sections taken out shown in place with Put back',
    /class="spp-title"/.test(pad20) && /LiturgyModule\.spoPadTitle\(this\)/.test(pad20) && /LiturgyModule\.spoPadFold\(this\.dataset\.k\)/.test(pad20) && /LiturgyModule\.spoPadRmSec\(this\.dataset\.k\)/.test(pad20) &&
    /LiturgyModule\.spoPadUndo\(\)/.test(draw20) && /LiturgyModule\.spoPadRedo\(\)/.test(draw20) && /LiturgyModule\.spoPadPutSec\(this\.dataset\.id\)/.test(draw20) &&
    /Renamed<\/span>/.test(fn('_spPadSecTags')) && /Moved<\/span>/.test(fn('_spPadSecTags')) && /Not in the original<\/span>/.test(fn('_spPadSecTags')));
  check('...nothing of the card\'s old list is left: no pen, Reorder, arrows or + Section form on the page, and none of their state kept across the trip to the Builder',
    !fn('spoSecEdit') && !fn('spoSecRemove') && !fn('spoSecMove') && !fn('spoReorder') && !fn('spoSecAdd') && !fn('_spDragDown') &&
    !/allSecs|reorder:|secAdd/.test(fn('openService')) && !/_spDrag/.test(fn('renderService')));
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
  // The add box on the card went with the list (2026-11-17): in the liturgy
  // window every section has Add words and Section after it (section 32).
  check('in the window an empty section says so, and every section offers Add words and a section after it',
    /Nothing in it yet\./.test(fn('_spPadSecHtml')) && /LiturgyModule\.spoPadAddPart\(this\.dataset\.k\)/.test(fn('_spPadSecHtml')) && /LiturgyModule\.spoPadAddSec\(this\.dataset\.k\)/.test(fn('_spPadSecHtml')) &&
    /libAddPart: _woLibAddPart/.test(SRC) && !fn('spoAddSave') && !fn('_spoAddHtml'));
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
  check('the year chips: This Year first (its year, its letter, a star), open at first; the past years newest first; All years; + Year',
    /'<button type="button" class="svp-year svp-year--this' \+ \(_sp\.year === 'this' \? ' is-on' : ''\) \+ '" data-y="' \+ _lfE\(thisY\) \+ '" onclick="LiturgyModule\.spYear\(\\'this\\'\)"' \+ drop/.test(res22) &&
    /This Year · ' \+ _lfE\(thisY \+/.test(res22) && /filter\(function\(y\) \{ return y !== '—' && y !== thisY; \}\)\.sort\(\)\.reverse\(\)/.test(res22) &&
    res22.indexOf('svp-year--this') < res22.indexOf('ys.map(') && res22.indexOf('ys.map(') < res22.indexOf('All years</button>') && res22.indexOf('All years</button>') < res22.indexOf('svp-year--add') &&
    /year: 'this', from: from \|\| 'services'/.test(fn('openService')) && /_sp\.res = t;\s*renderService\(\);/.test(fn('spResTab')) && !/_sp\.year = 'this'/.test(fn('spResTab')));
  check('...a year typed as this year is This Year; a year with nothing in it falls back to it',
    /if \(_sp\.year === thisY\) _sp\.year = 'this';/.test(res22) && /if \(_sp\.year && _sp\.year !== 'this' && !years\[_sp\.year\]\) _sp\.year = 'this';/.test(res22) &&
    /var sel = _sp\.year === 'this' \? thisY : _sp\.year;/.test(res22) && /return !sel \|\| \(_spYearOf\(it, occ\.id\) \|\| '—'\) === sel;/.test(res22));
  check('...This Year holds the Active Liturgy in the Liturgy Library card; every year its files in the Files Repository; the two cards side by side on a wide desk',
    /chips \+ \(_sp\.year === 'this' \? _spMakeHtml\(d, orderId\) : ''\) \+ '<\/section>'/.test(res22) && !/_spReadyHtml/.test(res22) && /return libCard \+ filesCard;/.test(res22) &&
    !/sp-lib__side|sp-lib__main/.test(tab22) &&
    /@media \(min-width: 1180px\) \{\s*#liturgyServicePanel \.sp-lib\.svp \{ display: grid; grid-template-columns: minmax\(0, 5fr\) minmax\(0, 6fr\); align-items: start; \}/.test(SRC));
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
  // The card's drag went with its list (2026-11-17); the liturgy window
  // drags sections and parts (section 32).
  check('drag in the window: a finger on a grip drags and never scrolls; the sections fold to their rows while one moves; a closed section takes a part dropped on its row; Escape puts it back',
    /\.spp-grip \{[^}]*touch-action: none;/.test(SRC) && /list\.classList\.add\('is-sorting'\);/.test(fn('_spPadDragDown')) &&
    /\.spp-secs\.is-sorting \.spp-parts/.test(SRC) && /hit\.classList\.add\('is-drop'\); D\.target = hit\.getAttribute\('data-k'\);/.test(fn('_spPadDragPlace')) &&
    /e\.key === 'Escape'/.test(fn('_spPadDragKey')) && /D\.body\.scrollTop \+= step;/.test(fn('_spPadDragEdge')) && /libPart: _woLibPart/.test(SRC));
  // ------------------------------------------------------------ 23. a phone's layout A
  // From the operator (2026-11-16), on a phone screenshot: "this layout looks
  // really busy especially for the mobile version"; of three sketches they
  // chose A, "fewer boxes", and: "Remove the most bottom section text. Just
  // say no documents uploaded (PDF, Word, Google Docs, etc.)".
  console.log('\n23. A phone\'s layout A: fewer boxes');
  const res23 = fn('_spResHtml'), use23 = fn('_spInUseHtml');
  check('one + Add, on every screen, holds every way to add: a liturgy, a Google Doc, files, a link, a liturgy text for the LCD, a year folder',
    /class="svp-add" onclick="LiturgyModule\.spAddDocs\(this\)"/.test(res23) && (SRC.match(/^  function spAddDocs\(/gm) || []).length === 1 &&
    /'up', 'fa-solid fa-file-arrow-up', 'Upload a liturgy \(PDF, Word, Excel\)'/.test(fn('spAddDocs')) && /'gdoc', 'fa-brands fa-google-drive', 'Add a Google Doc'/.test(fn('spAddDocs')) &&
    /'file', 'fa-solid fa-photo-film', 'Upload photos, videos or other files'/.test(fn('spAddDocs')) && /'link', 'fa-solid fa-link', 'Add a link'/.test(fn('spAddDocs')) &&
    /'lcd', 'fa-solid fa-display', 'New liturgy text for the LCD'/.test(fn('spAddDocs')) &&
    /if \(act === 'up'\) spUpload\('liturgy'\); else if \(act === 'gdoc'\) spAddGdoc\(\); else if \(act === 'year'\) spNewYear\(\);\s*else if \(act === 'file'\) spUpload\(''\); else if \(act === 'link'\) spAddLink\(\); else if \(act === 'lcd'\) lfNew\(\);/.test(fn('spAddDocsAct')));
  check('...the kinds of file are chips with their counts, Liturgies first; on a phone the year and kind chips are each one scrolling line',
    /'<div class="svp-kinds" role="group" aria-label="Kinds of file">'/.test(res23) && /' <span>\(' \+ groups\[t\[0\]\]\.length \+ '\)<\/span><\/button>'/.test(res23) &&
    /\[\['liturgy', 'fa-file-word', 'Liturgies', 'Liturgy Documents'\], \['lcd'/.test(res23) &&
    /\.svp-years, \.svp-kinds \{ flex-wrap: nowrap; padding: 2px 14px 12px; overflow-x: auto;/.test(SRC) && !/sp-rsel/.test(res23));
  check('...the Active Liturgy is one layout on every screen: the day on its tile with Change, its source, the line, then Show Liturgy, the Builder and ⋯',
    /'<div class="svp-act__day">' \+ _spDateTile\(next\.key\)/.test(use23) && /class="svp-chg" onclick="LiturgyModule\.spoPick\(\)"/.test(use23) &&
    /class="lf-btn svp-show"/.test(use23) && /LiturgyModule\.spEdit\(\)" title="Open in the Liturgy Builder"/.test(use23) && /LiturgyModule\.spoMore\(this\)/.test(use23) &&
    !/spi-flow|spi-acts|spi-more|spi-c__acts/.test(use23) && /#liturgyServicePanel \.svp-act \.svp-show \{ flex: 1 1 auto;/.test(SRC));
  try {
    let html = '';
    const doc = { getElementById: () => null };
    const M = new Function('document', '_spData', '_spOrderOutline', '_spFloat', '_spFloatClose', '_lfE', 'var window = {};\n' + fn('_spTpl') + '\n' + fn('spoMore') + '\nreturn spoMore;');
    const mk = (tpl, hasOl) => { html = ''; M(doc, { order: { id: 'o' }, orderTpl: tpl }, () => hasOl ? { secs: [] } : null, (b, id, h) => { html = h; }, () => {}, t => t)({}); return html; };
    const a = mk({ serviceLiturgy: { id: 'f1', title: 'Advent' } }, true), b = mk({ serviceLiturgy: { fromOrder: 'x' } }, true), c = mk({}, false);
    check('...its menu: the PDF and sharing it, the original file, another liturgy, and Remove (in red) -- each only where it applies',
      /data-act="pdf"/.test(a) && /data-act="share"/.test(a) && /data-act="orig"/.test(a) && /Change or blend the liturgy/.test(a) && /class="is-danger" data-act="rm"/.test(a) &&
      !/data-act="orig"/.test(b) && /data-act="rm"/.test(b) && !/data-act="pdf"|data-act="rm"/.test(c) && /Choose a Liturgy App File/.test(c));
    check('...and each does what the desk\'s button does',
      /if \(act === 'pdf'\) spoPdf\(false\); else if \(act === 'share'\) spoPdf\(true\);\s*else if \(act === 'orig'\) spoGoOrig\(\); else if \(act === 'change'\) spoChange\(\); else if \(act === 'rm'\) spoRemove\(\);/.test(fn('spoMoreAct')) &&
      /spoMore: spoMore, spoMoreAct: spoMoreAct/.test(SRC));
  } catch (e) { check('the menu draws', false, e.stack); }
  // Under the Uploaded documents section's own heading since 2026-11-17.
  check('a year with nothing uploaded says only "No documents uploaded (PDF, Word, Google Docs, etc.)", in its box',
    /\? 'No documents uploaded \(PDF, Word, Google Docs, etc\.\)'/.test(res23) && !/Past years’ are under their years above/.test(res23) &&
    /'<div class="svp-box__hd"><i class="fa-solid fa-folder-open" aria-hidden="true"><\/i><b>' \+ _lfE\(label\) \+ '<\/b><span>' \+ count \+ ' file'/.test(res23) && /<p class="svp-drop">/.test(res23));

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
  check('...opened by Change on the Active Liturgy\'s day, and by "Change or blend the liturgy" in its ⋯',
    /class="svp-chg" onclick="LiturgyModule\.spoPick\(\)"/.test(use24) &&
    /function spoChange\(\) \{ _sp\.change = false; spoPick\(\); \}/.test(SRC) && /used \? 'Change or blend the liturgy' : 'Choose a Liturgy App File'/.test(fn('spoMore')));
  check('...each file with its year, Sundays and kind, the one in use marked, Preview, and Use this for the others (the Use window, on this date); Stop using opens Remove, which shows what changes first',
    />Made for this Sunday</.test(pick24) && />Made for other Sundays</.test(pick24) && /<span class="spk-pill">In use<\/span>/.test(pick24) &&
    /LiturgyModule\.spPreviewReady\(this\.dataset\.id\)/.test(pick24) && /\(on \? '' : '<button[^>]*onclick="LiturgyModule\.spoPickUse\(this\.dataset\.id\)/.test(pick24) &&
    /spoPickClose\(\); if \(key\) spUse\(id, key\);/.test(fn('spoPickUse')) && /spoPickClose\(\); spoRemove\(\);/.test(fn('spoPickStop')) &&
    /\(used \? '<button type="button" class="spk-foot spk-foot--stop" onclick="LiturgyModule\.spoPickStop\(\)">/.test(pick24));
  check('...Blend only when there is another liturgy to take from; else how to have one',
    /rows\.some\(function\(r\) \{ return r\.id !== usedId; \}\)/.test(pick24) && /LiturgyModule\.spoBlend\(\)/.test(pick24) && /To blend, convert another year’s liturgy document first/.test(pick24));
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
    /WO\.libRestore\(oid, Object\.assign\(\{ unblend: true, origId: c\.cmp\.origId \}, plan\)\)/.test(fn('spoPutAll')) && /if \(plan\.unblend && svlR && \(Array\.isArray\(svlR\.blend\) \|\| svlR\.blendMap\)\)/.test(fn('_woLibRestore')) &&
    /delete tplR\.serviceLiturgy\.blend; delete tplR\.serviceLiturgy\.blendMap;/.test(fn('_woLibRestore')) && /libBlend: _woLibBlend/.test(SRC) && /spoBlendGo: spoBlendGo/.test(SRC));

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
    // Each source named as its document is (section 31): a stand-in lookup here.
    const SH = new Function('_lfE', '_llCycleFor', '_spSoftHyph', '_spSrcLook', '_lfBadge', fn('_spSourcesHtml') + '\nreturn _spSourcesHtml;')(t => String(t), (o, y) => 'Year A', t => String(t),
      x => ({ name: x.title, kind: null, year: String(x.year || ''), occ: x.occ }), k => '<span class="lf-badge">' + k.badge + '</span>');
    const one = SH({ id: 'f1', title: 'No Communion', year: 2025, occasion: 'advent' }, 'advent');
    const two = SH({ id: 'f1', title: 'No Communion', year: 2025, blend: [{ id: 'f2', title: 'Advent liturgy', year: 2023 }, { title: 'no id' }] }, 'advent');
    const past = SH({ fromOrder: 'o9', title: 'Service 1 Dec 2025' }, 'advent');
    check('Source on the card (Sources and how many, when blended), the original badged, each a badge opening its preview; a past service a badge to read',
      />Source<\/p>/.test(one) && /class="spi-srcb is-orig"><button type="button" class="spi-srcb__main" data-id="f1" onclick="LiturgyModule\.spoSrc\(this\.dataset\.id\)"/.test(one) && /<em>Original<\/em>/.test(one) &&
      /Sources <b>2<\/b>/.test(two) && /data-id="f2"/.test(two) && !/no id/.test(two) && /<span class="spi-srcb__yy"><b>2025<\/b><small>Year A<\/small><\/span>/.test(one) && /class="spi-srcb is-orig is-past"/.test(past) && SH(null, 'a') === '', two);
  } catch (e) { check('the sources draw', false, e.stack); }
  check('...a badge opens the document the file came from (PDF, Word, Google Doc), else the app file; never the folder',
    /var m = \/\^doc:\(\.\+\)\$\/\.exec\(String\(\(r && r\.made_from\) \|\| ''\)\), doc = m \? getItem\(m\[1\]\) : null;\s*if \(doc\) \{ lfOpen\(doc\.id\); return; \}/.test(fn('spoSrc')) &&
    /if \(r\) \{ _spSvlRowIn\(r\); lfOpen\(id, true\); return; \}/.test(fn('spoSrc')) && !/spoGoOrig/.test(fn('spoSrc')) &&
    /Open its document<\/span>/.test(fn('lfOpen')));
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
  // ------------------------------------------------------------ 26. The blend, A and B
  // From the operator (2026-11-16), on the blend window: "I'm not very clear
  // how the blend works. The layout is a bit confusing. I'm not sure what I'm
  // blending with." They chose this: pick the other liturgy first (B), this
  // year's is A, and each section is A, B or Off.
  console.log('\n26. The blend, A and B');
  const lit26 = (id, sec, t) => ({ id, itemType: 'liturgy', sectionId: sec, sourceId: 'doc_' + id, title: t, slides: [{ content: t + ' words' }] });
  const aSecs26 = [
    { id: 's1', title: 'Gather', parts: [{ id: 'p1', kind: 'liturgy', title: 'Gather', slides: ['Welcome'] }] },
    { id: 's2', title: '2. Confession', parts: [{ id: 'p2', kind: 'liturgy', title: 'Confession', slides: ['We confess'] }, { id: 'sg', kind: 'song', title: 'Hymn' }] },
    { id: 's3', title: 'Readings', parts: [{ id: 'r1', kind: 'reading', title: 'Isaiah 64' }] },
    { id: 's4', title: 'Kyrie', parts: [] },
    { id: '', title: 'Not in a section', parts: [] }];
  const bRow26 = { id: 'B', title: 'Advent liturgy', year: '2023', data: {
    sectionLayout: [{ id: 'b0', title: 'Invocation' }, { id: 'b1', title: 'CONFESSION' }, { id: 'b2', title: 'Advent Wreath' }, { id: 'b3', title: 'Kyrie' }, { id: 'b4', title: 'Empty' }, { id: 'b5', title: 'Blessing' }],
    items: [lit26('0', 'b0', 'Invocation'), lit26('1', 'b1', 'Confession B'), lit26('2', 'b2', 'Wreath'), { id: 'r', itemType: 'scripture', sectionId: 'b4', title: 'Psalm' },
            lit26('5', 'b5', 'Blessing'), { id: 'sgb', itemType: 'song', sectionId: 'b3' }] } };
  try {
    const K = new Function(fn('_spBlKey') + '\nreturn _spBlKey;')();
    const R = new Function('_spBlKey', fn('_spBlendRows') + '\nreturn _spBlendRows;')(K);
    const Pk = new Function(fn('_spBlendPick') + '\nreturn _spBlendPick;')();
    const P = new Function(fn('_spBlendPick') + '\n' + fn('_spBlendPlan') + '\nreturn _spBlendPlan;')();
    const rows = R(aSecs26, bRow26), by = t => rows.find(r => r.tok === t);
    check('the rows: this year\'s sections (A) in order, each with the other\'s (B) section of the same name when it has words; B\'s own sections after their neighbour, those before its first match before that match',
      rows.map(r => r.tok).join() === 's1,x:b_b0,s2,x:b_b2,s3,s4,x:b_b5' && by('s2').b.sec === 'b1' && by('s2').b.items[0].title === 'Confession B' &&
      by('s4').b === null && by('x:b_b0').a === null && by('x:b_b2').title === 'Advent Wreath', JSON.stringify(rows.map(r => [r.tok, r.b && r.b.sec])));
    check('...A\'s words are its liturgy and text parts (not its songs), and a section holding a reading says so; a section of B with no words, or no id on A, makes no row',
      by('s2').a.parts.map(q => q.id).join() === 'p2' && by('s3').a.reads === true && by('s1').a.reads === false && !rows.some(r => /b4/.test(r.tok)) && !rows.some(r => r.tok === ''));
    const lone = R([{ id: 's1', title: 'Gather', parts: [] }], { id: 'Z', data: { sectionLayout: [{ id: 'z', title: 'Wreath' }], items: [lit26('9', 'z', 'Wreath')] } });
    check('...with no name in common, B\'s sections go last; with no B, A\'s alone', lone.map(r => r.tok).join() === 's1,x:b_z' && R(aSecs26, null).map(r => r.tok).join() === 's1,s2,s3,s4');
    check('a row keeps its choice where it can be had, else A where A has it, else Off; a section holding the readings is never Off',
      Pk(by('s2'), {}) === 'A' && Pk(by('s2'), { s2: 'B' }) === 'B' && Pk(by('s4'), { s4: 'B' }) === 'A' && Pk(by('s3'), { s3: 'off' }) === 'A' &&
      Pk(by('s1'), { s1: 'off' }) === 'off' && Pk(by('x:b_b0'), {}) === 'off' && Pk(by('x:b_b0'), { 'x:b_b0': 'B' }) === 'B' && Pk(by('x:b_b0'), { 'x:b_b0': 'A' }) === 'off');
    const order0 = rows.map(r => r.tok);
    const none = P(rows, {}, order0, bRow26);
    check('the plan: all A in A\'s own order is nothing to do',
      !none.replace.length && !none.add.length && !none.drop.length && !none.from.length && !none.order, JSON.stringify(none));
    const plan = P(rows, { s1: 'off', s2: 'B', 'x:b_b2': 'B' }, order0, bRow26);
    check('...A Off is taken out, A as B has B\'s words in its place, B\'s own kept comes in (where the list has it), noted where each came from and which liturgy was taken from',
      plan.drop.join() === 's1' && plan.replace.length === 1 && plan.replace[0].secId === 's2' && plan.replace[0].items[0].title === 'Confession B' &&
      plan.add.length === 1 && plan.add[0].key === 'b_b2' && plan.add[0].title === 'Advent Wreath' && plan.order.join() === 's2,x:b_b2,s3,s4' &&
      plan.map.s2.row === 'B' && plan.map.s2.secTitle === 'CONFESSION' && plan.map['x:b_b2'].secTitle === 'Advent Wreath' && plan.from.map(f => f.id).join() === 'B', JSON.stringify(plan));
    const moved = P(rows, {}, ['s3', 's1', 's2', 'x:b_b0', 's4'], bRow26), dropOnly = P(rows, { s4: 'off' }, order0, bRow26);
    check('...a new order goes with the plan (B\'s sections left Off out of it); a section taken out alone moves nothing',
      moved.order.join() === 's3,s1,s2,s4' && !moved.from.length && dropOnly.drop.join() === 's4' && !dropOnly.order, JSON.stringify([moved, dropOnly]));
  } catch (e) { check('the blend\'s rows and plan run', false, e.stack); }
  try {
    const sunny = { id: 'sun', title: 'For this Sunday' }, used = { id: 'used', title: 'In use' }, other = { id: 'oth', title: 'Other Sundays' };
    const O = new Function('_llSundayOf', '_sp', '_spPickGroups', fn('_spBlendOthers') + '\nreturn _spBlendOthers;')(
      () => ({ occ: 'advent', key: 'advent:1' }), { occ: 'advent' }, (rs, k) => ({ suit: k === 'advent:1' ? [used, sunny] : [], other: [other] }));
    check('B is chosen from every Liturgy App File, those for this Sunday first; the one in use too, last -- this year\'s may have left some of it behind',
      O({ next: { day: '1st Sunday of Advent' }, rows: [] }, 'used').map(r => r.id).join() === 'sun,oth,used');
  } catch (e) { check('the files to blend with run', false, e.stack); }
  try {
    const log = [], cleared = {};
    const order = { id: 'o', template: { serviceLiturgy: { id: 'A', title: 'No Communion', blendMap: { s1: { row: 'B' }, s2: { row: 'B' } } } },
      sectionLayout: [{ id: 's1', title: 'Gather' }, { id: 's2', title: 'Confession' }, { id: 's3', title: 'Kyrie' }],
      allItems: [{ id: 'g1', itemType: 'liturgy', sectionId: 's1', sourceId: 'doc_1' }, { id: 'g2', itemType: 'content', sectionId: 's1' }, { id: 'rd', itemType: 'scripture', sectionId: 's1' },
                 { id: 'k1', itemType: 'liturgy', sectionId: 's3', sourceId: 'doc_3' }] };
    const songs = [{ id: 'song1', sec: 's1' }, { id: 'song2', sec: 's3' }];
    const lid = id => { for (let k = 0; k < order.sectionLayout.length; k++) if (order.sectionLayout[k].id === id) return k; return -1; };
    const env = { _lbdIsActive: () => true, _woLcdInPage: () => false, _lbdPfx: () => 'o__', _lbdUid: () => 'u1',
      _woSectionList: () => order.sectionLayout.map(x => ({ id: x.id, title: x.title })), _lbdSecIndex: lid,
      _soSaveSettled: () => Promise.resolve(true), _lbdChange: f => { log.push('change'); return f() !== false; },
      _lbdClearClearedFor: () => {}, _lbdNoteCleared: () => {}, _lbdSortSongsByService: () => {},
      songOrderSections: songs, _woSongSectionIds: sg => sg.sec ? [sg.sec] : [], _lbdUnplaceSong: (sg, id) => { log.push('unplace ' + sg.id + ' ' + id); sg.sec = ''; },
      _woUserClearedTypes: cleared };
    const keys = Object.keys(env);
    const W = new Function(...keys, 'var currentOrderData = null;' + ['_woLibHeld', '_woLibBlend'].map(fn).join('\n') +
      '\nreturn { blend: _woLibBlend, hold: function(o) { currentOrderData = o; } };')(...keys.map(k => env[k]));
    W.hold(order);
    const res = await W.blend('o', { replace: [], add: [], drop: ['s1', 'gone'], from: [], map: {} });
    check('a section left Off comes out of the order with what is in it; its songs stay, without a section; one Undo; its note of where it came from let go',
      order.sectionLayout.map(x => x.title).join() === 'Confession,Kyrie' && order.allItems.map(x => x.id).join() === 'k1' &&
      log.join() === 'change,unplace song1 s1' && songs[1].sec === 's3' && cleared.liturgy === true && cleared.content === true && res.n === 1 &&
      !order.template.serviceLiturgy.blendMap.s1 && order.template.serviceLiturgy.blendMap.s2.row === 'B', JSON.stringify([order, log, res]));
  } catch (e) { check('the blend\'s Off runs', false, e.stack); }
  const bd26 = fn('_spBlendDraw');
  check('the window says first which is which: A this year\'s liturgy (by its date, as it is now), B the one to blend with -- a choice when there are several, the original marked',
    /<span class="spb2-pill is-a">A<\/span><span class="spb2-kt"><small>This year’s<\/small>/.test(bd26) && /<span class="spb2-pill is-b">B<\/span><span class="spb2-kt"><small>Blend with<\/small>/.test(bd26) &&
    /onchange="LiturgyModule\.spoBlendWith\(this\.value\)"/.test(bd26) && /r\.id === b\.aId \? ' · its original' : ''/.test(bd26) &&
    /aName: 'This year’s liturgy', aYear: d\.next \? _lfShortDate\(d\.next\.key\) \+ ', as it is now'/.test(fn('spoBlend')) &&
    /b\.bId = id; _spBlendReset\(\); _spBlendDraw\(\);/.test(fn('spoBlendWith')) && /b\.choice = \{\}; b\.order = b\.rows\.map/.test(fn('_spBlendReset')));
  check('...every row its grip, its number (– when Off), a name that opens A and B side by side, and A / B / Off -- each greyed where it cannot be had, Off never for the readings',
    /class="spo-grip spb-grip" data-tok="/.test(bd26) && /\(off \? '–' : num\)/.test(bd26) && /LiturgyModule\.spoBlendOpen\(this\.dataset\.tok\)/.test(bd26) &&
    /'<div class="spb2-cmp">' \+ col\('A', r\) \+ col\('B', r\)/.test(bd26) && /opt\('A', 'A', !!r\.a, /.test(bd26) && /opt\('B', 'B', !!r\.b, /.test(bd26) &&
    /opt\('off', 'Off', !\(r\.a && r\.a\.reads\), 'It holds the readings'\)/.test(bd26) && /class="spb2-o spb2-na"/.test(bd26) &&
    /onclick="LiturgyModule\.spoBlendSet\(this\.dataset\.tok, this\.dataset\.c\)"/.test(bd26));
  check('...B\'s words open in its own preview at the section; the foot counts the sections kept and from where; a redraw keeps the place; drag reorders',
    /var peek = has && side === 'B';/.test(bd26) && /if \(side === 'B' && r\.b\) _spOpenSvlAt\(b\.bId, r\.b\.title\);/.test(fn('spoBlendPeek')) &&
    /li\.classList\.add\('is-hit'\);/.test(fn('_spOpenSvlAt')) && /' sections · ' \+ t\.A \+ ' from A · ' \+ t\.B \+ ' from B<\/span>'/.test(bd26) &&
    /if \(bodyNow && scrollWas\) bodyNow\.scrollTop = scrollWas;/.test(bd26) && /_spBlDragBind\(el\);/.test(bd26) &&
    /if \(!cancel && _spBl && toks\.join\('\|'\) !== _spBl\.order\.join\('\|'\)\) \{ _spBl\.order = toks; _spBl\.moved = true; \}/.test(fn('_spBlDragBind')));
  check('Blend counts every change (Off too) and is the Builder\'s; nothing chosen says what to do',
    /plan\.replace\.length \+ plan\.add\.length \+ plan\.drop\.length \+ \(plan\.order && b\.moved \? 1 : 0\)/.test(fn('_spBlendChanges')) &&
    /WO\.libBlend\(oid, c\.plan\)/.test(fn('spoBlendGo')) && /Choose B or Off for a section, or drag them into a new order first\./.test(fn('spoBlendGo')) &&
    /This is the new draft of this year’s liturgy/.test(fn('spoBlendGo')) &&
    /spoBlendWith: spoBlendWith, spoBlendSet: spoBlendSet, spoBlendOpen: spoBlendOpen, spoBlendPeek: spoBlendPeek/.test(SRC) &&
    !/spoBlendPick|spoBlendAdd|spoBlendSrc|_spBlendModel/.test(SRC));
  // ------------------------------------------------------------ 27. Which liturgy is in use: one copy
  // Found on 2026-11-16 in the live 29 Nov service: Behold's four sections
  // under No Communion's name. The page read which liturgy was in use from the
  // database and the order of service from the Liturgy Builder's copy; back
  // from a Use whose save had not landed, it compared No Communion's order
  // with Behold, and Reset to original put Behold back.
  console.log('\n27. Which liturgy is in use: one copy');
  try {
    const tplNow = { serviceLiturgy: { id: 'NC', title: 'No Communion' } };
    const win = { WO: { libTplOf: id => id === 'o29' ? tplNow : null } };
    const T = new Function('window', 'WO', fn('_spTpl') + '\nreturn _spTpl;')(win, win.WO);
    const stale = { order: { id: 'o29' }, orderTpl: { serviceLiturgy: { id: 'BH', title: 'Behold' } } };
    check('the page reads the template from the Builder\'s copy while it holds the order, else the stored one',
      T(stale) === tplNow && T({ order: { id: 'other' }, orderTpl: stale.orderTpl }) === stale.orderTpl && T(null) === null && T({ order: null, orderTpl: null }) === null);
    const sbAsked = [];
    const O = new Function('window', 'WO', 'SBQ_LITURGY', '_spData', 'renderService', fn('_spTpl') + '\n' + fn('_spOrigRow') + '\nreturn _spOrigRow;')(
      win, win.WO, { _sb: () => ({ from: () => { sbAsked.push(1); return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }; } }) }, null, () => {});
    const d = Object.assign({ rows: [{ id: 'BH', title: 'Behold' }, { id: 'NC', title: 'No Communion' }] }, stale);
    check('...so the original compared with is the liturgy the Builder\'s copy is on (No Communion), not the stored one from before its save (Behold)',
      O(d).id === 'NC' && !sbAsked.length);
  } catch (e) { check('the template is read from one copy', false, e.stack); }
  check('every read of which liturgy is in use goes through _spTpl; the stored template is only written (load, read again) and read there',
    (SRC.match(/d\.orderTpl/g) || []).length === 3 && !/orderTpl\.serviceLiturgy|orderTpl && /.test(SRC) &&
    /return mem \|\| d\.orderTpl \|\| null;/.test(fn('_spTpl')) && /tpl = _spTpl\(d\), svl = tpl && tpl\.serviceLiturgy;/.test(fn('_spInUseHtml')) &&
    /var rec = _spUseRecord\(tpl, /.test(fn('spoRemove')) && /var svl = \(_spTpl\(d\) \|\| \{\}\)\.serviceLiturgy;/.test(fn('_spOrigRow')));
  check('...the Builder\'s template under the outline\'s own rule; its save can be waited on',
    /if \(!_woLibHeld\(orderId\) \|\| !_lbdIsActive\(\) \|\| _woLcdInPage\(\)\) return null;\s*return currentOrderData\.template/.test(fn('_woLibTplOf')) &&
    /libTplOf: _woLibTplOf, libSaveNow: function\(ms\) \{ return _soSaveSettled\(ms\); \}/.test(SRC));
  check('back from the Builder, the page reads the stored order again once the save has landed',
    /saved = WO\.libSaveNow\(12000\);/.test(fn('llBackToLib')) && /if \(saved\) saved\.then\(function\(ok\) \{ if \(ok && _sp\.occ === b\.occ\) _spOrderReread\(\); \}\);/.test(fn('llBackToLib')) &&
    /d\.orderTpl = \(got\.order && got\.order\.template\) \|\| \{\};/.test(fn('_spOrderReread')) && /if \(_spData !== d\) return false;/.test(fn('_spOrderReread')));
  check('the comparison names the file it was worked out against, and Reset and the window\'s Save carry it',
    /c\.origId = row\.id;/.test(fn('_spCmpNow')) && /Object\.assign\(\{ unblend: true, origId: c\.cmp\.origId \}, plan\)/.test(fn('spoPutAll')) &&
    /plan\.origId = P\.origId;/.test(fn('spoPadSave')) && /if \(plan\.origId && !\(tv && tv\.id === plan\.origId\)\)/.test(fn('_woLibPad')) &&
    /if \(err && err\.code === 'changed'\) _spOrderReread\(\);/.test(fn('_spEdit')));
  try {
    const log = [];
    const order = { id: 'o29', template: { serviceLiturgy: { id: 'NC', title: 'No Communion' } },
      sectionLayout: [{ id: 's1', title: 'Gather' }, { id: 's2', title: 'Confession' }],
      allItems: [{ id: 'x1', itemType: 'liturgy', sectionId: 's1', sourceId: 'doc_1', slides: [{ content: 'Old' }] }] };
    let held = true, active = true, stored = { serviceLiturgy: { id: 'NC' } }, readFails = false;
    const sb = { from: t => ({ select: () => ({ eq: () => ({ maybeSingle: () => { log.push('read ' + t); return readFails ? Promise.reject(new Error('down')) : Promise.resolve({ data: { template: JSON.stringify(stored) } }); } }) }) }) };
    const env = { _woLibHeld: () => held, _lbdIsActive: () => active, _woLcdInPage: () => false, _lbdPfx: () => 'o29__', _lbdUid: () => 'u1',
      _woSectionList: () => order.sectionLayout.map(x => ({ id: x.id, title: x.title })), _lbdSecIndex: () => -1,
      _soSaveSettled: () => Promise.resolve(true), _lbdChange: f => { log.push('change'); return f() !== false; },
      _lbdClearClearedFor: () => {}, _lbdNoteCleared: () => {}, _lbdSortSongsByService: () => {}, _woLibKeepBg: (a, b) => b, _woLibReorder: L => ({ layout: L, changed: false }),
      _woStripNum: t => t, songOrderSections: [], _woSongSectionIds: () => [], _lbdUnplaceSong: () => {},
      _woLibSetSlides: (oid, id) => { log.push('write ' + id); return Promise.resolve({ before: [] }); }, SBQ: { _sb: () => sb } };
    const keys = Object.keys(env);
    const R = new Function(...keys, 'var currentOrderData = null;' + fn('_woLibRestore') + '\nreturn { restore: _woLibRestore, hold: function(o) { currentOrderData = o; } };')(...keys.map(k => env[k]));
    R.hold(order);
    const put = { put: [{ id: 'x1', slides: [{ content: 'Behold words' }] }] };
    let err = null;
    await R.restore('o29', Object.assign({ origId: 'BH' }, put)).catch(e => { err = e; });
    check('Reset planned against Behold, on a service now on No Communion: refused in the Builder\'s copy, nothing changed',
      err && err.code === 'changed' && /changed since the page was drawn/.test(err.message) && !log.length && order.allItems[0].slides[0].content === 'Old', JSON.stringify(log));
    const ok = await R.restore('o29', Object.assign({ origId: 'NC' }, put));
    check('...planned against the liturgy it is on: made, as before', ok.via === 'builder' && ok.put === 1 && order.allItems[0].slides[0].content === 'Behold words' && log.join() === 'change');
    held = false; active = false; log.length = 0; err = null;
    stored = { serviceLiturgy: { id: 'NC' } };
    await R.restore('o29', Object.assign({ origId: 'BH' }, put)).catch(e => { err = e; });
    check('...on the stored rows: the stored order\'s liturgy read first, and another one refuses before any row is written',
      err && err.code === 'changed' && log.join() === 'read orders', JSON.stringify(log));
    log.length = 0;
    const ok2 = await R.restore('o29', Object.assign({ origId: 'NC' }, put));
    readFails = true;
    const ok3 = await R.restore('o29', Object.assign({ origId: 'BH' }, put));
    check('...the same liturgy writes; a read that fails does not block', ok2.via === 'stored' && ok3.via === 'stored' && log.join() === 'read orders,write x1,read orders,write x1', JSON.stringify(log));
  } catch (e) { check('Reset\'s check runs', false, e.stack); }
  try {
    // A fake clock: the Builder already showing the order (the editor up),
    // and the reload landing three ticks later.
    let now = 0, timers = [], nextId = 1;
    const later = (fn, ms, every) => { const id = nextId++; timers.push({ id, at: now + ms, fn, every }); return id; };
    const clock = { setTimeout: (fn, ms) => later(fn, ms || 0, 0), setInterval: (fn, ms) => later(fn, ms, ms), clearInterval: id => { timers = timers.filter(t => t.id !== id); } };
    const run = ms => { const end = now + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > end) break; now = t.at; if (t.every) t.at += t.every; else timers.shift(); t.fn(); } now = end; };
    const log = []; let seq = 4, cur = 'o29';
    const WOs = { openedSeq: () => seq, loadOrder: id => { log.push('load ' + id); clock.setTimeout(() => { seq++; log.push('opened'); }, 1100); },
      selectOrder: m => log.push('select ' + m), currentOrderId: () => cur };
    const doc = { getElementById: () => ({ style: { display: 'block' } }) };
    const toasts = [];
    const L = new Function('_llShown', '_sp', 'getOccasionById', 'setActiveView', '_llBackBar', 'WO', 'document', 'setTimeout', 'setInterval', 'clearInterval', 'showToast',
      'var _llBack = null;\n' + fn('_llOpenInBuilder') + '\nreturn _llOpenInBuilder;')(
      () => false, { occ: '' }, () => null, () => {}, () => {}, WOs, doc, clock.setTimeout, clock.setInterval, clock.clearInterval, m => toasts.push(m));
    L('o29', () => log.push('then'));
    run(1000);
    const early = log.slice();
    run(3000);
    check('opening the Builder from the page waits for THIS load to open the order before choosing the Builder, with the editor already up',
      early.join() === 'load o29' && log.join() === 'load o29,opened,select liturgy,then', JSON.stringify(log));
    log.length = 0; seq = 4; timers = [];
    WOs.loadOrder = id => log.push('load ' + id);
    L('o29', () => log.push('then'));
    run(20000);
    check('...and says so when it never opens, rather than doing nothing', log.join() === 'load o29' && /took too long to open\. Nothing was changed/.test(toasts.join()), JSON.stringify([log, toasts]));
    check('...the count moves as an order is opened, after the step chooser', /showOrderModeLanding\(\);\s*_woOpenedSeq\+\+;/.test(fn('openOrderInEditor')) && /openedSeq: function\(\) \{ return _woOpenedSeq; \}/.test(SRC));
  } catch (e) { check('opening the Builder runs', false, e.stack); }
  // ------------------------------------------------------------ 28. A section of its own for each reading
  // From the operator (2026-11-16), after the 29 Nov service was put back on
  // No Communion: all four readings sat under "1st Reading" while its Psalm,
  // 2nd Reading and Gospel Reading stood empty.
  console.log('\n28. A section of its own for each reading');
  const nc28 = [{ id: 'doc10', title: 'Word', serviceSectionId: '' }, { id: 'wo-section-0', title: '1st Reading', serviceSectionId: 'scripture' },
    { id: 'doc12', title: 'Psalm', serviceSectionId: 'scripture' }, { id: 'doc13', title: '2nd Reading', serviceSectionId: 'scripture' },
    { id: 'doc14', title: 'Gospel Acclamation', serviceSectionId: 'scripture' }, { id: 'doc15', title: 'Gospel Reading', serviceSectionId: 'scripture' }];
  try {
    const RS = new Function(fn('_woReadingSecs') + '\nreturn _woReadingSecs;')();
    const sc = (t, k) => ({ id: t, title: t, serviceSectionId: k === undefined ? 'scripture' : k });
    check('each reading has the section of the readings\' kind named for it; "Gospel Acclamation" and "Scripture Readings" name none',
      JSON.stringify(RS(nc28)) === JSON.stringify({ reading1: 'wo-section-0', psalm: 'doc12', reading2: 'doc13', gospel: 'doc15' }) &&
      JSON.stringify(RS([sc('Scripture Readings')])) === '{}', JSON.stringify(RS(nc28)));
    check('...by what the name says ("4. Epistle", "Old Testament Lesson", "The Holy Gospel"), never a section of another kind, and a reading two sections are named for goes to neither',
      JSON.stringify(RS([sc('4. Epistle'), sc('Old Testament Lesson'), sc('The Holy Gospel'), sc('Gospel Verse')])) === JSON.stringify({ reading2: '4. Epistle', reading1: 'Old Testament Lesson', gospel: 'The Holy Gospel' }) &&
      JSON.stringify(RS([sc('Psalm', ''), sc('Psalm of the Day', 'confession')])) === '{}' &&
      JSON.stringify(RS([sc('Psalm'), sc('Psalm 80'), sc('Gospel')])) === JSON.stringify({ gospel: 'Gospel' }) && JSON.stringify(RS(null)) === '{}');
  } catch (e) { check('the readings\' sections run', false, e.stack); }
  try {
    const mk = (layout, items) => {
      const order = { id: 'o', serviceDate: 'Nov 29', sectionLayout: layout, allItems: items || [] };
      const env = { showToast: () => {}, _lbdNormDate: x => x, _yearForOrder: () => 2026, _monthFromDateStr: () => 10,
        LiturgyModule: { fetchPassage: ref => Promise.resolve({ reference: ref, text: 'words of ' + ref }) },
        _lbdRosterReadings: () => Promise.resolve({ reading1: 'Isaiah 64:1-9', psalm: 'Psalm 80:1-7', reading2: '1 Corinthians 1:3-9', gospel: 'Mark 13:24-37' }),
        _woSectionList: () => order.sectionLayout.map(x => ({ id: x.id, title: x.title, serviceSectionId: x.serviceSectionId || '' })),
        _woSectionItems: id => order.allItems.filter(it => it.sectionId === id), _woEnsureLayout: () => order.sectionLayout,
        _lbdSlotLabels: id => id === 'wo-section-0' ? ['First Reading', 'Psalm', 'Second Reading', 'Gospel'] : [],
        _woReadingsTodo: (w, b, h) => w.filter(x => !h[x.role]), _woReadingsNoted: () => ({}), _woNoteReadings: () => {}, _woLcdInPage: () => false,
        _lbdChange: f => f() !== false, getOrderType: () => 'special', _woUndoOpts: () => ({}),
        _lbdReadingItem: (sid, r) => ({ id: 'r' + order.allItems.length, itemType: 'scripture', sectionId: sid, title: r.title, content: { subLabel: r.subLabel } }),
        setTimeout: f => f() };
      const keys = Object.keys(env);
      const F = new Function(...keys, 'var currentOrderData = null; var READING_ROLES = [{ role: "reading1", label: "First Reading" }, { role: "psalm", label: "Psalm" }, { role: "reading2", label: "Second Reading" }, { role: "gospel", label: "Gospel Reading" }];\n' +
        ['_roleForSlotLabel', '_woReadingSecs', '_lbdScriptureSection', '_lbdSlotForRole', '_lbdReadingTaken', '_lbdFillReadings'].map(fn).join('\n') +
        '\nreturn { fill: _lbdFillReadings, hold: function(o) { currentOrderData = o; } };')(...keys.map(k => env[k]));
      F.hold(order);
      return { order, fill: F.fill };
    };
    const a = mk(JSON.parse(JSON.stringify(nc28)));
    const n1 = await a.fill({ quiet: true });
    const n2 = await a.fill({ quiet: true });
    const where = o => o.allItems.map(it => it.content.subLabel + '@' + it.sectionId).join(', ');
    check('the Roster\'s readings go each into its own section where the order has one -- the psalm under Psalm, the gospel under Gospel Reading, not Gospel Acclamation',
      n1 === 4 && where(a.order) === 'First Reading@wo-section-0, Psalm@doc12, Second Reading@doc13, Gospel Reading@doc15', where(a.order));
    check('...and a reading in any section is had: asked again, nothing comes twice', n2 === 0 && a.order.allItems.length === 4);
    const b = mk(JSON.parse(JSON.stringify(nc28)), [{ id: 'p', itemType: 'scripture', sectionId: 'doc12', title: 'Psalm 80:1-7', content: { subLabel: 'Psalm' } }]);
    const n3 = await b.fill({ quiet: true });
    const c = mk([{ id: 'wo-section-6', title: 'Scripture Readings', serviceSectionId: 'scripture' }, { id: 'wo-section-7', title: 'Sermon', serviceSectionId: 'message' }]);
    await c.fill({ quiet: true });
    check('...a psalm already under Psalm stays the one; an order with one Scripture Readings section has all four there, as before',
      n3 === 3 && b.order.allItems.filter(it => it.content.subLabel === 'Psalm').length === 1 &&
      c.order.allItems.length === 4 && c.order.allItems.every(it => it.sectionId === 'wo-section-6'), where(b.order) + ' | ' + where(c.order));
  } catch (e) { check('the fill runs', false, e.stack); }
  // ------------------------------------------------------------ 29. The landing's cards, a year's two sections, and what Use adds
  // From the operator (2026-11-17), on four marked-up screenshots: the
  // landing's open buttons out, an arrow badge on each header, each 20px
  // shorter, Church Year then Recently added, no This Sunday; a year's app
  // files and its documents in separate sections, the app files first, a +
  // and a drop zone on the documents, the green + gone; Add to it all ticked
  // at first with Select all / Select none, what is alike marked, other
  // liturgies added beside it, and a side-by-side window with highlights
  // that can be taken off and put back.
  console.log('\n29. The landing\'s cards, a year\'s two sections, and what Use adds');
  const hub29 = fn('renderHub');
  check('the landing: each card one button, its header, with an arrow badge; no open button under it, no This Sunday; Church Year before Recently Added',
    /'<button type="button" class="ll-card ll-card--' \+ c\.k \+ '" style="--ll-i:' \+ i \+ '" onclick="' \+ c\.fn \+ '" aria-label="' \+ _lfE\(c\.go\) \+ '">'/.test(hub29) &&
    /<span class="ll-card__arrow" aria-hidden="true"><span class="ll-card__open">Open<\/span><i class="fa-solid fa-arrow-right"><\/i><\/span>/.test(hub29) && !/ll-card__go|ll-card__body|ll-sun|This Sunday<\/h2>|_llSundayVerseLoad/.test(hub29) &&
    hub29.indexOf('llYearTtl') > 0 && hub29.indexOf('llYearTtl') < hub29.indexOf('llRecentTtl'));
  const res29 = fn('_spResHtml');
  // (Its Liturgy App Files went from the year the same day: see section 30.)
  check('a year: its liturgy documents in the Files Repository\'s box, with a + that uploads into that year, and a drop zone',
    /class="svp-up" data-y="' \+ _lfE\(upY\) \+ '" onclick="LiturgyModule\.spUpload\(\\'liturgy\\', this\.dataset\.y\)"/.test(res29) &&
    /ondragover="LiturgyModule\.spDocsOver\(event, this\)" ondragleave="LiturgyModule\.spDocsLeave\(event, this\)" ondrop="LiturgyModule\.spDocsDrop\(event, this\)"/.test(res29) &&
    /@media \(hover: hover\) and \(pointer: fine\) \{ \.svp-drop \{ display: flex; \} \}/.test(SRC) &&
    /_spUpYear = _spYearIn\(year\);/.test(fn('spUpload')) && /year = ym \? ym\[0\] : \(yearDef \|\| String\(new Date\(\)\.getFullYear\(\)\)\);/.test(fn('_spUploadOne')));
  check('...and the green + is not on a service\'s page', /#liturgyView\[data-ll="service"\] \.lit-add-fab \{ display: none; \}/.test(SRC) && /id === 'liturgyServicePanel' \? 'service'/.test(fn('_llShowOnly')));
  try {
    const sent = [];
    const D = new Function('_spUploadFiles', ['_spDragHasFiles', 'spDocsOver', 'spDocsLeave', 'spDocsDrop'].map(fn).join('\n') + '\nreturn { over: spDocsOver, leave: spDocsLeave, drop: spDocsDrop };')(
      (files, mode, y) => sent.push(files.map(f => f.name).join('+') + ' ' + mode + ' ' + y));
    const cls = new Set(), el = { classList: { add: c => cls.add(c), remove: c => cls.delete(c) }, contains: () => false, getAttribute: () => '2025' };
    let stopped = 0;
    const ev = (types, files) => ({ dataTransfer: { types, files: files || [], dropEffect: '' }, preventDefault: () => stopped++ });
    D.over(ev(['application/x-lhc-item', 'text/plain']), el);
    const rowDrag = stopped === 0 && !cls.has('is-drop');
    D.over(ev(['Files']), el);
    const fileDrag = stopped === 1 && cls.has('is-drop');
    D.drop(ev(['Files'], [{ name: 'Advent 2025.docx' }, { name: 'b.pdf' }]), el);
    check('files dropped from the desktop upload into that year as liturgies; a row dragged onto a year chip is not taken for them',
      rowDrag && fileDrag && !cls.has('is-drop') && sent.join() === 'Advent 2025.docx+b.pdf liturgy 2025', JSON.stringify(sent));
  } catch (e) { check('the drop zone runs', false, e.stack); }
  try {
    const K = new Function(fn('_spBlKey') + '\nreturn _spBlKey;')();
    const L = new Function('_spBlKey', 'var SP_SIM_STOP = ' + SRC.match(/var SP_SIM_STOP = ([^;]+);/)[1] + ';\n' +
      ['_spSimNorm', '_spShingles', '_spSimOf', '_spNameAlike', '_spSecTexts', '_spLikeOf', '_spCmpRows', '_spCmpLines'].map(fn).join('\n') +
      '\nreturn { norm: _spSimNorm, sh: _spShingles, sim: _spSimOf, name: _spNameAlike, secs: _spSecTexts, like: _spLikeOf, rows: _spCmpRows, lines: _spCmpLines };')(K);
    check('words are compared without the speaker\'s mark, punctuation or case; in runs of three',
      L.norm('L: The Lord be with you.\nC: And also with you!') === 'the lord be with you and also with you' && Object.keys(L.sh('Lord, have mercy')).join() === 'lord have mercy' &&
      L.sim('Lord have mercy upon us', 'C: Lord, have mercy upon us. Christ have mercy.') === 1 && L.sim('we confess our sins', 'grace and peace to you') === 0 && L.sim('', 'x') === 0);
    check('names alike by their words, the common ones aside ("Prayer", "Day", "Advent", "Service")',
      L.name('Holy Communion', 'An Advent Communion Service') && L.name('Confession', '2. Confession & Absolution') && !L.name('Prayer of the Day', 'Prayer after Communion') &&
      !L.name('Sharing of Peace', 'Sharing the Bread & Cup') && !L.name('Lighting of the Advent Wreath', 'An Advent Communion Service') && !L.name('', 'x'));
    const data = { sectionLayout: [{ id: 'a', title: '1. Invocation' }, { id: 'b', title: 'Gather' }, { id: 'c', title: 'Readings' }],
      items: [{ itemType: 'liturgy', sectionId: 'a', slides: [{ content: 'L: In the name of the Father' }, { content: 'C: Amen.' }] }, { itemType: 'content', sectionId: 'b', content: { text: 'Welcome all' } },
              { itemType: 'scripture', sectionId: 'c', slides: [{ content: 'Isaiah 64' }] }, { itemType: 'song', sectionId: 'b' }] };
    const secs = L.secs(data);
    check('a liturgy\'s sections with their words: liturgy and text only, never its readings or songs; a name without its number',
      secs.map(x => x.title + '=' + x.text.replace(/\n/g, '/')).join(';') === 'Invocation=L: In the name of the Father/C: Amen.;Gather=Welcome all;Readings=' && secs[0].key === 'invocation', JSON.stringify(secs));
    const lk = L.like({ title: 'Invocation', text: 'In the name of the Father and of the Son' }, [{ title: 'Section', text: 'P: In the name of the Father and of the Son and of the Holy Spirit', from: 'Behold' }, { title: 'Invocation', text: '', from: 'Trad' }]);
    const none = L.like({ title: 'Peace', text: 'The peace of the Lord be with you always' }, [{ title: 'Kyrie', text: 'Lord have mercy Christ have mercy', from: 'x' }]);
    check('what a piece is like: the section with most of its words (and how much), and those of a name like it; nothing when neither',
      lk.words && lk.words.title === 'Section' && lk.words.from === 'Behold' && lk.words.pct === 1 && lk.name.length === 1 && lk.name[0].from === 'Trad' &&
      !none.words && !none.name.length, JSON.stringify([lk, none]));
    const sx = (k, t) => ({ id: k, key: k, title: t || k, text: t || '' });
    const rows = L.rows([{ secs: [sx('invocation'), sx('confession'), sx('kyrie')] }, { secs: [sx('gather'), sx('confession'), sx('wreath'), sx('kyrie')] }, { secs: [sx('absolution')] }]);
    check('the comparison\'s rows: the first column\'s sections in order, the others lined up by name, those of no name there by their neighbour; none matched, last',
      rows.map(r => r.key + ':' + r.cells.map(c => c ? 'x' : '-').join('')).join(' ') === 'invocation:x-- gather:-x- confession:xx- wreath:-x- kyrie:xx- absolution:--x',
      rows.map(r => r.key + ':' + r.cells.map(c => c ? 'x' : '-').join('')).join(' '));
    const ln = L.lines([{ secs: [{ id: 'a', text: 'L: The Lord be with you\nC: And also with you\nLet us pray for the world' }] }, { secs: [{ id: 'b', text: 'P: The Lord be with you.\nGrace to you and peace' }] }]);
    check('...each line lit when it is in another column, the same words or most of its runs of three; else not',
      ln[0].a.map(l => l.same).join() === 'true,false,false' && ln[1].b.map(l => l.same).join() === 'true,false', JSON.stringify(ln));
  } catch (e) { check('the comparisons run', false, e.stack); }
  try {
    const S = new Function(fn('_svlSuppInto') + '\nreturn _svlSuppInto;')();
    const lay = [{ id: 's1', title: 'Section' }, { id: 'tr0', title: 'Invocation' }, { id: 'tr1', title: 'Confession' }, { id: 'p', title: 'Prayer after Communion' }];
    let n = 0, u = 0;
    const f = { id: 'NC', title: 'No Communion', year: 2025, data: {
      sectionLayout: [{ id: 'g', title: 'Gather' }, { id: 'i', title: '3. Invocation' }, { id: 'gr', title: 'Greeting' }, { id: 'c', title: 'Confession' }, { id: 'w', title: 'Advent Wreath' }, { id: 'r', title: '1st Reading' }],
      items: [{ itemType: 'liturgy', sectionId: 'gr', sourceId: 'doc_3', title: 'Greeting', slides: [{ content: 'Grace' }] }, { itemType: 'content', sectionId: 'w', content: { text: 'Light the candle' } },
              { itemType: 'scripture', sectionId: 'r', title: 'Isaiah 64' }, { itemType: 'liturgy', sectionId: 'c', sourceId: 'doc_4', title: 'Confession B', slides: [] }] } };
    const out = S(lay, [f, { id: 'none', data: { sectionLayout: [], items: [] }, secs: [] }].map((x, i) => i ? x : Object.assign({ secs: ['gr', 'w', 'r', 'c'] }, x)),
      { id: () => 'n' + (++n), src: () => 'lbd_' + (++u), pfx: 'o__' });
    check('Use with sections of another file: each after the section it follows there (matched by name here); one of a name the order has, right after that one; its words as this order\'s own, never its readings',
      lay.map(x => x.title).join() === 'Section,Invocation,Greeting,Confession,Confession,Advent Wreath,1st Reading,Prayer after Communion' &&
      out.items.map(x => x.itemType + '@' + x.sectionId + ':' + x.sourceId).join() === 'liturgy@n1:lbd_1,liturgy@n2:lbd_2,content@n3:' &&
      out.items[0].id === 'o__liturgy_lbd_1_n1' && out.from.map(x => x.id).join() === 'NC' && out.map.n3.secTitle === 'Advent Wreath' && out.map.n3.row === 'NC' &&
      out.names.join() === 'Greeting,Confession,Advent Wreath,1st Reading', lay.map(x => x.title + '/' + x.id).join() + ' ' + JSON.stringify(out));
    const lay2 = [{ id: 'x', title: 'Welcome' }];
    S(lay2, [Object.assign({}, f, { secs: ['w'] })], { id: () => 'm1', src: () => 'lbd_9', pfx: '' });
    check('...a section with nothing of its name in the order goes last', lay2.map(x => x.id).join() === 'x,m1');
  } catch (e) { check('the other files\' sections go in', false, e.stack); }
  check('Use carries the other files\' sections ticked into the Builder, which notes them as a blend (Sources lists them); one Undo with the liturgy',
    /var supp = st\.others\.filter\(function\(r\) \{ return u\.supp\[r\.id\]; \}\)/.test(fn('spUseGo')) && /extras: extras, supp: supp, use: \{/.test(fn('spUseGo')) &&
    /suppIn = _svlSuppInto\(currentOrderData\.sectionLayout, more\.supp,/.test(fn('_svlApply')) &&
    /currentOrderData\.template\.serviceLiturgy\.blend = suppIn\.from;\s*currentOrderData\.template\.serviceLiturgy\.blendMap = suppIn\.map;/.test(fn('_svlApply')));
  check('Add to it: every part ticked at first; Select all / Select none for the parts and for each other file; a file added ticks only its sections like nothing going in',
    /if \(!u\.extras\) \{ u\.extras = \{\}; extras\.forEach\(function\(x\) \{ u\.extras\[x\.i\] = true; \}\); \}/.test(fn('_spUseState')) &&
    /allNone\('trad', nOn, st\.extras\.length\)/.test(fn('_spUseStep3')) && /allNone\(r\.id, n, secs\.length\)/.test(fn('_spUseSuppHtml')) &&
    /if \(!lk\.words && !lk\.name\.length\) on\[sx\.id\] = true;/.test(fn('spUseSupp')) && /var lk = _spLikeOf\(\{ title: x\.title, text: x\.text \}, inTrad\);/.test(fn('_spUseStep3')));
  check('the side-by-side window: a column a liturgy (and the Traditional parts), the rows lined up, a line lit when found elsewhere; Highlights off and on in place',
    /var rows = _spCmpRows\(cols\), lines = _spCmpLines\(cols\);/.test(fn('spUseCompare')) && /'<p class="spc-l' \+ \(l\.same \? ' is-same' : ' is-diff'\) \+ '">'/.test(fn('spUseCompare')) &&
    /if \(card\) card\.classList\.toggle\('spc--nohl', !u\.cmpHl\);/.test(fn('spUseCmpHl')) && /\.spc--nohl \.spc-l\.is-same, \.spc--nohl \.spc-l\.is-diff \{ background: transparent; \}/.test(SRC) &&
    /\.spc \{ position: fixed; inset: 0; z-index: 10025;/.test(SRC) && /spUseCmpClose\(\); \}/.test(fn('spUseClose')));
  // ------------------------------------------------------------ 30. A document: converted, and where it is used
  // From the operator (2026-11-17), on two screenshots: the Liturgy App
  // Files section crossed out in a past year and in This Year ("Remove the
  // section. I want to only see if the uploaded doc has been converted and
  // used. If used then it will look like the upper section of the 2026
  // folder. Clicking on the use button will direct the user to where it's
  // being used. Also allow the user to use the same converted liturgy to more
  // than one"), and "Make the design more concise".
  console.log('\n30. A document: converted, and where it is used');
  try {
    const U30 = new Function(fn('_spUsesOf') + '\nreturn _spUsesOf;')();
    const raw = [{ id: 'o29', iso: '2026-11-29', type: 'special', svl: 'NC' }, { id: 'o6', iso: '2026-12-06', type: 'special', svl: 'NC' },
                 { id: 'oPast', iso: '2025-11-30', type: 'traditional', svl: 'NC2' }, { id: 'oOld', iso: '2024-12-01', type: 'traditional', svl: 'NC' },
                 { id: 'oX', iso: '2026-12-13', type: 'contemporary', svl: 'other' }, { id: 'oNo', iso: '', type: '', svl: 'NC' }];
    const u = U30(raw, ['NC', 'NC2'], null, '2026-11-17');
    check('where a file is used (pure): every service on any of its files, the coming ones soonest first, then the past latest first; one with no date left out',
      u.map(x => x.orderId + (x.past ? '(past)' : '')).join() === 'o29,o6,oPast(past),oOld(past)', JSON.stringify(u));
    const live = U30(raw, ['NC'], { orderId: 'o29', svlId: 'Behold' }, '2026-11-17');
    check('...the coming service read as the page reads it, so a Use not yet saved is seen', live.map(x => x.orderId).join() === 'o6,oOld' &&
      U30(raw, ['other'], { orderId: 'oX', svlId: 'other' }, '2026-11-17').map(x => x.orderId).join() === 'oX' && !U30(null, ['NC'], null, '2026-11-17').length);
    const R30 = new Function('_spData', '_spTypeName', '_llCycle', '_lfE', '_spDateTile', '_lfLongDate', fn('_spUseRowHtml') + '\nreturn _spUseRowHtml;')(
      { upcoming: [{ key: '2026-11-29', day: '1st Sunday of Advent', type: 'special' }] }, t => t === 'special' ? 'Special' : t === 'traditional' ? 'Traditional' : 'Contemporary',
      k => k.slice(0, 4) === '2026' ? 'Year B' : 'Year A', x => String(x), k => '<div class="spi-date">' + k.slice(8, 10) + '</div>', k => 'long ' + k);
    const on = R30({ orderId: 'o29', iso: '2026-11-29', type: 'contemporary', past: false }), was = R30({ orderId: 'oOld', iso: '2024-12-01', type: 'traditional', past: true });
    check('...shown as This Year\'s card is: its date, its day, its kind and lectionary year, In use; a past one Used; a press goes there',
      /<div class="spi-date">29<\/div><span class="sp-use2__t"><b>1st Sunday of Advent<\/b><small>Special service · Year B<\/small><\/span><span class="sp-use2__go">In use/.test(on) &&
      /onclick="LiturgyModule\.spGoUse\(this\.dataset\.o, this\.dataset\.k\)"/.test(on) && /class="sp-use2 is-past"/.test(was) && /<b>long 2024-12-01<\/b><small>Traditional service · Year A/.test(was) && />Used</.test(was), on + ' | ' + was);
  } catch (e) { check('where a file is used runs', false, e.stack); }
  const row30 = fn('_spDocRow'), go30 = fn('spGoUse');
  check('a document\'s row, concise: its name; its kind, year (a chip that moves it) and when it was added; ⋯ for preview, rename, year and share',
    /class="sp-ychip" data-id="' \+ id \+ '" onclick="LiturgyModule\.spYearMenu\(this, this\.dataset\.id\)"/.test(row30) && /class="sp-doc2__more"[^>]*onclick="LiturgyModule\.spDocMenu\(this, this\.dataset\.id\)"/.test(row30) &&
    /item\('preview', 'fa-eye', 'Preview'\) \+ item\('rename', 'fa-pen', 'Rename'\) \+ item\('year', 'fa-folder', 'Change its year'\) \+ item\('share', 'fa-share-nodes', 'Share'\)/.test(fn('spDocMenu')) &&
    !/aria-label="Preview" title="Preview"/.test(row30) && !/sp-yearbtn" data-id/.test(row30));
  check('...Convert, or Converted and Use; once used, where (as This Year\'s card) and Use for another service',
    /var uses = conv\.length \? _spUsesFor\(conv\.map\(function\(r\) \{ return r\.id; \}\)\) : \[\];/.test(row30) &&
    /onclick="LiturgyModule\.spUseDoc\(this\.dataset\.id, \{ another: true \}\)"/.test(row30) && /<span>Use for another service<\/span>/.test(row30) &&
    /uses\.map\(_spUseRowHtml\)\.join\(''\)/.test(row30) && /onclick="LiturgyModule\.spUseAnother\(this\.dataset\.id\)"/.test(fn('_spAppRow')));
  check('where it is used: the coming service is This Year\'s card, lit; another date opens in the Liturgy Builder, its Back bar coming here',
    /if \(d && d\.order && d\.order\.id === orderId\) \{\s*_sp\.tab = 'order'; _sp\.res = 'liturgy'; _sp\.year = 'this';/.test(go30) && /el\.classList\.add\('sp-flash'\);/.test(go30) &&
    /_llOpenInBuilder\(orderId\);/.test(go30));
  check('every order\'s liturgy read lightly with the page, and again with the order',
    /select\('id,title,service_date,type,created_date,svl:template->serviceLiturgy'\)\.not\('id', 'like', 'standalone_%'\)/.test(fn('_spUsesLoad')) &&
    /_spUsesLoad\(_spData\);/.test(fn('_spLoad')) && /_spUsesLoad\(d\);/.test(fn('_spOrderReread')));
  check('Use for another service starts on a date not using it; a date that does says so',
    /if \(u\.another && !u\.anotherDone && Object\.keys\(usedKeys\)\.length\) \{/.test(fn('_spUseState')) && /if \(free && usedKeys\[u\.key\]\) u\.key = free\.key;/.test(fn('_spUseState')) &&
    /Uses this liturgy now/.test(fn('_spUseStep1')));
  check('no Liturgy App Files section; the library box has no tooltip over everything in it',
    !fn('_spReadyHtml') && !/class="ll-box sp-res" title=/.test(fn('_spResHtml')) && !/sp-readybox/.test(fn('_spResHtml')));
  // ------------------------------------------------------------ 31. The sizes, and a source named as its document
  // From the operator (2026-11-17), on three marked-up screenshots: the
  // landing's cards "Increase height by 5px each", the Church Year "Reduce
  // overall by 4px", the Services cards "make all cards 5px smaller"; and of
  // the in-use card's source, "name it the exact file name and also show if
  // that is a word doc, pdf, google doc, etc. The year should be a badge
  // hyperlink that directs them to where the file is stored in the app".
  console.log('\n31. The sizes, and a source named as its document');
  check('the sizes: the landing\'s cards 5px taller (47px on a phone, 77px on a desk), the Church Year\'s tiles 2px shorter a row (86px, 108px), every service card 5px shorter',
    /\.ll-season \{ min-height: 86px; font-size: 0\.82rem; \}/.test(SRC) && /\.ll-season \{ display: flex;[^}]*min-height: 108px;/.test(SRC) &&
    /\.ls-card__main \{[^}]*min-height: 111px; \}/.test(SRC) && /\.ls-card__text \{[^}]*padding: 10px 42px 10px 14px; \}/.test(SRC));
  try {
    const items = { d1: { id: 'd1', title: '1st Sunday Advent (Communion)', fileName: 'ignored.docx', fileUrl: 'https://docs.google.com/document/d/x/edit', occasionId: 'advent' } };
    const rows = { NC: { id: 'NC', title: 'No Communion Liturgy Framework - Advent', year: 2025, made_from: 'doc:d1', occasion_id: 'advent' },
                   BH: { id: 'BH', title: 'Saved from the Builder', year: 2023, made_from: 'order:o1', occasion_id: 'advent' } };
    const L = new Function('_spSrcRow', 'getItem', '_spYearOf', '_lfKind', fn('_spOrigTarget') + '\n' + fn('_spSrcLook') + '\nreturn _spSrcLook;')(
      id => rows[id] || null, id => items[id] || null, () => '2025', it => ({ label: /google/.test(it.fileUrl) ? 'Google Doc' : 'Word', badge: 'G' }));
    const doc = L({ id: 'NC', title: 'No Communion Liturgy Framework - Advent', year: 2025, occ: 'advent' });
    const app = L({ id: 'BH', title: 'Saved', year: 2023, occ: 'advent' }), gone = L({ id: 'zz', title: 'Gone one', year: 2022, occ: 'advent' });
    check('a source is named as its document\'s row is, with its kind, in its document\'s year; one with no document as its app file',
      doc.name === '1st Sunday Advent (Communion)' && doc.kind.label === 'Google Doc' && doc.year === '2025' && doc.occ === 'advent' &&
      app.name === 'Saved' && app.kind === null && app.year === '2023' && gone.name === 'Gone one' && gone.year === '2022', JSON.stringify([doc, app, gone]));
    const log = [], sp = { occ: 'advent', from: 'services' };
    const G = new Function('_spSrcRow', 'getItem', '_spYearOf', '_sp', '_spFocusOn', 'openService', 'showToast', 'var _spFocusNext = null;\n' + fn('_spOrigTarget') + '\n' + fn('spoSrcGo') +
      '\nreturn { go: spoSrcGo, next: function() { return _spFocusNext; } };')(
      id => rows[id] || null, id => items[id] || null, () => '2025', sp, f => log.push('focus ' + JSON.stringify(f)), (o) => log.push('open ' + o), m => log.push('toast ' + m));
    G.go('NC'); G.go('BH'); G.go('zz');
    items.d1.occasionId = 'lent'; G.go('NC');
    check('its year badge goes to the file where it is kept: its document in that year\'s folder, lit; an app file of its own, its row; another service\'s, that page first',
      log[0] === 'focus {"fresh":"NC","year":"2025","name":"1st Sunday Advent (Communion)","label":"Here it is"}' &&
      log[1] === 'focus {"fresh":"BH","year":"2023","name":"Saved from the Builder","label":"Here it is"}' && /^toast That liturgy could not be found/.test(log[2]) &&
      log[3] === 'open lent' && G.next().fresh === 'NC', JSON.stringify(log));
  } catch (e) { check('the sources\' names and links run', false, e.stack); }
  const srcH31 = fn('_spSourcesHtml');
  check('...drawn as one badge: the kind\'s logo, the name and the kind\'s name (a press previews it), Original, then the year (a press goes there)',
    /var logo = lk\.kind \? _lfBadge\(lk\.kind\) :/.test(srcH31) && /'<span class="spi-srcb__t"><b>' \+ _lfE\(_spSoftHyph\(lk\.name\)\) \+ '<\/b><small>' \+ _lfE\(lk\.kind \? lk\.kind\.label :/.test(srcH31) &&
    /onclick="LiturgyModule\.spoSrcGo\(this\.dataset\.id\)" title="' \+ _lfE\('Go to it in the ' \+ lk\.year \+ ' folder'\)/.test(srcH31) &&
    /spoSrcGo: spoSrcGo/.test(SRC) && /\(f\.label \|\| 'The original'\) \+ ': '/.test(fn('_spFocusOn')) && /var r = _spSrcRow\(id\);/.test(fn('spoSrc')));
  // ------------------------------------------------------------ 32. The liturgy window
  // From the operator (2026-11-17), on the in-use card with its list crossed
  // out: Show liturgy "will instead open up a window like the All Slides pad
  // where the user can start editing the liturgy intended to use ... drag
  // and drop to rearrange and also edit the header and content and add
  // sections and remove. Make sure the changes are tracked against the
  // original and give the option for the user to revert the entire liturgy
  // to the original or just some sections".
  console.log('\n32. The liturgy window');
  try {
    const C = new Function(fn('_spCompare') + '\nreturn _spCompare;')();
    const f = [{ id: 'f1', itemType: 'liturgy', sourceId: 'd1', title: 'Absolution', sectionId: 's', slides: [{ content: 'x' }] }];
    const c = C(f, [{ id: 'o1', itemType: 'liturgy', sourceId: 'd1', title: 'Words of Forgiveness', sectionId: 's', slides: [{ content: 'x' }] }], {}, ['s']);
    const R = new Function(fn('_spResetPlan') + '\nreturn _spResetPlan;')();
    const pl = R(Object.assign(c, { secs: { gone: [], renamed: {}, moved: {}, added: {}, order: ['s'] } }));
    check('a part renamed is a change (a subsection\'s heading): counted, and Reset to original puts its name back',
      c.byItem.o1.st === 'same' && c.byItem.o1.renamed === 'Absolution' && c.renamedParts === 1 && c.byItem.o1.fi === 0 && c.file.length === 1 &&
      pl.put.length === 1 && pl.put[0].title === 'Absolution' && pl.put[0].slides === null &&
      /if \(x\.title && String\(x\.title\)\.trim\(\)\) all\[i\]\.title = String\(x\.title\)\.trim\(\);/.test(fn('_woLibRestore')) && /part renamed/.test(fn('_spCmpBits')), JSON.stringify(pl));
  } catch (e) { check('the part rename runs', false, e.stack); }
  try {
    const names = ['_spOutline', '_spoSlidesOf', '_spCompare', '_spCompareSecs', '_spCmpCounts', '_spCmpBits', '_spPadFrom', '_spPadClone', '_spPadSid', '_spPadPid', '_spPadSec', '_spPadWords',
      '_spPadItems', '_spPadCmp', '_spPadSecState', '_spPadBack', '_spPadInsertGone', '_spPadSortParts', '_spPadPlaceSec', '_spPadRevertSec', '_spPadRevertPart', '_spPadPutSec',
      '_spPadPutPart', '_spPadReorder', '_spPadReset', '_spPadPlan'];
    const X = new Function("var SP_PAD_TYPE = { liturgy: 'liturgy', reading: 'scripture', text: 'content', song: 'song' };\n" + names.map(fn).join('\n') +
      '\nreturn {' + names.map(n => n + ': ' + n).join(', ') + '};')();
    const file = { items: [
        { id: 'f1', itemType: 'liturgy', sourceId: 'doc_1', title: 'Invocation', sectionId: 'a', slides: [{ content: 'L: In the name', background: 'bgF' }, { content: 'C: Amen' }] },
        { id: 'f2', itemType: 'liturgy', sourceId: 'doc_2', title: 'Confession', sectionId: 'b', slides: [{ content: 'We confess', background: 'bgC', richHtml: '<b>We</b> confess' }] },
        { id: 'f3', itemType: 'liturgy', sourceId: 'doc_3', title: 'Absolution', sectionId: 'b', slides: [{ content: 'You are forgiven' }] },
        { id: 'f4', itemType: 'liturgy', sourceId: 'doc_4', title: 'Kyrie', sectionId: 'c', slides: [{ content: 'Lord have mercy' }] } ],
      layout: [{ id: 'a', title: 'Invocation' }, { id: 'b', title: '2. Confession' }, { id: 'c', title: 'Kyrie' }] };
    const ctx = { id: 'F', items: file.items, layout: file.layout, map: {} };
    const items = [
      { id: 'o1', itemType: 'liturgy', sourceId: 'doc_1', title: 'Invocation', sectionId: 'a', slides: [{ content: 'L: In the name' }, { content: 'C: Amen' }] },
      { id: 'o2', itemType: 'liturgy', sourceId: 'doc_2', title: 'Confession', sectionId: 'b', slides: [{ content: 'We confess' }] },
      { id: 'o3', itemType: 'liturgy', sourceId: 'doc_3', title: 'Absolution', sectionId: 'b', slides: [{ content: 'You are forgiven' }] },
      { id: 'r1', itemType: 'scripture', title: 'Psalm 23', sectionId: 'c', slides: [{ content: 'The Lord is my shepherd' }] },
      { id: 'o4', itemType: 'liturgy', sourceId: 'doc_4', title: 'Kyrie', sectionId: 'c', slides: [{ content: 'Lord have mercy' }] },
      { id: 'g1', itemType: 'song', title: 'O Come', sectionId: 'b', customizations: { serviceSections: ['b'] } } ];
    const ol = { secs: X._spOutline([{ id: 'a', title: 'Invocation' }, { id: 'b', title: 'Confession' }, { id: 'c', title: 'Kyrie' }], items), items: items };
    const base = X._spPadFrom(ol);
    check('the window\'s draft is the order as the outline reads it, each part keyed and with its source; compared with the original it is the same, and Save would send nothing',
      base.secs.map(s => s.key).join() === 's:a,s:b,s:c' && base.secs[1].parts.map(p => p.key + '/' + p.kind).join() === 'p:o2/liturgy,p:o3/liturgy,p:g1/song' &&
      base.secs[0].parts[0].text === 'L: In the name\n---\nC: Amen' && base.secs[0].parts[0].sourceId === 'doc_1' &&
      X._spCmpCounts(X._spPadCmp(base, ctx)).any === 0 && X._spPadPlan(base, X._spPadClone(base)).any === false, JSON.stringify(base));
    const d = X._spPadClone(base);
    d.secs[0].title = 'Gathering';
    d.secs[1].parts[0].text = 'We confess our sins';
    d.secs[1].parts[1].title = 'Words of Forgiveness';
    d.secs[1].parts.splice(2, 0, d.secs[2].parts.splice(1, 1)[0]);
    d.secs.push({ key: 'n:1', id: '', title: 'Sending', entry: null, parts: [{ key: 'q:1', id: '', kind: 'liturgy', title: '', text: 'Go in peace\n---\nThanks be to God', sourceId: '', src: null }] });
    d.secs[0].parts.push({ key: 'q:2', id: '', kind: 'liturgy', title: 'Empty', text: '   ', sourceId: '', src: null });
    d.n = 2;
    const c1 = X._spPadCmp(d, ctx), n1 = X._spCmpCounts(c1);
    check('tracked against the original as it is typed: a section renamed, a part\'s words changed, a part renamed, a part moved, a section added',
      n1.renamed === 1 && n1.changed === 1 && n1.partRenamed === 1 && n1.moved === 1 && n1.secAdded === 1 && /1 part renamed/.test(X._spCmpBits(n1)), JSON.stringify(n1));
    const st = d.secs.map(s => X._spPadSecState(d, c1, s));
    check('...each section says how: renamed (with the original name), its parts changed, its own part away in another, added -- only those of the original offer Revert',
      st[0].renamed === 'Invocation' && st[0].any && st[1].parts === 3 && st[1].any && st[2].away === 1 && st[2].any && st[3].added && !st[3].any, JSON.stringify(st));
    const plan = X._spPadPlan(base, d);
    check('Save sends only what changed: the name, the words, the part\'s name, the places, the new section with its words -- nothing for a part typed and left empty, nor for the readings and songs',
      plan.any && plan.titles.a === 'Gathering' && plan.edits.length === 2 &&
      plan.edits.find(x => x.id === 'o2').texts.join('|') === 'We confess our sins' && plan.edits.find(x => x.id === 'o3').title === 'Words of Forgiveness' && !plan.edits.find(x => x.id === 'o3').texts &&
      plan.add.length === 1 && plan.add[0].key === 'n:1' && plan.add[0].title === 'Sending' &&
      plan.fresh.length === 1 && plan.fresh[0].sec === 'x:n:1' && plan.fresh[0].texts.join('|') === 'Go in peace|Thanks be to God' &&
      JSON.stringify(plan.place) === JSON.stringify([{ sec: 'b', parts: ['o2', 'o3', 'o4'] }, { sec: 'c', parts: ['r1'] }, { sec: 'x:n:1', parts: ['q:1'] }]) &&
      plan.order.join() === 'a,b,c,x:n:1' && !plan.remove.length && !plan.drop.length, JSON.stringify(plan));
    const d2 = X._spPadClone(base);
    d2.secs[2].parts.push(d2.secs[0].parts[0]); d2.secs[0].parts = [];
    d2.secs.splice(0, 1);
    d2.secs[0].parts = d2.secs[0].parts.filter(p => p.id !== 'o3');
    const plan2 = X._spPadPlan(base, d2);
    check('...a section taken out, a part taken out, and a part dragged out of the section before it went (kept, in its new place)',
      plan2.remove.join() === 'a' && plan2.drop.join() === 'o3' && plan2.place.some(p => p.sec === 'c' && p.parts.join() === 'r1,o4,o1') && plan2.order === null, JSON.stringify(plan2));
    const r1 = X._spPadRevertSec(d, ctx, 's:b'), sb = r1.secs.find(s => s.key === 's:b'), scc = r1.secs.find(s => s.key === 's:c'), cr1 = X._spCmpCounts(X._spPadCmp(r1, ctx));
    check('Revert one section: its words and its part\'s name back, the part moved into it goes home -- the rest stays as changed',
      sb.parts.map(p => p.key).join() === 'p:o2,p:o3,p:g1' && sb.parts[0].text === 'We confess' && sb.parts[1].title === 'Absolution' &&
      scc.parts.map(p => p.key).join() === 'p:r1,p:o4' && r1.secs[0].title === 'Gathering' && cr1.renamed === 1 && cr1.secAdded === 1 && cr1.changed === 0 && cr1.moved === 0 &&
      X._spPadRevertSec(r1, ctx, 's:b') === r1 && X._spPadRevertSec(r1, ctx, 'n:1') === r1, JSON.stringify(r1.secs.map(s => s.key + ':' + s.parts.map(p => p.key).join('+'))));
    const rp = X._spPadRevertPart(d, ctx, 'p:o4');
    check('Revert one part: back in its own section, as the original has it',
      rp.secs.find(s => s.key === 's:c').parts.map(p => p.key).join() === 'p:r1,p:o4' && !rp.secs.find(s => s.key === 's:b').parts.some(p => p.key === 'p:o4'));
    const d3 = X._spPadClone(d);
    d3.secs = d3.secs.filter(s => s.key !== 's:a');
    d3.secs[0].parts = d3.secs[0].parts.filter(p => p.key !== 'p:o3');
    d3.secs.reverse();
    const c3 = X._spPadCmp(d3, ctx), n3 = X._spCmpCounts(c3);
    check('...a section of the original taken out, a part taken out and the sections moved are seen too', n3.secGone === 1 && n3.gone === 1 && n3.secMoved >= 1, JSON.stringify(n3));
    const g1 = X._spPadPutSec(d3, ctx, 'a');
    check('Put back a section of the original: where it was (here, at the top), with its parts, as the original names it',
      g1.secs[0].entry && g1.secs[0].entry.id === 'a' && g1.secs[0].title === 'Invocation' && g1.secs[0].parts.length === 1 && g1.secs[0].parts[0].src.id === 'f1' &&
      X._spCmpCounts(X._spPadCmp(g1, ctx)).secGone === 0);
    const gp = X._spPadPutPart(d3, ctx, c3.missing.find(m => m.src.id === 'f3').key);
    check('Put back a part of the original: in its section, after the part it followed',
      gp.secs.find(s => s.key === 's:b').parts.map(p => p.kind === 'song' ? 'song' : p.title).join() === 'Confession,Absolution,Kyrie,song');
    const all = X._spPadReset(d3, ctx);
    check('Revert all to original: every difference gone -- the added section out, the original\'s section and part back, words, names and places back, the original\'s order; the readings and songs kept',
      X._spCmpCounts(X._spPadCmp(all, ctx)).any === 0 && all.secs.map(s => s.title).join() === 'Invocation,Confession,Kyrie' &&
      all.secs[1].parts.map(p => p.kind === 'song' ? 'song' : p.title).join() === 'Confession,Absolution,song' && all.secs[2].parts.some(p => p.key === 'p:r1') &&
      all.secs[0].parts[0].text === 'L: In the name\n---\nC: Amen' && all.secs[0].parts[0].src.id === 'f1',
      JSON.stringify(all.secs.map(s => s.title + ':' + s.parts.map(p => p.title || p.kind).join('+'))));
    const pAll = X._spPadPlan(base, all);
    check('...and Save for that changes nothing: what the order still has is kept as it is (the same section, the same parts, their backgrounds with them), not taken out and copied again from the file',
      pAll.any === false, JSON.stringify(pAll));
    const bare = X._spPadClone(base); bare.secs[0].parts = [];
    const pBare = X._spPadPlan(bare, X._spPadRevertSec(bare, ctx, 's:a'));
    check('...a part the order does not have, put back: made from the original\'s own slides (formatting and backgrounds)',
      pBare.fresh.length === 1 && pBare.fresh[0].sec === 'a' && pBare.fresh[0].raw && pBare.fresh[0].raw.length === 2 && pBare.fresh[0].raw[0].background === 'bgF' && pBare.fresh[0].src.id === 'f1', JSON.stringify(pBare));
    const base2 = X._spPadClone(base); base2.secs[1].parts[0].text = 'We confess everything';
    const pr = X._spPadPlan(base2, X._spPadRevertSec(base2, ctx, 's:b'));
    check('...a part changed in the order and reverted in the window goes back with the original\'s formatting and backgrounds',
      pr.edits.length === 1 && pr.edits[0].id === 'o2' && pr.edits[0].raw && pr.edits[0].raw[0].richHtml === '<b>We</b> confess' && !pr.edits[0].texts, JSON.stringify(pr));
  } catch (e) { check('the window\'s draft runs', false, e.stack); }
  try {
    const log = [];
    const order = { id: 'o', template: { serviceLiturgy: { id: 'F' } },
      sectionLayout: [{ id: 'a', title: 'Invocation', serviceSectionId: 'preparation' }, { id: 'b', title: 'Confession' }, { id: 'c', title: 'Kyrie', notes: 'kept' }],
      allItems: [
        { id: 'o1', itemType: 'liturgy', sourceId: 'doc_1', title: 'Invocation', sectionId: 'a', slides: [{ index: 0, content: 'L: In the name', background: 'bgA' }] },
        { id: 'o2', itemType: 'liturgy', sourceId: 'doc_2', title: 'Confession', sectionId: 'b', slides: [{ index: 0, content: 'We confess  ', background: 'bgB', richHtml: '<b>We</b> confess' }, { index: 1, content: 'Have mercy', background: 'bgB2' }] },
        { id: 'o3', itemType: 'liturgy', sourceId: 'doc_3', title: 'Absolution', sectionId: 'b', slides: [{ index: 0, content: 'You are forgiven' }] },
        { id: 'r1', itemType: 'scripture', title: 'Psalm 23', sectionId: 'c', slides: [] },
        { id: 'o4', itemType: 'liturgy', sourceId: 'doc_4', title: 'Kyrie', sectionId: 'c', slides: [{ index: 0, content: 'Lord have mercy' }] } ] };
    const songs = [{ id: 'g1', serviceSections: ['a'] }];
    let uid = 0;
    const env = { _lbdIsActive: () => true, _woLcdInPage: () => false, _lbdPfx: () => 'p_', _lbdUid: () => 'u' + (++uid), _woStripNum: t => String(t).replace(/^\d+\.\s*/, ''),
      _woSectionList: () => order.sectionLayout.map(x => ({ id: x.id })), _soSaveSettled: () => { log.push('save'); return Promise.resolve(true); },
      _lbdChange: f => { log.push('change'); return f() !== false; }, _lbdClearClearedFor: id => log.push('uncleared ' + id), _lbdNoteCleared: (sec, src) => log.push('cleared ' + sec + ' ' + src),
      _lbdSortSongsByService: () => log.push('sort'), songOrderSections: songs, _woSongSectionIds: sg => sg.serviceSections,
      _lbdUnplaceSong: (sg, id) => { log.push('unplace ' + sg.id + ' ' + id); sg.serviceSections = sg.serviceSections.filter(x => x !== id); }, _woUserClearedTypes: {} };
    const keys = Object.keys(env);
    const W = new Function(...keys, 'var currentOrderData = null;' + ['_woLibHeld', '_woLibKeepBg', '_woLibSlides', '_woPadTexts', '_woLibPad'].map(fn).join('\n') +
      '\nreturn { pad: _woLibPad, hold: function(o) { currentOrderData = o; } };')(...keys.map(k => env[k]));
    W.hold(order);
    const res = await W.pad('o', { origId: 'F',
      add: [{ key: 'n:1', title: '  Sending  ', entry: null }],
      edits: [{ id: 'o2', texts: ['We confess', 'Lord, have mercy'] }, { id: 'o3', title: ' Words of Forgiveness ' }],
      fresh: [{ key: 'q:1', sec: 'x:n:1', title: '', texts: ['Go in peace'], raw: null, src: null }],
      place: [{ sec: 'b', parts: ['o2', 'o3', 'o1'] }, { sec: 'x:n:1', parts: ['q:1'] }],
      remove: ['a'], drop: ['o4'], titles: { c: 'Lord Have Mercy' }, order: ['b', 'x:n:1', 'c'] });
    const lay = order.sectionLayout, it = id => order.allItems.find(x => x.id === id), newSec = lay.find(x => x.title === 'Sending');
    check('WO.libPad: the whole window in ONE change to the Builder\'s copy (one Undo), its save waited on',
      res && res.saved === true && log.filter(l => l === 'change').length === 1 && log[log.length - 1] === 'save', log.join());
    check('...the sections: the new one made and placed, the one taken out gone (its song kept, without it), the name changed (notes kept), in the order listed',
      lay.map(x => x.title).join() === 'Confession,Sending,Lord Have Mercy' && lay[2].notes === 'kept' && /^wo-section-\d+$/.test(newSec.id) &&
      log.indexOf('unplace g1 a') >= 0 && songs[0].serviceSections.length === 0 && log.indexOf('sort') >= 0, JSON.stringify(lay));
    check('...the parts: words changed (a slide left as it was keeps its formatting and background), a name changed, a part dragged out of the section before it went kept in its new place (its id naming its section), a part taken out gone',
      it('o2').slides[0].richHtml === '<b>We</b> confess' && it('o2').slides[0].background === 'bgB' && it('o2').slides[1].content === 'Lord, have mercy' && !it('o2').slides[1].richHtml && it('o2').slides[1].background === 'bgB2' &&
      it('o3').title === 'Words of Forgiveness' && !it('o1') && !!it('p_liturgy_doc_1_b') && it('p_liturgy_doc_1_b').sectionId === 'b' && log.indexOf('cleared a doc_1') >= 0 &&
      !it('o4') && log.indexOf('cleared c doc_4') >= 0 && it('r1').sectionId === 'c', JSON.stringify(order.allItems.map(x => x.id + '@' + x.sectionId)));
    const fresh = order.allItems.find(x => x.sectionId === newSec.id);
    check('...a part typed: a liturgy of the service\'s own (source lbd_<uid>) in its new section, the words as slides; a section\'s parts in the order listed',
      !!fresh && fresh.itemType === 'liturgy' && /^lbd_u\d+$/.test(fresh.sourceId) && fresh.id === 'p_liturgy_' + fresh.sourceId + '_' + newSec.id && fresh.slides[0].content === 'Go in peace' &&
      order.allItems.filter(x => x.sectionId === 'b').map(x => x.title).join() === 'Confession,Words of Forgiveness,Invocation', JSON.stringify(order.allItems));
    await W.pad('o', { fresh: [{ key: 'q:9', sec: 'b', title: '', raw: [{ content: 'You are forgiven', background: '', richHtml: '<i>You</i> are forgiven' }],
      src: { id: 'f3', itemType: 'liturgy', sourceId: 'doc_3', title: 'Absolution', sectionId: 'b', slides: [] } }], place: [] });
    const back = order.allItems[order.allItems.length - 1];
    check('...a part of the original put back: a copy with an id of this order, its words as the original made them; a second of one liturgy in the order gets a source of its own (gotcha 37)',
      /^p_svl_u\d+$/.test(back.id) && back.title === 'Absolution' && back.slides[0].richHtml === '<i>You</i> are forgiven' && back.sourceId !== 'doc_3' && back.sectionId === 'b', JSON.stringify(back));
    order.template.serviceLiturgy = { id: 'OTHER' };
    let err = null; const was = JSON.stringify(order);
    await W.pad('o', { origId: 'F', titles: { b: 'X' } }).catch(e => { err = e; });
    check('...a service using another liturgy since the window opened is left alone (code changed); nothing to do is no change',
      !!err && err.code === 'changed' && JSON.stringify(order) === was && (await W.pad('o', {})).same === true);
  } catch (e) { check('WO.libPad runs', false, e.stack); }
  check('Show liturgy and See open the window; it is a draft: Save sends the plan to WO.libPad through _spEdit, closes when it goes in, and keeps the draft (with a message) when it does not',
    /function spoShow\(\) \{ spoPad\(false\); \}/.test(SRC) && /function spoShowChanged\(\) \{ spoPad\(true\); \}/.test(SRC) &&
    /if \(ok\) \{ _spPadDrop\(\); return; \}/.test(fn('spoPadSave')) && /P\.err = 'Not saved\. Your changes are still here: try Save again\.';/.test(fn('spoPadSave')) && /libPad: _woLibPad/.test(SRC));
  check('...closing with changes asks first (Keep editing, Discard, Save; Esc keeps); typing marks what differs without drawing the window again; a run of typing is one step of the window\'s Undo',
    /if \(!P\.ask && _spPadPlan\(P\.base, P\.draft\)\.any\) \{ P\.ask = true;/.test(fn('spoPadClose')) && /Keep editing/.test(fn('_spPadFootHtml')) && /LiturgyModule\.spoPadDiscard\(\)/.test(fn('_spPadFootHtml')) &&
    /if \(P\.ask\) spoPadKeep\(\); else spoPadClose\(\);/.test(fn('_spPadKey')) && /_spPadMarkSoon\(\);/.test(fn('spoPadText')) && !/_spPadDraw/.test(fn('spoPadText')) &&
    /P\.undo\.push\(P\.pre\)/.test(fn('_spPadTyped')) && /P\.pre = _spPadClone\(P\.draft\); P\.preUsed = false;/.test(fn('_spPadFocusIn')));
  check('...Revert on a section and on a part, Revert all to original in the bar: none of them saves until Save',
    /LiturgyModule\.spoPadRevert\(this\.dataset\.k\)/.test(fn('_spPadSecTags')) && /LiturgyModule\.spoPadReset\(\)/.test(fn('_spPadBarHtml')) && /Revert all to original/.test(fn('_spPadBarHtml')) &&
    !/libRestore|libPad|_spEdit/.test(fn('spoPadReset') + fn('spoPadRevert') + fn('spoPadRevertPart')));
  check('...a phone gets the whole screen',
    /\.mv-ed\.spp \{ padding: 0; \}/.test(SRC) && /\.pl-ed \.mv-ed__card\.spp-win \{ max-width: none; height: 100vh; height: 100dvh;/.test(SRC));
  // ------------------------------------------------------------ 33. The window's look
  // From the operator (2026-11-17), on a screenshot of the window: "Black
  // cells with white texts, and thick black borderlines for the text input
  // boxes".
  console.log('\n33. The window\'s look');
  check('each section\'s heading a black bar with white words (its number a white tile, its bin a light red); a section of the original taken out keeps its own look',
    /\.spp-sec:not\(\.spp-sec--gone\) > \.spp-sec__hd \{ padding: 7px 8px 7px 4px; background: #111; color: #fff; \}/.test(SRC) &&
    /\.spp-sec:not\(\.spp-sec--gone\) > \.spp-sec__hd \.spp-num \{ background: #fff; color: #111; \}/.test(SRC) &&
    /\.spp-sec__hd \.spp-title, \.spp-part__hd \.spp-ptitle \{ color: #fff; \}/.test(SRC) && /\.spp-sec__hd \.spp-ic--rm, \.spp-part__hd \.spp-ic--rm \{ color: #ff8f86; \}/.test(SRC));
  check('...each part\'s heading a black bar too, edge to edge of its box; a reading or a song keeps its plain row',
    /\.spp-part__hd \{ margin: -6px -8px 0; padding: 5px 8px; background: #111; color: #fff; \}/.test(SRC) &&
    /\.spp-part:not\(\.spp-part--lock\):not\(\.spp-part--gone\) \{ overflow: hidden; \}/.test(SRC) && !/\.spp-part--lock[^{]*\{[^}]*background: #111/.test(SRC));
  check('...the words to type in a white box with a thick black edge',
    /\.spp-text \{ margin-top: 8px; border: 3px solid #111; \}/.test(SRC) && /\.spp-text \{[^}]*background: #fff;/.test(SRC));
  // ------------------------------------------------------------ 34. The landing's three ways in
  // From the operator (2026-11-17), circling the three cards: "make bigger",
  // and "I want these buttons to look more obvious as 3 options, add some
  // animations and gloss to entice users to tap on".
  console.log('\n34. The landing\'s three ways in');
  const hub34 = fn('renderHub');
  check('each card a bigger button: the icon on a glass tile, a sheen to sweep across it, an Open pill; each knows its place for the staggers',
    /'<span class="ll-card__top"><span class="ll-card__shine" aria-hidden="true"><\/span>'/.test(hub34) &&
    /'<span class="ll-card__ico" aria-hidden="true"><i class="fa-solid ' \+ c\.icon \+ ' ll-card__icon"><\/i><\/span>'/.test(hub34) &&
    /style="--ll-i:' \+ i \+ '"/.test(hub34) && /cards\.map\(function\(c, i\)/.test(hub34) &&
    /\.ll-card__ico \{[^}]*width: 58px; height: 58px; border-radius: 50%;/.test(SRC) && /\.ll-card__ico \{ width: 46px; height: 46px; \}/.test(SRC));
  check('...glossy: light over the top half, a bright edge above and a dark one below, a shadow in the card\'s own colour',
    /\.ll-card__top::before \{[^}]*height: 52%;[^}]*background: linear-gradient\(180deg, rgba\(255, 255, 255, 0\.3\)/.test(SRC) &&
    /\.ll-card__top::after \{[^}]*box-shadow: inset 0 1px 0 rgba\(255, 255, 255, 0\.45\), inset 0 -3px 0 rgba\(0, 0, 0, 0\.18\);/.test(SRC) &&
    /\.ll-card--services \{ --ll-cs: rgba\(107, 36, 34, 0\.6\); --ll-ci: #7a2a27; \}/.test(SRC));
  check('...moving: the three rise in one after another (backwards fill, so hover still lifts), a sheen sweeps each in turn, the arrow nudges, hover lifts, a press sinks',
    /animation: llCardIn 0\.55s cubic-bezier\(0\.2, 0\.8, 0\.2, 1\) backwards; animation-delay: calc\(var\(--ll-i, 0\) \* 90ms\);/.test(SRC) &&
    /animation: llCardShine 5\.5s ease-in-out infinite; animation-delay: calc\(1\.2s \+ var\(--ll-i, 0\) \* 1\.1s\);/.test(SRC) &&
    /\.ll-card__arrow i \{ animation: llArrowNudge 2\.4s ease-in-out infinite;/.test(SRC) &&
    /\.ll-card:hover \{ transform: translateY\(-3px\);/.test(SRC) && /\.ll-card:active \{ transform: translateY\(0\) scale\(0\.975\);/.test(SRC) &&
    /@keyframes llCardIn \{/.test(SRC) && /@keyframes llCardShine \{/.test(SRC) && /@keyframes llArrowNudge \{/.test(SRC));
  check('...still for those who ask for less motion; Open in words only where a card has the room',
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.ll-card, \.ll-card__arrow i, \.ll-card:hover \.ll-card__ico \{ animation: none !important; \}\s*\.ll-card__shine \{ display: none; \}/.test(SRC) &&
    /\.ll-card__open \{ display: none; \}/.test(SRC) && /@media \(min-width: 1200px\), \(min-width: 769px\) and \(max-width: 1100px\) \{\s*\.ll-card__arrow \{ padding: 0 14px 0 16px; \}\s*\.ll-card__open \{ display: inline; \}/.test(SRC));
  // ------------------------------------------------------------ 35. The service's page as the mockup draws it
  // From the operator (2026-11-17), with a mockup of a service's page: "Can
  // you use this mockup to replace the current design of the individual
  // service folders". Asked: the four kinds of file kept as they are, and a
  // liturgy document's Convert, Converted / Use and where it is used kept on
  // its row.
  console.log('\n35. The service\'s page as the mockup draws it');
  const res35 = fn('_spResHtml'), use35 = fn('_spInUseHtml');
  check('two cards: the Liturgy Library (its heading and line, + Add, the year folders, This Year\'s Active Liturgy) and the Files Repository (its heading and line, the kinds, the year\'s box)',
    /<h2 id="svpLibT">Liturgy Library<\/h2><p>Manage liturgy folders by year and work with the active liturgy\.<\/p>/.test(res35) &&
    /<h2 id="svpFilesT">Files Repository<\/h2><p>Stored documents, videos, and links for this liturgy and year\.<\/p>/.test(res35) &&
    /'<header class="svp-hd">' \+ SP_ART \+/.test(res35) && /var SP_ART = '<svg class="svp-art"/.test(SRC) &&
    res35.indexOf('svpLibT') < res35.indexOf('svpFilesT') && /kindChips \+ box \+ '<\/section>'/.test(res35));
  check('the Active Liturgy: a green bar with its name and how it stands (Ready for Church Use, Written in the Builder, Not chosen yet), then the day, the source, the line and its buttons',
    /'<div class="svp-act__hd"><i class="fa-solid ' \+ \(icon \|\| 'fa-circle-check'\) \+ '" aria-hidden="true"><\/i><h3>Active Liturgy<\/h3>'/.test(fn('_spActHd')) &&
    /_spActHd\(next \? 'Not chosen yet' : 'No date yet', 'is-wait', 'fa-pen-ruler'\)/.test(fn('_spMakeHtml')) &&
    /'<div class="svp-act__body">' \+ day \+ '<div class="svp-act__src">' \+ src/.test(use35) &&
    /\.svp-act__hd \{[^}]*background: linear-gradient\(180deg, #2a6b43, #1f5a37\);/.test(SRC) && /\.svp-act__badge \{[^}]*background: #a5ebab;/.test(SRC));
  try {
    const kind = it => ({ label: /\.mp4/.test(it.fileUrl || '') ? 'Video' : /docs\.google/.test(it.fileUrl || '') ? 'Google Doc' : 'Word' });
    const L = new Function('_lfKind', '_spKind', fn('_spOpenLook') + '\nreturn _spOpenLook;')(kind, it => it.k || 'liturgy');
    const a = L({ fileUrl: 'https://x/a.docx' }), b = L({ fileUrl: 'https://docs.google.com/document/d/1/edit' }), c = L({ fileUrl: 'https://youtu.be/abc' }),
      e = L({ fileUrl: 'https://x/clip.mp4' }), f = L({ fileUrl: 'https://chords.example/x', k: 'links' });
    check('a file\'s first button, as the mockup names it: Preview a document, Open a Google Doc or a link, Watch a video -- each the preview a double tap opens',
      a.label === 'Preview' && b.label === 'Open' && c.label === 'Watch' && e.label === 'Watch' && f.label === 'Open' &&
      /onclick="LiturgyModule\.lfOpen\(this\.dataset\.id\)"/.test(fn('_spOpenBtn')), JSON.stringify([a, b, c, e, f]));
  } catch (e) { check('the first button runs', false, e.stack); }
  check('...then Share and ⋯ on its line; its size beside its kind; Convert, Converted / Use and where it is used under it, as before',
    /'<span class="svp-row__acts">' \+ _spOpenBtn\(it, name\) \+/.test(fn('_spDocRow')) && /onclick="LiturgyModule\.lfShareItem\(this\.dataset\.id\)"/.test(fn('_spDocRow')) &&
    /var size = it\.fileSize > 0 \? formatFileSize\(it\.fileSize\) : '';/.test(fn('_spDocRow')) && /class="lf-btn sp-btn-sm sp-convd"/.test(fn('_spDocRow')) && /sp-uses/.test(fn('_spDocRow')) &&
    /onclick="LiturgyModule\.spPreviewReady\(this\.dataset\.id\)"/.test(fn('_spAppRow')) && /onclick="LiturgyModule\.lfShareItem\(this\.dataset\.id, true\)"/.test(fn('_spAppRow')));
  check('...the box names its year with its letter and counts its files; on a narrow phone Preview is its eye alone',
    /var label = sel === '' \? 'All years' : sel === '—' \? 'No year' : \(_sp\.year === 'this' \? 'This Year · ' : ''\) \+ sel \+ \(letter\(sel\) \? ' ' \+ letter\(sel\) : ''\);/.test(res35) &&
    /@media \(max-width: 460px\) \{\s*\.svp-open \{ width: 42px; padding: 0; justify-content: center; \}\s*\.svp-open span \{ display: none; \}/.test(SRC));
  // ------------------------------------------------------------ 36. The Readings page, shorter
  // From the operator (2026-11-17), on a phone screenshot of the Readings
  // page: "make all the elements 30px smaller so that each section can fit
  // properly".
  console.log('\n36. The Readings page, shorter');
  check('the heading smaller (48px icon and 1.85rem on a desk, 36px and 1.3rem on a phone), the date card and its Day / Week / Month tighter',
    /#lectionaryHomeView \.ll-head \{ min-height: 0; padding: 8px 6px 10px; \}/.test(SRC) && /#lectionaryHomeView \.ll-head h1 \{ font-size: 1\.85rem; \}/.test(SRC) &&
    /#lectionaryHomeView \.ll-head h1 \{ font-size: 1\.3rem; \}/.test(SRC) && /#lectionaryHomeView \.ll-head__icon \{ width: 36px; height: 36px;/.test(SRC) &&
    /#lectionaryHomeView \.ll-datenav \.lit-datenav-modes button \{ min-height: 30px; \}/.test(SRC) && /#lectionaryHomeView \.ll-lect, #lectionaryHomeView \.ll-today \{ min-height: 38px; \}/.test(SRC));
  check('...the season: its colour beside it and its words under them on a phone, the colour\'s name alone on a narrow one',
    /#lectionaryHomeView \.ll-band__desc \{ flex-basis: 100%; order: 3;/.test(SRC) && /#lectionaryHomeView \.ll-band__colour \{ margin-left: auto; \}/.test(SRC) &&
    /'<span class="ll-band__clab">Liturgical colour: <\/span>' \+ _lfE\(m\.color\)/.test(SRC) &&
    /@media \(max-width: 420px\) \{\s*#lectionaryHomeView \.ll-band__clab \{ display: none; \}/.test(SRC));
  check('...each reading, the Prayer of the Day and the buttons under them tighter',
    /#lectionaryHomeView \.ll-rcard__ico \{ width: 32px; height: 32px;/.test(SRC) &&
    /#lectionaryHomeView \.ll-prayer\.lit-day-prayer \{ margin-top: 10px; \}/.test(SRC) &&
    /#lectionaryHomeView \.ll-ractions \.lf-btn \{ min-height: 34px; \}/.test(SRC) && /#lectionaryHomeView \.ll-ractions \.lf-btn \{ min-height: 30px; \}/.test(SRC));
  // ------------------------------------------------------------ 37. A reading's card, concise
  // From the operator (2026-11-17), circling Open / Copy / Use in plan under a
  // reading and drawing them up beside the pen: "make the readings card more
  // concise".
  console.log('\n37. A reading\'s card, concise');
  const rcard = fn('_readingSlotCard');
  const rHead = (rcard.match(/'<div class="ll-rcard__acts">'[\s\S]*?'<\/div><\/div>'/) || [''])[0];
  check('Open, Copy, Use in plan and the pen are one row of icons in the card\'s top row, before the reference',
    !!rHead && /LiturgyModule\.openPassage\(/.test(rHead) && /LiturgyModule\.llCopyReading\(/.test(rHead) && /LiturgyModule\.llUseInPlan\(/.test(rHead) &&
    /class="lit-reading-slot-edit"/.test(rHead) && rcard.indexOf('ll-rcard__acts') < rcard.indexOf('ll-rcard__ref'));
  check('...each icon says what it does (title and aria-label), with no word on the button',
    /title="Open the passage" aria-label="Open ' \+ escapeHtml\(ref\) \+ '"/.test(rHead) && /title="Copy" aria-label="Copy ' \+ escapeHtml\(ref\) \+ '"/.test(rHead) &&
    /title="Use in plan" aria-label="Use in the service plan"/.test(rHead) && !/<\/i>(Open|Copy|Use in plan)<\/button>/.test(rcard));
  check('...the bar of three under the reference is gone, and the card ends with its own padding',
    !/\.ll-rcard__acts \{ display: grid;/.test(SRC) && !/\.ll-rcard__acts button \+ button/.test(SRC) &&
    /\.ll-rcard\.lit-reading-slot \{ cursor: default; display: flex; flex-direction: column; gap: 10px; padding: 0 0 14px;/.test(SRC) &&
    /#lectionaryHomeView \.ll-rcard\.lit-reading-slot \{ gap: 6px; padding-bottom: 12px; \}/.test(SRC));
  check('...32px icons, 36px on a touch screen, and a narrow card leaves its slot\'s icon out',
    /\.ll-rcard__acts \{ display: flex; align-items: center; gap: 4px; flex-shrink: 0; \}/.test(SRC) &&
    /\.ll-rcard__acts button \{ display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;/.test(SRC) &&
    /@media \(pointer: coarse\) \{ \.ll-rcard__acts button \{ width: 36px; height: 36px;/.test(SRC) &&
    /@container \(max-width: 329px\) \{ \.ll-rcard__ico \{ display: none; \} \}/.test(SRC));
  check('...four cards a row only where each has room, by the panel\'s own width',
    /\.lit-reading-slots-panel\.ll-readings \{ container: llslots \/ inline-size; \}/.test(SRC) &&
    /@container llslots \(max-width: 1189px\) \{ \.ll--readings \.lit-reading-slots-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}/.test(SRC) &&
    /@container llslots \(max-width: 599px\) \{ \.ll--readings \.lit-reading-slots-grid \{ grid-template-columns: minmax\(0, 1fr\); \} \}/.test(SRC));
  check('...the old 38px / 46px rules for the bar are gone', !/#lectionaryHomeView \.ll-rcard__acts button \{ min-height/.test(SRC));
  // ------------------------------------------------------------ 38. The Prayer of the Day's card, concise
  // From the operator (2026-11-17): "make the prayer of the day card more
  // concise", after the readings' cards were.
  console.log('\n38. The Prayer of the Day\'s card, concise');
  const pcard = fn('_dayPrayerCard');
  check('its title and four icons are one row, then the prayer, then where it came from',
    /'<div class="ll-prayer__hd">' \+/.test(pcard) && /'<div class="ll-prayer__acts">' \+ acts \+ '<\/div>' \+/.test(pcard) &&
    pcard.indexOf('ll-prayer__hd') < pcard.indexOf("body +") && /\(src \? '<div class="ll-prayer__meta">' \+ src \+ '<\/div>' : ''\)/.test(pcard));
  check('...Copy, Use in plan, Share and Edit (Type the prayer when there is none) are icons that say what they do',
    /class="ll-prayer__ib" title="' \+ title \+ '" aria-label="' \+ label \+ '"/.test(pcard) &&
    /btn\('fa-regular fa-copy', 'Copy', 'Copy the prayer',[^\n]*llCopyPrayer/.test(pcard) &&
    /btn\('fa-regular fa-square-plus', 'Use in plan', 'Use in the service plan',[^\n]*llUseInPlan/.test(pcard) &&
    /btn\('fa-solid fa-share-nodes'[^\n]*lfShareDay/.test(pcard) &&
    /btn\('fa-solid fa-pen', 'Edit the prayer'/.test(pcard) && /btn\('fa-solid fa-plus', 'Type the prayer'/.test(pcard) &&
    !/lit-day-prayer__btn/.test(pcard));
  check('...the "Goes into this date\'s order" line is the prayer\'s title, not a line of its own',
    !/lit-day-prayer__where/.test(pcard) && /<p class="lit-day-prayer__text" title="Goes into this date/.test(pcard));
  check('...one column on every screen: a 32px icon, the old icon column and divider gone',
    /\.ll-prayer\.lit-day-prayer \{ display: flex; flex-direction: column; gap: 6px;/.test(SRC) &&
    /\.ll-prayer__icon \{ width: 32px; height: 32px;/.test(SRC) && !/\.ll-prayer__main/.test(SRC) &&
    !/#lectionaryHomeView \.ll-prayer__icon \{ width: 44px/.test(SRC));
  check('...32px icons, 36px on a touch screen, the praying hands left out on a narrow card',
    /\.ll-prayer__ib \{ display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;/.test(SRC) &&
    /@media \(pointer: coarse\) \{ \.ll-prayer__ib \{ width: 36px; height: 36px;/.test(SRC) &&
    /@container \(max-width: 359px\) \{ \.ll-prayer__icon \{ display: none; \} \}/.test(SRC));
  // ------------------------------------------------------------ 39. The Active Liturgy card on a narrow phone
  // From the operator (2026-11-19), on a phone screenshot of the card: the
  // text "struggling to fit", a long name hyphenated ("Commu - nion"), and
  // "for the year column - put the year above and the letter below".
  console.log('\n39. The Active Liturgy card on a narrow phone');
  const src39 = fn('_spSourcesHtml');
  let hy = null;
  try { hy = new Function(fn('_spSoftHyph') + '\nreturn _spSoftHyph;')(); } catch (e) { hy = null; }
  const show = t => hy ? hy(t).replace(/\u00AD/g, '-') : '';
  check('a long word carries soft hyphens at its syllable breaks: Com-mu-nion, Pen-te-cost, Transfi-gu-ra-tion',
    !!hy && show('1st Sunday Advent (Communion)') === '1st Sunday Advent (Com-mu-nion)' && show('Pentecost') === 'Pen-te-cost' &&
    show('Transfiguration') === 'Transfi-gu-ra-tion');
  check('...never inside th / ch / ph, a short word left whole, nothing else changed',
    !!hy && show('Brother') === 'Brother' && show('Epiphany') === 'Epiphany' && show('Advent') === 'Advent' && show('Liturgy') === 'Liturgy' &&
    hy('Communion').replace(/\u00AD/g, '') === 'Communion' && hy(null) === '' && /<b>' \+ _lfE\(_spSoftHyph\(lk\.name\)\) \+ '<\/b>/.test(src39));
  check('...and the name hyphenates where the browser can, else breaks where it must, never widening the card',
    /\.spi-srcb__t b \{ font-weight: 700; overflow-wrap: anywhere; -webkit-hyphens: auto; hyphens: auto;/.test(SRC) && /<html lang="en">/.test(SRC));
  check('Original sits on the kind\'s line under the name, not beside it',
    /'<\/b><small>' \+ _lfE\(lk\.kind \? lk\.kind\.label : \(x\.id \? 'Liturgy App File' : 'A past service'\)\) \+\s*\(x\.orig \? '<em>Original<\/em>' : ''\) \+ '<\/small><\/span>'/.test(src39) &&
    /\.spi-srcb__t small \{ display: flex; align-items: center; flex-wrap: wrap;/.test(SRC));
  check('the year column is the year above its letter ("2025" over "Year A"), and a year with no letter is the year alone',
    /var lk = _spSrcLook\(x\), cyL = lk\.year \? _llCycleFor\(lk\.occ, lk\.year\) : '';/.test(src39) &&
    /'<span class="spi-srcb__yy"><b>' \+ _lfE\(String\(lk\.year\)\) \+ '<\/b>' \+ \(cyL \? '<small>' \+ _lfE\(cyL\) \+ '<\/small>' : ''\) \+ '<\/span>'/.test(src39) &&
    /\.spi-srcb__yy \{ display: flex; flex-direction: column; align-items: center;/.test(SRC) && !/_lfE\(cy\) \+ '<i class="fa-solid fa-arrow-right"/.test(src39));
  check('a narrow card (phones only) gives Show Liturgy its own row and Builder the next, so the menu never runs off the edge',
    /@media \(max-width: 768px\) \{\s*\.svp-act \{ container: svpcard \/ inline-size; \}\s*\.svp-act__body \{ container: svpact \/ inline-size; \}/.test(SRC) &&
    /@container svpact \(max-width: 354px\) \{\s*#liturgyServicePanel \.svp-act__acts \{ flex-wrap: wrap; \}\s*#liturgyServicePanel \.svp-act \.lf-btn\.svp-show \{ flex: 1 1 100%; \}/.test(SRC));
  check('...its heading keeps "Active Liturgy" on one line beside its badge, and on the narrowest phones Change is its arrows alone',
    /@container svpcard \(max-width: 379px\) \{[^}]*\}\s*\.svp-act__hd > i \{ display: none; \}\s*\.svp-act__hd h3 \{ font-size: 1\.05rem; white-space: nowrap; \}/.test(SRC) &&
    /@container svpact \(max-width: 249px\) \{\s*\.svp-chg \{ padding: 6px 9px; \}\s*\.svp-chg span \{ display: none; \}/.test(SRC) &&
    /class="svp-chg" onclick="LiturgyModule\.spoPick\(\)" title="Choose, change, blend or stop using the liturgy"/.test(SRC));
  // ------------------------------------------------------------ 40. A file's buttons in a column on a phone
  // From the operator (2026-11-19), on a phone screenshot of the Files
  // Repository: "make the buttons smaller and vertically", so the name and
  // its line have the width -- it was squeezed to "(Communio / n)".
  console.log('\n40. A file row\'s buttons, a small column on a phone');
  const m40 = /\/\* On a phone a row's three buttons are a small column[\s\S]*?@media \(max-width: 600px\) \{([\s\S]*?)\n  \}/.exec(SRC);
  const r40 = m40 ? m40[1] : '';
  check('under 600px the buttons stack down the row\'s right edge',
    /\.svp-row__acts \{ flex-direction: column; align-items: stretch; gap: 4px; \}/.test(r40) &&
    /\.svp-rows \.sp-doc2__top \{ align-items: flex-start; gap: 10px; \}/.test(r40));
  check('...smaller (32 x 28px, icons only), the badge 36px, so the name takes the width',
    /#liturgyServicePanel \.svp-rows \.svp-row__acts > button \{ width: 32px; height: 28px; min-height: 0; margin: 0; padding: 0;/.test(r40) &&
    /\.svp-row__acts \.svp-open span \{ display: none; \}/.test(r40) &&
    /\.svp-rows \.sp-doc2__top > \.lf-badge \{ width: 36px; height: 36px;/.test(r40));
  check('...for a document\'s row and an app file\'s alike, and a desk keeps its row of buttons',
    (SRC.match(/'<span class="svp-row__acts">/g) || []).length === 2 &&
    /\.svp-row__acts \{ flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; \}/.test(SRC));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
})();
