'use strict';
// Regression harness for practice recordings: what is listed, what counts
// against the limit, and what is forgotten when a take is deleted.
//
// WHY THIS EXISTS
// There are TWO recorders writing to one table. The choir view records a
// line at a time and sets song_recordings.line_id; the songbook panel
// records whole run-throughs and leaves it null. The panel lists both on
// purpose -- a singer wants every take for a song in one place -- and that
// is where it went wrong: it also COUNTED both against its limit of ten,
// and it checked that limit only after the take had been sung.
//
// Measured before the fix, against a container holding ten line takes:
// listEl.querySelectorAll('.sb-rec-item').length === 10, the counter read
// "(10/10)", and _sbSaveRecording refused with "Max 10 recordings per
// song". Ten takes made from the choir view stopped the songbook from
// recording anything at all, and the proof of it was a recording the
// operator had already made being thrown away.
//
// THE DANGEROUS DIRECTION
// Over-counting blocks a recording; under-counting lets the list grow past
// what the panel can show. Of the two, the blocking one is what bit, and
// it bit silently -- so the checks that matter most here are the ones
// proving a line take is listed but does NOT count.
//
// USAGE
//   node tools/recordings-harness.js                 # ../Index.html
//   node tools/recordings-harness.js path/to/file.html
//   node tools/recordings-harness.js <file> --expect-broken
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');
const { makeDocument } = require('./minidom.js');

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
function extract(pattern, name, optional) {
  const startIdx = lines.findIndex(l => pattern.test(l));
  if (startIdx < 0) {
    if (optional) return null;
    throw new Error('not found: ' + name);
  }
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

// ---------------------------------------------------------------------------
// The sliced source.
// ---------------------------------------------------------------------------
let renderSrc, ownCountSrc, catOfSrc, forgetSrc, baseIdSrc;
try {
  renderSrc = extract(/^  function sbRenderRecordings\(/, 'sbRenderRecordings');
  ownCountSrc = extract(/^  function _sbOwnRecCount\(/, '_sbOwnRecCount');
  catOfSrc = extract(/^  function _sbRecCatOf\(/, '_sbRecCatOf');
  baseIdSrc = extract(/^  function _sbBaseSongId\(/, '_sbBaseSongId');
} catch (e) {
  if (EXPECT_BROKEN) {
    console.log('--expect-broken: ' + e.message + ', as expected.');
    process.exit(0);
  }
  throw e;
}

const catsLine = lines.find(l => /var _SB_REC_CATS = \{/.test(l));
if (!catsLine) throw new Error('not found: _SB_REC_CATS');

// window.lhcVoiceRec.forget, sliced out of the module literal.
const recStart = lines.findIndex(l => /^window\.lhcVoiceRec = \{/.test(l));
if (recStart < 0) {
  if (EXPECT_BROKEN) {
    console.log('--expect-broken: window.lhcVoiceRec is absent, as expected.');
    process.exit(0);
  }
  throw new Error('not found: window.lhcVoiceRec');
}
{
  const fStart = lines.findIndex((l, i) => i > recStart && /^  forget: function\(id\) \{/.test(l));
  if (fStart < 0) {
    if (EXPECT_BROKEN) {
      console.log('--expect-broken: lhcVoiceRec.forget is absent, as expected.');
      process.exit(0);
    }
    throw new Error('not found: lhcVoiceRec.forget');
  }
  let depth = 0, started = false, out = [];
  for (let i = fStart; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) { forgetSrc = out.join('\n').replace(/,\s*$/, ''); break; }
  }
}

// window.lhcVoiceRec._takeName, the same way.
let takeNameSrc = null;
{
  const tStart = lines.findIndex((l, i) => i > recStart && /^  _takeName: function\(/.test(l));
  if (tStart < 0) {
    if (EXPECT_BROKEN) {
      console.log('--expect-broken: lhcVoiceRec._takeName is absent, as expected.');
      process.exit(0);
    }
    throw new Error('not found: lhcVoiceRec._takeName');
  }
  let depth = 0, started = false, out = [];
  for (let i = tStart; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) { takeNameSrc = out.join('\n').replace(/,\s*$/, ''); break; }
  }
}

// window.lhcVoiceRec._when, the stamp on every take, the same way.
let whenSrc = null;
{
  const wStart = lines.findIndex((l, i) => i > recStart && /^  _when: function\(/.test(l));
  if (wStart < 0) {
    if (EXPECT_BROKEN) {
      console.log('--expect-broken: lhcVoiceRec._when is absent, as expected.');
      process.exit(0);
    }
    throw new Error('not found: lhcVoiceRec._when');
  }
  let depth = 0, started = false, out = [];
  for (let i = wStart; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) { whenSrc = out.join('\n').replace(/,\s*$/, ''); break; }
  }
}

// ---------------------------------------------------------------------------
// A document, and the few globals the sliced code reaches for.
// ---------------------------------------------------------------------------
const doc = makeDocument();
const listEl = doc.createElement('div');
listEl.setAttribute('id', 'sbRecList');
doc.root.appendChild(listEl);
const cntEl = doc.createElement('div');
cntEl.setAttribute('id', 'sbRecCount');
doc.root.appendChild(cntEl);
const byId = { sbRecList: listEl, sbRecCount: cntEl };

const sandbox = {
  document: { getElementById: id => byId[id] || null },
  escapeHtml: s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
  _sbFmtDur: sec => { sec = Math.round(sec || 0); const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; },
  window: {}
};

const body =
  catsLine.replace(/\r$/, '').trim() + '\n' +
  'function _sbRecCatLabel(cat) { return _SB_REC_CATS[cat] || "General"; }\n' +
  catOfSrc + '\n' + renderSrc + '\n' + ownCountSrc + '\n' + baseIdSrc + '\n' +
  'var lhcVoiceRec = { _takes: {}, _drafts: {}, ' + forgetSrc + ', ' + takeNameSrc + ', ' + whenSrc + ' };\n' +
  'window.lhcVoiceRec = lhcVoiceRec;\n' +
  'return { sbRenderRecordings: sbRenderRecordings, _sbOwnRecCount: _sbOwnRecCount, rec: lhcVoiceRec, baseId: _sbBaseSongId };';

const S = new Function('document', 'escapeHtml', '_sbFmtDur', 'window', body)(
  sandbox.document, sandbox.escapeHtml, sandbox._sbFmtDur, sandbox.window);

// ---------------------------------------------------------------------------
const own = (i) => ({
  id: 'own' + i, song_id: 's1', line_id: null,
  name: 'Run-through ' + i, duration_sec: 30,
  storage_path: 'practice-recordings/s1/draft__' + (1000 + i) + '.webm'
});
const lineTake = (i) => ({
  id: 'ln' + i, song_id: 's1', line_id: 400 + i,
  name: 'Women take ' + i, duration_sec: 3,
  storage_path: 'practice-recordings/s1/women__' + (2000 + i) + '.webm'
});
// A take of a whole SECTION has no line_id either, but it is the choir's,
// not a run-through: the panel lists it, marks it, and does not count it.
const sectionTake = (i) => ({
  id: 'sec' + i, song_id: 's1', line_id: null, section: 'Verse ' + i,
  name: 'Women take ' + i, duration_sec: 12,
  storage_path: 'practice-recordings/s1/women__' + (3000 + i) + '.webm'
});

console.log('\nthe panel lists both recorders, and counts only its own');

S.sbRenderRecordings('s1', Array.from({ length: 10 }, (_, i) => lineTake(i)));
check('ten line takes are all listed',
  listEl.querySelectorAll('.sb-rec-item').length, 10);
check('  and none of them counts against the limit', S._sbOwnRecCount(), 0);
check('  so the panel can still record', S._sbOwnRecCount() < 10, true);
check('  and the counter says so', cntEl.textContent, '(0/10)');

S.sbRenderRecordings('s1', [own(1), own(2), lineTake(1), lineTake(2), lineTake(3)]);
check('a mixed list shows every take', listEl.querySelectorAll('.sb-rec-item').length, 5);
check('  of which two are the panel own', S._sbOwnRecCount(), 2);
check('  and the counter counts those', cntEl.textContent, '(2/10)');
check('  the line takes carry the marker',
  listEl.querySelectorAll('.sb-rec-item[data-line-take="1"]').length, 3);

S.sbRenderRecordings('s1', [own(1), own(2), sectionTake(1), lineTake(1)]);
check('a take of a whole section is listed with the rest',
  listEl.querySelectorAll('.sb-rec-item').length, 4);
check('  but it is the choir view too, so it carries the marker',
  listEl.querySelectorAll('.sb-rec-item[data-line-take="1"]').length, 2);
check('  and does not count against the panel limit', S._sbOwnRecCount(), 2);
check('  nor in the counter', cntEl.textContent, '(2/10)');
check('  and its name says which section',
  (/<span class="sb-rec-item-sec">([^<]*)<\/span>/.exec(listEl.innerHTML) || [])[1], 'Verse 1');
check('a take is stamped with the time, then the date with its year',
  S.rec._when(new Date(2026, 9, 28, 22, 19).toISOString()), '22:19, 28 Oct 2026');

S.sbRenderRecordings('s1', Array.from({ length: 10 }, (_, i) => own(i)));
check('ten of the panel own DO reach the limit', S._sbOwnRecCount(), 10);
check('  which is what stops another being recorded', S._sbOwnRecCount() >= 10, true);

S.sbRenderRecordings('s1', []);
check('an empty song lists nothing', listEl.querySelectorAll('.sb-rec-item').length, 0);
check('  and shows no counter', cntEl.textContent, '');

console.log('\nthe label on a take says which voice sang it');
// The category is read off the storage path, which is how a line take made
// by the choir view gets a WOMEN chip instead of being filed under General.
S.sbRenderRecordings('s1', [lineTake(1), own(1)]);
check('a women take is not filed under General',
  /sb-rec-cat--women/.test(listEl.innerHTML), true);
check('a run-through is', /sb-rec-cat--general/.test(listEl.innerHTML), true);

console.log('\na deleted take is forgotten everywhere it was held');
// The same row can be in two stores at once -- a song open in the preview
// and the same song on a songbook page -- and it is also deleted from the
// OTHER panel, which knows nothing about this store.
const R = S.rec;
R._takes = {
  s1: { '401': [{ id: 'x' }, { id: 'y' }], '402': [{ id: 'z' }] },
  s2: { '500': [{ id: 'x' }] }
};
R._drafts = { s1: [{ id: 'd1' }, { id: 'x' }], s2: [] };
R.forget('x');
check('gone from the first song takes', R._takes.s1['401'].map(t => t.id), ['y']);
check('gone from a DIFFERENT song too', R._takes.s2['500'], []);
check('gone from the drafts as well', R._drafts.s1.map(t => t.id), ['d1']);
check('and nothing else was touched', R._takes.s1['402'].map(t => t.id), ['z']);
R.forget('nope');
check('forgetting something absent is harmless',
  [R._takes.s1['402'].length, R._drafts.s1.length], [1, 1]);

console.log('\nwhich song a take is filed against');
// Found in live data: two of the operator's own recordings stored with
// song_id "sbsong_song_1793116967624_0" -- the songbook ITEM id, not the
// song. Nothing could ever find them again: the choir view loads by the
// library id and so does every other songbook the song appears in.
//
// Both recorder paths built the id by chopping the item id at '--', which
// is right for an order-backed songbook and does nothing whatever for a
// standalone one. _sbBaseSongId had existed the whole time.
check('an order-backed item yields the song it is of',
  S.baseId({ id: 'song_123--verse2' }), 'song_123');
check('a standalone item is not chopped at --',
  S.baseId({ id: 'sbsong_song_123_0', songId: 'song_123' }), 'song_123');
// The shape that actually bit: chopping leaves the item id untouched, so
// the take is filed under a song that does not exist and never surfaces.
check('  chopping one would have filed it under a song that does not exist',
  'sbsong_song_123_0'.split('--')[0], 'sbsong_song_123_0');
check('songId beats anything parsed out of the id',
  S.baseId({ id: 'song_999--x', songId: 'song_123' }), 'song_123');
check('nothing in, empty string out', S.baseId(null), '');

// ---------------------------------------------------------------------------
// What a take is called. Every take on a line of a named part -- Melody,
// 1st Part, 2nd Part -- was "Take take 1", because the name knew only the
// two lanes. The chip on the line is what the singer reads, so it is what
// the take is named after.
// ---------------------------------------------------------------------------
const nm = S.rec._takeName;
check('a line of a named part is named after the part', nm(false, 'general', '2nd Part', 1), '2nd Part take 1');
check('a women\'s line, after its chip', nm(false, 'women', 'Women', 2), 'Women take 2');
check('a chip that cannot be read falls back to the lane', nm(false, 'men', '', 3), 'Men take 3');
check('and never to "Take take"', nm(false, 'general', '', 1), 'Line take 1');
check('a whole-song take is a run-through', nm(true, 'general', '', 3), 'Run-through 3');
check('an imported file keeps its own name, without the extension',
  nm(false, 'general', '2nd Part', 1, 'chorus-alto-take3.mp3'), 'chorus-alto-take3');

const passed = results.filter(Boolean).length;
console.log('\n' + '='.repeat(58));
console.log(passed + '/' + results.length + ' checks passed');
if (EXPECT_BROKEN && passed === results.length) {
  console.log('\nBUT --expect-broken was given and everything passed.');
  process.exit(1);
}
process.exit(passed === results.length ? 0 : 1);
