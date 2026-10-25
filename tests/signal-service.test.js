import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state/store.js';
import { createInitialState } from '../src/state/initialState.js';
import { createSignalService } from '../src/services/signalService.js';
import { resolveSignalConfig, DEFAULT_SIGNAL_URL } from '../src/domain/signals.js';
import * as cache from '../src/storage/localCache.js';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const sig = (id, at = NOW, o = {}) => ({ id, x: 92, y: 120, at, expiresAt: at + 30 * MIN, ...o });

function rig({ enabled = true, saved = { listening: false, listenerId: null, mine: null }, gpsFix = { lat: 7.005, lng: -73.064 }, gpsError = null, serverSignals = [], sendResult } = {}) {
  const store = createStore(createInitialState());
  const calls = [];
  const wrote = [];
  let signals = [...serverSignals];
  const api = {
    enabled,
    state: async () => { calls.push('state'); return { ok: true, data: { signals, listeners: 2, now: NOW } }; },
    poll: async ({ listening }) => { calls.push(listening ? 'poll' : 'leave'); return { ok: true, data: { signals, listeners: listening ? 3 : 2, now: NOW } }; },
    send: async (p) => { calls.push(['send', p]); return sendResult ?? { ok: true, data: { id: 'mia1', cancelToken: 'tok-secreto', expiresAt: NOW + 30 * MIN, listeners: 2 } }; },
    cancel: async (p) => { calls.push(['cancel', p]); return { ok: true, data: {} }; }
  };
  const gps = { fix: () => gpsFix, read: async () => gpsFix, error: () => gpsError };
  const fresh = [];
  const feeds = [];
  const service = createSignalService({
    store, api, gps, now: () => NOW,
    prefs: { read: () => saved, write: (p) => wrote.push(p) },
    onNew: (s) => fresh.push(s.map((x) => x.id)),
    makeFeed: (opts) => {
      const real = import('../src/services/signalFeed.js').then((m) => m.createSignalFeed);
      const timers = [];
      const feed = { opts, listening: false, calls: [] };
      feeds.push(feed);
      return {
        refresh: async () => { const r = await api.state(); if (r.ok) { opts.onUpdate({ signals: r.data.signals, listeners: r.data.listeners }); } return r; },
        setListening: async (v) => { feed.listening = v; if (v) { const r = await api.poll({ listening: true }); opts.onUpdate({ signals: r.data.signals, listeners: r.data.listeners }); } else await api.poll({ listening: false }); },
        stop: () => {}
      };
    }
  });
  return { store, service, calls, wrote, fresh, feeds, setServer: (s) => { signals = s; }, state: () => store.get().signals };
}

// ---------- configuration ----------

test('resolveSignalConfig: the published site uses the real server; only `vite dev` uses the local one (the real one does not accept localhost)', () => {
  assert.deepEqual(resolveSignalConfig({ hostname: 'xthecapx.github.io' }), { baseUrl: DEFAULT_SIGNAL_URL });
  assert.equal(DEFAULT_SIGNAL_URL, 'https://days-signal.xthecapx.workers.dev/');
  assert.deepEqual(resolveSignalConfig({ dev: true, hostname: 'localhost' }), { baseUrl: 'http://localhost:8787/' });
  assert.deepEqual(resolveSignalConfig({ dev: true, hostname: '192.168.68.54' }), { baseUrl: 'http://192.168.68.54:8787/' }, 'from the phone, the local server on your computer');
});

test('resolveSignalConfig: there are no rooms or test mode; the result only carries the URL', () => {
  for (const cfg of [resolveSignalConfig({}), resolveSignalConfig({ dev: true }), resolveSignalConfig({ override: { baseUrl: 'https://x.example', room: 'dev' } })]) {
    assert.deepEqual(Object.keys(cfg), ['baseUrl']);
  }
});

