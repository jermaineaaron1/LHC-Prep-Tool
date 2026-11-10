'use strict';
// Harness for: projected words WRAP to the next line, they never shrink to fit
// one.
//
// WHY THIS EXISTS
// From the operator (2026-11-10), on a screenshot of the full-screen presenter
// view: the projection should read like that view, and "if the words can't fit
// in the same line, then push it to the line below automatically, don't shrink
// the fonts just to fit the line".
//
// It was not a subtle effect. Measured in the real projection document at a
// true 1920x1080, with the default 5vw:
//
//   "L: Almighty God, to whom all hearts are open, ..."      38.4px
//   "C: Amen."                                               96px
//
// Two consecutive slides of the same prayer, two and a half times apart. The
// fit loop shrank the whole slide whenever ANY line was too wide.
//
// WHAT IT GUARDS
//
// 1. The width is no longer a reason to shrink. The loop tests the HEIGHT
//    alone. That test stays: .projection-content is `overflow: hidden` and a
//    wall has nothing to scroll, so a slide with more lines than the screen
//    can hold would otherwise lose its last lines in front of everybody.
//
// 2. .projection-text has `max-width: 100%`. This is the one that is easy to
//    lose and silent when lost: it is a flex item in a centred flex container,
//    so without a cap it sizes to MAX-CONTENT and `overflow-wrap` never gets a
//    line box to break against. Measured, after the shrink was removed and
//    before the cap was added: a 75-character word with no space in it came
//    out 3374px wide in a 1728px safe zone -- 823px clipped off the left and
//    the rest off the right, the word simply gone from the wall. The old
//    shrink-to-fit had been hiding that.
//
// 3. The presenter overlay follows the same rule, because it is the view the
//    operator reads from and the two must not disagree on exactly the long
//    line that prompted this. Its width goes to the element as a max-width,
//    which also keeps the words inside the safe zone -- `.wofs-inner`'s own
//    max-width is 90% of the overlay, which is a different boundary.
//
// USAGE
//   node tools/projection-text-wrap-harness.js                 # ../Index.html
//   node tools/projection-text-wrap-harness.js path/to/file.html
//   node tools/projection-text-wrap-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 4e90504:Index.html > x`).
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
// The projection window's fit loop, lifted out of the HTML it is written into
// and run for real.
// ---------------------------------------------------------------------------
// It lives inside a JS string concatenation, one quoted line per source line,
// so each line is unwrapped back into the JavaScript the projector runs.
function liftProjFn(name) {
  const start = SRC.indexOf("'function " + name + "() {' +");
  if (start < 0) return '';
  const lines = SRC.slice(start).split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t.startsWith("'")) break;
    const body = t.replace(/^'/, '').replace(/' \+$/, '').replace(/'$/, '');
    out.push(body);
    if (body === '}') break;
  }
  return out.join('\n');
}

// The projected base size, in vw. 6.5vw = 124.8px at 1920 -- the "125px"
// asked for on 2026-11-10. Declared once so the checks cannot drift from it.
const VW = 6.5;

console.log('The projected words wrap; they do not shrink to fit a line');

const projFitSrc = liftProjFn('_fitProjectionText');
check('the projection fit function is still there to lift',
  /function _fitProjectionText\(\) \{/.test(projFitSrc) && /\}$/.test(projFitSrc.trim()),
  projFitSrc.slice(0, 200));

if (projFitSrc) {
  // A stand-in for the projector: a text element whose height falls as the
  // font falls, and whose width NEVER fits -- the long-line case.
  function runFit(opts) {
    const state = { fontSize: '', shrinks: 0 };
    const textEl = {
      style: { set fontSize(v) { state.fontSize = v; state.shrinks++; }, get fontSize() { return state.fontSize; } },
      get scrollHeight() { return opts.heightAt(parseFloat(state.fontSize)); },
      get scrollWidth() { return opts.width; },
    };
    const doc = {
      querySelector: () => textEl,
      getElementById: () => ({ offsetHeight: opts.zoneH, offsetWidth: opts.zoneW }),
    };
    const win = { _textSettings: opts.settings || null, innerHeight: 1080, innerWidth: 1920 };
    const run = new Function('document', 'window', 'Math',
      projFitSrc + '\nreturn _fitProjectionText();');
    run(doc, win, Math);
    // first assignment is the base size, so a shrink count of 1 means "untouched"
    return { px: parseFloat(state.fontSize), steps: state.shrinks - 1 };
  }

  // One line far too wide for the zone, but only one line tall.
  const wide = runFit({ zoneH: 972, zoneW: 1728, width: 9999, heightAt: () => 150 });
  check('a line too wide for the screen is NOT shrunk -- it wraps instead',
    wide.px === VW && wide.steps === 0, JSON.stringify(wide));

  // Too tall at the base size; shrinks until it fits.
  const tall = runFit({ zoneH: 972, zoneW: 1728, width: 100, heightAt: f => f * 300 });
  check('a slide taller than the safe zone IS still shrunk, so no line is lost',
    tall.px < VW && tall.px * 300 <= 972, JSON.stringify(tall));

  // The floor holds even when nothing will ever fit.
  const huge = runFit({ zoneH: 100, zoneW: 1728, width: 100, heightAt: () => 99999 });
  check('...down to the 1.2vw floor and no further', huge.px === 1.2, JSON.stringify(huge));

  check('the width is not read at all any more',
    !/scrollWidth/.test(projFitSrc) && !/maxW/.test(projFitSrc), projFitSrc);
  check('...and the height still is', /scrollHeight > maxH/.test(projFitSrc), projFitSrc);
}

