'use strict';
// Harness for where an editor's cursor starts: on the first character.
//
// WHY THIS EXISTS
// From the operator (2026-11-06): Overview Edit in the Songbook opened with
// the cursor after the song's LAST character, scrolled to the bottom, and so
// did the other editors of its kind. A box filled from script keeps its
// cursor at the end of what it was given, and focusing it scrolls there; some
// openers even put it there on purpose ("Place cursor at end", "Focus at
// end"), and one selected the whole slide, so a single key replaced it. Now
// every editor that opens on words already written calls
// window.lhcCaretToStart once it is focused: cursor before the first
// character, box scrolled to its top. One-line fields (a name, a search, one
// choir line) keep the end, as any field does.
//
// USAGE
//   node tools/editor-caret-start-harness.js                 # ../Index.html
//   node tools/editor-caret-start-harness.js path/to/file.html
//   node tools/editor-caret-start-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 1f70f0c:Index.html > x`).
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

const SRC = fs.readFileSync(INDEX, 'utf8');
// A function's source, at the top level of a script or of a module.
const fn = name => { const m = SRC.match(new RegExp('\\n( {0,2})function ' + name + '\\([^)]*\\) \\{[^]*?\\n\\1\\}')); return m ? m[0] : ''; };

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}

console.log('The helper');
const helperM = SRC.match(/window\.lhcCaretToStart = function\(el\) \{[^]*?\n\};/);
if (helperM) {
  // Stand-ins: a textarea, and a contenteditable whose nodes a walker visits
  // in document order.
  function runOn(el, nodes) {
    const log = { range: null, sel: null };
    const doc = {
      createTreeWalker: () => { let i = 0; return { nextNode: () => (i < nodes.length ? nodes[i++] : null) }; },
      createRange: () => {
        const r = { start: null, before: null, collapsed: null };
        r.setStart = (n, o) => { r.start = [n, o]; };
        r.setStartBefore = n => { r.before = n; };
        r.collapse = t => { r.collapsed = t; };
        log.range = r;
        return r;
      },
    };
    const win = { getSelection: () => ({ removeAllRanges() { log.sel = null; }, addRange(r) { log.sel = r; } }) };
    new Function('window', 'document', helperM[0].replace('window.lhcCaretToStart', 'window.f') + '\nwindow.f(arguments[2]);')(win, doc, el);
    return log;
  }
  const ta = { tagName: 'TEXTAREA', value: 'a\nb\nc', scrollTop: 900, scrollLeft: 4, setSelectionRange(a, b) { this.sel = [a, b]; } };
  runOn(ta, []);
  check('a textarea: the cursor before its first character, scrolled to the top',
    ta.sel && ta.sel[0] === 0 && ta.sel[1] === 0 && ta.scrollTop === 0 && ta.scrollLeft === 0, JSON.stringify(ta));

  const line = { nodeType: 1, tagName: 'DIV', scrollIntoView() { this.seen = true; } };
  const ws = { nodeType: 3, data: '\n  ', parentNode: null };
  const chord = { nodeType: 3, data: 'C', parentNode: line };
  const ed = { tagName: 'DIV', scrollTop: 500, scrollLeft: 0 };
  const L = runOn(ed, [ws, line, chord]);
  check('a contenteditable: before the first character it shows, not the formatting whitespace between its blocks',
    L.range && L.range.start && L.range.start[0] === chord && L.range.start[1] === 0 && L.range.collapsed === true && L.sel === L.range,
    JSON.stringify(L.range && L.range.start));
  check('...scrolled to its top, with its first line brought into view', ed.scrollTop === 0 && line.seen === true);
  const br = { nodeType: 1, tagName: 'BR' };
  const L2 = runOn({ tagName: 'DIV', scrollTop: 0 }, [br, chord]);
  check('...an empty first line counts: the cursor goes before its line break', L2.range && L2.range.before === br);
  const empty = { tagName: 'DIV', scrollTop: 0 };
  const L3 = runOn(empty, []);
  check('...and an empty editor gets the cursor at its start', L3.range && L3.range.start && L3.range.start[0] === empty && L3.range.start[1] === 0);
} else {
  check('there is one helper for it, window.lhcCaretToStart', false);
}

console.log('\nEvery editor that opens on words already written starts at the top');
const OPENERS = [
  ['_sbmPadOpen', 'Songbook: Overview Edit (and every use of its pad)'],
  ['openLyricsEditor', 'Lyrics & Chords, from the song form'],
  ['sbOpenLyricsEditor', 'Lyrics & Chords, from the Songbook'],
  ['_sbChoirTextEditor', 'the printed choir page\'s parts text'],
  ['lcdUnlockEditor', 'LCD Projection: the Slide Editor pad'],
  ['openAllSlidesModal', 'LCD Projection: All Slides'],
  ['lcdSongPreviewToggleEdit', 'LCD Projection: a song preview\'s Edit'],
  ['editContent', 'the schedule\'s content box'],
  ['editLiturgyBox', 'the schedule\'s liturgy box'],
  ['editSlideBox', 'the schedule\'s slide box'],
  ['enableLyricsEdit', 'the full-screen lyrics editor'],
  ['openLitAllSlides', 'Liturgy page: All Slides'],
  ['openLitOccAllSlides', 'Liturgy page: an occasion\'s All Slides'],
  ['_sbLitLogSetReadOnly', 'Liturgist Notes'],
  ['editGuideSection', 'a preparation guide section'],
  ['openMemoryEditor', 'a memory note'],
];
OPENERS.forEach(([name, label]) => {
  const src = fn(name);
  check(label + ' (' + name + ')', !!src && /lhcCaretToStart\(/.test(src), src ? '' : 'function not found');
});
const sheet = fn('_lbdSheet');
check('Liturgy Builder: All Slides, a textarea, starts at the top; a search or a name keeps its end',
  /if \(f\.tagName === 'TEXTAREA'\) lhcCaretToStart\(f\);/.test(sheet));
check('the slide box no longer selects the whole slide, where one key replaced it',
  !/r\.selectNodeContents\(editor\);\r?\n\s*var s = window\.getSelection\(\);\r?\n\s*s\.removeAllRanges\(\);\r?\n\s*s\.addRange\(r\);/.test(fn('editSlideBox')));

console.log('\nNothing puts it back at the end');
const ends = (SRC.match(/(\w+)\.setSelectionRange\(\1\.value\.length, \1\.value\.length\)/g) || []);
check('only one-line fields still take the end: a choir line, its chords, the Memories and Services searches',
  ends.length === 4 && ends.filter(e => /^inp\./.test(e)).length === 2 && ends.filter(e => /^box\./.test(e)).length === 1 &&
  ends.filter(e => /^s\./.test(e)).length === 1, ends.join(' | '));
check('no "place the cursor at the end" left in an opener',
  !/\/\/ Place cursor at end of existing text|\/\/ Focus at end\r?\n/.test(SRC));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
