'use strict';
// Regression harness for refusing to share an empty service card.
//
// WHY THIS EXISTS
// A month nobody has rostered yet still draws a complete service card: one
// row for every duty, every one of them blank, under a badge reading
// "26 open". Nothing stopped that card being turned into a picture and sent
// to the congregation over WhatsApp.
//
// This was found after a related bug had already been fixed. That one left
// the card blank because the month had never been fetched; this one leaves it
// blank because the month genuinely has nothing in it. Same card, same
// embarrassment, different cause -- which is exactly why it is worth a test
// rather than a careful reading.
//
// Measured against the live app on 2026-10-01: sharing "Jul 2 2028" produced
// "Service Type not set / 26 open" with all twelve duty rows empty. December
// 2026 held 14 filled values against a normal month's ~110, so this was due
// to happen for real in late November.
//
// HOW IT WORKS
// It slices the REAL _rmpCardFilledCount and shareServiceCardImage out of
// Index.html and runs them against tools/minidom.js. The refusal happens
// before the card is cloned and before anything is fetched, so the empty
// cases run to completion; the filled cases are expected to fall over later
// in the real rendering path, and are judged on whether they got PAST the
// guard (the "Generating picture..." toast) rather than on finishing.
//
// USAGE
//   node tools/share-empty-card-harness.js                 # checks ../Index.html
//   node tools/share-empty-card-harness.js path/to/file.html
//   node tools/share-empty-card-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the fix
// (`git show 717f948:Index.html > x`).
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');
const { El, makeDocument } = require('./minidom.js');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}

const raw = fs.readFileSync(INDEX, 'utf8');
const lines = raw.split('\n');

// Methods on the RosterEngine object literal, not module-level functions.
function extractMethod(name, optional) {
  const startIdx = lines.findIndex(l => new RegExp('^    ' + name + ':\\s*function\\s*\\(').test(l));
  if (startIdx < 0) {
    if (optional) return null;
    throw new Error('method not found in ' + path.basename(INDEX) + ': ' + name);
  }
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) {
      return { text: out.join('\n').replace(/,\s*$/, ''), line: startIdx + 1 };
    }
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}

const filledCount = extractMethod('_rmpCardFilledCount', true);
const shareImage = extractMethod('shareServiceCardImage');

console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  _rmpCardFilledCount @ ' + (filledCount ? 'line ' + filledCount.line : 'ABSENT'));
console.log('  shareServiceCardImage @ line ' + shareImage.line + '\n');

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

// A card as renderMobileMonthView draws it: a tally, and one row per duty.
function makeCard(doc, dateStr, filled, total, opts) {
  opts = opts || {};
  const attrs = { 'data-date': dateStr, 'data-service-idx': '0' };
  if (!opts.noTally) {
    attrs['data-filled'] = opts.rawFilled !== undefined ? opts.rawFilled : String(filled);
    attrs['data-total'] = String(total);
  }
  const card = new El('div', 'rmp-service-ledger', attrs);
  for (let i = 0; i < total; i++) {
    const row = new El('div', 'rmp-duty-row');
    const person = new El('div', 'rmp-person');
    if (i >= filled) person.classList.add('open');
    else person.textContent = 'Someone ' + i;
    row.appendChild(person);
    card.appendChild(row);
  }
  (opts.scripture || []).forEach(function (ref) {
    const row = new El('div', 'rmp-duty-row');
    const s = new El('div', 'rmp-scripture');
    s.textContent = ref;
    row.appendChild(s);
    card.appendChild(row);
  });
  doc.root.appendChild(card);
  return card;
}

function build() {
  const doc = makeDocument();
  const env = {
    document: doc, Promise: Promise, parseInt: parseInt, isNaN: isNaN,
    Array: Array, Object: Object, JSON: JSON, String: String, console: console,
    STATE: { rosterMonth: 11, rosterYear: 2026 },
    navigator: {},
    fetch: function () { return Promise.reject(new Error('fetch must not be reached for an empty card')); },
    setTimeout: setTimeout, clearTimeout: clearTimeout
  };
  const keys = Object.keys(env);
  const body = 'return {' +
    (filledCount ? filledCount.text + ',\n' : '') +
    shareImage.text + '};';
  const api = new Function(...keys, body)(...keys.map(function (k) { return env[k]; }));
  const toasts = [];
  api.showToast = function (msg, type) { toasts.push({ msg: String(msg), type: type }); };
  api.escapeHtml = function (s) { return String(s); };
  api.MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  api._rosterStampText = function () { return 'stamp'; };
  api._rmpCardShareCSS = function () { return ''; };
  return { doc: doc, api: api, toasts: toasts };
}