test('resolveSignalConfig: an override with an empty URL turns the feature off; with a URL, it replaces it', () => {
  assert.equal(resolveSignalConfig({ override: { baseUrl: '' } }).baseUrl, '');
  assert.equal(resolveSignalConfig({ override: { baseUrl: '  https://x.example/ ' } }).baseUrl, 'https://x.example/');
  assert.deepEqual(resolveSignalConfig({ override: null, hostname: 'xthecapx.github.io' }), resolveSignalConfig({ hostname: 'xthecapx.github.io' }));
});

// ---------- browser preferences ----------

function fakeStorage(initial = {}) {
  const mem = new Map(Object.entries(initial));
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  return mem;
}

test('prefs: with nothing saved they return the neutral value; saving and reading round-trips', () => {
  fakeStorage();
  assert.deepEqual(cache.readSignalPrefs(), { listening: false, listenerId: null, mine: null });
  assert.equal(cache.writeSignalPrefs({ listening: true, listenerId: 'oyente-abc123', mine: { id: 'a', token: 't', expiresAt: 5 } }), true);
  assert.deepEqual(cache.readSignalPrefs(), { listening: true, listenerId: 'oyente-abc123', mine: { id: 'a', token: 't', expiresAt: 5 } });
});

test('prefs: corrupted or tampered data breaks nothing', () => {
  fakeStorage({ vecinos_rio_hato_signal_v1: '{no es json' });
  assert.deepEqual(cache.readSignalPrefs(), { listening: false, listenerId: null, mine: null });
  fakeStorage({ vecinos_rio_hato_signal_v1: JSON.stringify({ listening: 'si', listenerId: '<script>', mine: { id: 5, token: {}, expiresAt: 'x' } }) });
  assert.deepEqual(cache.readSignalPrefs(), { listening: false, listenerId: null, mine: null });
});

test('prefs: with localStorage blocked it does not throw', () => {
  const boom = () => { throw new Error('modo privado'); };
  globalThis.localStorage = { getItem: boom, setItem: boom, removeItem: boom };
  const warn = console.warn; console.warn = () => {};
  assert.deepEqual(cache.readSignalPrefs(), { listening: false, listenerId: null, mine: null });
  assert.equal(cache.writeSignalPrefs({ listening: true }), false);
  assert.equal(cache.readSignalOverride(), null);
  console.warn = warn;
});

// ---------- the service ----------

test('startup: a single read, no polling, and the feature ends up enabled', async () => {
  const r = rig({ serverSignals: [sig('a')] });
  await r.service.start();
  assert.deepEqual(r.calls, ['state']);
  assert.equal(r.state().enabled, true);
  assert.equal(r.state().active.length, 1);
  assert.equal(r.state().listeners, 2);
  assert.equal(r.state().loaded, true);
  assert.equal(r.state().listening, false);
});

test('with no server configured it makes no request and ends up disabled', async () => {
  const r = rig({ enabled: false });
  await r.service.start();
  await r.service.setListening(true);
  assert.deepEqual(await r.service.send(), { ok: false, error: 'not_configured' });
  assert.deepEqual(r.calls, []);
  assert.equal(r.state().enabled, false);
  assert.equal(r.state().listening, false);
});

test('listen: it turns on, is saved in the browser and resumes on reload', async () => {
  const r = rig();
  await r.service.start();
  await r.service.setListening(true);
  assert.equal(r.state().listening, true);
  assert.equal(r.wrote.at(-1).listening, true);
  assert.ok(r.calls.includes('poll'));
  // "reload": new instance with what was saved
  const again = rig({ saved: r.wrote.at(-1) });
  await again.service.start();
  assert.equal(again.state().listening, true);
  assert.deepEqual(again.calls, ['state', 'poll']);
  assert.equal(again.service.listenerId, r.service.listenerId, 'same listener identity after reloading');
});

