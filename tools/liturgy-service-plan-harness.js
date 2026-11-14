'use strict';
// Harness for a service's plan (2026-11-14): Planning Notes, Special Planning
// and the Checklist on the Liturgy Library's service page.
//
// From the operator, with drawings of each tab: one Liturgy Order (the old
// planning panel's file list was a second); Planning Notes and the Checklist
// redesigned; Team Planning gone, "the checklist should already mention who
// does what"; Special Planning holding a song's YouTube video or audio, the
// chords found on a website, and afterwards the video of the performance.
// Asked: a plan for each service DATE, and a performance video as a link or
// an upload of up to 50 MB.
//
//   1. A plan's dates, its rows, its progress and what is due soon.
//   2. Links sorted by kind; files over 50 MB refused before any upload.
//   3. A plan copied forward; the usual checklist; the checklist as words.
//   4. A liturgy laid out by who says it (the Liturgy Order's reading card).
//   5. Saving: written and read back; a delete read back gone.
//   6. The page: one Liturgy Order, Liturgy Documents first, a task's who,
//      the preparation guide kept, the migration.
//
// USAGE
//   node tools/liturgy-service-plan-harness.js
//   node tools/liturgy-service-plan-harness.js <Index.html> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
const MIGRATION = path.join(__dirname, '..', 'migrations', '2026-11-14_service_plan_items.sql');
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
const block = re => { const m = SRC.match(re); return m ? m[0] : ''; };

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}
const tick = () => new Promise(r => setTimeout(r, 10));

const CONSTS = [block(/  var PL_CATS = \[[\s\S]*?\n  \];/), block(/  var PL_MAX_BYTES = [^\n]*;/), block(/  var PL_WHO = \{[\s\S]*?\};/), block(/  var MV_MON = \[[^\n]*\];/)];
const NAMES = ['_mvPad', '_mvShortDate', '_plKeysOf', '_plOf', '_plProgress', '_plDueSoon', '_plLinkKind', '_plFileProblem', '_plCopyRows', '_plFromElements', '_plShareText', '_plSpeakers', '_plChordsExcerpt'];
let P = null;
try {
  const bodies = NAMES.map(fn);
  if (bodies.every(Boolean) && CONSTS.every(Boolean)) {
    P = new Function(CONSTS.join('\n') + '\n' + bodies.join('\n') + '\nreturn { keys: _plKeysOf, of: _plOf, progress: _plProgress, soon: _plDueSoon, kind: _plLinkKind, file: _plFileProblem, copy: _plCopyRows, usual: _plFromElements, share: _plShareText, speakers: _plSpeakers, chords: _plChordsExcerpt };')();
  }
} catch (e) { P = null; console.log('  (could not build: ' + e.message + ')'); }

