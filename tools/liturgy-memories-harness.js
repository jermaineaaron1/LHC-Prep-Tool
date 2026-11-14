'use strict';
// Harness for Memories, as the operator's design (2026-11-14).
//
// From the operator: the fourth of four ChatGPT screens -- "Memories, what we
// have done before": a card per past service (photo, date, a few words, its
// photos, songs, liturgy, slides, who served), years down the left, All /
// Timeline / By Year / By Occasion, search, Add Memory, View Memory. Asked,
// they chose that EVERY past service is a memory, built from its order, the
// roster and what is filed under it, and that Add Memory gives one a
// description and photographs (a service_memories row).
//
//   1. The date an order is for -- by the day it was made, never today's year.
//   2. What an order held: songs in sung order and once each, slides, liturgy.
//   3. Every past service as a memory: past only, no songbooks, one per date,
//      the row people added joined on, titles, occasions.
//   4. Finding and grouping: year, bookmarks, words; month, year, occasion.
//   5. Saving a memory: read before write, another device's photo kept, read
//      back, photographs taken away again when the save does not land.
//   6. The page: the panel, the old ribbons under By Occasion, who served,
//      the view-only link, the order editor's two helpers, the migration.
//
// USAGE
//   node tools/liturgy-memories-harness.js
//   node tools/liturgy-memories-harness.js <Index.html> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
const MIGRATION = path.join(__dirname, '..', 'migrations', '2026-11-14_service_memories.sql');
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
const line = re => { const m = SRC.match(re); return m ? m[0] : ''; };

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}
const tick = () => new Promise(r => setTimeout(r, 15));

const CONSTS = [line(/  var MV_MON = \[[^\n]*\];/), line(/  var MV_MONTH = \[[^\n]*\];/)].join('\n');
const PURE = ['_mvPad', '_mvShortDate', '_mvOrderIso', '_mvCountsOf', '_mvTitle', '_mvBuild', '_mvFilter', '_mvGroups', '_llSeasonOf'];
let api = null;
try {
  const bodies = PURE.map(fn);
  if (bodies.every(Boolean) && CONSTS.trim()) {
    api = new Function(CONSTS + '\n' + bodies.join('\n') +
      '\nreturn { iso: _mvOrderIso, counts: _mvCountsOf, build: _mvBuild, filter: _mvFilter, groups: _mvGroups };')();
  }
} catch (e) { api = null; }

