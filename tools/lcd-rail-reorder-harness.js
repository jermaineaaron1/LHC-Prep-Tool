'use strict';
// Harness for dragging subsections and song structures in the LCD rail.
//
// WHY THIS EXISTS
// From the operator (2026-11-26), on a marked-up screenshot of the rail with
// three things circled -- a liturgy heading, a song heading, and the VERSE
// badge inside that song -- and written across it: "Drag and drop reorder".
// Their words: "I want to be able to drag and drop to reorder subsections,
// and make sure these changes reflect the liturgy library and the songbook
// too. Allow to drag and reorder sections, subsections and song structures
// (verse, chorus, etc.)".
//
// Sections and single slides already dragged. The two that did not were the
// two they circled: the item heading (.lcd-rail-item-group) was a plain div
// with no id and no drag, and the part badge (.lcd-rail-part) was clickable
// only.
//
// THE FOUR FACTS THIS GUARDS
//
// 1. A PART IS A RUN, NOT A STORED THING. _lcdSlideParts reads the slides'
//    own headers and carries each one down over the slides that finish the
//    verse (gotcha 73). So moving a part means moving its whole run of
//    boxes; the header rides on the run's first box, which is where it
//    lives. Move one box and the header stays behind on a different verse.
//
// 2. THE WORDS ARE A SEPARATE DOCUMENT FROM THE SLIDES (gotcha 84). The
//    Songbook, the printed sheet and the band read customLyrics; the wall
//    reads slides. Writing the moved slides back into the words is the
//    obvious fix and is WRONG: the slides are built with the chord lines
//    taken out (_sbProjectionWords), so a write-back deletes every chord in
//    the song. Moving whole labelled BLOCKS of the words carries the chords
//    along inside them, untouched.
//
// 3. WITHIN ONE SECTION THIS APP LISTS SONGS BEFORE THE OTHER PARTS --
//    _lbdSecOrder, the schedule's own rebuild on load, the Liturgy Book, the
//    export, the share message. A song dropped among its section's liturgy
//    would look right until the next load and then snap back, so the drag
//    refuses it. Moving to a DIFFERENT section is fine and lands last.
//
// 4. A READING IS ORDERED BY ITS TEMPLATE SLOT, not by where it stands.
//    _lbdSecOrder places scripture by _lbdSlotLabels before anything else,
//    so a reading is deliberately not draggable -- same silent-revert trap.
//
// USAGE
//   node tools/lcd-rail-reorder-harness.js                 # ../Index.html
//   node tools/lcd-rail-reorder-harness.js path/to/file.html
//   node tools/lcd-rail-reorder-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 43b39ff:Index.html > x`).
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
  const m = SRC.match(new RegExp('\\n  function ' + name + '\\([^)]*\\) \\{[^]*?\\n  \\}'));
  return m ? m[0] : '';
};

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else {
    failed++;
    console.log('  FAIL ' + name);
    if (detail) console.log('       ' + String(detail).slice(0, 400).replace(/\n/g, '\n       '));
  }
}
function section(t) { console.log('\n' + t); }

// ---------------------------------------------------------------------------
// 1. The pure helpers, RUN rather than matched.
// ---------------------------------------------------------------------------
section('1. The words split the way the slides were');

const PURE = [
  '_lcdSlideParts', '_lcdIsLyricMarker', '_lcdLyricBlocks', '_lcdBlocksText',
  '_lcdMoveBlock', '_lcdPartRuns', '_lcdRunDest', '_lcdItemDropOk'
];
const slices = PURE.map(fn);
check('every pure helper is in the source', slices.every(Boolean),
  PURE.filter((n, i) => !slices[i]).join(', ') || '');

let P = null;
if (slices.every(Boolean)) {
  // eslint-disable-next-line no-new-func
  P = new Function(slices.join('\n') + '\nreturn {' + PURE.map(n => n + ': ' + n).join(', ') + '};')();
}
check('they load and run', !!P);

