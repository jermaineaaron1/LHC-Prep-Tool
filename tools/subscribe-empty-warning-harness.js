'use strict';
// Regression harness for the "this calendar would be empty" warning.
//
// WHY THIS EXISTS
// The ICS feed matches a member by their EXACT name, and the subscribe
// picker offers every name the roster has ever held. Measured 2026-10-02:
// 76 names offered, of which three lead nowhere --
//
//   "Aaron"        1 row, 0 upcoming   beside  "Aaron Jayaraj"  20 rows, 7 upcoming
//   "Alison"       1 row, 0 upcoming   beside  "Alison Phan"    17 rows, 4 upcoming
//   "All Teachers" 1 row, 0 upcoming           (a group, listed as a person)
//
// Pick one of those and the feed answers perfectly correctly with a calendar
// containing nothing. You subscribe, see an empty calendar, and have no idea
// why. Nobody's duties were being dropped when this was written; the trap is
// that the silence is indistinguishable from success.
//
// The check asks the FEED rather than counting roster rows, so the warning
// cannot disagree with what the member is about to subscribe to. It warns
// rather than blocks, because a name with nothing on it today may be given a
// duty next week and the subscription would pick that up on its own.
//
// WHAT MATTERS MOST HERE
// This page is public, has no login, and takes the member's name straight
// from `?name=` in the URL. Anything that name touches must be escaped.
//
// USAGE
//   node tools/subscribe-empty-warning-harness.js                 # ../Index.html
//   node tools/subscribe-empty-warning-harness.js path/to/file.html
//   node tools/subscribe-empty-warning-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 95e2497:Index.html > x`).
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

function extractFn(name, optional) {
  const startIdx = lines.findIndex(l => new RegExp('^  function ' + name + '\\s*\\(').test(l));
  if (startIdx < 0) {
    if (optional) return null;
    throw new Error('function not found: ' + name);
  }
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n'), line: startIdx + 1 };
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}

const fn = extractFn('_subWarnIfEmpty', true);
console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  _subWarnIfEmpty @ ' + (fn ? 'line ' + fn.line : 'ABSENT') + '\n');

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

const CAL_WITH_EVENTS =
  'BEGIN:VCALENDAR\r\nBEGIN:VTIMEZONE\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\n' +
  'END:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:x\r\nEND:VEVENT\r\nEND:VCALENDAR';
const CAL_EMPTY =
  'BEGIN:VCALENDAR\r\nBEGIN:VTIMEZONE\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\n' +
  'END:STANDARD\r\nEND:VTIMEZONE\r\nEND:VCALENDAR';

function run(fetchImpl) {
  const slot = { innerHTML: '' };
  const env = {
    fetch: fetchImpl,
    document: { getElementById: id => (id === 'subEmptyWarn' ? slot : null) },
    // The real one; the name comes from the URL on a public page.
    escapeHtmlModal: s => String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    Promise: Promise
  };
  const keys = Object.keys(env);
  const api = new Function(...keys, fn.text + '\n; return _subWarnIfEmpty;')(...keys.map(k => env[k]));
  return { api, slot };
}

const settle = () => new Promise(r => setTimeout(r, 25));

(async () => {
  console.log('an empty calendar is called out, a full one is not');
  if (!fn) {
    if (EXPECT_BROKEN) check('(pre-change) nothing warned about an empty calendar', true, true);
    else check('_subWarnIfEmpty exists', false, true);
  } else {
    {
      const { api, slot } = run(() => Promise.resolve({ ok: true, text: () => Promise.resolve(CAL_WITH_EVENTS) }));
      api('Luke Yong', '/api/calendar?name=Luke%20Yong');
      await settle();
      check('a calendar with duties says nothing', slot.innerHTML, '');
    }
    {
      const { api, slot } = run(() => Promise.resolve({ ok: true, text: () => Promise.resolve(CAL_EMPTY) }));
      api('Aaron', '/api/calendar?name=Aaron');
      await settle();
      check('an empty one warns', /sg-warn/.test(slot.innerHTML), true);
      check('it names the member', /Aaron/.test(slot.innerHTML), true);
      check('it suggests the name may be spelled differently',
        /written differently|spelled differently/i.test(slot.innerHTML), true);
      check('it does not tell them to give up', /still add the calendar/i.test(slot.innerHTML), true);
    }
    // A VTIMEZONE alone must not read as an event -- it carries its own DTSTART.
    {
      const { api, slot } = run(() => Promise.resolve({ ok: true, text: () => Promise.resolve(CAL_EMPTY) }));
      api('All Teachers', '/api/calendar?name=All%20Teachers');
      await settle();
      check('the VTIMEZONE block is not mistaken for a duty', /sg-warn/.test(slot.innerHTML), true);
    }

    console.log('\nit stays quiet when it cannot tell');
    {
      const { api, slot } = run(() => Promise.reject(new Error('offline')));
      api('Luke Yong', '/api/calendar?name=Luke');
      await settle();
      check('a failed fetch does not cry wolf', slot.innerHTML, '');
    }
    {
      const { api, slot } = run(() => Promise.resolve({ ok: false, text: () => Promise.resolve('') }));
      api('Luke Yong', '/api/calendar?name=Luke');
      await settle();
      check('a 500 from the feed does not cry wolf', slot.innerHTML, '');
    }
    {
      const { api, slot } = run(() => Promise.resolve({ ok: true, text: () => Promise.resolve('') }));
      api('Luke Yong', '/api/calendar?name=Luke');
      await settle();
      check('an empty body does not cry wolf', slot.innerHTML, '');
    }

    console.log('\nthe name comes from the URL, so it is escaped');
    {
      const nasty = '<img src=x onerror=alert(1)>';
      const { api, slot } = run(() => Promise.resolve({ ok: true, text: () => Promise.resolve(CAL_EMPTY) }));
      api(nasty, '/api/calendar?name=x');
      await settle();
      check('no raw tag reaches the page', /<img/.test(slot.innerHTML), false);
      check('it is escaped, not dropped', /&lt;img/.test(slot.innerHTML), true);
      // The literal text "onerror=" DOES survive, inside the escaped string,
      // and that is fine -- it is inert text, not an attribute. The property
      // that matters is that the raw name never appears unescaped, so it can
      // never close a tag or open an attribute.
      check('the raw name never appears unescaped', slot.innerHTML.indexOf(nasty) !== -1, false);
    }
    {
      // A name carrying quotes must not be able to open an attribute either.
      const quoted = 'x" onmouseover="alert(1)';
      const { api, slot } = run(() => Promise.resolve({ ok: true, text: () => Promise.resolve(CAL_EMPTY) }));
      api(quoted, '/api/calendar?name=x');
      await settle();
      check('quotes in the name are escaped', /&quot;/.test(slot.innerHTML), true);
      check('the quoted payload never appears raw', slot.innerHTML.indexOf(quoted) !== -1, false);
    }
  }

  console.log('\nthe guide wires it up');
  {
    const hasSlot = /<div id="subEmptyWarn"><\/div>/.test(raw);
    const calls = /_subWarnIfEmpty\(name, ics\);/.test(raw);
    if (EXPECT_BROKEN) {
      check('(pre-change) there was no slot for a warning', hasSlot, false);
      check('(pre-change) nothing called the check', calls, false);
    } else {
      check('the guide has somewhere to put it', hasSlot, true);
      check('the guide calls the check', calls, true);
    }
  }

  console.log('\n================================');
  const passed = results.filter(Boolean).length;
  console.log(passed + '/' + results.length + ' checks passed');
  if (passed !== results.length) process.exit(1);
})();