(async () => {
  // ------------------------------------------------------------ 1. plan
  console.log('\n1. A plan\'s dates, rows, progress and what is due');
  check('the plan\'s functions are on the page', !!P);
  if (P) {
    const rows = [
      { id: 'a', service_key: '2026-11-15', kind: 'task', category: 'decor', title: 'Stage', done: true, sort: 2 },
      { id: 'b', service_key: '2026-11-15', kind: 'task', category: 'decor', title: 'Decor', done: false, due: '2026-11-14', sort: 1 },
      { id: 'c', service_key: '2026-11-15', kind: 'task', category: 'media', title: 'Slides', done: false, due: '2026-11-20', sort: 1 },
      { id: 'd', service_key: '2026-11-15', kind: 'task', category: 'media', title: 'Run', done: false, due: '2026-11-12', sort: 2 },
      { id: 'e', service_key: '2026-11-08', kind: 'note', category: 'decor', title: 'Old note' }
    ];
    check('a service\'s dates: those with plans, and the next one, in order', P.keys(rows, '2026-11-22').join() === '2026-11-08,2026-11-15,2026-11-22');
    check('one date\'s rows of one kind, in their order (the Checklist groups them by category after)', P.of(rows, '2026-11-15', 'task').map(r => r.id).join() === 'b,c,a,d',
      P.of(rows, '2026-11-15', 'task').map(r => r.id).join());
    const p = P.progress(P.of(rows, '2026-11-15', 'task'));
    check('progress: all of it and each category, the soonest open due date', p.done === 1 && p.total === 4 && p.pct === 25 &&
      p.byCat.decor.done === 1 && p.byCat.decor.total === 2 && p.byCat.decor.due === '2026-11-14' && p.byCat.media.due === '2026-11-12', JSON.stringify(p));
    const s = P.soon(P.of(rows, '2026-11-15', 'task'), '2026-11-14', 3).map(t => t.id).join();
    check('due soon: not done, within three days, the overdue first', s === 'd,b', s);
  }

  // ------------------------------------------------------------ 2. links, files
  console.log('\n2. Links and files');
  if (P) {
    const k = u => P.kind(u);
    check('a video, audio, a chord chart or a link, from the address',
      k('https://youtu.be/abc') === 'video' && k('https://www.youtube.com/watch?v=x') === 'video' && k('https://music.youtube.com/watch?v=x') === 'audio' &&
      k('https://open.spotify.com/track/x') === 'audio' && k('https://tabs.ultimate-guitar.com/tab/x') === 'chords' && k('https://chordify.net/x') === 'chords' &&
      k('https://www.worshiptogether.com/songs/x') === 'chords' && k('https://lutheran.org/x') === 'link');
    const big = { name: 'performance.mp4', size: 80 * 1048576 }, ok = { name: 'short.mp4', size: 30 * 1048576 };
    check('a file over 50 MB is refused, with the way round it', /80 MB; the limit is 50 MB/.test(P.file(big)) && /YouTube/.test(P.file(big)) && P.file(ok) === '');
    const up = fn('_plUpload'), ef = fn('plEdFile');
    check('...before anything is uploaded', /var why = _plFileProblem\(file\);\r?\n\s*if \(why\) return Promise\.reject/.test(up) && /var why = _plFileProblem\(file\);\r?\n\s*if \(why\) \{ _plErr\(why\); return; \}/.test(ef));
    check('the performance is a video, and replaces the one before', /if \(role === 'performance' && !\/\^video/.test(ef) && /if \(x\.role === 'performance'\) \{ ed\.drop\.push\(x\); return false; \}/.test(ef));
  }

  // ------------------------------------------------------------ 3. copy, usual, share
  console.log('\n3. Copying forward, the usual list, the checklist as words');
  if (P) {
    const src = [
      { id: 't', occasion_id: 'o', service_key: '2026-11-08', kind: 'task', category: 'media', title: 'Slides', done: true, due: '2026-11-07', who: 'Vincent', note_id: 'n' },
      { id: 's', occasion_id: 'o', service_key: '2026-11-08', kind: 'special', category: 'presentation', title: 'Song', status: 'ready',
        links: [{ kind: 'video', url: 'https://youtu.be/x' }], files: [{ name: 'chart.pdf', role: 'file' }, { name: 'perf.mp4', role: 'performance' }] }
    ];
    let n = 0;
    const out = P.copy(src, '2026-11-15', () => 'new' + (++n));
    check('copied to the new date with new ids, a task not done, an item back to planned',
      out[0].id === 'new1' && out[0].service_key === '2026-11-15' && out[0].done === false && out[0].who === 'Vincent' && out[1].status === 'planned' && out[0].note_id === null);
    check('a due date moves by the same number of days', out[0].due === '2026-11-14', out[0].due);
    check('a reference video and a chart go with it; the performance stays with its own service',
      out[1].links.length === 1 && out[1].files.length === 1 && out[1].files[0].name === 'chart.pdf');
    check('the source rows are not changed', src[0].done === true && src[1].files.length === 2);
    const u = P.usual([{ label: 'PowerPoint / Media Slides', checked: false }, { label: 'Choir Presentation' }, { label: 'Baptism', checked: true }, { label: 'Dance Presentation' }, { label: '  ' }]);
    check('the usual checklist becomes tasks, each in the category its words name, ticks kept',
      u.map(x => x.category).join() === 'media,music,communion,presentation' && u[2].done === true, JSON.stringify(u));
    const text = P.share('Traditional Service', 'Sunday, 15 November 2026', [
      { title: 'Set stage', category: 'decor', done: true, who: 'Daniel' }, { title: 'Slides', category: 'media', done: false, who: 'Vincent', due: '2026-11-14' }]);
    check('the checklist as words: each category, who, by when, done or not',
      /\*Traditional Service – Checklist\*/.test(text) && /1 of 2 done/.test(text) && /\*Decorations & Space\*\n\[x\] Set stage – Daniel/.test(text) &&
      /\[ \] Slides – Vincent \(by 14 Nov 2026\)/.test(text), text);
    check('...in characters every phone keeps (nothing beyond the basic plane)', !/[\uD800-\uDFFF]/.test(text));
  }

  // ------------------------------------------------------------ 4. speakers
  console.log('\n4. A liturgy laid out by who says it');
  if (P) {
    const b = P.speakers('L: Come, let us worship.\nFor God is our creator.\nC: We come with grateful hearts.\n\nCongregation (C): Amen.\nP: The Lord be with you.');
    const t = b.map(x => x.who + (x.people ? '*' : '') + '=' + x.lines.join('/'));
    check('"L:" is the Leader\'s until somebody else is named; "C:" and "Congregation (C):" everyone\'s, in bold',
      t.join(' | ') === 'Leader=Come, let us worship./For God is our creator. | All*=We come with grateful hearts. | All*=Amen. | Pastor=The Lord be with you.', t.join(' | '));
    check('words with nobody named stay as they are', JSON.stringify(P.speakers('Lord, have mercy.')) === JSON.stringify([{ who: '', people: false, lines: ['Lord, have mercy.'] }]));
    check('"Psalm 23: The Lord is my shepherd" is words, not a speaker', P.speakers('Psalm 23: The Lord')[0].who === '');
    check('a song\'s chords, its first lines, as a reminder', P.chords('[Verse 1]\nG    D/F#\nLight of the world\n\n[Chorus]\nHere I am') === 'G    D/F#\nLight of the world');
  }

  // ------------------------------------------------------------ 5. saving
  console.log('\n5. Saving');
  const SAVE = ['_plInsert', '_plPatch', '_plDelete', '_plGone'].map(fn);
  if (SAVE.every(Boolean)) {
    const mk = (opts) => {
      const store = {}, log = { inserts: 0 };
      const q = {
        insert: rows => ({ select: () => { log.inserts++; if (opts.drop) return Promise.resolve({ data: [], error: null }); rows.forEach(r => { store[r.id] = r; }); return Promise.resolve({ data: rows, error: null }); } }),
        update: body => ({ eq: (k, id) => ({ select: () => { Object.assign(store[id], body); return Promise.resolve({ data: [store[id]], error: null }); } }) }),
        delete: () => ({ eq: (k, id) => { if (!opts.stuck) delete store[id]; return Promise.resolve({ error: null }); } }),
        select: () => ({ eq: (k, id) => Promise.resolve({ data: store[id] ? [{ id }] : [], error: null }) })
      };
      const env = { sb: { from: () => q }, pl: { rows: [], gone: false } };
      const api = new Function('env', 'var _pl = env.pl; var _plSb = function() { return env.sb; };\n' + SAVE.join('\n') +
        '\nreturn { insert: _plInsert, patch: _plPatch, del: _plDelete, pl: _pl };')(env);
      return { api, store, log };
    };
    let t = mk({});
    const got = await t.api.insert([{ id: 'x1', kind: 'task', title: 'A' }]).catch(e => e);
    check('written, then held as the database answered', Array.isArray(got) && t.api.pl.rows.length === 1 && t.store.x1.done === false && Array.isArray(t.store.x1.links));
    await t.api.patch('x1', { done: true });
    check('a change is one row\'s, and the page holds what came back', t.store.x1.done === true && t.api.pl.rows[0].done === true && !!t.store.x1.updated_at);
    t = mk({ drop: true });
    const bad = await t.api.insert([{ id: 'x2', title: 'B' }]).catch(e => e);
    check('a write that does not come back is an error, and the page does not show it', bad instanceof Error && t.api.pl.rows.length === 0);
    t = mk({});
    await t.api.insert([{ id: 'n1', kind: 'note' }, { id: 't1', kind: 'task', note_id: 'n1' }]);
    await t.api.del('n1');
    check('a deleted note is read back gone; its tasks stay (they are still in the database)', !t.store.n1 && t.api.pl.rows.map(r => r.id).join() === 't1');
    t = mk({ stuck: true });
    await t.api.insert([{ id: 'n2' }]);
    const stuck = await t.api.del('n2').catch(e => e);
    check('a delete that did not happen is said, and the row stays', stuck instanceof Error && t.api.pl.rows.length === 1);
    check('until the table exists, nothing is sent', /if \(_pl\.gone\) return Promise\.reject/.test(fn('_plInsert')));
  } else check('the save functions are on the page', false);

  // ------------------------------------------------------------ 6. page
  console.log('\n6. The page');
  const sel = fn('selectOccasion');
  check('one Liturgy Order: opening a service anywhere opens its page', /if \(occasionId && !_spGuideOpen && getOccasionById\(occasionId\)\) \{ openService\(occasionId\); return; \}/.test(sel) &&
    /function selectOccasion\(occasionId\) \{\r?\n\s*_lfHide\(\);/.test(SRC));
  check('the old panel stays only for a preparation guide, opened alone and back again',
    /_spGuideOpen = true;/.test(fn('spGuide')) && /switchOccasionTab\('prepare'\);/.test(fn('spGuide')) &&
    /#liturgyOccasionPanel\.lit-occ--guide \.lit-occ-tab:not\(#litOccTabPrepare\)/.test(SRC) && /\['guide', 'fa-book-open-reader', 'Preparation Guide'\]/.test(fn('renderService')));
  check('the tabs: Liturgy Order, Planning Notes, Special Planning, Checklist -- no Team Planning',
    /var SP_TABS = \[\['order', 'fa-list-ol', 'Liturgy Order'\], \['notes', 'fa-file-lines', 'Planning Notes'\],\r?\n\s*\['special', 'fa-wand-magic-sparkles', 'Special Planning'\], \['check', 'fa-square-check', 'Checklist'\]\];/.test(SRC) &&
    !/Team Planning/.test(fn('renderService')));
  check('the files open on Liturgy Documents', /res: _sp\.occ === occId \? _sp\.res : 'liturgy'/.test(fn('openService')) &&
    /var tab = groups\[_sp\.res\] \? _sp\.res : 'liturgy';/.test(fn('_spResHtml')) && /\[\['liturgy', 'fa-file-word', 'Liturgy Documents'\], \['lcd'/.test(fn('_spResHtml')));
  check('reference links are a group of their own', /return 'links';/.test(fn('_spKind')) && /\['links', 'fa-link', 'Reference Links'\]/.test(fn('_spResHtml')));
  check('a task says who does it, from the roster\'s names', /who: _plVal\('plWho'\) \|\| null/.test(fn('plSaveTask')) && /list="plWhoEd"/.test(fn('plEditTask')) &&
    /d\.people/.test(fn('_plWhoList')));
  check('...and the page has no other element called plWho (it once had, and the editor read that instead)', !/id="plWho"/.test(fn('_plCheckTab')));
  check('a special item keeps its references and the performance', /links\.push\(\{ kind: 'performance', url: perf, label: 'Performance' \}\)/.test(fn('plSaveSpecial')) &&
    /files: ed\.files/.test(fn('plSaveSpecial')));
  check('uploads for an item nobody saved are taken away again', /if \(_plEd && _plEd\.added && _plEd\.added\.length && !_plEd\.saved\)/.test(fn('plEdClose')));
  check('a note can give the checklist its tasks', /note_id: note\.id/.test(fn('plSaveNote')));
  check('a plan for another date, or copied from an earlier one', /_plCopyRows\(src, key, function\(\) \{ return _plId\(\); \}\)/.test(fn('plCopyFrom')) && /plDatePick/.test(fn('_plDateBar')));
  const mig = fs.existsSync(MIGRATION) ? fs.readFileSync(MIGRATION, 'utf8') : '';
  check('the migration makes the table, one row an entry, readable by the app',
    /create table if not exists public\.service_plan_items/.test(mig) && /service_key\s+text not null/.test(mig) && /kind\s+text not null/.test(mig) &&
    /create policy "anon_all_service_plan_items"/.test(mig));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
})();
