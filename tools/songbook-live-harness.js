#!/usr/bin/env node
'use strict';
// songbook-live-harness.js
//
// What a change of fingerprint means to the reading view's live layer:
// marks and takes reload quietly, lines / words / settings / the book ask
// for a refresh, and a part that could not be read says nothing. Sliced
// out of Index.html; `--expect-broken` is the negative control.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

const raw = fs.readFileSync(INDEX, 'utf8');
const lines = raw.split('\n');

function extract(pattern, name) {
  const startIdx = lines.findIndex(l => pattern.test(l));
  if (startIdx < 0) throw new Error('not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('no close for ' + name);
}

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log((ok ? '  ok    ' : '  FAIL  ') + label);
  if (!ok) {
    console.log('          got  ' + JSON.stringify(got));
    console.log('          want ' + JSON.stringify(want));
  }
}

let S;
try {
  const src = extract(/^  function _sbmLiveDiff\(/, '_sbmLiveDiff') + '\n' + extract(/^  function _sbmHash\(/, '_sbmHash');
  S = new Function(src + '\nreturn { diff: _sbmLiveDiff, hash: _sbmHash };')();
  S.pollSrc = extract(/^  function _sbPollChanged\(/, '_sbPollChanged');
} catch (e) {
  if (EXPECT_BROKEN) {
    console.log('--expect-broken: ' + e.message + ', as expected.');
    process.exit(0);
  }
  throw e;
}
if (EXPECT_BROKEN) {
  console.log('\nBUT --expect-broken was given and the live layer is present.');
  process.exit(1);
}

const fp = (o) => Object.assign({ marks: '3@a', recs: '5@b', lines: '40@c', songs: 'h1', book: 'h2' }, o || {});

console.log('\nwhat a change of fingerprint means');
check('nothing changed, nothing to do', S.diff(fp(), fp()), { marks: false, recs: false, structural: false });
check('a new mark reloads the marks quietly', S.diff(fp(), fp({ marks: '4@z' })), { marks: true, recs: false, structural: false });
check('a new take reloads the takes quietly', S.diff(fp(), fp({ recs: '6@z' })), { marks: false, recs: true, structural: false });
check('rewritten lines ask for a refresh', S.diff(fp(), fp({ lines: '40@d' })).structural, true);
check('  so do the songs\' words or settings', S.diff(fp(), fp({ songs: 'h9' })).structural, true);
check('  and the book itself', S.diff(fp(), fp({ book: 'h9' })).structural, true);
check('a part that could not be read says nothing', S.diff(fp(), fp({ lines: 'na' })).structural, false);
check('  either way round', S.diff(fp({ marks: 'na' }), fp()).marks, false);
check('nothing seen yet is nothing to compare', S.diff(null, fp()), { marks: false, recs: false, structural: false });

console.log('\nthe hash');
check('the same text hashes the same', S.hash('abc') === S.hash('abc'), true);
check('  and different text differently', S.hash('abc') === S.hash('abd'), false);

(async function() {
  console.log('\nthe songbook\'s 2-second poll asks first whether anything changed');
  // A stand-in client that answers the orders table and notes what was asked.
  let stamp = '2026-10-31T10:00:00.000Z', fail = false;
  const asked = [];
  const sb = { from: t => ({ select: cols => { asked.push(t + ':' + cols); return { eq: () => ({ maybeSingle: () => Promise.resolve(fail ? { data: null, error: { message: 'x' } } : { data: { last_edited: stamp }, error: null }) }) }; } }) };
  const P = new Function('SBQ', 'var _sbPollFullRead = {}, _sbLastPollTs = 0;\n' + S.pollSrc + '\nreturn { changed: _sbPollChanged, seen: function(t) { _sbLastPollTs = t; } };')({ _sb: () => sb });
  check('the first poll of an open reads everything, asking nothing first', [await P.changed('o1'), asked.length], [true, 0]);
  P.seen(new Date(stamp).getTime());
  check('  after that it asks for the last-edited time alone', [await P.changed('o1'), asked], [false, ['orders:last_edited']]);
  stamp = '2026-10-31T10:00:05.000Z';
  check('  and reads everything again once that time has moved', await P.changed('o1'), true);
  fail = true;
  check('  a probe that cannot tell reads everything, as before', await P.changed('o1'), true);
  check('another order is read in full on its first poll', await P.changed('o2'), true);

  const failed = results.filter(r => !r).length;
  console.log('\n' + (failed ? failed + ' of ' + results.length + ' checks FAILED' : 'All ' + results.length + ' checks passed.'));
  process.exit(failed ? 1 : 0);
})();
