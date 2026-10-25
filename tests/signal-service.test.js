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

// ---------- configuración ----------

test('resolveSignalConfig: el sitio publicado usa el servidor real; solo `vite dev` usa el local (el real no acepta localhost)', () => {
  assert.deepEqual(resolveSignalConfig({ hostname: 'xthecapx.github.io' }), { baseUrl: DEFAULT_SIGNAL_URL });
  assert.equal(DEFAULT_SIGNAL_URL, 'https://days-signal.xthecapx.workers.dev/');
  assert.deepEqual(resolveSignalConfig({ dev: true, hostname: 'localhost' }), { baseUrl: 'http://localhost:8787/' });
  assert.deepEqual(resolveSignalConfig({ dev: true, hostname: '192.168.68.54' }), { baseUrl: 'http://192.168.68.54:8787/' }, 'desde el celular, el servidor local de tu computador');
});

test('resolveSignalConfig: no hay salas ni modo de pruebas; el resultado solo lleva la URL', () => {
  for (const cfg of [resolveSignalConfig({}), resolveSignalConfig({ dev: true }), resolveSignalConfig({ override: { baseUrl: 'https://x.example', room: 'dev' } })]) {
    assert.deepEqual(Object.keys(cfg), ['baseUrl']);
  }
});

test('resolveSignalConfig: un override con URL vacía apaga la función; con URL, la reemplaza', () => {
  assert.equal(resolveSignalConfig({ override: { baseUrl: '' } }).baseUrl, '');
  assert.equal(resolveSignalConfig({ override: { baseUrl: '  https://x.example/ ' } }).baseUrl, 'https://x.example/');
  assert.deepEqual(resolveSignalConfig({ override: null, hostname: 'xthecapx.github.io' }), resolveSignalConfig({ hostname: 'xthecapx.github.io' }));
});

// ---------- preferencias del navegador ----------

function fakeStorage(initial = {}) {
  const mem = new Map(Object.entries(initial));
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  return mem;
}

test('prefs: sin nada guardado devuelven el valor neutro; guardar y leer es ida y vuelta', () => {
  fakeStorage();
  assert.deepEqual(cache.readSignalPrefs(), { listening: false, listenerId: null, mine: null });
  assert.equal(cache.writeSignalPrefs({ listening: true, listenerId: 'oyente-abc123', mine: { id: 'a', token: 't', expiresAt: 5 } }), true);
  assert.deepEqual(cache.readSignalPrefs(), { listening: true, listenerId: 'oyente-abc123', mine: { id: 'a', token: 't', expiresAt: 5 } });
});

test('prefs: datos dañados o manipulados no rompen nada', () => {
  fakeStorage({ vecinos_rio_hato_signal_v1: '{no es json' });
  assert.deepEqual(cache.readSignalPrefs(), { listening: false, listenerId: null, mine: null });
  fakeStorage({ vecinos_rio_hato_signal_v1: JSON.stringify({ listening: 'si', listenerId: '<script>', mine: { id: 5, token: {}, expiresAt: 'x' } }) });
  assert.deepEqual(cache.readSignalPrefs(), { listening: false, listenerId: null, mine: null });
});

test('prefs: con localStorage bloqueado no lanza', () => {
  const boom = () => { throw new Error('modo privado'); };
  globalThis.localStorage = { getItem: boom, setItem: boom, removeItem: boom };
  const warn = console.warn; console.warn = () => {};
  assert.deepEqual(cache.readSignalPrefs(), { listening: false, listenerId: null, mine: null });
  assert.equal(cache.writeSignalPrefs({ listening: true }), false);
  assert.equal(cache.readSignalOverride(), null);
  console.warn = warn;
});

// ---------- el servicio ----------

test('arranque: una sola lectura, sin sondeo, y la función queda habilitada', async () => {
  const r = rig({ serverSignals: [sig('a')] });
  await r.service.start();
  assert.deepEqual(r.calls, ['state']);
  assert.equal(r.state().enabled, true);
  assert.equal(r.state().active.length, 1);
  assert.equal(r.state().listeners, 2);
  assert.equal(r.state().loaded, true);
  assert.equal(r.state().listening, false);
});

test('sin servidor configurado no hace ninguna petición y queda deshabilitada', async () => {
  const r = rig({ enabled: false });
  await r.service.start();
  await r.service.setListening(true);
  assert.deepEqual(await r.service.send(), { ok: false, error: 'not_configured' });
  assert.deepEqual(r.calls, []);
  assert.equal(r.state().enabled, false);
  assert.equal(r.state().listening, false);
});

