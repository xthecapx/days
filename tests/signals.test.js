import test from 'node:test';
import assert from 'node:assert/strict';
import { ageLabel, listenersLabel, sendHint, newSignals, isMine, isActive, normalizeSignals, newListenerId, apiErrorMessage } from '../src/domain/signals.js';
import { createSignalApi } from '../src/services/signalApi.js';
import { createSignalFeed, POLL_MS, BACKOFF_MS } from '../src/services/signalFeed.js';

const MIN = 60_000;
const sig = (id, at = 1000, o = {}) => ({ id, x: 92, y: 120, at, expiresAt: at + 30 * MIN, ...o });

// ---------- domain ----------

test('ageLabel: del "ahora" a las horas', () => {
  const now = 10 * 60 * MIN;
  assert.equal(ageLabel(now, now), 'hace un momento');
  assert.equal(ageLabel(now - 59_000, now), 'hace un momento');
  assert.equal(ageLabel(now - MIN, now), 'hace 1 min');
  assert.equal(ageLabel(now - 29 * MIN, now), 'hace 29 min');
  assert.equal(ageLabel(now - 60 * MIN, now), 'hace 1 h');
  assert.equal(ageLabel(now - 65 * MIN, now), 'hace 1 h 5 min');
  assert.equal(ageLabel(now + 5 * MIN, now), 'hace un momento', 'un reloj adelantado no da "hace -5 min"');
});

test('listenersLabel y sendHint: singular, plural y nadie', () => {
  assert.equal(listenersLabel(0), 'Nadie escucha ahora');
  assert.equal(listenersLabel(1), '1 vecino escucha');
  assert.equal(listenersLabel(3), '3 vecinos escuchan');
  for (const bad of [undefined, null, NaN, -4, 'x']) assert.equal(listenersLabel(bad), 'Nadie escucha ahora', String(bad));
  assert.match(sendHint(3), /3 vecinos escuchan y verán tu alerta/);
  assert.match(sendHint(0), /123/);
  assert.match(sendHint(0), /WhatsApp/);
});

test('newSignals, isMine, isActive', () => {
  assert.deepEqual(newSignals([sig('a'), sig('b')], new Set(['a'])).map((s) => s.id), ['b']);
  assert.equal(isMine(sig('a'), { id: 'a' }), true);
  assert.equal(isMine(sig('a'), { id: 'b' }), false);
  assert.equal(isMine(sig('a'), null), false);
  assert.equal(isActive({ expiresAt: 2000 }, 1999), true);
  assert.equal(isActive({ expiresAt: 2000 }, 2000), false);
  assert.equal(isActive(null, 0), false);
  assert.equal(isActive({ expiresAt: 'x' }, 0), false);
});

test('normalizeSignals: ordena, descarta lo malformado y no se rompe con basura', () => {
  const view = normalizeSignals({
    now: 5, listeners: 2.9,
    signals: [sig('viejo', 100), sig('nuevo', 900), { id: 5 }, { id: 'sinXY', at: 1 }, null, 'x', { id: 'f', x: 1.5, y: 2, at: 1 }, { id: 'ok', x: 1, y: 2, at: 500 }]
  });
  assert.deepEqual(view.signals.map((s) => s.id), ['nuevo', 'ok', 'viejo']);
  assert.equal(view.listeners, 2);
  assert.equal(view.serverNow, 5);
  assert.equal(view.signals.find((s) => s.id === 'ok').expiresAt, 500 + 30 * MIN, 'sin vencimiento: 30 min');
  for (const junk of [null, undefined, {}, [], 'x', { signals: 'no', listeners: 'no' }]) assert.deepEqual(normalizeSignals(junk), { signals: [], listeners: 0, serverNow: null });
});

test('newListenerId: 24 caracteres hex, distintos cada vez', () => {
  const a = newListenerId(); const b = newListenerId();
  assert.match(a, /^[0-9a-f]{24}$/);
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{8,64}$/, 'cumple lo que exige el servidor');
});

