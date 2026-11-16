'use strict';
// Harness for one service's page in the Liturgy Library (2026-11-14).
//
// From the operator, with four drawings of a service page: the files the LCD
// uses are kept apart from the documents (Word, PDF, Excel liturgies, pictures,
// videos); the liturgies people wrote in their own documents are what others
// read to see what was done before; and such a document can be made the base
// of a later year's liturgy, converted for the Liturgy Builder and the LCD.
// Asked, they chose the order-of-worship drawings, .docx read as written and
// AI for the rest, and a converted liturgy kept as a ready liturgy.
//
//   1. Which files are which: LCD materials, liturgy documents, other files.
//   2. The next service of the kind, from the roster.
//   3. A Word liturgy read as written: bold headings (the church's documents
//      use no Heading styles), the people's bold lines left as words, the
//      title lines, who leads, songs and readings, slides.
//   4. Its sections matched to the Builder's, and a ready liturgy made of it
//      in the shape the Builder's Load reads.
//   5. The page: wiring, the save, the Load opened on the liturgy chosen.
//   6. The server: an old .doc's words, and the guard before any fetch.
//
// USAGE
//   node tools/liturgy-service-page-harness.js
//   node tools/liturgy-service-page-harness.js <Index.html> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
const ROUTE = path.join(__dirname, '..', 'app', 'api', 'parse-liturgy', 'route.ts');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8');
const RSRC = fs.existsSync(ROUTE) ? fs.readFileSync(ROUTE, 'utf8') : '';

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
const fn = n => { try { return extractFrom(SRC, new RegExp('^  function ' + n + '\\s*\\(')); } catch (e) { return ''; } };
const line = re => { const m = SRC.match(re); return m ? m[0] : ''; };

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

// The Liturgy page's pure pieces, run.
const CONSTS = [line(/  var SP_DOC_EXT = [^\n]*;/), line(/  var SP_DECK_EXT = [^\n]*;/), line(/  var SP_LIT_WORDS = [^\n]*;/),
  line(/  var CV_SPEAKER = [^\n]*;/), line(/  var CV_SONG = [^\n]*;/), line(/  var CV_READING = [^\n]*;/), line(/  var CV_BOOKS = [^\n]*;/)].join('\n');
const SAME = (SRC.match(/  var CV_SAME = \{[\s\S]*?\n  \};/) || [''])[0];
let L = null;
try {
  const names = ['_spKind', '_spNextFor', '_spSlidesOf', '_cvFromParas', '_cvSectionOf', '_cvSlides', '_cvMatch', '_cvSongId', '_cvBook', '_cvRefOf'];
  const bodies = names.map(fn);
  if (bodies.every(Boolean) && SAME && CONSTS.split('\n').every(Boolean)) {
    L = new Function('_lfYearName', CONSTS + '\n' + SAME + '\n' + bodies.join('\n') +
      '\nreturn { kind: _spKind, next: _spNextFor, slidesOf: _spSlidesOf, paras: _cvFromParas, slides: _cvSlides, match: _cvMatch, song: _cvSongId };')(() => '');
  }
} catch (e) { L = null; console.log('  (could not build the page functions: ' + e.message + ')'); }
// The order editor's: the type's sections, a document made into a liturgy, titles compared.
let W = null;
try {
  const bodies = ['_woStripNum', '_woTypeSections', '_woDocLiturgy', '_lbdNormTitle'].map(fn);
  if (bodies.every(Boolean)) {
    const orderStructures = { traditional: [
      { title: '1. Invocation', serviceSectionId: 'welcome' }, { title: '2. Confession', serviceSectionId: 'opening-prayer' },
      { title: '3. Absolution' }, { title: '4. Entrance Hymn', serviceSectionId: 'preparation' }, { title: '5. Kyrie' },
      { title: '6. Prayer of the Day', serviceSectionId: 'opening-prayer' }, { title: '7. Scripture Readings', serviceSectionId: 'scripture' },
      { title: '8. Hymn of Preparation', serviceSectionId: 'song-of-preparation' }, { title: '9. Sermon', serviceSectionId: 'message' },
      { title: '10. Benediction', serviceSectionId: 'benediction' } ] };
    W = new Function('orderStructures', bodies.join('\n') + '\nreturn { tpl: _woTypeSections, doc: _woDocLiturgy, norm: _lbdNormTitle };')(orderStructures);
  }
} catch (e) { W = null; }

