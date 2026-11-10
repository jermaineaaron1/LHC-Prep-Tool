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
  check('it says, in a line, that it is read-only and Use here sings it', /<b>Read only\.<\/b> ' \+\r?\n\s*\(r\.kind === 'member' \|\| r\.on \? 'Nothing here changes this service\.' : 'Use here to sing it this way\.'\)/.test(open));
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
    /if \(r\.kind === 'version' \|\| r\.kind === 'kept'\) \{ _sbmCloseSheet\(\); sbVerUse\(r\.vid\); return; \}/.test(copy) &&
    /if \(r\.kind === 'main'\) \{ _sbmCloseSheet\(\); sbVerUse\(''\); return; \}/.test(copy) && /if \(!song \|\| !r \|\| r\.kind === 'medley' \|\| r\.kind === 'member'\) return;/.test(copy));
  const useM = fn('sbEvUseMedley');
  check('a medley is made again through the medley editor\'s own Use, each song with its key',
    /openMedleyEditor\(song\.id\);/.test(useM) && /transposeSteps: s\.src\.steps/.test(useM) && /mdsUse\(row\.id\);/.test(useM));

  // ------------------------------------------------- 5. Where it is reached
  console.log('\n5. Where it is reached');
  check('a badge under the song\'s title, in a service\'s songbook', has(/if \(_sbmOrderBook\(\)\) badges \+= _sbEvBadge\(song\);/));
  check('...and More: one Versions entry, where Versions and Earlier versions were', has(/rows\.push\(\['fa-code-branch', 'Save \/ Load Versions', 'WO\.sbmVersions\(\)'/) &&
    !has(/'Copy an arrangement: as this service or an earlier one sang it'/) && !has(/'Versions of this song'/) && /function sbmArrangements\(\) \{ sbmVersions\(\); \}/.test(SRC));
  {
    let B = null;
    try {
      extractVar('_sbEvN'); extractFn('_sbEvBadge'); extractFn('_sbEvCount'); extractFn('_sbEvFresh');
      B = env => new Function('window', 'document', 'currentOrderData', '_sbVerSupport', '_sbVerLoad', '_sbVers', '_sbVerIsKept', '_sbBaseSongId', 'escapeHtml',
        '_sbVerSteps', '_sbmCoachDue', '_sbmCoachRecallSoon', '_sbmSong',
        extractVar('_sbEvN') + '\n' + extractFn('_sbEvBadge') + '\n' + extractFn('_sbEvCount') + '\n' + extractFn('_sbEvFresh') + '\nreturn { badge: _sbEvBadge, n: _sbEvN };')(
        env.window, env.document, env.order, () => Promise.resolve(true), () => Promise.resolve(), env.vers, v => v.made_from === 'library', s => s.songId, s => String(s),
        s => s.transposeSteps || 0, () => true, s => { env.recall.push(s.songId); }, () => env.front);
    } catch (e) { B = null; }
    if (!B) check('the badge is counted by functions of its own', false);
    else {
      const cls = {};
      const el = { hidden: true, attrs: { 'data-sbm-ev': 'song_x', 'data-ev-fresh': '1' }, getAttribute(k) { return this.attrs[k]; }, n: { textContent: '0' }, querySelector() { return this.n; },
        classList: { toggle(c, v) { cls[c] = !!v; } } };
      const env = { order: { id: 'order_now' }, vers: { song_x: [{ id: 'v1' }, { id: 'v2', made_from: 'library' }] }, recall: [], front: { songId: 'song_x' },
        document: { querySelectorAll: () => [el] },
        window: { _supabase: fakeSup({ order_items: [
          { order_id: 'order_now', source_id: 'song_x', item_type: 'song' }, { order_id: 'order_a', source_id: 'song_x', item_type: 'song' },
          { order_id: 'order_a', source_id: 'song_x', item_type: 'song' }, { order_id: 'order_b', source_id: 'song_x', item_type: 'song' },
          { order_id: 'standalone_sb1', source_id: 'song_x', item_type: 'song' }, { order_id: 'order_c', source_id: 'song_y', item_type: 'song' }] }) } };
      const b = B(env);
      const html = b.badge({ songId: 'song_x' });
      check('it waits hidden until it is counted, says Past versions, and opens Versions', /data-sbm-ev="song_x" data-ev-fresh="1" hidden/.test(html) &&
        /onclick="WO\.sbmVersions\(\)"/.test(html) && />Past versions<span class="sbm-badge__n">/.test(html));
      await flush();
      check('it counts the earlier services once each, never this one or a songbook, and the saved versions (not the kept main ones)',
        b.n.song_x.n === 3 && el.hidden === false && el.n.textContent === '3', JSON.stringify(b.n));
      check('a song new to this service that was sung before: the badge pulses, and the recall hint is asked for',
        cls['is-pulsing'] === true && env.recall.join() === 'song_x', JSON.stringify({ cls, recall: env.recall }));
      check('...only when the hint is due', /if \(n && fresh && _sbmCoachDue\('recall'\)\) _sbmCoachRecallSoon\(song\);/.test(fn('_sbEvBadge')));
      {
        let F = null;
        try { F = new Function('_sbVerSteps', extractFn('_sbEvFresh') + '\nreturn _sbEvFresh;')(s => s.transposeSteps || 0); } catch (e) { F = null; }
        const v = F ? [F({ id: 'a' }), F({ id: 'a', customLyrics: 'G\r\nWords', masterLyrics: 'G\nWords ' }), F({ id: 'a', richLyrics: '<b>x</b>' }),
          F({ id: 'a', versionId: 'v1' }), F({ id: 'a', transposeSteps: 2 }), F({ id: 'a', customLyrics: 'Other words', masterLyrics: 'Words' }), F(null)] : [];
        check('...new to the service: a copy as added, or with the main song\'s words, or only formatting; never on a version, in another key or with words of its own',
          v.join() === 'true,true,true,false,false,false,false', v.join());
      }
    }
  }
  // ------------------------------------------------- 6. One Versions sheet (2026-11-08)
  console.log('\n6. One Versions sheet: use a past version, or save this one');
  const render = fn('_sbVerRender');
  check('Versions and Earlier versions are one sheet', /function sbmArrangements\(\) \{ sbmVersions\(\); \}/.test(SRC) && !/function _sbArrRender\(/.test(SRC) &&
    /_sbVerRender\(song\);/.test(fn('sbEvBack')));
  // (2026-11-09: "Save this Version" or "Overwrite the Master Copy")
  check('This service: what it sings now, a short line that changes stay here, and two big buttons -- Save this Version, Overwrite the Master Copy',
    /<div class="vr-now__h">This service<span class="vr-now__s">Changes here stay here unless you save them<\/span>/.test(render) &&
    /onclick="WO\.sbVerSaveAsk\(\)"><i class="fa-solid fa-floppy-disk"><\/i>Save this Version<\/button>/.test(render) &&
    /onclick="WO\.sbVerMakeMain\(\)"><i class="fa-solid fa-crown"><\/i>Overwrite the Master Copy<\/button>/.test(render) && /Same as the Master Copy/.test(render));
  check('...and, when it has changed since a version was chosen, Update it', /onclick="WO\.sbVerUpdate\(\)"><i class="fa-solid fa-rotate"><\/i>Update it<\/button>/.test(render));
  check('Save this Version asks for a name once, then saves this service\'s way',
    /window\.customPrompt\('Save this Version', 'A name the team will know it by', def\)/.test(fn('sbVerSaveAsk')) && /if \(name\) _sbVerSaveNamed\(song, name\)\.catch/.test(fn('sbVerSaveAsk')));
  check('Past versions: one list, newest first; a row opens it read-only, one Use button sings it',
    /<span>Past versions<\/span><span class="ver-head__n">' \+ \(nP - 1\) \+ '<\/span><span class="vr-head__s">Newest first<\/span>/.test(render) &&
    /onclick="WO\.sbEvOpen\(' \+ i \+ '\)"/.test(render) && /class="sbm-btn sbm-btn--primary vr-row__use" onclick="event\.stopPropagation\(\);WO\.' \+ \(r\.kind === 'medley' \? 'sbEvUseMedley' : 'sbArrCopy'\) \+ '\(' \+ i \+ '\)">Use<\/button>/.test(render) &&
    /'<span class="vr-row__now">Singing now<\/span>'/.test(render));
  {
    let O = null;
    try { O = new Function(extractFn('_sbVerOrder') + '\nreturn _sbVerOrder;')(); } catch (e) { O = null; }
    const rows = O ? O([{ kind: 'version', title: 'v-old', at: '2026-09-01' }, { kind: 'earlier', title: 'svc-new', at: '2026-11-01' }, { kind: 'main', title: 'Main song', at: '' },
      { kind: 'copy', title: 'here' }, { kind: 'kept', title: 'Original', at: '2026-08-01' }, { kind: 'version', title: 'v-new', at: '2026-11-05' }]) : [];
    check('...in order: the main song, this service\'s other copies, then newest first', rows.map(r => r.title).join() === 'Main song,here,v-new,svc-new,v-old,Original', rows.map(r => r.title).join());
  }
  check('...rename, delete and making it the Master Copy again are in the read-only view, not the list',
    /onclick="WO\.sbVerRenameAsk\(/.test(fn('_sbEvSongOpen')) && /onclick="WO\.sbVerDelete\(/.test(fn('_sbEvSongOpen')) && /Make it the Master Copy again/.test(fn('_sbEvSongOpen')) &&
    !/sbVerDelete|sbVerRename/.test(render) && /function sbVerRename\(vid\) \{ sbVerRenameAsk\(vid\); \}/.test(SRC));
  check('Medleys: Save this medley, and the medleys it was sung in, each to Use',
    /onclick="WO\.sbVerSaveMedley\(\)"><i class="fa-solid fa-floppy-disk"><\/i>Save this medley<\/button>/.test(render) && /_mdsKeep\(md\.medley\.songs\)\.then/.test(fn('sbVerSaveMedley')));
  {
    let RW = null;
    try { RW = new Function('_mdsKey', extractFn('_mdsRowOf') + '\nreturn _mdsRowOf;')(ids => ids.join('>')); } catch (e) { RW = null; }
    const row = RW ? RW([{ songId: 'a', title: 'A', transposeSteps: 2, versionId: 'v9' }, { songId: 'b', title: 'B', transposeSteps: 0 }], null, { id: 'o1', name: 'Svc' }) : null;
    check('...a saved medley keeps each song\'s key and the version it sings', !!row && row.songs[0].versionId === 'v9' && row.songs[1].versionId === '' && row.songs[0].transposeSteps === 2, JSON.stringify(row && row.songs));
  }
  check('...and brings each song back on that version, then in its key',
    /if \(x\.saved\.versionId\) vers\[e\.id\] = x\.saved\.versionId;/.test(fn('mdsUse')) &&
    /if \(ed\.vers && ed\.useKeys\) _mdsApplyVersions\(ed\.vers\);\r?\n\s*if \(ed\.keys && ed\.useKeys\) _mdsApplyKeys\(ed\.keys\);/.test(fn('mdEdSave')) &&
    /_sbVerSetWords\(s, v\); s\.versionId = v\.id;/.test(fn('_mdsApplyVersions')) && /transposeSteps: s\.src\.steps, versionId: s\.src\.versionId \|\| ''/.test(fn('sbEvUseMedley')));
  console.log('\n7. The recall hints');
  check('kept once on a device: the finger on the badge, and the finger on the newest Use',
    has(/var _SBM_COACH_ONCE = \{ draw: 'lhc_sbm_draw_hint_seen_v2', recall: 'lhc_sbm_recall_hint_v1', recallPick: 'lhc_sbm_recall_pick_v1' \};/));
  check('the badge hint: a finger tapping the badge, a ring, "Sung before -- tap to use a past version"; every tap goes through',
    /_sbmCoachTapHtml\('<b>Sung before<\/b>/.test(fn('_sbmCoachRecall')) && /var B = _sbmRecallBadge\(\); if \(!B\) return false;/.test(fn('_sbmCoachRecall')) &&
    /document\.addEventListener\('pointerdown', L\.__off, true\);/.test(fn('_sbmCoachRecall')) && /fa-hand-pointer sbm-hint__finger/.test(fn('_sbmCoachTapHtml')));
  check('...asked again for a while when something else is on the screen', /if \(\+\+tries < 15\) _sbmRecallT = setTimeout\(go, 1500\);/.test(fn('_sbmCoachRecallSoon')) &&
    /if \(!_sbmCoachDue\('recall'\) \|\| _sbmSong\(\) !== song \|\| !_sbEvFresh\(song\)\) return;/.test(fn('_sbmCoachRecallSoon')));
  check('the sheet\'s hint: a finger on the newest past version\'s Use, "Newest first. Tap Use to sing it that way"',
    /sh\.querySelector\('\.vr-row:not\(\.vr-row--main\):not\(\.is-on\) \.vr-row__use'\)/.test(fn('_sbmCoachRecallPick')) && /Newest first\.<\/b> Tap Use to sing it that way/.test(fn('_sbmCoachRecallPick')) &&
    /if \(nP > 1\) setTimeout\(function\(\) \{ _sbmCoachRecallPick\(false\); \}, 350\);/.test(render));
  check('Show the tips again plays the badge hint too', /_sbmCoachDraw\(true\); _sbmReplayRecall\(\); return;/.test(SRC) && /setTimeout\(function\(\) \{ _sbmCoachRecall\(true\); \}, 350\);/.test(fn('_sbmReplayRecall')));
  check('the badge pulses (a ring that breathes) while the song is new to this service', has(/\.sbm-badge--ev\.is-pulsing \{ animation: sbmEvPulse 1\.6s ease-in-out infinite; \}/));
  check('...with the drawings on each one\'s version and the recordings made for each service counted',
    /var drawN = function\(vid\) \{ return _sbmMarksOk === true \? _sbmMarksOf\(base, vid \|\| ''\)\.length : 0; \};/.test(render) &&
    /recs\.filter\(function\(x\) \{ return String\(x\.order_id \|\| ''\) === String\(orderId\); \}\)\.length/.test(render));
  check('every new handler is reachable from the page', ['sbEvOpen', 'sbEvOpenMember', 'sbEvBack', 'sbEvUseMedley', 'sbEvPlay', 'sbVerSaveAsk', 'sbVerRenameAsk', 'sbVerSaveMedley'].every(n => new RegExp(n + ': ' + n + ',').test(SRC)));

  // ------------------------------------- 8. Save / Load Versions (2026-11-09)
  console.log('\n8. Save / Load Versions: a purple tile, and a name saved twice replaces');
  {
    const rnd = fn('_sbmRender');
    check('a purple Save / Load Versions tile between Edit and More, wherever More offers Versions',
      /var vTile = \(_sbmOrderBook\(\) \|\| _sbVerOk === true\)/.test(rnd) &&
      /'<button class="sbm-tile sbm-tile--ver" onclick="WO\.sbmVersions\(\)"[^>]*><i class="fa-solid fa-code-branch"><\/i>Save \/ Load Versions<\/button>'/.test(rnd) &&
      /onclick="WO\.sbmEdit\(\)">[^\n]*\r?\n\s*vTile \+\r?\n\s*'<button class="sbm-tile sbm-tile--more"/.test(rnd) &&
      /sbm-tile-row--' \+ \(vTile \? '8' : '7'\) \+ '">'/.test(rnd));
    check('...purple, eight to a row, its label free to wrap',
      has(/\.sbm-tile--ver \{ color: #fff; background: linear-gradient\(160deg, #8b5cf6, #6d28d9\);/) && has(/\.sbm-tile-row--8 \{ grid-template-columns: repeat\(8, minmax\(0, 1fr\)\); \}/) &&
      has(/#sbmRoot:not\(\.sbm--wide\) :is\(\.sbm-tile-row--7, \.sbm-tile-row--8\) \.sbm-tile \{/));
    check('the read-only preview is 10px wider than a sheet (470 against 460)',
      has(/@media \(min-width: 821px\) \{ #sbmSheet\[data-sheet="earlier-open"\] \.sbm-sheet \{ width: min\(470px, 92vw\); \} \}/) && has(/width: min\(460px, 92vw\);/));

    let S = null;
    try { S = new Function('_sbVerIsKept', extractFn('_sbVerNameKey') + '\n' + extractFn('_sbVerSameName') + '\nreturn _sbVerSameName;')(v => v.made_from === 'library'); } catch (e) { S = null; }
    const list = [{ id: 'a', name: 'Service - Nov 8', created_at: '2026-11-08T16:46:05Z' }, { id: 'b', name: 'service -  nov 8 ', created_at: '2026-11-08T16:57:02Z' },
      { id: 'k', name: 'Service - Nov 8', made_from: 'library', created_at: '2026-11-09T00:00:00Z' }, { id: 'c', name: 'Youth Sunday', created_at: '2026-10-01T00:00:00Z' }];
    const got = S ? [S(list, 'SERVICE - NOV 8', ''), S(list, 'Service - Nov 8', 'a'), S(list, 'Easter', ''), S(list, '  ', ''), S(null, 'x', '')].map(v => v ? v.id : '-').join() : '';
    check('a name is the same name whatever its case and spacing; an earlier main song never counts; the one this copy sings first, else the newest',
      got === 'b,a,-,-,-', got);

    let N = null, calls = [];
    const mk = env => new Function('_sbBaseSongId', '_sbVerOk', '_sbVers', '_sbVerUse', 'currentOrderData', '_sbVerLoad', '_sbVerSaveAs', '_sbVerWarnToast', '_sbVerReplace', '_sbVerIsKept',
      extractFn('_sbVerNameKey') + '\n' + extractFn('_sbVerSameName') + '\n' + extractFn('_sbVerSaveNamed') + '\nreturn _sbVerSaveNamed;')(
      s => s.songId, true, env.vers, env.use, { id: 'o_now' }, () => Promise.resolve(), (s, n) => { calls.push('new:' + n); return Promise.resolve({ id: 'new' }); },
      o => { calls.push('ask:' + o.title + '|' + o.msg + '|' + o.ok); return Promise.resolve(env.answer); }, (s, x) => { calls.push('replace:' + x.id); return Promise.resolve(x); }, v => v.made_from === 'library');
    try { N = mk; extractFn('_sbVerSaveNamed'); } catch (e) { N = null; }
    if (N) {
      const env = { vers: { s1: list.slice(0, 2) }, use: { s1: { b: ['o_now', 'o_old', 'o_old2'] } }, answer: false };
      const song = { songId: 's1', versionId: '' };
      calls = []; await N(env)(song, 'Fresh name');
      const fresh = calls.join(' / ');
      calls = []; const r1 = await N(env)(song, 'Service - Nov 8');
      const cancelled = calls.join(' / ');
      env.answer = true; calls = []; await N(env)(song, 'Service - Nov 8');
      const replaced = calls.join(' / ');
      check('a new name is saved as a new version, asked nothing', fresh === 'new:Fresh name', fresh);
      check('a name already saved asks first, in a few words, saying how many other services sing it', /^ask:.service - {2}nov 8 . is already saved\|Replace it with this service.s key, words and drawings\? 2 other services sing it and will see the new drawings\.\|Replace$/.test(cancelled), cancelled);
      check('...Cancel writes nothing', r1 === null && !/new:|replace:/.test(cancelled));
      check('...Replace writes over that version, never a second one', /\/ replace:b$/.test(replaced) && !/new:/.test(replaced), replaced);
    } else check('_sbVerSaveNamed exists', false);
    check('both ways to save go through it, after reading the versions again', /if \(name\) _sbVerSaveNamed\(song, name\)\.catch/.test(fn('sbVerSaveAsk')) &&
      /_sbVerSaveNamed\(song, name\)\.then\(/.test(fn('sbVerCreate')) && /return _sbVerLoad\(base\)\.then\(check, check\);/.test(fn('_sbVerSaveNamed')));

    // _sbVerReplace against a stand-in database.
    const fakeSup = log => {
      const q = (t, op, arg) => {
        const st = { t, op, arg, filters: [] };
        const p = {
          eq(k, v) { st.filters.push(k + '=' + v); return p; }, in(k, v) { st.filters.push(k + ' in ' + v.join(',')); return p; },
          select() { st.select = true; return p; },
          then(f, g) {
            log.push(st.t + '.' + st.op + (st.filters.length ? '[' + st.filters.join(';') + ']' : ''));
            let data = [];
            if (st.op === 'update') data = [Object.assign({ id: 'x1', name: 'Service - Nov 8' }, st.arg)];
            if (st.op === 'insert') data = st.arg.map((m, i) => Object.assign({ id: 'n' + i }, m));
            return Promise.resolve({ data, error: null }).then(f, g);
          }
        };
        return p;
      };
      return { from(t) { return { update(a) { return q(t, 'update', a); }, insert(a) { return q(t, 'insert', a); }, delete() { return q(t, 'delete'); } }; } };
    };
    const RP = (env) => new Function('window', 'currentOrderData', '_sbBaseSongId', '_sbVerWordsOf', '_sbVerSteps', '_sbVerMarks', '_sbmMarks', '_sbmLayersOk', '_sbVerSaved', '_sbVerReshow', 'showToast',
      extractFn('_sbVerReplace') + '\nreturn _sbVerReplace;')(
      { _supabase: fakeSup(env.log) }, { id: 'o_now' }, s => s.songId, () => ({ lyrics: 'G\nWords', rich: null }), s => s.transposeSteps || 0,
      (ms, v) => (ms || []).filter(m => (m.version_id || '') === (v || '')), env.marks, true, () => env.log.push('saved'), () => {}, (m, k) => env.log.push('toast:' + k + ':' + m));
    {
      let ok = true, e1 = null, e2 = null;
      try {
        e1 = { log: [], marks: { s1: [{ id: 'm1', version_id: '', anchor: 'l:1', points: [] }, { id: 'm2', version_id: '', anchor: 'l:2', points: [] }, { id: 'old1', version_id: 'x1', anchor: 'l:3', points: [] }] } };
        const song = { songId: 's1', versionId: '', transposeSteps: 3 };
        const x = { id: 'x1', name: 'Service - Nov 8' };
        await RP(e1)(song, x);
        check('replacing from another version: the row written over (same id), the drawings shown now copied onto it, then its old ones taken off',
          e1.log.slice(0, 3).join(' / ') === 'song_versions.update[id=x1] / song_marks.insert / song_marks.delete[id in old1]' && song.versionId === 'x1' && x.transpose_steps === 3 &&
          e1.marks.s1.filter(m => m.version_id === 'x1').map(m => m.id).join() === 'n0,n1' && e1.log.indexOf('saved') > -1, e1.log.join(' / '));
        e2 = { log: [], marks: { s1: [{ id: 'k1', version_id: 'x1', anchor: 'l:1', points: [] }] } };
        const song2 = { songId: 's1', versionId: 'x1', transposeSteps: 1 };
        await RP(e2)(song2, { id: 'x1', name: 'Service - Nov 8' });
        check('replacing the version this copy sings: only its key and words are written; its drawings are its own already',
          e2.log.filter(l => /^song_/.test(l)).join(' / ') === 'song_versions.update[id=x1]' && e2.marks.s1.length === 1 && /toast:success:Replaced/.test(e2.log.join('|')), e2.log.join(' / '));
      } catch (e) { ok = false; check('_sbVerReplace runs', false, e.message); }
    }
    const toast = fn('_sbVerWarnToast');
    check('the warning is a toast: amber, from the foot of the screen, over the sheet; Cancel or Replace, Esc cancels, Cancel has the focus',
      /el\.id = 'sbVerWarn'; el\.className = 'sbm sbm-vwarn';/.test(toast) && /fa-triangle-exclamation/.test(toast) && /data-vwarn="0">Cancel<\/button>/.test(toast) &&
      /if \(e\.key === 'Escape'\) \{ e\.stopPropagation\(\); e\.preventDefault\(\); done\(false\); \}/.test(toast) && /var c = el\.querySelector\('\[data-vwarn="0"\]'\); if \(c\) c\.focus\(\);/.test(toast) &&
      has(/\.sbm-vwarn \{\r?\n\s*position: fixed; left: 50%; bottom: calc\(18px \+ env\(safe-area-inset-bottom, 0px\)\); z-index: 10003;/) && has(/border-left: 6px solid #f59e0b;/));
    check('...and goes, unanswered, with the book', /var vw = document\.getElementById\('sbVerWarn'\); if \(vw && vw\.__done\) vw\.__done\(false\);/.test(fn('closeSongbook')));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL  the harness itself threw: ' + (e && e.stack || e)); process.exit(EXPECT_BROKEN ? 0 : 1); });