// ---------- api ----------

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
    return handler(url, init);
  };
  fn.calls = calls;
  return fn;
}
const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('api: sin URL configurada no hace nada y lo dice', async () => {
  const f = fakeFetch(() => { throw new Error('no debería llamar'); });
  for (const baseUrl of [undefined, '', 'no-es-url', null]) {
    const api = createSignalApi({ baseUrl, fetchImpl: f });
    assert.equal(api.enabled, false);
    assert.deepEqual(await api.state(), { ok: false, error: 'not_configured' });
  }
  assert.equal(f.calls.length, 0);
});

test('api: arma la URL con la sala, sin dobles barras, y manda JSON', async () => {
  const f = fakeFetch(() => reply(200, { ok: true, signals: [], listeners: 0 }));
  const api = createSignalApi({ baseUrl: 'https://s.example/', room: 'dev', fetchImpl: f });
  await api.state();
  await api.poll({ listener: 'abc12345', listening: true });
  await api.send({ lat: 7.005, lng: -73.064 });
  await api.cancel({ id: 'i', token: 't' });
  assert.deepEqual(f.calls.map((c) => [c.method, c.url]), [
    ['GET', 'https://s.example/state?room=dev'],
    ['POST', 'https://s.example/poll?room=dev'],
    ['POST', 'https://s.example/signal?room=dev'],
    ['POST', 'https://s.example/signal/cancel?room=dev']
  ]);
  assert.deepEqual(f.calls[1].body, { listener: 'abc12345', listening: true });
  assert.equal(f.calls[0].cache, 'no-store');
  assert.equal(f.calls[2].headers['Content-Type'], 'application/json');
});

test('api: errores del servidor, de red y de tiempo llegan como resultado, nunca lanzan', async () => {
  const mk = (handler) => createSignalApi({ baseUrl: 'https://s.example', fetchImpl: fakeFetch(handler), timeoutMs: 20 });
  assert.deepEqual(await mk(() => reply(422, { ok: false, code: 'outside_area', error: 'fuera' })).send({ lat: 1, lng: 1 }), { ok: false, status: 422, error: 'outside_area', message: 'fuera' });
  assert.equal((await mk(() => reply(429, null)).state()).error, 'rate_limited');
  assert.equal((await mk(() => reply(500, null)).state()).error, 'http_error');
  assert.equal((await mk(() => ({ ok: true, status: 200, json: async () => { throw new Error('html'); } })).state()).error, 'http_error', 'una página que no es JSON');
  assert.equal((await mk(() => { throw new TypeError('Failed to fetch'); }).state()).error, 'network');
  const slow = mk((_, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))));
  assert.equal((await slow.state()).error, 'timeout');
});

test('api: ok:false dentro de un 200 se trata como error', async () => {
  const api = createSignalApi({ baseUrl: 'https://s.example', fetchImpl: fakeFetch(() => reply(200, { ok: false, code: 'x' })) });
  assert.equal((await api.state()).ok, false);
});

test('apiErrorMessage: un texto en español para cada motivo conocido y uno genérico', () => {
  for (const e of ['not_configured', 'rate_limited', 'outside_area', 'timeout', 'network', 'http_error', 'cualquier-otro']) assert.match(apiErrorMessage(e), /\S{5,}/, e);
  assert.notEqual(apiErrorMessage('network'), apiErrorMessage('timeout'));
});

// ---------- feed ----------

/** Reloj de pruebas: temporizadores a mano y una pestaña que se puede ocultar. */
function rig({ responses } = {}) {
  const timers = [];
  let cleared = 0;
  const handlers = [];
  const doc = { hidden: false, addEventListener: (_, fn) => handlers.push(fn), removeEventListener: (_, fn) => handlers.splice(handlers.indexOf(fn), 1) };
  const calls = [];
  let n = 0;
  const api = {
    state: async () => { calls.push('state'); return responses?.(n++, 'state') ?? { ok: true, data: { signals: [], listeners: 0 } }; },
    poll: async ({ listening }) => { calls.push(listening ? 'poll' : 'leave'); return listening ? (responses?.(n++, 'poll') ?? { ok: true, data: { signals: [], listeners: 1 } }) : { ok: true, data: {} }; }
  };
  const updates = []; const fresh = []; const statuses = [];
  const feed = createSignalFeed({
    api, listenerId: 'oyente-abc123', doc,
    onUpdate: (v) => updates.push(v), onNew: (s) => fresh.push(s.map((x) => x.id)), onStatus: (s) => statuses.push(s),
    setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length), clearTimer: () => { cleared++; }
  });
  return {
    feed, api, calls, timers, updates, fresh, statuses, doc,
    fire: async () => { await timers.at(-1).fn(); },
    hide: async () => { doc.hidden = true; for (const h of [...handlers]) await h(); },
    show: async () => { doc.hidden = false; for (const h of [...handlers]) await h(); },
    cleared: () => cleared, handlers
  };
}

