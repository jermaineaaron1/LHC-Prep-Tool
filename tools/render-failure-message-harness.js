'use strict';
// Regression harness for what a failed share tells the operator.
//
// WHY THIS EXISTS
// On 2026-10-02 both share features stopped working in production:
//
//   POST /api/render-roster-pdf -> 502
//   CloudConvert job failed: {"message":"Your account has run out of
//   conversion credits","code":"CREDITS_EXCEEDED"}
//
// The render route passes that message straight through, and both catch
// blocks threw it away for a flat "Failed to generate picture". So the
// operator saw a bare failure with no hint that it was a metered allowance,
// that it was nobody's fault, or that waiting would fix it.
//
// The two failures that actually occur are both specific and both fixable --
// out of credits, and a missing key -- so both are now named. Anything
// unrecognised keeps the plain wording, because inventing advice for a fault
// nobody has seen is worse than admitting ignorance.
//
// The fixtures below are the real strings: the CloudConvert error is copied
// verbatim from the 502 that prompted this, and the configuration error from
// app/api/render-roster-pdf/route.ts.
//
// USAGE
//   node tools/render-failure-message-harness.js                 # ../Index.html
//   node tools/render-failure-message-harness.js path/to/file.html
//   node tools/render-failure-message-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the fix
// (`git show cad0f9c:Index.html > x`).
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

const raw = fs.readFileSync(INDEX, 'utf8');
const lines = raw.split('\n');

function extractMethod(name, optional) {
  const startIdx = lines.findIndex(l => new RegExp('^    ' + name + ':\\s*function\\s*\\(').test(l));
  if (startIdx < 0) {
    if (optional) return null;
    throw new Error('method not found: ' + name);
  }
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n').replace(/,\s*$/, ''), line: startIdx + 1 };
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}

const fn = extractMethod('_renderFailureMessage', true);
console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  _renderFailureMessage @ ' + (fn ? 'line ' + fn.line : 'ABSENT') + '\n');

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

// The real failures, verbatim.
const OUT_OF_CREDITS = 'CloudConvert job failed: {"message":"Your account has run out of conversion credits","code":"CREDITS_EXCEEDED"}';
const NOT_CONFIGURED_IMG = 'Server is not configured for image rendering (missing CLOUDCONVERT_API_KEY).';
const NOT_CONFIGURED_PDF = 'Server is not configured for PDF rendering (missing CLOUDCONVERT_API_KEY).';

let say = null;
if (fn) {
  const api = new Function('return {' + fn.text + '};')();
  say = (err, thing) => api._renderFailureMessage(err, thing);
}

console.log('the operator is told which failure this is');
if (!say) {
  if (EXPECT_BROKEN) check('(pre-fix) nothing explained the failure', true, true);
  else check('_renderFailureMessage exists', false, true);
} else {
  const credits = say(new Error(OUT_OF_CREDITS), 'picture');
  check('out of credits is named as such', /credit/i.test(credits), true);
  check('it says the allowance comes back', /reset/i.test(credits), true);
  check('it names the thing that failed', /picture/.test(credits), true);
  check('it does not read like a bug', /failed to generate/i.test(credits), false);

  const creditsPdf = say(new Error(OUT_OF_CREDITS), 'PDF');
  check('the same holds for the PDF', /credit/i.test(creditsPdf) && /PDF/.test(creditsPdf), true);

  // Raw service noise must not reach a person mid-service.
  check('no raw JSON leaks through', /[{}]/.test(credits), false);
  check('no error code leaks through', /CREDITS_EXCEEDED/.test(credits), false);
  check('CloudConvert is not named at the operator', /cloudconvert/i.test(credits), false);

  const cfg = say(new Error(NOT_CONFIGURED_IMG), 'picture');
  check('a missing key is named as setup, not credits',
    /set up|missing/i.test(cfg) && !/credit/i.test(cfg), true);
  check('the PDF wording also reads', /PDF/.test(say(new Error(NOT_CONFIGURED_PDF), 'PDF')), true);
  check('the key name does not leak', /CLOUDCONVERT_API_KEY/.test(cfg), false);

  const net = say(new TypeError('Failed to fetch'), 'picture');
  check('a dead connection says so', /connection|reach/i.test(net), true);

  // Unknown faults keep the plain wording rather than guessing.
  check('an unrecognised fault stays plain', say(new Error('boom'), 'picture'), 'Failed to generate picture');
  check('render-failed stays plain', say(new Error('render-failed'), 'PDF'), 'Failed to generate PDF');

  // It must never throw while reporting a throw.
  check('a null error does not throw', say(null, 'picture'), 'Failed to generate picture');
  check('undefined does not throw', say(undefined, 'PDF'), 'Failed to generate PDF');
  check('a bare string works too', /credit/i.test(say(OUT_OF_CREDITS, 'picture')), true);
}

console.log('\nboth share paths use it');
{
  const cardUses = /Service card image render failed[\s\S]{0,160}?_renderFailureMessage\(err, 'picture'\)/.test(raw);
  const pdfUses = /Roster PDF render failed[\s\S]{0,160}?_renderFailureMessage\(err, 'PDF'\)/.test(raw);
  if (EXPECT_BROKEN) {
    check('(pre-fix) the card threw the reason away', cardUses, false);
    check('(pre-fix) the PDF threw the reason away', pdfUses, false);
  } else {
    check('the service card uses it', cardUses, true);
    check('the roster PDF uses it', pdfUses, true);
  }
}

console.log('\nthe detail still reaches the console');
{
  check('the card logs the real error', /console\.error\('Service card image render failed:', err\)/.test(raw), true);
  check('the PDF logs the real error', /console\.error\('Roster PDF render failed:', err\)/.test(raw), true);
}

console.log('\n================================');
const passed = results.filter(Boolean).length;
console.log(passed + '/' + results.length + ' checks passed');
if (passed !== results.length) process.exit(1);
