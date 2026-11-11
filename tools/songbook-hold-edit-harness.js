'use strict';
// Harness for the song view's hold-to-draw and double-tap-to-edit, and the
// Songbook's editor dressed as the songbook (2026-11-11, CLAUDE.md gotcha 84).
// From the operator, on a marked-up screenshot: "Hold 2 sec to draw",
// "Double tap to edit", the Type chip crossed out for Edit; the edit pad to
// "highlight and direct (scroll to the part) where the user wants to edit";
// and the editing window to "look exactly like how we see in the songbook
// but make it editable". Book Mode keeps its own gestures (asked).
//
//   1. A hold: a ring at 450ms, the pen at 2s; moving lets it go; on a touch
//      screen a hold let go before the pen picks the line for moving.
//   2. A double-tap: the editor at the line tapped (the choir editor at the
//      moment tapped), never the pen.
//   3. The editor shows the words in the key sung, and the save puts them
//      back in the copy's own key.
//   4. The editor looks like the song view, from the Songbook only.
//
// USAGE
//   node tools/songbook-hold-edit-harness.js
//   node tools/songbook-hold-edit-harness.js <Index.html> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const files = args.filter(a => !a.startsWith('--'));
const INDEX = files[0] || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8');
const LF = SRC.replace(/\r\n/g, '\n');

