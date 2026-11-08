'use strict';
// Harness for the Songbook's reading view as the operator asked for it on
// 2026-11-07, from a marked-up screenshot of a phone:
//
//   * "remove this": the notice under the song's title ("Also sung in ...",
//     Copy arrangement, Own drawings) and the A- / 100% / A+ that sized the
//     words. Copy an arrangement stays under More; that the drawings are
//     shared, and Own drawings, moved to the Drawings window.
//   * "Blue buttons": the key's two steps, flat and sharp, blue and large.
//   * "make sure the transpose function reflects immediately for all users":
//     the new key always reached the other devices (the quick sync, then the
//     poll) but the reading view drew it only when something else redrew it,
//     so a singer's chords stayed in the old key. Now a key, words or a
//     version from elsewhere redraw the reading view and Book Mode, and the
//     song in front says the key moved.
//   * "a floater to direct them to the chord / lyric section and disappear
//     once arrived": shown while the words are out of sight below, taking
//     you there, gone once there.
//   * "Drawings": a tile beside Book Mode opening every drawing kept on the
//     song -- the reader's own, everyone's, each group's, and other people's
//     private ones, which (asked) the operator wanted reachable too: off until
//     switched on, one person at a time.
//
// USAGE
//   node tools/songbook-reading-view-harness.js
//   node tools/songbook-reading-view-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before this.
// Exit code 0 = all checks passed, 1 = something failed.

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

