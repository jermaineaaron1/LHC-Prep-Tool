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
check('Copy an arrangement is still under More', has(/if \(song && order\) rows\.push\(\['fa-clone', 'Copy an arrangement/));
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
check('it says where it goes, as the view mode calls it', /'Choir parts' : view === 'lyrics' \? 'Lyrics' : 'Chords & Lyrics'/.test(fn('_sbmGuideLabel')));

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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (EXPECT_BROKEN) {
  if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
  console.log('--expect-broken: failures above are the expected ones');
  process.exit(0);
}
process.exit(fail ? 1 : 0);
