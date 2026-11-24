'use strict';
// Harness for the LCD Projection console after the Slide Editor became a
// window (2026-11-15). Replaces tools/lcd-editor-rollup-harness.js, whose
// whole subject -- the editor panel rolling up to its title bar inside the
// outputs row -- no longer exists.
//
// WHY THIS EXISTS
// From the operator, on a marked-up screenshot of the console:
//   1. the Media Tray 5px taller and a brighter white, so it shows its
//      thumbnails better;
//   2. the Slide Editor panel gone from the outputs row and opened instead
//      as a popup, by a double-click or double-tap on a slide or on the
//      projection, with the freed space divided between the Service
//      Schedule and the projection;
//   3. Barrier moved next to the Songbook button;
//   4. All Slides on every section heading AND on every song's or liturgy
//      item's heading.
//
// What is RUN rather than matched:
//   - _lcdBandSplit, the arithmetic that divides the vertical band between
//     the projection and the tray. It is the piece that silently went wrong
//     twice while this was built: first the projection took the whole column
//     and pushed the tray 203px below the fold, then the tray was clamped to
//     the stylesheet's min-height and showed 0 of its 8 thumbnails.
//   - the window's open/shut state machine, including the backdrop rule that
//     tells "a click away" from "a drag that started inside".
//
// Source checks here match STATEMENTS, never a word a comment might also use
// (CLAUDE.md gotcha 82).
//
// USAGE
//   node tools/lcd-editor-popup-harness.js                 # ../Index.html
//   node tools/lcd-editor-popup-harness.js path/to/file.html
//   node tools/lcd-editor-popup-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show origin/master:Index.html > x`).
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
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}

// ---------------------------------------------------------------------------
// 1. The band: the projection and the Media Tray share one vertical slice
// ---------------------------------------------------------------------------
console.log('How the projection and the Media Tray divide the band');

const splitSrc = fn('_lcdBandSplit');
if (splitSrc) {
  const FLOOR = SRC.match(/var LCD_TRAY_FLOOR = (\d+);/);
  const MINH = SRC.match(/var LCD_MIN_SCREEN_H = (\d+);/);
  const OUTMIN = SRC.match(/var LCD_OUTPUTS_MIN = (\d+);/);
  check('the three figures are named constants, not numbers in the arithmetic',
    !!(FLOOR && MINH && OUTMIN), [FLOOR, MINH, OUTMIN].join(' '));

  const split = new Function(
    'var LCD_TRAY_FLOOR = ' + (FLOOR ? FLOOR[1] : 0) + ';' +
    'var LCD_MIN_SCREEN_H = ' + (MINH ? MINH[1] : 0) + ';' +
    'var LCD_OUTPUTS_MIN = ' + (OUTMIN ? OUTMIN[1] : 0) + ';' +
    splitSrc + '\nreturn _lcdBandSplit;')();

  // The measured case this was built against: a 1536x695 window, the Song
  // Library shut. 474px of band, the projection box spending 146px on its
  // controls / label / nav / status, and a 16:9 screen that WANTS 426px
  // because the column it now has to itself is 757px wide.
  const tight = split(474, 237, 146, 426);
  check('a 16:9 screen too tall for the band is capped, not allowed to push the tray off',
    tight.capped === true && tight.screen === Number(MINH[1]), JSON.stringify(tight));
  check('...and the tray still gets a band of its own',
    tight.tray >= 145 && tight.tray <= Math.round(474 * 0.42), JSON.stringify(tight));
  // The rule the 2026-11-22 round turned around: the tray is served FIRST.
  // Reserving only its floor let the projection grow into the rest and put
  // the tray 180px below the fold.
  check('...which is reserved BEFORE the projection, not left over after it',
    tight.tray === Math.min(237, Math.max(145, Math.round(474 * 0.42))) &&
    tight.screen === Math.max(Number(MINH[1]), (474 - tight.tray) - 146),
    JSON.stringify(tight));
  check('...which is enough for its chrome AND a row of tiles (measured: 122px + 58px)',
    tight.tray >= 180, 'tray=' + tight.tray);
  check('...and the row is the box: its chrome plus the capped screen',
    tight.rowH === 146 + Number(MINH[1]) + 10, JSON.stringify(tight));
  // Where the band DOES stretch to both, they fit inside it -- which is what
  // puts the tray and its first row of tiles above the fold.
  const fits = split(820, 237, 146, 426);
  check('on a band that can hold both, the row and the tray fit inside it',
    fits.tray + fits.rowH <= 820 + 10, JSON.stringify(fits));
  // Measured on a band big enough that LCD_MIN_SCREEN_H does not bind, so
  // the arithmetic is visible: serving the tray first gives the projection
  // the band LESS THE TRAY'S OWN SHARE (437 here), where serving it last
  // gave it the band less the tray's FLOOR (529) and pushed the tray off.
  const big = split(820, 237, 146, 900);
  check('the projection gets the band less the tray\'s whole share, not less its floor',
    big.capped === true && big.screen === (820 - big.tray) - 146,
    JSON.stringify(big) + ' expected screen ' + ((820 - big.tray) - 146));

  // A tall screen -- Full Screen, or any 1080p window. Nothing binds and the
  // projection takes the whole column, which is where the freed width pays.
  const roomy = split(820, 237, 146, 426);
  check('on a tall screen the cap does not bind and the projection keeps its natural size',
    roomy.capped === false && roomy.screen === 426, JSON.stringify(roomy));

  // A screen SMALLER than the floor must not be inflated to it.
  const small = split(820, 237, 146, 180);
  check('a screen already smaller than the floor is left alone, never stretched up to it',
    small.capped === false && small.screen === 180, JSON.stringify(small));

  // The floor under the projection holds even when the band cannot pay for it:
  // past that point the console scrolls, which is what it did before anyway.
  const cramped = split(300, 237, 146, 426);
  check('the projection never falls below its floor, however short the band',
    cramped.screen === Number(MINH[1]), JSON.stringify(cramped));

  // A tray that wants little gets little -- the floor is a ceiling on the
  // guarantee, not a minimum size forced on an empty tray.
  const emptyTray = split(620, 40, 146, 426);
  const fullTray = split(620, 237, 146, 426);
  check('a nearly-empty tray is not padded out to the floor', emptyTray.tray === 40, JSON.stringify(emptyTray));
  check('...and the projection gets the room the tray did not want',
    emptyTray.screen > fullTray.screen, 'empty=' + emptyTray.screen + ' full=' + fullTray.screen);
} else {
  check('the band arithmetic is a pure function of its own (_lcdBandSplit)', false);
}

