'use strict';
// Harness for slide parts in the LCD Projection rail.
//
// WHY THIS EXISTS
// From the operator (2026-11-08), on a marked-up screenshot of the rail: the
// slides of one song were eighteen identical rows -- the same song title on
// every one, the first line of lyric underneath -- with nothing to say where
// Verse 1 ended and the Chorus began. They had written "Verse 1" and
// "Chorus" on the screenshot by hand, boxed the rows each covered, and asked
// for three things: slides separated into chunks rather than one flat list,
// coloured badges for the parts of a song, and headings they could add
// themselves to liturgy slides, which have no markers of their own.
//
// THE TWO FACTS THIS GUARDS
//
// 1. The part is CARRIED DOWN, never written. parseLyricsIntoSlides hangs
//    "[Verse 1]" on the slide the marker opened and leaves the slides that
//    finish the verse with nothing. _lcdSlideParts reads that run and fills
//    it in. Writing the label onto each slide instead would have been the
//    obvious fix and is the wrong one -- see fact 2.
//
// 2. A heading is NEVER PROJECTED, and that is what makes adding one safe.
//    selectSlideBox projects the text of .wo-slide-content and nothing else;
//    a heading lives in .wo-slide-section-header, which is that element's
//    SIBLING. Put a heading inside .wo-slide-content and "VERSE 1" goes up
//    on the wall in front of the congregation. _lcdWriteSlideHeader inserts
//    before, and this harness checks it.
//
// USAGE
//   node tools/lcd-rail-parts-harness.js                 # ../Index.html
//   node tools/lcd-rail-parts-harness.js path/to/file.html
//   node tools/lcd-rail-parts-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 7ac0eac:Index.html > x`).
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
const has = re => re.test(SRC);
const fn = name => {
  const m = SRC.match(new RegExp('  function ' + name + '\\([^)]*\\) \\{[^]*?\\n  \\}'));
  return m ? m[0] : '';
};

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}

// ---------------------------------------------------------------------------
// The part model, run on its own
// ---------------------------------------------------------------------------
console.log('A song marks a part once; the rest of the run inherits it');

const partsSrc = fn('_lcdSlideParts');
const kindSrc = fn('_lcdPartKind');
const kindsTable = (SRC.match(/  var _LCD_PART_KINDS = \[[^]*?\n  \];/) || [''])[0];
const typeClassSrc = fn('getSectionTypeClass');

let P = null, K = null, TC = null;
if (partsSrc && kindSrc && kindsTable && typeClassSrc) {
  const api = new Function([
    partsSrc, kindsTable, kindSrc, typeClassSrc,
    'return { parts: _lcdSlideParts, kind: _lcdPartKind, typeClass: getSectionTypeClass };'
  ].join('\n'))();
  P = api.parts; K = api.kind; TC = api.typeClass;
}

