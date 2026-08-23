'use strict';
// Contract check: can the form actually store what the scanner returns?
//
// WHY THIS EXISTS
// A scan read "Alas! and Did My Savior Bleed" correctly, in A-flat, with every
// chord right -- and the key never reached the song. The vocabulary sent to the
// scanner is built from FIXED_KEYS, which spells a key the way a person reads
// it ("G# / A-flat"), while the dropdown's option values are bare ("G#").
// Assigning one to the other left the select blank.
//
// It failed for exactly the five sharp and flat keys, which is most of a
// hymnal, and it failed in the worst possible way: silently, while the review
// banner counted the key as filled. Nobody would find that by looking. It took
// an audit against the printed page to notice a song had no key.
//
// The invariant it broke is simple, and static:
//
//   A <select> only holds strings equal to one of its options, so a scanned
//   value must never be assigned to one raw. It has to be resolved to an
//   option by meaning, and when nothing matches, said out loud rather than
//   dropped.
//
// Three things that cannot be allowed to drift apart:
//   1. _asmSetScanned still resolves dropdowns by meaning and records misses;
//   2. every field it writes to is an input, or a select covered by that;
//   3. every key in FIXED_KEYS can actually be selected in #newSongKey.
//
// Running it against the code as first written finds the original fault plus
// two more of the same kind: tempo and time signature were dropdowns being
// assigned to directly. Tempo happened to work because the library values
// matched the options exactly; time signature would have dropped anything
// outside its seven.
//
// It parses Index.html directly. No browser and no network: it is meant to run
// with the other repo checks before a commit.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');

let failures = 0;
const pass = (msg) => console.log('  OK    ' + msg);
const fail = (msg) => { failures++; console.log('  FAIL  ' + msg); };

// ── how the form declares each field ───────────────────────────────────────
// Returns 'select' | 'input' | 'textarea' | null for an element id.
function tagOf(id) {
  const m = HTML.match(new RegExp('<(select|input|textarea)\\b[^>]*\\bid="' + id + '"', 'i'))
        || HTML.match(new RegExp('<(select|input|textarea)\\b[^>]*\\bid=\'' + id + '\'', 'i'));
  return m ? m[1].toLowerCase() : null;
}

function optionValuesOf(selectId) {
  const start = HTML.search(new RegExp('<select\\b[^>]*\\bid="' + selectId + '"', 'i'));
  if (start < 0) return null;
  const end = HTML.indexOf('</select>', start);
  if (end < 0) return null;
  const block = HTML.slice(start, end);
  const out = [];
  const re = /<option[^>]*\svalue="([^"]*)"[^>]*>([^<]*)</gi;
  let m;
  while ((m = re.exec(block)) !== null) if (m[1]) out.push({ value: m[1], text: m[2].trim() });
  return out;
}

// ── 1. nothing assigned straight into a <select> ───────────────────────────
console.log('');
console.log('fields written by plain assignment must not be dropdowns');

// A dropdown is only safe to write to because the setter resolves options by
// meaning rather than assigning the raw string. That behaviour is the whole
// contract, so its absence is the first thing checked.
const selectAware = /el\.tagName === 'SELECT'/.test(HTML) && /_asmUnstored/.test(HTML);
if (!selectAware) fail('_asmSetScanned does not handle <select> fields');

const applyStart = HTML.indexOf('function _asmApplyScan(');
if (applyStart < 0) {
  fail('_asmApplyScan not found -- has the scan handler been renamed?');
} else {
  const applyBody = HTML.slice(applyStart, HTML.indexOf('\n}', applyStart));
  const ids = [...applyBody.matchAll(/_asmSetScanned\(\s*'([^']+)'/g)].map((m) => m[1]);
  if (!ids.length) fail('no _asmSetScanned calls found -- the check has lost its target');
  for (const id of ids) {
    const tag = tagOf(id);
    if (!tag) fail(id + ' is written by the scan but no such element exists');
    else if (tag === 'select') {
      // Allowed only because _asmSetScanned matches dropdowns by meaning. If
      // that ever goes, plain assignment resumes and the values vanish again.
      if (!selectAware) fail(id + ' is a <select> and _asmSetScanned no longer handles dropdowns');
      else pass(id + ' is a <select>, matched by meaning');
    } else pass(id + ' is an <' + tag + '>, accepts any text');
  }
}

// ── 2. every key the scanner can return is selectable ──────────────────────
console.log('');
console.log('every key in FIXED_KEYS can be selected in #newSongKey');

const keysSrc = (HTML.match(/var FIXED_KEYS = (\[[^\]]*\])/) || [])[1];
const options = optionValuesOf('newSongKey');

if (!keysSrc) fail('FIXED_KEYS not found in Index.html');
else if (!options) fail('#newSongKey not found, or it has no options');
else {
  // The same comparison _asmSetKeyField uses: accidental signs normalised, a
  // trailing "major" dropped, spacing ignored, and either side of a slash
  // matching on either side of the comparison.
  const norm = (s) => String(s).replace(/♯/g, '#').replace(/♭/g, 'b')
    .replace(/\s*(major|maj)\s*$/i, '').replace(/\s+/g, '').toLowerCase();
  const settable = (key) => {
    const wanted = [norm(key), ...String(key).split('/').map(norm)].filter(Boolean);
    return options.some((o) => {
      const forms = [norm(o.value), ...String(o.value).split('/').map(norm), ...String(o.text).split('/').map(norm)];
      return wanted.some((w) => forms.includes(w));
    });
  };
  const keys = keysSrc.replace(/^\[|\]$/g, '').split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  if (keys.length !== 12) fail('expected 12 chromatic keys, found ' + keys.length);
  const bad = keys.filter((k) => !settable(k));
  if (bad.length) {
    fail(bad.length + ' of ' + keys.length + ' keys cannot be selected: ' + bad.join(', '));
    console.log('        option values are: ' + options.map((o) => o.value).join(' '));
  } else {
    pass('all ' + keys.length + ' keys map to an option');
  }
}

// ── 3. the setter that does the mapping still exists ───────────────────────
console.log('');
console.log('the key setter is still wired up');
if (!/function _asmSetKeyField\(/.test(HTML)) fail('_asmSetKeyField is gone');
else if (!/_asmSetKeyField\(d\.key\)/.test(HTML)) fail('_asmSetKeyField exists but the scan no longer calls it for the key');
else pass('_asmApplyScan fills the key through _asmSetKeyField');

console.log('');
console.log('================================');
console.log(failures ? failures + ' contract failure(s)' : 'scan/form contract holds');
process.exit(failures ? 1 : 0);