console.log('\nThe +5px the operator asked for is in every rule that caps the row');
// Four rules decide how tall the Media Tray may be, and the SMALLEST wins.
// Move one and nothing changes on screen, which is the whole failure mode:
// the change lands in the script and the stylesheet quietly overrides it.
// So these are checked by their exact values, each 5 more than it was.
const floorVal = (SRC.match(/var LCD_TRAY_FLOOR = (\d+);/) || [])[1];
check('the base floor is 145, up from 140',
  has(/\.lcd-lower-row \{ display: flex; gap: var\(--lcd-space-4\); margin-top: var\(--lcd-space-3\); min-height: 145px; \}/));
check('the stacked band below 1201px is 137, up from 132',
  has(/\.lcd-lower-row \{ flex: 0 0 auto; min-height: 137px; margin-top: 6px; \}/));
check('full screen allows 215, up from 210 -- on the row and on the panel inside it',
  has(/body\.lcd-workspace-fullscreen \.lcd-lower-row \{ flex: 0 0 auto; max-height: 215px; \}/) &&
  has(/body\.lcd-workspace-fullscreen \.lcd-media-panel \{ max-height: 215px; overflow-y: auto; \}/));
check('...and the script guarantees at least the base floor, so the stylesheet never decides it',
  !!floorVal && Number(floorVal) >= 145, 'LCD_TRAY_FLOOR=' + floorVal);

