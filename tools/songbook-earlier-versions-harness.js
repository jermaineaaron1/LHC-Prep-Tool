'use strict';
// Harness for Earlier versions, and for the service each take was made for.
//
// WHY THIS EXISTS
// From the operator (2026-11-08): singers asked whether what a service does
// to a song overwrites the song in the Songs page (it does not -- each service
// sings its own copy), and asked to get back how an earlier service sang a
// song, with its drawings and recordings, to sing it that way again --
// medleys too -- with the earlier service's recordings clearly marked as made
// for that service, not this one. What has to hold:
//
//   * every recorder notes the service a take is made for (order_id), only
//     while the songbook is open; a cut keeps its recording's service;
//   * every list of takes says which service each was made for, and marks
//     another service's;
//   * Earlier versions lists the song's copies in earlier services -- with the
//     medleys they were sung in -- its saved versions and saved medleys, each
//     to Open (read-only, with drawings and that service's recordings) and to
//     Use here;
//   * the read-only card paints the drawings of the version it shows, never
//     this copy's, and cannot be drawn on -- on the words and chords, and on
//     the choir score too (its own tab), each tab counting its drawings;
//   * the badge under the song's title counts earlier services and saved
//     versions, never this service or a standalone songbook.
//
// USAGE
//   node tools/songbook-earlier-versions-harness.js
//   node tools/songbook-earlier-versions-harness.js <file> --expect-broken
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8');
const lines = SRC.split('\n');

