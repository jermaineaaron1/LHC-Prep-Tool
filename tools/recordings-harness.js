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
let renderSrc, ownCountSrc, catOfSrc, forgetSrc;
try {
  renderSrc = extract(/^  function sbRenderRecordings\(/, 'sbRenderRecordings');
  ownCountSrc = extract(/^  function _sbOwnRecCount\(/, '_sbOwnRecCount');
  catOfSrc = extract(/^  function _sbRecCatOf\(/, '_sbRecCatOf');
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
  catOfSrc + '\n' + renderSrc + '\n' + ownCountSrc + '\n' +
  'var lhcVoiceRec = { _takes: {}, _drafts: {}, ' + forgetSrc + ' };\n' +
  'window.lhcVoiceRec = lhcVoiceRec;\n' +
  'return { sbRenderRecordings: sbRenderRecordings, _sbOwnRecCount: _sbOwnRecCount, rec: lhcVoiceRec };';

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

const passed = results.filter(Boolean).length;
console.log('\n' + '='.repeat(58));
console.log(passed + '/' + results.length + ' checks passed');
if (EXPECT_BROKEN && passed === results.length) {
  console.log('\nBUT --expect-broken was given and everything passed.');
  process.exit(1);
}
process.exit(passed === results.length ? 0 : 1);
