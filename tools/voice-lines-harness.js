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
if (end - start > 400) {
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

// The order the lane classes appear in the markup. This is the check that
// catches a missing rest cell: lanes must always come out women-then-men,
// present or not.
function laneOrder(html) {
  return (html.match(/vl-cell vl-cell--(women|men|both)/g) || [])
    .map(s => s.replace('vl-cell vl-cell--', ''));
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

console.log('\ndrawing the two lanes');
const splitHtml = V.html([row('women', 'Oh', 0), row('men', 'dancing', 0)]);
check('a split group draws both lanes', laneOrder(splitHtml), ['women', 'men']);
check('  and is marked as a split', /vl-row--split/.test(splitHtml), true);
const unisonHtml = V.html([row('both', 'Silent night', 0)]);
check('a unison group draws one spanning cell', laneOrder(unisonHtml), ['both']);
check('  and is not marked as a split', /vl-row--split/.test(unisonHtml), false);

// THE invariant. Drop the rest cell and the men's words move into the
// women's column, on a page that still looks completely normal.
const womenRest = V.html([row('men', 'Do you see what I see', 0)]);
check('a resting part still occupies its lane', laneOrder(womenRest), ['women', 'men']);
check('  and that lane is drawn as a rest', /vl-cell--women vl-cell--rest/.test(womenRest), true);
check('  while the singing part is not', /vl-cell--men vl-cell--rest/.test(womenRest), false);
const menRest = V.html([row('women', 'Do you see what I see', 0)]);
check('the same the other way round', laneOrder(menRest), ['women', 'men']);
check('  with the rest on the men', /vl-cell--men vl-cell--rest/.test(menRest), true);

check('a gap in the bars is announced',
  /2 bars — both parts rest/.test(
    V.html([row('both', 'a', 0, { barStart: 44, barEnd: 45 }),
            row('both', 'b', 1, { barStart: 48, barEnd: 50 })])), true);
check('one bar of silence is singular',
  /1 bar — both parts rest/.test(
    V.html([row('both', 'a', 0, { barStart: 44, barEnd: 45 }),
            row('both', 'b', 1, { barStart: 47, barEnd: 48 })])), true);

check('a held vowel is marked as one',
  /vl-text vl-text--hold/.test(V.html([row('women', 'Oh……', 0, { sustained: true })])), true);
check('an ordinary line is not',
  /vl-text--hold/.test(V.html([row('women', 'Oh', 0)])), false);
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
check('the page marks exactly those 22',
  (html.match(/vl-row--split/g) || []).length, splits);
check('and draws a lane for every part of every group',
  (html.match(/vl-cell vl-cell--/g) || []).length, splits * 2 + 13);
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
console.log('\nwhere the two parts come in together');
// The cue is the FIRST group of a together run, not every together group --
// a caroler counting rests needs the bar they come back in on, and marking
// all thirty-five would mark nothing.
function cues(gs) {
  return V.annotate(V.group(gs)).map(g => !!g.togetherStart);
}
check('a unison group at the very start is a cue',
  cues([row('both', 'a', 0)]), [true]);
check('one part alone is not',
  cues([row('women', 'a', 0)]), [false]);
check('both parts singing different words still counts as together',
  cues([row('women', 'Oh', 0), row('men', 'dancing', 0)]), [true]);
check('a run of together groups is cued once, at its head',
  cues([row('both', 'a', 0), row('both', 'b', 1), row('both', 'c', 2)]),
  [true, false, false]);
check('a part dropping out and returning starts a new cue',
  cues([row('both', 'a', 0), row('women', 'b', 1), row('both', 'c', 2)]),
  [true, false, true]);
// Two bars of silence are a fresh entry however the piece got there, which
// is exactly the 46-47 rest before the last verse of this carol.
check('a gap breaks the run even between two together groups',
  cues([row('both', 'a', 0, { barStart: 44, barEnd: 45 }),
        row('both', 'b', 1, { barStart: 48, barEnd: 50 })]), [true, true]);
check('  and consecutive bars do not',
  cues([row('both', 'a', 0, { barStart: 44, barEnd: 45 }),
        row('both', 'b', 1, { barStart: 46, barEnd: 48 })]), [true, false]);
check('the cue reaches the markup',
  (V.html([row('both', 'a', 0)]).match(/vl-row--together/g) || []).length, 1);
check('  with a label a singer can read',
  /Women and men in together/.test(V.html([row('both', 'a', 0)])), true);

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

console.log('\nthe editor round trip');
// The property that makes the editor safe: opening a song and saving it
// again without typing must give back the song that was there. Everything
// else in the editor is built on this holding.
const cmp = r => [r.part, r.text, r.barStart, r.barEnd, r.section, r.sortOrder, !!r.sustained];
const trip = V.parseVoiceText(V.toVoiceText(L));
check('open and save with no edits gives back the same ' + L.length + ' rows',
  trip.map(cmp), L.map(cmp));
check('  and the same display groups', V.group(trip).length, V.group(L).length);
check('  and the same suggested lyrics', V.toPlainLyrics(trip), V.toPlainLyrics(L));
check('  and the same cues', cues(trip), cues(L));
check('a second trip changes nothing further',
  V.toVoiceText(trip), V.toVoiceText(L));
check('the bar column is wide enough for the widest range',
  V.toVoiceText(L).split('\n').filter(s => /^\d/.test(s))
    .every(s => /^\d[\d–]*\s\s/.test(s)), true);

console.log('\nthe cues on the real arrangement');
const realCues = V.annotate(V.group(L)).filter(g => g.togetherStart);
check('8 places where the parts come in together', realCues.length, 8);
check('  the first is bar 1', realCues[0].barStart, 1);
// 48-50 is the entry after the two-bar rest. It only gets a cue because a
// gap breaks the run -- 44-45 before it was together too.
check('  the rest at 46-47 earns the last verse its own cue',
  realCues.map(g => g.barStart).indexOf(48) > -1, true);

const passed = results.filter(Boolean).length;
console.log('\n' + '='.repeat(58));
console.log(passed + '/' + results.length + ' checks passed');
process.exit(passed === results.length ? 0 : 1);
