'use strict';
// Harness for the sheet as a notepad (CLAUDE.md gotcha 65).
//
// WHY THIS EXISTS
// From the operator (2026-11-06): type straight onto a song's words and
// chords -- without the Edit window -- and press Enter to keep the changes.
// In the song view the Type chip turns the lyrics card into a notepad; in
// Book Mode holding the words does. The whole song at once: Enter saves,
// Shift+Enter (or the bar's New line, for a phone) starts a line, Esc puts
// everything back. Its parts, each checked here:
//   - the lines are read back from what was typed: a block a line, an empty
//     block an empty line, a line break a line -- not the browser's own
//     trailing break -- and the instrument strips are not words;
//   - a line left as it was is stored exactly as it was, though it was shown
//     in another key; a chord line typed or changed is put back into the
//     copy's own key;
//   - nothing redraws the sheet while it is typed on -- a resize, which a
//     phone's keyboard opening is, once wiped a page being typed on;
//   - the song is held as every editor holds it, and words changed
//     underneath are not written over.
//
// USAGE
//   node tools/songbook-notepad-harness.js                 # ../Index.html
//   node tools/songbook-notepad-harness.js path/to/file.html
//   node tools/songbook-notepad-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show b4bf738:Index.html > x`).
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}

const SRC = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
const has = re => re.test(SRC);
const fn = name => { const m = SRC.match(new RegExp('\\n  function ' + name + '\\([^)]*\\) \\{[^]*?\\n  \\}')); return m ? m[0] : ''; };

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}

// A stand-in DOM: elements and text nodes, linked as siblings.
function txt(d) { return { nodeType: 3, data: d }; }
function el(tag, cls, kids) {
  const e = { nodeType: 1, tagName: tag.toUpperCase(), classList: { contains: c => (cls || '').split(' ').indexOf(c) > -1 } };
  const list = kids || [];
  list.forEach((k, i) => { k.nextSibling = list[i + 1] || null; k.parentNode = e; });
  e.firstChild = list[0] || null;
  return e;
}

console.log('The lines, read back from what was typed');
const linesSrc = fn('_sbNpLines');
if (linesSrc) {
  const L = new Function(linesSrc + '\nreturn _sbNpLines(arguments[0]);');
  const sheet = el('div', 'sbm-lyrics', [
    el('div', 'wo-lyrics-section-header verse', [txt('[Verse]')]),
    el('div', 'sbm-inst', [el('span', '', [txt('Intro')]), el('button', '', [txt('Playback 0')])]),
    el('div', 'wo-lyrics-chord-line', [txt('C   G')]),
    el('div', 'wo-lyrics-lyric-line', [txt('Amazing grace')]),
    el('div', 'wo-lyrics-empty-line', []),
    el('div', 'wo-lyrics-lyric-line', [el('br')]),
    el('div', 'wo-lyrics-lyric-line', [txt('How sweet'), el('br'), txt('the sound')]),
    el('div', 'wo-lyrics-lyric-line', [txt('That saved'), el('br'), el('br')]),
    txt('\n'),
    el('div', 'wo-lyrics-lyric-line', [txt('a wretch'), el('div', '', [txt('like me')])]),
    el('div', 'wo-lyrics-lyric-line', [txt('I once' + String.fromCharCode(160) + 'was lost')]),
  ]);
  const got = L(sheet);
  const want = ['[Verse]', 'C   G', 'Amazing grace', '', '', 'How sweet', 'the sound', 'That saved', '', 'a wretch', 'like me', 'I once was lost'];
  check('a block is a line, an empty block an empty line (not two: its own break is not one)', JSON.stringify(got.slice(0, 5)) === JSON.stringify(want.slice(0, 5)), JSON.stringify(got));
  check('...a line break inside a block starts the next line, Shift+Enter at a line\'s end an empty one', JSON.stringify(got.slice(5, 9)) === JSON.stringify(want.slice(5, 9)), JSON.stringify(got));
  check('...a block split by Enter is two lines, and a non-breaking space a space', JSON.stringify(got.slice(9)) === JSON.stringify(want.slice(9)), JSON.stringify(got));
  check('...and the instrument strips, their buttons and the markup\'s spacing are not words', got.indexOf('Intro') < 0 && got.join('|').indexOf('Playback') < 0 && got.length === want.length);
} else check('_sbNpLines exists', false);

