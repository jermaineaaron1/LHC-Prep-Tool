'use strict';
// Regression harness for two-part (Women / Men) songs.
//
// WHY THIS EXISTS
// A two-part arrangement is the one kind of song where a rendering bug is
// silent and serious at the same time. Every failure mode here produces a
// page that still looks like a song:
//
//   - drop the rest cell for a resting part, and the OTHER part's words slide
//     into its lane. The page still reads; it just tells the women to sing
//     the men's line.
//   - pair rows by bar number instead of sortOrder, and two passages that
//     happen to share a bar range merge into one.
//   - lose a row in the flat rendering, and a verse quietly goes missing from
//     everything downstream -- projection, the PDF, search, WhatsApp -- while
//     the two-lane view on screen still shows it.
//
// None of those throw. None of them log. The person who finds out is a
// caroler holding the wrong line on the night.
//
// HOW IT WORKS
// It reimplements nothing. It slices the real window.lhcVoiceLines out of
// Index.html and runs it, against synthetic rows for the edge cases and
// against the actual transcription of the 2025 caroling arrangement for the
// whole-song invariants.
//
// USAGE
//   node tools/voice-lines-harness.js
//   node tools/voice-lines-harness.js path/to/file.html
//   node tools/voice-lines-harness.js <file> --expect-broken
//
// --expect-broken is the negative control: it asserts the module is ABSENT,
// and is meant to be pointed at source from before any of this existed.
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) ||
              path.join(__dirname, '..', 'Index.html');

if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }

const raw = fs.readFileSync(INDEX, 'utf8');
const nl = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(nl);

const OPEN = /^window\.lhcVoiceLines = \{/;
const start = lines.findIndex(l => OPEN.test(l));

if (EXPECT_BROKEN) {
  if (start < 0) {
    console.log('--expect-broken: window.lhcVoiceLines is absent, as expected.');
    process.exit(0);
  }
  console.log('\nBUT --expect-broken was given and the module is present.');
  process.exit(1);
}

if (start < 0) {
  console.error('not found in ' + path.basename(INDEX) + ': window.lhcVoiceLines' +
    '\n(renamed? fix the anchor rather than deleting the test)');
  process.exit(1);
}

const end = lines.findIndex((l, i) => i > start && l === '};');
if (end < 0) { console.error('no close for window.lhcVoiceLines'); process.exit(1); }
// A ceiling, because an end-anchor matching far away would swallow the file
// and still parse. 400 rather than 200 since the editor's round trip moved
// in; it is a tripwire against a runaway match, not a budget for the module.
if (end - start > 820) {
  console.error('window.lhcVoiceLines: span of ' + (end - start) + ' lines looks wrong');
  process.exit(1);
}

const W = new Function(
  'var window = {};\n' +
  lines.slice(start, end + 1).join('\n') +
  '\nreturn window;'
)();
const V = W.lhcVoiceLines;

const results = [];
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(ok);
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n          got ' + JSON.stringify(actual) +
               ', want ' + JSON.stringify(expected)));
}

function row(part, text, sortOrder, extra) {
  return Object.assign({ part: part, text: text, sortOrder: sortOrder,
                         barStart: null, barEnd: null, section: '' }, extra || {});
}

// The order the parts appear in the markup, which in a stacked layout IS
// the order they appear on the page. Women above men, always, present or
// not -- a reader who has learnt that the upper line is theirs must never
// find the other part there because one of them happened to be resting.
function laneOrder(html) {
  return (html.match(/vl-ln vl-ln--(women|men|both)/g) || [])
    .map(s => s.replace('vl-ln vl-ln--', ''));
}

// ---------------------------------------------------------------------------
console.log('\npairing rows into display groups');
check('two rows sharing a sortOrder become one group',
  V.group([row('women', 'a', 0), row('men', 'b', 0)]).length, 1);
check('two different sortOrders stay two groups',
  V.group([row('women', 'a', 0), row('men', 'b', 1)]).length, 2);
check('a unison row sits alone in its group',
  V.group([row('both', 'a', 0)]).map(g => [!!g.both, !!g.women, !!g.men]), [[true, false, false]]);
// A rest is the ABSENCE of a row, so the lane it belongs to must come back
// null -- not missing, not undefined-and-skipped.
check('a part with no row rests, and the group says so',
  V.group([row('men', 'b', 0)]).map(g => [g.women, !!g.men]), [[null, true]]);
check('rows arrive in sortOrder however they were handed over',
  V.group([row('men', 'c', 2), row('women', 'a', 0), row('men', 'b', 1)])
    .map(g => g.sortOrder), [0, 1, 2]);
check('a part value that is not one of the three is dropped',
  V.group([row('alto', 'x', 0), row('women', 'a', 0)]).map(g => [!!g.women, !!g.men, !!g.both]),
  [[true, false, false]]);
check('an empty list makes no groups', V.group([]).length, 0);
check('null survives being handed nothing at all', V.group(null).length, 0);
// Bars and section are carried up from whichever row in the group has them.
check('the group takes its bars from its rows',
  V.group([row('women', 'a', 0, { barStart: null }), row('men', 'b', 0, { barStart: 4, barEnd: 6 })])
    .map(g => [g.barStart, g.barEnd]), [[4, 6]]);

console.log('\nbar labels');
check('a single bar', V.barLabel(7, 7), '7');
check('a range', V.barLabel(11, 13), '11–13');
check('an open end', V.barLabel(11, null), '11');
check('no bars at all', V.barLabel(null, null), '');

console.log('\nbars where neither part sings');
check('two bars of silence are counted',
  V.gapBefore({ barEnd: 45 }, { barStart: 48 }), 2);
check('consecutive groups have no gap',
  V.gapBefore({ barEnd: 45 }, { barStart: 46 }), 0);
check('an overlap is not a negative gap',
  V.gapBefore({ barEnd: 45 }, { barStart: 44 }), 0);
check('a song without bar numbers never reports a gap',
  V.gapBefore({ barEnd: null }, { barStart: null }), 0);

