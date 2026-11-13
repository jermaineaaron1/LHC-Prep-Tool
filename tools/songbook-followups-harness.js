'use strict';
// Harness for the four larger fixes left over from the review of 2026-11-12
// (CLAUDE.md gotcha 94):
//   1. backgrounds after a song is drawn again (another device's change, the
//      words split again) -- the redrawn song lost its own and the later
//      slides took their neighbours';
//   2. the order's template is merged with what is stored, key by key,
//      instead of written whole from this device's copy -- a Songbook left
//      open on a phone put back the sections and medleys changed since;
//   3. the Songbook's remove, reorder and blank page are steps the builder's
//      Undo knows, so its next Undo does not put them back;
//   4. a song deleted from the library stays in a standalone songbook.
//
// USAGE
//   node tools/songbook-followups-harness.js
//   node tools/songbook-followups-harness.js <Index.html> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
const fn = name => { const m = SRC.match(new RegExp('\\n  function ' + name + '\\([^)]*\\) \\{[^]*?\\n  \\}')); return m ? m[0] : ''; };
const meth = name => { const m = SRC.match(new RegExp('\\n  ' + name + ': function\\([^)]*\\) \\{[^]*?\\n  \\},')); return m ? m[0].replace(/^\n/, '').replace(/,$/, '') : ''; };

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 600) : '')); }
}
const J = JSON.stringify;
const bail = e => { check('no unexpected error', false, String(e && e.stack || e)); console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(1); };
process.on('unhandledRejection', bail);
process.on('uncaughtException', bail);

if (!meth('_tplMerge')) {
  if (EXPECT_BROKEN) { console.log('--expect-broken: no SBQ._tplMerge, as expected.'); process.exit(0); }
  console.log('FAIL there is no SBQ._tplMerge'); process.exit(1);
}
if (EXPECT_BROKEN) { console.log('\nBUT --expect-broken was given and the fixes are present.'); process.exit(1); }