// ---------------------------------------------------------------- removed
console.log('\nWhat was taken away');
check('no notice under the song\'s title', !has(/_sbmTwiceRibbon/) && !has(/class="sbm-twice/) &&
  has(/\(mdHere \? _sbmMedleyRibbon\(song, mdHere\) : ''\) \+ '<\/div>';/));
check('Earlier versions (once Copy an arrangement) is still under More', has(/if \(song && order\) rows\.push\(\['fa-clock-rotate-left', 'Earlier versions/));
check('no A- / 100% / A+: the toolbar is Share, Undo, (Redo,) Refresh',
  !has(/WO\.sbmScale\(/) && !has(/id="sbmPct"/) && !has(/function sbmScale\(/) && !has(/sbm-toolbar__(pct|rule)/) &&
  has(/onclick="WO\.sbRefresh\(\)"><i class="fa-solid fa-rotate"><\/i>Refresh<\/button><\/div>';/) &&
  has(/\.sbm-toolbar \{\r?\n\s*display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/));
check('...and a size chosen before is not read back, since nobody could change it now',
  !has(/getItem\('lhc_sbm_scale'\)/) && has(/root\.style\.setProperty\('--sbm-lyrics-scale', String\(_sbmScale\)\);/));

// --------------------------------------------------------- the key's steps
console.log('\nThe key\'s two steps');
check('flat and sharp are their own blue buttons',
  has(/'<button class="sbm-seg__btn sbm-xp-step" onclick="WO\.sbmTranspose\(-1\)"/) &&
  has(/'<button class="sbm-seg__btn sbm-xp-step" onclick="WO\.sbmTranspose\(1\)"/));
const xpCss = (SRC.match(/#sbmRoot \.sbm-seg--xp \.sbm-seg__btn\.sbm-xp-step \{[^}]*\}/) || [''])[0];
check('...blue, white and large, and after the phone\'s smaller rule so they win',
  /background: #2563eb;/.test(xpCss) && /color: #fff;/.test(xpCss) && /font: 700 24px\/1/.test(xpCss) &&
  SRC.indexOf(xpCss) > SRC.indexOf('#sbmRoot:not(.sbm--wide) .sbm-seg--xp .sbm-seg__btn { font-size: 13px; }'));

// ------------------------------------------------ a key moved elsewhere
console.log('\nA key moved on another device');
let R = null;
try {
  const body = extractVar('_sbmRemoteT') + '\n' + extractFn('_sbmRemoteRedraw') + '\n' + extractFn('sbApplyBroadcast') +
    '\nreturn { apply: sbApplyBroadcast };';
  R = function(env) {
    const names = Object.keys(env);
    return new Function(...names, body)(...names.map(k => env[k]));
  };
} catch (e) { console.log('  (not present: ' + e.message + ')'); }
function world(opts) {
  opts = opts || {};
  const songs = [{ id: 'a', transposeSteps: opts.steps, annotations: [] }, { id: 'b', transposeSteps: 0, annotations: [] }];
  const T = { renders: 0, books: 0, toasts: [] }, steps = {};
  const env = {
    currentOrderData: { id: 'o1' },
    $: id => id === 'songbookLiveModal' ? { style: { display: 'flex' } } : null,
    songOrderSections: songs,
    sbPaths: {}, sbImgPaths: {}, sbTextAnnots: {}, _sbHighlights: {},
    sbRedrawSong: () => {}, sbRedrawImgAnnotations: () => {}, sbRenderHighlights: () => {},
    document: { getElementById: () => null, activeElement: null },
    sbTransposeSteps: steps, _sbLastColsToggleTs: 0, _sbLastRealtimeBroadcastTs: 0,
    songOriginalLyrics: {}, songOriginalRichLyrics: {}, formatLyricsWithHighlights: t => t,
    sbPatchSongDOM: () => {}, sbShowTypingIndicator: () => {},
    _sbmBookOpen: () => opts.closed ? false : true, _sbmActive: () => true, _sbmSong: () => songs[0],
    _sbmRender: () => { T.renders++; }, _sbBkOpen: () => !!opts.book, _sbBkRebuild: () => { T.books++; },
    _sbSungKey: s => ['G', 'G#', 'A', 'A#', 'B'][steps[s.id] != null ? steps[s.id] : (s.transposeSteps || 0)],
    _sbmStepsOf: s => steps[s.id] != null ? steps[s.id] : (s.transposeSteps || 0),
    showToast: m => { T.toasts.push(m); },
    setTimeout: f => { f(); return 1; }, clearTimeout: () => {}
  };
  return { api: R(env), T, songs };
}
if (!R) check('the remote redraw is a function of its own, called from the sync', false);
else {
  let w = world({ steps: 2 });
  w.api.apply({ orderId: 'o1', songs: [{ id: 'a', transposeSteps: 4 }] });
  check('the song in front moved: the reading view is drawn again at once', w.T.renders === 1 && w.songs[0].transposeSteps === 4, JSON.stringify(w.T));
  check('...and it says so, with the key it is in now', w.T.toasts.length === 1 && w.T.toasts[0] === 'Key changed on another device: now B (+4)', JSON.stringify(w.T.toasts));
  w.api.apply({ orderId: 'o1', songs: [{ id: 'a', transposeSteps: 4 }] });
  check('the same key again changes nothing', w.T.renders === 1 && w.T.toasts.length === 1);
  w.api.apply({ orderId: 'o1', songs: [{ id: 'a', transposeSteps: 0 }] });
  check('back to the original key says so', w.T.toasts[1] === 'Key changed on another device: now G', JSON.stringify(w.T.toasts));

  w = world({ steps: undefined });
  w.api.apply({ orderId: 'o1', songs: [{ id: 'a', transposeSteps: 0 }] });
  check('a 0 arriving for a copy never moved is no key change: no redraw, no word', w.T.renders === 0 && w.T.toasts.length === 0, JSON.stringify(w.T));

  w = world({ steps: 0 });
  w.api.apply({ orderId: 'o1', songs: [{ id: 'b', transposeSteps: 3 }] });
  check('another song moved (a medley\'s next, say): drawn again, but not announced', w.T.renders === 1 && w.T.toasts.length === 0, JSON.stringify(w.T));

  w = world({ steps: 0 });
  w.api.apply({ orderId: 'o1', songs: [{ id: 'a', transposeSteps: 0, annotations: [[1, 2]] }] });
  check('a drawing on the printed page alone does not redraw the reading view', w.T.renders === 0);

  w = world({ steps: 0 });
  w.api.apply({ orderId: 'o1', songs: [{ id: 'a', transposeSteps: 0, richLyrics: '<div>new words</div>' }] });
  check('the words changed elsewhere: drawn again, not announced as a key', w.T.renders === 1 && w.T.toasts.length === 0);

  w = world({ steps: 0, book: true });
  w.api.apply({ orderId: 'o1', songs: [{ id: 'a', transposeSteps: 2 }] });
  check('Book Mode open: its pages are built again too', w.T.books === 1 && w.T.renders === 1 && w.T.toasts.length === 1);

  w = world({ steps: 0, closed: true });
  w.api.apply({ orderId: 'o1', songs: [{ id: 'a', transposeSteps: 2 }] });
  check('the book closed: nothing drawn, nothing said', w.T.renders === 0 && w.T.toasts.length === 0);
}
check('a version chosen elsewhere still redraws, through the same path',
  has(/\/\/ being patched, so a key, words or a version from elsewhere redraw them\.\r?\n\s*_sbmRemoteRedraw\(patches\);/) &&
  !has(/patches\[k\]\.version; \}\) && _sbmActive\(\)\) _sbmRender\(\);/));

// ---------------------------------------------------------- the floater
console.log('\nThe way to the words');
let want = null;
try { want = new Function(extractFn('_sbmGuideWant') + '\nreturn _sbmGuideWant;')(); } catch (e) { console.log('  (not present: ' + e.message + ')'); }
if (!want) check('whether to point the way is a function of its own', false);
else {
  // Measured on the read-only page: a 375x812 phone opens with the words at
  // 748px; a 1024x768 desk with them at 536px, three lines in sight.
  check('a phone opens with the words below the screen: it points the way', want(748, 3000, 812, false) === true);
  check('a desk opens with lines of the song in sight: it keeps out of the way', want(536, 2000, 768, false) === false);
  check('arrived, the words up the screen: it goes', want(90, 2500, 812, true) === false && want(-400, 2000, 812, true) === false);
  check('in between it stays as it was, so it does not flicker', want(500, 2500, 812, true) === true && want(500, 2500, 812, false) === false);
  check('scrolled back up away from them: it comes back', want(700, 2900, 812, false) === true);
  check('a short song all in sight: never', want(700, 800, 812, true) === false && want(100, 700, 812, true) === false);
  check('nothing measured, nothing shown', want(NaN, 0, 812, true) === false && want(500, 900, 0, true) === false);
}
check('every card of words is the one it points to: the lyrics, the score and a song with no parts yet',
  (SRC.match(/'<div class="sbm-card sbm-card--words" id="sbmWordsCard">/g) || []).length === 3);
check('it measures the words themselves, not the card\'s heading',
  /var words = card\.querySelector\('#sbmLyrics, \.sbm-score'\) \|\| card;/.test(fn('_sbmGuideCheck')));
check('it is drawn after every render of the reading view', has(/_sbmInit\(\);\r?\n\s*\/\/ The way to the words[^\n]*\r?\n\s*setTimeout\(_sbmGuideUpdate, 0\);/));
const upd = fn('_sbmGuideUpdate'), chk = fn('_sbmGuideCheck'), go = fn('_sbmGuideGo');
check('it lives on the songbook\'s own layer, and follows the scroller', /modal\.appendChild\(g\);/.test(upd) &&
  /root\.addEventListener\('scroll', _sbmGuideCheck, \{ passive: true \}\);/.test(upd) && /root\.__sbmGuide = true;/.test(upd));
check('it stands down while drawing, in Book Mode, in Page view and while it is taking you there',
  /!_sbmDraw && !_sbBkOpen\(\) && Date\.now\(\) - _sbmGuideGoing > 2000/.test(chk) && /_sbmActive\(\)/.test(chk));
check('a tap takes you to the words, past the desk\'s sticky bar, and it goes at once',
  /getComputedStyle\(bar\)\.position === 'sticky'/.test(go) && /_sbmGuideGoing = Date\.now\(\);\r?\n\s*_sbmGuideCheck\(\);/.test(go) &&
  /root\.scrollTo\(\{ top: to, behavior: smooth \? 'smooth' : 'auto' \}\)/.test(go) && /prefers-reduced-motion: reduce/.test(go));
// (2026-11-07, second pass: the operator wrote "Scroll down for Lyrics / chords" on it.)
check('it says what to do: scroll down for the lyrics / chords (no chords in the Lyrics view)',
  /return view === 'lyrics' \? 'Scroll down for lyrics' : 'Scroll down for lyrics \/ chords';/.test(fn('_sbmGuideLabel')));

// --------------------------------------------------------- Drawings
console.log('\nThe Drawings window');
let D = null;
try {
  D = new Function(['_sbmAudienceOf', '_sbmDrawingsOf'].map(extractFn).join('\n') + '\nreturn _sbmDrawingsOf;')();
} catch (e) { console.log('  (not present: ' + e.message + ')'); }
const marks = [
  { owner: 'aaron tan', shared: true }, { owner: 'aaron tan', shared: false }, { owner: 'aaron tan', shared: true, part: 'bass' },
  { owner: 'grace lim', owner_name: 'Grace Lim', shared: true }, { owner: 'grace lim', owner_name: 'Grace Lim', shared: true, part: 'guitar' },
  { owner: 'ben ong', owner_name: 'Ben Ong', shared: false }, { owner: 'ben ong', owner_name: 'Ben Ong', shared: false },
  { owner: 'zoe', owner_name: 'Zoe', shared: true, part: 'drums' }, { owner: null }
];
if (!D) check('every drawing of a song is listed by a function of its own', false);
else {
  const L = D(marks, 'aaron tan');
  check('every drawing is counted', L.total === 9);
  check('mine, by who sees them', L.me.n === 3 && L.me.by.all === 1 && L.me.by.me === 1 && L.me.by.bass === 1, JSON.stringify(L.me));
  check('everybody else\'s shared ones by person, the earlier drawings last',
    L.people.map(p => p.key + ':' + p.n).join(' ') === 'grace lim:2 zoe:1 :1', L.people.map(p => p.key + ':' + p.n).join(' '));
  check('...each with what they drew for which group', L.people[0].byPart.guitar === 1 && L.people[1].byPart.drums === 1 && !L.people[0].byPart.drums);
  check('the groups, with who drew for them', L.groups.guitar.n === 1 && L.groups.drums.n === 1 && L.groups.guitar.names[0] === 'Grace Lim' && !L.groups.bass,
    JSON.stringify(L.groups));
  check('other people\'s private ones, listed apart', L.priv.length === 1 && L.priv[0].key === 'ben ong' && L.priv[0].n === 2);
  const anon = D(marks, '');
  check('a reader with no name sees their old drawings as anybody\'s', anon.me.n === 0 && anon.priv.map(p => p.key).join() === 'aaron tan,ben ong');
  check('nothing kept, nothing listed', D([], 'x').total === 0 && D(undefined, '').people.length === 0);
}

let A = null;
try {
  const body = ['_sbmAudienceOf', '_sbmDrawingsOf', '_sbVerMarks', '_sbmPrivOn', '_sbmLayersHidden', '_sbmMyParts', 'sbmLayersAll', 'sbmPrivToggle'].map(extractFn).join('\n') +
    '\nreturn { all: sbmLayersAll, priv: sbmPrivToggle };';
  A = function(store, T) {
    const localStorage = { getItem: k => store[k] == null ? null : store[k], setItem: (k, v) => { store[k] = String(v); } };
    const env = {
      localStorage, _sbmSong: () => ({ id: 'x', versionId: '' }), _sbBaseSongId: () => 'base', _sbmMarks: { base: marks.map(m => Object.assign({ version_id: null }, m)) },
      _sbmMe: () => ({ key: 'aaron tan', name: 'Aaron Tan' }),
      sbmLayerPart: p => { const a = JSON.parse(store.lhc_sbm_parts || '[]'); a.push(p); store.lhc_sbm_parts = JSON.stringify(a); T.ticked.push(p); },
      _sbmPartsShown: () => { T.shown++; }
    };
    const names = Object.keys(env);
    return new Function(...names, body)(...names.map(k => env[k]));
  };
} catch (e) { console.log('  (not present: ' + e.message + ')'); }
if (!A) check('Show all and Only mine are functions of their own', false);
else {
  const store = { lhc_sbm_layers_hidden: JSON.stringify({ 'aaron tan': true, 'grace lim': true }), lhc_sbm_parts: JSON.stringify(['vocals']) }, T = { ticked: [], shown: 0 };
  const api = A(store, T);
  api.all('all');
  check('Show all: everybody shown again, me included',
    store.lhc_sbm_layers_hidden === '{}', store.lhc_sbm_layers_hidden);
  check('...every private one on the song switched on', store.lhc_sbm_priv_on === JSON.stringify({ 'ben ong': true }), store.lhc_sbm_priv_on);
  check('...and every group drawn for, through the groups\' own path', T.ticked.join() === 'guitar,drums' &&
    store.lhc_sbm_parts === JSON.stringify(['vocals', 'guitar', 'drums']) && T.shown >= 1, JSON.stringify(T));
  api.all('mine');
  check('Only mine: everybody else\'s on the song hidden, the earlier drawings too, mine not',
    store.lhc_sbm_layers_hidden === JSON.stringify({ 'grace lim': true, zoe: true, '': true }), store.lhc_sbm_layers_hidden);
  check('...and the private ones off again', store.lhc_sbm_priv_on === '{}');
  api.priv('ben ong');
  check('one person\'s private drawings switched on, alone', store.lhc_sbm_priv_on === JSON.stringify({ 'ben ong': true }));
  api.priv('ben ong');
  check('...and off', store.lhc_sbm_priv_on === '{}');
}

check('the tile is beside Book Mode, with how many are kept',
  has(/>Book Mode<\/button>' \+\r?\n\s*\/\/ Every drawing kept on the song[^\n]*\r?\n\s*_sbmDrawingsTile\(song\) \+/) &&
  /data-sbm-drawings="1" onclick="WO\.sbmLayers\(\)"/.test(fn('_sbmDrawingsTile')) && has(/_sbmPhoneMarks\(null\);\r?\n\s*_sbmDrawingsTileCount\(\);/));
const win = fn('_sbmDrawings');
check('the window lists yours, others\' shared, the groups and the private ones, and reads the drawings first if it must',
  /<span>Yours<\/span>/.test(win) && /<span>Shared by others<\/span>/.test(win) && /<span>For a group<\/span>/.test(win) &&
  /<span>Private<\/span>/.test(win) && /WO\.sbmPrivToggle\(/.test(win) && /_sbmLoadMarks\(song, true\)\.then\(again, again\);/.test(win));
check('...with Show all, Only mine and Draw on this song', /WO\.sbmLayersAll\(\\'all\\'\)/.test(win) && /WO\.sbmLayersAll\(\\'mine\\'\)/.test(win) && /WO\.sbmLayersDraw\(\)/.test(win));
check('...and a song sung twice says its drawings are shared, with Own drawings', /html \+= _sbmSharedDrawingsNote\(song\) \+ _sbmWhoNote\(\);/.test(win) &&
  /WO\.sbmOwnVersion\(\)/.test(fn('_sbmSharedDrawingsNote')));
check('a person\'s drawings for a group that is off say so on their row', /which you have off below/.test(win));
check('the drawer is told what Only me now means', has(/Only me keeps it off everyone else’s song; they can still switch it on under Drawings\./) &&
  has(/aud === 'me' \? ': others see it only if they switch your private drawings on' : ''/));
check('the new actions are reachable from the page', has(/sbmLayersAll: sbmLayersAll, sbmLayersDraw: sbmLayersDraw, sbmPrivToggle: sbmPrivToggle,/));

// ---------------------------------------------- the second pass, same day
// From a second marked-up screenshot: a take is played from any point of its
// timeline ("can rewind / fast forward"); the key above the choir score goes;
// a double-tap anywhere on the lyrics / chords draws. Asked, the operator
// chose drawing over the double-click that edited a choir line in place.
console.log('\nA take, from any point of it');
let T = null;
try {
  T = new Function(['_sbmPlayerDur', '_sbmClampTime'].map(extractFn).join('\n') + '\nreturn { dur: _sbmPlayerDur, at: _sbmClampTime };')();
} catch (e) { console.log('  (not present: ' + e.message + ')'); }
if (!T) check('the take\'s length and a time in it are worked out by functions of their own', false);
else {
  check('the file\'s own length once known, else the length kept when it was recorded',
    T.dur({ audio: { duration: 55.2 }, rec: { duration_sec: 50 } }) === 55.2 && T.dur({ audio: { duration: Infinity }, rec: { duration_sec: 50 } }) === 50 &&
    T.dur({ audio: { duration: NaN }, rec: {} }) === 0 && T.dur(null) === 0);
  check('a time lands inside the take: never before it, never past its end',
    T.at(12.5, 55) === 12.5 && T.at(-3, 55) === 0 && T.at(80, 55) === 55 && T.at('x', 55) === 0 && T.at(9, 0) === 9);
}
const pr = fn('_sbmPracticeHtml');
check('the timeline is a slider: dragged or tapped anywhere, its time shown while dragged, set when let go',
  /<input type="range" class="sbm-player__range" min="0" max="0" step="0\.1" value="0" disabled aria-label="Where in the take" oninput="WO\.sbmSeekTo\(this, false\)" onchange="WO\.sbmSeekTo\(this, true\)">/.test(pr));
check('...with ten seconds back and on beside the time', /onclick="WO\.sbmSkip\(-10\)"/.test(pr) && /onclick="WO\.sbmSkip\(10\)"/.test(pr) && /class="sbm-player__time"/.test(pr));
const seek = fn('sbmSeekTo');
check('a take not yet playing starts where it was set; one playing follows the finger',
  /if \(done \|\| \(!a\.paused && a\.readyState >= 2\)\) \{ try \{ a\.currentTime = t; \} catch \(e\) \{\} \}/.test(seek) && /_sbmScrub = !done;/.test(seek));
const paint = fn('_sbmPaintPlayer');
check('while the thumb is held the file does not move it back, and a cancelled drag lets go',
  /if \(!_sbmScrub\) _sbmPaintSeek\(_sbmClampTime\(a\.currentTime, dur\), dur\);/.test(paint) &&
  /if \(_sbmScrub && document\.activeElement !== rg\) _sbmScrub = false;/.test(paint) && /rg\.disabled = !\(dur > 0\);/.test(paint));
check('the old click-only strip is gone, and the new actions are on WO',
  !has(/sbm-player__track/) && !has(/function sbmSeek\(/) && !has(/sbmSeek: sbmSeek/) && has(/sbmSeekTo: sbmSeekTo, sbmSkip: sbmSkip,/));
check('the slider is big enough for a finger', has(/\.sbm-player__range \{[^}]*height: 30px;/) && has(/\.sbm-player__range::-webkit-slider-thumb \{ -webkit-appearance: none; width: 22px; height: 22px;/));

console.log('\nThe choir score, without the key above it');
check('no "Sing together / Waiting" key: the badge on each moment says it', !has(/_sbmTogetherKey/) && !has(/sbm-together-key/));

console.log('\nA double-tap on the words draws');
const bind = fn('_sbmDblBind'), dbl = fn('_sbmDblDraw'), card = fn('_sbmDblCard');
check('bound once on the song view, at every render', has(/if \(!modal \|\| !root\) return;\r?\n\s*_sbmDblBind\(root\);/) && /root\.__sbmDbl = true;/.test(bind));
check('a double-click, or two taps close in time and place on a phone',
  /root\.addEventListener\('dblclick', function\(e\) \{ var c = _sbmDblCard\(e\.target\); if \(c\) _sbmDblDraw\(e\); \}\);/.test(bind) &&
  /if \(T && now - T\.at < 350 && Math\.hypot\(e\.clientX - T\.x, e\.clientY - T\.y\) < 32\) \{ _sbmTap = null; _sbmDblDraw\(e\); \}/.test(bind) &&
  /e\.pointerType !== 'touch' \|\| !d \|\| d\.moved \|\| Date\.now\(\) - d\.at > 400 \|\| _sbmDraw \|\| _sbNp/.test(bind));
check('anywhere on a card of words, but not its chips, a button, a field or an instrument strip',
  /t\.closest\('button, a, input, textarea, select, label, \[contenteditable="true"\], \.sbm-label, \.sbm-inst, \.sbm-xpsel'\)/.test(card) &&
  /return \(card && card\.querySelector\('\.sbm-lyrics, \.sbm-score'\)\) \? card : null;/.test(card));
check('the pen comes out once, however the double-tap arrives, and not over typing',
  /if \(_sbmDraw \|\| _sbNp \|\| Date\.now\(\) - _sbmDblAt < 600\) return;/.test(dbl) && /if \(!_sbmDraw\) sbmDraw\(true\);/.test(dbl));
check('the song view no longer edits a choir line where it sits; the printed pages still do',
  has(/if \(window\.lhcVoiceEdit && !page\.closest\('#sbmRoot'\)\) \{/));
check('...so it no longer offers "+ chords" there, and two taps are not a zoom',
  has(/#sbmRoot \.sbm-score \.vl-score \.vl-chord-hint \{ display: none; \}/) && has(/#sbmRoot \.sbm-card \{ touch-action: manipulation; \}/) &&
  !has(/for the double-click that changes the part \*\//));
check('the Draw chip says so', has(/a ring, an arrow, a breath mark\. Or double-tap the words\. /));

// ---------------------------------------------- the third pass, same day
// One row of tiles with More at its end; More's icons in colour, with Links
// and Browse; a bright yellow floater 10px taller; and, the first time on a
// device (asked: "First time per device"), a five-second flash to the words.
console.log('\nOne row of tiles, More at its end');
const rnd = fn('_sbmRender');
const tileRow = (rnd.match(/html \+= '<div class="sbm-tile-row sbm-tiles sbm-tile-row--7">'[^]*?'<\/div><\/div>';/) || [''])[0];
const order = ['WO.sbmRecord()', 'WO.sbmPractice()', 'WO.sbmVideos()', 'WO.sbmBookMode()', '_sbmDrawingsTile(song)', 'WO.sbmEdit()', 'WO.sbmMore()'];
const at = order.map(k => tileRow.indexOf(k));
check('Record, Tracks, YouTube, Book Mode, Drawings, Edit, More -- in that order, in one row',
  !!tileRow && at.every((p, i) => p > -1 && (i === 0 || p > at[i - 1])), JSON.stringify(at));
check('...Practice is called Tracks', /<\/i>Tracks<\/button>/.test(tileRow) && !/<\/i>Practice<\/button>/.test(tileRow));
check('...and Links, Browse, Versions and Medley are not tiles any more',
  !/WO\.sbmResources\(\)|WO\.sbmBrowse\(\)|WO\.sbmVersions\(\)|WO\.sbmMedley\(\)/.test(tileRow) && !/var verTile/.test(rnd));
const more = fn('sbmMore');
check('More has Links and Browse, where Read in full screen and Edit choir parts were',
  /\['fa-link', 'Links', 'WO\.sbmResources\(\)'/.test(more) &&
  /\['fa-globe', 'Browse online', 'WO\.sbmCloseSheet\(\);WO\.sbmBrowse\(\)'/.test(more) &&
  !/'Read in full screen'/.test(more) && !/'Edit choir parts'/.test(more));
check('...and still Medley and Versions', /'Edit the medley' : 'Make a medley'/.test(more) && /'Versions of this song'/.test(more));
const rowsIn = (more.match(/\['fa-[a-z-]+', [^\]]*\]/g) || []);
check('every icon in More has a colour of its own', rowsIn.length >= 16 && rowsIn.every(r => /, '#[0-9a-f]{6}'\]$/.test(r)) &&
  /<i class="fa-solid ' \+ r\[0\] \+ '" style="color:' \+ r\[3\] \+ '"><\/i>/.test(more), rowsIn.filter(r => !/'#[0-9a-f]{6}'\]$/.test(r)).join(' | '));
check('...and Playlist has an icon the free set has (fa-list-music is not in it)', !/fa-list-music/.test(more) && /\['fa-circle-play', 'Playlist'/.test(more));

console.log('\nThe floater, bright yellow and larger');
const guideCss = (SRC.match(/\.sbm-guide \{[^}]*\}/) || [''])[0];
check('bright yellow, 56px tall (10px more), its words larger', /background: #ffd60a;/.test(guideCss) && /min-height: 56px;/.test(guideCss) && /font: 800 17px\/1/.test(guideCss));

console.log('\nThe first time: a flash to the words, 2.5 seconds');
const gc = fn('_sbmGuideCheck'), show = fn('_sbmIntroShow'), due = fn('_sbmIntroDue'), end = fn('_sbmIntroEnd');
// (Since the second ask it shows whenever the words are not yet up the screen,
// a desk too, and the floater comes after it: tools/songbook-coach-harness.js.)
check('it comes at the first opening, the floater after it, and waits while it is up',
  /if \(_sbmIntroDue\(\) && _sbmIntroWant\(wt, wb, r\.height\)\) \{ _sbmIntroShow\(\); want = true; \}/.test(gc) && /if \(_sbmIntroUp\(\)\) want = false;/.test(gc));
// (Third ask, 2026-11-08: "only the first time the songbook is accessed" --
// once on the device -- and 2.5 seconds instead of 5.)
check('once on the device, never in the desk\'s Phone view', /return !_sbmIntroDone && !window\.__SBM_PREVIEW && !_sbmSeenHere\('lhc_sbm_intro_seen'\);/.test(due) &&
  /_sbmIntroDone = true;\r?\n\s*_sbmSeenMark\('lhc_sbm_intro_seen'\);/.test(show));
check('two and a half seconds, or a tap, and then the floater', /_sbmIntroT = setTimeout\(_sbmIntroEnd, 2500\);/.test(show) && /el\.addEventListener\('click', _sbmIntroEnd\);/.test(show) &&
  /el\.remove\(\);\r?\n\s*_sbmGuideCheck\(\);/.test(end));
check('it says where the words are, and flashes', /Scroll down!/.test(show) && /The chords &amp; lyrics are just below/.test(show) &&
  has(/sbmIntroWobble 2\.4s ease-in-out \.5s infinite, sbmIntroFlash \.9s ease-in-out \.5s 3;/) && has(/@keyframes sbmIntroTime \{ from \{ transform: scaleX\(1\); \} to \{ transform: scaleX\(0\); \} \}/));
// Half the screen, and a cartoon (the operator, the same day).
const introCard = (SRC.match(/\.sbm-intro__card \{[^}]*\}/) || [''])[0];
check('the flash is half the screen, a cartoon: thick outline, hard shadow, rays behind',
  /height: 50%;/.test(introCard) && /border: 5px solid #1a1405;/.test(introCard) && /box-shadow: 10px 10px 0 #1a1405;/.test(introCard) &&
  /<div class="sbm-intro__burst" aria-hidden="true"><\/div>/.test(show) && has(/repeating-conic-gradient\(rgba\(255, 214, 10, 0\.30\)/));
{
  let art = null;
  try { art = new Function(extractFn('_sbmIntroArt') + '\nreturn _sbmIntroArt;')(); } catch (e) { art = null; }
  const a = art ? art() : '';
  check('...with a phone whose song scrolls up for ever under a gloved finger: the lines drawn twice, one set\'s height apart',
    /<svg class="sbm-intro__phone" viewBox="0 0 120 200"/.test(a) && /class="sbm-intro__lines" style="--sbm-set:(\d+)px"/.test(a) &&
    (() => { const h = a.match(/--sbm-set:(\d+)px/)[1]; return a.indexOf('<g transform="translate(0 ' + h + ')">') > -1; })() &&
    /<i class="fa-solid fa-hand-pointer sbm-intro__hand"><\/i>/.test(show) && has(/@keyframes sbmIntroScroll \{ from \{ transform: translateY\(0\); \} to \{ transform: translateY\(calc\(-1 \* var\(--sbm-set\)\)\); \} \}/));
}
// Run it: the first time it shows, the second it does not.
{
  let Idue = null;
  try {
    Idue = new Function('localStorage', 'window', 'document', 'setTimeout', 'clearTimeout', '_sbmGuideCheck',
      extractVar('_sbmIntroT') + '\n' + ['_sbmSeenHere', '_sbmSeenMark', '_sbmIntroDue', '_sbmIntroUp', '_sbmIntroShow', '_sbmIntroArt', '_sbmIntroEnd'].map(extractFn).join('\n') + '\nreturn { due: _sbmIntroDue, show: _sbmIntroShow };');
  } catch (e) { Idue = null; }
  if (!Idue) check('the flash runs', false);
  else {
    const store = {}, added = [];
    const ls = { getItem: k => store[k] == null ? null : store[k], setItem: (k, v) => { store[k] = String(v); } };
    let el = null;
    const doc = { getElementById: id => id === 'songbookLiveModal' ? { appendChild: e => { el = e; added.push(e); } } : (id === 'sbmIntro' ? el : null),
      createElement: () => ({ setAttribute() {}, addEventListener() {}, remove() { el = null; } }) };
    const api = Idue(ls, {}, doc, () => 1, () => {}, () => {});
    const first = api.due();
    api.show();
    check('the first time it shows, and the device remembers it', first === true && added.length === 1 && !!store.lhc_sbm_intro_seen);
    check('...and not again while the app stays open', api.due() === false);
    const api2 = Idue(ls, {}, doc, () => 1, () => {}, () => {});
    check('...nor the next time the app is opened: phones reopen it all day', api2.due() === false);
    const none = { getItem: () => { throw new Error('no storage'); }, setItem: () => { throw new Error('no storage'); } };
    let el2 = null;
    const doc2 = { getElementById: id => id === 'songbookLiveModal' ? { appendChild: e => { el2 = e; } } : (id === 'sbmIntro' ? el2 : null),
      createElement: () => ({ setAttribute() {}, addEventListener() {}, remove() { el2 = null; } }) };
    const p1 = Idue(none, {}, doc2, () => 1, () => {}, () => {});
    const pf = p1.due(); p1.show();
    check('a browser that keeps nothing: once while the app stays open', pf === true && p1.due() === false);
    const api3 = Idue({ getItem: () => null, setItem: () => {} }, { __SBM_PREVIEW: true }, doc, () => 1, () => {}, () => {});
    check('...nor in the desk\'s Phone view', api3.due() === false);
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (EXPECT_BROKEN) {
  if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
  console.log('--expect-broken: failures above are the expected ones');
  process.exit(0);
}
process.exit(fail ? 1 : 0);
