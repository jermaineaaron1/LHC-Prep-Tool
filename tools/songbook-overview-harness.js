'use strict';
// Regression harness for Overview Edit: the choir arrangement as a pad.
//
// WHY THIS EXISTS
// The pad is a translation in both directions. Rows become text -- a
// section header, a moment's chords on the line above its words, W: and
// M: for the two lanes, [Melody] for any other part, a blank line between
// moments -- and text becomes rows again through the same parser the
// other editors use. The chords are not rows at all: they live in the
// song's own lyrics, and the pad lifts them out and writes them back.
//
// Every way this can go wrong saves cleanly:
//
//   - a chord line left in the parts text is a line sung by everyone
//   - a section edited on its own that takes the NEXT section's chords,
//     because the chord cursor skipped the sections not on the pad
//   - putting one section back and losing the others
//   - a part colour drawn for every song on the screen, not its own
//   - a colour map written on every save, changed or not
//
// HOW IT WORKS
// It slices the real window.lhcVoiceLines and the real pad functions out
// of Index.html and runs them against a small arrangement with chords,
// with a fake SBQ_SONGS that records what it is asked to write.
//
// USAGE
//   node tools/songbook-overview-harness.js
//   node tools/songbook-overview-harness.js path/to/file.html
//   node tools/songbook-overview-harness.js <file> --expect-broken
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
function line(pattern, name) {
  const l = lines.find(x => pattern.test(x));
  if (!l) throw new Error('not found: ' + name);
  return l.replace(/\r$/, '');
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

// ---------------------------------------------------------------------------
// The sliced source.
// ---------------------------------------------------------------------------
const WANTED = [
  [/^  function _sbBaseSongId\(/, '_sbBaseSongId'],
  [/^  function _sbPartDefault\(/, '_sbPartDefault'],
  [/^  function _sbPartDefaultsFor\(/, '_sbPartDefaultsFor'],
  [/^  function _sbPartDefaultFor\(/, '_sbPartDefaultFor'],
  [/^  function _sbPartColourFor\(/, '_sbPartColourFor'],
  [/^  function _sbPartColours\(/, '_sbPartColours'],
  [/^  function _sbPartColourCss\(/, '_sbPartColourCss'],
  [/^  function _sbPartColoursSave\(/, '_sbPartColoursSave'],
  [/^  function _sbmAllPrefix\(/, '_sbmAllPrefix'],
  [/^  function _sbmPadIndent\(/, '_sbmPadIndent'],
  [/^  function _sbmPadLine\(/, '_sbmPadLine'],
  [/^  function _sbmPadText\(/, '_sbmPadText'],
  [/^  function _sbmPadWords\(/, '_sbmPadWords'],
  [/^  function _sbmPadSplit\(/, '_sbmPadSplit'],
  [/^  function _sbmPadReplaceSection\(/, '_sbmPadReplaceSection'],
  [/^  function _sbmPadHighlight\(/, '_sbmPadHighlight'],
  [/^  function _sbmPadSaveChords\(/, '_sbmPadSaveChords'],
  [/^  function _sbmIsChord\(/, '_sbmIsChord']
];

let V, make;
try {
  const vStart = lines.findIndex(l => /^window\.lhcVoiceLines = \{/.test(l));
  if (vStart < 0) throw new Error('not found: window.lhcVoiceLines');
  const vEnd = lines.findIndex((l, i) => i > vStart && l.replace(/\r$/, '') === '};');
  if (vEnd < 0 || vEnd - vStart > 1200) throw new Error('window.lhcVoiceLines: no close, or a span that looks wrong');
  V = new Function('var window = {};\n' + lines.slice(vStart, vEnd + 1).map(l => l.replace(/\r$/, '')).join('\n') + '\nreturn window.lhcVoiceLines;')();

  const src = line(/^  var _SB_PART_DEFAULTS = \{/, 'var _SB_PART_DEFAULTS') + '\n' +
    line(/^  var _SB_PART_PALETTE = \[/, 'var _SB_PART_PALETTE') + '\n' +
    'var _sbVoiceLines = {};\n' +
    WANTED.map(([re, name]) => extract(re, name)).join('\n');
  make = new Function('window', 'STATE', 'SBQ_SONGS', 'escapeHtml', 'isChordLineGlobal', 'showToast',
    src +
    '\nreturn { padLine: _sbmPadLine, padText: _sbmPadText, words: _sbmPadWords, split: _sbmPadSplit,' +
    ' replaceSection: _sbmPadReplaceSection, highlight: _sbmPadHighlight, saveChords: _sbmPadSaveChords,' +
    ' colours: _sbPartColours, colourCss: _sbPartColourCss, coloursSave: _sbPartColoursSave, dflt: _sbPartDefault,' +
    ' dfltFor: _sbPartDefaultFor, colourFor: _sbPartColourFor, voiceLines: _sbVoiceLines };');
} catch (e) {
  if (EXPECT_BROKEN) {
    console.log('--expect-broken: ' + e.message + ', as expected.');
    process.exit(0);
  }
  throw e;
}
if (EXPECT_BROKEN) {
  console.log('\nBUT --expect-broken was given and the pad is present.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// A small arrangement with chords in the song's own lyrics.
// ---------------------------------------------------------------------------
function row(part, text, sortOrder, section, extra) {
  return Object.assign({ id: 'r' + sortOrder + part, part: part, text: text, sortOrder: sortOrder,
                         barStart: null, barEnd: null, section: section || '', sustained: false }, extra || {});
}
const ROWS = [
  row('both',     'A family hiding from the storm', 0, 'Verse 1'),
  // The same words twice, with chords only the first time: each moment
  // takes the NEXT occurrence of its words, so the chorus's "Make room"
  // must not take the verse's G. Not adjacent, deliberately: two moments
  // of the same words that TOUCH are one line of the song to chordFor.
  row('both',     'Make room',                      1, 'Verse 1'),
  row('both',     'Found no place',                 2, 'Verse 1'),
  row('women',    'Make room',                      3, 'Chorus'),
  row('men',      'Make room',                      3, 'Chorus', { sustained: true }),
  row('Melody',   'Is there room in your heart',    4, 'Chorus'),
  row('1st Part', 'Is there room in your heart',    4, 'Chorus')
];
const LYRICS = [
  '[Verse 1]',
  '           F',
  'A family hiding from the storm',
  'G',
  'Make room',
  'Bb        Dm',
  'Found no place',
  '',
  '[Chorus]',
  'Make room',
  'Bb   F',
  'Is there room in your heart'
].join('\n');
// A chord line is chord names and spaces, nothing else.
const isChord = (l) => /^\s*([A-G][#b]?(m|maj7|m7|7|sus4|dim)?\s*)+$/.test(String(l || '')) && /[A-G]/.test(l);

function shape(rows) {
  return V.group(rows).map(g => ({
    section: g.section || '',
    both: g.both ? [g.both.text, !!g.both.sustained] : null,
    parts: Object.keys(g.byPart || {}).sort().map(k => [k, g.byPart[k].text, !!g.byPart[k].sustained])
  }));
}
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function fresh(songs) {
  const calls = { lyrics: [], style: [], toasts: [] };
  const STATE = { songs: songs || [{ id: 's1', lyrics: LYRICS, display_style: { fontSize: 18, partColours: { melody: '#FF0000', women: 'red', '1st part': '#00ff00' } } }] };
  const SBQ = {
    updateLyrics: (id, text) => { calls.lyrics.push([id, text]); return Promise.resolve({ success: true }); },
    updateDisplayStyle: (id, style) => { calls.style.push([id, style]); return Promise.resolve({ success: true }); }
  };
  const api = make({ lhcVoiceLines: V, STATE: STATE }, STATE, SBQ, esc, isChord, (m, k) => calls.toasts.push([m, k]));
  return { api, calls, STATE };
}

// ---------------------------------------------------------------------------
console.log('\nrows become the pad');
{
  const { api } = fresh();
  check('a header, the chords over each moment, the parts with their prefixes, a blank line between moments',
    api.padText(ROWS, LYRICS, null, isChord).split('\n'),
    ['[Verse 1]', '           F', 'A family hiding from the storm', '', 'G', 'Make room', '', 'Bb        Dm', 'Found no place', '',
     '[Chorus]', 'W: Make room', 'M: ~Make room', '',
     '         Bb   F', '[Melody] Is there room in your heart', '[1st Part] Is there room in your heart']);
  // The chorus opens with the same words the verse ended on. On its own
  // it must still take the SECOND "Make room" -- the one with no chord --
  // not the verse's G.
  check('one section on its own keeps its header and its own chords, and not the section before it\'s',
    api.padText(ROWS, LYRICS, 'Chorus', isChord).split('\n'),
    ['[Chorus]', 'W: Make room', 'M: ~Make room', '', '         Bb   F', '[Melody] Is there room in your heart', '[1st Part] Is there room in your heart']);
  check('and is found whatever its case', api.padText(ROWS, LYRICS, 'cHoRuS', isChord), api.padText(ROWS, LYRICS, 'Chorus', isChord));
  // A held note above the line a chord belongs to: the chord sits over the
  // line it is saved against, indented by that line's label.
  const held = [row('women', 'oh', 0, 'V', { sustained: true }), row('men', 'A star a star', 0, 'V')];
  check('a moment opening on a held note has its chord over the sung line', api.padText(held, 'C   G\nA star a star', null, isChord).split('\n'), ['[V]', 'W: ~oh', '   C   G', 'M: A star a star']);
  check('  and the save finds it there, the indent taken off', api.split(api.padText(held, 'C   G\nA star a star', null, isChord), isChord).chords, [{ words: 'A star a star', chord: 'C   G' }]);
  // The same section sung twice gives the pad one time through it at a time.
  const two = [row('both', 'Open', 0, 'Verse 1'), row('both', 'First chorus', 1, 'Chorus'), row('both', 'Middle', 2, 'Verse 2'), row('both', 'Second chorus', 3, 'Chorus')];
  check('a section sung twice: one time through at a time', [api.padText(two, '', 'Chorus', isChord, 1), api.padText(two, '', 'Chorus', isChord, 2)], ['[Chorus]\nFirst chorus', '[Chorus]\nSecond chorus']);
  check('  and the whole song keeps both, in order', api.padText(two, '', null, isChord), '[Verse 1]\nOpen\n\n[Chorus]\nFirst chorus\n\n[Verse 2]\nMiddle\n\n[Chorus]\nSecond chorus');
  check('a line everyone sings that opens with a number keeps its number', api.padText([row('both', '3 kings came', 0, 'V')], '', null, isChord), '[V]\n[All] 3 kings came');
  check('a song with no chords has no chord lines',
    api.padText(ROWS, 'A family hiding from the storm', null, isChord).split('\n').some(l => isChord(l)), false);
}

console.log('\nthe pad becomes rows again');
{
  const { api } = fresh();
  const text = api.padText(ROWS, LYRICS, null, isChord);
  const split = api.split(text, isChord);
  check('the chord lines come out, keyed by the words they sit over',
    split.chords, [{ words: 'A family hiding from the storm', chord: '           F' }, { words: 'Make room', chord: 'G' },
                   { words: 'Found no place', chord: 'Bb        Dm' }, { words: 'Is there room in your heart', chord: 'Bb   F' }]);
  check('what is left has no chord lines', split.text.split('\n').some(l => isChord(l)), false);
  check('and parses to the arrangement that was put in', shape(V.parseVoiceText(split.text)), shape(ROWS));
  check('a chord line with a header under it is not a chord line', api.split('C\n[Verse 2]\nwords', isChord), { text: 'C\n[Verse 2]\nwords', chords: [] });
  check('the words of a line, without its prefix or hold', [api.words('W: ~oh'), api.words('[1st Part] la'), api.words('  la ')], ['oh', 'la', 'la']);
}

console.log('\nputting one section back');
{
  const { api } = fresh();
  const full = '[Verse 1]\nA\n\nB\n\n[Chorus]\nC\n\n[Verse 2]\nD';
  check('the section is replaced and the others are untouched',
    api.replaceSection(full, 'Chorus', '[Chorus]\nX\n\nY'), '[Verse 1]\nA\n\nB\n\n[Chorus]\nX\n\nY\n\n[Verse 2]\nD');
  check('whatever the case of its name', api.replaceSection(full, 'chorus', '[Chorus]\nX'), '[Verse 1]\nA\n\nB\n\n[Chorus]\nX\n\n[Verse 2]\nD');
  check('a section the text does not have goes on the end', api.replaceSection(full, 'Bridge', '[Bridge]\nZ'), full + '\n\n[Bridge]\nZ');
  check('the unnamed block before the first header is a section too', api.replaceSection('lead\n\n[Verse 1]\nA', '', 'new lead'), 'new lead\n\n[Verse 1]\nA');
  // A chorus sung twice: the pen on the second edits the second, and the
  // first keeps its words. By name alone the save dropped the second run.
  const twice = '[Verse 1]\nA\n\n[Chorus]\nB\n\n[Verse 2]\nC\n\n[Chorus]\nD';
  check('a section sung twice: the second time is replaced, the first kept', api.replaceSection(twice, 'Chorus', '[Chorus]\nX', 2), '[Verse 1]\nA\n\n[Chorus]\nB\n\n[Verse 2]\nC\n\n[Chorus]\nX');
  check('  the first time, by default, and the second kept', api.replaceSection(twice, 'Chorus', '[Chorus]\nX'), '[Verse 1]\nA\n\n[Chorus]\nX\n\n[Verse 2]\nC\n\n[Chorus]\nD');
}

console.log('\ncolouring the pad');
{
  const { api } = fresh();
  const html = api.highlight('[Verse 1]\nBb F\nW: la\n[Melody] ~oo <b>\n~hum', k => (k === 'women' ? '#aa0000' : '#00aa00'), isChord);
  check('a header', html.indexOf('<span class="pd-sec">[Verse 1]</span>') > -1, true);
  check('a chord line', html.indexOf('<span class="pd-chord">Bb F</span>') > -1, true);
  check('the women\'s prefix in the women\'s colour', html.indexOf('<span class="pd-role" style="color:#aa0000">W:</span>') > -1, true);
  check('a named part in its own colour', html.indexOf('<span class="pd-role" style="color:#00aa00">[Melody]</span>') > -1, true);
  check('a held note, with or without a prefix', (html.match(/pd-hold/g) || []).length, 2);
  check('and the words are escaped', html.indexOf('&lt;b&gt;') > -1 && html.indexOf('<b>') === -1, true);
}

console.log('\nthe colour of each part');
{
  const { api, calls } = fresh();
  check('the song\'s map, with anything that is not a colour left out', api.colours('s1'), { melody: '#ff0000', '1st part': '#00ff00' });
  check('drawn as rules scoped to the song', api.colourCss('s1'),
    '<style>[data-choir-song="s1"] .vl-ln[data-part="melody"] .vl-who{background:#ff0000;color:#fff;}[data-choir-song="s1"] .vl-ln[data-part="melody"]{background:color-mix(in srgb,#ff0000 7%,transparent);}' +
    '[data-choir-song="s1"] .vl-ln[data-part="1st part"] .vl-who{background:#00ff00;color:#fff;}[data-choir-song="s1"] .vl-ln[data-part="1st part"]{background:color-mix(in srgb,#00ff00 7%,transparent);}</style>');
  check('a song with no colours gets no stylesheet', api.colourCss('nope'), '');
  check('a map handed in is drawn instead of the saved one', api.colourCss('s1', { men: '#123456' }).indexOf('[data-part="men"] .vl-who{background:#123456') > -1, true);
  check('the defaults are the score\'s', [api.dflt('women'), api.dflt('men'), api.dflt('both'), api.dflt('melody')], ['#a8475f', '#1d6b68', '#4a6da7', '#8a5a2b']);
  // Parts outside the families -- Melody, 1st Part, 2nd Part -- each take
  // their own colour, in the order the song uses them, without anybody
  // choosing; a chosen colour still wins.
  api.voiceLines['s2'] = [{ part: 'Melody', text: 'a', sortOrder: 0 }, { part: '1st Part', text: 'b', sortOrder: 0 }, { part: '2nd Part', text: 'c', sortOrder: 0 }];
  check('each extra part its own default colour, in the order the song uses them',
    [api.dfltFor('s2', 'melody'), api.dfltFor('s2', '1st part'), api.dfltFor('s2', '2nd part')], ['#8a5a2b', '#0e7490', '#6d28d9']);
  check('  drawn as rules without anybody choosing', (api.colourCss('s2').match(/\.vl-who\{background:#[0-9a-f]{6}/g) || []).length, 3);
  check('  and the women keep the score\'s colour', api.dfltFor('s2', 'women'), '#a8475f');
  check('  a colour chosen for the song wins over the palette', api.colourFor('s2', '2nd part'), '#6d28d9');
}

console.log('\nsaving');
(async () => {
  const tick = () => new Promise(r => setImmediate(r));
  {
    const { api, calls } = fresh();
    await api.coloursSave('s1', { melody: '#ff0000', '1st part': '#00ff00' });
    check('an unchanged colour map is not written', calls.style.length, 0);
    await api.coloursSave('s1', { melody: '#0000ff' });
    check('a changed one is, as the whole display style with its other keys kept',
      calls.style, [['s1', { fontSize: 18, partColours: { melody: '#0000ff' } }]]);
  }
  {
    const { api, calls, STATE } = fresh();
    // Two "Make room" lines: the pad's first is the verse's (unchanged, G),
    // its second is the chorus's, which had no chord line yet.
    const r = await api.saveChords('s1', ROWS, [{ words: 'Make room', chord: 'G' }, { words: 'Make room', chord: 'Dm  C' }, { words: 'Not in the song', chord: 'G' }]);
    check('a chord line for a moment that had none is written above its words, once, and above the RIGHT occurrence',
      [calls.lyrics.length, calls.lyrics[0] && calls.lyrics[0][1].indexOf('[Chorus]\nDm  C\nMake room\nBb   F') > -1, calls.lyrics[0] && calls.lyrics[0][1].indexOf('G\nMake room') > -1], [1, true, true]);
    check('and the song in memory follows', STATE.songs[0].lyrics.indexOf('Dm  C\nMake room') > -1, true);
    check('a chord line whose words are not in the song is reported, not placed', r.orphans, ['Not in the song']);
    const r2 = await api.saveChords('s1', ROWS, [{ words: 'Found no place', chord: 'Bb        Dm' }]);
    check('a chord line that is already there is not written again', [r2.written, calls.lyrics.length], [false, 1]);
    await api.saveChords('s1', ROWS, [{ words: 'Found no place', chord: 'Gm' }]);
    check('a changed chord line replaces the one that was there', calls.lyrics[1][1].split('\n').indexOf('Gm') > -1 && calls.lyrics[1][1].indexOf('Bb        Dm') === -1, true);
  }

  const failed = results.filter(r => !r).length;
  console.log('\n' + (failed ? failed + ' of ' + results.length + ' checks FAILED' : 'All ' + results.length + ' checks passed.'));
  process.exit(failed ? 1 : 0);
})();