if (P) {
  // -- the marker rule is parseLyricsIntoSlides' own ------------------------
  check('a bracketed marker opens a block', P._lcdIsLyricMarker('[Verse 1]') === 'Verse 1');
  check('a bare Chorus line does too', P._lcdIsLyricMarker('Chorus') === 'Chorus');
  check('...with its colon dropped, as the slide parser drops it',
    P._lcdIsLyricMarker('Verse 2:') === 'Verse 2');
  check('a line of lyric is not a marker',
    P._lcdIsLyricMarker('Amazing grace how sweet the sound') === '');
  check('a chord line is not a marker', P._lcdIsLyricMarker('G    C    D') === '');

  const SONG = [
    '[Verse 1]',
    'G        C',
    'Make a joyful noise',
    '',
    '[Chorus]',
    'D        G',
    'Sing to the Lord',
    '',
    '[Verse 2]',
    'Am       F',
    'Lift up your voice'
  ].join('\n');

  const blocks = P._lcdLyricBlocks(SONG);
  check('a song splits into its labelled blocks',
    blocks.length === 3 && blocks.map(b => b.label).join('|') === 'Verse 1|Chorus|Verse 2',
    JSON.stringify(blocks.map(b => b.label)));
  check('...and round-trips byte for byte when nothing moves',
    P._lcdBlocksText(blocks) === SONG,
    JSON.stringify(P._lcdBlocksText(blocks)));

  const moved = P._lcdMoveBlock(blocks, 2, 0);
  const movedText = P._lcdBlocksText(moved);
  check('Verse 2 moved to the front lands there',
    moved.map(b => b.label).join('|') === 'Verse 2|Verse 1|Chorus',
    JSON.stringify(moved.map(b => b.label)));
  // THE POINT OF THE WHOLE APPROACH: the chords are inside the block.
  check('...and its chord line travels with it',
    /\[Verse 2\]\nAm       F\nLift up your voice/.test(movedText), JSON.stringify(movedText));
  check('...and no chord is lost from the song',
    ['G        C', 'D        G', 'Am       F'].every(c => movedText.indexOf(c) !== -1),
    JSON.stringify(movedText));
  check('...and the song still has every one of its lines',
    movedText.split('\n').filter(Boolean).sort().join('|') ===
    SONG.split('\n').filter(Boolean).sort().join('|'));

  const down = P._lcdMoveBlock(blocks, 0, 2);
  check('a block moved to the last place lands last',
    down && down.map(b => b.label).join('|') === 'Chorus|Verse 2|Verse 1',
    down && JSON.stringify(down.map(b => b.label)));

  check('a move that goes nowhere answers null', P._lcdMoveBlock(blocks, 1, 1) === null);
  check('an index off the end answers null rather than guessing',
    P._lcdMoveBlock(blocks, 0, 9) === null && P._lcdMoveBlock(blocks, 9, 0) === null);

  // -- a preamble before the first marker keeps its place -------------------
  const PRE = ['A line before any marker', '', '[Verse 1]', 'one', '', '[Chorus]', 'two'].join('\n');
  const pb = P._lcdLyricBlocks(PRE);
  check('words before the first marker are their own unlabelled block',
    pb.length === 3 && pb[0].label === '' && pb[1].label === 'Verse 1', JSON.stringify(pb.map(b => b.label)));
  const pmoved = P._lcdMoveBlock(pb, 1, 0);
  check('...and stay at the top when a part is moved to the front',
    pmoved && pmoved[0].label === '' && pmoved[1].label === 'Chorus',
    pmoved && JSON.stringify(pmoved.map(b => b.label)));

  // -- the runs the rail shows, from the slides' own headers ----------------
  // One header, carried down over the slides that finish the verse: three
  // slides, one run. This is fact 1, run rather than described.
  const runs = P._lcdPartRuns(['Verse 1', '', '', 'Chorus', '', 'Verse 2']);
  check('a header carried down over its slides is ONE run',
    runs.length === 3 && runs.map(r => r.label).join('|') === 'Verse 1|Chorus|Verse 2',
    JSON.stringify(runs));
  check('...and each run knows how many slides it covers',
    runs[0].size === 3 && runs[1].size === 2 && runs[2].size === 1,
    JSON.stringify(runs.map(r => r.size)));
  check('an unlabelled opening run is not offered as a draggable part',
    P._lcdPartRuns(['', '', 'Chorus']).length === 1);

  // -- a song whose slides and words disagree is left alone -----------------
  check('three labelled runs pair with three labelled blocks',
    P._lcdPartRuns(['Verse 1', '', 'Chorus', 'Verse 2']).length === blocks.length);
  check('...and a song with a hand-typed extra heading does not',
    P._lcdPartRuns(['Verse 1', 'Reprise', 'Chorus', 'Verse 2']).length !== blocks.length);
}

// ---------------------------------------------------------------------------
section('2. Where a dropped run lands');

