'use strict';
// Harness for the Liturgy Library as folders (2026-11-13). From the operator:
// a redesign so the library can be got at and shared by WhatsApp or email.
// They chose direction B, "Folders", and all four kinds of sharing -- one
// item, a service's folder, a view-only link to the library, and a date's
// readings with its Prayer of the Day.
//
//   1. The panel: in the page, reached as "Library", hidden by every other
//      panel switcher, and its browsing never makes a year folder.
//   2. What is shared, as text (run): an item's words or link, a file's own
//      address, a folder as a numbered list, a date's readings and prayer.
//   3. How it is sent: WhatsApp through lhcWhatsAppUrl, long messages not
//      squeezed into a link, a file sent as itself where it can be.
//   4. The view-only page a link opens: read from ?lib=, nothing editable.
//   5. The rows follow the pane's width; the collapsed rail shows icons.
//
// USAGE
//   node tools/liturgy-library-harness.js
//   node tools/liturgy-library-harness.js <Index.html> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8');

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
const varLine = n => (SRC.split('\n').find(l => new RegExp('^  var ' + n + '\\b').test(l)) || '');

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

// A stub of the module the functions run in.
function load() {
  const names = ['_lfE', '_lfKind', '_lfBadge', '_lfYearName', '_lfNewest', '_lfItemsOf', '_lfSvlOf', '_lfShortDate',
    '_lfLongDate', '_lfWhen', '_lfLink', '_lfPlainWords', '_lfItemModel', '_lfSvlModel', '_lfFolderModel', '_lfDayModel',
    '_lfLibraryModel', '_lfStorageFile', '_lfDownloadUrl', '_lfWordsHtml', '_lfFilePreview', '_lfSharedRow', '_lfSend', '_lfCopy'];
  const bodies = names.map(fn);
  const missing = names.filter((n, i) => !bodies[i]);
  if (missing.length) return { missing };
  const env = {
    window: { __WEBAPP_URL: 'https://lhc-prep-tool.vercel.app/', lhcWhatsAppUrl: t => 'https://api.whatsapp.com/send?text=' + encodeURIComponent(t), opened: [] },
    navigator: {}, location: { origin: 'https://lhc-prep-tool.vercel.app', pathname: '/', href: '' },
    document: { body: { appendChild() {} }, createElement: () => ({ setAttribute() {}, select() {}, remove() {}, style: {} }), execCommand: () => true },
    escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    getFileVisuals: it => {
      const ext = String(it.fileName || '').split('.').pop().toLowerCase();
      return ({ pdf: { label: 'PDF' }, docx: { label: 'Word' }, png: { label: 'Image' } })[ext] || { label: 'File' };
    },
    OCCASIONS: [{ id: 'good-friday', label: 'Good Friday', colour: 'black' }, { id: 'advent', label: 'Advent Sundays', colour: 'purple' }],
    occFolders: { 'good-friday': [{ id: 'f26', name: '2026' }, { id: 'f25', name: '2025' }] },
    liturgyItems: [],
    _lfSvlRows: { 'good-friday': [{ id: 'svl_1', title: 'Good Friday 2026', year: 2026, updated_at: '2026-04-03T10:00:00Z' }] },
    SBQ_READINGS: { SLOTS: [{ role: 'reading1', label: '1st Reading' }, { role: 'psalm', label: 'Psalm' }, { role: 'reading2', label: '2nd Reading' }, { role: 'gospel', label: 'Gospel' }] },
    LF_FILE_LOOK: null, toasts: [], showToast: (m) => env.toasts.push(m)
  };
  env.getOccasionById = id => env.OCCASIONS.find(o => o.id === id) || null;
  const look = varLine('LF_FILE_LOOK') ? extractFrom(SRC, /^  var LF_FILE_LOOK = \{/) : 'var LF_FILE_LOOK = {};';
  const keys = Object.keys(env).filter(k => k !== 'LF_FILE_LOOK');
  const body = look + '\nvar LF_WA_MAX = 3500, LF_MAIL_MAX = 1800;\n' + bodies.join('\n') +
    '\nreturn {' + names.map(n => n + ':' + n).join(',') + '};';
  const api = new Function(...keys, body)(...keys.map(k => env[k]));
  return { api, env };
}

(async () => {
  // ------------------------------------------------------------ 1. panel
  console.log('\n1. The panel');
  check('the panel is in the Liturgy page', /<div id="liturgyFolderPanel" class="lf" style="display:none;"><\/div>/.test(SRC));
  // Since 2026-11-14 the operator's design: the entry is Services again,
  // its cards open a collection's folder (openCollection -> openLibrary).
  check('the nav calls it Services, under the key the nav highlighting goes by',
    /data-libfilter="all-services" onclick="LiturgyModule\.showAllServices\(\)" title="Services">[\s\S]{0,200}<span>Services<\/span>/.test(SRC) &&
    /<i class="fa-solid fa-church" aria-hidden="true"><\/i><span>Services<\/span>/.test(SRC));
  check('Services opens the collections, and a collection opens its folder',
    /function showAllServices\(\) \{ openServices\(\); \}/.test(SRC) && /openLibrary\(occId \? 'occ:' \+ occId : \(special \|\| 'recent'\), year \|\| ''\);/.test(fn('openCollection')));
  check('the old card grid entry point is gone (one showAllServices)', (SRC.match(/function showAllServices\(/g) || []).length === 1);
  check('every other panel switcher hides it',
    /function selectOccasion\(occasionId\) \{\r?\n\s*_lfHide\(\);/.test(SRC) &&
    /_litSyncNav\('memories'\);\r?\n\s*_lfHide\(\);/.test(fn('openMemories')) &&
    /\/\/ Show library panel\r?\n\s*_lfHide\(\);/.test(SRC));
  const open = fn('openLibrary');
  const only = fn('_llShowOnly');
  check('...and it hides every other panel',
    /_llShowOnly\('liturgyFolderPanel'\);/.test(open) &&
    /\['liturgyWelcome', 'liturgyOccasionPanel', 'liturgyMemoriesPanel'\]\.concat\(LL_PANELS\)/.test(only) &&
    /var LL_PANELS = \['liturgyHubPanel', 'liturgyServicesPanel', 'liturgyFolderPanel', 'liturgyServicePanel'\];/.test(SRC));
  check('the occasion panel\'s back button comes back to its folder',
    /class="lit-back-btn" onclick="LiturgyModule\.backToLibrary\(\)">\s*<i class="fa-solid fa-arrow-left mr-1"><\/i> Library/.test(SRC));
  const bar = fn('renderOccFolderBar');
  check('browsing the library never makes a year folder (the occasion panel seeds one only on screen)',
    /_occOnScreen && _occOnScreen\.style\.display !== 'none' &&/.test(bar));
  check('changes to the items draw the library again', /function renderOccasionItems\(searchQuery\) \{\r?\n\s*renderOccSvl\(\);\r?\n\s*_lfRefreshSoon\(\);/.test(SRC));
  check('choosing a service makes Upload and New liturgy file into it',
    /_currentOccasion = m\[1\];\r?\n\s*_currentOccFolder = _lf\.year \|\| null;/.test(fn('lfSelect')) &&
    /openQuickAddModal\(null, null, _currentOccasion \? 'season' : 'general', null\)/.test(fn('lfUpload')));

  // ------------------------------------------------------------ 2. text
  console.log('\n2. What is shared');
  const L = load();
  check('the functions are on the page', !L.missing, L.missing && L.missing.join(', '));
  if (L.api) {
    const A = L.api, E = L.env;
    const SB = '\n' + '═'.repeat(35) + '\n';
    const text = { id: 'lit-1', title: 'Prayer of the Day', occasionId: 'good-friday', occasionFolderId: 'f26',
                   content: 'L: The Lord be with you  \n  \nC: And also with you.' + SB + 'Prayer of The Day\n\nC: Almighty God. Amen.', modified: 3, created: 1 };
    const pdf = { id: 'lit-2', title: 'Abide With Me', fileName: 'abide.pdf', occasionId: 'good-friday',
                  fileUrl: 'https://x.supabase.co/storage/v1/object/public/Liturgy%20Files/abide.pdf', modified: 2, created: 3 };
    const gdoc = { id: 'lit-3', title: 'GOOD FRIDAY LITURGY 2026', occasionId: 'good-friday', occasionFolderId: 'f25',
                   fileUrl: 'https://docs.google.com/document/d/abc/edit', modified: 1, created: 2 };
    E.liturgyItems.push(text, pdf, gdoc);

    check('kinds: a text, a PDF, a Google Doc, a whole liturgy',
      A._lfKind(text).group === 'text' && A._lfKind(pdf).badge === 'PDF' && A._lfKind(gdoc).label === 'Google Doc' &&
      A._lfKind({ _svl: true }).label === 'Whole liturgy');
    check('a link names its target, with the colon left readable',
      A._lfLink('occ:good-friday:2026') === 'https://lhc-prep-tool.vercel.app/?lib=occ:good-friday:2026' &&
      A._lfLink('day:2026-12-31|pm') === 'https://lhc-prep-tool.vercel.app/?lib=day:2026-12-31%7Cpm');
    const im = A._lfItemModel(text);
    check('an item\'s words: title, where it is, the words slide by slide, and its link',
      im.words === '*Prayer of the Day*\nGood Friday · 2026\n\nL: The Lord be with you\n\nC: And also with you.\n\nPrayer of The Day\n\nC: Almighty God. Amen.\n\nIn the Liturgy Library: https://lhc-prep-tool.vercel.app/?lib=item:lit-1', JSON.stringify(im.words));
    check('...or just the link', im.linkText === '*Prayer of the Day*\nGood Friday · 2026\nhttps://lhc-prep-tool.vercel.app/?lib=item:lit-1');
    const fm = A._lfItemModel(pdf);
    check('a file is sent by its own address, and as the file itself when it is ours',
      fm.words === null && fm.linkText.indexOf(pdf.fileUrl) !== -1 && fm.file && fm.file.name === 'abide.pdf');
    check('a file on another site is never fetched to be sent', A._lfItemModel(gdoc).file === null);
    check('a stored file downloads under its own name',
      A._lfDownloadUrl(pdf) === pdf.fileUrl + '?download=abide.pdf' && A._lfDownloadUrl(gdoc) === '');
    const all = A._lfFolderModel('good-friday', '');
    check('a folder: numbered, whole liturgies first, each with the address that opens it',
      /^\*Good Friday\*\nFrom the Liturgy Library, Luther House Chapel\n\n1\. Good Friday 2026 \(whole liturgy\)\nhttps:\/\/lhc-prep-tool\.vercel\.app\/\?lib=svl:svl_1\n2\. Prayer of the Day \(liturgy text\)\nhttps:\/\/lhc-prep-tool\.vercel\.app\/\?lib=item:lit-1\n3\. Abide With Me\nhttps:\/\/x\.supabase\.co/.test(all.words) &&
      /\n\nThe whole folder: https:\/\/lhc-prep-tool\.vercel\.app\/\?lib=occ:good-friday$/.test(all.words), JSON.stringify(all.words));
    const y26 = A._lfFolderModel('good-friday', 'f26');
    check('a year folder: that year\'s things, and the ones filed under no year, as the app shows them',
      y26.title === 'Good Friday · 2026' && /Prayer of the Day/.test(y26.words) && /Abide With Me/.test(y26.words) &&
      !/GOOD FRIDAY LITURGY 2026/.test(y26.words) && /\?lib=occ:good-friday:2026$/.test(y26.words));
    const dm = A._lfDayModel({ key: '2026-11-15', day: '25th Sunday after Pentecost', colour: 'Green',
      refs: [{ label: '1st Reading', ref: 'Zephaniah 1:7, 12-18' }, { label: 'Psalm', ref: 'Psalm 90:1-12' }, { label: '2nd Reading', ref: '' }, { label: 'Gospel', ref: 'Matthew 25:14-30' }],
      prayer: 'Almighty God, you have knit your people together. Amen.' });
    check('a date: the day, its readings, its Prayer of the Day, its link',
      /^\*25th Sunday after Pentecost\*\nSunday,? 15 November 2026\n\n\*Readings\*\n1st Reading: Zephaniah 1:7, 12-18\nPsalm: Psalm 90:1-12\nGospel: Matthew 25:14-30\n\n\*Prayer of the Day\*\nAlmighty God, you have knit your people together\. Amen\.\n\nIn the Liturgy Library: https:\/\/lhc-prep-tool\.vercel\.app\/\?lib=day:2026-11-15$/.test(dm.words), JSON.stringify(dm.words));
    check('every message keeps to the Basic Multilingual Plane (gotcha 68)',
      [im.words, im.linkText, fm.linkText, all.words, dm.words, A._lfLibraryModel().linkText].every(t => !/[\uD800-\uDFFF]/.test(t)));

    // ---------------------------------------------------------- 3. sending
    console.log('\n3. How it is sent');
    const opened = [];
    E.window.open = (u) => opened.push(u);
    // _lfSend reaches window.open through the stub's window.
    let sent = '';
    const send = (how, model, mode) => {
      const prevOpen = global.window;
      return A._lfSend(how, model, mode);
    };
    const sendSrc = fn('_lfSend');
    check('WhatsApp goes through lhcWhatsAppUrl, never wa.me', /window\.lhcWhatsAppUrl\(text\)/.test(sendSrc) && !/wa\.me/.test(sendSrc));
    check('a message too long for a WhatsApp link goes by the phone\'s share sheet, or is copied',
      /if \(text\.length <= LF_WA_MAX\)/.test(sendSrc) && /navigator\.share\(\{ title: model\.title, text: text \}\)/.test(sendSrc) && /_lfCopy\(text, 'Too long for a WhatsApp link/.test(sendSrc));
    check('email: the words, or past a mail link\'s length the link with the words copied',
      /if \(body\.length > LF_MAIL_MAX\)/.test(sendSrc) && /mailto:\?subject=/.test(sendSrc));
    check('the file itself only where the device says it can take one, else its link',
      /navigator\.canShare && navigator\.canShare\(\{ files: \[f\] \}\)/.test(sendSrc) && /window\.lhcWhatsAppUrl\(model\.linkText\)/.test(sendSrc));
    const sheet = fn('_lfShareOpen');
    check('the sheet offers the words or just a link, only when there are words', /\(model\.words\s*\r?\n?\s*\? '<div class="lf-seg"/.test(sheet));

    // ---------------------------------------------------------- 4. view only
    console.log('\n4. The view-only page');
    check('the link is read on start', /window\.__DEEPLINK_LIB      = p\.get\('lib'\)          \|\| '';/.test(SRC));
    const shared = fn('_lfOpenShared');
    check('it opens a folder, an item, a date, a whole liturgy, or the library',
      /kind === 'day'/.test(shared) && /kind === 'svl'/.test(shared) && /kind === 'item'/.test(shared) && /kind === 'occ'/.test(shared) && /'all', or anything not understood/.test(shared));
    const rowT = A._lfSharedRow(text, true), rowF = A._lfSharedRow(pdf, false);
    check('its rows read and download; nothing on them edits',
      !/contenteditable|<input|<select|<textarea|lfEdit|lfMove|lfDelete/.test(rowT + rowF + shared) &&
      /Download<\/a>/.test(rowF) && /Open<\/a>/.test(rowF));
    check('a text opens to its words, the people\'s lines bold', /<b>C: And also with you\.<\/b>/.test(rowT));
    check('a name typed with markup is shown as text', /&lt;b&gt;x/.test(A._lfSharedRow(Object.assign({}, text, { title: '<b>x' }), false)));
    check('the page says it is view only, and who to ask', /View only<\/span>/.test(shared) && /To change anything here, ask the worship team\./.test(shared));
  }

  // ------------------------------------------------------------ 5. layout
  console.log('\n5. Layout');
  check('the rows follow the pane\'s width: stacked unless the pane has room',
    /\.lf-pane \{ container-type: inline-size; container-name: lfpane; \}/.test(SRC) &&
    /@container lfpane \(min-width: 620px\) \{\s*\r?\n\s*\.lf-list__hd \{ display: grid; \}/.test(SRC) &&
    /\.lf-row__main \{ flex: 1; min-width: 0; display: grid; grid-template-columns: 38px minmax\(0, 1fr\); grid-template-rows: auto auto;/.test(SRC));
  check('a phone shows the folders, then one folder with a way back',
    /\.lf\.lf--pane \.lf-tree \{ display: none; \}/.test(SRC) && /\.lf:not\(\.lf--pane\) \.lf-pane \{ display: none; \}/.test(SRC));
  check('the collapsed rail shows the Liturgy entries as icons with their names on hover',
    /\.sidebar-collapsed #playlistSidebar #liturgyStatsSection \.lit-nav-occ-btn > span,/.test(SRC) &&
    /#liturgyStatsSection \.lit-nav-occ-btn::after \{\s*\r?\n\s*content: attr\(title\);/.test(SRC) &&
    /data-libfilter="dashboard" onclick="LiturgyModule\.selectOccasion\(null\)" title="Readings"/.test(SRC));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
})();