const _sliced = {};
function extractFn(name) {
  if (_sliced[name]) return _sliced[name];
  const head = new RegExp('^  function ' + name + '\\s*\\(');
  const startIdx = lines.findIndex(l => head.test(l));
  if (startIdx < 0) throw new Error('function not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return (_sliced[name] = out.join('\n'));
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}
function extractVar(name) {
  const head = new RegExp('^  var ' + name + '\\b');
  const l = lines.find(x => head.test(x));
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
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

// A stand-in Supabase: answers from tables of rows, honouring eq / in.
function fakeSup(tables, log) {
  return { from(t) {
    const q = { t, f: [] };
    q.select = () => q; q.order = () => q; q.limit = () => q;
    q.eq = (c, v) => { q.f.push(r => String(r[c]) === String(v)); return q; };
    q.in = (c, vs) => { (log || []).push(t + ':' + vs.join(',')); q.f.push(r => vs.map(String).indexOf(String(r[c])) !== -1); return q; };
    q.then = (a, b) => Promise.resolve(tables[t] === 'error' ? { data: null, error: { message: 'no' } } : { data: (tables[t] || []).filter(r => q.f.every(f => f(r))), error: null }).then(a, b);
    return q;
  } };
}

(async () => {
  // ------------------------------------------------- 1. which service a take was made for
  console.log('\n1. Which service a take was made for');
  let F = null;
  try { F = new Function(extractFn('_sbRecFrom') + '\nreturn _sbRecFrom;')(); } catch (e) { F = null; }
  if (!F) check('a take\'s service is read by a function of its own', false);
  else {
    const names = { order_old: { title: 'Service - Nov 8' }, standalone_sb1: { title: 'LHC Caroling 2026' }, order_gone: null };
    let f = F({ order_id: 'order_now' }, 'order_now', names);
    check('a take made for the service in front says so', f.kind === 'here' && /Made for this service/.test(f.text), JSON.stringify(f));
    f = F({ order_id: 'order_old' }, 'order_now', names);
    check('another service\'s take is "other", named, and says it is not this service', f.kind === 'other' && /Made for Service - Nov 8/.test(f.text) && /not this service/.test(f.text), JSON.stringify(f));
    f = F({ order_id: 'standalone_sb1' }, 'order_now', names);
    check('...a songbook\'s by the songbook\'s name', f.kind === 'other' && /the songbook .LHC Caroling 2026./.test(f.text), f.text);
    f = F({ order_id: 'order_gone' }, 'order_now', names);
    check('...a service since deleted says so', f.kind === 'other' && /a service since deleted/.test(f.text));
    f = F({ order_id: 'order_unread' }, 'order_now', names);
    check('...one not read yet is "an earlier service" until it is', f.kind === 'other' && /an earlier service/.test(f.text));
    f = F({ order_id: '' }, 'order_now', names);
    check('a take from before services were noted says so, and is not passed off as this service\'s', f.kind === 'none' && /not noted/.test(f.text));
    f = F({ order_id: 'standalone_sb1' }, 'standalone_sb1', names);
    check('in a songbook, its own takes say "this songbook"', f.kind === 'here' && /this songbook/.test(f.text));
    f = F({ order_id: 'order_old' }, 'standalone_sb1', names);
    check('...and a service\'s take there is "not this songbook"', f.kind === 'other' && /not this songbook/.test(f.text));
  }
  {
    const env = (open, order) => new Function('_sbmBookOpen', 'currentOrderData', extractFn('_sbRecOrderNow') + '\nreturn _sbRecOrderNow;')(() => open, order);
    let ok = false; try { ok = env(true, { id: 'order_now' })() === 'order_now' && env(false, { id: 'order_now' })() === null && env(true, null)() === null; } catch (e) { ok = false; }
    check('a take is made for the service in front, only while the songbook is open', ok);
  }
  {
    let L = null;
    try { L = new Function('window', extractVar('_sbRecOrders') + '\n' + extractFn('_sbRecOrdersLoad') + '\nreturn { load: _sbRecOrdersLoad, names: _sbRecOrders };'); } catch (e) { L = null; }
    if (!L) check('the services\' names are read by a function of their own', false);
    else {
      const log = [];
      const api = L({ _supabase: fakeSup({ orders: [{ id: 'order_old', title: 'Service - Nov 8', service_date: 'Nov 8', created_date: '2026-11-01' }] }, log) });
      const fresh = await api.load([{ order_id: 'order_old' }, { order_id: 'order_gone' }, { order_id: '' }, { order_id: 'order_old' }]);
      check('each service is asked once, by name; one missing is "gone"', fresh === true && log.length === 1 && log[0] === 'orders:order_old,order_gone' &&
        api.names.order_old.title === 'Service - Nov 8' && api.names.order_gone === null, JSON.stringify({ log, names: api.names }));
      const again = await api.load([{ order_id: 'order_old' }]);
      check('...and not asked again', again === false && log.length === 1);
      const bad = L({ _supabase: fakeSup({ orders: 'error' }, log) });
      const r1 = await bad.load([{ order_id: 'x1' }]);
      const r2 = await bad.load([{ order_id: 'x1' }]);
      check('a read that fails is tried again next time, not taken for "gone"', r1 === false && r2 === false && log.filter(x => x === 'orders:x1').length === 2 && !('x1' in bad.names));
    }
  }
  check('the line and section recorder notes the service, asking the songbook',
    /var forOrder = R\.orderId \? R\.orderId\(\) : null;\r?\n\s*if \(forOrder\) ins\.order_id = forOrder;\r?\n\s*return sb\.from\('song_recordings'\)\.insert\(ins\)\.select\(\);/.test(SRC) &&
    /R\.orderId = _sbRecOrderNow;/.test(fn('_sbRecHooks')));
  check('a cut keeps the service of the recording it was cut from, else the one in front',
    /var forOrder = \(C\.rec && C\.rec\.order_id\) \? String\(C\.rec\.order_id\) : _sbRecOrderNow\(\);\r?\n\s*if \(forOrder\) ins\.order_id = forOrder;/.test(fn('sbmCutSave')));
  check('the Record sheet goes on noting it', has(/sup\.from\('song_recordings'\)\.insert\(\{ song_id: songId, order_id: orderId \|\| null,/));
  check('the songbook gives the recorder its hooks before any take is listed or made',
    /function _sbmLoadRecs\(song\) \{\r?\n\s*_sbRecHooks\(\);/.test(SRC) && /function _sbmInstHooks\(\) \{\r?\n\s*_sbRecHooks\(\);/.test(SRC));
  const prac = fn('_sbmPaintPractice');
  check('Tracks: every take says which service it was made for; another service\'s is marked',
    /var from = _sbRecFromNow\(r\) \|\| \{ kind: 'none', text: '' \};/.test(prac) && /'<div class="sbm-rec sbm-rec--' \+ from\.kind \+ '"/.test(prac) &&
    /'<div class="sbm-rec__from">/.test(prac) && has(/\.sbm-rec--other, \.vl-pop-take--other \{ background: #fffbeb; box-shadow: inset 4px 0 0 #f59e0b;/));
  check('a line\'s takes say it too, and are marked the same way',
    has(/var from = R\.fromLabel \? R\.fromLabel\(t\) : null;/) && has(/'<div class="vl-pop-take' \+ \(on \? ' is-playing' : ''\) \+ \(from \? ' vl-pop-take--' \+ from\.kind : ''\) \+ '">'/) &&
    has(/\(from && from\.text \? '<div class="vl-pop-from">' \+ esc\(from\.text\) \+ '<\/div>' : ''\)/));
  check('the names, once read, are drawn into Tracks and an open line list',
    /_sbRecOrdersLoad\(_sbmRecs\[base\]\)\.then\(function\(fresh\) \{\r?\n\s*if \(!fresh\) return;\r?\n\s*if \(_sbmSid === song\.id\) _sbmPaintPractice\(song\);\r?\n\s*if \(window\.lhcVoiceRec && window\.lhcVoiceRec\._list\) window\.lhcVoiceRec\.paintList\(\);/.test(fn('_sbmLoadRecs')));
  check('outside the songbook no take is labelled against a stale service', /if \(!_sbmBookOpen\(\)\) return null;/.test(fn('_sbRecFromNow')));

  // ------------------------------------------------- 2. Earlier versions: what is read
  console.log('\n2. Earlier versions: what it reads');
  {
    let E = null;
    try {
      E = (sup, order) => new Function('window', 'currentOrderData', 'function _sbBaseSongId(s) { return s.songId; }\nfunction _woStripNum(t) { return String(t).replace(/^\\s*\\d+\\.\\s*/, ""); }\n' +
        extractFn('_sbArrEarlier') + '\nreturn _sbArrEarlier;')({ _supabase: sup }, order);
    } catch (e) { E = null; }
    if (!E) check('the earlier services are read by a function of their own', false);
    else {
      const sup = fakeSup({
        order_items: [
          { id: 'now1', order_id: 'order_now', source_id: 'song_x', item_type: 'song', section_id: 's1', customizations: {} },
          { id: 'sb1', order_id: 'standalone_sb1', source_id: 'song_x', item_type: 'song', section_id: '', customizations: {} },
          { id: 'old1', order_id: 'order_old', source_id: 'song_x', item_type: 'song', section_id: 's3', customizations: { transposeSteps: 2, versionId: 'v1' } }
        ],
        orders: [{ id: 'order_old', title: 'Service - Nov 8', created_date: '2026-11-01', service_date: 'Nov 8', layout: [{ id: 's3', title: '4. Praise' }],
          md: [{ id: 'md1', songs: ['old1', 'old2'] }, { id: 'md2', songs: ['zz', 'yy'] }, { id: 'md3', songs: ['old1'] }] }]
      });
      const rows = await E(sup, { id: 'order_now' })({ songId: 'song_x' });
      const r = rows[0] || {};
      check('...not this service, nor a standalone songbook; each knows its service and its entry', rows.length === 1 && r.kind === 'earlier' && r.orderId === 'order_old' && r.entryId === 'old1' && r.sub === 'Praise', JSON.stringify(rows));
      check('...with the medleys it was sung in there (a medley of one is none)', Array.isArray(r.medleys) && r.medleys.length === 1 && r.medleys[0].id === 'md1' && r.medleys[0].songs.join() === 'old1,old2', JSON.stringify(r.medleys));
    }
  }
  {
    let M = null;
    const lib = { song_a: { title: 'Silent Night' }, song_b: { title: 'O Holy Night' } };
    try {
      extractFn('_sbEvMedleys');
      M = sup => new Function('window', '_lbdLibSong', extractFn('_sbEvMedleys') + '\nreturn _sbEvMedleys;')({ _supabase: sup }, id => lib[id] || null);
    } catch (e) { M = null; }
    if (!M) check('the medleys are rebuilt by a function of their own', false);
    else {
      const log = [];
      const sup = fakeSup({ order_items: [
        { id: 'old1', source_id: 'song_a', customizations: { transposeSteps: 3, versionId: 'v9' } },
        { id: 'old2', source_id: 'song_b', customizations: { transposeSteps: -2, customLyrics: 'C\nwords' } }
      ] }, log);
      const earlier = [{ orderId: 'order_old', title: 'Service - Nov 8', at: '2026-11-01', medleys: [{ id: 'md1', songs: ['old1', 'old2'] }] },
                       { orderId: 'order_old', title: 'Service - Nov 8', at: '2026-11-01', medleys: [{ id: 'md1', songs: ['old1', 'old2'] }] }];
      const ms = await M(sup)(earlier);
      const m = ms[0] || {};
      check('each medley once, its songs in order with how that service sang them', ms.length === 1 && m.kind === 'medley' && m.orderId === 'order_old' &&
        m.songs.map(s => s.songId + ':' + s.src.steps).join() === 'song_a:3,song_b:-2' && m.songs[0].src.versionId === 'v9' && m.songs[1].src.customLyrics === 'C\nwords' &&
        /Silent Night/.test(m.title) && /O Holy Night/.test(m.title) && log.length === 1, JSON.stringify(ms));
      const none = await M(fakeSup({ order_items: [{ id: 'old1', source_id: 'song_a', customizations: {} }] }))(earlier);
      check('...and one whose other songs are gone is not offered', none.length === 0);
    }
  }
  {
    let S = null;
    try { extractFn('_sbEvSavedMedleys'); S = rows => new Function('_mdsLoad', '_lbdLibSong', extractFn('_sbEvSavedMedleys') + '\nreturn _sbEvSavedMedleys;')(() => Promise.resolve(rows), () => null); } catch (e) { S = null; }
    if (!S) check('the saved medleys with this song are read by a function of their own', false);
    else {
      const out = await S([{ id: 'm1', title: 'A > B', songs: [{ songId: 'song_x', title: 'X', transposeSteps: 2 }, { songId: 'song_y', title: 'Y' }] },
                           { id: 'm2', title: 'C > D', songs: [{ songId: 'song_c' }, { songId: 'song_d' }] }])('song_x');
      check('only the saved medleys this song is in, each song in its saved key', out.length === 1 && out[0].saved === true && out[0].songs[0].src.steps === 2 && out[0].kind === 'medley', JSON.stringify(out));
    }
  }

  // ------------------------------------------------- 3. Open: read-only
  console.log('\n3. Open: an earlier arrangement, read-only');
  {
    let T = null;
    const lib = { song_x: { title: 'Joy', key: 'D', lyrics: 'D\nJoy to the world' } };
    try { T = new Function('_lbdLibSong', extractFn('_sbEvTemp') + '\nreturn _sbEvTemp;')(id => lib[id] || null); } catch (e) { T = null; }
    if (!T) check('the song it shows is made by a function of its own', false);
    else {
      const a = T('song_x', 'Joy', { steps: 2, versionId: 'v1', customLyrics: 'G\nIts own words', richLyrics: null });
      const b = T('song_x', 'Joy', { steps: -1, versionId: '' });
      check('its own words when it had them, its key and version', a.lyrics === 'G\nIts own words' && a.transposeSteps === 2 && a.versionId === 'v1' && a.songId === 'song_x' && a.id === '__sbev__');
      check('...the song\'s own words when it had none', b.lyrics === 'D\nJoy to the world' && b.richLyrics === null && b.transposeSteps === -1 && b.versionId === '');
    }
  }
  {
    let C = null;
    try { C = new Function('_sbmSongs', '_sbmSong', extractFn('_sbmCardSong') + '\nreturn _sbmCardSong;')(() => [{ id: 'a' }], () => ({ id: 'front' })); } catch (e) { C = null; }
    const temp = { id: '__sbev__', versionId: 'v1' };
    check('a read-only card paints the song it shows, never the copy in front', !!C && C({ __sbmSong: temp, getAttribute: () => '' }) === temp && C({ getAttribute: () => 'a' }).id === 'a' && C({ getAttribute: () => '' }).id === 'front');
  }
  const mount = fn('_sbEvMountOne');
  check('its drawings come from the reading view\'s own painter, on a canvas that cannot be drawn on',
    /card\.__sbmSong = temp;/.test(mount) && /_sbmStampAnchors\(card\);/.test(mount) && /_sbmMarksPaint\(card\)/.test(mount) &&
    /document\.createElement\('canvas'\); cv\.className = 'sbm-marks';/.test(mount) && !/_sbmMarkCanvas/.test(mount) && !/addEventListener\('pointer/.test(mount) &&
    has(/\.sbm-ev__card canvas\.sbm-marks \{ position: absolute; left: 0; top: 0; pointer-events: none; \}/));
  const open = fn('_sbEvSongOpen');
  check('every card of the sheet is mounted the same way: the words, and the choir score',
    /document\.querySelectorAll\('#sbmSheet \.sbm-ev__card'\), function\(card\) \{ _sbEvMountOne\(card, temp\); \}/.test(fn('_sbEvMountCards')) &&
    /_sbEvMountCards\(temp\);/.test(open) && !/_sbEvMountCard\(/.test(SRC));
  check('a song with choir parts gets a Choir parts tab beside Words & chords, the score card hidden until chosen',
    /var hasChoir = _sbSongHasChoir\(\{ songId: base \}\);/.test(open) && /data-ev-tab="choir" onclick="WO\.sbEvTab\(\\'choir\\'\)"/.test(open) &&
    /'<div class="sbm-card sbm-ev__card sbm-ev__card--choir" data-ev-view="choir" hidden>/.test(open) && /data-ev-view="words"/.test(open));
  check('...the score is Book Mode\'s read-only one, in the version\'s key, once the parts are read, and gets the version\'s drawings',
    /_sbLinesReady\(base\)\.then\(function\(\) \{\r?\n\s*var cc = choirCard\(\); if \(!cc\) return;\r?\n\s*var body = _sbChoirBodyHtml\(temp\);/.test(open) &&
    /_sbChoirCss\(temp\) \+ '<div class="sb-choir">' \+ _sbChoirHeadHtml\(temp, false\)/.test(open) && /\r?\n\s*_sbEvMountOne\(cc, temp\);\r?\n\s*\}, function\(\) \{/.test(open) &&
    /The choir parts as they are now: they are the song/.test(open));
  {
    let Sp = null;
    try { Sp = new Function(extractFn('_sbEvViewSplit') + '\nreturn _sbEvViewSplit;')(); } catch (e) { Sp = null; }
    const n = Sp ? Sp([{ anchor: 's:Verse 1|3/c:2' }, { anchor: 'l:4/w:2' }, { anchor: 's:CHORUS#2|1>l:2@g7' }, { anchor: 'l:1' }, { anchor: 's:Bridge|2/w:men:1' }, null]) : null;
    check('each tab counts the drawings on it: a moment of the score, or the words and chords', !!n && n.choir === 3 && n.words === 2, JSON.stringify(n));
  }
  check('...counted from what this reader is shown of the version', /var n = _sbEvViewSplit\(_sbmMarksOf\(temp\.songId, temp\.versionId \|\| ''\)\);/.test(fn('_sbEvViewCounts')) &&
    /Promise\.resolve\(_sbmLoadMarks\(temp\)\)\.then\(function\(\) \{ paint\(\); _sbEvViewCounts\(temp\); \}/.test(mount));
  check('choosing a tab shows its card and paints it again (a hidden card measures nothing)',
    /c\.hidden = c\.getAttribute\('data-ev-view'\) !== which;\r?\n\s*if \(!c\.hidden\) setTimeout\(function\(\) \{ if \(c\.isConnected\) _sbmMarksPaint\(c\); \}, 0\);/.test(fn('sbEvTab')) &&
    has(/sbEvTab: sbEvTab,/) && has(/\.sbm-ev__tabn\[hidden\], \.sbm-ev__card\[hidden\] \{ display: none; \}/));
  check('it says it is read-only and that nothing changes until Use here', /<b>Read only\.<\/b>/.test(open) && /Nothing here changes this service until you choose Use here\./.test(open));
  check('its words and chords in its key, with the recordings made for its service',
    /_sbBkLyricsHtml\(temp\)/.test(open) && /var mine = \(list \|\| \[\]\)\.filter\(function\(x\) \{ return String\(x\.order_id \|\| ''\) === String\(r\.orderId\); \}\);/.test(open) &&
    /Recordings made for ' \+ escapeHtml\(r\.title\)/.test(open));
  const row = fn('_sbEvRecRow');
  check('...each marked with the service it was made for', /var from = _sbRecFrom\(rec, currentOrderData && currentOrderData\.id, _sbRecOrders\);/.test(row) &&
    /'<div class="sbm-ev__rec sbm-ev__rec--' \+ from\.kind \+ '"/.test(row) && /'<div class="sbm-ev__from">/.test(row));
  const play = fn('sbEvPlay');
  check('its player: one take at a time, back to rest when it ends, fails or is refused; closing the sheet stops it',
    /a\.addEventListener\('ended', rest\); a\.addEventListener\('error', rest\);/.test(play) && /var p = a\.play\(\); if \(p && p\.catch\) p\.catch\(rest\);/.test(play) &&
    /_sbEvStop\(\);/.test(play) && /function _sbmCloseSheet\(\) \{ var el = document\.getElementById\('sbmSheet'\); if \(el\) el\.remove\(\); if \(_sbEvAudio\) _sbEvStop\(\); \}/.test(SRC));

  // ------------------------------------------------- 4. Use here
  console.log('\n4. Use here');
  const copy = fn('sbArrCopy');
  check('an arrangement is used in one step with Undo, a saved version the way Versions chooses one',
    /var before = _sbArrSnap\(song\);\r?\n\s*_sbArrApply\(song, r\.src\);\r?\n\s*_sbVerSaved\(\);/.test(copy) &&
    /if \(r\.kind === 'version'\) \{ _sbmCloseSheet\(\); sbVerUse\(r\.vid\); return; \}/.test(copy) && /if \(!song \|\| !r \|\| r\.kind === 'medley' \|\| r\.kind === 'member'\) return;/.test(copy));
  const useM = fn('sbEvUseMedley');
  check('a medley is made again through the medley editor\'s own Use, each song with its key',
    /openMedleyEditor\(song\.id\);/.test(useM) && /transposeSteps: s\.src\.steps/.test(useM) && /mdsUse\(row\.id\);/.test(useM));

  // ------------------------------------------------- 5. Where it is reached
  console.log('\n5. Where it is reached');
  check('a badge under the song\'s title, in a service\'s songbook', has(/if \(_sbmOrderBook\(\)\) badges \+= _sbEvBadge\(song\);/));
  check('...and More, where Copy an arrangement was', has(/rows\.push\(\['fa-clock-rotate-left', 'Earlier versions: how this service or an earlier one sang it, with drawings, recordings and medleys', 'WO\.sbmArrangements\(\)'/) && !has(/'Copy an arrangement: as this service or an earlier one sang it'/));
  {
    let B = null;
    try {
      extractVar('_sbEvN'); extractFn('_sbEvBadge'); extractFn('_sbEvCount');
      B = env => new Function('window', 'document', 'currentOrderData', '_sbVerSupport', '_sbVerLoad', '_sbVers', '_sbVerIsKept', '_sbBaseSongId', 'escapeHtml',
        extractVar('_sbEvN') + '\n' + extractFn('_sbEvBadge') + '\n' + extractFn('_sbEvCount') + '\nreturn { badge: _sbEvBadge, n: _sbEvN };')(
        env.window, env.document, env.order, () => Promise.resolve(true), () => Promise.resolve(), env.vers, v => v.made_from === 'library', s => s.songId, s => String(s));
    } catch (e) { B = null; }
    if (!B) check('the badge is counted by functions of its own', false);
    else {
      const el = { hidden: true, attrs: { 'data-sbm-ev': 'song_x' }, getAttribute(k) { return this.attrs[k]; }, n: { textContent: '0' }, querySelector() { return this.n; } };
      const env = { order: { id: 'order_now' }, vers: { song_x: [{ id: 'v1' }, { id: 'v2', made_from: 'library' }] },
        document: { querySelectorAll: () => [el] },
        window: { _supabase: fakeSup({ order_items: [
          { order_id: 'order_now', source_id: 'song_x', item_type: 'song' }, { order_id: 'order_a', source_id: 'song_x', item_type: 'song' },
          { order_id: 'order_a', source_id: 'song_x', item_type: 'song' }, { order_id: 'order_b', source_id: 'song_x', item_type: 'song' },
          { order_id: 'standalone_sb1', source_id: 'song_x', item_type: 'song' }, { order_id: 'order_c', source_id: 'song_y', item_type: 'song' }] }) } };
      const b = B(env);
      const html = b.badge({ songId: 'song_x' });
      check('it waits hidden until it is counted', /data-sbm-ev="song_x" hidden/.test(html) && /onclick="WO\.sbmArrangements\(\)"/.test(html));
      await flush();
      check('it counts the earlier services once each, never this one or a songbook, and the saved versions (not the kept main ones)',
        b.n.song_x.n === 3 && el.hidden === false && el.n.textContent === '3', JSON.stringify(b.n));
    }
  }
  const render = fn('_sbArrRender');
  check('the sheet says first that nothing a service does changes the song in the Songs page, and what every service shares',
    /<b>Nothing a service does to a song changes it in the Songs page\.<\/b>/.test(render) && /the choir parts, the drawings on a version \(Standard too\) and the recordings/.test(render));
  check('...then this service\'s other copies, the earlier services, the saved versions and the medleys, each to Open and to Use here',
    /section\('Earlier services', D\.earlier, nH, songCard,/.test(render) && /section\('Saved versions', versions,/.test(render) && /section\('Medleys it was sung in', D\.medleys,/.test(render) &&
    /onclick="WO\.sbEvOpen\(' \+ i \+ '\)"><i class="fa-solid fa-eye"><\/i>Open<\/button>/.test(render) && />Use here<\/button>/.test(render));
  check('...with the drawings on each one\'s version and the recordings made for each service counted',
    /var drawN = function\(vid\) \{ return _sbmMarksOk === true \? _sbmMarksOf\(base, vid \|\| ''\)\.length : 0; \};/.test(render) &&
    /recs\.filter\(function\(x\) \{ return String\(x\.order_id \|\| ''\) === String\(orderId\); \}\)\.length/.test(render));
  check('every new handler is reachable from the page', ['sbEvOpen', 'sbEvOpenMember', 'sbEvBack', 'sbEvUseMedley', 'sbEvPlay'].every(n => new RegExp(n + ': ' + n + ',').test(SRC)));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL  the harness itself threw: ' + (e && e.stack || e)); process.exit(EXPECT_BROKEN ? 0 : 1); });