console.log('\nthe song\'s own words, offered when a song is first created');
// A song with choir parts is an ORDINARY song. Nothing generates its lyrics
// column after it exists -- this only produces a starting point, and it has
// to read as lyrics, not as choir notation.
check('a unison line is just the line',
  V.toPlainLyrics([row('both', 'Silent night', 0)]), 'Silent night');
check('no part prefix reaches the song\'s words',
  /[WM]:/.test(V.toPlainLyrics([row('women', 'Oh', 0), row('men', 'dancing', 0)])), false);
// The upper part generally carries the melody, and it is also the line
// without the two engraving typos in this carol.
check('where the parts split the women carry the lyric',
  V.toPlainLyrics([row('women', 'good-ness', 0), row('men', 'good-nes', 0)]), 'good-ness');
check('a part holding a vowel is not singing words',
  V.toPlainLyrics([row('women', 'oh……', 0, { sustained: true }),
                   row('men', 'A star a star', 0)]), 'A star a star');
check('both parts holding a vowel contribute nothing',
  V.toPlainLyrics([row('women', 'oh', 0, { sustained: true }),
                   row('men', 'ah', 0, { sustained: true })]), '');
// The two parts answering each other a bar apart is ONE line of the song.
check('an echo a bar later is not a second line',
  V.toPlainLyrics([row('men', 'Do you see what I see', 0),
                   row('women', 'Do you see what I see', 1)]), 'Do you see what I see');
check('but a genuine repeat survives',
  V.toPlainLyrics([row('both', 'a', 0), row('both', 'b', 1), row('both', 'a', 2)]), 'a\nb\na');
check('a mid-dot splits one row into two lines',
  V.toPlainLyrics([row('both', 'shi-vers in the cold · let us bring gold', 0)]),
  'shi-vers in the cold\nlet us bring gold');
check('sections become headers',
  V.toPlainLyrics([row('both', 'a', 0, { section: 'Verse 1' }),
                   row('both', 'b', 1, { section: 'Verse 1' }),
                   row('both', 'c', 2, { section: 'Verse 2' })]),
  '[Verse 1]\na\nb\n\n[Verse 2]\nc');
check('no leading blank line before the first header',
  V.toPlainLyrics([row('both', 'a', 0, { section: 'Verse 1' })]).startsWith('['), true);
// A repeat across a section boundary is a real repeat, not an echo.
check('the duplicate check restarts at each section',
  V.toPlainLyrics([row('both', 'a', 0, { section: 'Verse 1' }),
                   row('both', 'a', 1, { section: 'Verse 2' })]),
  '[Verse 1]\na\n\n[Verse 2]\na');

console.log('\nstacking the parts the way a score stacks staves');
const splitHtml = V.html([row('women', 'Oh', 0), row('men', 'dancing', 0)]);
check('a split group stacks women over men', laneOrder(splitHtml), ['women', 'men']);
check('  and is braced as one system', /vl-sys(?!--unison)/.test(splitHtml), true);
const unisonHtml = V.html([row('both', 'Silent night', 0)]);
check('a unison group is one line, not two', laneOrder(unisonHtml), ['both']);
check('  and is marked unison', /vl-sys--unison/.test(unisonHtml), true);
// Rows handed over in the other order must still come out women-first: the
// database returns them ordered by part, but nothing guarantees a caller does.
check('the stack order does not follow the input order',
  laneOrder(V.html([row('men', 'b', 0), row('women', 'a', 0)])), ['women', 'men']);

// THE invariant, and in a stacked layout it is sharper than it was in
// columns: drop the resting line and the OTHER part moves up into the slot
// the reader has learnt is theirs, on a page that still looks normal.
const womenRest = V.html([row('men', 'Do you see what I see', 0)]);
check('a resting part keeps its place in the stack', laneOrder(womenRest), ['women', 'men']);
check('  and is drawn as a rest', /vl-ln--women vl-ln--rest/.test(womenRest), true);
check('  while the singing part is not', /vl-ln--men vl-ln--rest/.test(womenRest), false);
const menRest = V.html([row('women', 'Do you see what I see', 0)]);
check('the same the other way round', laneOrder(menRest), ['women', 'men']);
check('  with the rest on the men', /vl-ln--men vl-ln--rest/.test(menRest), true);

check('a gap in the bars is announced',
  /2 bars — both parts rest/.test(
    V.html([row('both', 'a', 0, { barStart: 44, barEnd: 45 }),
            row('both', 'b', 1, { barStart: 48, barEnd: 50 })])), true);
check('one bar of silence is singular',
  /1 bar — both parts rest/.test(
    V.html([row('both', 'a', 0, { barStart: 44, barEnd: 45 }),
            row('both', 'b', 1, { barStart: 47, barEnd: 48 })])), true);

check('a held vowel is marked as one',
  /vl-ln--hold/.test(V.html([row('women', 'Oh……', 0, { sustained: true })])), true);
check('an ordinary line is not',
  /vl-ln--hold/.test(V.html([row('women', 'Oh', 0)])), false);

console.log('\nevery line starts at the same x');
// What replaced leadIn. It measured how far into the other part's line
// this one began and indented it to sit under the words it shared, which
// on a page read top to bottom produced exactly the ragged left margin it
// was then asked to remove: "align all the sections properly straight,
// orientate it to the left." So the check is that nothing indents anything.
check('the lead-in indent is gone from the module', typeof V.leadIn, 'undefined');
// The case that used to be indented hardest: the men joining the women's
// phrase partway through. Both now begin at the margin, and the grouping
// is what says they sound together.
const joinHtml = V.html([
  row('women', 'With a tail as big as a kite', 0),
  row('men', 'tail as big as a kite', 0)
]);
check('a part joining mid-phrase is not pushed right', /vl-lead/.test(joinHtml), false);
check('  and both parts are still shown', laneOrder(joinHtml), ['women', 'men']);