if (P) {
  // Dropping B on A's top edge in [A,B,C] puts B first. Off by one here puts
  // a verse one place from where it was let go, silently.
  check('dropped above the first, it lands first', P._lcdRunDest(1, 0, false) === 0);
  // Dropping B below A in [A,B,C] is exactly where B already stands, so
  // the drop is a no-op rather than a move to the front.
  check('dropped below the one above it, nothing moves', P._lcdRunDest(1, 0, true) === 1);
  check('dropped below the last, it lands last', P._lcdRunDest(0, 2, true) === 2);
  check('dropped above the last, it lands second', P._lcdRunDest(0, 2, false) === 1);
  check('dropped on itself, nothing moves', P._lcdRunDest(1, 1, false) === 1);
}

// ---------------------------------------------------------------------------
section('3. Which subsection drops are allowed (fact 3)');

if (P) {
  const song = (id, sec) => ({ kind: 'song', id: id, sec: sec });
  const lit = (id, sec) => ({ kind: 'liturgy', id: id, sec: sec });

  check('a song onto another song in its own section is allowed',
    P._lcdItemDropOk(song('a', 's1'), song('b', 's1')) === true);
  check('a liturgy onto another liturgy in its own section is allowed',
    P._lcdItemDropOk(lit('a', 's1'), lit('b', 's1')) === true);
  // The whole reason this rule exists: it would snap back on the next load.
  check('a song onto a liturgy IN THE SAME SECTION is refused',
    P._lcdItemDropOk(song('a', 's1'), lit('b', 's1')) === false);
  check('a liturgy onto a song in the same section is refused too',
    P._lcdItemDropOk(lit('b', 's1'), song('a', 's1')) === false);
  check('any kind onto any kind in ANOTHER section is allowed',
    P._lcdItemDropOk(song('a', 's1'), lit('b', 's2')) === true &&
    P._lcdItemDropOk(lit('b', 's2'), song('a', 's1')) === true);
  check('onto itself is refused', P._lcdItemDropOk(song('a', 's1'), song('a', 's1')) === false);
  check('a missing id is refused rather than thrown on',
    P._lcdItemDropOk(null, song('a', 's1')) === false &&
    P._lcdItemDropOk(song('a', 's1'), null) === false);
}

// ---------------------------------------------------------------------------
section('4. The rail offers the handles');

