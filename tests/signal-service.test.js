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

function rig({ enabled = true, saved = { listening: false, listenerId: null }, serverSignals = [] } = {}) {
  const store = createStore(createInitialState(new Date(2026, 9, 23, 12)));
  const calls = [];
  const wrote = [];
  let signals = [...serverSignals];
  const api = {
    enabled,
    state: async () => { calls.push('state'); return { ok: true, data: { signals, listeners: 2, now: NOW } }; },
    poll: async ({ listening }) => { calls.push(listening ? 'poll' : 'leave'); return { ok: true, data: { signals, listeners: listening ? 3 : 2, now: NOW } }; }
  };
  const fresh = [];
  const feeds = [];
  const service = createSignalService({
    store, api, now: () => NOW,
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
  assert.deepEqual(cache.readSignalPrefs(), { listening: false, listenerId: null });
  assert.equal(cache.writeSignalPrefs({ listening: true, listenerId: 'oyente-abc123' }), true);
  assert.deepEqual(cache.readSignalPrefs(), { listening: true, listenerId: 'oyente-abc123' });
});

test('prefs: corrupted or tampered data breaks nothing', () => {
  fakeStorage({ vecinos_rio_hato_signal_v1: '{no es json' });
  assert.deepEqual(cache.readSignalPrefs(), { listening: false, listenerId: null });
  fakeStorage({ vecinos_rio_hato_signal_v1: JSON.stringify({ listening: 'si', listenerId: '<script>', mine: { id: 5, token: {}, expiresAt: 'x' } }) });
  assert.deepEqual(cache.readSignalPrefs(), { listening: false, listenerId: null });
});

test('prefs: with localStorage blocked it does not throw', () => {
  const boom = () => { throw new Error('modo privado'); };
  globalThis.localStorage = { getItem: boom, setItem: boom, removeItem: boom };
  const warn = console.warn; console.warn = () => {};
  assert.deepEqual(cache.readSignalPrefs(), { listening: false, listenerId: null });
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
  assert.equal(rig({ saved: { listening: false, listenerId: 'guardado-xyz123' } }).service.listenerId, 'guardado-xyz123');
});

test('the service cannot send or cancel alerts: alerts are sent from the phone, never from the app', () => {
  const r = rig();
  for (const gone of ['send', 'cancel']) assert.equal(gone in r.service, false, gone);
  assert.equal('mine' in r.state(), false, 'the app does not track "my" alert');
  assert.equal('send' in { ...rig().service }, false);
});

test('old saved preferences that still carry a "mine" alert are accepted and the field is dropped on the next save', () => {
  const r = rig({ saved: { listening: false, listenerId: 'guardado-xyz123', mine: { id: 'a', token: 'secreto-viejo', expiresAt: NOW + MIN } } });
  assert.equal('mine' in r.wrote.at(-1), false);
  assert.doesNotMatch(JSON.stringify(r.wrote), /secreto-viejo/, 'the old cancel token is not written back');
});

test('every alert triggers the "someone asked for help" notice (the app cannot tell who sent it)', () => {
  const r = rig();
  r.feeds[0].opts.onNew([sig('a'), sig('b')], {});
  assert.deepEqual(r.fresh, [['a', 'b']]);
});

test('the polling connection status reaches the screen state', () => {
  const r = rig();
  r.feeds[0].opts.onStatus('error');
  assert.equal(r.state().status, 'error');
});