// ---------------------------------------------------------------------------
// The CSS that makes wrapping possible
// ---------------------------------------------------------------------------
console.log('\nThe cap that gives overflow-wrap something to break against');
const projCss = (SRC.match(/'\.projection-text \{[^']*\}' \+/) || [''])[0];
check('.projection-text is capped at the safe zone width',
  /max-width: 100%/.test(projCss), projCss);
check('...wraps at spaces, and breaks a word that has none',
  /white-space: pre-wrap/.test(projCss) && /overflow-wrap: break-word/.test(projCss), projCss);
check('...and reads at the presenter view\'s line spacing',
  /line-height: 1\.6/.test(projCss), projCss);
check('the base size still scales with the projector, and is still the operator\'s to set',
  new RegExp('font-size: ' + VW + 'vw').test(projCss) &&
  new RegExp('s\\.fontSize \\|\\| ' + VW + '\\) \\+ "vw;"').test(SRC), projCss);

// ---------------------------------------------------------------------------
// The presenter overlay, under the same rule
// ---------------------------------------------------------------------------
console.log('\nThe presenter view behaves the same, so the two never disagree');
const fsFit = fn('_fitFullscreenText');
check('the overlay hands the safe-zone width to the element as a max-width',
  /textEl\.style\.maxWidth = Math\.round\(maxW\) \+ 'px';/.test(fsFit), fsFit);
check('...and shrinks on height alone',
  /while \(textEl\.offsetHeight > maxH && fs > 0\.9\)/.test(fsFit) &&
  !/offsetWidth/.test(fsFit), fsFit);
check('.wofs-inner breaks a word with no space in it',
  has(/\.wofs-inner \{[^}]*overflow-wrap: break-word/));
check('the overlay keeps its 2·8rem base and Georgia, which the projection is matched to',
  has(/\.wo-fullscreen-overlay \{[^}]*font-family: Georgia, serif; font-size: 2\.8rem; line-height: 1\.6/) &&
  /var fs = 2\.8;/.test(fsFit));

// ---------------------------------------------------------------------------
// 125px on the projector (2026-11-10)
// ---------------------------------------------------------------------------
console.log('\nThe projected words are 125px on a 1080p projector');

// Said in vw rather than px, because the operator chose the day before to keep
// the projected size scaling with the screen. 6.5vw is both answers at once.
check('6.5vw is 125px at 1920 wide, within half a pixel',
  Math.abs(VW * 1920 / 100 - 125) <= 0.5, (VW * 1920 / 100) + 'px');
check('...and lands exactly on a stop of the existing 2-10vw slider',
  has(/id="woFontSize" min="2" max="10" step="0\.5" value="6\.5"/) &&
  (VW * 10) % 5 === 0);
check('the projection stylesheet starts there',
  has(/'\.projection-text \{ font-size: 6\.5vw;/));
check('...and so do both fallbacks inside the projection window',
  has(/'  var fs = s\.fontSize \|\| 6\.5;' \+/) &&
  has(/\(s\.fontSize \|\| 6\.5\) \+ "vw;"/));
check('...and the setting the dialog starts from, and resets to',
  (SRC.match(/fontSize: 6\.5,/g) || []).length === 2 &&
  has(/<span id="woFontSizeValue">6\.5<\/span>vw/));
check('no 5vw default is left behind anywhere',
  !has(/font-size: 5vw/) && !has(/fontSize \|\| 5\b/) && !has(/fontSize: 5,/));

// ---------------------------------------------------------------------------
// Nothing of the app's own on a screen the room can see
// ---------------------------------------------------------------------------
console.log('\nThe presenter view is bare when it is the live output');

// The operator projects through the Project button's own window, which carries
// none of this -- but goFullscreen falls back to this overlay when that window
// cannot be opened, and then the operator's view IS what the room sees.
// Verified in the browser by applying this rule's declarations: every one of
// them goes to display:none, over .wofs-filmstrip's own display:flex and the
// hover rules, and the cursor goes with them.
const fsRule = (SRC.match(/\.wo-fullscreen-overlay:fullscreen \.wofs-nav-btn,[^}]*\}/) || [''])[0];
['wofs-nav-btn', 'wofs-filmstrip', 'wofs-filmstrip-trigger', 'wo-close-fullscreen'].forEach(c => {
  check('  .' + c + ' goes when the view is full screen',
    new RegExp(':fullscreen \\.' + c + '[,\\s]').test(fsRule), fsRule.slice(0, 200));
});
check('...with !important, since .wofs-filmstrip sets display:flex of its own',
  /display: none !important;/.test(fsRule), fsRule);
check('...and Safari, which still wants the prefix',
  /:-webkit-full-screen \.wofs-nav-btn/.test(fsRule) &&
  /:-webkit-full-screen \.wofs-filmstrip/.test(fsRule), fsRule);
check('the mouse pointer goes too, or it sits on the wall all service',
  has(/\.wo-fullscreen-overlay:fullscreen,\s*\r?\n\s*\.wo-fullscreen-overlay:-webkit-full-screen \{ cursor: none; \}/));
// Esc still exits, both natively and through the app's own handler, so losing
// the close button costs nothing.
check('Esc still closes it, so hiding the close button strands nobody',
  has(/e\.key === 'Escape'/) && has(/closeFullscreen/));
// Windowed, it is the operator's own view and must be untouched.
check('windowed, the arrows and filmstrip still appear on hover as before',
  has(/\.wo-fullscreen-overlay:hover \.wofs-nav-btn \{ opacity: 1; \}/) &&
  has(/\.wofs-filmstrip \{[^}]*transform: translateY\(100%\)/));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
