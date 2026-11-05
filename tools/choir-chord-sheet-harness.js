'use strict';
// Harness for the Songbook's Choir view drawn as a chord sheet.
//
// WHY THIS EXISTS
// From the Caroling book (2026-11-05): the choir score was a stack of boxed
// systems -- a dark rule under every moment, a band behind every part, a
// chip on every line, an empty chord row over every unison line -- and
// read as clunky beside Chords + Lyrics. It is drawn like Chords + Lyrics
// now, with the parts written in:
//   - a part's label is said where that part takes over, and again at each
//     section; the lines after it are marked vl-ln--same and the reading
//     view hides the label there;
//   - a moment's chords sit straight over the words they are played
//     against (the lead line), not over a part resting above them;
//   - a line with no words -- like a rest -- has no Playback and no
//     microphone;
//   - parts singing at once (two lanes or more with words) are marked and
//     drawn on a purple bar; parts taking turns stay plain (added the same
//     day: in a chord sheet the labels alone read the same either way);
//   - no rules or bands between moments, the words and chords in Chords +
//     Lyrics' face, weight and size; a phone runs the label in at the start
//     of its line so a unison verse uses the full width.
//
// USAGE
//   node tools/choir-chord-sheet-harness.js                 # ../Index.html
//   node tools/choir-chord-sheet-harness.js path/to/file.html
//   node tools/choir-chord-sheet-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 594fc33:Index.html > x`).
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
const lines = SRC.split('\n');
const has = re => re.test(SRC);

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}

// The real module, sliced out of the page.
const vStart = lines.findIndex(l => /^window\.lhcVoiceLines = \{/.test(l));
const vEnd = vStart < 0 ? -1 : lines.findIndex((l, i) => i > vStart && l.replace(/\r$/, '') === '};');
if (vStart < 0 || vEnd < 0) { console.error('lhcVoiceLines not found'); process.exit(1); }
const V = new Function('var window = {};\n' + lines.slice(vStart, vEnd + 1).map(l => l.replace(/\r$/, '')).join('\n') + '\nreturn window.lhcVoiceLines;')();

let id = 0;
const row = (part, text, sortOrder, section, extra) => Object.assign({ id: ++id, part, text, sortOrder, section, barStart: null, barEnd: null, sustained: false }, extra || {});
const rowsOf = html => (html.match(/<div class="vl-ln [^"]*"[^>]*>/g) || []).map(tag => ({
  part: (/data-part="([^"]*)"/.exec(tag) || /data-rest-part="([^"]*)"/.exec(tag) || [])[1],
  same: / vl-ln--same/.test(tag), rest: / vl-ln--rest/.test(tag), cls: (/class="([^"]*)"/.exec(tag) || [])[1]
}));

console.log('A part\'s label, where that part takes over');
const unison = V.html([
  row('both', 'It came upon a midnight clear', 0, 'Verse 1'),
  row('both', 'That glorious song of old', 1, 'Verse 1'),
  row('both', 'From angels bending near the earth', 2, 'Verse 1'),
  row('both', 'Still through the cloven skies they come', 3, 'Verse 2'),
  row('both', 'With peaceful wings unfurled', 4, 'Verse 2')
], { record: true });
const u = rowsOf(unison);
check('a unison verse says All on its first line and leaves the rest to it', u.length === 5 && !u[0].same && u[1].same && u[2].same, JSON.stringify(u));
check('...and says it again where the next section starts', !u[3].same && u[4].same, JSON.stringify(u));
check('...the mark comes after the part\'s own class, which other code reads', u[1].cls === 'vl-ln vl-ln--both vl-ln--same', u[1].cls);
const two = rowsOf(V.html([
  row('both', 'Said the night wind to the little lamb', 0, 'Verse 1'),
  row('men', 'Do you see what I see', 1, 'Verse 1'),
  row('women', 'Do you see what I see', 2, 'Verse 1'),
  row('both', 'Way up in the sky', 3, 'Verse 1'),
  row('both', 'little lamb', 4, 'Verse 1')
], {}));
check('parts that answer each other are each named on every line', two.map(r => r.part + (r.same ? '=' : '')).join(' ') === 'both women men women men both both=',
  two.map(r => r.part + (r.same ? '=' : '')).join(' '));
const gapped = rowsOf(V.html([row('both', 'one', 0, 'A', { barStart: 1, barEnd: 2 }), row('both', 'two', 1, 'A', { barStart: 5, barEnd: 6 })], {}));
check('...and after the whole choir rests', gapped.length === 2 && !gapped[1].same, JSON.stringify(gapped));