// Did the call get past the guard into the real rendering path?
function ranShare(toasts) { return toasts.some(function (t) { return /Generating picture/i.test(t.msg); }); }
function refused(toasts) { return toasts.some(function (t) { return /Nothing to share/i.test(t.msg); }); }

function attempt(api, dateStr) {
  let returned, threw = null;
  try { returned = api.shareServiceCardImage(dateStr); }
  catch (e) { threw = e; }
  // Swallow the rejection the real path produces once it is past the guard.
  if (returned && typeof returned.then === 'function') returned.catch(function () {});
  return { returned: returned, threw: threw };
}

// ---------------------------------------------------------------------------
console.log('the tally is read off the card');
if (!filledCount) {
  if (EXPECT_BROKEN) {
    check('(pre-fix) there is no tally helper at all', true, true);
  } else {
    check('_rmpCardFilledCount exists', false, true);
  }
} else {
  const b = build();
  check('an empty month counts nothing', b.api._rmpCardFilledCount(makeCard(b.doc, 'A', 0, 12)), 0);
  check('a filled month counts its duties', b.api._rmpCardFilledCount(makeCard(b.doc, 'B', 7, 12)), 7);
  check('no card is nothing', b.api._rmpCardFilledCount(null), 0);
  check('a card with no tally is treated as worth sharing',
    b.api._rmpCardFilledCount(makeCard(b.doc, 'C', 0, 12, { noTally: true })), 1);
  check('a nonsense tally is treated as worth sharing',
    b.api._rmpCardFilledCount(makeCard(b.doc, 'D', 0, 12, { rawFilled: 'lots' })), 1);
  check('scripture references alone do not count as duties',
    b.api._rmpCardFilledCount(makeCard(b.doc, 'E', 0, 12, { scripture: ['Psalm 80: 7-19', 'Matthew 21:33-46'] })), 0);
}

// ---------------------------------------------------------------------------
console.log('\nan unrostered month is not sent to the congregation');
{
  const b = build();
  makeCard(b.doc, 'Dec 6', 0, 12);
  const r = attempt(b.api, 'Dec 6');
  if (EXPECT_BROKEN) {
    check('(pre-fix) the empty card went straight to rendering', ranShare(b.toasts), true);
    check('(pre-fix) nothing refused it', refused(b.toasts), false);
  } else {
    check('it is refused', refused(b.toasts), true);
    check('it never reaches the renderer', ranShare(b.toasts), false);
    check('the refusal names the date', b.toasts.some(function (t) { return /Dec 6/.test(t.msg); }), true);
    check('it is a warning, not an error',
      (b.toasts.filter(function (t) { return /Nothing to share/.test(t.msg); })[0] || {}).type, 'warning');
    check('nothing was thrown', r.threw, null);
    check('a promise still comes back, so the caller can restore the month',
      !!(r.returned && typeof r.returned.then === 'function'), true);
  }
}

// ---------------------------------------------------------------------------
console.log('\na month with any duty at all is still shareable');
{
  const b = build();
  makeCard(b.doc, 'Oct 4', 1, 12);          // a single preacher and nothing else
  attempt(b.api, 'Oct 4');
  check('one filled duty is enough', ranShare(b.toasts), true);
  check('it is not refused', refused(b.toasts), false);
}
{
  const b = build();
  makeCard(b.doc, 'Oct 11', 12, 12);
  attempt(b.api, 'Oct 11');
  check('a fully rostered month is shareable', ranShare(b.toasts), true);
}
{
  // The partly-filled case is the whole point: those are worth circulating
  // BECAUSE they still have gaps in them.
  const b = build();
  makeCard(b.doc, 'Nov 1', 3, 12, { scripture: ['Psalm 80: 7-19'] });
  attempt(b.api, 'Nov 1');
  check('a half-filled month is shareable', ranShare(b.toasts), true);
}

// ---------------------------------------------------------------------------
console.log('\na card that is not there is still reported');
{
  const b = build();
  const r = attempt(b.api, 'Feb 30');
  check('the operator is told', b.toasts.some(function (t) { return /Could not find/i.test(t.msg); }), true);
  check('it never reaches the renderer', ranShare(b.toasts), false);
  check('a promise still comes back', !!(r.returned && typeof r.returned.then === 'function'), true);
}

// ---------------------------------------------------------------------------
console.log('\nthe card records the tally the guard depends on');
{
  const emits = raw.indexOf('data-filled="\' + filledCount + \'" data-total="\' + totalCount + \'"') !== -1;
  if (EXPECT_BROKEN) {
    check('(pre-fix) the card recorded no tally', emits, false);
  } else {
    check('the service ledger writes data-filled and data-total', emits, true);
  }
}

console.log('\n================================');
const passed = results.filter(Boolean).length;
console.log(passed + '/' + results.length + ' checks passed');
if (passed !== results.length) process.exit(1);
