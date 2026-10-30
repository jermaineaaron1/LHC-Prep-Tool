'use strict';
// Regression harness for cutting a run-through into line takes.
//
// WHY THIS EXISTS
// The cutter writes a NEW audio file from a span of a recording, with a
// name and a number of its own, and attaches it to a line. Nothing in that
// throws when it is wrong: a wav with a bad header plays as silence or not
// at all; a span clamped the wrong way saves two seconds of the wrong
// place; a take numbered as the one before it overwrites nothing in the
// database but reads, to a singer, as the same take twice; a peak drawn as
// an average is a waveform that looks flat where the choir is loudest.
//
// HOW IT WORKS
// It slices the pure parts of the cutter out of Index.html -- peaks, the
// span of samples, the wav bytes, the time format and parse, the clamp,
// the next name -- and runs them against small arrays. The page itself
// (canvas, audio element, pointer events) is verified in the browser.
//
// USAGE
//   node tools/songbook-cut-harness.js
//   node tools/songbook-cut-harness.js path/to/file.html
//   node tools/songbook-cut-harness.js <file> --expect-broken
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

// Brace-matched slice of one function, the way the other harnesses do it.
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

const WANTED = [
  [/^  function _sbmCutPeaks\(/, '_sbmCutPeaks'],
  [/^  function _sbmCutSlice\(/, '_sbmCutSlice'],
  [/^  function _sbmWavBytes\(/, '_sbmWavBytes'],
  [/^  function _sbmCutFmt\(/, '_sbmCutFmt'],
  [/^  function _sbmCutParse\(/, '_sbmCutParse'],
  [/^  function _sbmCutClamp\(/, '_sbmCutClamp'],
  [/^  function _sbmCutNextName\(/, '_sbmCutNextName'],
  [/^  function _sbmMoveSiblings\(/, '_sbmMoveSiblings'],
  [/^  function _sbmRecTok\(/, '_sbmRecTok'],
  [/^  function _sbmSecNorm\(/, '_sbmSecNorm'],
  [/^  function _sbmCutShort\(/, '_sbmCutShort'],
  [/^  function _sbmCutNextTarget\(/, '_sbmCutNextTarget'],
  [/^  function _sbmAutoTakeName\(/, '_sbmAutoTakeName']
];

let S;
try {
  const src = WANTED.map(([re, name]) => extract(re, name)).join('\n');
  S = new Function(src + '\nreturn { peaks: _sbmCutPeaks, slice: _sbmCutSlice, wav: _sbmWavBytes, fmt: _sbmCutFmt, parse: _sbmCutParse, clamp: _sbmCutClamp, next: _sbmCutNextName, moveSiblings: _sbmMoveSiblings, short: _sbmCutShort, nextTarget: _sbmCutNextTarget, autoName: _sbmAutoTakeName };')();
} catch (e) {
  if (EXPECT_BROKEN) {
    console.log('--expect-broken: ' + e.message + ', as expected.');
    process.exit(0);
  }
  throw e;
}
if (EXPECT_BROKEN) {
  console.log('\nBUT --expect-broken was given and the cutter is present.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
console.log('\nthe waveform');
check('one peak per column, the loudest sample in each', S.peaks([0, 0.5, -0.9, 0.1, 0.2, -0.3, 0.05, 0], 4), [0.5, 0.9, 0.3, 0.05]);
check('  the loudest, not the average: a quiet column with one hit still shows it', S.peaks([0, 0, 0, 1], 1), [1]);
check('nothing in, nothing out', [S.peaks([], 10), S.peaks([1, 2], 0)], [[], []]);

console.log('\nthe span of samples');
const stereo = {
  sampleRate: 10, numberOfChannels: 2, length: 20, duration: 2,
  getChannelData: k => Float32Array.from({ length: 20 }, (_, i) => k === 0 ? i / 10 : -i / 10)
};
const mono = Array.from(S.slice(stereo, 0.5, 1.0));
check('half a second at 10 Hz is five samples, from the fifth', mono.length, 5);
check('  the channels averaged -- here, cancelling', mono.every(v => Math.abs(v) < 1e-6), true);
const one = { sampleRate: 10, numberOfChannels: 1, length: 20, duration: 2, getChannelData: () => Float32Array.from({ length: 20 }, (_, i) => i / 10) };
check('a mono span is the samples themselves', Array.from(S.slice(one, 1.0, 1.3)).map(v => Math.round(v * 10) / 10), [1, 1.1, 1.2]);
check('a span past the end stops at the end', S.slice(one, 1.9, 5).length, 1);

console.log('\nthe wav');
const wav = new DataView(S.wav(new Float32Array([0, 1, -1, 0.5]), 8000));
const tag = (o) => String.fromCharCode(wav.getUint8(o), wav.getUint8(o + 1), wav.getUint8(o + 2), wav.getUint8(o + 3));
check('RIFF / WAVE / fmt / data', [tag(0), tag(8), tag(12), tag(36)], ['RIFF', 'WAVE', 'fmt ', 'data']);
check('16-bit PCM, one channel, at the rate it was given',
  [wav.getUint16(20, true), wav.getUint16(22, true), wav.getUint32(24, true), wav.getUint16(34, true)], [1, 1, 8000, 16]);
check('the byte rate and block align follow', [wav.getUint32(28, true), wav.getUint16(32, true)], [16000, 2]);
check('the sizes count the samples', [wav.getUint32(4, true), wav.getUint32(40, true), wav.byteLength], [36 + 8, 8, 44 + 8]);
check('full scale both ways, and half', [wav.getInt16(46, true), wav.getInt16(48, true), wav.getInt16(50, true)], [32767, -32768, 16383]);
check('a sample past full scale is clipped, not wrapped', new DataView(S.wav(new Float32Array([1.7, -2]), 8000)).getInt16(44, true), 32767);

console.log('\ntimes');
check('seconds as m:ss.t', [S.fmt(0), S.fmt(62.49), S.fmt(5.04), S.fmt(600)], ['0:00.0', '1:02.5', '0:05.0', '10:00.0']);
check('m:ss.t, m:ss and plain seconds parse', [S.parse('1:02.5'), S.parse('1:02'), S.parse('62.5'), S.parse(' 7 ')], [62.5, 62, 62.5, 7]);
check('nonsense does not', [S.parse('abc'), S.parse('1:2:3'), S.parse('')], [null, null, null]);

console.log('\nthe span is kept inside the recording and at least a breath long');
const cl = (a, b, d, m) => { const c = S.clamp(a, b, d, m); return { start: Math.round(c.start * 1000) / 1000, end: Math.round(c.end * 1000) / 1000 }; };
check('inside the recording', cl(-1, 99, 10), { start: 0, end: 10 });
check('the handle that moved gives way: the end dragged onto the start pushes the start back',
  cl(5, 5.1, 10, 'end'), { start: 4.8, end: 5.1 });
check('  and the start dragged onto the end pushes the end on', cl(5, 5.1, 10, 'start'), { start: 5, end: 5.3 });
// 5.1 - 4.8 is 0.29999999999999982 to a float; without a tolerance the
// span the clamp had just fixed was judged too short and flung to the end.
check('  and a span exactly a breath long is left where it is', cl(4.8, 5.1, 10, 'end'), { start: 4.8, end: 5.1 });
check('a span at the very end stays at the end', cl(9.9, 10, 10, 'start'), { start: 9.7, end: 10 });

console.log('\nthe next name');
check('one past the highest number the line has', S.next('Melody', ['Melody take 1', 'Melody take 3']), 'Melody take 4');
check('  or past how many it has, when the names say nothing', S.next('Women', ['Take take 1', 'Take take 1']), 'Women take 3');
check('  whichever is more -- never the same as one it has', S.next('Men', ['Men take 2', 'x', 'y']), 'Men take 4');
check('the first is take 1', S.next('2nd Part', []), '2nd Part take 1');

console.log('\nthe takes a moved take is numbered after');
// A run-through, section takes of two sections in two slots, line takes:
// the number a moved take gets must come from the group it will sit in.
const rt = (id, slot, extra) => Object.assign({ id: id, name: id, line_id: null, storage_path: 'practice-recordings/s1/' + slot + '__1.webm' }, extra || {});
const pool = [
  rt('A', 'general'),                          // a run-through
  rt('B', 'women', { section: 'Verse 1' }),    // the women's Verse 1
  rt('C', 'women', { section: 'Verse 2' }),
  rt('E', 'men', { section: 'Verse 1' }),
  rt('F', 'men', { section: 'verse 1 ' }),     // the same section, spelt by hand
  rt('G', 'men'),                              // a men run-through
  rt('H', 'men', { line_id: 9 }),              // a men LINE take
  rt('D', 'women', { line_id: 7 }),
  rt('K', 'women', { line_id: 7 })
];
const ids = xs => xs.map(x => x.id);
check('a section take moved to the men lands among the men takes of ITS section', ids(S.moveSiblings(pool, pool[1], null, 'men')), ['E', 'F']);
check('  a run-through moved to the women counts only the women run-throughs', ids(S.moveSiblings(pool, pool[0], null, 'women')), []);
check('  moved onto a line, the line takes', ids(S.moveSiblings(pool, pool[7], 7, 'women')), ['K']);
check('  and never itself', ids(S.moveSiblings(pool, pool[3], null, 'men')), ['F']);
check('rows from before the column, with no section at all, still count for a run-through',
  ids(S.moveSiblings([rt('A', 'general'), { id: 'Z', name: 'Z', line_id: null, storage_path: 'practice-recordings/s1/general__2.webm' }], rt('Q', 'women'), null, 'general')), ['A', 'Z']);

console.log('\nwhat the save refuses is what the clamp refuses');
check('a span exactly a breath long is not too short', S.short(4.8, 5.1), false);
check('  nor the span the clamp itself made from a handle dropped onto the other',
  (c => S.short(c.start, c.end))(S.clamp(5.1, 5.0, 30, 'start')), false);
check('  but a fifth of a second is', S.short(1, 1.2), true);
check('the readout carries tenths into minutes', [S.fmt(59.96), S.fmt(119.97), S.fmt(60)], ['1:00.0', '2:00.0', '1:00.0']);

console.log('\nthe line offered after a span is saved');
// Two parts over four moments: the melody alone, both, the 2nd part alone, both.
const vr = (id, part, so) => ({ id: id, part: part, text: 'w' + id, sortOrder: so, section: 'Verse 1' });
const score = [vr(1, 'Melody', 0), vr(2, 'Melody', 1), vr(3, '2nd Part', 1), vr(4, '2nd Part', 2), vr(5, 'Melody', 3), vr(6, '2nd Part', 3)];
check('the next moment, this part\'s line of it', S.nextTarget(score, 1), 2);
check('  not the other part of the same words -- the span has moved on', S.nextTarget(score, 2), 4);
check('  this part\'s line when both parts sing the next moment', S.nextTarget(score, 4), 6);
check('  nothing after the last', S.nextTarget(score, 6), null);
check('  nothing for a line that is not there', S.nextTarget(score, 99), null);

console.log('\nwhich names a move gives again');
check('the app\'s own names', [S.autoName('Melody take 2'), S.autoName('Run-through 1'), S.autoName(''), S.autoName('Recording')], [true, true, true, true]);
check('  not one a person typed or imported', [S.autoName('Sunday rehearsal'), S.autoName('chorus-alto-take3')], [false, false]);

const failed = results.filter(r => !r).length;
console.log('\n' + (failed ? failed + ' of ' + results.length + ' checks FAILED' : 'All ' + results.length + ' checks passed.'));
process.exit(failed ? 1 : 0);
