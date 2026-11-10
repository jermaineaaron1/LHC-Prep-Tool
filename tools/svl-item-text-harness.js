'use strict';
// Harness for reading a part's words in "Load a whole liturgy" (2026-11-08).
// From the operator:
//
//   1. On a card, only the date is bold; the rest of that line is plain.
//   2. In a liturgy's preview, clicking or tapping a part (Invocation, a
//      confession, a song, a reading...) shows the words inside it.
//   3. The window a little taller.
//
// The words are set as the Export sets them (_lbdExportParas): who speaks,
// the people's lines bold, a reading's verse numbers raised, a song's words
// from the song library with its chords taken out.
//
// USAGE
//   node tools/svl-item-text-harness.js
//   node tools/svl-item-text-harness.js <file> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8');
const lines = SRC.split('\n');

function extractFn(name) {
  const startIdx = lines.findIndex(l => new RegExp('^  function ' + name + '\\s*\\(').test(l));
  if (startIdx < 0) throw new Error('function not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}
function extractVar(name) {
  const l = lines.find(x => new RegExp('^  var ' + name + '\\b').test(x));
  if (!l) throw new Error('var not found: ' + name);
  return l;
}
const fn = n => { try { return extractFn(n); } catch (e) { return ''; } };
const has = re => re.test(SRC);

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

// The pure pieces, in a scope of their own. The song library and the chord
// detector are stand-ins: a chord line here is one made only of chords.
let V = null;
try {
  V = new Function('window', 'isChordLineGlobal',
    'function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\'/g, "&#39;"); }\n' +
    extractVar('_LBD_SPK') + '\n' + extractVar('_LBD_SPK_PEOPLE') + '\n' +
    ['_lbdEsc', '_woStripNum', '_lbdLibSong', '_lbdExportParas', '_lbdVerseRuns', '_svlOutline', '_svlItemTexts', '_svlItemHtml', '_svlOutlineHtml', '_svlItemToggle'].map(extractFn).join('\n') +
    '\nreturn { outline: _svlOutline, texts: _svlItemTexts, html: _svlItemHtml, outlineHtml: _svlOutlineHtml, toggle: _svlItemToggle };')(
    { LHC_STATE: { songs: [{ id: 'lib1', title: 'Here I Am, Lord', lyrics: '[Verse 1]\nC      G\nI, the Lord of sea and sky\nI have heard my people cry\n\n[Chorus]\nHere I am, Lord' }] } },
    line => /^[\sA-G#bm7susdim/()0-9]+$/.test(line) && /[A-G]/.test(line));
} catch (e) { console.log('  (could not build the pieces: ' + e.message + ')'); }

const data = {
  sectionLayout: [{ id: 'wo-section-0', title: '1. Invocation' }, { id: 'wo-section-1', title: 'Praise & Worship' }, { id: 'wo-section-2', title: 'Scripture Readings' }, { id: 'wo-section-3', title: 'Sermon' }],
  items: [
    { itemType: 'liturgy', sectionId: 'wo-section-0', title: 'Invocation', slides: [{ content: 'L: In the Name of the Father and of the Son and of the Holy Spirit.\nC: Amen.' }] },
    { itemType: 'scripture', sectionId: 'wo-section-2', title: 'Isaiah 61:10', slides: [{ content: '[10] I will greatly rejoice in the Lord; [11] For as the earth' }] },
    { itemType: 'content', sectionId: 'wo-section-3', title: 'Slide', content: { text: 'Sermon: <Grace>' } },
    { itemType: 'liturgy', sectionId: 'wo-section-3', title: 'Empty', slides: [] }
  ],
  songs: [{ songId: 'lib1', title: 'Here I Am, Lord', sections: ['wo-section-1'] }, { songId: 'gone', title: 'Lost Song', sections: ['wo-section-1'] }]
};

(() => {
  // ------------------------------------------------------------ 1. the date bold, the rest plain
  console.log('\n1. A card\'s line: the date bold, the rest plain');
  const card = fn('_svlCardHtml');
  check('the date (a saved liturgy\'s year) leads the line, in bold', /var lead = saved \? \(x\.year \? String\(x\.year\) : ''\) : \(x\.date \|\| ''\);/.test(card) &&
    /'<div class="svl-card__meta">' \+ \(lead \? '<b class="svl-card__date">' \+ _lbdEsc\(lead\) \+ '<\/b>'/.test(card));
  check('...and only the date: the line itself is plain', has(/\.svl-card__meta \{[^}]*font-weight: 400;/) && has(/\.svl-card__date \{ font-weight: 700;/));

  // ------------------------------------------------------------ 2. the words of a part
  console.log('\n2. A part\'s words');
  if (!V) { check('the pieces build', false); return; }
  const out = V.outline(data);
  check('each part of the outline knows where it is (items, songs)', out[0].items[0].ref === 'i:0' && out[1].items.map(x => x.ref).join(',') === 's:0,s:1' &&
    out[2].items[0].ref === 'i:1' && out[3].items.map(x => x.ref).join(',') === 'i:2,i:3', JSON.stringify(out));
  check('a part\'s words are its slides, else the text it holds', V.texts(data.items[0]).length === 1 && V.texts(data.items[2])[0] === 'Sermon: <Grace>' &&
    V.texts({ content: 'plain' })[0] === 'plain' && V.texts({ slides: [{ content: '  ' }] }).length === 0 && V.texts(null).length === 0);
  const inv = V.html(data, 'i:0');
  check('a liturgy shows who speaks, and the people\'s line bold', /<strong class="svl-tx-who">L:<\/strong> In the Name of the Father/.test(inv) &&
    /<div class="svl-tx-ln is-people"><strong class="svl-tx-who">C:<\/strong> Amen\.<\/div>/.test(inv), inv);
  const rd = V.html(data, 'i:1');
  // (the Export puts a thin space after a raised number)
  check('a reading\'s verse numbers are raised', /<sup>10<\/sup>\s?I will greatly rejoice/.test(rd) && /<sup>11<\/sup>/.test(rd), rd);
  const sg = V.html(data, 's:0');
  check('a song\'s words come from the song library, by section, chords out', /<div class="svl-tx-lbl">Verse 1<\/div>/.test(sg) && /I, the Lord of sea and sky/.test(sg) &&
    /<div class="svl-tx-lbl">Chorus<\/div>/.test(sg) && !/C {6}G/.test(sg), sg);
  check('a song not in the library says so', /This song’s words are not in the song library\./.test(V.html(data, 's:1')));
  check('a part with no words says so, and a bad ref is not a crash', /No words were kept for this part\./.test(V.html(data, 'i:3')) && /No words/.test(V.html(data, 'x:9')) && /No words/.test(V.html(null, 'i:0')));
  check('words are escaped', /Sermon: &lt;Grace&gt;/.test(V.html(data, 'i:2')) && !/<Grace>/.test(V.html(data, 'i:2')));

  // ------------------------------------------------------------ 3. the outline, clickable
  console.log('\n3. The outline: a click shows a part\'s words under its section');
  const oh = V.outlineHtml(data, 'svl-outline', 'WO.lbdSvlItem', 'data-k="o:1"', '');
  check('each part is a button naming where it is and whose outline it is', /<button type="button" class="svl-oi" data-r="i:0" data-k="o:1" aria-expanded="false" title="Show its words" onclick="WO\.lbdSvlItem\(this\)">/.test(oh) &&
    (oh.match(/class="svl-oi/g) || []).length === 6, oh.slice(0, 400));
  check('each section has a place for the words, shut', (oh.match(/<div class="svl-tx" hidden><\/div>/g) || []).length === 4);
  const oo = V.outlineHtml(data, 'svl-outline', 'WO.lbdSvlItem', 'data-k="o:1"', 's:0');
  check('a part kept open is drawn open, its words in place', /class="svl-oi is-on" data-r="s:0"[^>]*aria-expanded="true"/.test(oo) && /<div class="svl-tx">[^]*I, the Lord of sea and sky/.test(oo) &&
    (oo.match(/<div class="svl-tx" hidden>/g) || []).length === 3);
  check('section titles lose their numbers and are escaped', /<li><b>Invocation<\/b>/.test(oh) && /<li><b>Praise &amp; Worship<\/b>/.test(oh));

  // The toggle, on a hand-made outline of two sections.
  function El(cls) { this.cls = new Set(cls ? cls.split(' ') : []); this.attrs = {}; this.kids = []; this.parent = null; this.hidden = false; this.innerHTML = ''; }
  El.prototype.add = function(k) { k.parent = this; this.kids.push(k); return k; };
  El.prototype.all = function(pred) { let r = []; this.kids.forEach(k => { if (pred(k)) r.push(k); r = r.concat(k.all(pred)); }); return r; };
  El.prototype.match = function(sel) {
    if (sel === 'li') return this.tag === 'li'; if (sel === 'ol') return this.tag === 'ol';
    if (sel === '.svl-tx') return this.cls.has('svl-tx'); if (sel === '.svl-oi.is-on') return this.cls.has('svl-oi') && this.cls.has('is-on');
    return false;
  };
  El.prototype.closest = function(sel) { let e = this; while (e) { if (e.match(sel)) return e; e = e.parent; } return null; };
  El.prototype.querySelector = function(sel) { return this.all(k => k.match(sel))[0] || null; };
  El.prototype.querySelectorAll = function(sel) { return this.all(k => k.match(sel)); };
  El.prototype.getAttribute = function(k) { return this.attrs[k] == null ? null : this.attrs[k]; };
  El.prototype.setAttribute = function(k, v) { this.attrs[k] = String(v); };
  Object.defineProperty(El.prototype, 'classList', { get() { const s = this.cls; return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c) }; } });
  const ol = new El(); ol.tag = 'ol';
  const mk = (refs) => { const li = ol.add(new El()); li.tag = 'li'; const span = li.add(new El()); const btns = refs.map(r => { const b = span.add(new El('svl-oi')); b.attrs['data-r'] = r; return b; }); const box = li.add(new El('svl-tx')); box.hidden = true; return { li, btns, box }; };
  const A = mk(['i:0']), B = mk(['s:0', 's:1']);
  let ok = false, detail = '';
  try {
    const r1 = V.toggle(A.btns[0], data);
    const s1 = r1 && !A.box.hidden && /In the Name of the Father/.test(A.box.innerHTML) && A.btns[0].getAttribute('aria-expanded') === 'true';
    const r2 = V.toggle(B.btns[0], data);
    const s2 = r2 && A.box.hidden && A.box.innerHTML === '' && !A.btns[0].classList.contains('is-on') && !B.box.hidden && /sea and sky/.test(B.box.innerHTML);
    const r3 = V.toggle(B.btns[1], data);
    const s3 = r3 && !B.btns[0].classList.contains('is-on') && /not in the song library/.test(B.box.innerHTML);
    const r4 = V.toggle(B.btns[1], data);
    const s4 = r4 === false && B.box.hidden && !B.btns[1].classList.contains('is-on');
    ok = s1 && s2 && s3 && s4; detail = JSON.stringify({ s1, s2, s3, s4 });
  } catch (e) { detail = e.message; }
  check('a click opens a part\'s words, another part takes its place, a second click shuts them', ok, detail);

  const card2 = fn('_svlCardHtml');
  check('the load window\'s preview uses it, says to tap, and keeps the part open over a redraw',
    /_svlOutlineHtml\(d, 'svl-outline', 'WO\.lbdSvlItem', 'data-k="' \+ _lbdEsc\(x\.key\) \+ '"', _svlTx\.indexOf\(x\.key \+ '\|'\) === 0 \? _svlTx\.slice\(x\.key\.length \+ 1\) : ''\)/.test(card2) &&
    /Tap a part to read its words\./.test(card2) && /_svlTx = _svlItemToggle\(btn, x\.kind === 'saved' \? x\.data : _lldData\[x\.id\]\)/.test(fn('lbdSvlItem')));
  check('the Liturgy Library\'s outline of a saved liturgy does the same', /W\.svlOutlineHtml\(d, 'lit-svl-outline', 'LiturgyModule\.occSvlItem'/.test(fn('renderOccSvl')) &&
    /WO\.svlItemToggle\(btn, _occSvlData\[id\]\)/.test(fn('occSvlItem')) && has(/    occSvlItem: occSvlItem,/) &&
    has(/svlOutlineHtml: _svlOutlineHtml, svlItemToggle: _svlItemToggle, lbdSvlItem: lbdSvlItem,/));

  // ------------------------------------------------------------ 4. the window
  console.log('\n4. The window: taller, and it keeps its place');
  check('the load window is a sheet of its own kind, taller than the others', /' lbd-sheet--' \+ state\.kind/.test(fn('_lbdSheet')) &&
    has(/\.lbd-sheet\.lbd-sheet--svl \{ max-height: min\(94vh, 1000px\); \}/) && has(/  \.lbd-sheet\.lbd-sheet--svl \{ max-height: 96vh; \}/));
  check('opening a preview, or a service read, keeps the window where it was scrolled to', /_svlDrawList\(true\)/.test(fn('lbdSvlToggle')) && /_svlDrawList\(true\)/.test(fn('lbdSvlAsk')) &&
    /if \(top\) \{ var b1 = document\.querySelector\('#lbdSheet \.lbd-sheet-body'\); if \(b1\) b1\.scrollTop = top; \}/.test(fn('_svlDrawList')));
  check('a filter still starts at the top', /_svlDrawList\(\);\r?\n  \}/.test(fn('lbdSvlFilter')));
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (EXPECT_BROKEN) {
  if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
  console.log('--expect-broken: failures above are the expected ones');
  process.exit(0);
}
process.exit(fail ? 1 : 0);