console.log('\nparts the choir named themselves');
// Asked for directly: "if I want to add Women 1 or Women 2, I just want to
// type it in [ ] to make my own section with whatever name I want."
const named = V.parseVoiceText(
  '[Verse 1]\n[Women 1] Do you see what I see\n[Women 2] Do you see what I see\nM: A star a star');
check('a bracket WITH words after it names a part',
  named.map(r => r.part), ['Women 1', 'Women 2', 'men']);
check('  a bracket ALONE is still a section', named.map(r => r.section),
  ['Verse 1', 'Verse 1', 'Verse 1']);
check('  and all three sound at the same moment',
  named.map(r => r.sortOrder), [0, 0, 0]);
check('typing [Women] is the same lane as W:, not a second one',
  V.parseVoiceText('[Women] a').map(r => r.part), ['women']);
check('  and [All] is the unison lane', V.parseVoiceText('[All] a').map(r => r.part), ['both']);

// women is tested BEFORE men, because the word women contains men: get the
// order wrong and every Women 2 lane is painted in the men's colour.
check('a named part takes the colour family of its name',
  ['Women 1', 'Men 2', 'Descant', 'both'].map(p => V.partFamily(p)),
  ['women', 'men', 'other', 'both']);
check('  and is labelled exactly as typed', V.partLabel('Women 1'), 'Women 1');

check('lanes stack women-family first, then men, then the rest',
  V.lanes(named), ['Women 1', 'Women 2', 'men']);
check('  a song using women or men gets BOTH lanes, one of them resting',
  V.lanes([row('men', 'a', 0)]), ['women', 'men']);
check('  but a song of named parts gets only what it named',
  V.lanes(V.parseVoiceText('[Descant] a\n[Solo] b')), ['Descant', 'Solo']);

const namedHtml = V.html(named);
check('a named part is drawn in the other family', /vl-ln--other/.test(namedHtml), false);
check('  Women 1 and Women 2 both read as women',
  (namedHtml.match(/vl-ln--women/g) || []).length, 2);
check('  and the chip shows the name the choir chose',
  />Women 1</.test(namedHtml), true);

// The round trip has to survive a name it has never seen.
check('a named part survives the editor round trip',
  V.parseVoiceText(V.toVoiceText(named)).map(r => [r.part, r.text]),
  named.map(r => [r.part, r.text]));

// These three checked that the late-joining part reserved the other's
// words as hidden padding. There is no padding now: the words of both
// parts begin at the same x, and the chip is a fixed width so the lyric
// column cannot be pushed about by the length of a label either.
const aligned = V.html([row('women', 'With a tail as big as a kite', 0),
                        row('men', 'tail as big as a kite', 0)]);
check('the late-joining part begins at the margin like the other',
  (aligned.match(/vl-lead/g) || []).length, 0);
check('  and its words are the only thing in its body',
  /<span class="vl-words">tail as big as a kite<\/span>/.test(aligned), true);
// Every row carries the part it belongs to, which is what the chip
// double-click reads to know which lane it is moving a line out of.
check('  and every line says which part it is',
  (aligned.match(/data-part="/g) || []).length, 2);

// The songbook prints the same markup through the same renderer, asking
// only for the tighter, control-free variant. Two renderers for one
// arrangement is how the page people sing from drifts away from the page
// they rehearsed with.
const printed = V.html([row('women', 'a', 0), row('men', 'b', 0)], { compact: true });
const screen = V.html([row('women', 'a', 0), row('men', 'b', 0)]);
check('the songbook asks for the compact variant', /vl-score--compact/.test(printed), true);
check('  and the screen does not', /vl-score--compact/.test(screen), false);
check('  but both draw the same systems and lines',
  [laneOrder(printed), (printed.match(/vl-sys/g) || []).length],
  [laneOrder(screen), (screen.match(/vl-sys/g) || []).length]);
// Microphones belong on the screen, never on a printed page.
check('the songbook page carries no recording controls',
  /vl-rec-btn/.test(printed), false);
check('  and the screen only carries them when asked',
  [/vl-rec-btn/.test(screen),
   /vl-rec-btn/.test(V.html([row('women', 'a', 0, { id: 7 })], { record: true }))],
  [false, true]);

// A row holding two phrases across several bars draws them as two lines
// rather than running them together behind a mid-dot.
const twoPhrase = V.html([row('both', 'shi-vers in the cold · let us bring gold', 0)]);
check('a two-phrase row draws two lines',
  (twoPhrase.match(/class="vl-words"/g) || []).length, 2);
check('  and the mid-dot itself is gone', /·/.test(twoPhrase), false);
check('the line id rides along for a recording to attach to',
  /data-line-id="42"/.test(V.html([row('women', 'a', 0, { id: 42 })])), true);

console.log('\nlyrics are text, not markup');
check('angle brackets are escaped',
  /&lt;b&gt;/.test(V.html([row('both', '<b>shout</b>', 0)])), true);
check('  and no tag survives',
  /<b>/.test(V.html([row('both', '<b>shout</b>', 0)])), false);
// data-line-id is the only attribute any of this data reaches. It holds a
// bigint today, so a quote in it is not a live risk -- but it is the one
// place a stray value would stop being text and start being markup.
check('a quote cannot break out of the line-id attribute',
  /data-line-id="1" onerror=/.test(
    V.html([row('women', 'a', 0, { id: '1" onerror="alert(1)' })])), false);
check('  the quote is escaped instead',
  V.html([row('women', 'a', 0, { id: '1" onerror="alert(1)' })])
    .indexOf('data-line-id="1&quot; onerror=&quot;alert(1)"') > -1, true);
check('a quote in a section name is escaped too',
  /class="vl-section">&quot; /.test(
    V.html([row('both', 'x', 0, { section: '" onerror' })])), true);
check('an ampersand is escaped once, not twice',
  V.html([row('both', 'bread & wine', 0)]).indexOf('bread &amp; wine') > -1, true);

// ---------------------------------------------------------------------------
// The real arrangement. These are whole-song invariants that no synthetic
// fixture would catch.
console.log('\nthe 2025 caroling arrangement, end to end');
const DOC = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'voice-lines', 'do-you-hear-what-i-hear.json'), 'utf8'));
const L = DOC.lines;
const groups = V.group(L);

