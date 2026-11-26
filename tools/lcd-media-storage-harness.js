'use strict';
// Harness for the LCD's media in Storage (2026-11-26, CLAUDE.md gotcha 119).
//
// WHY THIS EXISTS
// From the operator: "Can we establish a way to not minimize the storage in
// supabase. Especialy in the LCD function, when more videos, images and
// powerpoint files are stored, it will pile up quickly."
//
// A count of the bucket that day (198 MB, 700 files) found most of it was
// the app storing the same thing again, not the church adding things:
//   - 464 copies of about 31 pictures, 61 MB, none of them used. A tray drop
//     is a saveBackgrounds() per picture, and every call started a NEW
//     upload of every picture still waiting.
//   - a big picture's IndexedDB copy kept its base64 and no path after the
//     upload, and loadBackgrounds() prefers IndexedDB, so every reload
//     uploaded it again.
//   - the same deck five times, and its pages again for every order using
//     it, because every upload got a name of its own.
//   - photographs at camera size (7.7 MB the largest) for a 1920x1080 wall.
//
// The answer, all of it RUN here rather than matched:
//   1. uploadToSupabase(file, folder, { once: true }) stores a file under a
//      name made from its content, so the same file is kept once;
//   2. a file stored that way may be shared, and lhcDeleteUnlessShared asks
//      before deleting one;
//   3. saveBackgrounds() uploads each picture once, and the device's copies
//      agree afterwards (_bgMigrated, _bgMergeLocal, the shared index);
//   4. lhcProjectorPicture keeps a picture at the size a projector shows;
//   5. the LCD's ways in use all of it, and nothing else does -- every other
//      caller's clean-up deletes what it uploaded, and must keep its own copy.
//
// Source checks match STATEMENTS, never a word a comment might also use
// (CLAUDE.md gotcha 82).
//
// USAGE
//   node tools/lcd-media-storage-harness.js                 # ../Index.html
//   node tools/lcd-media-storage-harness.js path/to/file.html
//   node tools/lcd-media-storage-harness.js <file> --expect-broken
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}

const SRC = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
const top = name => {
  const m = SRC.match(new RegExp('\\nfunction ' + name + '\\([^)]*\\) \\{[^]*?\\n\\}'));
  return m ? m[0] : '';
};
const fn = name => {
  const m = SRC.match(new RegExp('\\n  function ' + name + '\\([^)]*\\) \\{[^]*?\\n  \\}'));
  return m ? m[0] : '';
};
const line = re => { const m = SRC.match(re); return m ? m[0] : ''; };

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}
const J = JSON.stringify;
const tick = () => new Promise(r => setTimeout(r, 0));

function blobOf(text, type, name) {
  const b = new Blob([text], { type: type || 'image/jpeg' });
  if (name) b.name = name;
  return b;
}

