'use strict';
// Harness for how the Worship Orders module escapes what it writes into HTML.
//
// WHY THIS EXISTS
// The WO module has an escapeHtml of its own, and it went through
// textContent / innerHTML, which escapes & < > and leaves quotes alone. The
// module writes song, liturgy, order and file names, and link addresses, into
// attributes -- title=, value=, data-*= -- and into the JS strings of inline
// handlers, onclick="WO.f('...')". A name with a " in it ended the
// attribute and could start one of its own. One with a ' in it ended the
// handler's string (an order called "Mother's Day" broke its own button),
// and HTML escaping cannot help there: the attribute is decoded before the
// script runs, so &#39; arrives as '. So:
//
//   * escapeHtml escapes both quotes, for text and attributes alike;
//   * a value in a handler's JS string goes through escapeJsArg, which
//     escapes for the string first and then for the attribute;
//   * nothing in WO HTML-escapes a value straight into a handler's string,
//     and nothing JS-escapes one without HTML-escaping it;
//   * customConfirm escapes its title, which it writes as HTML;
//   * no toast is handed text that is already escaped (showToast escapes).
//
// USAGE
//   node tools/wo-escape-harness.js
//   node tools/wo-escape-harness.js path/to/file.html
//   node tools/wo-escape-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the fix.
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }

const lines = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n').split('\n');
const woStart = lines.findIndex(l => l.startsWith('var WO = (function()'));
const litStart = lines.findIndex(l => l.startsWith('var LiturgyModule = (function()'));

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

// The first `  function NAME(` inside [from, to), sliced by brace balance.
function sliceFn(name, from, to) {
  const re = new RegExp('^\\s*function ' + name + '\\s*\\(');
  for (let i = from; i < to; i++) {
    if (!re.test(lines[i])) continue;
    let depth = 0, started = false;
    const out = [];
    for (let k = i; k < to; k++) {
      out.push(lines[k]);
      for (const ch of lines[k]) {
        if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--;
      }
      if (started && depth === 0) return out.join('\n');
    }
  }
  return null;
}

// A browser's textContent -> innerHTML: & < > (and the no-break space).
const fakeDocument = {
  createElement() {
    let text = '';
    return {
      set textContent(v) { text = String(v); },
      get innerHTML() { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;'); }
    };
  }
};
// How an attribute value is decoded before anything reads it.
function decodeAttr(v) {
  return v.replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&nbsp;/g, '\u00a0').replace(/&amp;/g, '&');
}

const hostile = [
  'Mother\'s Day',
  'Hymn" onmouseover="alert(1)" x="',
  "x');alert(document.cookie);('",
  'C:\\Songs\\It\'s "Well".pdf',
  'line one\nline two',
  '</script><img src=x onerror=alert(1)>',
  'https://example.com/it\'s?a=1&b="2"'
];

console.log('\n[escapeHtml in the WO module]');
const escSrc = woStart >= 0 && litStart > woStart ? sliceFn('escapeHtml', woStart, litStart) : null;
let escapeHtml = null;
if (!escSrc) check('the WO module has its own escapeHtml', false, 'not found between var WO and var LiturgyModule');
else {
  escapeHtml = new Function('document', escSrc + '\nreturn escapeHtml;')(fakeDocument);
  hostile.forEach(function(t) {
    const out = escapeHtml(t);
    check('no raw quote survives: ' + JSON.stringify(t).slice(0, 40), out.indexOf('"') === -1 && out.indexOf("'") === -1, out);
    check('and it reads back the same: ' + JSON.stringify(t).slice(0, 40), decodeAttr(out) === t, out);
  });
  check('nothing comes out as nothing', escapeHtml('') === '' && escapeHtml(null) === '' && escapeHtml(undefined) === '');
}

console.log('\n[escapeJsArg: a value in an inline handler\'s JS string]');
const jsSrc = woStart >= 0 && litStart > woStart ? sliceFn('escapeJsArg', woStart, litStart) : null;
if (!jsSrc || !escSrc) check('the WO module has escapeJsArg', false, 'not found');
else {
  const escapeJsArg = new Function('document', escSrc + '\n' + jsSrc + '\nreturn escapeJsArg;')(fakeDocument);
  hostile.forEach(function(t) {
    const attr = escapeJsArg(t);
    // What the browser hands the script: the attribute, decoded.
    const script = "return '" + decodeAttr(attr) + "';";
    let got, err = '';
    try { got = new Function(script)(); } catch (e) { err = e.message; }
    check('ends neither the attribute nor the string: ' + JSON.stringify(t).slice(0, 40),
      attr.indexOf('"') === -1 && got === t, err || ('got ' + JSON.stringify(got)));
  });
  check('null and undefined are empty strings', escapeJsArg(null) === '' && escapeJsArg(undefined) === '');
}

console.log('\n[the source: every handler value escaped for its context]');
const BS = '\\';
const wo = woStart >= 0 && litStart > woStart ? lines.slice(woStart, litStart) : [];
const htmlOnlyInHandler = [], jsOnlyInHandler = [], toastPreEscaped = [];
wo.forEach(function(l, k) {
  const n = woStart + k + 1;
  // \'' + escapeHtml(  -- an HTML-escaped value opening a JS string
  if (l.indexOf(BS + "'' + escapeHtml(") !== -1) htmlOnlyInHandler.push(n);
  // a value JS-escaped by hand and not HTML-escaped (or HTML-escaped first)
  if (/\.replace\(\/'\/g, "\\\\'"\)/.test(l) && l.indexOf('function escapeJsArg') === -1 && !/t\.replace\(\/\\\\\/g/.test(l)) jsOnlyInHandler.push(n);
  if (/showToast\([^;]*escapeHtml\(/.test(l)) toastPreEscaped.push(n);
});
check('no handler string takes an HTML-only escaped value', !htmlOnlyInHandler.length, 'lines ' + htmlOnlyInHandler.slice(0, 8).join(', '));
check('no value is JS-escaped by hand instead of through escapeJsArg', !jsOnlyInHandler.length, 'lines ' + jsOnlyInHandler.slice(0, 8).join(', '));
check('no toast is handed text that is already escaped (showToast escapes)', !toastPreEscaped.length, 'lines ' + toastPreEscaped.slice(0, 8).join(', '));

const cc = lines.findIndex(l => /window\.customConfirm = function\(title, message\)/.test(l));
const ccBody = cc >= 0 ? lines.slice(cc, cc + 12).join('\n') : '';
check('customConfirm escapes the title it writes as HTML',
  /titleEl\.innerHTML = [^;]*escapeHtml\(title/.test(ccBody), ccBody.split('\n').filter(l => /titleEl\.innerHTML/.test(l))[0] || 'customConfirm not found');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (EXPECT_BROKEN) {
  if (fail === 0) {
    console.log('--expect-broken: nothing failed, so this source already has the fix (or the harness has no teeth)');
    process.exit(1);
  }
  console.log('--expect-broken: failures above are the expected ones');
  process.exit(0);
}
process.exit(fail ? 1 : 0);