console.log('\nWhat is stored for what was typed');
const mapSrc = fn('_sbNpMap');
if (mapSrc) {
  const isChord = (l) => /^[\sA-G#bmsu0-9|]*$/.test(l) && /[A-G]/.test(l);
  const M = (shown, stored, typed, steps) => new Function('isChordLineGlobal', 'sbTransposeChordLine', mapSrc + '\nreturn _sbNpMap.apply(null, arguments[2]);')(
    isChord, (t, d) => t + '@' + d, [shown, stored, typed, steps]);
  const shown = ['[Verse]', 'E   A', 'Amazing grace', 'F#  B', 'How sweet'];
  const stored = ['[Verse]', 'D   G', 'Amazing grace', 'E   A', 'How sweet'];
  check('a line left as it was is stored as it was, though shown in another key',
    JSON.stringify(M(shown, stored, shown.slice(), 2)) === JSON.stringify(stored));
  check('a lyric line changed is kept as typed',
    JSON.stringify(M(shown, stored, ['[Verse]', 'E   A', 'Amazing grace!', 'F#  B', 'How sweet'], 2)) === JSON.stringify(['[Verse]', 'D   G', 'Amazing grace!', 'E   A', 'How sweet']));
  check('a chord line changed is put back into the copy\'s own key; the others are untouched',
    JSON.stringify(M(shown, stored, ['[Verse]', 'E   Bm', 'Amazing grace', 'F#  B', 'How sweet'], 2)) === JSON.stringify(['[Verse]', 'E   Bm@-2', 'Amazing grace', 'E   A', 'How sweet']));
  check('a line added is added, in its place',
    JSON.stringify(M(shown, stored, ['[Verse]', 'E   A', 'Amazing grace', 'A new line', 'F#  B', 'How sweet'], 2)) === JSON.stringify(['[Verse]', 'D   G', 'Amazing grace', 'A new line', 'E   A', 'How sweet']));
  check('a line taken out is gone, and only it',
    JSON.stringify(M(shown, stored, ['[Verse]', 'E   A', 'F#  B', 'How sweet'], 2)) === JSON.stringify(['[Verse]', 'D   G', 'E   A', 'How sweet']));
  check('in the song\'s own key, a chord line is kept as typed', JSON.stringify(M(['C'], ['C'], ['Dm'], 0)) === JSON.stringify(['Dm']));
} else check('_sbNpMap exists', false);

console.log('\nEnter keeps it, Esc puts it back');
const endSrc = fn('_sbNpEnd');
if (endSrc) {
  const E = (o) => {
    const log = { wrote: null, released: 0, toast: '', rebuilt: 0, rendered: 0 };
    const elx = { removeEventListener() {}, removeAttribute() {}, classList: { remove() {} } };
    const N = { el: elx, song: { customLyrics: '' }, base: 'b', where: o.where || 'view', shown: o.shown, stored: o.stored, before: o.stored.join('\n'), steps: o.steps || 0, renderAfter: !!o.renderAfter };
    const env = { _sbNp: N };
    new Function('env', '_sbNpLines', '_sbmLinesOf', '_sbNpMap', '_sbSetCopyWords', '_sbEditRelease', '_sbEditMayWrite', 'showToast', '_sbBkRebuild', '_sbmRender', '_sbNpBarOff',
      '_sbNpKey', '_sbNpBeforeInput', '_sbNpPaste', '_sbNpBlur',
      'var _sbNp = env._sbNp;\n' + endSrc + '\n_sbNpEnd(arguments[15]); env._sbNp = _sbNp;')(
      env, () => o.typed.slice(), () => (o.now || o.stored).slice(), (sh, st, ty) => (o.mapped || ty).slice(),
      (s, w) => { log.wrote = w; }, () => { log.released++; }, () => o.may !== false, (m) => { log.toast = m; },
      () => { log.rebuilt++; }, () => { log.rendered++; }, () => {}, null, null, null, null, o.save !== false);
    log.cleared = env._sbNp === null;
    return log;
  };
  const S = ['[Verse]', 'C   G', 'Amazing grace'];
  const same = E({ shown: S, stored: S, typed: S });
  check('nothing typed: nothing written, the song let go', same.wrote === null && same.released === 1 && same.cleared);
  const typed = E({ shown: S, stored: S, typed: ['[Verse]', 'C   G', 'Amazing grace!'] });
  check('typed and Enter: the copy\'s words saved, with Undo, the song let go', typed.wrote === '[Verse]\nC   G\nAmazing grace!' && typed.toast === 'Saved' && typed.released === 1 && typed.rendered === 1);
  const book = E({ where: 'book', shown: S, stored: S, typed: ['[Verse]', 'C   G', 'Amazing grace!'] });
  check('...and in Book Mode, the book drawn again at the same page', book.wrote !== null && book.rebuilt === 1);
  const esc = E({ shown: S, stored: S, typed: ['WIPED'], save: false });
  check('Esc: nothing written, and the sheet drawn again as it was', esc.wrote === null && esc.released === 1 && esc.rendered === 1);
  const under = E({ shown: S, stored: S, now: ['[Verse]', 'C   G', 'Amazing love'], typed: ['[Verse]', 'C   G', 'Amazing grace!'] });
  check('words changed underneath while typing are not written over', under.wrote === null && /changed while you were typing/.test(under.toast));
  const locked = E({ shown: S, stored: S, typed: ['x'], may: false });
  check('...nor when another device has the song (what was typed stays, to copy)', locked.wrote === null && locked.released === 0);
  const respelled = E({ shown: S, stored: S, typed: ['[Verse]', 'C   G', 'Amazing grace '], mapped: S });
  check('typing that stores the very words it showed writes nothing', respelled.wrote === null);
  const waited = E({ shown: S, stored: S, typed: S, renderAfter: true });
  check('a redraw that waited while typing happens when it ends', waited.rendered === 1);
} else check('_sbNpEnd exists', false);
const keySrc = fn('_sbNpKey'), biSrc = fn('_sbNpBeforeInput');
if (keySrc && biSrc) {
  const K = (ev, N) => {
    let ended = null;
    const e = Object.assign({ isComposing: false, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }, ev);
    new Function('_sbNp', '_sbNpEnd', keySrc + '\n' + biSrc + '\n(arguments[2] ? _sbNpBeforeInput : _sbNpKey)(arguments[3]);')(N, (s) => { ended = s; }, !!ev.inputType, e);
    return { ended, prevented: e.prevented, stopped: e.stopped };
  };
  const N = () => ({ shift: false, adding: false });
  const enter = K({ key: 'Enter' }, N());
  check('Enter saves', enter.ended === true && enter.prevented);
  const n1 = N(), sh = K({ key: 'Enter', shiftKey: true }, n1), sh2 = K({ inputType: 'insertLineBreak' }, n1);
  check('Shift+Enter is the browser\'s new line, not a save', sh.ended === null && !sh.prevented && sh2.ended === null && !sh2.prevented);
  const esc = K({ key: 'Escape' }, N());
  check('Esc puts it back', esc.ended === false && esc.prevented);
  const other = K({ key: 'ArrowRight' }, N());
  check('the songbook\'s and the book\'s own keys stand down while typing', other.stopped && other.ended === null);
  const ret = K({ inputType: 'insertParagraph' }, N());
  check('a phone\'s Return, seen only as input, saves', ret.ended === true && ret.prevented);
  const nl = K({ inputType: 'insertParagraph' }, { shift: false, adding: true });
  check('...but not the bar\'s New line', nl.ended === null && !nl.prevented);
} else check('the notepad\'s keys exist', false);

console.log('\nStarting, and nothing redrawn underneath');
const start = fn('_sbNpStart');
check('typing refuses words that are not lines, and holds the song as every editor does',
  /if \(!stored \|\| shown\.length !== stored\.length\) \{/.test(start) && /if \(!_sbEditClaim\(song\)\) return false;/.test(start));
check('the whole sheet is the notepad; the instrument strips stay buttons',
  /el\.setAttribute\('contenteditable', 'true'\);/.test(start) && /querySelectorAll\('\.sbm-inst, \.sb-annot-svg'\)[^]*setAttribute\('contenteditable', 'false'\)/.test(start));
check('the cursor goes where the words were held, else on the first line (not in a strip)',
  /if \(x != null\) _sbNpCaretAt\(el, x, y\); else lhcCaretToStart\(el\.querySelector\('\[data-anchor\^="l:"\]'\) \|\| el\);/.test(start));
check('the song view is not redrawn while it is typed on',
  /function _sbmRender\(\) \{\n(\s*\/\/[^\n]*\n)*\s*if \(_sbNp && _sbNp\.where === 'view' && _sbNp\.el && _sbNp\.el\.isConnected\) \{ _sbNp\.renderAfter = true; return; \}/.test(SRC));
check('...nor the book\'s page (a resize, which a phone\'s keyboard opening is)',
  /function _sbFsRenderPage\(\) \{\n(\s*\/\/[^\n]*\n)*\s*if \(_sbNp && _sbNp\.where === 'book' && _sbNp\.el && _sbNp\.el\.isConnected\) \{ _sbNp\.renderAfter = true; return; \}/.test(SRC));
check('a tap elsewhere keeps it; the bar\'s buttons keep the focus',
  /_sbNpEnd\(true\);\n\s*\}, 0\);/.test(fn('_sbNpBlur')) && /onpointerdown="event\.preventDefault\(\)" onmousedown="event\.preventDefault\(\)"/.test(fn('_sbNpBar')));
check('the bar sits above a phone\'s keyboard', /vv\.offsetTop \+ vv\.height/.test(fn('_sbNpPlace')) && /addEventListener\('resize', _sbNpPlace\)/.test(fn('_sbNpBar')));

console.log('\nWhere it starts');
// The song view's Type chip went on 2026-11-11 (gotcha 84): Edit is where it
// was, and a double-tap on the words opens the editor there. Book Mode keeps
// its notepad.
check('the song view: no Type chip any more -- Edit beside Draw, where it was',
  /_sbmDrawChip\(\) \+ _sbmEditChip\(\) \+ _sbmLayersChip\(\)/.test(SRC) && !/function _sbmTypeChip\(/.test(SRC) && !/function sbmType\(/.test(SRC) &&
  has(/\n    sbNpNewLine: sbNpNewLine, sbNpSave: sbNpSave, sbNpCancel: sbNpCancel,\n/) && !/sbmType: sbmType/.test(SRC));
check('...and Edit opens what the Edit tile opens',
  /onclick="WO\.sbmEdit\(\)"/.test(fn('_sbmEditChip')) && /<i class="fa-solid fa-pen"><\/i>Edit<\/button>/.test(fn('_sbmEditChip')));
check('Book Mode: holding the words opens the whole song, or says why not (two columns)',
  /_sbNpStart\(wrap, song, 'book', x, y\);/.test(fn('_sbBkHold')) && /two columns/.test(fn('_sbBkHold')) && /_sbBkHold\(line, x, y\);/.test(fn('_sbBkDown')));
check('drawing keeps what was being typed first, and the line-transpose bar stands down while typing',
  /if \(_sbNp\) _sbNpEnd\(true\);/.test(fn('sbmDraw')) && /_sbmDraw \|\| _sbNp \|\| ly\.classList\.contains\('sbm-lyrics--nochords'\)/.test(fn('_sbmXpOnSel')));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