check('46 rows become 35 display groups', [L.length, groups.length], [46, 35]);
check('every group holds something',
  groups.filter(g => !g.both && !g.women && !g.men).length, 0);
check('the four verses are in order',
  groups.map(g => g.section).filter((s, i, a) => s !== a[i - 1]),
  ['Verse 1', 'Verse 2', 'Verse 3', 'Verse 4']);

// Bars 46-47 are the two-bar rest before the final verse, and nothing is
// stored for them. Every OTHER bar of the 63 must be accounted for exactly
// once, or a passage has been lost or duplicated.
const covered = {};
groups.forEach(g => { for (let b = g.barStart; b <= g.barEnd; b++) covered[b] = (covered[b] || 0) + 1; });
const missing = [];
const doubled = [];
for (let b = 1; b <= 63; b++) {
  if (!covered[b]) missing.push(b);
  else if (covered[b] > 1) doubled.push(b);
}
check('bars 46-47 are the only ones nothing is stored for', missing, [46, 47]);
check('no bar is covered twice', doubled, []);
check('the arrangement runs to bar 63',
  Math.max.apply(null, groups.map(g => g.barEnd)), 63);

const splits = groups.filter(g => !g.both).length;
check('22 passages have the parts apart', splits, 22);
check('13 are unison', groups.filter(g => g.both).length, 13);

const html = V.html(L);
check('the page braces exactly 13 of them as unison',
  (html.match(/vl-sys--unison/g) || []).length, 13);
check('and draws a line for every part of every group, rests included',
  (html.match(/vl-ln vl-ln--/g) || []).length, splits * 2 + 13);
check('the two-bar rest is shown once',
  (html.match(/both parts rest/g) || []).length, 1);

// The men's two source typos are deliberate in the ARRANGEMENT. Silently
// "fixing" them would put words on the choir's page that the score does not
// have.
const arrangement = L.map(l => l.text).join('\n');
check("the men's printed typo at bar 58 is kept", arrangement.indexOf('good-nes and Light!') > -1, true);
check("the men's printed typo at bar 61 is kept", arrangement.indexOf('Bri-ing u-s') > -1, true);
check("the women's line has neither",
  arrangement.indexOf('He will bring us good-ness and Light!') > -1, true);

// The starting point offered for the song's own lyrics. It is NOT the
// arrangement flattened -- it drops the held vowels and the bar-later
// echoes, because those are how the choir sings the song, not what the song
// says.
const plain = V.toPlainLyrics(L);
check('the suggested lyrics carry all four section headers',
  (plain.match(/^\[Verse \d\]$/gm) || []).length, 4);
check('they are shorter than the arrangement, not a copy of it',
  plain.split('\n').filter(s => s.trim()).length < L.length, true);
check('no part prefix leaks into them', /^[WM]:/m.test(plain), false);
check('no held vowel is offered as a lyric', /oh…/i.test(plain), false);
check("and the men's typos do not reach the song's own words",
  /good-nes[^s]|Bri-ing/.test(plain), false);
check('the carol still opens the way it opens',
  plain.split('\n')[1], 'Said the night wind to the little lamb');
check('and still ends on Light!', plain.trim().split('\n').pop(), 'Light!');

// ---------------------------------------------------------------------------
console.log('\nthe label is the whole signal');
// The "Women and men in together" banners were struck off the design: the
// coloured ALL chip already says everyone sings here, and the banner said
// it a second time. These guard that the chip carries the weight alone.
check('a unison line is labelled ALL, not BOTH',
  />All</.test(V.html([row('both', 'a', 0)])), true);
check('  and nothing says BOTH any more',
  /Both/.test(V.html([row('both', 'a', 0)])), false);
check('the three labels are distinguishable by class',
  [/vl-ln--both/.test(V.html([row('both', 'a', 0)])),
   /vl-ln--women/.test(V.html([row('women', 'a', 0)])),
   /vl-ln--men/.test(V.html([row('men', 'a', 0)]))],
  [true, true, true]);
check('no banner survives anywhere',
  /in together|vl-together/.test(V.html(L)), false);

// The bar gutter came off the page: numbers down the left edge of every
// line, saying something only the editor needs.
check('the drawn score has no bar column', /vl-sys-bar/.test(V.html(L)), false);
check('  and no bar numbers in its text',
  /\b11–13\b/.test(V.html([row('women', 'Oh', 0, { barStart: 11, barEnd: 13 })])), false);
// Rows loaded from the database still carry bars...
check('loaded rows still carry their bars',
  V.group(L).slice(0, 2).map(g => [g.barStart, g.barEnd]), [[1, 3], [4, 4]]);
// ...but the EDITOR no longer shows or keeps them. Bars are displayed
// nowhere, so the column was a gutter of numbers to read past. Grouping
// moved to the blank line, which is the job the column's ABSENCE used to
// do. Saving therefore clears bars -- asserted here so it is a decision on
// the record rather than something noticed later as a bug.
check('the editor source carries no bar numbers',
  /^\s*\d+[\s–]/m.test(V.toVoiceText(L)), false);
check('  so a round trip clears them',
  V.parseVoiceText(V.toVoiceText(L)).every(r => r.barStart == null), true);
// A bar spec typed by hand is still honoured, so text saved under the old
// format still parses the way it was written.
check('a typed bar spec is still read',
  V.parseVoiceText('4  M: a').map(r => [r.barStart, r.barEnd]), [[4, 4]]);

// A silent part shows an empty bracket rather than a mark to decode. Most
// of these are echoes -- one part answering the other a bar later -- and a
// singer wants to see at a glance that the moment is not theirs.
const echo = V.html([row('men', 'Do you see what I see', 0)]);
check('a silent part shows a visible blank', /\(\u2014\)/.test(echo), true);
check('  on the part that is silent', /vl-ln--women vl-ln--rest/.test(echo), true);
check('  and it is hidden from a screen reader, which gets words',
  /aria-hidden="true">\(\u2014\)/.test(echo) && /silent here/.test(echo), true);