check('a part badge is draggable and says which item and run it is',
  has(/<div class="lcd-rail-part" draggable="true"/) &&
  has(/data-run-item="/) && has(/data-run-size="/) && has(/data-run-sec="/));
check('an item heading is draggable, with its kind, id and section',
  has(/data-item-kind="/) && has(/data-item-id="/) && has(/data-item-sec="/));
// Fact 4: a reading's place is its template slot, so it must NOT get a handle.
check('only a song or a liturgy gets one -- a reading does not (fact 4)',
  /var _drag = \(kind === 'song' \|\| kind === 'liturgy'\) && groupId && sectionId;/.test(SRC));
check('...and the scripture heading builder was left alone',
  !/lcd-rail-scr-group[^]{0,400}draggable/.test(SRC));
check('both new drags are wired on every render, beside the two that existed',
  /_lcdWireRailDrag\(rail\);\s*\r?\n\s*_lcdWirePartDrag\(rail\);\s*\r?\n\s*_lcdWireItemDrag\(rail\);/.test(SRC));

// ---------------------------------------------------------------------------
section('5. A run moves whole, and the model follows');

const runDrop = fn('_lcdRunDrop');
check('_lcdRunDrop is in the source', !!runDrop);
// Fact 1: the whole run, not the heading row's own box.
check('it moves the run\'s boxes, not one box',
  /var moving = _lcdRunBoxes\(from\), onto = _lcdRunBoxes\(row\);/.test(runDrop), runDrop.slice(0, 200));
check('it refuses a run from another item', /_lcdSameRunItem\(from, row\)/.test(runDrop));
// Backgrounds are keyed by a slide's place in its section (gotcha 94), so a
// reorder that does not re-pin them swaps each moved slide's background.
check('the section\'s backgrounds are captured before the move',
  /_lcdCaptureSectionBgs\(sectionId\)/.test(runDrop));
check('...and restored after it', /_lcdRestoreSectionBgs\(sectionId, bgs\)/.test(runDrop));
check('a song\'s slides array is rebuilt from the new DOM order',
  /if \(songId\) _lcdReorderSongSlides\(songId, sectionId\);/.test(runDrop));
// Superseded by the operator's second round: the rail no longer pins the
// scroll where it WAS -- the part that moved is elsewhere now -- but is
// brought to what moved, AFTER the redraw. Section 10 guards the helper.
check('the rail ends on the part that moved, after the redraw',
  runDrop.indexOf('_lcdRailFocusOn(') > runDrop.indexOf('_lcdRenderCompactRail()'),
  runDrop.slice(-400));
check('the move is one undo step', /_lcdPushUndo\(\);/.test(runDrop));

const words = fn('_lcdMoveSongWords');
check('_lcdMoveSongWords is in the source', !!words);
// Fact 2, in the code rather than only in the comment.
check('it moves lyric BLOCKS, never the slides\' text (fact 2)',
  /_lcdLyricBlocks\(words\)/.test(words) && /_lcdMoveBlock\(blocks, from, to\)/.test(words) &&
  !/slides\s*\.\s*map[^]{0,200}customLyrics\s*=/.test(words), words.slice(0, 300));
check('a song whose words and slides disagree is left exactly as it was',
  /labelled\.length !== runs\.length\) return 'mismatch'/.test(words), words);
// _sbSetCopyWords is the one path that writes a copy's words: it keeps
// richLyrics in step, re-splits the slides only when the projected words
// changed, and tells the other devices (gotchas 84, 93).
check('the write goes through the Songbook\'s own save, not a raw assignment',
  /_sbSetCopyWords\(song, _lcdBlocksText\(moved\)\)/.test(words));
check('the operator is told when the words could not follow',
  /this song is not written in the parts the rail shows/.test(SRC));

// ---------------------------------------------------------------------------
section('6. A subsection reorder reaches the model');

const reorder = fn('_lcdItemReorder');
check('_lcdItemReorder is in the source', !!reorder);
check('a song reorder writes songOrderSections, a liturgy writes allItems',
  /if \(from\.kind === 'song'\) _lcdWriteSongOrder\(container, from\.sec\);\s*\r?\n\s*else _lcdWriteItemOrder\(container, from\.sec\);/.test(reorder),
  reorder.slice(-500));
check('it re-pins the section\'s backgrounds',
  /_lcdCaptureSectionBgs\(from\.sec\)/.test(reorder) && /_lcdRestoreSectionBgs\(from\.sec, bgs\)/.test(reorder));
check('the rail ends on the subsection that moved, after the redraw',
  reorder.indexOf('_lcdRailFocusOn(') > reorder.indexOf('_lcdRenderCompactRail()'));

const songOrder = fn('_lcdWriteSongOrder');
check('_lcdWriteSongOrder is in the source', !!songOrder);
// gotcha 42: a medley is a SET carried as one unit; _woWriteSeq puts a
// sublist back into the slots its songs held, leaving every other song alone.
check('it writes through _woWriteSeq, so songs outside the section do not move',
  /_woWriteSeq\(songOrderSections, seqOld, seqNew\)/.test(songOrder), songOrder);
check('...inside _woSongsChange, which knows the LCD is in the page (gotcha 44)',
  /_woSongsChange\(function\(\) \{/.test(songOrder));
check('a list it cannot match one-for-one is abandoned, not half-written',
  /if \(seqNew\.length !== seqOld\.length\) return;/.test(songOrder));

const itemOrder = fn('_lcdWriteItemOrder');
check('_lcdWriteItemOrder is in the source', !!itemOrder);
check('it rewrites only this section\'s slots in allItems',
  /slots\.forEach\(function\(at, k\) \{ all\[at\] = seqNew\[k\]; \}\);/.test(itemOrder), itemOrder);
check('...and abandons a mismatch rather than writing part of it',
  /if \(seqNew\.length !== mine\.length \|\| !slots\.length\) return;/.test(itemOrder));

// ---------------------------------------------------------------------------
section('7. Moving a subsection to another section');

const toSec = fn('_lcdItemToSection');
check('_lcdItemToSection is in the source', !!toSec);
check('it refuses a section the order does not have',
  /if \(!document\.getElementById\(toSec \+ '-boxes'\)\) return;/.test(toSec));

const songTo = fn('_lcdSongToSection');
check('_lcdSongToSection is in the source', !!songTo);
// gotcha 55: a song sung in two sections is two copies, so moving one into a
// section that already sings it would make two copies in one section.
check('a section that already sings the song refuses the move (gotcha 55)',
  /_woSongCopyIn\(song\.songId \|\| song\.id, toSec\)/.test(songTo), songTo.slice(0, 400));
// remote: true is what stops the removal recording the song as deliberately
// taken OUT of the service -- this is a move.
check('it leaves by the schedule\'s own path, as a move not a removal',
  /removeSongFromSection\(null, from\.sec, from\.id, \{ remote: true \}\)/.test(songTo));
check('...and clears the taken-out flag, so the next save does not drop it',
  /delete _woSongsTakenOutOfSections\[song\.id\]/.test(songTo));
check('all three records of where a song belongs are updated',
  /song\.sectionId = toSec;/.test(songTo) && /song\.serviceSections = refs;/.test(songTo) &&
  /addSongToServiceSection\(toSec, song, true, true\)/.test(songTo), songTo);

const litTo = fn('_lcdLiturgyToSection');
check('_lcdLiturgyToSection is in the source', !!litTo);
// gotcha 37: the LCD draws a liturgy once per order; a second copy in one
// section is dropped from the next save, so it is refused up front.
check('a duplicate liturgy in the target section is refused (gotcha 37)',
  /x\.itemType === 'liturgy' && x\.sourceId === it\.sourceId && x\.sectionId === toSec/.test(litTo));
// A liturgy's id names its section -- both collectors build it that way.
check('its id is rebuilt for the new section',
  /var newId = _lbdPfx\(\) \+ 'liturgy_' \+ it\.sourceId \+ '_' \+ toSec;/.test(litTo));
// Without this the template's gap-fill puts the default liturgy back in the
// section it just left.
check('the section it left is noted as cleared of it',
  /_lbdNoteCleared\(from\.sec, it\.sourceId\)/.test(litTo));
check('...and the section it joins is un-cleared',
  /_lbdClearClearedFor\(toSec\)/.test(litTo));
check('both sections\' backgrounds are re-pinned, with one write',
  /_lcdRestoreSectionBgs\(from\.sec, bgsFrom, \{ noSave: true \}\)/.test(litTo) &&
  /_lcdRestoreSectionBgs\(toSec, bgsTo\)/.test(litTo));

check('a section heading takes an item dropped on it',
  /if \(_lcdDragItem\) \{[^]{0,400}_lcdItemToSection\(moving, targetSectionId\)/.test(SRC));
check('...and shows a marker while it is hovered',
  /if \(_lcdDragItem\) \{[^]{0,400}hdr\.classList\.add\('lcd-rail-drop-below'\)/.test(SRC));

// ---------------------------------------------------------------------------
section('8. The handles look like handles');

const cursorAt = SRC.indexOf('.lcd-rail-item-group[draggable="true"] { cursor: grab; }');
check('the item heading shows a grab cursor', cursorAt > 0);
check('the part badge does too',
  has(/\.lcd-rail-part\[draggable="true"\] \{ cursor: grab; \}/));
if (cursorAt > 0) {
  // A rule that lands inside an @media block styles nothing on a desk, and
  // the assert that found "exactly one match" would still have passed.
  const head = SRC.slice(0, cursorAt);
  const m = head.lastIndexOf('@media');
  const depth = m < 0 ? 0 : (head.slice(m).split('{').length - head.slice(m).split('}').length);
  check('...at the top level of the sheet, not inside an @media block', depth === 0, 'depth ' + depth);
}

// ---------------------------------------------------------------------------
// 9. The three faults a real browser found, and nothing else would have.
// ---------------------------------------------------------------------------
section('9. What only driving it in a browser showed');

// (a) A reorder rebuilt each slide with content/richHtml/background and DROPPED
// its header, so every part heading in the song vanished from the model. The
// rail went on showing them because it reads the DOM, and so does
// collectOrderItems -- invisible until the part drag asked the model which runs
// a song has and was told "none", and so left the words alone.
const reSlides = fn('_lcdReorderSongSlides');
check('_lcdReorderSongSlides is in the source', !!reSlides);
check('a reordered slide keeps its header',
  /header: _h \|\| s\.header \|\| ''/.test(reSlides), reSlides);
check('...read from the box, the one element every path writes a heading to',
  /_lcdOwnHeader\(box\)/.test(reSlides), reSlides);

// (b) Moving the run's boxes AND the words applied the move TWICE: the words
// change runs _sbSetCopyWords -> _sbSlidesFollow -> refreshSongSlidesInOrder,
// which re-splits the slides from the new words. Measured on a 7-part song: it
// came out with 9 parts, two of them doubled.
const drop2 = fn('_lcdRunDrop');
// indexOf returns -1 when the call is GONE, and -1 is less than any real
// index -- so an ordering test alone passes on source that never calls it.
// The mutation run caught exactly that here. Require both, then order them.
const iWords = drop2.indexOf('_lcdMoveSongWords(songId, iFrom, dest)');
const iMove = drop2.indexOf('insertAdjacentElement');
check('the words are actually asked to move', iWords > 0, drop2.slice(-900));
check('...and the boxes are actually moved when they could not', iMove > 0);
check('the boxes move ONLY when the words could not (one reorder, not two)',
  /if \(wordsMoved !== 'ok'\) \{/.test(drop2) && iWords > 0 && iMove > 0, drop2.slice(-900));
check('...so the words are asked before anything is moved',
  iWords > 0 && iMove > 0 && iWords < iMove);

// (c) refreshSongSlidesInOrder keeps each slide's old header BY POSITION where
// the new parse gives none -- right for a heading the operator typed, wrong
// once the words have moved, because the old order's headings survive onto the
// new one.
const words2 = fn('_lcdMoveSongWords');
check('the stale positional headers are cleared before the re-split',
  /\[song\.savedSlides, song\.slides\]\.forEach/.test(words2), words2.slice(-700));
check('...only after the count check has made that safe',
  words2.indexOf("return 'mismatch'") < words2.indexOf('song.savedSlides, song.slides'));
check('refreshSongSlidesInOrder still keeps a typed heading otherwise',
  has(/header: slide\.header \|\| was\.header \|\| ''/));

// (d) A liturgy is known by TWO ids: the DOM carries the SOURCE id, allItems
// carries "<order>__liturgy_<source>_<section>". Matching one against the other
// found nothing, so a reorder moved the boxes and wrote nothing to the model --
// the rail looked right and the Builder showed the old order.
const litItem = fn('_lcdLitItem');
check('_lcdLitItem resolves a liturgy by its SOURCE id and section', !!litItem &&
  /x\.sourceId === sourceId && x\.sectionId === sectionId/.test(litItem), litItem);
const itemOrder2 = fn('_lcdWriteItemOrder');
check('the within-section write matches by source id, not by item id',
  /it\.sourceId === id/.test(itemOrder2), itemOrder2);
const litTo2 = fn('_lcdLiturgyToSection');
check('the cross-section move resolves through it too',
  /var it = _lcdLitItem\(from\.id, from\.sec\);/.test(litTo2), litTo2.slice(0, 300));
// Rewriting data-liturgy-id to the model's id would make every later lookup miss.
check('the DOM keeps the source id; only data-section moves',
  !/nd\.setAttribute\('data-liturgy-id'/.test(litTo2) &&
  /nd\.setAttribute\('data-section', toSec\)/.test(litTo2), litTo2);
check('...and renumbering groups by the source id the DOM carries',
  /renumberSlideBoxes\(toSec, it\.sourceId, 'liturgy'\)/.test(litTo2));

// ---------------------------------------------------------------------------
// 10. The operator's second round (2026-11-27).
// ---------------------------------------------------------------------------
section('10. Latching on, keeping your place, and adding a section');

// (a) "make it that they don't have to reach all the way to the subsection
// header to recognise the request" -- anywhere inside a subsection latches on
// to it, and which SIDE is read from the subsection's whole block, so the
// answer does not change as the pointer crosses a row boundary.
check('the drop side is delegated to the rail, not bound per heading',
  has(/rail\.addEventListener\('dragover', _lcdItemRailOver\)/) &&
  has(/rail\.addEventListener\('drop', _lcdItemRailDrop\)/));
check('...and bound once, since the rail outlives a render',
  has(/if \(rail\.__lcdItemDrop\) return;/));
const atEl = fn('_lcdItemAtEl');
check('a heading, a part badge or ANY slide row resolves to its subsection',
  /closest\('\.lcd-rail-item-group\[data-item-id\]'\)/.test(atEl) &&
  /closest\('\.lcd-rail-part\[data-run-item\]'\)/.test(atEl) &&
  /closest\('\.lcd-rail-slide-row'\)/.test(atEl), atEl);
const forBox = fn('_lcdItemForBox');
check('a reading is still no drop target (its place is the template slot)',
  /data-source'\) === 'scripture'\) return null/.test(forBox), forBox);
const blockRows = fn('_lcdItemBlockRows');
check('the block is the heading and everything under it to the next heading',
  /lcd-rail-item-group/.test(blockRows) && /lcd-rail-section-header/.test(blockRows) &&
  /nextElementSibling/.test(blockRows), blockRows);
const over = fn('_lcdItemRailOver');
// (a2) Which side it lands on is the DIRECTION of the drag, not which half
// of the target the pointer is in. Half-of-the-target made the operator aim
// at an invisible midline that, in a tall subsection, sits down among the
// slides with nothing marking it. _woDropInSeq has used direction for the
// songbook drag all along; the two now agree.
check('the side comes from the two positions, not from the pointer',
  /_lcdItemSide\(_lcdItemRailAt\(_lcdDragItem\), _lcdItemRailAt\(to\)\)/.test(over), over);
check('...and no pointer coordinate decides it any more',
  !/_lcdItemSide\(e\.clientY/.test(over), over);
// The marker is a LINE at a boundary, never a class on a slide row.
check('the marker is an insertion line at the boundary',
  /_lcdInsLineAt\(_lcdItemDropBelow \? bottom : top\)/.test(over), over);
check('...and no row is given a drop class by the subsection drag',
  !/classList\.add\('lcd-rail-drop/.test(over), over);
if (P && P._lcdItemSide) {
  check('dragged DOWN the list, it lands after its target', P._lcdItemSide(0, 2) === true);
  check('dragged UP the list, it lands before its target', P._lcdItemSide(2, 0) === false);
  check('onto itself, nothing moves', P._lcdItemSide(1, 1) === false);
  check('an unknown position never guesses after', P._lcdItemSide(-1, 2) === false);
}

// (b) "I want the focus to remain at the sections that I have changed
// positions. Where I dragged and dropped." _lcdRailHoldScroll pins the scroll
// where it WAS, which is a different thing: the moved section is elsewhere now.
const focus = fn('_lcdRailFocusOn');
check('_lcdRailFocusOn is in the source', !!focus);
check('it brings the moved row into the middle and holds it',
  /scrollIntoView\(\{ block: 'center' \}\)/.test(focus) && /sc\.scrollTop/.test(focus), focus);
// Without this the watcher reveals the PROJECTING slide instead.
check('...against _lcdWatchSelectedRow, which would reveal the live slide',
  /_lcdSkipRevealUntil = Date\.now\(\) \+ 2000;/.test(focus));
check('it retries, because the render is not always synchronous',
  /tries\+\+ < 20/.test(focus));
// A save refreshes the rail ~120ms later and REPLACES the nodes, so a held
// reference goes stale: each tick finds the row again.
// Scoped to the PIN TICK. `try { now = find(); } catch` appears twice in
// this function -- the tick and the cleanup -- so an unscoped match stayed
// true with it deleted from the tick (gotcha 82). The mutation run caught it.
const pinTick = (function () {
  const a = focus.indexOf('].forEach(function(ms) {');
  if (a < 0) return '';
  const b = focus.indexOf('}, ms);', a);
  return b < 0 ? focus.slice(a) : focus.slice(a, b);
})();
check('the pin tick exists to check', pinTick.length > 0, focus.slice(0, 300));
check('each tick finds the row again rather than holding a reference',
  pinTick.indexOf('find()') > 0 && pinTick.indexOf('var now = el') < 0, pinTick);
check('the renderer re-applies the mark, because it is what replaced the node',
  has(/if \(_lcdJustMoved && Date\.now\(\) < _lcdJustMoved\.until\) \{/));
['lcdSectionDrop', '_lcdItemReorder', '_lcdSongToSection', '_lcdLiturgyToSection', '_lcdRunDrop']
  .forEach(function(name) {
    const body = fn(name);
    check(name + ' ends on what it moved, not where the rail was',
      /_lcdRailFocusOn\(/.test(body) && !/_lcdRailHoldScroll\(\)/.test(body), body.slice(-300));
  });
check('a single slide reorder keeps its place too',
  /_lcdRailFocusOn\(function\(\) \{/.test(fn('lcdRailDrop')));

// (c) "Adding a section should also add it in the liturgy builder and should
// have the consistent form and presentation just like normal."
const addSec = fn('addNewSection');
check('Add New Section offers the Builder\'s own list of kinds',
  /_LBD_SEC_KINDS\.map/.test(addSec) && /_lbdOpenMenu\(at, 'Add a section'/.test(addSec), addSec);
const make = fn('_lcdMakeSection');
check('_lcdMakeSection is in the source', !!make);
// It already reached the Builder in-session (both write sectionLayout). What
// it did not do was SAVE, so a section added and then reloaded was gone.
check('the new section is written into the layout the Builder reads',
  /_captureCurrentLayout\(\)/.test(make), make);
check('...and SAVED, or it was gone on the next load',
  /autoSaveOrder\(\)/.test(make), make);
check('...and the rail is drawn again and brought to it',
  /_lcdRenderCompactRail\(\)/.test(make) && /_lcdRailFocusOn\(_lcdFindSectionRow\(sectionId\)\)/.test(make));
// lbdAddSection goes through _lbdChange, which must not run with the schedule
// in the page (gotcha 35), so the LCD cannot simply call it.
check('it does NOT call the Builder\'s own adder, which needs _lbdChange',
  !/lbdAddSection\(/.test(make), make);
check('both Add New Section buttons hand the menu something to hang off',
  (SRC.match(/WO\.addNewSection\(this\)/g) || []).length === 2);

// ---------------------------------------------------------------------------
// 11. The operator's third round (2026-11-27): "it still give the option to
// latch on to any of the slides within".
// ---------------------------------------------------------------------------
section('11. One line at the boundary, and nothing else lights up');

// THE CAUSE, and it was not the marker. _lcdSetupMediaDropZone stands down
// while a rail reorder is in flight, but its guard NAMED the three drags that
// existed when it was written. The subsection and part drags added later went
// straight past it, so it painted its own dashed .lcd-drop-target on every
// slide row the pointer crossed -- which is exactly "the option to latch on
// to any of the slides".
const dragging = fn('_lcdRailDragging');
check('_lcdRailDragging names every rail drag, not three of them', !!dragging &&
  ['_lcdDragRowId', '_lcdDragSectionId', '_lcdDragSongId', '_lcdDragItem', '_lcdDragRunId']
    .every(v => dragging.indexOf(v) > 0), dragging);
check('the media drop zone asks it rather than listing them again',
  (SRC.match(/if \(_lcdRailDragging\(\)\) return;/g) || []).length === 2);
// The list of drags appears ONCE, inside the predicate itself. Forbidding
// the sequence outright would fail on that definition, so count instead.
check('...and the list of drags is written in exactly one place',
  (SRC.match(/_lcdDragRowId \|\| _lcdDragSectionId \|\| _lcdDragSongId/g) || []).length === 1 &&
  dragging.indexOf('_lcdDragRowId || _lcdDragSectionId || _lcdDragSongId') > 0, dragging);

// THE MARKER. A reorder puts the subsection between two others, so what it
// shows is a line at that boundary -- never a box on a slide, which read as
// "drop it on me".
const line = fn('_lcdInsLineAt');
check('_lcdInsLineAt is in the source', !!line);
// On <body> and fixed, so no ancestor of the rail can clip it or become its
// containing block.
check('the line is on <body>, so nothing can clip it',
  /document\.body\.appendChild\(el\)/.test(line), line);
check('...and spans the rail, wherever the rail is',
  /rail\.getBoundingClientRect\(\)/.test(line) && /el\.style\.width = r\.width/.test(line), line);
check('it is fixed and above the rail',
  has(/\.lcd-rail-ins-line \{[^}]*position: fixed/) &&
  has(/\.lcd-rail-ins-line \{[^}]*z-index: 4000/));
check('...and takes no pointer events, or it would eat its own dragover',
  has(/\.lcd-rail-ins-line \{[^}]*pointer-events: none/));
check('the drag ending puts it away', /_lcdInsLineOff\(\);/.test(fn('_lcdItemDragEnd')));
// Belt and braces: every path that clears the markers clears the line too, so
// none can strand it across the screen.
check('...and so does any marker clear, so it cannot be stranded',
  /if \(!_lcdDragItem\) _lcdInsLineOff\(\);/.test(fn('_lcdClearDropMarkers')));

const at = fn('_lcdItemRailAt');
check('_lcdItemRailAt reads a subsection\'s place from the rail', !!at &&
  /data-item-sec="/.test(at) && /data-item-id/.test(at), at);
// `return -1;` appears TWICE in that function -- the early bail and the
// tail -- so an unscoped match stayed true with the tail changed to 0.
check('...and answers -1 rather than 0 when it is not there',
  /\}\s*return -1;\s*\}\s*$/.test(at.trim() + ' '), at.slice(-160));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