test('feed: sin escuchar, al abrir la página es UNA lectura y ningún temporizador', async () => {
  const r = rig();
  await r.feed.refresh();
  assert.deepEqual(r.calls, ['state']);
  assert.equal(r.timers.length, 0, 'quien no escucha no sondea');
  assert.equal(r.feed.isListening(), false);
  assert.equal(r.updates.length, 1);
});

test('feed: refresh simultáneos comparten una sola petición', async () => {
  const r = rig();
  await Promise.all([r.feed.refresh(), r.feed.refresh(), r.feed.refresh()]);
  assert.deepEqual(r.calls, ['state']);
});

test('feed: al activar la escucha sondea en el acto y luego cada 30 s', async () => {
  const r = rig();
  await r.feed.setListening(true);
  assert.deepEqual(r.calls, ['poll']);
  assert.equal(r.timers.at(-1).ms, POLL_MS);
  assert.equal(POLL_MS, 30_000);
  await r.fire(); await r.fire();
  assert.deepEqual(r.calls, ['poll', 'poll', 'poll']);
  assert.ok(r.timers.every((t) => t.ms === 30_000));
});

test('feed: con la pestaña oculta no hay temporizador; al volver sondea de inmediato y reanuda', async () => {
  const r = rig();
  await r.feed.setListening(true);
  const before = r.calls.length;
  await r.hide();
  const timersWhileHidden = r.timers.length;
  assert.equal(r.calls.length, before);
  await r.show();
  assert.equal(r.calls.length, before + 1, 'sondeo inmediato al volver');
  assert.equal(r.timers.length, timersWhileHidden + 1, 'y se reprograma el de 30 s');
});

test('feed: activar la escucha con la pestaña oculta no sondea todavía', async () => {
  const r = rig();
  r.doc.hidden = true;
  await r.feed.setListening(true);
  assert.deepEqual(r.calls, []);
  assert.equal(r.timers.length, 0);
  await r.show();
  assert.deepEqual(r.calls, ['poll']);
});

test('feed: al apagar la escucha se avisa al servidor una vez y se detiene todo', async () => {
  const r = rig();
  await r.feed.setListening(true);
  await r.feed.setListening(false);
  assert.deepEqual(r.calls, ['poll', 'leave']);
  const cleared = r.cleared();
  await r.hide(); await r.show();
  assert.deepEqual(r.calls, ['poll', 'leave'], 'ya no responde a la visibilidad');
  assert.ok(cleared >= 1);
  await r.feed.setListening(false);
  assert.equal(r.calls.length, 2, 'apagar dos veces no repite el aviso');
});

test('feed: activar dos veces seguidas no duplica sondeos ni temporizadores', async () => {
  const r = rig();
  await r.feed.setListening(true);
  await r.feed.setListening(true);
  assert.deepEqual(r.calls, ['poll']);
});

test('feed: si el servidor falla, espacia los intentos (30 s → 60 s → 2 min) y avisa del estado solo al cambiar', async () => {
  let down = false;
  const r = rig({ responses: () => (down ? { ok: false, error: 'network' } : { ok: true, data: { signals: [], listeners: 1 } }) });
  await r.feed.setListening(true);
  down = true;
  await r.fire(); assert.equal(r.timers.at(-1).ms, BACKOFF_MS[0]);
  await r.fire(); assert.equal(r.timers.at(-1).ms, BACKOFF_MS[1]);
  await r.fire(); assert.equal(r.timers.at(-1).ms, BACKOFF_MS[2]);
  await r.fire(); assert.equal(r.timers.at(-1).ms, BACKOFF_MS[2], 'el tope es 2 min');
  assert.deepEqual(r.statuses, ['ok', 'error'], 'un solo aviso de error, no uno por intento');
  down = false;
  await r.fire();
  assert.equal(r.timers.at(-1).ms, 30_000, 'al recuperarse vuelve a 30 s');
  assert.deepEqual(r.statuses, ['ok', 'error', 'ok']);
  assert.equal(r.feed.failures(), 0);
});