function extractFrom(text, startRe) {
  const ls = text.split('\n');
  const startIdx = ls.findIndex(l => startRe.test(l));
  if (startIdx < 0) throw new Error('not found: ' + startRe);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < ls.length; i++) {
    out.push(ls[i]);
    for (const ch of ls[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced braces: ' + startRe);
}
const fn = n => { try { return extractFrom(LF, new RegExp('^\\s*function ' + n + '\\s*\\(')); } catch (e) { return ''; } };
const has = re => re.test(LF);

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}
function run(label, f) { try { f(); } catch (e) { check(label, false, e.message); } }

// Stand-ins for the chord detector and the transposer: a line of chord
// names is a chord line; a step moves each name along the scale.
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const STUBS = `
  function isChordLineGlobal(l) { return /^\\s*[A-G]/.test(l) && String(l).trim().split(/\\s+/).every(function(t) { return /^[A-G][#b]?(m|sus|7)?\\d*$/.test(t); }); }
  var NOTES = ${JSON.stringify(NOTES)};
  function sbTransposeChordLine(line, n) {
    return line.replace(/[A-G]#?/g, function(r) { var i = NOTES.indexOf(r); return i < 0 ? r : NOTES[((i + n) % 12 + 12) % 12]; });
  }`;

// ------------------------------------------------------------ 1. the hold
console.log('\n1. Holding the words: a ring, then the pen; a finger picks a line');
run('the hold', () => {
  const env = new Function('ctx', `
    var _sbmHold = null, _sbmDraw = null, _sbNp = null, _sbmPageView = false, _sbmMarksOk = ctx.marks;
    var _SBM_HOLD_DRAW_MS = 2000, _SBM_HOLD_RING_MS = 450;
    var document = ctx.document, window = ctx.window, navigator = {};
    function setTimeout(f, ms) { ctx.timers.push({ f: f, at: ctx.now + ms, id: ctx.timers.length + 1 }); return ctx.timers.length; }
    function clearTimeout(id) { ctx.timers.forEach(function(t) { if (t.id === id) t.dead = true; }); }
    function _sbmDblCard(t) { return t && t.card ? t.card : null; }
    function _sbmXpPickable(card, t) { return t.pickable ? 3 : -1; }
    function _sbmXpPick(card, t) { ctx.log.push('pick'); return true; }
    function _sbmMarksSupport() { return { then: function(f) { f(true); } }; }
    function sbmDraw(on) { ctx.log.push('draw'); _sbmDraw = {}; }
    function showToast() {}
    ${fn('_sbmHoldStart')}
    ${fn('_sbmHoldMove')}
    ${fn('_sbmHoldEnd')}
    ${fn('_sbmHoldRing')}
    ${fn('_sbmHoldRingOff')}
    ${fn('_sbmHoldFire')}
    ${fn('_sbmHoldDraw')}
    return { start: _sbmHoldStart, move: _sbmHoldMove, end: _sbmHoldEnd, hold: function() { return _sbmHold; }, undraw: function() { _sbmDraw = null; } };`);
  const mk = (marks) => {
    const ctx = { marks, now: 0, timers: [], log: [], rings: [] };
    const el = () => {
      const e = { className: '', style: { setProperty(k, v) { e.style[k] = v; } }, textContent: '', parentNode: null,
        setAttribute() {}, getBoundingClientRect: () => ({ left: 100, right: 200 }),
        querySelector: () => ({ style: {}, getBoundingClientRect: () => ({ left: 100, right: 200 }) }) };
      Object.defineProperty(e, 'innerHTML', { set(v) { e.textContent = v.replace(/<[^>]+>/g, ''); }, get() { return ''; } });
      return e;
    };
    ctx.document = { createElement: () => el(), body: { appendChild(x) { x.parentNode = { removeChild() { x.parentNode = null; } }; ctx.rings.push(x); } } };
    ctx.window = { getSelection: () => ({ removeAllRanges() {} }), innerWidth: 400 };
    ctx.tick = (ms) => { ctx.now += ms; ctx.timers.filter(t => !t.dead && !t.done && t.at <= ctx.now).sort((a, b) => a.at - b.at).forEach(t => { t.done = true; t.f(); }); };
    ctx.ringOn = () => ctx.rings.some(r => r.parentNode);
    return ctx;
  };
  const words = { card: {}, pickable: true }, chordless = { card: {}, pickable: false };
  const down = (type, target, extra) => Object.assign({ pointerType: type, isPrimary: true, button: 0, clientX: 50, clientY: 300, target }, extra || {});

  let ctx = mk(true), E = env(ctx);
  E.start(down('mouse', words)); ctx.tick(300);
  check('nothing to see in the first moment (a click is a click)', !ctx.ringOn() && !ctx.log.length);
  ctx.tick(200);
  check('a ring at 450ms, saying what keeps happening', ctx.ringOn() && /Keep holding to draw/.test(ctx.rings[0].textContent) && ctx.rings[0].style['--sbm-hold'] === '1550ms');
  ctx.tick(1500);
  check('the pen at two seconds, and the ring gone', ctx.log.join() === 'draw' && !ctx.ringOn());
  check('...letting go then is not a tap as well', E.end(true) === true && E.hold() === null);

  ctx = mk(true); E = env(ctx);
  E.start(down('mouse', words)); ctx.tick(600); E.move({ clientX: 62, clientY: 300 }); ctx.tick(2000);
  check('a mouse that moves (selecting) lets it go: no pen', !ctx.log.length && !ctx.ringOn() && E.hold() === null);
  ctx = mk(true); E = env(ctx);
  E.start(down('mouse', words)); ctx.tick(600); E.move({ clientX: 55, clientY: 306 }); ctx.tick(1500);
  check('...a hand that trembles (under 10px) does not', ctx.log.join() === 'draw');

  ctx = mk(true); E = env(ctx);
  E.start(down('touch', words)); ctx.tick(1000);
  check('a finger on a line with chords: the ring offers both', /Let go to pick this line/.test(ctx.rings[0].textContent) && /draw/.test(ctx.rings[0].textContent));
  check('let go before the pen: the line is picked, and that is no tap', E.end(true) === true && ctx.log.join() === 'pick');
  ctx.tick(2000);
  check('...and the pen does not come later', ctx.log.join() === 'pick');

  ctx = mk(true); E = env(ctx);
  E.start(down('touch', words)); ctx.tick(200);
  check('a quick tap picks nothing and draws nothing (it may be half a double-tap)', E.end(true) === false && !ctx.log.length);
  ctx = mk(true); E = env(ctx);
  E.start(down('touch', words)); ctx.tick(800);
  check('a touch cancelled (the page scrolled) picks nothing', E.end(false) === false && !ctx.log.length && !ctx.ringOn());
  ctx = mk(true); E = env(ctx);
  E.start(down('mouse', words)); ctx.tick(1000);
  check('a mouse let go before the pen: nothing (a mouse selects by dragging)', E.end(true) === false && !ctx.log.length);

  ctx = mk(false); E = env(ctx);
  E.start(down('mouse', words)); ctx.tick(3000);
  check('drawing not set up: a mouse hold does nothing', !ctx.log.length && !ctx.ringOn());
  ctx = mk(false); E = env(ctx);
  E.start(down('touch', words)); ctx.tick(1000);
  check('...a finger can still pick a line (the ring says only that)', /^Let go to pick this line$/.test(ctx.rings[0].textContent) && E.end(true) === true && ctx.log.join() === 'pick');
  ctx = mk(true); E = env(ctx);
  E.start(down('mouse', words, { button: 2 })); E.start(down('touch', chordless, { isPrimary: false })); ctx.tick(3000);
  check('a right click, or a second finger, is no hold', !ctx.log.length);
  ctx = mk(true); E = env(ctx);
  E.start(down('touch', { pickable: true })); ctx.tick(3000);
  check('off the words (a chip, a button, a strip): no hold', !ctx.log.length);
});

console.log('\n   ...which lines a finger picks');
run('the pick', () => {
  const M = new Function(fn('_sbmXpPairOf') + '\n' + fn('_sbmXpPickJoin') + '\nreturn { pair: _sbmXpPairOf, join: _sbmXpPickJoin };')();
  const K = ['other', 'chord', 'lyric', 'chord', 'lyric', 'other', 'lyric', 'chord'];
  check('the words: with the chords over them', JSON.stringify(M.pair(K, 2)) === '{"a":1,"b":2}');
  check('the chords: with the words under them', JSON.stringify(M.pair(K, 3)) === '{"a":3,"b":4}');
  check('words with no chords over them: nothing to move', M.pair(K, 6) === null);
  check('a chord line with no words under it moves alone', JSON.stringify(M.pair(K, 7)) === '{"a":7,"b":7}');
  check('a heading or a blank line is not a line to pick', M.pair(K, 0) === null && M.pair(K, 5) === null);
  check('a second line: everything between', JSON.stringify(M.join({ a: 1, b: 2, net: 0 }, { a: 7, b: 7 })) === '{"a":1,"b":7}' &&
    JSON.stringify(M.join({ a: 3, b: 4, net: 0 }, { a: 1, b: 2 })) === '{"a":1,"b":4}');
  check('...one inside the pick: just that one', JSON.stringify(M.join({ a: 1, b: 7, net: 0 }, { a: 3, b: 4 })) === '{"a":3,"b":4}');
  check('...after the picked lines were moved: a fresh pick', JSON.stringify(M.join({ a: 1, b: 2, net: 2 }, { a: 7, b: 7 })) === '{"a":7,"b":7}');
  const pick = fn('_sbmXpPick');
  check('a pick is the transpose bar\'s own state, painted by it', /_sbmXp = \{ sid: song\.id, a: r\.a, b: r\.b, net: 0, before: null \};\n\s*_sbmXpPaint\(\);/.test(pick));
  check('only the song\'s own card, with its chords shown', /ly\.classList\.contains\('sbm-lyrics--nochords'\)/.test(fn('_sbmXpPickable')) && /!card\.contains\(ly\)/.test(fn('_sbmXpPickable')));
});

// ------------------------------------------------------------ 2. the double-tap
console.log('\n2. A double-tap: the editor, where it was tapped');
run('double-tap', () => {
  const env = new Function('ctx', `
    var _sbmDraw = null, _sbNp = null, _sbmDblAt = 0, window = { getSelection: function() { return { removeAllRanges: function() {} }; } };
    function _sbmCardSong(card) { return card.song; }
    function sbOpenLyricsEditor(sid, seed, at) { ctx.log.push('lyrics:' + sid + ':' + JSON.stringify(at)); }
    function sbmEditParts(anchor) { ctx.log.push('parts:' + anchor); }
    function sbmEdit(at) { ctx.log.push('edit:' + JSON.stringify(at)); }
    function _sbmTapLine(card, e) { return { line: 4, col: 7 }; }
    ${fn('_sbmDblEdit')}
    return { dbl: _sbmDblEdit, reset: function() { _sbmDblAt = 0; } };`);
  const ctx = { log: [] };
  const E = env(ctx);
  const card = (o) => ({ song: { id: o.id || 'copy1' }, classList: { contains: c => c === 'sbm-card--follow' && !!o.follow }, querySelector: s => (s === '.sbm-score' && o.score) ? {} : null });
  const ev = (target) => ({ target, preventDefault() { this.prevented = true; } });
  let e = ev({}); E.dbl(e, card({}));
  check('on the words: Edit, at the line and column tapped', ctx.log[0] === 'edit:{"line":4,"col":7}' && e.prevented);
  E.dbl(ev({}), card({}));
  check('the double-click and the two taps of one double-tap open it once', ctx.log.length === 1);
  E.reset();
  const sys = { getAttribute: () => 's:Verse 1|6' };
  E.dbl(ev({ closest: s => (s === '.vl-sys[data-anchor]' ? sys : null) }), card({ score: true }));
  check('on the choir score: the parts editor, at the moment tapped', ctx.log[1] === 'parts:s:Verse 1|6', ctx.log[1]);
  E.reset();
  E.dbl(ev({}), card({ follow: true, id: 'copy2' }));
  check('on a song read on under it (a medley): that song\'s words', ctx.log[2] === 'lyrics:copy2:{"line":4,"col":7}', ctx.log[2]);
  const ed = fn('sbmEdit');
  check('Edit (the tile, the chip) passes no place; a double-tap passes its line',
    /function sbmEdit\(at\) \{/.test(ed) && /sbOpenLyricsEditor\(song\.id, null, \(at && typeof at === 'object' && at\.line != null\) \? at : null\);/.test(ed));
  check('the choir editor finds the moment in the lines it was built from (a song with no parts yet: from its words)',
    /var hit = null, at = _sbmEdMomentAt\(from, o\.anchor\);/.test(fn('_sbmEdOpen')) && /from = Array\.isArray\(seed\) \? seed : \[\];/.test(fn('_sbmEdOpen')) &&
    /anchor: typeof anchor === 'string' \? anchor : '',/.test(fn('sbmEditParts')));
  check('...opens its section, and lights it in its own markup (a repaint keeps it)',
    /if \(k\+\+ === at\) \{ hit = m; sec\.open = true; \}/.test(fn('_sbmEdOpen')) && has(/\(ed\.hit === m\.id \? ' is-hit' : ''\)/) && /if \(hit\) _sbmEdShowMoment\(hit\.id\);/.test(fn('_sbmEdOpen')));
  const V = { lineNumbers: rows => ({ perGroup: rows.map(r => ({ sectionKey: r.k, n: r.n })) }) };
  const at = new Function('window', fn('_sbmEdMomentAt') + '\nreturn _sbmEdMomentAt;')({ lhcVoiceLines: V });
  const rows = [{ k: 'Verse 1', n: 1 }, { k: 'Verse 1', n: 2 }, { k: 'Chorus', n: 1 }, { k: 'Chorus#2', n: 1 }];
  check('a moment is counted through the whole song, a sung-twice section by its run',
    at(rows, 's:Chorus|1') === 2 && at(rows, 's:Chorus#2|1') === 3 && at(rows, 's:Bridge|1') === -1 && at(rows, '') === -1 && at([], 's:Chorus|1') === -1);
});

// ------------------------------------------------------------ 3. the key
console.log('\n3. The editor: in the key sung, saved in the copy\'s own key');
run('the key', () => {
  const M = new Function(STUBS + '\n' + fn('_sbLyrShown') + '\n' + fn('_sbLyrLineFor') + '\n' + fn('_sbNpMap') +
    '\nreturn { shown: _sbLyrShown, lineFor: _sbLyrLineFor, map: _sbNpMap };')();
  const stored = ['[Verse]', 'D           Dsus  D', 'Come, now is the time', 'A        Em  D  G', 'Come, now'];
  const shown = M.shown(stored, 2);
  check('chord lines shown moved by the steps', shown[1] === 'E           Esus  E' && shown[3] === 'B        F#m  E  A', JSON.stringify(shown));
  check('...the heading and the words untouched', shown[0] === '[Verse]' && shown[2] === 'Come, now is the time' && shown[4] === 'Come, now');
  const typed = shown.slice(); typed[2] = 'Come, now is the time to worship'; typed[3] = 'C#m      F#m  E  A';
  const back = M.map(shown, stored, typed, 2);
  check('saved: every line it showed goes back exactly as stored', back[1] === stored[1] && back[0] === stored[0] && back[4] === stored[4], JSON.stringify(back));
  check('...a word changed is kept as typed', back[2] === 'Come, now is the time to worship');
  check('...a chord line changed is moved back into the copy\'s own key', back[3] === 'Bm      Em  D  G', back[3]);
  const save = fn('sbSaveLyricsFromModal'), open = fn('sbOpenLyricsEditor');
  check('the save maps it before it checks and writes', /if \(O && O\.steps\) lyrics = _sbNpMap\(O\.shown, O\.stored, String\(lyrics == null \? '' : lyrics\)\.split\('\\n'\), O\.steps\)\.join\('\\n'\);/.test(save) &&
    save.indexOf('_sbNpMap(') < save.indexOf('_sbSetCopyWords(song, lyrics)'));
  check('opening keeps what it showed and what is stored; shared words handed in are never moved',
    /var steps = given \? 0 : _sbmStepsOf\(s\);/.test(open) && /_sbLyrOpened = \{ sid: sid, words: _sbNormWords\(s\.customLyrics \|\| ''\), steps: steps, shown: shownLines, stored: storedLines \};/.test(open));
  check('...and says the key in its title', /' \\u00b7 chords in ' \+ \(sung \|\| /.test(open));
  check('a card line is the same line of the words when they line up', M.lineFor(['a', 'b', 'c'], ['a', 'b', 'c'], 1) === 1 && M.lineFor(null, ['a', 'b'], 9) === 1);
  check('...else the line with the same words nearest where it stands',
    M.lineFor(['x', 'Come', 'y'], ['p', 'q', 'Come', 'r', 'Come'], 1) === 2 && M.lineFor(['x', 'y', 'z', 'Come'], ['Come', 'a', 'b', 'c', 'Come'], 3) === 4);
  check('...and a line that matches nothing lands in proportion', M.lineFor(['a', 'b', 'c'], ['1', '2', '3', '4', '5'], 2) === 4);
});

console.log('\n   ...opened at the line tapped');
run('go to', () => {
  const sel = { ranges: [], removeAllRanges() { this.ranges = []; }, addRange(r) { this.ranges.push(r); } };
  const env = new Function('ctx', `
    var document = ctx.document, window = { getSelection: function() { return ctx.sel; } };
    function setTimeout(f) { f(); }
    ${fn('_sbLyrGoTo')}
    return _sbLyrGoTo;`);
  const line = (cls, text) => {
    const e = { cls, text, lit: false, scrolled: 0, classList: { contains: c => c === cls, add: c => { if (c === 'lyr-hit') e.lit = true; } },
      textContent: text, firstChild: { nodeType: 3, nodeValue: text }, scrollIntoView() { e.scrolled++; } };
    return e;
  };
  const chord = line('editor-chord-line', 'A        Em  D  G'), words = line('editor-lyric-line', 'Come, now is the time');
  words.previousElementSibling = chord; chord.nextElementSibling = words;
  const ed = { querySelector: s => (s === '[data-line="4"]' ? words : s === '[data-line="3"]' ? chord : null) };
  const ctx = { sel, document: { createRange: () => ({ setStart(n, o) { this.node = n; this.off = o; }, collapse() {} }) } };
  const go = env(ctx);
  go(ed, 4, 7);
  check('the words tapped lit with their chords, the cursor in them at the column', words.lit && chord.lit && sel.ranges[0].node === words.firstChild && sel.ranges[0].off === 7);
  check('...and scrolled to the middle of the pad', words.scrolled >= 1);
  chord.lit = false; words.lit = false; go(ed, 3, 99);
  check('a chord line tapped: lit with its words; the cursor no further than its end', chord.lit && words.lit && sel.ranges[0].off === chord.text.length);
});

// ------------------------------------------------------------ 4. wiring and look
console.log('\n4. Wired in, and dressed as the songbook');
const bind = fn('_sbmDblBind');
check('a double-click, or a double-tap, edits -- it no longer draws',
  /root\.addEventListener\('dblclick', function\(e\) \{ var c = _sbmDblCard\(e\.target\); if \(c\) _sbmDblEdit\(e, c\); \}\);/.test(bind) &&
  /\{ _sbmTap = null; _sbmDblEdit\(e, _sbmDblCard\(e\.target\)\); \}/.test(bind) && !/_sbmHoldDraw|_sbmDblDraw|sbmDraw\(/.test(bind));
check('the song view: a hold starts on every press; a pointer that lets go first ends it, and only then counts taps',
  /_sbmHoldStart\(e\);/.test(bind) && /_sbmHoldMove\(e\);/.test(bind) && /var held = _sbmHoldEnd\(true\);/.test(bind) && /_sbmHoldEnd\(false\);/.test(bind));
check('a held finger\'s own menu is kept off the ring', /root\.addEventListener\('contextmenu', function\(e\) \{ if \(_sbmHold && _sbmHold\.touch\) e\.preventDefault\(\); \}\);/.test(bind));
check('two seconds to the pen, the ring at 450ms', has(/var _SBM_HOLD_DRAW_MS = 2000, _SBM_HOLD_RING_MS = 450;/));
check('a touch screen: the words take a held finger, not the phone\'s own selection',
  has(/@media \(hover: none\) and \(pointer: coarse\) \{\n\s*#sbmRoot \.sbm-card \.sbm-lyrics, #sbmRoot \.sbm-card \.sbm-score \{ -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; \}/));
check('...and says how a finger picks lines to move', /'Hold a line, then another, to move only those'/.test(LF) && /_sbmTouchUI\(\) \? 'fa-hand-pointer' : 'fa-i-cursor'/.test(LF));
check('Type is gone from the song view; Edit is where it was', /_sbmDrawChip\(\) \+ _sbmEditChip\(\) \+ _sbmLayersChip\(\)/.test(LF) && !/_sbmTypeChip\(/.test(LF) && !/WO\.sbmType\(\)/.test(LF));
check('Book Mode keeps its own: a double-tap draws, holding types', /function _sbBkHold\(line, x, y\)/.test(LF) && /_sbNpStart\(wrap, song, 'book', x, y\);/.test(fn('_sbBkHold')));

const open = fn('sbOpenLyricsEditor');
check('from the Songbook the editor is dressed as it: the class, the songbook\'s chord-grid face, the outline',
  /modal\.classList\.add\('lyrics-editor-modal--sb'\);/.test(open) && /richEditor\.style\.fontFamily = _sbmFontGrid\(\);/.test(open) && /window\._lyricsRenderOutline\(lyrics\)/.test(open));
check('...opened at a double-tap\'s line', /if \(at && at\.line != null\) _sbLyrGoTo\(richEditor, _sbLyrLineFor\(given \? null : _sbmLinesOf\(s\), storedLines, at\.line\), at\.col \|\| 0\);/.test(open));
check('the song form\'s editor is the plain one again', /if \(modal\) modal\.classList\.remove\('lyrics-editor-modal--sb'\);\n\s*if \(richEditor\) richEditor\.style\.fontFamily = '';/.test(fn('openLyricsEditor')));
check('the dead controls are named so they can be hidden (font, size, bold: they styled a hidden textarea)',
  has(/<div class="format-group lyr-fg-font">\n\s*<select id="lyricsFontFamily"/) && has(/<div class="format-group lyr-fg-style">\n\s*<button type="button" class="format-btn" onclick="applyLyricsFormat\('bold'\)"/));
check('...hidden, with the slide preview, from the Songbook',
  has(/\.lyrics-editor-modal--sb \.lyrics-editor-right,\n\.lyrics-editor-modal--sb \.lyr-fg-font,\n\.lyrics-editor-modal--sb \.lyr-fg-style \{ display: none !important; \}/));
check('a white card', has(/\.lyrics-editor-modal--sb \.lyrics-rich-editor \{ background: #fff; color: #0f172a;[^}]*font-size: 18px;/));
check('each section its gold tag, as the song view\'s', has(/\.lyrics-editor-modal--sb \.lyrics-rich-editor \.editor-section-header \{[^}]*border-left: 3px solid #d4a853;[^}]*color: #7f5d20;[^}]*text-transform: uppercase;/));
check('the chords teal and bold, the words black and bold, spaced as the song view', has(/\.editor-chord-line \{ margin-top: 1em; color: #04756f; font-weight: 700; \}/) &&
  has(/\.lyrics-editor-modal--sb \.lyrics-rich-editor \.editor-lyric-line \{ margin-bottom: 0\.5em; color: #000; font-weight: 700; \}/));
check('a blank line is a short gap -- and a line of words once typed into', /editor-lyric-line editor-empty-line/.test(fn('renderRichEditor')) &&
  has(/\.lyrics-editor-modal--sb \.lyrics-rich-editor \.editor-empty-line \{ height: auto; margin: 0; font-size: 0\.6em;/) &&
  /_ln\.classList\.contains\('editor-empty-line'\) && _ln\.textContent\.trim\(\)\) _ln\.classList\.remove\('editor-empty-line'\);/.test(fn('onRichEditorInput')));
check('the line tapped is lit, then fades', has(/\.lyrics-editor-modal--sb \.lyr-hit \{ animation: lyrHit 3\.6s ease-out forwards;/) && has(/@keyframes lyrHit \{/));
check('a phone\'s editor at its size', has(/@media \(max-width: 640px\) \{\n\s*\.lyrics-editor-modal--sb \.lyrics-rich-editor \{ font-size: 15px;/));
check('the drawing hint and the Draw chip say hold, not double-tap',
  /<b>Hold<\/b> the words 2 seconds to draw/.test(fn('_sbmCoachDraw')) && has(/a breath mark\. Or hold the words for 2 seconds\. /) && !/double-tap the words\. /.test(LF));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (EXPECT_BROKEN) {
  if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
  console.log('--expect-broken: failures above are the expected ones');
  process.exit(0);
}
process.exit(fail ? 1 : 0);
