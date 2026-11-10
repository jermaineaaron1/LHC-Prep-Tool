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
    wide.px === 5 && wide.steps === 0, JSON.stringify(wide));

  // Too tall at the base size; shrinks until it fits.
  const tall = runFit({ zoneH: 972, zoneW: 1728, width: 100, heightAt: f => f * 300 });
  check('a slide taller than the safe zone IS still shrunk, so no line is lost',
    tall.px < 5 && tall.px * 300 <= 972, JSON.stringify(tall));

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
  /font-size: 5vw/.test(projCss) && has(/s\.fontSize \|\| 5\) \+ "vw;"/), projCss);

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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