// Exactly one blank in a two-part system where one part sings: the other
// one. Two would mean the singing part lost its words.
check('  and there is exactly one blank, not two',
  (echo.match(/vl-blank/g) || []).length, 1);
check('  the singing part keeps its words',
  /Do you see what I see/.test(echo), true);

console.log('\nreading the editor source back');
const P = t => V.parseVoiceText(t).map(r =>
  [r.part, r.text, r.barStart, r.barEnd, r.section, r.sortOrder, r.sustained]);

check('bars then words is one unison line',
  P('1-3  Said the night wind'), [['both', 'Said the night wind', 1, 3, '', 0, false]]);
check('a single bar is its own range',
  P('4  M: Do you see'), [['men', 'Do you see', 4, 4, '', 0, false]]);
check('an en-dash range reads the same as a hyphen',
  P('11–13  W: Oh'), P('11-13  W: Oh'));
// This is the placement rule: no bars means "at the same moment as the line
// above". Break it and the two parts stop being simultaneous.
check('a line with no bars joins the group above it',
  P('10  W: oh\n    M: A star a star'),
  [['women', 'oh', 10, 10, '', 0, false], ['men', 'A star a star', 10, 10, '', 0, false]]);
check('a part named twice opens a new group at the same bars',
  P('10  W: oh\n    W: ah'),
  [['women', 'oh', 10, 10, '', 0, false], ['women', 'ah', 10, 10, '', 1, false]]);
check('a unison line cannot share a group with a part line',
  P('10  W: oh\n    both').map(r => r[5]), [0, 1]);
check('a section header closes the group above it',
  P('10  W: oh\n[Verse 2]\n    M: ah').map(r => [r[4], r[5]]),
  [['', 0], ['Verse 2', 1]]);
check('every spelling of the two parts is accepted',
  P('1 Women: a\n2 W: b\n3 Men: c\n4 M: d\n5 Both: e\n6 B: f').map(r => r[0]),
  ['women', 'women', 'men', 'men', 'both', 'both']);
check('case does not matter',
  P('1 w: a\n2 MEN: b').map(r => r[0]), ['women', 'men']);
check('a tilde marks a held note and is not part of the words',
  P('10 W: ~oh……'), [['women', 'oh……', 10, 10, '', 0, true]]);
check('blank lines are spacing, not content', P('1 a\n\n\n2 b').length, 2);
check('an empty editor parses to nothing', P(''), []);
// The bar column is digits followed by a space, so a lyric that opens the
// same way needs the prefix to say it is words. Worth knowing it works,
// because the alternative is a silently eaten first word.
check('a lyric opening with a number loses it to the bar column',
  P('10 000 Reasons')[0][1], '000 Reasons');
check('  and an explicit prefix is the way out',
  P('B: 10 000 Reasons')[0][1], '10 000 Reasons');

console.log('\nstarting an arrangement from a song that has none');
// Everything comes in as unison. Before anyone divides it, the only true
// reading of an ordinary song is that everybody sings it.
const noChord = () => false;
check('every seeded line is unison',
  V.fromLyrics('one\ntwo', noChord).map(r => r.part), ['both', 'both']);
check('each is its own group, in order',
  V.fromLyrics('one\ntwo', noChord).map(r => r.sortOrder), [0, 1]);
check('sections carry onto the rows',
  V.fromLyrics('[Verse 1]\na\n[Chorus]\nb', noChord).map(r => r.section),
  ['Verse 1', 'Chorus']);
check('  and the header itself is not a row',
  V.fromLyrics('[Verse 1]\na', noChord).map(r => r.text), ['a']);
check('blank lines are not rows', V.fromLyrics('a\n\n\nb', noChord).length, 2);
check('seeded rows carry no bars',
  V.fromLyrics('a', noChord).map(r => [r.barStart, r.barEnd]), [[null, null]]);
