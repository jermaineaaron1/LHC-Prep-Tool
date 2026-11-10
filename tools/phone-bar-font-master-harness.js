'use strict';
// Harness for three requests of 2026-11-09, from the operator:
//
//   1. The builder on a phone: the section bar half as wide, and beside it
//      WhatsApp (the order's link), Save and Load; Load asks whether to load
//      a liturgy saved in the Liturgy Library or one from a past service.
//   2. The songbook (desk and phone): a font toolbar in place of Reset
//      Layout, for the songbook and Book Mode.
//   3. Versions: "Save this Version" or "Overwrite the Master Copy", the
//      second only after a warning.
//
// USAGE
//   node tools/phone-bar-font-master-harness.js
//   node tools/phone-bar-font-master-harness.js <file> --expect-broken

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
function extractVarBlock(name) {
  const i = lines.findIndex(l => new RegExp('^  var ' + name + '\\b').test(l));
  if (i < 0) throw new Error('var not found: ' + name);
  const out = [];
  for (let k = i; k < lines.length; k++) { out.push(lines[k]); if (/;\s*\r?$/.test(lines[k])) break; }
  return out.join('\n');
}
const fn = n => { try { return extractFn(n); } catch (e) { return ''; } };
const has = re => re.test(SRC);

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

// ------------------------------------------------------------ 1. the phone's top bar
console.log('\n1. The builder on a phone: the section half the bar, then WhatsApp, Save and Load');
const mb = fn('_lbdMbarHtml');
check('after the section: WhatsApp (the link), Save and Load, then undo and redo', !!mb &&
  mb.indexOf('data-act="nav-toggle"') < mb.indexOf('data-act="share-link"') && mb.indexOf('data-act="share-link"') < mb.indexOf('data-act="save-liturgy"') &&
  mb.indexOf('data-act="save-liturgy"') < mb.indexOf('data-act="menu-load"') && mb.indexOf('data-act="menu-load"') < mb.indexOf('data-act="undo"') &&
  /fa-brands fa-whatsapp/.test(mb) && /aria-label="Save This Liturgy"/.test(mb));
check('...each doing what the ribbon\'s does: the link on WhatsApp, Save This Liturgy, the Load menu',
  has(/case 'share-link': lbdShareWhatsApp\(false\); break;/) && has(/case 'save-liturgy': lbdSvlSaveSheet\(\); break;/) && has(/case 'menu-load': _lbdOpenLoadMenu\(btn\); break;/));