(async () => {
  // ------------------------------------------------------------ 1. dates
  console.log('\n1. The date an order is for');
  check('the Memories functions are on the page', !!api);
  if (api) {
    const I = api.iso;
    const cases = [
      [{ serviceDate: 'Nov 15', title: 'Service - 15 Nov 2026', createdDate: '2026-11-08T04:38:26Z' }, '2026-11-15'],
      [{ serviceDate: 'Nov 8', title: 'Service - Nov 8', createdDate: '2026-11-01T10:00:00Z' }, '2026-11-08'],
      [{ serviceDate: 'Dec 27', title: 'Service - Dec 27', createdDate: '2026-11-08T10:00:00Z' }, '2026-12-27'],
      [{ serviceDate: 'Jan 3', title: 'Service - Jan 3', createdDate: '2026-12-20T10:00:00Z' }, '2027-01-03'],
      [{ serviceDate: 'Nov 8', title: 'Service - Nov 8', createdDate: '2026-11-10T10:00:00Z' }, '2026-11-08'],
      [{ serviceDate: 'Dec 31 PM', title: 'Watchnight', createdDate: '2026-12-01T10:00:00Z' }, '2026-12-31|pm'],
      [{ serviceDate: '', title: 'LHC Jubilee - 15 Aug 2026', createdDate: '2026-07-06T10:00:00Z' }, '2026-08-15'],
      [{ serviceDate: '', title: 'LHC Caroling 2026', createdDate: '2026-10-27T10:00:00Z' }, ''],
      [{ serviceDate: 'Nov 8', title: 'Service - Nov 8' }, '']
    ];
    const bad = cases.filter(c => I(c[0]) !== c[1]);
    check('the title\'s year when it names one; else the year it was MADE ("Jan 3" made in December is next January)',
      bad.length === 0, bad.map(c => JSON.stringify(c[0]) + ' -> ' + I(c[0]) + ' (wanted ' + c[1] + ')').join('\n        '));
    // The point of all that: a 2026 order is still a 2026 service when the
    // page is opened in 2027.
    check('"Service - Nov 8", made in 2026, is 8 Nov 2026 whatever year it is opened in',
      I({ serviceDate: 'Nov 8', title: 'Service - Nov 8', createdDate: '2026-11-01T10:00:00Z' }) === '2026-11-08');
  }

  // ------------------------------------------------------------ 2. counts
  console.log('\n2. What an order held');
  if (api) {
    const rows = [
      { order_id: 'o1', item_type: 'song', title: 'Give Me Oil', sort_order: 4, slides: [{}, {}] },
      { order_id: 'o1', item_type: 'song', title: 'Come, Now Is The Time', sort_order: 0, slides: [{}, {}, {}] },
      { order_id: 'o1', item_type: 'song', title: 'We Praise You', sort_order: 1, slides: [{}] },
      { order_id: 'o1', item_type: 'song', title: 'we praise you', sort_order: 5, slides: [{}] },
      { order_id: 'o1', item_type: 'liturgy', title: 'Invocation', sort_order: 6, slides: [{}, {}, {}, {}] },
      { order_id: 'o1', item_type: 'content', title: '', sort_order: 8, slides: [] },
      { order_id: 'o1', item_type: 'scripture', title: 'Psalm 70', sort_order: 9, slides: [{}, {}] },
      { order_id: 'o2', item_type: 'liturgy', title: 'Kyrie', sort_order: 0, slides: null }
    ];
    const c = api.counts(rows);
    check('songs in the order they were sung, each once (a song sung twice is one song)',
      JSON.stringify(c.o1.titles) === JSON.stringify(['Come, Now Is The Time', 'We Praise You', 'Give Me Oil']) && c.o1.songs === 3,
      JSON.stringify(c.o1));
    check('every projected slide, a text part counting as one', c.o1.slides === 2 + 3 + 1 + 1 + 4 + 1 + 2, String(c.o1.slides));
    check('liturgy parts counted; an order with slides missing is not an error', c.o1.parts === 1 && c.o2.parts === 1 && c.o2.slides === 0);
  }

  // ------------------------------------------------------------ 3. build
  console.log('\n3. Every past service as a memory');
  if (api) {
    const src = {
      today: '2026-11-14',
      orders: [
        { id: 'o-nov8', title: 'Service - Nov 8', type: 'contemporary', serviceDate: 'Nov 8', createdDate: '2026-11-01T00:00:00Z' },
        { id: 'o-nov8-old', title: 'Service - Nov 8 (copy)', type: 'traditional', serviceDate: 'Nov 8', createdDate: '2026-10-30T00:00:00Z' },
        { id: 'o-nov15', title: 'Service - 15 Nov 2026', type: 'traditional', serviceDate: 'Nov 15', createdDate: '2026-11-08T00:00:00Z' },
        { id: 'o-nov14', title: 'Service - Nov 14', type: 'traditional', serviceDate: 'Nov 14', createdDate: '2026-11-08T00:00:00Z' },
        { id: 'standalone_sb_1', title: 'LHC Jubilee - 15 Aug 2026', type: 'traditional', serviceDate: '', createdDate: '2026-07-06T00:00:00Z' },
        { id: 'o-gf', title: 'Good Friday 2026', type: 'traditional', serviceDate: 'Apr 3', createdDate: '2026-03-20T00:00:00Z' },
        { id: 'o-sep6', title: 'Service - Sep 6', type: 'traditional', serviceDate: 'Sep 6', createdDate: '2026-09-03T00:00:00Z' }
      ],
      rows: [
        { service_key: '2026-11-08', description: 'Mission Sunday with the youth band', photos: [{ url: 'https://x/a.jpg', path: 'm/a.jpg' }, null, { name: 'no url' }] },
        { service_key: '2025-12-24', title: 'Christmas Eve 2025', description: 'Candlelight', photos: [], order_id: 'o-old' },
        { service_key: '2026-12-24', description: 'not yet' }
      ],
      meta: { '2026-11-08': { day: '24th Sunday after Pentecost', color: 'Green' }, '2026-04-03': { day: 'Good Friday', color: 'Black' } },
      people: { '2026-11-08': { preacher: 'Rev. A', liturgist: 'B' } },
      reads: { '2026-11-08': { gospel: 'Matthew 25:1-13' } },
      counts: { 'o-nov8': { songs: 5, slides: 128, parts: 8, titles: ['Give Me Oil In My Lamp'] } },
      occFor: (day, type) => /good friday/i.test(day) ? 'good-friday' : (type === 'contemporary' ? 'ordinary-contemporary' : 'ordinary-traditional'),
      occLabel: id => ({ 'good-friday': 'Good Friday', 'ordinary-traditional': 'Traditional Service' })[id] || ''
    };
    const list = api.build(src);
    const keys = list.map(m => m.key);
    check('past services only (today counts), newest first; no songbook; nothing not yet happened',
      JSON.stringify(keys) === JSON.stringify(['2026-11-14', '2026-11-08', '2026-09-06', '2026-04-03', '2025-12-24']), keys.join(', '));
    const nov8 = list.find(m => m.key === '2026-11-08');
    check('two orders on one date are one memory: the newest edited (listed first)', nov8.orderId === 'o-nov8' && nov8.type === 'contemporary');
    check('the row people added is joined on: its words, its photographs (only real ones)',
      nov8.description === 'Mission Sunday with the youth band' && nov8.photos.length === 1 && nov8.counts.slides === 128);
    check('the roster gives it its day, colour, who served and readings',
      nov8.day === '24th Sunday after Pentecost' && nov8.color === 'Green' && nov8.people.preacher === 'Rev. A' && nov8.reads.gospel === 'Matthew 25:1-13' && nov8.season === 'ordinary');
    check('...and is named by the day', nov8.title === '24th Sunday after Pentecost');
    const gf = list.find(m => m.key === '2026-04-03');
    check('a day that comes once a year is filed under its service and carries its year', gf.occasion === 'good-friday' && gf.title === 'Good Friday 2026');
    const xmas = list.find(m => m.key === '2025-12-24');
    check('a memory added for a date with no order still stands, with the title given it', xmas && xmas.title === 'Christmas Eve 2025' && xmas.orderId === 'o-old');
    const sep6 = list.find(m => m.key === '2026-09-06');
    check('an order whose name is only its date is called by its kind, never "Nov 8"', sep6.title === 'Traditional service', sep6.title);
  }

  // ------------------------------------------------------------ 4. finding
  console.log('\n4. Finding and grouping');
  if (api) {
    const L = [
      { key: '2026-11-08', iso: '2026-11-08', year: '2026', title: '24th Sunday after Pentecost', day: '24th Sunday after Pentecost', description: '', orderTitle: '', occasion: 'ordinary-contemporary',
        counts: { titles: ['Give Me Oil In My Lamp'] }, reads: { gospel: 'Matthew 25:1-13' }, people: { preacher: 'Rev. Benedict' } },
      { key: '2026-04-03', iso: '2026-04-03', year: '2026', title: 'Good Friday 2026', day: 'Good Friday', description: 'Taize opened the service', orderTitle: '', occasion: 'good-friday',
        counts: null, reads: {}, people: {} },
      { key: '2025-12-24', iso: '2025-12-24', year: '2025', title: 'Christmas Eve 2025', day: '', description: '', orderTitle: '', occasion: 'christmas-eve', counts: null, reads: {}, people: {} }
    ];
    const ks = f => api.filter(L, Object.assign({ q: '', year: '', marks: false }, f), ['2025-12-24']).map(m => m.key).join(',');
    check('by year', ks({ year: '2025' }) === '2025-12-24' && ks({ year: '2026' }) === '2026-11-08,2026-04-03');
    check('bookmarked only', ks({ marks: true }) === '2025-12-24');
    check('by words: a song, a reading, who served, the description, the month',
      ks({ q: 'oil in my' }) === '2026-11-08' && ks({ q: 'matthew 25' }) === '2026-11-08' && ks({ q: 'BENEDICT' }) === '2026-11-08' &&
      ks({ q: 'taize' }) === '2026-04-03' && ks({ q: 'december' }) === '2025-12-24');
    const occLabel = id => ({ 'good-friday': 'Good Friday' })[id] || '';
    const tl = api.groups(L, 'timeline', occLabel).map(g => g.title + ':' + g.items.length).join('|');
    check('Timeline: a month each', tl === 'November 2026:1|April 2026:1|December 2025:1', tl);
    const yr = api.groups(L, 'year', occLabel).map(g => g.title + ':' + g.items.length).join('|');
    check('By Year: a year each', yr === '2026:2|2025:1', yr);
    const oc = api.groups(L, 'occasion', occLabel).map(g => g.title + ':' + g.items.length).join('|');
    check('By Occasion: the service\'s name; everything with no name it knows in ONE "Other services"',
      oc === 'Other services:2|Good Friday:1', oc);
    check('All: one group, unnamed', api.groups(L, 'all').length === 1 && api.groups(L, 'all')[0].title === '');
  }

  // ------------------------------------------------------------ 5. saving
  console.log('\n5. Saving a memory');
  const SAVE = ['mvSaveEdit', '_mvTodayIso', '_mvPad', '_mvEdErr', '_mvTableGone', 'mvCloseEdit'].map(fn);
  if (SAVE.every(Boolean)) {
    const mk = (opts) => {
      const store = { '2026-11-08': { service_key: '2026-11-08', description: 'old', photos: [
        { url: 'https://x/mine.jpg', path: 'memories/2026-11-08/mine.jpg' },
        { url: 'https://x/theirs.jpg', path: 'memories/2026-11-08/theirs.jpg' } ] } };
      const log = { reads: 0, writes: [], uploads: [], deleted: [], toasts: [], loaded: 0 };
      const el = { mvEdKey: { value: opts.key || '' }, mvEdDate: { value: opts.date || '' }, mvEdTitle: { value: '' },
                   mvEdDesc: { value: opts.desc == null ? 'Mission Sunday' : opts.desc }, mvEdSave: { disabled: false, innerHTML: '', textContent: '' },
                   mvEdErr: { textContent: '', hidden: true }, mvEdit: { remove() { log.closed = true; } } };
      const sb = { from: () => ({
        select: () => ({ eq: (k, v) => { log.reads++; return Promise.resolve({ data: store[v] ? [JSON.parse(JSON.stringify(store[v]))] : [], error: null }); } }),
        upsert: (rows) => {
          if (opts.failWrite) return Promise.resolve({ error: { message: 'refused' } });
          const r = JSON.parse(JSON.stringify(rows[0]));
          log.writes.push(r);
          if (!opts.dropWrite) store[r.service_key] = r;
          return Promise.resolve({ error: null });
        } }) };
      const env = {
        document: { getElementById: id => el[id] || null },
        sb: sb, log: log,
        ed: { key: opts.edKey || '', files: (opts.files || []).map(n => ({ name: n, size: 1000, type: 'image/jpeg' })), drop: opts.drop || [], busy: false },
        uploadToSupabase: (f, folder) => { log.uploads.push(folder + '/' + f.name); return Promise.resolve({ url: 'https://x/' + f.name, path: folder + '/' + f.name }); },
        deleteFromSupabase: p => log.deleted.push(p),
        showToast: m => log.toasts.push(m),
        _mvShrink: f => Promise.resolve(f),
        _mvFind: k => k === '2026-11-08' ? { key: k, orderId: 'o-nov8' } : null,
        _mvLoad: () => { log.loaded++; return Promise.resolve(); },
        renderMemories: () => {}
      };
      const body = 'var document = env.document, uploadToSupabase = env.uploadToSupabase, deleteFromSupabase = env.deleteFromSupabase, showToast = env.showToast,' +
        ' _mvShrink = env._mvShrink, _mvFind = env._mvFind, _mvLoad = env._mvLoad, renderMemories = env.renderMemories;' +
        ' var _mvSb = function() { return env.sb; }; var _mvEd = env.ed, _mvMissing = !!env.missing, _mv = { open: "" };' +
        ' var URL = { revokeObjectURL: function() {} };\n' + SAVE.join('\n') +
        '\nreturn { save: mvSaveEdit, state: function() { return { ed: _mvEd, open: _mv.open, missing: _mvMissing }; } };';
      const m = new Function('env', body)(env);
      return { m, log, el, store };
    };

    let t = mk({ edKey: '2026-11-08', files: ['new.jpg'], drop: ['memories/2026-11-08/mine.jpg'] });
    t.m.save(); for (let i = 0; i < 6; i++) await tick();
    const w = t.log.writes[0] || {};
    check('one write, after reading the row as it is now', t.log.writes.length === 1 && t.log.reads >= 2);
    check('another device\'s photograph is kept; the one removed here goes; the new one is added',
      JSON.stringify((w.photos || []).map(p => p.path)) === JSON.stringify(['memories/2026-11-08/theirs.jpg', 'memories/2026-11-08/new.jpg']),
      JSON.stringify(w.photos));
    check('the photograph goes under memories/<service>/', t.log.uploads[0] === 'memories/2026-11-08/new.jpg', t.log.uploads[0]);
    check('the row names its order and the words; no title means the day\'s name', w.order_id === 'o-nov8' && w.description === 'Mission Sunday' && w.title === null);
    check('the removed photograph\'s file is deleted only once the save is read back', JSON.stringify(t.log.deleted) === JSON.stringify(['memories/2026-11-08/mine.jpg']));
    check('saved: told so, closed, the page read again on that memory', t.log.toasts.length === 1 && t.log.closed && t.log.loaded === 1 && t.m.state().open === '2026-11-08');

    t = mk({ edKey: '2026-11-08', files: ['new.jpg'], failWrite: true });
    t.m.save(); for (let i = 0; i < 6; i++) await tick();
    check('a write refused: the photograph just uploaded is taken away again, nothing else deleted',
      JSON.stringify(t.log.deleted) === JSON.stringify(['memories/2026-11-08/new.jpg']) && !t.log.closed);
    check('...the window stays open with the reason, and Save works again',
      t.el.mvEdErr.hidden === false && /refused/.test(t.el.mvEdErr.textContent) && t.el.mvEdSave.disabled === false && t.m.state().ed.busy === false);

    t = mk({ edKey: '2026-11-08', dropWrite: true });
    t.m.save(); for (let i = 0; i < 6; i++) await tick();
    check('a write that does not read back is not reported as saved', t.log.toasts.length === 0 && /did not save/.test(t.el.mvEdErr.textContent));

    t = mk({ key: '__date', date: '2099-01-01' });
    t.m.save(); for (let i = 0; i < 3; i++) await tick();
    check('a service that has not happened yet is refused before anything is sent', t.log.writes.length === 0 && t.log.uploads.length === 0 && /not happened/.test(t.el.mvEdErr.textContent));
    t = mk({ key: '' });
    t.m.save(); await tick();
    check('no service chosen: asked for one', t.log.writes.length === 0 && /Choose which service/.test(t.el.mvEdErr.textContent));
  } else {
    check('the save is on the page', false);
  }

  // ------------------------------------------------------------ 6. page
  console.log('\n6. The page');
  check('the panel is drawn whole by the page', /<div id="liturgyMemoriesPanel" class="ll-panel" style="display:none;"><\/div>/.test(SRC) && !/id="memoriesBody"/.test(SRC));
  const om = fn('openMemories');
  check('Memories shows itself through the one switcher, then reads the services and the notes',
    /_llShowOnly\('liturgyMemoriesPanel'\);/.test(om) && /_mvLoad\(\)\.then\(renderMemories\);/.test(om) && /loadMemories\(\);/.test(om));
  const rm = fn('renderMemories');
  check('By Occasion keeps the page before it: every service\'s notes, photographs and documents',
    /_mv\.view === 'occasion'/.test(rm) && /_memRibbonsHtml\(\)/.test(rm) && /function _memRibbonsHtml\(\) \{/.test(SRC));
  check('the search keeps its cursor through a redraw', /var box = document\.getElementById\('mvSearch'\);/.test(rm));
  const roles = (SRC.match(/getRoleValues: function\(fromIso, toIso, roles\) \{[\s\S]*?\n    \},/) || [''])[0];
  check('who served: any roster roles, a cell left empty on purpose being nobody',
    /\.in\('role_id', roles\)/.test(roles) && /v === '__BLANK__' \|\| v === '-' \|\| v\.toUpperCase\(\) === 'TBD'/.test(roles));
  check('the page wears parchment', /id === 'liturgyMemoriesPanel' \? 'memories'/.test(fn('_llShowOnly')) && /#liturgyView\[data-ll="memories"\] \{ background: #f7f2ea; \}/.test(SRC));
  check('a shared memory opens the view-only page', /if \(kind === 'mem'\) \{ _mvSharedOpen\(rest, head, body, fail\); return; \}/.test(SRC) &&
    /_lfLink\('mem:' \+ m\.key\)/.test(fn('_mvShareModel')));
  check('the order editor lends a day\'s occasion and an order\'s stored sections',
    /occasionFor: _svlOccasionFor, sectionsOf: _woSectionsOf,/.test(SRC) && /orderStructures\[/.test(fn('_woSectionsOf')));
  const filed = fn('_mvFiled');
  check('photographs filed under a once-a-year service\'s year folder are its own; never an ordinary Sunday\'s',
    /\/\^ordinary-\/\.test\(m\.occasion\)\) return \[\];/.test(filed) && /String\(f\.name\) === m\.year/.test(filed));
  check('a photograph is made smaller on the device before it is uploaded', /1600 \/ Math\.max\(w, h, 1\)/.test(fn('_mvShrink')) && /'image\/jpeg', 0\.82/.test(fn('_mvShrink')));
  check('an order\'s counts are kept on the device by when it was last edited', /c\.at !== String\(o\.lastEdited \|\| ''\)/.test(fn('_mvCountsFor')));
  const mig = fs.existsSync(MIGRATION) ? fs.readFileSync(MIGRATION, 'utf8') : '';
  check('the migration makes the table, keyed by service, readable by the app',
    /create table if not exists public\.service_memories/.test(mig) && /service_key\s+text primary key/.test(mig) &&
    /photos\s+jsonb not null default '\[\]'::jsonb/.test(mig) && /create policy "anon_all_service_memories"/.test(mig));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
})();
