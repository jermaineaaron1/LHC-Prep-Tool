#!/usr/bin/env node
'use strict';
// songbook-phone-harness.js
//
// The songbook's Phone view opens a SECOND COPY of the whole app inside a
// panel, so a desk user can see the song as a phone shows it. That copy
// runs every line of the app -- its boot, its autosaves, its save-on-close
// guard, its presence on the songbook's channel -- against REAL production
// data. The head of Index.html turns it read-only before any of that runs.
// This harness slices those guards out and proves each one holds:
//
//   the database   insert / upsert / update / delete and rpc never reach
//                  the client; reads still do
//   storage        uploads and removals never reach it, through the
//                  getter supabase-js hands out a fresh client from
//   realtime       broadcasts and presence never leave; listening works
//   the network    nothing but GET and HEAD goes out (and the two storage
//                  reads that are POSTs)
//   this browser   settings the copy saves stay in the copy
//
//   node tools/songbook-phone-harness.js
//   node tools/songbook-phone-harness.js <file> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
const lines = fs.readFileSync(INDEX, 'utf8').split('\n');

function extract(pattern, name) {
  const startIdx = lines.findIndex(l => pattern.test(l));
  if (startIdx < 0) throw new Error('not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('no close for ' + name);
}

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log((ok ? '  ok    ' : '  FAIL  ') + label);
  if (!ok) {
    console.log('          got  ' + JSON.stringify(got));
    console.log('          want ' + JSON.stringify(want));
  }
}