test('stopping listening notifies the server and is remembered', async () => {
  const r = rig();
  await r.service.setListening(true);
  await r.service.setListening(false);
  assert.equal(r.state().listening, false);
  assert.equal(r.calls.at(-1), 'leave');
  assert.equal(r.wrote.at(-1).listening, false);
});

test('the listener id is random, meets what the server requires and is reused', () => {
  const a = rig(); const b = rig();
  assert.match(a.service.listenerId, /^[A-Za-z0-9_-]{8,64}$/);
  assert.notEqual(a.service.listenerId, b.service.listenerId);
  assert.equal(a.wrote[0].listenerId, a.service.listenerId, 'it is saved from the very first moment');
  assert.equal(rig({ saved: { listening: false, listenerId: 'guardado-xyz123', mine: null } }).service.listenerId, 'guardado-xyz123');
});

test('send: uses the GPS position, stores the cancel token and does NOT expose it in the state', async () => {
  const r = rig();
  const res = await r.service.send();
  assert.equal(res.ok, true);
  assert.deepEqual(r.calls[0], ['send', { lat: 7.005, lng: -73.064 }]);
  assert.deepEqual(r.state().mine, { id: 'mia1', expiresAt: NOW + 30 * MIN });
  assert.doesNotMatch(JSON.stringify(r.store.get()), /tok-secreto/, 'the token only lives in the browser, not in the screen state');
  assert.equal(r.wrote.at(-1).mine.token, 'tok-secreto');
});

test('send without a location: nothing is sent and the reason is explained', async () => {
  const none = rig({ gpsFix: null, gpsError: 'timeout' });
  assert.deepEqual(await none.service.send(), { ok: false, error: 'no_gps' });
  assert.equal(none.calls.length, 0);
  assert.deepEqual(await rig({ gpsFix: null, gpsError: 'denied' }).service.send(), { ok: false, error: 'gps_denied' });
});

test('send with a server error: the error is returned and no own signal is saved', async () => {
  const r = rig({ sendResult: { ok: false, status: 422, error: 'outside_area' } });
  const res = await r.service.send();
  assert.deepEqual([res.ok, res.error], [false, 'outside_area']);
  assert.equal(r.state().mine, null);
  assert.equal(r.wrote.at(-1).mine, null);
});

test('cancel: withdraws my signal with its token; with no own signal it does nothing', async () => {
  const r = rig();
  assert.deepEqual(await r.service.cancel(), { ok: false, error: 'nothing_to_cancel' });
  await r.service.send();
  const res = await r.service.cancel();
  assert.equal(res.ok, true);
  assert.deepEqual(r.calls.find((c) => c[0] === 'cancel'), ['cancel', { id: 'mia1', token: 'tok-secreto' }]);
  assert.equal(r.state().mine, null);
  assert.equal(r.wrote.at(-1).mine, null);
});

test('my saved signal is recovered on reload if still valid, and discarded if it expired', () => {
  const live = rig({ saved: { listening: false, listenerId: 'guardado-xyz123', mine: { id: 'a', token: 't', expiresAt: NOW + MIN } } });
  assert.deepEqual(live.state().mine, { id: 'a', expiresAt: NOW + MIN });
  const dead = rig({ saved: { listening: false, listenerId: 'guardado-xyz123', mine: { id: 'a', token: 't', expiresAt: NOW - 1 } } });
  assert.equal(dead.state().mine, null);
  assert.equal(dead.wrote.at(-1).mine, null, 'and it is removed from what was saved');
});

test('my own signal does not trigger the "alguien pidió ayuda" alert', async () => {
  const r = rig();
  await r.service.send();
  const handler = r.feeds[0].opts.onNew;
  handler([sig('mia1'), sig('otra')], {});
  assert.deepEqual(r.fresh, [['otra']]);
});

test('the polling connection status reaches the screen state', () => {
  const r = rig();
  r.feeds[0].opts.onStatus('error');
  assert.equal(r.state().status, 'error');
});