test('feed: una señal nueva se avisa una sola vez, y la primera lectura no cuenta como "nueva"', async () => {
  const batches = [[sig('a')], [sig('a')], [sig('a'), sig('b', 2000)], [sig('a'), sig('b', 2000)]];
  const r = rig({ responses: (i) => ({ ok: true, data: { signals: batches[Math.min(i, 3)], listeners: 1 } }) });
  await r.feed.refresh();
  assert.deepEqual(r.fresh, [], 'lo que ya estaba al abrir no suena como alerta');
  await r.feed.setListening(true);
  assert.deepEqual(r.fresh, []);
  await r.fire();
  assert.deepEqual(r.fresh, [['b']]);
  await r.fire();
  assert.deepEqual(r.fresh, [['b']], 'no se repite');
});

test('feed: las actualizaciones llevan señales ordenadas y el conteo', async () => {
  const r = rig({ responses: () => ({ ok: true, data: { signals: [sig('x', 1), sig('y', 9)], listeners: 4, now: 77 } }) });
  await r.feed.refresh();
  assert.deepEqual(r.updates[0].signals.map((s) => s.id), ['y', 'x']);
  assert.equal(r.updates[0].listeners, 4);
});

test('feed: un fallo en la primera lectura no deja nada a medias y se puede reintentar', async () => {
  let n = 0;
  const r = rig({ responses: () => (n++ === 0 ? { ok: false, error: 'network' } : { ok: true, data: { signals: [sig('a')], listeners: 0 } }) });
  assert.equal((await r.feed.refresh()).ok, false);
  assert.equal(r.updates.length, 0);
  assert.equal((await r.feed.refresh()).ok, true);
  assert.equal(r.updates.length, 1);
  assert.deepEqual(r.fresh, [], 'tras el primer éxito tampoco es "nueva"');
});

test('feed: stop() limpia temporizador y escuchas', async () => {
  const r = rig();
  await r.feed.setListening(true);
  r.feed.stop();
  assert.equal(r.handlers.length, 0);
  assert.equal(r.feed.isListening(), false);
});

// ---------- botón 🆘 con la cifra de oyentes ----------
import { helpButtonView } from '../src/domain/signals.js';

test('helpButtonView: sin servidor no hay botón; sin primera respuesta no hay cifra (un "0" falso engañaría)', () => {
  assert.deepEqual(helpButtonView({ enabled: false, loaded: true, listeners: 5 }).hidden, true);
  const waiting = helpButtonView({ enabled: true, loaded: false, listeners: 0 });
  assert.deepEqual([waiting.hidden, waiting.badgeHidden], [false, true]);
  assert.equal(waiting.label, 'Pedir ayuda a los vecinos');
});

test('helpButtonView: la cifra, el 0 atenuado, el tope 99+ y la etiqueta para lectores de pantalla', () => {
  const some = helpButtonView({ enabled: true, loaded: true, listeners: 3 });
  assert.deepEqual([some.badge, some.badgeDim, some.badgeHidden], ['3', false, false]);
  assert.match(some.label, /3 vecinos escuchan/);
  const none = helpButtonView({ enabled: true, loaded: true, listeners: 0 });
  assert.deepEqual([none.badge, none.badgeDim], ['0', true]);
  assert.match(none.label, /Nadie escucha/);
  assert.equal(helpButtonView({ enabled: true, loaded: true, listeners: 100 }).badge, '99+');
  assert.equal(helpButtonView({ enabled: true, loaded: true, listeners: 99 }).badge, '99');
  for (const bad of [undefined, NaN, -3, 'x', Infinity]) assert.equal(helpButtonView({ enabled: true, loaded: true, listeners: bad }).badge, '0', String(bad));
});