// A Storage bucket that keeps what it is given and refuses a name it has,
// the way Supabase does.
function fakeStorage() {
  const objects = {}, calls = [];
  const bucket = {
    upload(p, file, opts) {
      calls.push({ path: p, opts });
      if (objects[p]) return Promise.resolve({ data: null, error: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' } });
      objects[p] = { size: file.size, opts };
      return Promise.resolve({ data: { path: p }, error: null });
    },
    getPublicUrl(p) { return { data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/Liturgy Files/' + p } }; },
    remove() { return Promise.resolve({}); }
  };
  return { objects, calls, client: { storage: { from: () => bucket } } };
}

const UPLOAD_NAMES = ['uploadToSupabase', '_lhcUploadAt', '_lhcAlreadyStored', '_lhcFileExt', '_lhcOncePath', '_lhcIsOncePath', '_lhcContentPath'];
function uploadKit(sb, win) {
  const body = UPLOAD_NAMES.map(top).join('\n');
  return new Function('sb', 'window', 'console',
    "var LHC_SUPABASE_BUCKET = 'Liturgy Files';\nfunction getSupabaseClient() { return sb; }\n" + body +
    '\nreturn { upload: uploadToSupabase, ext: typeof _lhcFileExt === "function" ? _lhcFileExt : null,' +
    ' isOnce: typeof _lhcIsOncePath === "function" ? _lhcIsOncePath : null,' +
    ' stored: typeof _lhcAlreadyStored === "function" ? _lhcAlreadyStored : null };'
  )(sb, win, { error() {}, warn() {}, log() {} });
}

(async () => {
  // -------------------------------------------------------------------------
  // 1. A file is stored once, by its content
  // -------------------------------------------------------------------------
  console.log('1. uploadToSupabase(..., { once: true }) keeps the same file once');
  {
    const st = fakeStorage();
    const K = uploadKit(st.client, { crypto: webcrypto });
    const a1 = await K.upload(blobOf('PICTURE-ONE', 'image/jpeg', 'Sunrise.jpg'), 'orders/images', { once: true });
    const a2 = await K.upload(blobOf('PICTURE-ONE', 'image/jpeg', 'Sunrise.jpg'), 'orders/images', { once: true });
    check('the same picture twice is one stored file, under a name made from its content',
      a1.path === a2.path && /^orders\/images\/c_[0-9a-f]{32}\.jpg$/.test(a1.path) && Object.keys(st.objects).length === 1,
      J([a1, a2, Object.keys(st.objects)]));
    check('...the second answer is the same address, marked as already there, and no error',
      a2.url === a1.url && a2.existed === true && !a1.existed && !a2.error, J([a1, a2]));
    const a3 = await K.upload(blobOf('PICTURE-ONE', 'image/jpeg', 'Page_9.jpg'), 'orders/images', { once: true });
    check('...whatever it is called this time (a deck page is named for its section and order)',
      a3.path === a1.path, J(a3));
    const b1 = await K.upload(blobOf('PICTURE-TWO', 'image/jpeg', 'Sunrise.jpg'), 'orders/images', { once: true });
    check('a different picture with the same name is a file of its own', b1.path !== a1.path && Object.keys(st.objects).length === 2, J(b1));
    check('a file named by its content may be cached for a year', st.objects[a1.path].opts.cacheControl === '31536000' && st.objects[a1.path].opts.upsert === false,
      J(st.objects[a1.path].opts));

    const c1 = await K.upload(blobOf('PICTURE-ONE', 'image/jpeg', 'Sunrise.jpg'), 'song-docs');
    const c2 = await K.upload(blobOf('PICTURE-ONE', 'image/jpeg', 'Sunrise.jpg'), 'song-docs');
    check('without once, every upload still keeps a copy of its own, as before',
      /^song-docs\/\d+_Sunrise\.jpg$/.test(c1.path) && st.objects[c1.path] && st.objects[c1.path].opts.cacheControl === '3600' &&
      (c1.path !== c2.path || st.calls.filter(c => c.path === c1.path).length === 2), J([c1, c2]));

    const st2 = fakeStorage();
    st2.client.storage.from().upload = () => Promise.resolve({ data: null, error: { statusCode: '403', message: 'new row violates row-level security policy' } });
    const K2 = uploadKit(st2.client, { crypto: webcrypto });
    const d1 = await K2.upload(blobOf('X'), 'orders/images', { once: true });
    check('a refusal for any other reason is still a refusal', !!d1.error && !d1.url, J(d1));

    const st3 = fakeStorage();
    const K3 = uploadKit(st3.client, {});
    const e1 = await K3.upload(blobOf('PICTURE-ONE', 'image/jpeg', 'Sunrise.jpg'), 'orders/images', { once: true });
    check('a browser that cannot hash (no crypto.subtle off https) uploads as before, rather than not at all',
      /^orders\/images\/\d+_Sunrise\.jpg$/.test(e1.path || ''), J(e1));

    if (K.ext) {
      check('the stored name keeps the file\'s own extension, else its type\'s',
        J([K.ext('a.JPEG', 'image/jpeg'), K.ext('', 'image/jpeg'), K.ext('clip', 'video/quicktime'), K.ext('', ''), K.ext('Sermon.pptx', '')]) ===
        J(['jpg', 'jpg', 'mov', 'bin', 'pptx']));
    } else check('the stored name keeps the file\'s own extension, else its type\'s', false, '_lhcFileExt missing');
    if (K.isOnce) {
      check('a name made from content is told from one of the old kind',
        K.isOnce('orders/images/c_0123456789abcdef0123456789abcdef.jpg') === true &&
        K.isOnce('orders/images/1764000000000_Sunrise.jpg') === false &&
        K.isOnce('orders/images/c_short.jpg') === false);
    } else check('a name made from content is told from one of the old kind', false, '_lhcIsOncePath missing');
    if (K.stored) {
      check('"already exists" is read from the status or the words, whichever the client gives',
        K.stored({ statusCode: '409' }) && K.stored({ status: 409 }) && K.stored({ message: 'The resource already exists' }) &&
        !K.stored({ statusCode: '403', message: 'denied' }) && !K.stored(null));
    } else check('"already exists" is read from the status or the words', false, '_lhcAlreadyStored missing');
  }

  // -------------------------------------------------------------------------
  // 2. A shared file is deleted only once nothing uses it
  // -------------------------------------------------------------------------
  console.log('\n2. lhcDeleteUnlessShared');
  {
    const log = [];
    const src = top('lhcDeleteUnlessShared') + '\n' + top('_lhcIsOncePath');
    let D = null;
    try {
      D = new Function('log',
        "function getSupabaseClient() { return {}; }\nfunction deleteFromSupabase(p) { log.push(['direct', p]); }\n" +
        "function _deleteUnreferencedUploads(sb, paths) { log.push(['checked', paths[0]]); return Promise.resolve({ deleted: [], kept: paths }); }\n" +
        src + '\nreturn lhcDeleteUnlessShared;')(log);
    } catch (e) { D = null; }
    if (D) {
      const r1 = await D('orders/presentations/c_0123456789abcdef0123456789abcdef.pptx');
      const r2 = await D('orders/presentations/1764000000000_Sermon.pptx');
      check('a file stored by content goes through the reference check; one of the old kind goes at once',
        J(log) === J([['checked', 'orders/presentations/c_0123456789abcdef0123456789abcdef.pptx'], ['direct', 'orders/presentations/1764000000000_Sermon.pptx']]) &&
        r1 === false && r2 === true, J([log, r1, r2]));
    } else check('a file stored by content goes through the reference check', false, 'lhcDeleteUnlessShared missing');

    const del = fn('deleteBackground');
    check('removing a deck from the folder asks before deleting a shared file, after its record has left the shared index',
      /var _rowGone = _sbDeleteBackgroundFromSupabase\(bgId\);/.test(del) &&
      /if \(_goneFile && !_bgByPath\(_goneFile\)\) \{\n\s*Promise\.resolve\(_rowGone\)\.then\(function\(\) \{ return lhcDeleteUnlessShared\(_goneFile\); \}\)/.test(del) &&
      /if \(_p && typeof _lhcIsOncePath === 'function' && _lhcIsOncePath\(_p\)\) _goneFile = _p;/.test(del), del.slice(0, 200));
    check('...which means the shared index\'s delete hands back its promise',
      /return sb\.from\('lhc_backgrounds'\)\.delete\(\)\.eq\('id', bgId\)/.test(fn('_sbDeleteBackgroundFromSupabase')));
    const conv = (SRC.match(/\n    function _onConverted\(conv\) \{[^]*?\n    \}/) || [''])[0];
    check('a deck Google has converted is deleted only if nothing else uses it -- it is the folder\'s tile too',
      /if \(storagePath\) \{[^]*?lhcDeleteUnlessShared\(storagePath\);/.test(conv) && !/deleteFromSupabase\(storagePath\);/.test(conv));
  }

  // -------------------------------------------------------------------------
  // 3. saveBackgrounds uploads each picture once, and the device agrees after
  // -------------------------------------------------------------------------
  console.log('\n3. Each waiting picture is uploaded once');
  {
    const ups = [], shared = [], idbDel = [], idbPut = [];
    const store = {};
    const env = {
      uploads: ups, shared, idbDel, idbPut,
      ls: { setItem(k, v) { store[k] = v; }, getItem(k) { return store[k] || null; } }
    };
    const body = fn('saveBackgrounds') + '\n' + fn('_bgMigrated');
    const migVar = line(/\n  var _bgMigrating = \{\};/) || '\n  var _bgMigrating = {};';
    let S = null;
    try {
      S = new Function('env', 'atob', 'Blob', `
        var savedBackgrounds = [];
        var BG_STORAGE_KEY = 'lhc_bg';
        var localStorage = env.ls;
        var console = { log() {}, warn() {}, error() {} };
        function showToast() {}
        function saveBackgroundToIDB(bg) { env.idbPut.push(bg.id); return Promise.resolve(); }
        function deleteBackgroundFromIDB(id) { env.idbDel.push(id); return Promise.resolve(); }
        function _sbSaveBackgroundToSupabase(bg) { env.shared.push(bg.id); }
        function uploadToSupabase(blob, folder, opts) {
          var d = {}; d.p = new Promise(function(res, rej) { d.res = res; d.rej = rej; });
          env.uploads.push({ name: blob.name, folder: folder, opts: opts, d: d });
          return d.p;
        }
        ${migVar}
        ${body}
        return { save: saveBackgrounds, set: function(l) { savedBackgrounds = l; }, get: function() { return savedBackgrounds; } };
      `)(env, b => Buffer.from(b, 'base64').toString('binary'), Blob);
    } catch (e) { S = null; console.log('       (could not build: ' + e.message + ')'); }
    if (S) {
      const pic = (id, txt) => ({ id, type: 'image', name: id, data: 'data:image/jpeg;base64,' + Buffer.from(txt).toString('base64') });
      const list = [pic('bg_1', 'one'), pic('bg_2', 'two'), pic('bg_3', 'three')];
      S.set(list);
      // A tray drop of three pictures is three saves, and the page saves again
      // after -- all of it while the first uploads are still on their way.
      S.save(); S.save(); S.save(); S.save(); S.save();
      check('five saves while three pictures upload start three uploads, not fifteen', ups.length === 3, ups.length);
      check('...each by its content', ups.every(u => u.opts && u.opts.once === true), J(ups.map(u => u.opts)));
      ups.forEach((u, i) => u.d.res({ url: 'https://x/c_' + i + '.jpg', path: 'orders/images/c_' + i + '.jpg' }));
      await tick(); await tick();
      check('every picture then carries its stored address and is shared once',
        list.every((b, i) => b.storagePath === 'orders/images/c_' + i + '.jpg' && b.data === 'https://x/c_' + i + '.jpg') &&
        J(shared) === J(['bg_1', 'bg_2', 'bg_3']), J([list, shared]));
      check('...localStorage holds them uploaded, and the stale IndexedDB copies are taken out',
        JSON.parse(store.lhc_bg || '[]').filter(b => b.storagePath).length === 3 && J(idbDel) === J(['bg_1', 'bg_2', 'bg_3']), J([store.lhc_bg, idbDel]));
      S.save();
      check('a save after that uploads nothing again', ups.length === 3, ups.length);

      // A failed upload is tried again by the next save, once.
      const ups0 = ups.length;
      const failing = pic('bg_4', 'four');
      list.push(failing);
      S.save(); S.save();
      check('a picture added later uploads once', ups.length === ups0 + 1, ups.length - ups0);
      ups[ups.length - 1].d.rej(new Error('offline'));
      await tick(); await tick();
      S.save(); S.save();
      check('...and once more after its upload failed, not never', ups.length === ups0 + 2, ups.length - ups0);

      // A picture deleted while its upload was out is not brought back.
      const shared0 = shared.length;
      S.set(list.filter(b => b.id !== 'bg_4'));
      ups[ups.length - 1].d.res({ url: 'https://x/c_4.jpg', path: 'orders/images/c_4.jpg' });
      await tick(); await tick();
      check('a picture deleted while it uploaded is not shared afterwards', shared.length === shared0, J(shared));

      // localStorage full: the IndexedDB copy is written over, not deleted.
      const del0 = idbDel.length;
      env.ls.setItem = () => { throw new Error('QuotaExceededError'); };
      const big = pic('bg_5', 'five');
      S.set([big]);
      S.save();
      ups[ups.length - 1].d.res({ url: 'https://x/c_5.jpg', path: 'orders/images/c_5.jpg' });
      await tick(); await tick();
      check('with localStorage full, the IndexedDB copy is written over with the uploaded one, never just deleted',
        idbDel.length === del0 && idbPut.indexOf('bg_5') !== -1, J([idbDel, idbPut]));
    } else check('saveBackgrounds can be run', false);

    // The device's two copies, merged.
    const mergeSrc = fn('_bgMergeLocal');
    if (mergeSrc) {
      const M = new Function(mergeSrc + '\nreturn _bgMergeLocal;')();
      const stale = { id: 'a', data: 'data:image/jpeg;base64,AAAA' };
      const up = { id: 'a', data: 'https://x/c.jpg', storagePath: 'orders/images/c.jpg' };
      const r = M([stale, { id: 'v', type: 'video', data: 'data:video/mp4;base64,BB' }], [up, { id: 'b', data: 'https://x/b.jpg', storagePath: 'p/b' }]);
      check('a stale IndexedDB copy gives way to the uploaded one localStorage holds, and is named to be deleted',
        J(r.list.map(b => b.id + ':' + (b.storagePath || '-'))) === J(['a:orders/images/c.jpg', 'v:-', 'b:p/b']) && J(r.stale) === J(['a']), J(r));
      const r2 = M([{ id: 'a', storagePath: 'x', data: 'https://x' }], [{ id: 'a', data: 'old' }]);
      check('...and otherwise IndexedDB wins, as it always did', r2.list.length === 1 && r2.list[0].storagePath === 'x' && r2.stale.length === 0, J(r2));
    } else check('_bgMergeLocal exists', false);
    check('loadBackgrounds merges through it and deletes what it names',
      /var merged = _bgMergeLocal\(idbBackgrounds, lsBackgrounds\);/.test(fn('loadBackgrounds')) &&
      /merged\.stale\.forEach\(function\(id\) \{ deleteBackgroundFromIDB\(id\)/.test(fn('loadBackgrounds')));
    check('the shared index heals a device still holding a stored picture\'s base64, without sharing it again',
      /_bgMigrated\(mine, \{ url: rowb\.url, path: rowb\.storage_path \}, true\);/.test(fn('loadBackgroundsFromSupabase')) &&
      /if \(!known\) _sbSaveBackgroundToSupabase\(bg\);/.test(fn('_bgMigrated')));
  }

  // -------------------------------------------------------------------------
  // 4. Pictures at projector size
  // -------------------------------------------------------------------------
  console.log('\n4. lhcProjectorPicture keeps a picture at the size a projector shows');
  {
    const consts = (SRC.match(/\nvar LHC_PROJ_W = [^\n]*\nvar LHC_PROJ_KEEP_UNDER = [^\n]*/) || [''])[0];
    const scaleSrc = top('_lhcCoverScale');
    let scale = null;
    try { scale = new Function(consts + '\n' + scaleSrc + '\nreturn _lhcCoverScale;')(); } catch (e) { scale = null; }
    if (scale) {
      const dims = (w, h) => { const s = scale(w, h); return [Math.round(w * s), Math.round(h * s)]; };
      check('a 4000x3000 photograph becomes 1920x1440 -- the least that still covers a 1920x1080 wall',
        J(dims(4000, 3000)) === J([1920, 1440]), J(dims(4000, 3000)));
      check('...a portrait one keeps its whole width (a background is drawn to cover)', J(dims(3000, 4000)) === J([1920, 2560]), J(dims(3000, 4000)));
      check('...a panorama keeps its height', J(dims(8000, 2000)) === J([4320, 1080]), J(dims(8000, 2000)));
      check('...and nothing is ever made bigger', scale(1280, 720) === 1 && scale(1920, 1080) === 1 && scale(0, 0) === 1);
    } else check('_lhcCoverScale exists', false);

    // The whole thing, with a browser's Image and canvas stood in for.
    function pictureKit(o) {
      const made = [];
      class FakeImage {
        set src(v) {
          this._src = v;
          setTimeout(() => {
            if (o.decodeFails) { this.onerror && this.onerror(); return; }
            this.naturalWidth = o.w; this.naturalHeight = o.h; this.onload && this.onload();
          }, 0);
        }
      }
      const doc = {
        createElement() {
          const c = {
            width: 0, height: 0,
            getContext() {
              return {
                drawImage() {},
                getImageData(x, y, w, h) {
                  const d = new Uint8ClampedArray(16).fill(255);
                  if (o.alpha) d[7] = 0;
                  return { data: d };
                }
              };
            },
            toBlob(cb, type, q) {
              made.push({ w: c.width, h: c.height, type, q });
              setTimeout(() => cb(new Blob([new Uint8Array(o.outSize)], { type })), 0);
            }
          };
          return c;
        }
      };
      const body = (SRC.match(/\nvar LHC_PROJ_W = [^\n]*\nvar LHC_PROJ_KEEP_UNDER = [^\n]*/) || [''])[0] + '\n' +
        top('_lhcCoverScale') + '\n' + top('lhcProjectorPicture') + '\n' + top('_lhcHasAlpha');
      const P = new Function('Image', 'document', 'URL', 'File', body + '\nreturn lhcProjectorPicture;')(
        FakeImage, doc, { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, File);
      return { P, made };
    }
    const file = (size, type, name) => new File([new Uint8Array(size)], name, { type });
    let ok = !!top('lhcProjectorPicture');
    if (ok) {
      let k = pictureKit({ w: 4000, h: 3000, outSize: 400000 });
      let f = file(5000000, 'image/jpeg', 'Sunrise.jpg');
      let out = await k.P(f);
      check('a 5MB camera photograph goes in as a 1920x1440 JPEG at 0.85',
        out !== f && out.type === 'image/jpeg' && out.name === 'Sunrise.jpg' && out.size === 400000 &&
        J(k.made) === J([{ w: 1920, h: 1440, type: 'image/jpeg', q: 0.85 }]), J([out.name, out.type, out.size, k.made]));

      k = pictureKit({ w: 1280, h: 720, outSize: 100 });
      f = file(300000, 'image/jpeg', 'small.jpg');
      out = await k.P(f);
      check('a picture already within the size and small is left exactly as it came', out === f && k.made.length === 0);

      k = pictureKit({ w: 1920, h: 1080, outSize: 500000 });
      f = file(3000000, 'image/png', 'Slide.png');
      out = await k.P(f);
      check('a 3MB 1920x1080 PNG with nothing see-through goes in as a JPEG', out !== f && out.type === 'image/jpeg' && out.name === 'Slide.jpg', J([out.type, out.name]));

      k = pictureKit({ w: 4000, h: 2000, outSize: 900000, alpha: true });
      f = file(4000000, 'image/png', 'Logo.png');
      out = await k.P(f);
      check('...one with see-through parts stays a PNG', out.type === 'image/png' && out.name === 'Logo.png' && k.made[0].type === 'image/png', J([out.type, k.made]));

      k = pictureKit({ w: 4000, h: 3000, outSize: 6000000 });
      f = file(5000000, 'image/jpeg', 'tight.jpg');
      out = await k.P(f);
      check('a re-encode that comes out no smaller is thrown away', out === f);

      k = pictureKit({ w: 4000, h: 3000, outSize: 10, decodeFails: true });
      f = file(5000000, 'image/heic', 'IMG_0001.heic');
      out = await k.P(f);
      check('a picture the browser cannot decode goes in as it came', out === f);

      k = pictureKit({ w: 4000, h: 3000, outSize: 10 });
      const gif = file(5000000, 'image/gif', 'moving.gif'), vid = file(5000000, 'video/mp4', 'clip.mp4');
      check('an animated GIF and a video are never touched', (await k.P(gif)) === gif && (await k.P(vid)) === vid && k.made.length === 0);
    } else check('lhcProjectorPicture exists', false);
  }

  // -------------------------------------------------------------------------
  // 5. The LCD's ways in use it, and nothing else does
  // -------------------------------------------------------------------------
  console.log('\n5. Who stores by content');
  {
    const want = [
      ["the Add Media window's audio and video", "uploadToSupabase(file, 'orders/media', { once: true })"],
      ["a video put into a section", "uploadToSupabase(file, 'orders/videos', { once: true })"],
      ["a picture's base64 going up from the tray", "uploadToSupabase(blob, folder, { once: true })"],
      ["the Backgrounds library's Upload", "uploadToSupabase(file, supabaseFolder, { once: true })"],
      ["a deck or document imported into a section", "uploadToSupabase(file, _uploadFolder, { once: true })"],
      ["a deck's pages", "uploadToSupabase(blob, 'orders/documents', { once: true })"],
      ["a document added to the tray", "'orders/presentations' : 'orders/documents', { once: true })"]
    ];
    want.forEach(([what, stmt]) => check(what + ' is stored once', SRC.indexOf(stmt) !== -1, stmt));
    check("the Songbook projection's two background uploads are too, sized first",
      (SRC.match(/lhcProjectorPicture\(f\)\.then\(function\(pf\) \{ return uploadToSupabase\(pf, 'backgrounds', \{ once: true \}\); \}\)/g) || []).length === 2);
    const all = (SRC.match(/uploadToSupabase\([^()]*(?:\([^()]*\)[^()]*)*\{ once: true \}\)/g) || []).length;
    check('nothing else asks for it: every other clean-up deletes what it uploaded, and must keep a copy of its own',
      all === 9, all + ' callers');
    check("the song library's documents still keep their own copy", SRC.indexOf("uploadToSupabase(small, 'song-docs');") !== -1);

    check('the Backgrounds Upload sizes a picture BEFORE the size limit is asked',
      /\(isImage \? lhcProjectorPicture\(file\) : Promise\.resolve\(file\)\)\.then\(function\(sized\) \{\n\s*_bgUploadOne\(sized, mediaType\);/.test(fn('handleBackgroundUpload')) &&
      /if \(file\.size > maxSize\)/.test(fn('_bgUploadOne')) && !/if \(file\.size > maxSize\)/.test(fn('handleBackgroundUpload')));
    check('a picture put into the tray, or dropped on a slide, is sized before it is read',
      /\(mediaType === 'image' \? lhcProjectorPicture\(file\) : Promise\.resolve\(file\)\)\.then\(function\(sized\) \{\n\s*reader\.readAsDataURL\(sized\);/.test(fn('_lcdIngestTrayFile')) &&
      /\(mediaType === 'image' \? lhcProjectorPicture\(file\) : Promise\.resolve\(file\)\)\.then\(function\(sized\) \{\n\s*reader\.readAsDataURL\(sized\);/.test(fn('_lcdIngestDroppedFile')));
    check('pictures imported into a section are sized first, then the import runs once on them',
      /Promise\.all\(files\.map\(function\(f\) \{ return lhcProjectorPicture\(f\); \}\)\)\.then\(function\(sized\) \{\n\s*addSlidesFromFiles\(sectionId, sized, Object\.assign\(\{\}, opts, \{ _sized: true \}\)\);/.test(fn('addSlidesFromFiles')) &&
      /if \(!opts\._sized && /.test(fn('addSlidesFromFiles')));
  }

  // -------------------------------------------------------------------------
  // 6. One tile a stored file
  // -------------------------------------------------------------------------
  console.log('\n6. The same file added twice is one tile');
  {
    const toasts = [], ups = [];
    let saved = [];
    const body = fn('_bgByPath') + '\n' + fn('_lcdIngestTrayFile');
    let T = null;
    try {
      T = new Function('toasts', 'ups', `
        var savedBackgrounds = [];
        function showToast(m) { toasts.push(m); }
        function saveBackgrounds() {}
        function _sbSaveBackgroundToSupabase() {}
        function renderBackgroundLibrary() {}
        function _lcdRenderMediaTray() {}
        function lhcProjectorPicture(f) { return Promise.resolve(f); }
        function uploadToSupabase(file, folder, opts) { ups.push(opts); return Promise.resolve({ url: 'https://x/c_1.pptx', path: 'orders/presentations/c_1.pptx', existed: ups.length > 1 }); }
        ${body}
        return { add: _lcdIngestTrayFile, list: function() { return savedBackgrounds; } };
      `)(toasts, ups);
    } catch (e) { T = null; }
    if (T) {
      const deck = { name: 'Advent Sermon.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
      T.add(deck, 'presentation'); await tick(); await tick();
      T.add(deck, 'presentation'); await tick(); await tick();
      check('a deck added to the folder twice is one tile, and the second time says so',
        T.list().length === 1 && /is already in the folder/.test(toasts[toasts.length - 1]), J([T.list().length, toasts]));
    } else check('_lcdIngestTrayFile can be run', false);
    check('the Backgrounds Upload and the Songbook\'s add-to-tray keep to one tile too',
      /var same = _bgByPath\(result\.path\);\n\s*if \(same\) \{/.test(fn('_bgUploadOne')) &&
      /if \(storagePath && typeof _bgByPath === 'function' && _bgByPath\(storagePath\)\) return;/.test(fn('_sbAddToMediaTray')));
  }

  finish();
})().catch(e => {
  // Source without these functions throws part-way; that is a failure, not
  // a reason to stop counting.
  failed++;
  console.log('  FAIL the harness could not run to the end: ' + (e && e.message));
  finish();
});

function finish() {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (EXPECT_BROKEN) {
    if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
    console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
  }
  process.exit(failed ? 1 : 0);
}
