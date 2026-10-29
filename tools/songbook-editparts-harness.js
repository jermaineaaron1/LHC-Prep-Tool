'use strict';
// Regression harness for the phone's choir-parts editor.
//
// WHY THIS EXISTS
// On a desktop the parts are edited as text in a grammar -- W: for the
// women, M: for the men, [Soprano] for anyone else, ~ for a held note, a
// blank line between moments -- and that text is what the parser turns
// into rows for song_voice_lines. The phone shows the same arrangement as
// sections of moments of lines instead, and saves by writing the grammar
// back out and handing it to the same parser.
//
// So the editor is a translation, and a translation can be wrong without
// ever throwing:
//
//   - serialise a women's line without its W: and it becomes everyone's
//   - forget the blank line between two moments and they merge into one,
//     which on the page tells both parts to sing at once
//   - drop the ~ and a held vowel prints as a lyric
//   - let two lines for the same part into one moment and the parser
//     keeps whichever it sees last; the other is gone
//
// Every one of those saves cleanly and shows a page that still looks like
// a song. The check that matters is therefore the round trip: the rows the
// editor would hand to replaceAll for an arrangement it has not touched
// must be the rows the old editor would have handed it.
//
// HOW IT WORKS
// It slices the real window.lhcVoiceLines and the real editor functions
// out of Index.html and runs them against synthetic rows. The save path is
// run against a fake SBQ_VOICE_LINES that records what it was given.
//
// USAGE
//   node tools/songbook-editparts-harness.js
//   node tools/songbook-editparts-harness.js path/to/file.html
//   node tools/songbook-editparts-harness.js <file> --expect-broken
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
// The sliced source: the voice-lines module, then the editor.
// ---------------------------------------------------------------------------
const WANTED = [
  [/^  function _sbmEdId\(/, '_sbmEdId'],
  [/^  function _sbmEdPartKey\(/, '_sbmEdPartKey'],
  [/^  function _sbmEdPartLabel\(/, '_sbmEdPartLabel'],
  [/^  function _sbmEdCanonical\(/, '_sbmEdCanonical'],
  [/^  function _sbmEdFromRows\(/, '_sbmEdFromRows'],
  [/^  function _sbmEdToText\(/, '_sbmEdToText'],
  [/^  function _sbmEdFind\(/, '_sbmEdFind'],
  [/^  function _sbmEdPartsOn\(/, '_sbmEdPartsOn'],
  [/^  function _sbmEdTouch\(/, '_sbmEdTouch'],
  [/^  function _sbmEdNextName\(/, '_sbmEdNextName'],
  [/^  function sbmEdAddSectionNamed\(/, 'sbmEdAddSectionNamed'],
  [/^  function sbmEdAddPartNamed\(/, 'sbmEdAddPartNamed'],
  [/^  function _sbmEdEnable\(/, '_sbmEdEnable'],
  [/^  function sbmEdTogglePart\(/, 'sbmEdTogglePart'],
  [/^  function sbmEdCyclePart\(/, 'sbmEdCyclePart'],
  [/^  function sbmEdDupLine\(/, 'sbmEdDupLine'],
  [/^  function sbmEdDelLine\(/, 'sbmEdDelLine'],
  [/^  function sbmEdDupSec\(/, 'sbmEdDupSec'],
  [/^  function sbmEdMoveMoment\(/, 'sbmEdMoveMoment'],
  [/^  function _sbmEdClose\(/, '_sbmEdClose'],
  [/^  function _sbmEdKey\(/, '_sbmEdKey'],
  [/^  function sbmEdToText\(/, 'sbmEdToText'],
  [/^  function sbmEdSave\(/, 'sbmEdSave']
];

let V, make;
try {
  const vStart = lines.findIndex(l => /^window\.lhcVoiceLines = \{/.test(l));
  if (vStart < 0) throw new Error('not found: window.lhcVoiceLines');
  const vEnd = lines.findIndex((l, i) => i > vStart && l.replace(/\r$/, '') === '};');
  if (vEnd < 0 || vEnd - vStart > 900) throw new Error('window.lhcVoiceLines: no close, or a span that looks wrong');
  const vSrc = lines.slice(vStart, vEnd + 1).map(l => l.replace(/\r$/, '')).join('\n');
  V = new Function('var window = {};\n' + vSrc + '\nreturn window.lhcVoiceLines;')();

  const decls = [
    line(/^  var _sbmEd = null;/, 'var _sbmEd'),
    line(/^  var _SBM_ED_PARTS = \[/, 'var _SBM_ED_PARTS'),
    line(/^  var _sbmEdSeq = 0;/, 'var _sbmEdSeq'),
    line(/^  var _sbmEdPvTimer = null;/, 'var _sbmEdPvTimer')
  ].join('\n');
  const src = decls + '\n' + WANTED.map(([re, name]) => extract(re, name)).join('\n');

  // Everything the editor reaches for outside itself comes in as a
  // parameter, so a stray global would be a ReferenceError here rather
  // than a silent undefined.
  make = new Function('window', 'document', 'showToast', 'confirm', 'prompt', 'renderSongbookLive',
    '_sbVoiceLines', 'songOrderSections', '_sbmCloseSheet', '_sbmPaint',
    src +
    '\nfunction _sbmEdPaint() { _sbmPaint.n++; }' +
    '\nreturn {' +
    '  get ed() { return _sbmEd; }, set ed(v) { _sbmEd = v; },' +
    '  fromRows: _sbmEdFromRows, toText: _sbmEdToText, find: _sbmEdFind, nextName: _sbmEdNextName,' +
    '  addSection: sbmEdAddSectionNamed, addPart: sbmEdAddPartNamed, toggle: sbmEdTogglePart,' +
    '  cycle: sbmEdCyclePart, dup: sbmEdDupLine, del: sbmEdDelLine, dupSec: sbmEdDupSec,' +
    '  move: sbmEdMoveMoment, save: sbmEdSave, handText: sbmEdToText };');
} catch (e) {
  if (EXPECT_BROKEN) {
    console.log('--expect-broken: ' + e.message + ', as expected.');
    process.exit(0);
  }
  throw e;
}
if (EXPECT_BROKEN) {
  console.log('\nBUT --expect-broken was given and the editor is present.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// A small carol, as forSong hands it over: one row per part per moment.
// ---------------------------------------------------------------------------
function row(part, text, sortOrder, section, extra) {
  return Object.assign({ id: 'r' + sortOrder + part, part: part, text: text, sortOrder: sortOrder,
                         barStart: null, barEnd: null, section: section || '', sustained: false }, extra || {});
}
const ROWS = [
  row('both',    'Said the night wind to the little lamb', 0, 'Verse 1'),
  row('women',   'Do you see what I see',                  1, 'Verse 1'),
  row('men',     'Do you see what I see',                  1, 'Verse 1'),
  row('both',    'Way up in the sky',                      2, 'Verse 1', { sustained: true }),
  row('Soprano', 'A star, a star',                         3, 'Chorus'),
  row('Alto',    'Dancing in the night',                   3, 'Chorus'),
  row('men',     'With a tail as big as a kite',           4, 'Chorus')
];

// What the parser makes of a text, reduced to what the page cares about.
function shape(parsed) {
  return V.group(parsed).map(g => ({
    section: g.section || '',
    both: g.both ? [g.both.text, !!g.both.sustained] : null,
    parts: Object.keys(g.byPart || {}).sort().map(k => [k, g.byPart[k].text, !!g.byPart[k].sustained])
  }));
}

function fresh() {
  const calls = { replaceAll: [], forSong: [], toasts: [], render: 0, confirms: 0, prompts: 0 };
  const paint = { n: 0 };
  const cache = {};
  const windowStub = {
    lhcVoiceLines: V,
    STATE: { songs: [{ id: 'song_a', title: 'Carol', voiceLayout: null }] },
    SBQ_VOICE_LINES: {
      replaceAll: (id, rows) => { calls.replaceAll.push([id, rows]); return Promise.resolve(); },
      forSong: (id) => { calls.forSong.push(id); return Promise.resolve(calls.fresh || []); }
    }
  };
  const doc = { getElementById: () => null, querySelector: () => null, addEventListener() {}, removeEventListener() {} };
  const api = make(windowStub, doc,
    (msg, kind) => calls.toasts.push([msg, kind]),
    () => { calls.confirms++; return true; },
    () => { calls.prompts++; return null; },
    () => { calls.render++; },
    cache, [{ id: 'song_a__copy', voiceLayout: null }], () => {}, paint);
  return { api, calls, paint, cache, windowStub };
}

// ---------------------------------------------------------------------------
console.log('\nrows become sections of moments of lines');
{
  const { api } = fresh();
  const m = api.fromRows(ROWS);
  check('one section per [Section], in order', m.sections.map(s => s.name), ['Verse 1', 'Chorus']);
  check('the first section opens, the rest start closed', m.sections.map(s => s.open), [true, false]);
  check('a moment per sortOrder', m.sections.map(s => s.moments.length), [3, 2]);
  check('women and men sharing a moment are two lines of it',
    m.sections[0].moments[1].lines.map(l => [l.part, l.text]),
    [['women', 'Do you see what I see'], ['men', 'Do you see what I see']]);
  check('a held note keeps its hold', m.sections[0].moments[2].lines[0].sustained, true);
  check('everyone\'s line is the part "both"', m.sections[0].moments[0].lines[0].part, 'both');
  check('the parts the song uses, in the order they appear, "both" excluded',
    m.parts, ['women', 'men', 'Soprano', 'Alto']);
}

console.log('\nthe round trip: untouched, the editor saves what the old editor saved');
{
  const { api } = fresh();
  const viaEditor = V.parseVoiceText(api.toText(api.fromRows(ROWS)));
  const viaTextarea = V.parseVoiceText(V.toVoiceText(ROWS));
  check('the parser sees the same arrangement from both', shape(viaEditor), shape(viaTextarea));
  check('and it is the arrangement the rows described', shape(viaEditor), shape(ROWS));
  check('seven rows in, seven rows out', viaEditor.length, 7);
}

console.log('\nserialising');
{
  const { api } = fresh();
  const m = api.fromRows(ROWS);
  const txt = api.toText(m);
  check('a women\'s line carries W:', /^W: Do you see what I see$/m.test(txt), true);
  check('a men\'s line carries M:', /^M: Do you see what I see$/m.test(txt), true);
  check('a named part carries its name in brackets', /^\[Soprano\] A star, a star$/m.test(txt), true);
  check('a held note carries ~', /^~Way up in the sky$/m.test(txt), true);
  check('everyone\'s line carries nothing', /^Said the night wind to the little lamb$/m.test(txt), true);
  check('a section starts with its name alone on a line', /^\[Chorus\]$/m.test(txt), true);
  check('a blank line separates moments', /Do you see what I see\n\n~Way up/.test(txt), true);
  check('lines in a moment touch', /^W: Do you see what I see\nM: Do you see what I see$/m.test(txt), true);
  // A newline typed into a line would start a new moment on the way back
  // in; it is folded to a space instead.
  m.sections[0].moments[0].lines[0].text = 'Said the night wind\nto the little lamb';
  check('a newline inside a line does not split the moment',
    V.group(V.parseVoiceText(api.toText(m)))[0].both.text, 'Said the night wind to the little lamb');
  // An empty line is nothing to sing, and a section with nothing in it is
  // not a section.
  m.sections[0].moments[0].lines[0].text = '';
  m.sections[1].moments.forEach(mo => mo.lines.forEach(l => { l.text = ''; }));
  const s = shape(V.parseVoiceText(api.toText(m)));
  check('an emptied line leaves no row', s.length, 2);
  check('an emptied section leaves no section', s.map(x => x.section), ['Verse 1', 'Verse 1']);
}

console.log('\nadding a part to a moment');
{
  const { api, paint } = fresh();
  api.ed = Object.assign({ base: 'song_a', sid: 'song_a__copy', reorder: false, dirty: false }, api.fromRows(ROWS));
  const sec = api.ed.sections[0];
  const soloMen = { id: 'mX', lines: [{ id: 'lX', part: 'men', text: 'Low', sustained: false }] };
  sec.moments.push(soloMen);
  api.addPart(sec.id, 'mX', 'women');
  check('the women join a moment the men have to themselves',
    soloMen.lines.map(l => l.part), ['men', 'women']);
  const before = sec.moments.length;
  api.addPart(sec.id, 'mX', 'men');
  check('a second men\'s line cannot share their moment: it starts the next one',
    [soloMen.lines.length, sec.moments.length - before], [2, 1]);
  api.addPart(sec.id, 'mX', 'both');
  check('everyone cannot share a moment with a named part either',
    [soloMen.lines.length, sec.moments.length - before], [2, 2]);
  check('every edit marks the arrangement dirty and repaints', [api.ed.dirty, paint.n > 0], [true, true]);
  api.addPart(sec.id, null, 'Descant');
  check('a part the song did not have is switched on by using it', api.ed.parts.indexOf('Descant') > -1, true);
}

console.log('\ncycling a line through the parts');
{
  const { api, calls } = fresh();
  api.ed = Object.assign({ base: 'song_a', sid: 'song_a__copy', reorder: false, dirty: false }, api.fromRows(ROWS));
  const pair = api.ed.sections[0].moments[1];          // women + men
  const women = pair.lines[0];
  api.cycle(women.id);
  check('a line in a shared moment skips the part already singing and skips "everyone"',
    women.part, 'Soprano');
  const solo = api.ed.sections[0].moments[0].lines[0];  // both, alone
  api.cycle(solo.id);
  check('a line alone in its moment can become a named part', solo.part, 'women');
  for (let i = 0; i < 4; i++) api.cycle(solo.id);
  check('and comes back round to everyone', solo.part, 'both');
  const full = { id: 'mF', lines: [{ id: 'f1', part: 'women', text: 'a' }, { id: 'f2', part: 'men', text: 'b' },
                                   { id: 'f3', part: 'Soprano', text: 'c' }, { id: 'f4', part: 'Alto', text: 'd' }] };
  api.ed.sections[0].moments.push(full);
  api.cycle('f1');
  check('with every part singing there is nowhere to go, and it says so',
    [full.lines[0].part, calls.toasts.length], ['women', 1]);
}

console.log('\nremoving');
{
  const { api, calls } = fresh();
  api.ed = Object.assign({ base: 'song_a', sid: 'song_a__copy', reorder: false, dirty: false }, api.fromRows(ROWS));
  const sec = api.ed.sections[0];
  const n = sec.moments.length;
  api.del(sec.moments[0].lines[0].id);
  check('deleting the only line of a moment removes the moment', sec.moments.length, n - 1);
  check('a line with words asks first', calls.confirms, 1);
  api.toggle('men');
  check('turning a part off removes its lines everywhere',
    api.ed.sections.every(s => s.moments.every(m => m.lines.every(l => l.part !== 'men'))), true);
  check('and a moment it was alone in', api.ed.sections[1].moments.length, 1);
  check('and the part itself', api.ed.parts, ['women', 'Soprano', 'Alto']);
  api.toggle('men');
  check('turning it back on asks nothing and brings no lines back',
    [api.ed.parts.indexOf('men') > -1, calls.confirms], [true, 2]);
}

console.log('\nduplicating and moving');
{
  const { api } = fresh();
  api.ed = Object.assign({ base: 'song_a', sid: 'song_a__copy', reorder: false, dirty: false }, api.fromRows(ROWS));
  const sec = api.ed.sections[0];
  api.dup(sec.moments[0].lines[0].id);
  check('a duplicated line becomes the next moment, not a second line of this one',
    sec.moments.slice(0, 2).map(m => m.lines.map(l => l.text)),
    [['Said the night wind to the little lamb'], ['Said the night wind to the little lamb']]);
  const copy = sec.moments[1];
  api.move(copy.id, 1);
  check('a moment moves down past the next', sec.moments.indexOf(copy), 2);
  api.move(copy.id, -1); api.move(copy.id, -1); api.move(copy.id, -1);
  check('and stops at the top', sec.moments.indexOf(copy), 0);
  api.dupSec(sec.id);
  check('a duplicated section follows its original with the next free number',
    api.ed.sections.map(s => s.name), ['Verse 1', 'Verse 2', 'Chorus']);
  check('with its own ids, so an edit to one is not an edit to both',
    api.ed.sections[1].moments[0].lines[0].id !== api.ed.sections[0].moments[0].lines[0].id, true);
}

console.log('\nnaming a new section');
{
  const { api } = fresh();
  api.ed = Object.assign({ base: 'song_a', sid: 'song_a__copy', reorder: false, dirty: false }, api.fromRows(ROWS));
  api.addSection('Verse');
  api.addSection('Chorus');
  api.addSection('Bridge');
  check('verses are numbered on, choruses get a 2, a new name is just itself',
    api.ed.sections.map(s => s.name), ['Verse 1', 'Chorus', 'Verse 2', 'Chorus 2', 'Bridge']);
  check('a new section opens with one line for everyone, and the others close',
    [api.ed.sections.map(s => s.open), api.ed.sections[4].moments[0].lines[0].part],
    [[false, false, false, false, true], 'both']);
  check('next-name arithmetic', [api.nextName('Verse 2'), api.nextName('Chorus'), api.nextName('Bridge'), api.nextName('')],
    ['Verse 3', 'Chorus 3', 'Bridge 2', '']);
}

console.log('\nsaving');
(async () => {
  const tick = () => new Promise(r => setImmediate(r));
  {
    const { api, calls, cache, windowStub } = fresh();
    api.ed = Object.assign({ base: 'song_a', sid: 'song_a__copy', reorder: false, dirty: true }, api.fromRows(ROWS));
    calls.fresh = [row('both', 'fresh from the database', 0, 'Verse 1')];
    api.save();
    for (let i = 0; i < 8; i++) await tick();
    check('the rows go to replaceAll for the base song', calls.replaceAll.map(c => c[0]), ['song_a']);
    check('and they are the parsed arrangement', shape(calls.replaceAll[0][1]), shape(ROWS));
    check('then the song is re-read, so the cache carries the database\'s ids',
      [calls.forSong, cache.song_a.map(r => r.text)], [['song_a'], ['fresh from the database']]);
    check('the library copy now knows it is a song with parts', windowStub.STATE.songs[0].voiceLayout, 'two-part');
    check('the book is redrawn once and the editor is closed', [calls.render, api.ed], [1, null]);
    check('and it says so', calls.toasts.map(t => t[1]), ['success']);
  }
  {
    const { api, calls } = fresh();
    api.ed = { base: 'song_a', sid: 'song_a__copy', sections: [{ id: 's', name: 'Verse 1', open: true,
               moments: [{ id: 'm', lines: [{ id: 'l', part: 'both', text: '   ', sustained: false }] }] }], parts: [], dirty: true };
    api.save();
    for (let i = 0; i < 8; i++) await tick();
    // Asserted by side effect, not by the message: a save that was refused
    // must not have written anything.
    check('an arrangement with nothing in it is refused before anything is written',
      [calls.replaceAll.length, calls.render, calls.toasts.map(t => t[1])], [0, 0, ['error']]);
    check('and the editor stays open', api.ed !== null, true);
  }
  {
    const { api, calls, windowStub } = fresh();
    windowStub.SBQ_VOICE_LINES.replaceAll = () => Promise.reject(new Error('offline'));
    const origErr = console.error; console.error = () => {};
    api.ed = Object.assign({ base: 'song_a', sid: 'song_a__copy', reorder: false, dirty: true }, api.fromRows(ROWS));
    api.save();
    for (let i = 0; i < 8; i++) await tick();
    console.error = origErr;
    check('a failed write keeps the editor open with its edits, and says it failed',
      [api.ed !== null, calls.render, calls.toasts.map(t => t[1])], [true, 0, ['error']]);
  }

  // Another screen's save: the library's Choir parts tab hands the dialog
  // its rows and takes the text back. Nothing may be written from here.
  {
    const { api, calls } = fresh();
    calls.onSave = [];
    api.ed = Object.assign({ base: 'song_a', sid: 'song_a__copy', reorder: false, dirty: true,
      onSave: (t, parsed) => calls.onSave.push([t, parsed.length]) }, api.fromRows(ROWS));
    api.save();
    for (let i = 0; i < 8; i++) await tick();
    check('another screen\'s save gets the text and the rows, and nothing is written from here',
      [calls.onSave.length, calls.onSave[0] && calls.onSave[0][1], calls.replaceAll.length, calls.render], [1, 7, 0, 0]);
    check('and the text it gets is the arrangement', shape(V.parseVoiceText(calls.onSave[0][0])), shape(ROWS));
    check('the editor closes without asking, the save being theirs', [api.ed, calls.confirms], [null, 0]);
  }
  {
    const { api, calls } = fresh();
    calls.onSave = [];
    api.ed = { base: 'song_a', sid: 'song_a__copy', dirty: true, onSave: (t) => calls.onSave.push(t), parts: [],
      sections: [{ id: 's', name: 'Verse 1', open: true, moments: [{ id: 'm', lines: [{ id: 'l', part: 'both', text: '  ', sustained: false }] }] }] };
    api.save();
    for (let i = 0; i < 8; i++) await tick();
    check('an empty arrangement is refused before another screen is handed it', [calls.onSave.length, api.ed !== null], [0, true]);
  }
  {
    const { api, calls } = fresh();
    calls.onText = [];
    api.ed = Object.assign({ base: 'song_a', sid: 'song_a__copy', reorder: false, dirty: true, onText: (t) => calls.onText.push(t) }, api.fromRows(ROWS));
    api.handText();
    check('"Edit as text" hands over the arrangement as the textarea grammar and closes without asking',
      [calls.onText.length, api.ed, calls.confirms], [1, null, 0]);
    check('and what it hands over parses back to the same rows', shape(V.parseVoiceText(calls.onText[0])), shape(ROWS));
  }

  const failed = results.filter(r => !r).length;
  console.log('\n' + (failed ? failed + ' of ' + results.length + ' checks FAILED' : 'All ' + results.length + ' checks passed.'));
  process.exit(failed ? 1 : 0);
})();