test('escuchar: se activa, se guarda en el navegador y se retoma al recargar', async () => {
  const r = rig();
  await r.service.start();
  await r.service.setListening(true);
  assert.equal(r.state().listening, true);
  assert.equal(r.wrote.at(-1).listening, true);
  assert.ok(r.calls.includes('poll'));
  // "recarga": nueva instancia con lo guardado
  const again = rig({ saved: r.wrote.at(-1) });
  await again.service.start();
  assert.equal(again.state().listening, true);
  assert.deepEqual(again.calls, ['state', 'poll']);
  assert.equal(again.service.listenerId, r.service.listenerId, 'misma identidad de oyente tras recargar');
});

test('dejar de escuchar avisa al servidor y se recuerda', async () => {
  const r = rig();
  await r.service.setListening(true);
  await r.service.setListening(false);
  assert.equal(r.state().listening, false);
  assert.equal(r.calls.at(-1), 'leave');
  assert.equal(r.wrote.at(-1).listening, false);
});

test('el identificador de oyente es aleatorio, cumple lo que pide el servidor y se reutiliza', () => {
  const a = rig(); const b = rig();
  assert.match(a.service.listenerId, /^[A-Za-z0-9_-]{8,64}$/);
  assert.notEqual(a.service.listenerId, b.service.listenerId);
  assert.equal(a.wrote[0].listenerId, a.service.listenerId, 'se guarda desde el primer momento');
  assert.equal(rig({ saved: { listening: false, listenerId: 'guardado-xyz123', mine: null } }).service.listenerId, 'guardado-xyz123');
});

test('enviar: usa la posición del GPS, guarda el token para cancelar y NO lo expone en el estado', async () => {
  const r = rig();
  const res = await r.service.send();
  assert.equal(res.ok, true);
  assert.deepEqual(r.calls[0], ['send', { lat: 7.005, lng: -73.064 }]);
  assert.deepEqual(r.state().mine, { id: 'mia1', expiresAt: NOW + 30 * MIN });
  assert.doesNotMatch(JSON.stringify(r.store.get()), /tok-secreto/, 'el token solo vive en el navegador, no en el estado de la pantalla');
  assert.equal(r.wrote.at(-1).mine.token, 'tok-secreto');
});

test('enviar sin ubicación: no se manda nada y se explica por qué', async () => {
  const none = rig({ gpsFix: null, gpsError: 'timeout' });
  assert.deepEqual(await none.service.send(), { ok: false, error: 'no_gps' });
  assert.equal(none.calls.length, 0);
  assert.deepEqual(await rig({ gpsFix: null, gpsError: 'denied' }).service.send(), { ok: false, error: 'gps_denied' });
});

test('enviar con error del servidor: se devuelve el error y no se guarda ninguna señal propia', async () => {
  const r = rig({ sendResult: { ok: false, status: 422, error: 'outside_area' } });
  const res = await r.service.send();
  assert.deepEqual([res.ok, res.error], [false, 'outside_area']);
  assert.equal(r.state().mine, null);
  assert.equal(r.wrote.at(-1).mine, null);
});

test('cancelar: retira mi señal con su token; sin señal propia no hace nada', async () => {
  const r = rig();
  assert.deepEqual(await r.service.cancel(), { ok: false, error: 'nothing_to_cancel' });
  await r.service.send();
  const res = await r.service.cancel();
  assert.equal(res.ok, true);
  assert.deepEqual(r.calls.find((c) => c[0] === 'cancel'), ['cancel', { id: 'mia1', token: 'tok-secreto' }]);
  assert.equal(r.state().mine, null);
  assert.equal(r.wrote.at(-1).mine, null);
});

test('mi señal guardada se recupera al recargar si sigue vigente, y se descarta si venció', () => {
  const live = rig({ saved: { listening: false, listenerId: 'guardado-xyz123', mine: { id: 'a', token: 't', expiresAt: NOW + MIN } } });
  assert.deepEqual(live.state().mine, { id: 'a', expiresAt: NOW + MIN });
  const dead = rig({ saved: { listening: false, listenerId: 'guardado-xyz123', mine: { id: 'a', token: 't', expiresAt: NOW - 1 } } });
  assert.equal(dead.state().mine, null);
  assert.equal(dead.wrote.at(-1).mine, null, 'y se borra de lo guardado');
});

test('mi propia señal no dispara el aviso de "alguien pidió ayuda"', async () => {
  const r = rig();
  await r.service.send();
  const handler = r.feeds[0].opts.onNew;
  handler([sig('mia1'), sig('otra')], {});
  assert.deepEqual(r.fresh, [['otra']]);
});

test('el estado de conexión del sondeo llega al estado de la pantalla', () => {
  const r = rig();
  r.feeds[0].opts.onStatus('error');
  assert.equal(r.state().status, 'error');
});