(async () => {
  // -------------------------------------------------------------------------
  console.log('\n2. The template, merged key by key with what is stored');
  const SBQ = new Function('var SBQ = { _tplBase: {},\n' + ['_tplPlain', '_tplNote', '_tplJson', '_tplMerge', '_tplWithStored'].map(meth).join(',\n') + '\n};\nreturn SBQ;')();
  const base = { sectionLayout: [{ id: 's1' }], medleys: [], serviceNotes: 'x' };
  let m = SBQ._tplMerge({ sectionLayout: [{ id: 's1' }], medleys: [], serviceNotes: 'x' }, { sectionLayout: [{ id: 's1' }, { id: 'NEW' }], medleys: [{ id: 'm', songs: ['a', 'b'] }], serviceNotes: 'x' }, base);
  check('this device changed nothing: the sections and medleys changed elsewhere are kept, not written back',
    J(m.template.sectionLayout) === J([{ id: 's1' }, { id: 'NEW' }]) && m.template.medleys.length === 1 && J(m.taken.sort()) === J(['medleys', 'sectionLayout']), J(m));
  m = SBQ._tplMerge({ sectionLayout: [{ id: 's1' }], medleys: [{ id: 'mine', songs: ['c', 'd'] }] }, { sectionLayout: [{ id: 's1' }, { id: 'NEW' }], medleys: [{ id: 'theirs', songs: ['a', 'b'] }] }, base);
  check('a key this device changed is written (that key\'s last writer), the others as stored', m.template.medleys[0].id === 'mine' && m.template.sectionLayout.length === 2 && J(m.taken) === J(['sectionLayout']), J(m));
  m = SBQ._tplMerge({ sectionLayout: [{ id: 's1' }] }, { sectionLayout: [{ id: 's1' }], serviceLiturgy: { id: 'svl' } }, { sectionLayout: [{ id: 's1' }] });
  check('a key added elsewhere is kept', J(m.template.serviceLiturgy) === J({ id: 'svl' }));
  m = SBQ._tplMerge({ sectionLayout: [] }, { sectionLayout: [], serviceLiturgy: { id: 'svl' } }, { serviceLiturgy: { id: 'svl' } });
  check('a key taken out here stays out', !('serviceLiturgy' in m.template), J(m));
  m = SBQ._tplMerge({ sectionLayout: [] }, { sectionLayout: [{ id: 'NEW' }] }, {});
  check('nothing, null, [] and {} are one nothing: an empty layout made here is not a change', J(m.template.sectionLayout) === J([{ id: 'NEW' }]));
  m = SBQ._tplMerge({ a: 1 }, { a: 2, b: 3 }, null);
  check('nothing loaded to compare with: this device\'s keys written, the rest kept', m.template.a === 1 && m.template.b === 3);
  m = SBQ._tplMerge({ _inbox: [1], _inboxPresent: true }, { _inbox: [9] }, { _inbox: [9] });
  check('the inbox keeps its own rules (this device\'s list)', J(m.template._inbox) === J([1]));
  check('the comparison ignores key order', SBQ._tplJson({ a: 1, b: { c: 2, d: 3 } }) === SBQ._tplJson({ b: { d: 3, c: 2 }, a: 1 }));
  const row = { template: { sectionLayout: [{ id: 's1' }], _inbox: [] } };
  SBQ._tplNote('o1', { sectionLayout: [{ id: 's1' }] });
  const fake = (r) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(r) }) }) }) });
  const w = await SBQ._tplWithStored(fake({ data: { template: { sectionLayout: [{ id: 's1' }, { id: 'NEW' }] } } }), 'o1', row);
  check('the save reads what is stored and writes the merge', row.template.sectionLayout.length === 2 && J(w.taken) === J(['sectionLayout']) && !('_inbox' in w.template));
  const row2 = { template: { a: 1 } };
  const w2 = await SBQ._tplWithStored(fake({ error: { message: 'offline' } }), 'o1', row2);
  check('...and with nothing read, writes its own as before', row2.template.a === 1 && J(w2.taken) === J([]));
  const save = meth('saveOrder');
  check('an order\'s save goes through it, and what it wrote becomes what it compares with',
    /: SBQ\._tplWithStored\(sb, id, orderRow\)\.then\(function\(m\) \{/.test(save) && /if \(ok\) SBQ\._tplNote\(id, orderRow\.template\);/.test(save) && /template: _tplMerged, tplTaken: _tplTaken/.test(save));
  check('what each device loads is noted: the editor\'s open and the shared-link Songbook',
    /_tplLoadedForOrder = result\.order\.id;[^\n]*\n\s*SBQ\._tplNote\(result\.order\.id, result\.order\.template\);/.test(SRC) &&
    /_tplLoadedForOrder = orderMeta\.id;[^\n]*\n\s*SBQ\._tplNote\(orderMeta\.id, orderMeta\.template\);/.test(fn('openSongbookByOrderId')));
  check('the screen takes in what another device changed', /if \(result\.tplTaken && result\.tplTaken\.length\) _woTplAdopt\(result\.template, result\.tplTaken\);/.test(fn('saveCurrentOrder')));
  const ad = { renders: [] };
  const A = new Function('ad', `
    var currentOrderData = { template: { sectionLayout: [{ id: 's1' }], medleys: [] }, sectionLayout: [{ id: 's1' }], clearedSections: [] };
    var sectionBackgrounds = { old: {} };
    var localStorage = { setItem: function() {} };
    function _slideBgKey() { return 'k'; }
    function updateSlideBgIndicators() { ad.renders.push('bg'); }
    function _lbdIsActive() { return true; }
    function _woLcdInPage() { return false; }
    function lbdRender() { ad.renders.push('builder'); }
    function _sbmBookOpen() { return true; }
    function renderSongbookLive() { ad.renders.push('songbook'); }
    ${fn('_woTplAdopt')}
    return { adopt: _woTplAdopt, get: function() { return { cod: currentOrderData, bg: sectionBackgrounds }; } };`)(ad);
  A.adopt({ sectionLayout: [{ id: 's1' }, { id: 'NEW' }], sectionBackgrounds: { s1: { 0: 'x' } } }, ['sectionLayout', 'sectionBackgrounds']);
  const got = A.get();
  check('...the sections and backgrounds, and the builder and the Songbook drawn again',
    got.cod.sectionLayout.length === 2 && got.cod.template.sectionLayout.length === 2 && got.bg.s1[0] === 'x' && J(ad.renders) === J(['bg', 'builder', 'songbook']), J([got, ad.renders]));

  // -------------------------------------------------------------------------
  console.log('\n1. Backgrounds after a song is drawn again');
  const mk = (song, lit) => ({ song, lit, getAttribute: k => (k === 'data-song-id' ? song || null : k === 'data-liturgy-id' ? lit || null : null) });
  const dom = { boxes: [] };
  const B = new Function('dom', `
    var sectionBackgrounds = {};
    var document = {
      getElementById: function(id) { return id === 'sec1-boxes' ? { querySelectorAll: function() { return dom.boxes; } } : null; },
      querySelectorAll: function() { return [{ id: 'sec1' }]; }
    };
    function getBackgroundForSlideInSection(sec, i) { return (sectionBackgrounds[sec] || {})[i] || null; }
    function saveSlideBackgrounds() { dom.saved = (dom.saved || 0) + 1; }
    ${fn('_lcdBgItemOf')}
    ${fn('_lcdCaptureSectionBgs')}
    ${fn('_lcdRestoreSectionBgs')}
    ${fn('_lcdCaptureAllBgs')}
    ${fn('_lcdRestoreAllBgs')}
    return { set: function(m) { sectionBackgrounds = m; }, get: function() { return sectionBackgrounds; }, all: _lcdCaptureAllBgs, restoreAll: _lcdRestoreAllBgs };`)(dom);
  const L1 = mk('', 'lit1'), S1 = [mk('s1'), mk('s1'), mk('s1')], T1 = mk('s2');
  dom.boxes = [L1].concat(S1, [T1]);
  B.set({ sec1: { 0: 'bgA', 2: 'bgB', 4: 'bgC' } });
  const snap = B.all();
  // the song s1 redrawn by another device's change: its boxes gone, two new ones in their place
  const S1n = [mk('s1'), mk('s1')];
  dom.boxes = [L1].concat(S1n, [T1]);
  B.restoreAll(snap);
  check('a song drawn again keeps its slides\' backgrounds by their place in it; the slides after keep theirs',
    J(B.get().sec1) === J({ 0: 'bgA', 2: 'bgB', 3: 'bgC' }), J(B.get()));
  check('...one write for all of them', dom.saved === 1);
  const delta = fn('_orderSyncApplyDelta');
  check('another device\'s change: captured before anything comes off, put back before the wall is sent again',
    delta.indexOf('_lcdCaptureAllBgs()') > -1 && delta.indexOf('_lcdCaptureAllBgs()') < delta.indexOf('.forEach(_orderSyncRemoveOne)') &&
    delta.indexOf('_lcdRestoreAllBgs(_bgSnap)') > delta.indexOf('_orderSyncReorderSection(') && delta.indexOf('_lcdRestoreAllBgs(_bgSnap)') < delta.indexOf('_orderSyncRestoreLive(liveSel)'));
  const rs = fn('refreshSongSlidesInOrder');
  check('the words split again into a different number of slides: the same',
    rs.indexOf('var _bgSnap = _lcdCaptureSectionBgs(sectionId);') > -1 && rs.indexOf('var _bgSnap') < rs.indexOf('existingBoxes.forEach(function(box) { box.remove(); });') && /if \(_bgSnap\) _lcdRestoreSectionBgs\(sectionId, _bgSnap\);/.test(rs));

  // -------------------------------------------------------------------------
  console.log('\n3. The Songbook\'s changes to the songs are steps the builder\'s Undo knows');
  const env = (standalone) => {
    const log = [];
    const E = new Function('log', 'standalone', `
      var songOrderSections = [{ id: 'a', songId: 'la' }, { id: 'b', songId: 'lb' }, { id: 'c', songId: 'lc' }];
      var _sbStandaloneId = standalone ? 'sb1' : null, _woUserClearedTypes = {};
      var window = { renderSongbooksList: null };
      var localStorage = { getItem: function() { return '[]'; }, setItem: function() {} };
      var SBQ_SONGBOOKS = { updateFields: function() { return Promise.resolve(); } };
      function confirm() { return true; }
      function _woSongsChange(f) { log.push('step'); f(); return true; }
      function _woLcdDropSong(id) { log.push('lcd:' + id); }
      function renderSongbookLive() {}
      function autoSaveOrder() { log.push('save'); }
      function sbAutoSave() {}
      function showToast() {}
      function _sbmLiveSend() {}
      function setTimeout() {}
      function sbScrollToSong() {}
      ${fn('sbRemoveSong')}
      ${fn('_sbApplySongOrder')}
      ${fn('sbAddBlankPageAfter')}
      return { remove: sbRemoveSong, order: _sbApplySongOrder, blank: sbAddBlankPageAfter, ids: function() { return songOrderSections.map(function(s) { return s.id; }); } };`)(log, standalone);
    return { E, log };
  };
  let t = env(false);
  t.E.remove('b');
  check('a song taken out of a service\'s book: one step, the LCD told', J(t.log) === J(['step', 'lcd:b']) && J(t.E.ids()) === J(['a', 'c']), J(t.log));
  t = env(false);
  t.E.order([{ id: 'c' }, { id: 'a' }, { id: 'b' }]);
  check('...reordered: one step', J(t.log) === J(['step']) && J(t.E.ids()) === J(['c', 'a', 'b']));
  t = env(false);
  t.E.blank('a');
  check('...a blank page put in: one step', J(t.log) === J(['step']) && t.E.ids().length === 4 && t.E.ids()[0] === 'a' && /^sbblank_/.test(t.E.ids()[1]));
  t = env(true);
  t.E.remove('b');
  check('a standalone songbook (no builder) is changed as before', J(t.log) === J(['save']) && J(t.E.ids()) === J(['a', 'c']), J(t.log));

  // -------------------------------------------------------------------------
  console.log('\n4. A song deleted from the library stays in a standalone songbook');
  const open = fn('openSongbookStandalone');
  check('once the library has loaded, a song it no longer has is kept as what the book saved of it',
    /var libLoaded = !!\(window\.STATE && Array\.isArray\(window\.STATE\.songs\) && window\.STATE\.songs\.length\);/.test(open) &&
    /if \(!song\) \{\n\s*if \(!libLoaded\) return null;\n\s*song = \{ id: sid, title: \(saved\.title \? saved\.title \+ ' \(removed from the song library\)'/.test(open) &&
    /lyrics: saved\.customLyrics \|\| ''/.test(open));
  check('...before the library loads, nothing is taken for deleted', /if \(!libLoaded\) return null;/.test(open));
  check('the book keeps each song\'s name with its copy, so a song deleted later is still named',
    /title:\s+s\.libTitle \|\| s\.title \|\| '',\n\s*artist:\s+s\.artist \|\| '',/.test(SRC) && /libTitle: song\.__removed \? song\.__title : \(song\.title \|\| ''\),/.test(open));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
