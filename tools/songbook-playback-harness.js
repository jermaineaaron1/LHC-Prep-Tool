'use strict';
// Harness for hearing takes in the Songbook, and for finding Draw and
// knowing who is drawing.
//
// WHY THIS EXISTS
// From the Caroling book (2026-11-05):
//   - The badge that opens a line's or a moment's takes was a list icon and
//     a number, and nobody took it for a play button. It says Playback now,
//     with a play mark and the count.
//   - A take could only be played from its start. Each take in the list has
//     a timeline: it moves as the take plays, and dragged, the take plays
//     from there.
//   - Draw sat beside Layers looking just like it. It is filled now.
//   - "How does it know who I am, and what I play?" The Layers sheet and the
//     name sheet say: a name and parts kept on this device; nobody signs in.
//
// USAGE
//   node tools/songbook-playback-harness.js                 # ../Index.html
//   node tools/songbook-playback-harness.js path/to/file.html
//   node tools/songbook-playback-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show d6cd8cb:Index.html > x`).
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

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}

console.log('Playback');
const badge = /'<i class="fa-solid fa-play" aria-hidden="true"><\/i><span class="vl-rec-lbl">Playback<\/span><span class="vl-rec-n">0<\/span><\/button>' \+/g;
check('every line\'s and every moment\'s takes badge says Playback, with a play mark and the count',
  (SRC.match(badge) || []).length === 2 && !has(/fa-list-ul" aria-hidden="true"><\/i><span class="vl-rec-n">/));
check('...on a phone\'s score lines, the mark and the count; the count filled once there is a take',
  has(/#sbmRoot:not\(\.sbm--wide\) \.sbm-score \.vl-rec-lbl \{ display: none; \}/) && has(/#sbmRoot \.vl-rec-list\.has-takes \.vl-rec-n \{ background: #0f766e; color: #fff; \}/));

console.log('\nA take\'s timeline');
check('each take in the list has one, as long as the take',
  has(/var len = \(au && au\.duration && isFinite\(au\.duration\)\) \? au\.duration : \(Number\(t\.duration_sec\) \|\| 0\);/) &&
  has(/<input type="range" class="vl-pop-range" min="0" max="' \+ len\.toFixed\(2\) \+ '"/) && has(/'<\/div>' \+ seek \+ '<\/div>' \+/));
check('...dragged, the take playing moves there; let go on another, it starts there',
  has(/el\.addEventListener\('input', function\(e\) \{\r?\n\s*var r = rangeOf\(e\); if \(!r\) return;\r?\n\s*R\._seeking = true;/) &&
  has(/R\.play\(R\._list\.root, r\.getAttribute\('data-rec-id'\), r\.getAttribute\('data-rec-path'\), v\);/) &&
  has(/play: function\(root, id, path, from\) \{/) && has(/try \{ au\.currentTime = start; \} catch \(e\) \{\}/));
check('...and it moves as the take plays, without redrawing the list or fighting a finger',
  has(/au\.ontimeupdate = function\(\) \{ if \(R\._audio === au\) R\._tickList\(\); \};/) &&
  has(/if \(!L \|\| !a \|\| R\._seeking\) return;/));
// The filled part and the time beside it, run.
const m = SRC.match(/  _paintSeek: function\(r, v\) \{[^]*?\n  \},/);
if (m) {
  const P = new Function('window', 'return {' + m[0].replace(/,\s*$/, '') + ', _dur: function(s) { s = Math.round(s || 0); return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); } };');
  const W = {}; W.lhcVoiceRec = P(W);
  const lbl = { textContent: '' }, props = {};
  const r = { max: '18', style: { setProperty: (k, v) => { props[k] = v; } }, parentNode: { querySelector: () => lbl } };
  W.lhcVoiceRec._paintSeek(r, 9);
  check('...its filled part and its time say where it is', props['--vl-at'] === '50.0%' && lbl.textContent === '0:09 / 0:18', JSON.stringify([props, lbl.textContent]));
} else check('...the timeline is painted by a function of its own', false);

console.log('\nDraw, and who is drawing');
check('Draw is filled, so it is not taken for Layers beside it',
  has(/class="sbm-chip sbm-chip--draw sbm-chip--pen' \+ \(_sbmDraw \? ' is-on' : ''\) \+ '"/) &&
  has(/#sbmRoot \.sbm-chip--pen \{ background: linear-gradient\(135deg, #7c3aed, #a855f7\);/));
check('Layers says how the app knows who you are, whether or not it has a name for you yet',
  (SRC.match(/\+\r?\n\s*_sbmWhoNote\(\);/g) || []).length === 2 && has(/How does it know who I am\?/) &&
  has(/Nobody signs in\. The first time someone draws on this phone or computer/));
check('...and "Not Aaron?" says what it does', has(/\? Change the name<\/button><\/div>' \+/));
check('the name sheet says the name stays on this device', has(/Kept on this device only \\u2014 nobody signs in\./));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