if (!P) {
  check('_lcdSlideParts / _lcdPartKind / _LCD_PART_KINDS are all present', false,
    'parts=' + !!partsSrc + ' kind=' + !!kindSrc + ' table=' + !!kindsTable);
} else {
  // The operator's own song: a marker, then three unmarked slides that finish
  // the verse, then the chorus marker and two more.
  const song = P(['Verse 1', '', '', '', 'Chorus', '', 'Verse 2', '']);
  check('every slide of the run carries its part',
    song.slides.map(s => s.label).join('|') ===
    'Verse 1|Verse 1|Verse 1|Verse 1|Chorus|Chorus|Verse 2|Verse 2',
    song.slides.map(s => s.label).join('|'));
  check('only the marked slide owns the heading',
    song.slides.map(s => (s.own ? 'Y' : 'n')).join('') === 'YnnnYnYn',
    song.slides.map(s => (s.own ? 'Y' : 'n')).join(''));
  check('each slide knows its place in the part (2 of 4)',
    song.slides.map(s => s.pos + '/' + s.of).join(' ') ===
    '1/4 2/4 3/4 4/4 1/2 2/2 1/2 2/2',
    song.slides.map(s => s.pos + '/' + s.of).join(' '));
  check('a run starts where its heading is, so the rail knows which row to draw it on',
    song.slides.map(s => s.start).join(',') === '0,0,0,0,4,4,6,6',
    song.slides.map(s => s.start).join(','));
  check('one run per heading',
    song.runs.length === 3 && song.runs.map(r => r.size).join(',') === '4,2,2',
    JSON.stringify(song.runs));

  // The unlabelled cases, which are most of the library and all of liturgy.
  const bare = P(['', '', '']);
  check('a song with no markers is one unlabelled run -- drawn as the rail always drew it',
    bare.runs.length === 1 && bare.runs[0].label === '' && bare.slides.every(s => s.label === ''),
    JSON.stringify(bare.runs));
  const late = P(['', '', 'Chorus', '']);
  check('words before the first marker keep their own run rather than joining the chorus',
    late.runs.length === 2 && late.runs[0].size === 2 && late.runs[1].label === 'Chorus',
    JSON.stringify(late.runs));
  check('no slides, no runs', P([]).runs.length === 0 && P([]).slides.length === 0);
  check('null and whitespace headings are no heading',
    P([null, '   ', undefined]).runs.length === 1,
    JSON.stringify(P([null, '   ', undefined]).runs));
  check('it does not reach into the DOM or mutate what it was given',
    (() => { const src = ['Verse 1', '']; P(src); return src.join('|') === 'Verse 1|'; })());

  console.log('\nThe colours tell the parts apart');
  check('pre-chorus is not a chorus -- the test order is the whole point',
    K('Pre-Chorus') === 'prechorus' && K('Pre Chorus') === 'prechorus' &&
    K('prechorus 2') === 'prechorus' && K('Chorus') === 'chorus',
    K('Pre-Chorus') + ' / ' + K('Pre Chorus'));
  check('the parts of a song each get their own kind',
    K('Verse 2') === 'verse' && K('Bridge') === 'bridge' &&
    K('Refrain') === 'chorus' && K('Intro') === 'intro' &&
    K('Outro') === 'ending' && K('Instrumental') === 'intro');
  check('a heading the operator typed is a part too',
    K('Kyrie') === 'custom' && K('Post Communion') === 'custom');
  check('no heading, no colour', K('') === '' && K(null) === '' && K('   ') === '');

  console.log('\n...and the slide box agrees with them');
  check('getSectionTypeClass can finally reach prechorus',
    TC('Pre-Chorus') === 'prechorus' && TC('Pre chorus') === 'prechorus',
    TC('Pre-Chorus'));
  check('...without changing any other answer it already gave',
    TC('Verse 1') === 'verse' && TC('Chorus') === 'chorus' &&
    TC('Bridge') === 'bridge' && TC('Outro') === 'ending' &&
    TC('Kyrie') === 'other' && TC('') === '');
}

// ---------------------------------------------------------------------------
// A heading is never projected
// ---------------------------------------------------------------------------
console.log('\nA heading never reaches the screen in the room');

const writeSrc = fn('_lcdWriteSlideHeader');
check('_lcdWriteSlideHeader inserts BEFORE .wo-slide-content, never into it',
  /insertBefore\(el, content\)/.test(writeSrc) &&
  !/content\.appendChild|content\.insertAdjacentHTML/.test(writeSrc),
  writeSrc.slice(0, 300));
check('...and the projection still reads .wo-slide-content and nothing else',
  has(/var content = box\.querySelector\('\.wo-slide-content'\);/) &&
  !has(/text = .*wo-slide-section-header/));
check('an empty heading removes the element rather than leaving a blank one',
  /if \(!t\) \{ if \(el\) el\.remove\(\); return; \}/.test(writeSrc), writeSrc.slice(0, 200));
check('the heading element is the one collectOrderItems already saves',
  has(/var headerEl\s*=\s*box\.querySelector\('\.wo-slide-section-header'\);/) &&
  has(/header:\s*_lh,/));

// ---------------------------------------------------------------------------
// The rail draws the chunks
// ---------------------------------------------------------------------------
console.log('\nThe rail is chunked, not one flat list');