console.log('\nNothing to sing, nothing to record');
const recOf = (text, extra) => /vl-rec-btn/.test(V.html([row('women', text, 0, 'A', extra)], { record: true }));
check('a line with words has its Playback and microphone', recOf('Do you see what I see') && recOf('oh......', { sustained: true }));
check('...a line left empty, or a dash, has neither', !recOf('') && !recOf('   ') && !recOf('-') && !recOf('(—)'));
const restHtml = V.html([row('men', 'A star a star', 0, 'A')], { record: true });
check('...nor does a part resting while another sings', rowsOf(restHtml).some(r => r.rest) && (restHtml.match(/vl-rec-btn/g) || []).length === 1, restHtml);

console.log('\nChords over the words they are played against');
const isChord = l => /^[\sA-G#bm7]+$/.test(l) && /[A-G]/.test(l);
const lyrics = '[Verse 1]\nSaid the night wind to the little lamb\nC          F\nDo you see what I see\nC          F\nDo you see what I see too';
const opts = { chords: V.chordIndex(lyrics, isChord), chordEdit: true };
const h = V.html([
  row('both', 'Said the night wind to the little lamb', 0, 'Verse 1'),
  row('men', 'Do you see what I see', 1, 'Verse 1'),
  row('women', 'Do you see what I see too', 2, 'Verse 1')
], opts);
const sys = h.split(/<div class="vl-sys[ "]/).slice(1);
const order = s => (s.match(/vl-chords(?=[ "])|data-part="[^"]+"|data-rest-part="[^"]+"/g) || []).map(t => t.replace(/data-(rest-)?part="|"/g, ''));
check('the men singing, the women resting: the chords sit between them, over the men\'s words', JSON.stringify(order(sys[1])) === JSON.stringify(['women', 'vl-chords', 'men']), JSON.stringify(order(sys[1])));
check('...the women singing, the chords over the women\'s', JSON.stringify(order(sys[2])) === JSON.stringify(['vl-chords', 'women', 'men']), JSON.stringify(order(sys[2])));
check('...a unison line\'s over it, as before', JSON.stringify(order(sys[0])) === JSON.stringify(['vl-chords', 'both']), JSON.stringify(order(sys[0])));
const held = V.html([row('women', 'oh', 0, 'Verse 1', { sustained: true }), row('men', 'ah', 0, 'Verse 1', { sustained: true })], opts);
check('...a moment of held notes, with no lead line, opens with its chords', /^<div class="vl-score"><div class="vl-section">Verse 1<\/div><div class="vl-sys[^>]*><span class="vl-no"[^]*?<\/span><\/span><div class="vl-sys-lines"><div class="vl-chords/.test(held), held.slice(0, 300));

console.log('\nParts singing at once, against parts taking turns');
const sysOf = list => (V.html(list, {}).match(/<div class="vl-sys(?: [^"]*)?"/g) || []).map(t => / vl-sys--together/.test(t));
check('both parts with words in one moment: marked as sung at once',
  JSON.stringify(sysOf([row('women', 'child a child', 0, 'A'), row('men', 'A child a child', 0, 'A')])) === '[true]');
check('...a part holding a note while the other sings counts too',
  JSON.stringify(sysOf([row('women', 'oh......', 0, 'A', { sustained: true }), row('men', 'A star a star', 0, 'A')])) === '[true]');
check('...one part singing while the other rests is a turn, and is not',
  JSON.stringify(sysOf([row('men', 'Do you know what I know', 0, 'A'), row('women', 'Do you know what I know?', 1, 'A')])) === '[false,false]');
check('...nor is a line everybody sings', JSON.stringify(sysOf([row('both', 'Said the shepherd boy', 0, 'A')])) === '[false]');
check('...nor a part whose line has no words', JSON.stringify(sysOf([row('women', '-', 0, 'A'), row('men', 'A star a star', 0, 'A')])) === '[false]');
check('the reading view joins them with a bar on a soft panel, keeping the bar\'s room on every moment',
  has(/#sbmRoot \.sbm-score \.vl-score \.vl-sys-lines \{ position: relative; padding-left: 12px; \}/) &&
  has(/#sbmRoot \.sbm-score \.vl-score \.vl-sys--together > \.vl-sys-lines \{ background: rgba\(124, 58, 237, 0\.06\);/) &&
  has(/#sbmRoot \.sbm-score \.vl-score \.vl-sys--together > \.vl-sys-lines::before \{ content: ""; position: absolute;/));
check('...and says what the bar means above the score, when the song has one',
  has(/function _sbmTogetherKey\(score\) \{\r?\n\s*if \(!score \|\| score\.indexOf\('vl-sys--together'\) < 0\) return '';/) &&
  has(/Sing together: the parts on a purple bar sing at the same time/) && has(/_sbmTogetherKey\(score\) \+\r?\n\s*'<div class="sbm-score sb-song-page--choir" id="sbChoirPage-'/));
check('...and each such moment carries a "Sing together" badge on its top edge, with room kept for it',
  has(/\.vl-sys--together > \.vl-sys-lines::after \{\r?\n\s*content: "Sing together"; position: absolute; top: -8px;/) &&
  has(/#sbmRoot \.sbm-score \.vl-score \.vl-sys--together \{ margin-top: 16px; \}/));
// Edit Parts says the same, on the box, while it is being typed.
const edSrc = (() => { const m = SRC.match(/  function _sbmEdTogether\(m\) \{[^]*?\n  \}/); return m ? m[0] : ''; })();
if (edSrc) {
  const edTogether = new Function('window', '_sbmEdPartKey', edSrc + '\nreturn _sbmEdTogether;')({ lhcVoiceLines: V }, p => String(p || '').toLowerCase());
  const box = lines => ({ lines: lines.map(([part, text]) => ({ part, text })) });
  check('Edit Parts marks a box whose parts both have words as singing together',
    edTogether(box([['women', 'child a child'], ['men', 'A child a child']])) === true &&
    edTogether(box([['women', 'Do you see'], ['men', '']])) === false && edTogether(box([['both', 'Said the night wind']])) === false);
} else check('Edit Parts marks a box whose parts both have words as singing together', false);
check('...and marks it again as words are typed, without redrawing the editor',
  has(/f\.line\.text = value; _sbmEdTouch\(\); _sbmEdPreviewSoon\(\); _sbmEdTogetherMark\(f\.m\);/) &&
  has(/'<div class="sbm-ed__moment' \+ \(_sbmEdTogether\(m\) \? ' is-together' : ''\) \+ [^\n]*?'" data-moment="'/));
check('...and every box but an all-sing one shows its way to add a part singing with it',
  has(/\? '' : ' sbm-ed__here'\) \+ '" onclick="WO\.sbmEdAddPart\(/) && has(/<span>Part singing with this<\/span>/) &&
  has(/#sbmEdit:not\(\.is-reorder\) \.sbm-ed__mbtns > :not\(\.sbm-ed__here\):not\(\.sbm-ed__tick\) \{ display: none; \}/));

console.log('\nEdit Parts: tick boxes, then Sing together or Take turns');
const fnSrc = name => { const m = SRC.match(new RegExp('  function ' + name + '\\(m(?:oments)?\\) \\{[^]*?\\n  \\}')); return m ? m[0] : ''; };
const joinSrc = fnSrc('_sbmEdJoin'), splitSrc = fnSrc('_sbmEdSplit');
if (joinSrc && splitSrc) {
  let n = 0;
  const T = new Function('_sbmEdPartKey', '_sbmEdId', joinSrc + '\n' + splitSrc + '\nreturn { join: _sbmEdJoin, split: _sbmEdSplit };')(p => String(p || '').toLowerCase(), () => 'new' + (++n));
  const box = (id, ...ps) => ({ id, lines: ps.map(p => ({ part: p, text: p + ' words' })) });
  const shape = list => list.map(m => m.id + ':' + m.lines.map(l => l.part).join('+')).join(' | ');
  check('ticked turns join two by two: men with women, women with men',
    shape(T.join([box('a', 'men'), box('b', 'women'), box('c', 'men'), box('d', 'women')])) === 'a:men+women | c:men+women',
    shape(T.join([box('a', 'men'), box('b', 'women'), box('c', 'men'), box('d', 'women')])));
  check('...a line everyone sings stays on its own, and the run carries on after it',
    shape(T.join([box('a', 'men'), box('b', 'women'), box('c', 'both'), box('d', 'men'), box('e', 'women')])) === 'a:men+women | c:both | d:men+women');
  check('...a part is never asked to sing twice at once',
    shape(T.join([box('a', 'women'), box('b', 'women')])) === 'a:women | b:women');
  check('...and a box already sung together is never pulled apart to make another pair',
    shape(T.join([box('a', 'women'), box('b', 'men', 'women')])) === 'a:women | b:men+women');
  check('Take turns gives each part a box of its own, the first keeping the box',
    shape(T.split(box('a', 'women', 'men'))) === 'a:women | new1:men' && shape(T.split(box('z', 'men'))) === 'z:men');
} else check('the join and split are functions of their own', false);
check('every box has its tick, outside Reorder too, and the bar shows once one is ticked',
  has(/'<label class="sbm-ed__tick"><input type="checkbox"' \+ \(ed\.sel && ed\.sel\[m\.id\] \? ' checked' : ''\) \+ ' onchange="WO\.sbmEdTick\(/) &&
  has(/#sbmEdit:not\(\.is-reorder\) \.sbm-ed__mbtns > :not\(\.sbm-ed__here\):not\(\.sbm-ed__tick\) \{ display: none; \}/) &&
  (SRC.match(/'<div class="sbm-ed__selbar" id="sbmEdSel"><\/div>' \+/g) || []).length === 2 &&
  has(/onclick="WO\.sbmEdSingTogether\(\)"' \+ \(n < 2 \? ' disabled/));
check('...joining asks for boxes next to each other in one section, says why it cannot, and can be undone',
  has(/if \(picked\.some\(function\(p, i\) \{ return p\.sec !== sec \|\| p\.mi !== at \+ i; \}\)\) \{/) &&
  has(/These cannot sing at the same time: a part sings once in a moment, and All sings on its own/) &&
  (SRC.match(/\{ action: 'Undo', onAction: _sbmEdUndoTo\(ed, snap\) \}/g) || []).length === 2 &&
  has(/sbmEdTick: sbmEdTick, sbmEdTickClear: sbmEdTickClear, sbmEdSingTogether: sbmEdSingTogether, sbmEdTakeTurns: sbmEdTakeTurns,/));
check('...the phone\'s bar spans the row above Cancel and Save', has(/\.sbm-ed__sticky \.sbm-ed__selbar\.is-on \{ grid-column: 1 \/ -1; \}/));

console.log('\nThe reading view draws it as a chord sheet');
check('no rule under a moment, no brace beside it, no band behind a part',
  has(/#sbmRoot \.sbm-score \.vl-score \.vl-sys \{ padding: 0; margin: 0 0 10px; border: 0; \}/) &&
  has(/#sbmRoot \.sbm-score \.vl-score \.vl-sys-lines \{ border-left: 0; padding-left: 0; gap: 0; \}/) &&
  has(/#sbmRoot \.sbm-score \.vl-score \.vl-ln \{ padding: 1px 4px; row-gap: 0; background: transparent; \}/));
check('the words and chords in Chords + Lyrics\' size and weight, the chords in its colour',
  has(/#sbmRoot \.sbm-score \.vl-score \{\r?\n\s*--vl-text: calc\(18px \* var\(--sbm-lyrics-scale, 1\)\);/) &&
  has(/#sbmRoot \.sbm-score \.vl-score \.vl-words \{ font-weight: 700; \}/) &&
  has(/#sbmRoot \.sbm-score \.vl-score \.vl-chord-text \{ font-family: var\(--vl-mono\); font-size: var\(--vl-text\); font-weight: 700; line-height: 1\.3; color: #04756f; \}/) &&
  has(/#sbmRoot\.sbm--wide \.sbm-score \.vl-score \.vl-words \{ font-family: var\(--vl-mono\);/));
check('a moment with no chords has no chord line', has(/#sbmRoot \.sbm-score \.vl-score \.vl-chords--empty \{ height: 0; overflow: visible; align-items: flex-end; \}/));
check('a repeated label: hidden in its column on a desk, gone on a phone, its words from the edge',
  has(/#sbmRoot \.sbm-score \.vl-score \.vl-ln--same > \.vl-who \{ visibility: hidden; \}/) &&
  has(/#sbmRoot:not\(\.sbm--wide\) \.sbm-score \.vl-score \.vl-ln--same > \.vl-who \{ display: none; \}/) &&
  has(/#sbmRoot:not\(\.sbm--wide\) \.sbm-score \.vl-score \.vl-ln > \.vl-who \{\r?\n\s*float: left;/));
check('...and the rows-alike pass ignores a label that is not shown', has(/if \(!wr\.height\) continue;   \/\/ nor a line whose label is not shown \(vl-ln--same\)/));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