check('nothing is marked as held', V.fromLyrics('a', noChord)[0].sustained, false);
check('empty lyrics seed nothing', V.fromLyrics('', noChord).length, 0);
check('null lyrics seed nothing', V.fromLyrics(null, noChord).length, 0);
// A chord is not a word. A row holding "C  G7  Am" is a line the page would
// be asking somebody to sing.
const chordish = l => /^[\sA-G0-9#b/majminsu7]+$/.test(l) && /[A-G]/.test(l);
check('chord lines are dropped',
  V.fromLyrics('C   G7   Am\nAmazing grace', chordish).map(r => r.text),
  ['Amazing grace']);
check('  and the words below one are kept',
  V.fromLyrics('C   G7\nhow sweet the sound', chordish).map(r => r.text),
  ['how sweet the sound']);

// The invariant a conversion lives or dies by: the words that go in come
// out. Seeding from lyrics then saving must not quietly drop a verse.
const SONG = '[Verse 1]\nAmazing grace how sweet the sound\nThat saved a wretch like me\n\n' +
             '[Chorus]\nHow precious did that grace appear';
const seeded = V.fromLyrics(SONG, noChord);
check('every lyric line survives seeding',
  seeded.map(r => r.text),
  ['Amazing grace how sweet the sound', 'That saved a wretch like me',
   'How precious did that grace appear']);
check('  and survives the editor round trip too',
  V.parseVoiceText(V.toVoiceText(seeded)).map(r => r.text), seeded.map(r => r.text));
check('  with its sections intact',
  V.parseVoiceText(V.toVoiceText(seeded)).map(r => r.section), seeded.map(r => r.section));
check('a seeded arrangement is unison throughout',
  V.group(seeded).every(g => !!g.both), true);

console.log('\nthe editor round trip');
// The property that makes the editor safe: opening a song and saving it
// again without typing must give back the song that was there. Everything
// else in the editor is built on this holding.
// Bars excepted, per the block above: they are no longer the editor's to
// keep. Everything that IS the arrangement -- who sings, what, in which
// section, in what order, held or not -- must survive untouched.
const cmp = r => [r.part, r.text, r.section, r.sortOrder, !!r.sustained];
const trip = V.parseVoiceText(V.toVoiceText(L));
check('open and save with no edits gives back the same ' + L.length + ' rows',
  trip.map(cmp), L.map(cmp));
check('  including every grouping, which is now the blank lines',
  V.group(trip).map(g => [!!g.both, !!g.women, !!g.men]),
  V.group(L).map(g => [!!g.both, !!g.women, !!g.men]));
check('  and the same display groups', V.group(trip).length, V.group(L).length);
check('  and the same suggested lyrics', V.toPlainLyrics(trip), V.toPlainLyrics(L));
check('a second trip changes nothing further',
  V.toVoiceText(trip), V.toVoiceText(L));
// Groups are separated by exactly one blank line, which is the whole of
// the grouping syntax now.
check('one blank line between groups, and none inside one',
  /\n\n\n/.test(V.toVoiceText(L)), false);
check('the two-part moments come out as touching lines',
  V.toVoiceText(L).indexOf('W: ~oh……\nM: A star a star') > -1, true);

console.log('\nthe real arrangement, drawn the simple way');
const realHtml = V.html(L);
check('11 silent moments are shown as blanks',
  (realHtml.match(/vl-blank/g) || []).length, 11);
check('13 lines are labelled ALL', (realHtml.match(/>All</g) || []).length, 13);
check('no banner and no cue class remain',
  /vl-together|vl-sys--together/.test(realHtml), false);
// Across all 46 rows of a real arrangement, not one indent.
check('and not one line is indented', /vl-lead/.test(realHtml), false);
check('every lane in it is one of the two canonical ones',
  V.lanes(L), ['women', 'men']);

console.log('\nwhich takes survive a full-editor save');
// replaceAll deletes every row and inserts new ones, so a practice take
// only keeps its line if rematch can say which new row is which old one.
// Get this wrong in the lenient direction and a take plays against words
// it is not a recording of; get it wrong the other way and a save that
// changed nothing silently empties the song of its recordings. That one
// was the live bug.
const asRows = ls => ls.map((r, i) => ({
  id: 'old' + i, part: r.part, sort_order: r.sortOrder, text: r.text
}));
const reId = rows => rows.map(r => Object.assign({}, r, { id: 'new' + r.id.slice(3) }));

const same = asRows(L);
const noop = V.rematch(same, reId(same));
check('a save with no edits keeps every one of the ' + L.length + ' lines',
  Object.keys(noop).length, L.length);
check('  and each one lands on its own row',
  Object.keys(noop).every(k => noop[k] === 'new' + k.slice(3)), true);

// One word typed into one line. That line's takes are of the old words
// and must let go; nothing else may move.
const edited = asRows(L).map((r, i) => i === 5 ? Object.assign({}, r, { text: r.text + ' X' }) : r);
const afterEdit = V.rematch(same, reId(edited));
check('editing one line detaches that line alone', afterEdit['old5'], undefined);
check('  and the other ' + (L.length - 1) + ' lines keep their takes',
  Object.keys(afterEdit).length, L.length - 1);

// A verse inserted at the top shifts every sort_order below it. The words
// did not change, so neither should the links.
// The two exceptions are real and are the point: "Lis-ten to what I say"
// is sung twice, at 28 and 30. Once both have moved, the words no longer
// say which is which, and a take belonging to one of them stays a draft
// rather than being attached to the wrong moment of the song.
const shifted = reId(asRows(L).map(r => Object.assign({}, r, { sort_order: r.sort_order + 10 })));
const afterShift = V.rematch(same, shifted);
check('shifting every line down keeps all but the repeated line',
  Object.keys(afterShift).length, L.length - 2);
check('  and the two it drops are the repeated words',
  L.filter((r, i) => !afterShift['old' + i]).map(r => r.text),
  ['Lis-ten to what I say', 'Lis-ten to what I say']);

// Deleting a line is the one case where losing the link is right.
const minusOne = reId(asRows(L).filter((r, i) => i !== 3));
const afterDel = V.rematch(same, minusOne);
check('a deleted line takes its own link with it', afterDel['old3'], undefined);
check('  and only its own', Object.keys(afterDel).length, L.length - 1);

// Two identical lines in different places: pass one pins them by position.
const twin = [
  { id: 'oldA', part: 'women', sort_order: 1, text: 'sing' },
  { id: 'oldB', part: 'women', sort_order: 9, text: 'sing' }
];
const twinNew = [
  { id: 'newA', part: 'women', sort_order: 1, text: 'sing' },
  { id: 'newB', part: 'women', sort_order: 9, text: 'sing' }
];
const twinMap = V.rematch(twin, twinNew);
check('identical words at different moments stay apart',
  [twinMap.oldA, twinMap.oldB], ['newA', 'newB']);

// ...and when both of those moved, the words no longer identify either.
// Guessing would attach a recording to the wrong moment of the song.
const twinMoved = [
  { id: 'newA', part: 'women', sort_order: 4, text: 'sing' },
  { id: 'newB', part: 'women', sort_order: 12, text: 'sing' }
];
check('but if both move, neither is guessed at',
  Object.keys(V.rematch(twin, twinMoved)).length, 0);

// The ambiguity can also appear on only one side: one line, copied, and
// the copies moved. The take belongs to one of the two and there is no
// way to say which, so it belongs to neither.
check('a line duplicated and moved is ambiguous too',
  Object.keys(V.rematch(
    [{ id: 'o', part: 'women', sort_order: 1, text: 'sing' }],
    [{ id: 'n1', part: 'women', sort_order: 4, text: 'sing' },
     { id: 'n2', part: 'women', sort_order: 12, text: 'sing' }])).length, 0);
// Duplicated but left where it was: pass one pins it, and the copy is
// simply a new line with no take of its own.
check('  unless one of them stayed put',
  V.rematch(
    [{ id: 'o', part: 'women', sort_order: 1, text: 'sing' }],
    [{ id: 'n1', part: 'women', sort_order: 1, text: 'sing' },
     { id: 'n2', part: 'women', sort_order: 12, text: 'sing' }]).o, 'n1');

check('the same words in the other part are a different line',
  Object.keys(V.rematch(
    [{ id: 'o', part: 'women', sort_order: 1, text: 'sing' }],
    [{ id: 'n', part: 'men', sort_order: 1, text: 'sing' }])).length, 0);

// Whitespace and case are not an edit to the words.
check('re-spacing a line is not a retype',
  Object.keys(V.rematch(
    [{ id: 'o', part: 'men', sort_order: 2, text: 'A star  a star' }],
    [{ id: 'n', part: 'men', sort_order: 2, text: 'a  star a star ' }])).length, 1);

check('nothing in, nothing out', Object.keys(V.rematch([], [])).length, 0);
check('every line deleted detaches everything',
  Object.keys(V.rematch(same, [])).length, 0);

console.log('\nwhat a named part looks like when somebody types it');
// W: and M: are the shorthand, so a colon after a bracketed name is what
// a person writes without thinking. It used to stay on the front of the
// lyric: one real song came back with sixty-three lines beginning ": ".
check('a colon after the name is part of the label, not the words',
  V.parseVoiceText('[Melody]: Is there room in your heart')
    .map(r => [r.part, r.text]), [['Melody', 'Is there room in your heart']]);
check('  with or without a space before it',
  V.parseVoiceText('[Melody] : words').map(r => r.text), ['words']);
check('  and without one at all', V.parseVoiceText('[Melody] words').map(r => r.text), ['words']);
// ...but a colon in the WORDS is still words.
check('a colon later in the line is left alone',
  V.parseVoiceText('[Melody]: he said: come').map(r => r.text), ['he said: come']);

// Lanes belong to a section. A part named in the chorus used to be drawn
// on every verse line too, as an empty bracket: five named parts made a
// unison verse five rows deep, four of them silent.
// Both sections split, or the test proves nothing: a unison moment draws
// one line and never consults the lanes at all, so a leak would not show.
const perSection = V.parseVoiceText(
  '[Verse 1]\nW: upper\nM: lower\n\n[Chorus]\n[Melody]: Is there room\n[Harmony]: Is there room');
const psHtml = V.html(perSection);
const cut = psHtml.indexOf('>Chorus<');
const verseHtml = psHtml.slice(0, cut), chorusHtml = psHtml.slice(cut);
const lineCount = h => (h.match(/class="vl-ln /g) || []).length;
check('the verse shows its own two lanes and no more', lineCount(verseHtml), 2);
check('  and the chorus shows its own two', lineCount(chorusHtml), 2);
check('  the chorus parts never appear in the verse',
  /Melody|Harmony/.test(verseHtml), false);
check('  nor the verse parts in the chorus',
  />Women<|>Men</.test(chorusHtml), false);
check('  and both named parts are in the chorus',
  ['Melody', 'Harmony'].every(n => chorusHtml.indexOf('>' + n + '<') > -1), true);
// The property that must survive: within a section the stack never moves.
const twoMoments = V.parseVoiceText(
  '[Chorus]\n[Melody]: one\n[Harmony]: one\n\n[Melody]: two');
const th = V.html(twoMoments);
check('a part silent for one moment still keeps its place in that section',
  (th.match(/vl-ln--rest/g) || []).length, 1);

console.log('\na moment sung by named parts still has a chord row');
// Found in real use: a chorus written entirely in [Melody] / [1st Part]
// lost every chord, while the unison verses above kept theirs. leadLine
// knew only both/women/men, so such a moment had no representative lyric
// and nothing for a chord to sit over -- 0 of 60 moments in that chorus.
const namedMoment = V.group(V.parseVoiceText(
  '[Chorus]\n[Melody]: Is there room\n[1st Part]: Is there room'))[0];
check('a moment of named parts has a lead line', V.leadLine(namedMoment) !== null, true);
check('  and it is the first part that sings',
  V.leadText(namedMoment), 'Is there room');
// ...without disturbing the rule that held vowels contribute nothing.
// This is the guard an earlier, unguarded fallback got wrong, putting
// "oh……" into the lyrics column of every song built from an arrangement.
const vowelsOnly = V.group([
  row('women', 'oh……', 0, { sustained: true }),
  row('men', 'ah……', 0, { sustained: true })
])[0];
check('a moment of nothing but held vowels still has none',
  V.leadLine(vowelsOnly), null);
check('  so it contributes no lyric',
  V.toPlainLyrics([row('women', 'oh……', 0, { sustained: true })]), '');
check('a named part holding a vowel is skipped too',
  V.leadLine(V.group([row('Descant', 'oh……', 0, { sustained: true })])[0]), null);
check('a named part with no words at all is skipped',
  V.leadLine(V.group([row('Descant', '   ', 0), row('Melody', 'sing', 0)])[0]).text, 'sing');

console.log('\nchords, read from the song and written back to it');
// Chords live in songs.lyrics as a plain text line above the words, each
// positioned by character offset. Sixty of the seventy songs in the
// library are written that way and the Chords tab, the songbook and the
// PDF all already read it. The choir page reads the SAME thing rather
// than keeping a second copy that could drift out of agreement.
const isChord = l => /^[\sA-G#b/0-9majinsudg()]+$/.test(l) && /[A-G]/.test(l) && !/[a-z]{3,}/.test(l);
const LY = [
  '[Verse 1]',
  'C       F        G',
  'Said the night wind to the little lamb',
  'Do you see what I see',
  'Am          D',
  'Way up in the sky lit-tle lamb'
].join('\n');

const idx = V.chordIndex(LY, isChord);
check('a section header is not mistaken for a lyric', idx.length, 3);
check('each lyric carries the chord line above it',
  idx.map(r => [r.lyric.slice(0, 12), r.chord]),
  [['Said the nig', 'C       F        G'],
   ['Do you see w', ''],
   ['Way up in th', 'Am          D']]);
check('  and remembers where both lines are',
  idx.map(r => [r.lyricAt, r.chordAt]), [[2, 1], [3, -1], [5, 4]]);
// A chord line with nothing under it has no lyric to sit over.
check('a trailing chord line with no words is dropped',
  V.chordIndex('C  G\nwords here\nAm', isChord).length, 1);

// The moment -> chord lookup. Hyphenation differs between the arrangement
// and the lyrics column ("little" against "lit-tle"), so the match is on
// what the words sound like, not how they are spelt.
const cg = V.group([row('both', 'Said the night wind to the lit-tle lamb', 0)])[0];
check('hyphenation does not defeat the match',
  (V.chordFor(idx, cg, { at: 0 }) || {}).chord, 'C       F        G');
check('a moment with no matching lyric gets no chords',
  V.chordFor(idx, V.group([row('both', 'nothing like this', 0)])[0], { at: 0 }), null);

// Matched in reading order: a refrain sung twice has two chord lines and
// they are allowed to differ, so the second occurrence must not be handed
// the first one's chords.
const REP = ['C', 'sing it', 'G', 'sing it'].join('\n');
const rIdx = V.chordIndex(REP, isChord);
const cur = { at: 0 };
const g1 = V.group([row('both', 'sing it', 0)])[0];
// ...and the other side of it: DIFFERENT parts singing the same words
// are one line of the song, however many moments they are written as.
// A chorus of three such parts used to eat three chord lines and starve
// the verses below, 16 of 16 down to 8.
const shared = V.chordIndex(['Bb  F', 'Is there room', 'C', 'Make room'].join('\n'), isChord);
const sc = { at: 0 };
const g3 = ['Melody','1st Part','2nd Part'].map(p =>
  V.group([row(p, 'Is there room', 0)])[0]);
check('three parts on the same words share one chord line',
  g3.map(g => (V.chordFor(shared, g, sc) || {}).chord), ['Bb  F','Bb  F','Bb  F']);
check('  and the line after them still gets its own',
  (V.chordFor(shared, V.group([row('both','Make room',1)])[0], sc) || {}).chord, 'C');

check('a repeated line takes the next chord line, not the first again',
  [V.chordFor(rIdx, g1, cur).chord, V.chordFor(rIdx, g1, cur).chord], ['C', 'G']);

// Writing back. This is the carve-out the whole design rests on: chord
// lines change, words never do.
const withNew = V.withChord(LY, 3, -1, 'Dm   G7');
check('a chord row is inserted above its lyric',
  withNew.split('\n').slice(3, 5), ['Dm   G7', 'Do you see what I see']);
check('  and not one word is touched',
  withNew.split('\n').filter(l => !isChord(l)),
  LY.split('\n').filter(l => !isChord(l)));
check('an existing chord row is replaced, not duplicated',
  V.withChord(LY, 2, 1, 'F  C').split('\n').slice(1, 3), ['F  C', 'Said the night wind to the little lamb']);
check('clearing a chord removes the row rather than leaving a blank',
  V.withChord(LY, 2, 1, '   ').split('\n').slice(0, 2), ['[Verse 1]', 'Said the night wind to the little lamb']);
check('an out-of-range lyric changes nothing', V.withChord(LY, 99, -1, 'X'), LY);

console.log('\nthe chords are the same width as the words under them');
// Not a style preference. A chord is placed by CHARACTER OFFSET into the
// lyric, so the chord row and the words have to be the same monospaced
// face at the same size or every chord slides off its syllable.
//
// Measured on the live page before this was fixed: the chord row at
// 13.12px (character width 7.688) over a lyric at 17.86px (10.463) --
// 2.775px of drift per character, which at offset 17 is most of five
// characters. The page looked perfectly tidy and the chords were wrong.
const css = raw.replace(/\r/g, '');
const rule = sel => {
  const i = css.indexOf(sel + ' {') >= 0 ? css.indexOf(sel + ' {') : css.indexOf(sel + '{');
  if (i < 0) return '';
  return css.slice(i, css.indexOf('}', i) + 1);
};
const bodyRule = rule('.vl-body');
const chordRule = rule('.vl-chord-text');
check('the words are sized by the shared token',
  /font-size:\s*var\(--vl-text\)/.test(bodyRule), true);
check('and so is the chord row',
  /font-size:\s*var\(--vl-text\)/.test(chordRule), true);
// The 0.94em that used to live here is exactly how the two came apart:
// the rule that makes the lyric monospaced must change the FACE only.
const hasRule = css.slice(css.indexOf('.vl-sys:has(.vl-chords'));
const hasBody = hasRule.slice(0, hasRule.indexOf('}') + 1);
check('making the lyric monospaced does not resize it',
  /font-size/.test(hasBody), false);
check('  but it does change the face', /font-family/.test(hasBody), true);
check('the chord input matches what it replaces',
  /font-size:\s*var\(--vl-text\)/.test(rule('.vl-chord-in')), true);
// The token carries the bump, whatever it currently is. The exact
// number is a taste decision that has already moved once (+3, then back
// 2 as too big); what must not move is that ONE token feeds both the
// chord row and the words, which the checks above pin down.
check('the token is derived from the lyric size, not a literal',
  /--vl-text:\s*calc\(var\(--sf-lyric-size,\s*19px\)\s*[-+]\s*\d+px\)/.test(css), true);
// Spacing down the page is two tokens so the rows stay in step.
check('the row rhythm is tokenised too',
  [/--vl-row:\s*\d+px/.test(css), /--vl-gap:\s*\d+px/.test(css)], [true, true]);
check('  and the system padding uses it',
  /\.vl-sys \{ padding: var\(--vl-row\) 0/.test(css), true);

const passed = results.filter(Boolean).length;
console.log('\n' + '='.repeat(58));
console.log(passed + '/' + results.length + ' checks passed');
process.exit(passed === results.length ? 0 : 1);