(async () => {
  // ------------------------------------------------------------ 1. kinds
  console.log('\n1. Which files are which');
  check('the page\'s functions are on the page', !!L);
  if (L) {
    const k = it => L.kind(it);
    const cases = [
      [{ title: 'Invocation', content: 'L: In the Name...' }, 'lcd', 'a liturgy text'],
      [{ title: 'Baptism Liturgy Slides', fileUrl: 'https://x/Baptism.pptx', fileName: 'Baptism.pptx' }, 'lcd', 'a slide deck'],
      [{ title: 'LHC Liturgy - Good Friday 2024', fileUrl: 'https://x/a.docx', fileName: 'a.docx' }, 'liturgy', 'a Word file called a liturgy'],
      [{ title: 'Ash Wednesday 2026 Service', fileUrl: 'https://x/b.docx', fileName: 'b.docx', type: 'documents' }, 'liturgy', 'a Word file called a service'],
      [{ title: 'Holden Evening Prayer', fileUrl: 'https://x/h.pdf', fileName: 'h.pdf', type: 'liturgy' }, 'liturgy', 'a PDF filed as liturgy'],
      [{ title: 'Abide With Me SATB GF 2024', fileUrl: 'https://x/s.pdf', fileName: 's.pdf', type: 'documents' }, 'files', 'a score'],
      [{ title: 'Pentecost Reading 2024 final', fileUrl: 'https://x/r.docx', fileName: 'r.docx', type: 'documents' }, 'files', 'a reading'],
      [{ title: 'Altar photo', fileUrl: 'https://x/p.jpg', fileName: 'p.jpg' }, 'files', 'a picture'],
      [{ title: 'Prelude', fileUrl: 'https://x/v.mp4', fileName: 'v.mp4' }, 'files', 'a video'],
      [{ title: 'Easter Communion Liturgy 2025', fileUrl: 'https://x/e.docx', fileName: 'e.docx', tags: ['not-liturgy'] }, 'files', 'one somebody said is not a liturgy'],
      [{ title: 'Band notes', fileUrl: 'https://x/n.docx', fileName: 'n.docx', tags: ['liturgy-doc'] }, 'liturgy', 'one somebody said is'],
      [{ title: 'GOOD FRIDAY LITURGY 2026', fileUrl: 'https://docs.google.com/document/d/abc/edit' }, 'liturgy', 'a Google Doc liturgy'],
      [{ title: 'Order of songs', fileUrl: 'https://open.spotify.com/x' }, 'files', 'a link']
    ];
    const bad = cases.filter(c => k(c[0]) !== c[1]);
    check('text and decks are the LCD\'s; liturgies in documents apart; pictures, videos, scores and links are other files',
      bad.length === 0, bad.map(c => c[2] + ' -> ' + k(c[0])).join('; '));
    check('a liturgy text\'s slides are kept apart (the library keeps them as one string)',
      JSON.stringify(L.slidesOf('L: one\n══════\nC: two\n══════\n\n')) === JSON.stringify(['L: one', 'C: two']));
  }

  // ------------------------------------------------------------ 2. next
  console.log('\n2. The next service of the kind');
  if (L) {
    const meta = { '2026-11-08': { day: '24th Sunday after Pentecost', serviceType: 'Contemporary' },
      '2026-11-15': { day: '25th Sunday after Pentecost', serviceType: 'Traditional', color: 'Green' },
      '2026-11-22': { day: 'Christ the King', serviceType: 'Contemporary' }, '2026-12-24|pm': { day: 'Christmas Eve' }, '2026-12-27': { serviceType: 'Contemporary' } };
    const occFor = (day, type) => /christmas eve/i.test(day) ? 'christmas-eve' : (type === 'contemporary' ? 'ordinary-contemporary' : 'ordinary-traditional');
    const n = (occ) => { const x = L.next(occ, meta, '2026-11-14', occFor); return x ? x.key + ':' + x.type : ''; };
    check('Traditional: the first traditional Sunday from today', n('ordinary-traditional') === '2026-11-15:traditional', n('ordinary-traditional'));
    check('Contemporary: by the roster\'s service type, never one already past', n('ordinary-contemporary') === '2026-11-22:contemporary', n('ordinary-contemporary'));
    check('a feast: its own day, an evening one included', n('christmas-eve') === '2026-12-24|pm:traditional', n('christmas-eve'));
    check('a kind the roster has no date for: none', n('good-friday') === '' && L.next('x', meta, '2026-11-14', null) === null);
  }

  // ------------------------------------------------------------ 3. word
  console.log('\n3. A Word liturgy, read as written');
  if (L) {
    // As the 2024 Good Friday document is: no Heading styles, headings bold,
    // the people's lines bold too.
    const P = (text, b) => ({ text: text, h: 0, b: !!b });
    const paras = [P('2024 Good Friday Service', 1), P(''),
      P('Welcome and Opening Prayer (Pastor Benedict)', 1), P('Introduce liturgy structure (reflections and songs)'), P(''),
      P('Confession (Pastor Justin)', 1), P('P: If we say we have no sin, we deceive ourselves.'), P('C: Amen', 1),
      P('P: Almighty God, have mercy.'), P(''), P('C: And also with you.', 1),
      P('First Reading and Reflection (Pastor Kathrin)', 1), P('John 18:1-14'),
      P('Song 1: When I Survey the Wondrous Cross (Hymn 217)', 1),
      P('Hymn: Abide With Me', 1),
      P('Forgive us for not opening our eyes.', 1),
      P('3. Prayer of the Day', 1), P('L: Almighty God...'), P('C: Amen.', 1)];
    const r = L.paras(paras);
    const t = r.sections.map(s => s.title + (s.leader ? ' (' + s.leader + ')' : '') + ':' + s.parts.map(p => p.kind + '=' + p.title + '/' + p.slides.length).join(','));
    check('the title line is the document\'s title, not a section', r.title === '2024 Good Friday Service' && r.sections[0].title === 'Welcome and Opening Prayer', JSON.stringify(r.title));
    check('who leads comes out of the heading', r.sections[0].leader === 'Pastor Benedict' && r.sections[1].leader === 'Pastor Justin');
    check('the people\'s bold lines ("C: Amen") are words, not headings', r.sections[1].parts[0].slides.join('\n').indexOf('C: Amen') !== -1 &&
      r.sections[1].parts[0].slides.join('\n').indexOf('C: And also with you.') !== -1, t.join(' | '));
    check('a bold sentence the people say is not a heading either', !r.sections.some(s => /Forgive us/.test(s.title)), t.join(' | '));
    check('a reading is a reading, with its reference', r.sections[2].parts[0].kind === 'reading' && r.sections[2].title === 'First Reading and Reflection', t[2]);
    check('a song is a song, by its title, the hymn number left off',
      r.sections[3].parts[0].kind === 'song' && r.sections[3].parts[0].title === 'When I Survey the Wondrous Cross' &&
      r.sections[4].parts[0].title === 'Abide With Me', t[3] + ' | ' + t[4]);
    check('a numbered heading loses its number', r.sections.some(s => s.title === 'Prayer of the Day'));
    // As the Advent documents are: Heading styles used, so only they count.
    const styled = L.paras([{ text: 'Gather', h: 1 }, { text: 'Forgive us', h: 0, b: true }, { text: 'Prepare us', h: 0, b: true }, { text: 'Word', h: 2 }, { text: 'L: Hear', h: 0 }]);
    check('a document with Heading styles is read by them alone', styled.sections.map(s => s.title).join('|') === 'Gather|Word', styled.sections.map(s => s.title).join('|'));
    check('slides: a new one at each blank line', JSON.stringify(L.slides(['L: a', 'C: b', '', 'L: c'])) === JSON.stringify(['L: a\nC: b', 'L: c']));
    const long = L.slides(['1', '2', '3', '4', '5', '6', '7', '8']);
    check('...and no more than six lines on one', long.length === 2 && long[0].split('\n').length === 6, JSON.stringify(long));
  }

  // ------------------------------------------------------------ 4. ready
  console.log('\n4. Matched to the Builder\'s sections, and made a ready liturgy');
  check('the order editor\'s pieces are on the page', !!W);
  if (L && W) {
    const tpl = W.tpl('traditional'), used = {};
    const m = (t) => { const id = L.match(t, tpl, used, W.norm); if (id) used[id] = true; return id; };
    check('the same name, a name the church uses for it, one that names it',
      m('Confession') === 'wo-section-1' && m('Collect of the Day') === 'wo-section-5' && m('The Sermon') === 'wo-section-8' && m('Blessing') === 'wo-section-9',
      [m('Kyrie Eleison')].join());
    check('every reading goes to the Scripture Readings section, however many', m('First Reading and Reflection') === 'wo-section-6' && m('Second Reading') === 'wo-section-6');
    check('a section used once is not matched twice; one with no match is its own', m('Confession') === '' && m('Welcome and Opening Prayer') === '');
    check('a song is found in the library by its title, punctuation and "(Hymn 217)" aside',
      L.song('When I Survey the Wondrous Cross (Hymn 217)', [{ id: 's1', title: 'When I survey the wondrous cross' }]) === 's1' && L.song('Unknown', [{ id: 's1', title: 'x' }]) === '');
    const d = W.doc([
      { title: 'Welcome', target: '', parts: [{ kind: 'liturgy', title: 'Welcome', slides: ['L: Welcome', ' ', 'C: Amen'] }] },
      { title: 'Confession', target: 'wo-section-1', parts: [{ kind: 'liturgy', title: 'Confession', slides: ['P: If we say...'] }] },
      // A reading the document printed in full: still the roster's to give.
      { title: 'First Reading', target: 'wo-section-6', parts: [{ kind: 'reading', title: 'John 18', slides: ['When Jesus had spoken these words'] }] },
      { title: 'Second Reading', target: 'wo-section-6', parts: [{ kind: 'reading', title: 'John 19', slides: [] }] },
      { title: 'Hymn', target: '', parts: [{ kind: 'song', title: 'Abide', songId: 'song_1', slides: [] }, { kind: 'song', title: 'Unknown', songId: '', slides: [] }] }
    ], 'traditional');
    check('the document\'s sections in its order, under its own headings',
      d.sectionLayout.map(s => s.id + '=' + s.title).join('|') === 'wo-section-doc0=Welcome|wo-section-1=Confession|wo-section-6=First Reading|wo-section-doc3=Second Reading|wo-section-doc4=Hymn',
      d.sectionLayout.map(s => s.id + '=' + s.title).join('|'));
    check('a matched section keeps the Builder\'s kind, which places the roster\'s readings',
      d.sectionLayout[2].serviceSectionId === 'scripture' && d.sectionLayout[1].serviceSectionId === 'opening-prayer' && d.sectionLayout[0].serviceSectionId === '');
    check('liturgy as slides; readings left for the roster; a song only when it is in the library',
      d.items.length === 2 && d.items[0].itemType === 'liturgy' && d.items[0].slides.length === 2 && d.items[0].slides[1].content === 'C: Amen' &&
      d.songs.length === 1 && d.songs[0].songId === 'song_1' && d.songs[0].sections[0] === 'wo-section-doc4', JSON.stringify(d.items.map(i => i.slides.length)));
    check('the shape a saved liturgy has (what the Builder\'s Load reads)', d.v === 1 && Array.isArray(d.clearedSections) && d.serviceNotes === '' &&
      d.items.every(i => i.sectionId && i.id && i.content && i.customizations && i.slides.every(s => 'index' in s && 'background' in s)));
  }

  // ------------------------------------------------------------ 5. page
  console.log('\n5. The page');
  check('a service\'s page is one of the library\'s panels', /<div id="liturgyServicePanel" class="ll-panel" style="display:none;"><\/div>/.test(SRC) &&
    /var LL_PANELS = \[[^\]]*'liturgyServicePanel'\];/.test(SRC) && /_llShowOnly\('liturgyServicePanel'\);/.test(fn('openService')));
  check('a Services card opens it', /onclick="LiturgyModule\.openService\(this\.dataset\.id\)">' \+\s*\r?\n\s*_llArt\(o, 'ls-card__art'\)/.test(SRC));
  // Planning lives on the page itself now (2026-11-14); the old planning
  // panel is opened only for a service's preparation guide, and comes back.
  check('the preparation guide, opened from the page, comes back to it', /if \(_spBack && _spBack === occ\) \{ _spBack = ''; openService\(occ\); return; \}/.test(fn('backToLibrary')) &&
    /_spBack = occ;/.test(fn('spGuide')) && /switchOccasionTab\('prepare'\);/.test(fn('spGuide')));
  const ren = fn('renderService');
  // From the operator (2026-11-15): "This page is to help users access the
  // library of liturgies, not designing one." The Liturgy Order tab is the
  // service's library: its documents by year first, then this year's liturgy,
  // the ready ones and the tiles. The order of worship and its reader went.
  const ot = fn('_spOrderTab');
  check('the Liturgy Order tab is the service\'s library, its documents first; no order of worship, no reader',
    /'<div class="sp-lib"><div class="sp-lib__main">' \+ _spResHtml\(occ\) \+ '<\/div>'/.test(ot) &&
    /_spMakeHtml\(d, orderId\) \+ _spReadyHtml\(d, orderId\) \+ tiles/.test(ot) &&
    !fn('_spParts') && !fn('_spSource') && !fn('spFull') && !/pl-ow|pl-text|_spTexts/.test(ot) && !/contenteditable/.test(ren));
  check('this year\'s liturgy is a way into the Liturgy Builder', /onclick="LiturgyModule\.spEdit\(\)"/.test(fn('_spMakeHtml')) && /_llOpenInBuilder\(id\)/.test(fn('spEdit')));
  // "Double clicking or tapping on the document will preview it."
  try {
    const opened = [];
    let T = 1000;
    const B = new Function('lfOpen', 'spPreviewReady', 'Date', fn('_spRowAt') + '\n' + fn('_spOpenRow') + '\nvar _spTap = null;\n' + fn('_spBindOpen') + '\nreturn { bind: _spBindOpen };')(
      id => opened.push('item:' + id), id => opened.push('svl:' + id), { now: () => T });
    const on = {};
    const panel = { addEventListener: (k, f) => { on[k] = f; } };
    B.bind(panel); B.bind(panel);
    const mkRow = (kind, id) => ({ getAttribute: k => ({ 'data-open': kind, 'data-id': id })[k], contains: () => true, matches: sel => sel === '[data-open]' });
    const doc = mkRow('item', 'd1'), ready = mkRow('svl', 'r1');
    const inside = row => ({ closest: sel => sel === '[data-open]' ? row : null });
    const btn = { tag: 'button' };
    const onBtn = row => ({ closest: sel => sel === '[data-open]' ? row : btn });
    const tap = (target, x, dt) => { T += dt; on.pointerup({ pointerType: 'touch', target, clientX: x, clientY: 40 }); };
    on.dblclick({ target: inside(doc), preventDefault() {} });
    const a = opened.join();
    tap(inside(doc), 100, 1000); const one = opened.length; tap(inside(doc), 104, 200); const two = opened.length;
    tap(inside(doc), 100, 1000); tap(inside(doc), 100, 600); const slow = opened.length;
    tap(inside(doc), 100, 1000); tap(inside(doc), 180, 100); const far = opened.length;
    tap(inside(doc), 100, 1000); tap(inside(ready), 100, 100); const other = opened.length;
    on.dblclick({ target: onBtn(doc), preventDefault() {} });
    tap(onBtn(doc), 100, 1000); tap(onBtn(doc), 100, 100); const ctl = opened.length;
    on.pointerup({ pointerType: 'mouse', target: inside(doc), clientX: 1, clientY: 1 }); on.pointerup({ pointerType: 'mouse', target: inside(doc), clientX: 1, clientY: 1 });
    const mouse = opened.length;
    on.dblclick({ target: inside(ready), preventDefault() {} });
    on.keydown({ key: 'Enter', target: doc, preventDefault() {} });
    check('a document opens on a double-click, a double tap (two taps within 350ms and 32px on one row) or Enter; bound once',
      a === 'item:d1' && one === 1 && two === 2 && slow === 2 && far === 2 && other === 2 && mouse === 2 &&
      opened.slice(2).join() === 'svl:r1,item:d1', opened.join() + ' ' + [one, two, slow, far, other, ctl, mouse].join());
    check('...never from a tap on one of its buttons (Make ready, the eye, Share)', ctl === 2);
  } catch (e) { check('a document opens on a double-click or a double tap', false, e.message); }
  check('the rows say so, and are not zoomed or selected by the second tap',
    /data-open="item" data-id="/.test(fn('_spResHtml')) && /Double-tap ' \+ \(tab === 'links' \? 'a link' : 'a document'\) \+ ' to preview it\. ' \+/.test(fn('_spResHtml')) &&
    /\.sp-doc\[data-open\], \.sp-ready__row\[data-open\] \{ cursor: pointer; touch-action: manipulation; -webkit-user-select: none; user-select: none; \}/.test(SRC) &&
    /_spBindOpen\(p\);/.test(ren));
  check('the click that follows a double tap does not close the preview it opened',
    /if \(e\.target === el && Date\.now\(\) - openedAt > 450\) lfCloseViewer\(\);/.test(fn('lfOpen')));
  try {
    const R = { _lfSvlRows: {}, _occSvlData: {}, opened: [] };
    const prev = new Function('_spData', '_sp', '_lfSvlRows', '_occSvlData', 'lfOpen', fn('spPreviewReady') + '\nreturn spPreviewReady;')(
      { rows: [{ id: 'r9', occasion_id: 'good-friday', title: 'Good Friday 2025', data: { v: 1 } }] }, { occ: 'good-friday' }, R._lfSvlRows, R._occSvlData,
      (id, svl) => R.opened.push(id + (svl ? ':svl' : '')));
    prev('r9'); prev('r9');
    check('a ready liturgy previews in the library\'s window, its row put where that window reads', R.opened.join() === 'r9:svl,r9:svl' &&
      R._lfSvlRows['good-friday'].length === 1 && R._occSvlData.r9 && R._occSvlData.r9.v === 1);
  } catch (e) { check('a ready liturgy previews in the library\'s window', false, e.message); }
  // Black, where the new page drew white on nothing: --sp-maroon was the old
  // page's colour and is not defined on .pl (the operator, 2026-11-15).
  check('the active files tab, the year chip and Make ready read in black on the new page',
    /\.pl \.sp-rtab\.is-on, \.pl \.sp-year\.is-on \{ background: #e6f0e8; border-color: var\(--pl-green\); color: #111; \}/.test(SRC) &&
    /\.pl \.lf-btn\.sp-btn-maroon, \.pl \.lf-btn--primary\.sp-btn-maroon \{ background: #e9b949; border-color: #d4a53a; color: #111; \}/.test(SRC));
  check('the page\'s colours reach what it puts on <body>: its dialogs\' green buttons (Save note, New song) and Add Item\'s menu',
    /  \.pl, \.pl-ed, \.pl-menu--float(, [^{]+)? \{ --pl-green: #1f4d36;/.test(SRC) && /el\.id = 'plEd'; el\.className = 'mv-ed pl-ed';/.test(fn('_plModal')));
  const am = fn('spAddMenu');
  check('Add Item\'s menu is put on <body> under its button, follows it while the page moves, and closes on Escape, a tap away, or the button leaving the screen',
    /document\.body\.appendChild\(m\);/.test(am) && /m\.className = 'pl-menu pl-menu--float'/.test(am) && /\.pl-menu--float \{ position: fixed; right: auto; z-index: 10010;/.test(SRC) &&
    /if \(e\.key === 'Escape'\)/.test(am) && /window\.addEventListener\('scroll', place, true\);/.test(am) && /window\.addEventListener\('resize', place\);/.test(am) &&
    /if \(r\.bottom < 0 \|\| r\.top > vh\) \{ _spAddMenuClose\(\); return; \}/.test(am));
  // "Remove this way of uploading documents": the "Add to <service>" window
  // (paste a link / upload a file / copy to the General Library) is not opened
  // from a service's page; every Upload there goes straight to the picker.
  check('every upload on a service\'s page goes straight to the file picker, never the old Add window',
    !/lfUpload\(/.test(fn('_spResHtml') + fn('_plSideFiles') + fn('spAddMenu')) && !/lfUpload/.test(SRC.slice(SRC.indexOf('var SP_ADD_ITEMS'), SRC.indexOf('function spAddMenu'))) &&
    /LiturgyModule\.spUpload\(\\'liturgy\\'\)/.test(SRC) && /f\.accept = _spUpMode \? '\.docx,\.doc,\.pdf,\.xlsx,\.xls' : '';/.test(fn('spUpload')) && /f\.click\(\);/.test(fn('spUpload')) &&
    /<input id="spDocFile" type="file" multiple hidden onchange="LiturgyModule\.spUploadDoc\(this\)">/.test(ren));
  check('the green + uploads into the service whose page is open, and opens the library\'s Add window anywhere else',
    /<button id="litAddFAB" class="lit-add-fab" onclick="LiturgyModule\.fabAdd\(\)"/.test(SRC) &&
    /if \(p && p\.style\.display !== 'none' && _sp\.occ\) \{ spUpload\(''\); return; \}/.test(fn('fabAdd')) && /openQuickAddModal\(null, null\);/.test(fn('fabAdd')));
  const use = fn('spUse');
  check('Use opens the chosen service in the Builder with its Load on that liturgy', /_llOpenInBuilder\(row\.order\.id, then\)/.test(fn('spUseGo')) &&
    /WO\.lbdServiceLiturgies\(occ, 'all', 's:' \+ id\)/.test(fn('spUseGo')) && /_svlOpen = openKey \|\| '';/.test(fn('lbdServiceLiturgies')));
  check('the Builder opens, then does what it was asked', /if \(typeof then === 'function'\) setTimeout\(then, 700\);/.test(fn('_llOpenInBuilder')));
  const save = fn('cvSave');
  check('a converted liturgy is kept for the service and its year, from its document, and READ BACK',
    /made_from: 'doc:' \+ cv\.itemId/.test(save) && /: sb\.from\('service_liturgies'\)\.insert\(row\)\.select\(\)\)/.test(save) &&
    /select\('id,title,year,occasion_id,data'\)\.eq\('id', saved\.id\)/.test(save) && /ensureOccYearFolder\(saved\.occasion_id, saved\.year\)/.test(save) &&
    /WO\.docLiturgy\(plan, cv\.type\)/.test(save));
  const read = fn('_cvRead');
  check('Word is read in the browser; everything else by the server\'s AI', /WO\.docxParas\(ab\)/.test(read) && /fetch\('\/api\/parse-liturgy'/.test(read) &&
    /how: \(ext === 'docx' \|\| gd\) \? 'word' : 'ai'/.test(fn('spConvert')));
  check('the Word reader notes a paragraph set wholly in bold', /b: _lbdWBold\(p\)/.test(SRC) && /if \(!b \|\| v === '0' \|\| v === 'false'\) all = false;/.test(fn('_lbdWBold')));
  try {
    // Uploading, run: the year from the name, the folder for it, the kind.
    const added = [], folders = [];
    const one = new Function('ensureOccYearFolder', 'uploadToSupabase', 'addItem', 'getItem', 'generateId', 'occFolders', 'SP_DOC_EXT', 'SP_LIT_WORDS',
      fn('_spUploadOne') + '\nreturn _spUploadOne;')(
      (occ, year) => { folders.push(occ + ':' + year); return Promise.resolve({ id: 'f' + year, name: year }); },
      (file, dir) => Promise.resolve({ url: 'https://x.supabase.co/storage/v1/object/public/Liturgy%20Files/' + dir + '/' + file.name, path: dir + '/' + file.name }),
      it => added.push(it), id => added.filter(x => x.id === id)[0], (() => { let n = 0; return () => 'id' + (++n); })(), {},
      /\.(docx?|pdf|xlsx?|odt|rtf|pages)$/i, /liturg|\bservice\b|order of (worship|service)|communion|vespers|evening prayer|compline|framework|seder/i);
    await one({ name: 'Maundy_Thursday_Liturgy_2026.docx', size: 10 }, 'maundy-thursday', '');
    await one({ name: 'Foot washing 2015.jpg', size: 10 }, 'maundy-thursday', '');
    await one({ name: 'Notes for the band.pdf', size: 10 }, 'maundy-thursday', '');
    await one({ name: 'Order.pdf', size: 10 }, 'maundy-thursday', 'liturgy');
    const k = added.map(x => x.type + (x.tags.indexOf('liturgy-doc') !== -1 ? '+doc' : '') + '@' + x.occasionFolderId).join(' | ');
    check('an upload is filed in the year its name gives (else this year), a liturgy by its name or because it was sent as one',
      k === 'liturgy@f2026 | media@f2015 | documents@f' + new Date().getFullYear() + ' | liturgy+doc@f' + new Date().getFullYear() &&
      added[0].title === 'Maundy Thursday Liturgy 2026' && added.every(x => x.occasionId === 'maundy-thursday' && x.storageProvider === 'supabase'), k);
  } catch (e) { check('an upload is filed in the year its name gives', false, e.message); }
  const up = fn('spUploadDoc');
  check('several files at once, each read in turn; one liturgy is offered to be made ready, anything else shown where it went',
    /files\.reduce\(function\(chain, file\)/.test(up) && /\{ action: 'Convert it', duration: 9000, onAction: function\(\) \{ spConvert\(last\.id\); \} \}/.test(up) &&
    /action: 'Show'/.test(up) && /if \(mode === 'liturgy'\) \{/.test(up));
  // "What is Other Files?" -- everything filed with a service that is not a
  // liturgy, mostly photographs: named so, and moved only in so many words.
  check('"Other Files" is Photos & Files; a document is moved between it and the liturgies from its preview, in words',
    /var SP_FILES_LABEL = 'Photos & Files';/.test(SRC) && !/spMark/.test(fn('_spResHtml')) && /_lfLiturgyMoveBtn\(item\)/.test(fn('lfOpen')) &&
    /Not a liturgy: move to ' \+ SP_FILES_LABEL/.test(fn('_lfLiturgyMoveBtn')) && /It is a liturgy: move to Liturgy Documents/.test(fn('_lfLiturgyMoveBtn')) &&
    /lfCloseViewer\(\);/.test(fn('spMark')));
  check('a ready liturgy\'s delete asks, and is read back gone', /window\.lhcAskDelete/.test(fn('spDeleteReady')) && /if \(\(back\.data \|\| \[\]\)\.length\) throw/.test(fn('spDeleteReady')));

  // ------------------------------------------------------------ 6. server
  console.log('\n6. The server');
  check('the route exists', !!RSRC);
  if (RSRC) {
    const guard = RSRC.indexOf('if (!isOwnStorage(url))'), ext = RSRC.indexOf('const ext = extFromUrl(url)'), get = RSRC.indexOf('await fetch(url)');
    check('only files this app uploaded are fetched, checked before anything else', guard > 0 && guard < ext && ext < get);
    check('PDF, Word (new and old) and Excel', /\['pdf', 'doc', 'docx', 'xls', 'xlsx'\]/.test(RSRC) && /mammoth/.test(RSRC) && /XLSX\.utils\.sheet_to_csv/.test(RSRC));
    check('the words copied exactly, readings and songs by name only', /EXACTLY as printed/.test(RSRC) && /enum: \['liturgy', 'reading', 'song', 'text'\]/.test(RSRC));
    // Either line ending: git writes this file CRLF on some checkouts.
    const m = RSRC.match(/function legacyDocText\(buf: Buffer\): string \{[\s\S]*?\r?\n\}\r?\n/);
    let doc = null;
    if (m) {
      const body = m[0].replace('(buf: Buffer): string', '(buf)').replace(/\(c: number\)/g, '(c)').replace(/\(run: string\)/g, '(run)')
        .replace(/\(s: string\)/g, '(s)').replace(/: string\[\]/g, '');
      try { doc = new Function(body + '\nreturn legacyDocText;')(); } catch (e) { doc = null; }
    }
    check('an old .doc\'s reader is there', !!doc);
    if (doc) {
      const junk = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 3, 0, 0xfe, 0xff, 9, 0]);
      const wide = Buffer.concat([junk, Buffer.from('INVOCATION\rL: In the Name of the Father\rC: Amen\r', 'utf16le'), junk]);
      const got = doc(wide);
      check('...reads the words Word keeps as UTF-16, one line a paragraph', /INVOCATION\nL: In the Name of the Father\nC: Amen/.test(got), JSON.stringify(got));
      const narrow = Buffer.concat([junk, Buffer.from('CONFESSION AND FORGIVENESS\rL: \x93Everyone who calls\x94\r', 'latin1'), junk]);
      const got2 = doc(narrow);
      check('...and the plain English it keeps one byte a letter, Word\'s quotes made plain', /CONFESSION AND FORGIVENESS\nL: "Everyone who calls"/.test(got2), JSON.stringify(got2));
      check('...and nothing from a file with no words', doc(Buffer.from([0, 1, 2, 3, 200, 201, 0, 0, 5])) === '');
    }
  }

  // ------------------------------------------------------------ 7. busy
  // The day it went live Gemini answered "high demand" (503) twice. A busy
  // answer is asked again, then of the lighter model; nothing else is.
  console.log('\n7. When Gemini is busy');
  const RETRY = path.join(__dirname, '..', 'app', 'api', '_lib', 'aiRetry.ts');
  let R = null;
  try {
    const ts = require('typescript');
    const js = ts.transpileModule(fs.readFileSync(RETRY, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
    const mod = { exports: {} };
    new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
    R = mod.exports;
  } catch (e) { R = null; console.log('  (aiRetry.ts could not be compiled: ' + e.message + ')'); }
  check('the retry is there', !!(R && R.withBusyRetry));
  if (R && R.withBusyRetry) {
    const BUSY = Object.assign(new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'), { status: 503 });
    const run = async (answers, opts) => {
      const calls = [], waits = [];
      let t = 0;
      const out = await R.withBusyRetry(['flash', 'lite'], async (model) => {
        calls.push(model);
        const a = answers.shift();
        t += 4000;
        if (a instanceof Error) throw a;
        return a;
      }, Object.assign({ sleep: async (ms) => { waits.push(ms); t += ms; }, now: () => t }, opts || {})).then(v => v, e => ({ err: e }));
      return { out, calls, waits };
    };
    let r = await run(['liturgy']);
    check('answered at once: one call', r.out.model === 'flash' && r.out.value === 'liturgy' && r.calls.length === 1 && !r.waits.length);
    // In turn: an overloaded model is slow to say no, and asking it twice
    // first left the lighter model "not asked: out of time" (live, 2026-11-14).
    r = await run([BUSY, 'liturgy']);
    check('busy once: the lighter model is asked straight away', r.out.model === 'lite' && r.calls.join() === 'flash,lite' && !r.waits.length);
    r = await run([BUSY, BUSY, 'liturgy']);
    check('both busy: round again after a short wait, the first model first', r.out.model === 'flash' && r.calls.join() === 'flash,lite,flash' && r.waits.join() === '2500');
    r = await run([BUSY, BUSY, BUSY, BUSY]);
    check('busy every time: "busy", after four tries, one wait', r.out.err && r.out.err.busy === true && r.calls.join() === 'flash,lite,flash,lite' && r.waits.join() === '2500');
    const bad = new Error('400 INVALID_ARGUMENT: the file is not a document');
    r = await run([bad]);
    check('a real error is passed straight back, never retried', r.out.err === bad && r.calls.length === 1);
    r = await run([BUSY, new Error('404 models/lite is not found'), BUSY]);
    check('a backup that fails some other way is not asked again; the rest carry on', r.out.err && r.out.err.busy === true && r.calls.join() === 'flash,lite,flash');
    r = await run([BUSY, BUSY, BUSY, BUSY], { budgetMs: 9000 });
    check('no try starts after the time budget', r.out.err && r.out.err.busy === true && r.calls.length < 4, r.calls.join());
    check('429 and "overloaded" are busy too; a 400 is not',
      R.isBusy({ status: 429 }) && R.isBusy(new Error('The model is overloaded.')) && !R.isBusy(new Error('400 bad request')));
    // What each model said, so "busy" can be told from a free-tier key turned
    // away or a backup model the key lacks (asked for 2026-11-14).
    r = await run([BUSY, BUSY, BUSY, BUSY]);
    check('"busy" carries what each model last said, by name',
      JSON.stringify(r.out.err && r.out.err.reasons) === JSON.stringify(['flash: 503 UNAVAILABLE: This model is currently experiencing high demand.', 'lite: 503 UNAVAILABLE: This model is currently experiencing high demand.']),
      JSON.stringify(r.out.err && r.out.err.reasons));
    r = await run([BUSY, new Error('{"error":{"code":404,"message":"models/gemini-flash-lite-latest is not found for API version v1beta","status":"NOT_FOUND"}}'), BUSY]);
    check('a backup model the key lacks is said, not hidden in "busy"',
      r.out.err && r.out.err.busy && /^lite: 404 NOT_FOUND: models\/gemini-flash-lite-latest is not found/.test((r.out.err.reasons || [])[1] || ''),
      JSON.stringify(r.out.err && r.out.err.reasons));
    const quota = new Error('got status: 429 Too Many Requests. {"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits","status":"RESOURCE_EXHAUSTED"}}');
    check('a quota answer reads as one: code, status and Google\'s words',
      /^429 RESOURCE_EXHAUSTED: You exceeded your current quota/.test(R.reasonOf(quota)) && R.reasonOf(new Error('x'.repeat(500))).length === 200);
    // The lighter model refused "don't think first" with nothing but
    // "400 INVALID_ARGUMENT" (live, 2026-11-14): asked again without it.
    const LITE_400 = new Error('{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}');
    check('a refused setting is known by "invalid argument" or by "thinking"; a busy or missing model is not',
      !!R.refusedSetting && R.refusedSetting(LITE_400) && R.refusedSetting(new Error('Thinking budget is not supported for this model.')) &&
      !R.refusedSetting(BUSY) && !R.refusedSetting(new Error('{"error":{"code":404,"message":"models/x is not found","status":"NOT_FOUND"}}')) &&
      !R.refusedSetting(new Error('{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}')));
    if (R.settingLadder) {
      // The route's own attempt, over the retry: the lighter model first; it
      // refuses "no thinking" and "minimal thinking", and answers with its
      // own default. The next round starts where it took one.
      const asked = [];
      const said = { 'lite/0': LITE_400, 'lite/1': LITE_400, 'lite/2': 'liturgy' };
      const ask = async (model, i) => {
        const k = model + '/' + i;
        asked.push(k);
        const a = said[k];
        if (a instanceof Error) throw a;
        return a;
      };
      const SET = ['budget0', 'minimal', null];
      const ladder = R.settingLadder(SET);
      const got = await R.withBusyRetry(['lite', 'flash'], (model) => ladder(model, (st) => ask(model, SET.indexOf(st))),
        { sleep: async () => {}, now: () => 0 }).then(v => v, e => ({ err: e }));
      check('a refused setting is asked again with the next, until one is taken',
        got.model === 'lite' && got.value === 'liturgy' && asked.join() === 'lite/0,lite/1,lite/2', asked.join());
      asked.length = 0;
      await ladder('lite', (st) => ask('lite', SET.indexOf(st)));
      check('...and the setting it took is where that model starts next time', asked.join() === 'lite/2', asked.join());
      let thrown = null;
      await R.settingLadder(['a', 'b'])('m', async () => { throw LITE_400; }).catch(e => { thrown = e; });
      check('the last setting refused too is a real error, passed on', thrown === LITE_400);
      let n = 0;
      await R.settingLadder(['a', 'b'])('m', async () => { n++; throw BUSY; }).catch(() => {});
      check('a busy answer is not a refused setting: asked once, left to the retry', n === 1);
    }
    // Cut off by the route's own deadline (the Good Friday 2025 PDF ran into
    // Vercel's 60s on 2026-11-14): the library rejects with an AbortError.
    const CUT = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    check('a try cut off is known: the library\'s AbortError, fetch\'s TimeoutError, Google\'s DEADLINE_EXCEEDED; busy and refusals are not',
      !!R.isCutOff && R.isCutOff(CUT) && R.isCutOff(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })) &&
      R.isCutOff(new Error('{"error":{"code":504,"message":"Deadline expired before operation could complete.","status":"DEADLINE_EXCEEDED"}}')) &&
      !R.isCutOff(BUSY) && !R.isCutOff(LITE_400) && !R.refusedSetting(CUT));
    r = await run([CUT, 'liturgy']);
    check('a try cut off ends the run as "too slow", the next model said not asked',
      r.out.err && r.out.err.busy === true && r.out.err.slow === true && r.calls.join() === 'flash' &&
      JSON.stringify(r.out.err.reasons) === JSON.stringify(['flash: no answer in time (This operation was aborted)', 'lite: not asked: out of time']),
      JSON.stringify(r.out.err && r.out.err.reasons));
    r = await run([BUSY, CUT, 'liturgy']);
    check('...after a busy answer too; busy alone is not slow',
      r.out.err && r.out.err.slow === true && r.calls.join() === 'flash,lite' && (await run([BUSY, BUSY, BUSY, BUSY])).out.err.slow === false);
  }
  if (RSRC) {
    // Google's library retried a busy answer five times by itself, and the
    // lighter model was never reached within the budget (found live).
    check('the route asks each model with the least thinking it takes: none, minimal, then its own default',
      /const THINKING[^=]*= \[\s*\{ thinkingBudget: 0 \},\s*\{ thinkingLevel: ThinkingLevel\.MINIMAL \},\s*null,\s*\];/.test(RSRC) &&
      /const ladder = settingLadder\(THINKING\);/.test(RSRC) &&
      /withBusyRetry\(GEMINI_MODELS, \(model\) => ladder\(model, \(thinking\) => ask\(model, thinking\)\),/.test(RSRC) &&
      /\.\.\.\(thinking \? \{ thinkingConfig: thinking \} : \{\}\),/.test(RSRC));
    check('the route keeps its own deadline inside Vercel\'s 60s: every call cut off when it comes, no try started too late',
      /const DEADLINE_MS = 54000;/.test(RSRC) && /export const maxDuration = 60;/.test(RSRC) &&
      /const left = \(\) => DEADLINE_MS - \(Date\.now\(\) - t0\);/.test(RSRC) &&
      /abortSignal: AbortSignal\.timeout\(Math\.max\(1000, left\(\)\)\),/.test(RSRC) && /\{ budgetMs: left\(\) - MIN_TRY_MS \}/.test(RSRC));
    check('a liturgy cut off is told so in words (504, slow), never Vercel\'s error page',
      /if \(err\.slow\) \{[\s\S]{0,200}error: 'Reading this liturgy took longer than the page can wait/.test(RSRC) &&
      /slow: true, reasons: err\.reasons,\s*\}, \{ status: 504 \}\);/.test(RSRC));
    check('every try is written to the log: model, setting, time, outcome',
      /console\.log\('parse-liturgy try:', model, how, \(Date\.now\(\) - at\) \+ 'ms', 'answered'\);/.test(RSRC) &&
      /console\.log\('parse-liturgy try:', model, how, \(Date\.now\(\) - at\) \+ 'ms', reasonOf\(err\)\);/.test(RSRC));
    check('the library asks once; the retry above decides the rest', /new GoogleGenAI\(\{ apiKey, httpOptions: \{ retryOptions: \{ attempts: 1 \} \} \}\)/.test(RSRC));
    check('the route sends the reasons with "busy", and logs them',
      /busy: true, reasons: err\.reasons \}/.test(RSRC) && /console\.warn\('parse-liturgy: every try was turned away:'/.test(RSRC));
  }
  const cvr = fn('_cvRead'), cvd = fn('_cvDraw');
  check('the review window shows what Google said under the message',
    /e\.reasons = Array\.isArray\(j\.reasons\) \? j\.reasons : \[\];/.test(cvr) && /cv\.why = \(e && Array\.isArray\(e\.reasons\)\)/.test(cvr) &&
    /class="cv-why"><b>What Google said<\/b>/.test(cvd));
  if (RSRC) {
    check('the route asks flash-lite, then flash, through the retry, and says "busy" in words',
      /const GEMINI_MODELS = \['gemini-flash-lite-latest', 'gemini-flash-latest'\];/.test(RSRC) &&
      /await withBusyRetry\(GEMINI_MODELS,/.test(RSRC) && /err instanceof AiBusyError/.test(RSRC) && /busy: true, reasons: err\.reasons \}, \{ status: 503 \}/.test(RSRC));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
})();