console.log('\nThe Media Tray reads as paper, not parchment');
check('the panel and its body are white, so a thumbnail is not tinted by what is behind it',
  has(/\.lcd-media-panel \{\r?\n\s*background: #ffffff;/) &&
  has(/\.lcd-media-panel \.lcd-panel-body \{ background: #ffffff; \}/));
check('...and its header band is lightened to match',
  has(/\.lcd-media-panel \.lcd-panel-header \{\r?\n\s*background: linear-gradient\(180deg, #ffffff, #f6f2e9\);/));

// ---------------------------------------------------------------------------
// 2. The Slide Editor is a window
// ---------------------------------------------------------------------------
console.log('\nThe Slide Editor left the outputs row');
check('the panel lives inside the popup, not in the row',
  has(/<div class="lcd-editor-pop" id="lcdEditorPop"/) &&
  /<div class="lcd-editor-pop__win"[^>]*>\r?\n\s*<div class="lcd-panel lcd-lyrics-panel">/.test(SRC),
  'panel is not inside .lcd-editor-pop__win');
check('...so the projection has the whole row at every width that used to split it',
  has(/\.lcd-outputs-row \.lcd-program-box \{ flex: 1 1 100%; min-width: 280px; \}/) &&
  !has(/\.lcd-outputs-row[^{]*\.lcd-lyrics-panel \{ flex: 1 1 (?:50|60|42)%/) &&
  !has(/\.lcd-outputs-row > \.lcd-lyrics-panel \{\r?\n\s*flex: 1 1 42%;/));
check('the roll-up went with the column it was invented for',
  !has(/_lcdApplyEditorRoll/) && !has(/lcd-editor-rolled/) && !has(/@keyframes lcdEditorUnroll/));
check('the LCD palette is defined on the window too -- these are SCOPED custom properties',
  /\.wo-main-content:not\(\.wo-song-order\),\r?\n  \.lcd-editor-pop \{\r?\n\s*--lcd-ivory:/.test(SRC),
  'without this the panel renders with a transparent header and body');
check('...and the window carries a surface of its own, not just the panel\'s',
  has(/\.lcd-editor-pop__win \{[^}]*background: var\(--lcd-ivory, #f7f3ea\);/));
check('the phone rule that hid the editor stops at the window\'s edge',
  has(/#worshipOrderView\.lcd-mode \.lcd-outputs-row \.lcd-lyrics-panel \{ display: none !important; \}/) &&
  !has(/#worshipOrderView\.lcd-mode \.lcd-lyrics-panel \{ display: none !important; \}/));

console.log('\nOpening and shutting it');
const openSrc = fn('_lcdOpenEditorPop');
const closeSrc = fn('lcdCloseEditorPop');
const downSrc = fn('lcdEditorPopDown');
const bdSrc = fn('lcdEditorPopBackdrop');
const applySrc = fn('lcdPopApply');
if (openSrc && closeSrc && downSrc && bdSrc && applySrc) {
  const make = (applyResult) => {
    const S = { asked: null, guard: true, applyResult: applyResult, locked: 0 };
    const pop = { id: 'lcdEditorPop', style: { display: 'none' } };
    const bodyCls = new Set();
    const doc = {
      getElementById: id => (id === 'lcdEditorPop' ? pop : null),
      body: { classList: { add: c => bodyCls.add(c), remove: c => bodyCls.delete(c), contains: c => bodyCls.has(c) } },
    };
    const api = new Function('document', 'S', [
      'var _lcdEditorUnlocked = true, _lcdPopOn = false, _lcdPopDownOnBd = false;',
      'function _lcdDraftGuard(then) { if (S.guard) return true; S.asked = then; return false; }',
      'function _lcdApplyEditorLock() { S.locked++; }',
      'function _lcdApplySlideEdit() { return S.applyResult; }',
      openSrc, closeSrc, downSrc, bdSrc, applySrc,
      'return { open: _lcdOpenEditorPop, close: lcdCloseEditorPop, down: lcdEditorPopDown,',
      '  backdrop: lcdEditorPopBackdrop, apply: lcdPopApply, shown: function(){ return document.getElementById("lcdEditorPop").style.display; } };',
    ].join('\n'))(doc, S);
    return { api, S, bodyCls };
  };

  let t = make(true);
  t.api.open();
  check('opening it shows the window and marks the body', t.api.shown() === 'flex' && t.bodyCls.has('lcd-editor-pop-on'));
  t.api.close();
  check('...and shutting it hides the window and clears the mark', t.api.shown() === 'none' && !t.bodyCls.has('lcd-editor-pop-on'));

  // Held words: every ordinary way out asks first and shuts nothing yet.
  t = make(true); t.api.open(); t.S.guard = false;
  t.api.close();
  check('with words held, Esc / the X / the backdrop ask first and the window stays',
    t.api.shown() === 'flex' && typeof t.S.asked === 'function');
  t.S.asked();                                  // the operator answers Save or Discard
  check('...and it shuts once the question is answered', t.api.shown() === 'none');

  // force bypasses the question: only internal callers use it.
  t = make(true); t.api.open(); t.S.guard = false;
  t.api.close(true);
  check('a forced close never asks -- that is the path a non-editable slide takes',
    t.api.shown() === 'none' && t.S.asked === null);

  // The backdrop rule.
  t = make(true); t.api.open();
  t.api.down({ target: { id: 'lcdEditorPop' } });
  t.api.backdrop({ target: { id: 'lcdEditorPop' } });
  check('a press AND release on the backdrop is a click away: it shuts', t.api.shown() === 'none');

  t = make(true); t.api.open();
  t.api.down({ target: { id: 'lcd-editor-pop__win' } });        // started inside
  t.api.backdrop({ target: { id: 'lcdEditorPop' } });            // released outside
  check('...but a drag that STARTED inside does not -- selecting a long line must not shut it',
    t.api.shown() === 'flex');

  t = make(true); t.api.open();
  t.api.down({ target: { id: 'lcdEditorPop' } });
  t.api.backdrop({ target: { id: 'somethingElse' } });           // released on the window
  check('...nor a press on the backdrop released inside the window', t.api.shown() === 'flex');

  // Apply is the window's "done".
  t = make(true); t.api.open(); t.api.apply();
  check('Apply saves and shuts', t.api.shown() === 'none');
  t = make(false); t.api.open(); t.api.apply();
  check('...and a refused save (another device holds the slide) leaves it open with the words in it',
    t.api.shown() === 'flex');
} else {
  check('the window has open / close / backdrop / apply of its own', false,
    [openSrc, closeSrc, downSrc, bdSrc, applySrc].map(s => s.length).join(','));
}

console.log('\nThe ways in');
const bindSrc = fn('_lcdBindEditorOpeners');
check('a double-click on a slide in the rail, or on the projection, opens it',
  /if \(t\.closest\('#lcdCompactRail \.lcd-rail-slide-row'\) \|\| t\.closest\('#lcdProgramOutput'\)\) \{\r?\n\s*lcdUnlockEditor\(\);/.test(bindSrc));
check('...and so do two TAPS on the same two, which a touch screen needs (gotcha 28)',
  /document\.addEventListener\('touchend'/.test(bindSrc) &&
  /now - _tapAt < 350 && Math\.abs\(p\.clientX - _tapX\) < 32/.test(bindSrc) &&
  /_tapAt = 0;\r?\n\s*lcdUnlockEditor\(\);/.test(bindSrc));
check('Esc shuts it, but never while the question owns Esc',
  /if \(e\.key !== 'Escape' \|\| !_lcdPopOn\) return;\r?\n\s*if \(document\.getElementById\('lcdDraftAsk'\)\) return;/.test(bindSrc));
const unlockSrc = fn('lcdUnlockEditor');
check('opening the pad opens the window, and refuses on a slide with no text to edit',
  /if \(!_lcdEditorAvailable\) \{ showToast\('This slide has no text to edit', 'warning'\); return; \}/.test(unlockSrc) &&
  /_lcdOpenEditorPop\(\);/.test(unlockSrc));
check('a slide the editor cannot work on shuts a window already open over it',
  /_lcdEditorAvailable = !!on;\r?\n\s*if \(!_lcdEditorAvailable\) lcdCloseEditorPop\(true\);/.test(fn('_lcdSetEditorVisible')));
check('Apply in the window goes through lcdPopApply, so it shuts when it saves',
  has(/onclick="WO\.lcdPopApply\(\)" title="Apply your changes to this slide and close the editor"/));
check('...and the window has a close of its own',
  has(/<button class="lcd-mini-btn lcd-pop-close" onclick="WO\.lcdCloseEditorPop\(\)"/));

// ---------------------------------------------------------------------------
// 3. Barrier beside Songbook
// ---------------------------------------------------------------------------
console.log('\nBarrier, beside Songbook');
check('it is in the console\'s own controls row, right after Songbook',
  /<button class="wo-bg-btn" id="lcdProjVerBtn"[^]*?<button class="wo-barrier-btn" id="woBarrierBtn"/.test(SRC) &&
  !/<span class="lcd-fmt-group">[^]*?id="woBarrierBtn"/.test(SRC),
  'Barrier must not be left in the Slide Editor ribbon');
check('...keeping its id and handler, so the Barrier dialog is reached exactly as before',
  has(/id="woBarrierBtn" onclick="WO\.openBarrierEditor\(\)"/));

// ---------------------------------------------------------------------------
// 4. All Slides on the headings
// ---------------------------------------------------------------------------
console.log('\nAll Slides, named from the heading it belongs to');
const railSrc = fn('_lcdRenderCompactRail');
check('every section heading carries one',
  /var addBtns = '<button class="lcd-rail-allslides" onclick="event\.stopPropagation\(\); WO\.lcdSectionAllSlides\(/.test(railSrc));
check('...and so does every song\'s and liturgy item\'s heading',
  /WO\.lcdItemAllSlides\(/.test(fn('_lcdBuildItemGroupRow')) &&
  /_lcdBuildItemGroupRow\('song', groupTitle, _songBoxes\.length, songId, sectionId\)/.test(railSrc) &&
  /_lcdBuildItemGroupRow\('liturgy', litTitle, _litBoxes\.length, liturgyId, sectionId\)/.test(railSrc));
check('ids in those inline handlers go through escapeJsArg (gotcha 47)',
  /WO\.lcdSectionAllSlides\(\\'' \+ escapeJsArg\(sectionId\)/.test(railSrc) &&
  /escapeJsArg\(kind\)[^]*?escapeJsArg\(groupId\)[^]*?escapeJsArg\(sectionId\)/.test(fn('_lcdBuildItemGroupRow')));
check('both ask before they redraw, so held words are never lost to them',
  /if \(!_lcdDraftGuard\(function\(\) \{ lcdSectionAllSlides\(sectionId\); \}\)\) return;/.test(fn('lcdSectionAllSlides')) &&
  /if \(!_lcdDraftGuard\(function\(\) \{ lcdItemAllSlides\(kind, groupId, sectionId\); \}\)\) return;/.test(fn('lcdItemAllSlides')));
check('the ITEM button opens that item, which is the only way to reach the second one in a section',
  /openAllSlidesModal\(kind, groupId, sectionId\);/.test(fn('lcdItemAllSlides')));
check('neither is hover-only: a hover control cannot be pressed on a touch screen',
  has(/\.lcd-rail-allslides \{/) &&
  !has(/\.lcd-rail-section-header:hover \.lcd-rail-allslides|\.lcd-rail-allslides \{[^}]*opacity:\s*0\s*[;}]/));
check('...and both are exported for their inline handlers',
  has(/lcdSectionAllSlides: lcdSectionAllSlides,/) && has(/lcdItemAllSlides: lcdItemAllSlides,/));

// ---------------------------------------------------------------------------
// 5. The freed width
// ---------------------------------------------------------------------------
console.log('\nThe freed column, divided');
// Fixed mode is the default AND the last word in the column block, so its
// rule is the one to read -- matched by its own selector, not by shape: the
// responsive bands above it use the same shape and the first match was one
// of those.
const fixedTracks = SRC.match(
  /body\.lcd-fixed-layout \.wo-main-content:not\(\.wo-song-order\) \{\r?\n\s*display: grid;\r?\n\s*grid-template-columns: minmax\(\d+px, ([\d.]+)fr\) minmax\(\d+px, ([\d.]+)fr\) minmax\(\d+px, ([\d.]+)fr\);/);
check('the Service Schedule\'s track grew with the Slide Editor gone',
  !!fixedTracks && Number(fixedTracks[2]) >= 38, fixedTracks && fixedTracks[0]);
check('...and the projection keeps the larger share of the two it is divided between',
  !!fixedTracks && Number(fixedTracks[3]) > Number(fixedTracks[2]), fixedTracks && fixedTracks[0]);
// Every responsive band moved with it, or the console splits the freed
// column in one layout mode and not the other.
const otherBands = (SRC.match(/grid-template-columns: (?:44px|minmax\([^)]*\)) minmax\([^)]*, ([\d.]+)fr\) minmax\([^)]*, ([\d.]+)fr\);/g) || [])
  .map(s => s.match(/([\d.]+)fr\) minmax\([^)]*, ([\d.]+)fr\);$/)).filter(Boolean)
  .map(m => [Number(m[1]), Number(m[2])]);
check('...in every width band, not only in Fixed mode',
  otherBands.length >= 4 && otherBands.every(([sched, proj]) => sched / (sched + proj) >= 0.33),
  JSON.stringify(otherBands));
check('the projection screen is centred when the band caps its width',
  has(/margin-left: auto; margin-right: auto;/) &&
  /\.lcd-program-box \.lcd-program-screen \{[^}]*margin-left: auto; margin-right: auto;/.test(SRC.replace(/\r?\n/g, ' ')));

console.log('\nThe Song Library tab in Fixed layout (carried over from the roll-up harness)');
check('the "show the library" tab shows only while the library is shut',
  has(/body\.lcd-fixed-layout \.wo-main-content:not\(\.wo-song-order\)\.lcd-library-hidden #lcdLibReopen \{ display: flex; \}/) &&
  has(/body\.lcd-fixed-layout \.wo-main-content:not\(\.wo-song-order\):not\(\.lcd-library-hidden\) #lcdLibReopen \{ display: none; \}/));
check('...never beside an open library, where it took the schedule\'s column',
  !has(/body\.lcd-fixed-layout \.wo-main-content:not\(\.wo-song-order\) #lcdLibReopen \{ display: flex; \}/));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