const railSrc = fn('_lcdRenderCompactRail');
check('a song gets a heading row of its own, then its parted rows',
  /_lcdBuildItemGroupRow\('song', groupTitle, _songBoxes\.length\)/.test(railSrc) &&
  /_lcdPartedRowsHtml\(sIdx, slideCounter, groupTitle, _songBoxes, 'fa-music'\)/.test(railSrc),
  railSrc.slice(0, 200));
check('...and so does a liturgy item, which is where hand-added headings land',
  /_lcdBuildItemGroupRow\('liturgy', litTitle, _litBoxes\.length\)/.test(railSrc) &&
  /_lcdPartedRowsHtml\(sIdx, slideCounter, litTitle, _litBoxes, 'fa-book-bible'\)/.test(railSrc));
check('a reading goes through the same path, keeping the heading row it had',
  /_lcdBuildScriptureGroupRow\(sectionId, _scrSub, scriptTitle, _scrBoxes\.length\)/.test(railSrc) &&
  /_lcdPartedRowsHtml\(sIdx, slideCounter, scriptTitle,/.test(railSrc));
check('the numbering is unchanged -- the counter still advances once per slide',
  /slideCounter \+= _songBoxes\.length;/.test(railSrc) &&
  /slideCounter \+= _litBoxes\.length;/.test(railSrc) &&
  /slideCounter \+= _scrBoxes\.length;/.test(railSrc));

const partedSrc = fn('_lcdPartedRowsHtml');
check('a heading row is drawn once per run, on the row the run starts at',
  /if \(p\.label && k === p\.start\) html \+= _lcdBuildPartRow/.test(partedSrc), partedSrc);
check('...and never for an unlabelled run, which has nothing to say',
  /p\.label &&/.test(partedSrc));

const partRowSrc = fn('_lcdBuildPartRow');
check('the heading row selects the first slide of its part when clicked',
  /_lcdRailRowMap\[rowId\] = box;/.test(partRowSrc) &&
  /_lcdRailRowClick/.test(partRowSrc), partRowSrc.slice(0, 300));
check('...and carries a rename and a remove',
  /WO\.lcdSetSlideHeader/.test(partRowSrc) && /WO\.lcdClearSlideHeader/.test(partRowSrc));

const rowSrc = fn('_lcdBuildRailRow');
check('a grouped row shows the WORDS, not the item title repeated down the list',
  /var _words = lines\.slice\(0, 2\)/.test(rowSrc) &&
  /_grouped[^]*lcd-rail-words/.test(rowSrc), rowSrc.slice(0, 400));
check('...and an ungrouped row is left exactly as it was',
  /: \('<div class="lcd-rail-item-title">' \+ _flag \+ escapeHtml\(groupTitle\)/.test(rowSrc));
check('the row carries its part as an attribute, for the colour edge',
  /var _partAttr = _kind \? ' data-part="' \+ _kind \+ '"' : '';/.test(rowSrc));
check('"Double-click to add content" is not mistaken for a line of the slide',
  /wo-slide-empty-hint/.test(rowSrc) && /Double-click to add content/.test(rowSrc));
check('every row offers the tag button that adds a heading',
  /lcd-rail-slide-tag[^]*WO\.lcdSetSlideHeader/.test(rowSrc));

// ---------------------------------------------------------------------------
// Adding one, and keeping it
// ---------------------------------------------------------------------------
console.log('\nA heading the operator adds survives the reload');

check('a liturgy slide gets its saved heading back on load',
  has(/if \(slide\.header\) _lcdWriteSlideHeader\(slideBox, slide\.header\);/));
check('a song slide already did, through addSongToServiceSection',
  has(/var headerClass = getSectionTypeClass\(slide\.header\);/));

const setSrc = fn('lcdSetSlideHeader');
check('Cancel is not the same as clearing it',
  /if \(v === null \|\| v === undefined\) return;/.test(setSrc), setSrc.slice(0, 400));
check('...and setting one is undoable and saved',
  /_lcdPushUndo/.test(setSrc) && /autoSaveOrder/.test(setSrc) && /_lcdRenderCompactRail/.test(setSrc));
check('both actions are reachable from the markup',
  has(/lcdSetSlideHeader: lcdSetSlideHeader,/) &&
  has(/lcdClearSlideHeader: lcdClearSlideHeader,/));
// Measured at 1158px: labelling slide 4.8 sent the rail from 2072 to 214.
// Two causes, both guarded here -- replacing the rail's markup clamps its
// scroller to the top, and the watcher then reveals the PROJECTING slide.
check('labelling a slide leaves the operator where they were, not at the projection',
  /_lcdRailHoldScroll\(\);/.test(setSrc) &&
  /_lcdRailHoldScroll\(\);/.test(fn('lcdClearSlideHeader')));
check('...the position is taken BEFORE the change, the only moment it is right',
  /_lcdRailHoldScroll\(\);\r?\n\s*_lcdWriteSlideHeader/.test(setSrc), setSrc.slice(0, 600));
check('...and put back after each rebuild one edit brings, not just the first',
  /\[0, 60, 150, 320, 700, 1100\]\.forEach/.test(fn('_lcdRailHoldScroll')),
  fn('_lcdRailHoldScroll').slice(0, 300));
check('...with the watcher held off for a window, not for one reveal',
  has(/if \(Date\.now\(\) < _lcdSkipRevealUntil\) return;/) &&
  /_lcdSkipRevealUntil = Date\.now\(\) \+ 1200;/.test(fn('_lcdRailHoldScroll')));

console.log('\nThe Slide Editor says which part it is showing');
check('the badge exists in the panel header',
  has(/<span class="lcd-slide-part-badge" id="lcdLyricsEditorPart"/));
check('it is filled when a slide loads and emptied when none is selected',
  has(/_lcdShowEditorPart\(_lcdPartOfBox\(box\)\);/) &&
  has(/_lcdShowEditorPart\(''\);/));
const ofBoxSrc = fn('_lcdPartOfBox');
check('_lcdPartOfBox stops at the edge of its own group',
  /if \(key && cur\.getAttribute\(key\) !== id\) break;/.test(ofBoxSrc) &&
  /if \(!cur\.classList \|\| !cur\.classList\.contains\('wo-slide-box'\)\) break;/.test(ofBoxSrc),
  ofBoxSrc);

// ---------------------------------------------------------------------------
// The look
// ---------------------------------------------------------------------------
console.log('\nThe colours are far enough apart to tell at a glance');
const PART_HUES = {
  verse: '#5b8dd9', chorus: '#c1993f', prechorus: '#f08a3c',
  bridge: '#9573d6', intro: '#8b97a8', ending: '#dd7272', custom: '#3fa96d',
};
Object.keys(PART_HUES).forEach(k => {
  check('  ' + k + ' is drawn on the heading and on its slides in one colour',
    has(new RegExp('\\.lcd-rail-part\\[data-part="' + k + '"\\][^\\n]*border-left-color: ' + PART_HUES[k])) &&
    has(new RegExp('\\.lcd-rail-slide-row\\[data-part="' + k + '"\\]::before\\s*\\{ background: ' + PART_HUES[k])));
});
check('seven distinct hues, no two the same',
  new Set(Object.values(PART_HUES)).size === 7);
check('the edge is a ::before bar, leaving border and box-shadow to selection and drag',
  has(/\.lcd-rail-slide-row\[data-part\]::before \{/) &&
  !has(/\.lcd-rail-slide-row\[data-part\] \{[^}]*border-left:/));
check('the words wrap to two lines, beating the ivory block that sets nowrap',
  has(/\.lcd-rail-item-title\.lcd-rail-words \{[^]*?-webkit-line-clamp: 2;/));
check('the tag and the heading buttons are there on a touch screen, which has no hover',
  has(/@media \(hover: none\) \{ \.lcd-rail-slide-tag \{ opacity: 0\.7; \} \}/) &&
  has(/@media \(hover: none\) \{ \.lcd-rail-part-btn \{ opacity: 0\.8; \} \}/));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