let G;
try {
  const src = [
    [/^    function _lhcDenied\(/, '_lhcDenied'],
    [/^    function _lhcReadOnlyClient\(/, '_lhcReadOnlyClient'],
    [/^    function _lhcFetchGuard\(/, '_lhcFetchGuard'],
    [/^    function _lhcStorageOverlay\(/, '_lhcStorageOverlay']
  ].map(([re, n]) => extract(re, n)).join('\n');
  G = new Function(src + '\nreturn { denied: _lhcDenied, client: _lhcReadOnlyClient, fetch: _lhcFetchGuard, storage: _lhcStorageOverlay };')();
} catch (e) {
  if (EXPECT_BROKEN) { console.log('--expect-broken: ' + e.message + ', as expected.'); process.exit(0); }
  throw e;
}
if (EXPECT_BROKEN) { console.log('\nBUT --expect-broken was given and the guards are present.'); process.exit(1); }

(async function main() {
  // A stand-in for a supabase-js client that records every call that
  // would have gone to the server.
  const sent = [];
  function builder(table) {
    const b = {};
    ['select', 'insert', 'upsert', 'update', 'delete'].forEach(m => {
      b[m] = function() { sent.push(table + '.' + m); return { eq() { return this; }, select() { return this; }, then(r) { return Promise.resolve({ data: [], error: null }).then(r); } }; };
    });
    return b;
  }
  class FakeClient {
    from(t) { return builder(t); }
    rpc(fn) { sent.push('rpc.' + fn); return Promise.resolve({ data: 1, error: null }); }
    channel(name) {
      return {
        on() { sent.push('on.' + name); return this; },
        subscribe() { sent.push('subscribe.' + name); return this; },
        send() { sent.push('send.' + name); return Promise.resolve('ok'); },
        track() { sent.push('track.' + name); return Promise.resolve('ok'); },
        untrack() { sent.push('untrack.' + name); return Promise.resolve('ok'); }
      };
    }
    get storage() {   // like supabase-js: a new storage client on every read
      return { from(b) { return {
        upload() { sent.push('upload.' + b); return Promise.resolve({ data: {}, error: null }); },
        remove() { sent.push('remove.' + b); return Promise.resolve({ data: {}, error: null }); },
        getPublicUrl(p) { return { data: { publicUrl: 'https://x/' + b + '/' + p } }; },
        list() { sent.push('list.' + b); return Promise.resolve({ data: [], error: null }); }
      }; } };
    }
  }
  const c = G.client(new FakeClient());

  console.log('\nthe database: reads go, writes do not');
  await c.from('songs').select('*');
  check('a read reaches the client', sent.slice(), ['songs.select']);
  sent.length = 0;
  const r1 = await c.from('song_marks').insert({ a: 1 }).select();
  const r2 = await c.from('order_items').upsert({}).eq('id', 1);
  const r3 = await c.from('orders').update({}).eq('id', 1).select().single();
  const r4 = await c.from('song_marks').delete().eq('id', 'x');
  const r5 = await c.rpc('anything');
  check('insert, upsert, update, delete and rpc never reach it', sent.slice(), []);
  check('  each settles to an error, so the caller takes its failure path', [r1, r2, r3, r4, r5].map(r => !!(r && r.error) && r.data === null), [true, true, true, true, true]);
  let caught = false; await c.from('x').insert({}).then(() => {}, () => { caught = true; });
  check('  and none of them throws', caught, false);

  console.log('\nstorage: through the getter, uploads and removals do not go');
  sent.length = 0;
  await c.storage.from('songbook').upload('a.wav', 'x');
  await c.storage.from('songbook').remove(['a.wav']);
  check('uploads and removals never reach it', sent.slice(), []);
  check('  a public URL is still there to read', c.storage.from('songbook').getPublicUrl('a.wav').data.publicUrl, 'https://x/songbook/a.wav');
  await c.storage.from('songbook').list();
  check('  and a listing still goes', sent.slice(), ['list.songbook']);

  console.log('\nrealtime: it listens, and says nothing');
  sent.length = 0;
  const ch = c.channel('sb-presence-1').on('broadcast', {}, () => {}).subscribe();
  const s1 = await ch.send({ type: 'broadcast', event: 'changed' });
  await ch.track({ key: 'k' }); await ch.untrack();
  check('listening and subscribing go through', sent.slice(), ['on.sb-presence-1', 'subscribe.sb-presence-1']);
  check('  a broadcast reports sent, and is not', s1, 'ok');

  console.log('\nthe network: GET and HEAD only');
  const gone = [];
  const f = G.fetch(function(u, init) { gone.push(((init && init.method) || 'GET') + ' ' + u); return Promise.resolve({ status: 200 }); });
  await f('https://db/rest/v1/songs?select=*');
  await f('https://db/rest/v1/songs?select=id', { method: 'HEAD' });
  await f('https://db/storage/v1/object/list/songbook', { method: 'POST' });
  const blocked = await Promise.all([
    f('https://db/rest/v1/song_marks', { method: 'POST' }),
    f('https://db/rest/v1/orders?id=eq.1', { method: 'PATCH' }),
    f('https://db/rest/v1/song_marks?id=eq.1', { method: 'DELETE' }),
    f('https://db/storage/v1/object/songbook/a.wav', { method: 'PUT' }),
    f('https://db/realtime/v1/api/broadcast', { method: 'POST' }),
    f({ url: 'https://db/rest/v1/rpc/x', method: 'POST' })
  ]);
  check('reads, a count and a storage listing go out', gone, ['GET https://db/rest/v1/songs?select=*', 'HEAD https://db/rest/v1/songs?select=id', 'POST https://db/storage/v1/object/list/songbook']);
  check('  a POST, PATCH, DELETE, PUT, broadcast or rpc does not', blocked.map(r => r.status), [403, 403, 403, 403, 403, 403]);

  console.log('\nthis browser: what the copy saves stays in the copy');
  const real = { lhc_sbm_scale: '1.3', lhc_sb_mypart: '{"last":"Men"}' };
  function Store() {}
  Store.prototype.getItem = function(k) { return Object.prototype.hasOwnProperty.call(real, k) ? real[k] : null; };
  Store.prototype.setItem = function(k, v) { real[k] = String(v); };
  Store.prototype.removeItem = function(k) { delete real[k]; };
  Store.prototype.key = function(i) { return Object.keys(real)[i]; };
  Object.defineProperty(Store.prototype, 'length', { get() { return Object.keys(real).length; } });
  const local = new Store(), session = new Store();
  G.storage(Store.prototype, st => st === session);
  check('it reads what the desk saved', local.getItem('lhc_sbm_scale'), '1.3');
  local.setItem('lhc_sbm_song_sb_1', 'sbsong_x_1');
  local.setItem('lhc_sbm_scale', '1');
  local.removeItem('lhc_sb_mypart');
  check('  it reads back what it saved itself', [local.getItem('lhc_sbm_song_sb_1'), local.getItem('lhc_sbm_scale'), local.getItem('lhc_sb_mypart')], ['sbsong_x_1', '1', null]);
  check('  and the browser\'s own storage is as it was', real, { lhc_sbm_scale: '1.3', lhc_sb_mypart: '{"last":"Men"}' });
  local.clear();
  check('  a clear clears only the copy\'s view of it', [local.getItem('lhc_sbm_scale'), Object.keys(real).length], [null, 2]);

  const failed = results.filter(r => !r).length;
  console.log('\n' + (failed ? failed + ' of ' + results.length + ' checks FAILED' : 'All ' + results.length + ' checks passed.'));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