check('the section takes at most half the bar', has(/\.lbw-mb-sec \{\r?\n  flex: 1 1 0; min-width: 0; max-width: 50%;/));
check('...Save green and Load light blue, as on the desk', has(/\.lbw-mb\[data-act="save-liturgy"\] \{ background: #1f9d55; color: #fff; \}/) &&
  has(/\.lbw-mb\[data-act="menu-load"\] \{ border: 1px solid #7dd3fc; background: #e0f2fe; color: #0369a1; \}/));
check('Load asks: a liturgy saved in the Liturgy Library for this service, or a past service',
  /lbdServiceLiturgies\(occ, 'saved'\)/.test(fn('_lbdOpenLoadMenu')) && /lbdServiceLiturgies\('\*', 'order'\)/.test(fn('_lbdOpenLoadMenu')) &&
  /if \(k === 'load-liturgy'\) \{ lbdServiceLiturgies\(_svlGuess\(\), 'saved'\); return; \}/.test(fn('_lbdInsertKind')));

// ------------------------------------------------------------ 2. the font
console.log('\n2. The songbook\'s font: this device\'s, for the songbook and Book Mode');
let F = null, store = {};
try {
  F = new Function('localStorage', '_sbFontSettings',
    extractVarBlock('_SBM_FONTS') + '\n' + extractVarBlock('_SBM_GRID_STACK') + '\n' +
    'function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\'/g, "&#39;"); }\n' +
    ['_sbmFontOf', '_sbmFontId', '_sbmFontNow', '_sbmFontWords', '_sbmFontGrid', '_sbmFontPickerHtml'].map(extractFn).join('\n') +
    '\nreturn { fonts: _SBM_FONTS, stack: _SBM_GRID_STACK, words: _sbmFontWords, grid: _sbmFontGrid, picker: _sbmFontPickerHtml };')(
    { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    { family: 'Georgia,serif' });
} catch (e) { console.log('  (could not build the font pieces: ' + e.message + ')'); }
if (F) {
  check('nothing chosen: the songbook\'s own face for the words, the standard fixed width for the chords', F.words() === 'Georgia,serif' && F.grid() === F.stack && /monospace$/.test(F.stack));
  store.lhc_sbm_font = 'merriweather';
  const pw = F.words(), pg = F.grid();
  check('a font for words: the words take it, the chord grid stays fixed width', /^Merriweather/.test(pw) && pg === F.stack, pw + ' | ' + pg);
  store.lhc_sbm_font = 'robotomono';
  check('a fixed-width font: the words and the chord grid both take it', /^'Roboto Mono'/.test(F.words()) && F.grid() === F.words());
  store.lhc_sbm_font = 'gone';
  check('a font no longer offered is the songbook\'s own again', F.words() === 'Georgia,serif' && F.grid() === F.stack);
  store.lhc_sbm_font = 'courier';
  const pk = F.picker();
  check('the picker says the font chosen and lists Standard, the fixed-width fonts, then the rest', /<b>Courier Prime<\/b>/.test(pk) &&
    /<option value="courier" selected>Courier Prime<\/option>/.test(pk) && /<optgroup label="Chords and words \(fixed width\)">/.test(pk) &&
    /<optgroup label="Words \(chord sheets stay fixed width\)">/.test(pk) && pk.indexOf('value=""') < pk.indexOf('optgroup') &&
    /onchange="WO\.sbmFont\(this\.value\)"/.test(pk), pk.slice(0, 300));
  check('every fixed-width font is a monospace face, every other one is not', F.fonts.filter(f => f.mono).every(f => /monospace/.test(f.fam)) &&
    F.fonts.filter(f => f.id && !f.mono).every(f => !/monospace/.test(f.fam)));
}
const sf = fn('sbmFont');
check('choosing one keeps it on this device, not in the songbook (lhc_sbm_font), and redraws', /localStorage\.setItem\('lhc_sbm_font', f\.id\)/.test(sf) &&
  /localStorage\.removeItem\('lhc_sbm_font'\)/.test(sf) && /_sbmRender\(\);/.test(sf) && !/sbAutoSave|template/.test(sf));
check('...and says, for a font for words, that the chord sheets stay fixed width', /Chords \+ Lyrics keeps a fixed-width font, so the chords stay over their words/.test(sf));
check('Reset Layout gives its place to the font, and is still in More', !/onclick="WO\.sbmReset\(\)"><i class="fa-solid fa-text-height"><\/i>Reset Layout/.test(SRC) &&
  has(/_sbmFontPickerHtml\(\) \+ '<\/div>';/) && has(/\['fa-arrows-rotate', 'Reset this song’s layout', 'WO\.sbmCloseSheet\(\);WO\.sbmReset\(\)', /));
check('the reading view\'s lyrics take the words\' face; the chord grid, the choir score\'s and a phone\'s choir words read the variables',
  (SRC.match(/style="font-family:' \+ escapeHtml\(_sbmFontWords\(\)\) \+ ';">' \+ lyricsHtml/g) || []).length === 2 &&
  has(/font-family: var\(--sbm-grid-font, ui-monospace, "SF Mono"[^;]*monospace\) !important;/) &&
  has(/--vl-mono: var\(--sbm-grid-font, ui-monospace/) &&
  // a phone held upright has a grid rule of its own, late in the page
  has(/#songbookLiveModal \.wo-lyrics-lyric-line \{\r?\n\s*font-family:var\(--sbm-grid-font, ui-monospace,"SF Mono"[^;]*monospace\) !important;\r?\n\s*font-size:1rem !important;/) && has(/\.sbm-score \.vl-words \{[^}]*font-family: var\(--sbm-words-font, var\(--sbm-font-body\)\); \}/) &&
  has(/font-family: var\(--sbm-grid-font, var\(--sbm-font-mono\)\); font-weight: 700; color: var\(--sbm-chord\);/));
check('...set on the songbook\'s modal at every render, a web font fetched the first time', /m\.style\.setProperty\('--sbm-words-font', f\.fam\)/.test(fn('_sbmFontApply')) &&
  /if \(f\.mono\) m\.style\.setProperty\('--sbm-grid-font', f\.fam\); else m\.style\.removeProperty\('--sbm-grid-font'\);/.test(fn('_sbmFontApply')) &&
  // (after the notepad's guard: nothing runs while the sheet is typed on)
  /\{ _sbNp\.renderAfter = true; return; \}\r?\n    _sbmFontApply\(\);/.test(fn('_sbmRender')) && /https:\/\/fonts\.googleapis\.com\/css2\?family=' \+ f\.g/.test(fn('_sbmFontLoad')));
const bk = fn('_sbFsBuildPages');
check('Book Mode\'s pages take the same: the words\' face, and the grid\'s for the chord lines',
  /'\.sp-lyrics-wrap\{font-family:' \+ _sbmFontWords\(\) \+ ';/.test(bk) && /'\.sp-lyrics-wrap \.wo-lyrics-chord-line\{font-family:' \+ _sbmFontGrid\(\) \+ ';/.test(bk) &&
  !/_sbFontSettings\.family/.test(bk));
check('the picker is reachable', has(/    sbmFont: sbmFont,/));

// ------------------------------------------------------------ 3. the master copy
console.log('\n3. Versions: Save this Version, or Overwrite the Master Copy after a warning');
const vr = fn('_sbVerRender');
check('the two saves are "Save this Version" and "Overwrite the Master Copy"', />Save this Version<\/button>/.test(vr) && />Overwrite the Master Copy<\/button>/.test(vr) &&
  /Same as the Master Copy/.test(vr) && !/Save as the main song|Save as a version/.test(SRC));
check('the library\'s own song is "Master (From Song Library)"', /kind: 'main', title: 'Master \(From Song Library\)'/.test(vr) &&
  has(/main: 'Master \(From Song Library\)', kept: 'Earlier master copy'/) && !/'Main song'/.test(SRC));
const mm = fn('sbVerMakeMain'), rm = fn('sbVerRestoreMain');
check('Overwrite the Master Copy warns first, and a No writes nothing',
  /_sbVerMasterWarn\(\{ title: 'Overwrite the Master Copy\?'/.test(mm) && /\}\)\.then\(function\(ok\) \{\r?\n\s*if \(!ok\) return;/.test(mm) &&
  mm.indexOf('_sbVerMasterWarn(') < mm.indexOf('_sbVerReplaceMain('));
check('...and so does putting an earlier master back', /_sbVerMasterWarn\(\{ title: 'Overwrite the Master Copy with “' \+ v\.name \+ '”\?'/.test(rm) &&
  /\}\)\.then\(function\(yes\) \{\r?\n\s*if \(!yes\) return false;/.test(rm) && rm.indexOf('_sbVerMasterWarn(') < rm.indexOf('_sbVerReplaceMain('));
let asked = null, W = null;
try {
  W = new Function('window', '_sbVerAsk', extractFn('_sbVerMasterWarn') + '\nreturn _sbVerMasterWarn;')(
    { lhcAskDelete: o => { asked = o; return Promise.resolve(false); } }, () => Promise.resolve(true));
} catch (e) { W = null; }
let got = null;
if (W) W({ title: 'Overwrite the Master Copy?', song: 'Unto Thee O Lord', from: 'D', to: 'F', message: 'm' }).then(v => { got = v; });
setImmediate(() => {
  check('the warning is the app\'s own: a warning sign, the song and its key now and after, Keep the master or Overwrite the master', !!asked &&
    asked.icon === 'fa-triangle-exclamation' && asked.detail === 'Unto Thee O Lord · Key D → F' && asked.cancelLabel === 'Keep the master' &&
    asked.okLabel === 'Overwrite the master' && asked.okIcon === 'fa-crown' && got === false, JSON.stringify(asked));
  check('...its button can carry its own icon (a delete keeps the bin)', has(/'<button type="button" class="lhc-ask__yes"><i class="fa-solid ' \+ \(o\.okIcon \|\| 'fa-trash-can'\) \+ '"/));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
});
