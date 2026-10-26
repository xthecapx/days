import test from 'node:test';
import assert from 'node:assert/strict';
import { ageLabel, listenersLabel, newSignals, normalizeSignals, newListenerId } from '../src/domain/signals.js';
import * as domain from '../src/domain/signals.js';
import { createSignalApi } from '../src/services/signalApi.js';
import { createSignalFeed, POLL_MS, BACKOFF_MS } from '../src/services/signalFeed.js';

const MIN = 60_000;
const sig = (id, at = 1000, o = {}) => ({ id, x: 92, y: 120, at, expiresAt: at + 30 * MIN, ...o });

// ---------- domain ----------

test('ageLabel: from "now" to hours', () => {
  const now = 10 * 60 * MIN;
  assert.equal(ageLabel(now, now), 'hace un momento');
  assert.equal(ageLabel(now - 59_000, now), 'hace un momento');
  assert.equal(ageLabel(now - MIN, now), 'hace 1 min');
  assert.equal(ageLabel(now - 29 * MIN, now), 'hace 29 min');
  assert.equal(ageLabel(now - 60 * MIN, now), 'hace 1 h');
  assert.equal(ageLabel(now - 65 * MIN, now), 'hace 1 h 5 min');
  assert.equal(ageLabel(now + 5 * MIN, now), 'hace un momento', 'a clock running ahead does not give "hace -5 min"');
});

test('listenersLabel: singular, plural and nobody', () => {
  assert.equal(listenersLabel(0), 'Nadie escucha ahora');
  assert.equal(listenersLabel(1), '1 vecino escucha');
  assert.equal(listenersLabel(3), '3 vecinos escuchan');
  for (const bad of [undefined, null, NaN, -4, 'x']) assert.equal(listenersLabel(bad), 'Nadie escucha ahora', String(bad));
});

test('newSignals: only the alerts that were not seen before', () => {
  assert.deepEqual(newSignals([sig('a'), sig('b')], new Set(['a'])).map((s) => s.id), ['b']);
  assert.deepEqual(newSignals([], new Set(['a'])), []);
  assert.deepEqual(newSignals([sig('a')], new Set()).map((s) => s.id), ['a']);
});

test('the domain no longer has anything for SENDING alerts (they are sent from the phone, never from the app)', () => {
  for (const gone of ['sendHint', 'isMine', 'isActive', 'apiErrorMessage']) assert.equal(gone in domain, false, gone);
});

test('normalizeSignals: sorts, drops malformed entries and does not break on junk', () => {
  const view = normalizeSignals({
    now: 5, listeners: 2.9,
    signals: [sig('viejo', 100), sig('nuevo', 900), { id: 5 }, { id: 'sinXY', at: 1 }, null, 'x', { id: 'f', x: 1.5, y: 2, at: 1 }, { id: 'ok', x: 1, y: 2, at: 500 }]
  });
  assert.deepEqual(view.signals.map((s) => s.id), ['nuevo', 'ok', 'viejo']);
  assert.equal(view.listeners, 2);
  assert.equal(view.serverNow, 5);
  assert.equal(view.signals.find((s) => s.id === 'ok').expiresAt, 500 + 30 * MIN, 'no expiry: 30 min');
  for (const junk of [null, undefined, {}, [], 'x', { signals: 'no', listeners: 'no' }]) assert.deepEqual(normalizeSignals(junk), { signals: [], listeners: 0, serverNow: null });
});

test('newListenerId: 24 hex characters, different every time', () => {
  const a = newListenerId(); const b = newListenerId();
  assert.match(a, /^[0-9a-f]{24}$/);
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{8,64}$/, 'meets what the server requires');
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

test('api: with no URL configured it does nothing and says so', async () => {
  const f = fakeFetch(() => { throw new Error('no debería llamar'); });
  for (const baseUrl of [undefined, '', 'no-es-url', null]) {
    const api = createSignalApi({ baseUrl, fetchImpl: f });
    assert.equal(api.enabled, false);
    assert.deepEqual(await api.state(), { ok: false, error: 'not_configured' });
  }
  assert.equal(f.calls.length, 0);
});

test('api: builds the URL without double slashes or parameters, and sends JSON', async () => {
  const f = fakeFetch(() => reply(200, { ok: true, signals: [], listeners: 0 }));
  const api = createSignalApi({ baseUrl: 'https://s.example/', fetchImpl: f });
  await api.state();
  await api.poll({ listener: 'abc12345', listening: true });
  assert.deepEqual(f.calls.map((c) => [c.method, c.url]), [
    ['GET', 'https://s.example/state'],
    ['POST', 'https://s.example/poll']
  ]);
  assert.deepEqual(f.calls[1].body, { listener: 'abc12345', listening: true });
  assert.equal(f.calls[0].cache, 'no-store');
  assert.equal(f.calls[1].headers['Content-Type'], 'application/json');
});

test('api: the client is READ-ONLY: it has no way to send or cancel an alert', () => {
  const api = createSignalApi({ baseUrl: 'https://s.example', fetchImpl: fakeFetch(() => reply(200, { ok: true })) });
  assert.deepEqual(Object.keys(api).sort(), ['enabled', 'poll', 'state']);
});

test('api: server, network and timeout errors arrive as a result, never thrown', async () => {
  const mk = (handler) => createSignalApi({ baseUrl: 'https://s.example', fetchImpl: fakeFetch(handler), timeoutMs: 20 });
  assert.deepEqual(await mk(() => reply(403, { ok: false, code: 'origin_not_allowed', error: 'no' })).state(), { ok: false, status: 403, error: 'origin_not_allowed', message: 'no' });
  assert.equal((await mk(() => reply(429, null)).state()).error, 'rate_limited');
  assert.equal((await mk(() => reply(500, null)).state()).error, 'http_error');
  assert.equal((await mk(() => ({ ok: true, status: 200, json: async () => { throw new Error('html'); } })).state()).error, 'http_error', 'a page that is not JSON');
  assert.equal((await mk(() => { throw new TypeError('Failed to fetch'); }).state()).error, 'network');
  const slow = mk((_, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))));
  assert.equal((await slow.state()).error, 'timeout');
});

test('api: ok:false inside a 200 is treated as an error', async () => {
  const api = createSignalApi({ baseUrl: 'https://s.example', fetchImpl: fakeFetch(() => reply(200, { ok: false, code: 'x' })) });
  assert.equal((await api.state()).ok, false);
});

// ---------- feed ----------

/** Test clock: hand-driven timers and a tab that can be hidden. */
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

test('feed: when not listening, opening the page is ONE read and no timer', async () => {
  const r = rig();
  await r.feed.refresh();
  assert.deepEqual(r.calls, ['state']);
  assert.equal(r.timers.length, 0, 'whoever is not listening does not poll');
  assert.equal(r.feed.isListening(), false);
  assert.equal(r.updates.length, 1);
});

test('feed: simultaneous refreshes share a single request', async () => {
  const r = rig();
  await Promise.all([r.feed.refresh(), r.feed.refresh(), r.feed.refresh()]);
  assert.deepEqual(r.calls, ['state']);
});

test('feed: turning listening on polls right away and then every 30 s', async () => {
  const r = rig();
  await r.feed.setListening(true);
  assert.deepEqual(r.calls, ['poll']);
  assert.equal(r.timers.at(-1).ms, POLL_MS);
  assert.equal(POLL_MS, 30_000);
  await r.fire(); await r.fire();
  assert.deepEqual(r.calls, ['poll', 'poll', 'poll']);
  assert.ok(r.timers.every((t) => t.ms === 30_000));
});

test('feed: with the tab hidden there is no timer; on return it polls immediately and resumes', async () => {
  const r = rig();
  await r.feed.setListening(true);
  const before = r.calls.length;
  await r.hide();
  const timersWhileHidden = r.timers.length;
  assert.equal(r.calls.length, before);
  await r.show();
  assert.equal(r.calls.length, before + 1, 'immediate poll on return');
  assert.equal(r.timers.length, timersWhileHidden + 1, 'and the 30 s timer is rescheduled');
});

test('feed: turning listening on with the tab hidden does not poll yet', async () => {
  const r = rig();
  r.doc.hidden = true;
  await r.feed.setListening(true);
  assert.deepEqual(r.calls, []);
  assert.equal(r.timers.length, 0);
  await r.show();
  assert.deepEqual(r.calls, ['poll']);
});

test('feed: turning listening off notifies the server once and stops everything', async () => {
  const r = rig();
  await r.feed.setListening(true);
  await r.feed.setListening(false);
  assert.deepEqual(r.calls, ['poll', 'leave']);
  const cleared = r.cleared();
  await r.hide(); await r.show();
  assert.deepEqual(r.calls, ['poll', 'leave'], 'it no longer reacts to visibility');
  assert.ok(cleared >= 1);
  await r.feed.setListening(false);
  assert.equal(r.calls.length, 2, 'turning off twice does not repeat the notice');
});

test('feed: turning on twice in a row does not duplicate polls or timers', async () => {
  const r = rig();
  await r.feed.setListening(true);
  await r.feed.setListening(true);
  assert.deepEqual(r.calls, ['poll']);
});

test('feed: if the server fails, it spaces out attempts (30 s → 60 s → 2 min) and reports the status only when it changes', async () => {
  let down = false;
  const r = rig({ responses: () => (down ? { ok: false, error: 'network' } : { ok: true, data: { signals: [], listeners: 1 } }) });
  await r.feed.setListening(true);
  down = true;
  await r.fire(); assert.equal(r.timers.at(-1).ms, BACKOFF_MS[0]);
  await r.fire(); assert.equal(r.timers.at(-1).ms, BACKOFF_MS[1]);
  await r.fire(); assert.equal(r.timers.at(-1).ms, BACKOFF_MS[2]);
  await r.fire(); assert.equal(r.timers.at(-1).ms, BACKOFF_MS[2], 'the cap is 2 min');
  assert.deepEqual(r.statuses, ['ok', 'error'], 'a single error notice, not one per attempt');
  down = false;
  await r.fire();
  assert.equal(r.timers.at(-1).ms, 30_000, 'on recovery it goes back to 30 s');
  assert.deepEqual(r.statuses, ['ok', 'error', 'ok']);
  assert.equal(r.feed.failures(), 0);
});

test('feed: a new signal is announced only once, and the first read does not count as "new"', async () => {
  const batches = [[sig('a')], [sig('a')], [sig('a'), sig('b', 2000)], [sig('a'), sig('b', 2000)]];
  const r = rig({ responses: (i) => ({ ok: true, data: { signals: batches[Math.min(i, 3)], listeners: 1 } }) });
  await r.feed.refresh();
  assert.deepEqual(r.fresh, [], 'what was already there on opening does not sound like an alert');
  await r.feed.setListening(true);
  assert.deepEqual(r.fresh, []);
  await r.fire();
  assert.deepEqual(r.fresh, [['b']]);
  await r.fire();
  assert.deepEqual(r.fresh, [['b']], 'it is not repeated');
});

test('feed: updates carry sorted signals and the count', async () => {
  const r = rig({ responses: () => ({ ok: true, data: { signals: [sig('x', 1), sig('y', 9)], listeners: 4, now: 77 } }) });
  await r.feed.refresh();
  assert.deepEqual(r.updates[0].signals.map((s) => s.id), ['y', 'x']);
  assert.equal(r.updates[0].listeners, 4);
});

test('feed: a failure on the first read leaves nothing half-done and can be retried', async () => {
  let n = 0;
  const r = rig({ responses: () => (n++ === 0 ? { ok: false, error: 'network' } : { ok: true, data: { signals: [sig('a')], listeners: 0 } }) });
  assert.equal((await r.feed.refresh()).ok, false);
  assert.equal(r.updates.length, 0);
  assert.equal((await r.feed.refresh()).ok, true);
  assert.equal(r.updates.length, 1);
  assert.deepEqual(r.fresh, [], 'after the first success it is not "new" either');
});

test('feed: stop() clears the timer and listeners', async () => {
  const r = rig();
  await r.feed.setListening(true);
  r.feed.stop();
  assert.equal(r.handlers.length, 0);
  assert.equal(r.feed.isListening(), false);
});

// ---------- 🆘 button with the listener count ----------
import { helpButtonView } from '../src/domain/signals.js';

test('helpButtonView: no server means no button; no first response means no count (a false "0" would mislead)', () => {
  assert.deepEqual(helpButtonView({ enabled: false, loaded: true, listeners: 5 }).hidden, true);
  const waiting = helpButtonView({ enabled: true, loaded: false, listeners: 0 });
  assert.deepEqual([waiting.hidden, waiting.badgeHidden], [false, true]);
  assert.equal(waiting.label, 'Alertas de ayuda de los vecinos');
});

test('helpButtonView: the count, the dimmed 0, the 99+ cap and the screen-reader label', () => {
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

// ---------- SOS mode: listening replaces the history ----------
import { selectSosMode, selectHistoryVisible } from '../src/state/selectors.js';
import { listenBarText } from '../src/domain/signals.js';
import { createInitialState } from '../src/state/initialState.js';

const withState = (patch = {}) => {
  const base = createInitialState();
  return { ...base, ...patch, signals: { ...base.signals, ...(patch.signals || {}) }, ui: { ...base.ui, ...(patch.ui || {}) }, mode: patch.mode || base.mode };
};

test('SOS mode: not listening = history visible; listening = history hidden', () => {
  assert.equal(selectSosMode(withState()), false);
  assert.equal(selectHistoryVisible(withState()), true);
  const listening = withState({ signals: { listening: true } });
  assert.equal(selectSosMode(listening), true);
  assert.equal(selectHistoryVisible(listening), false);
});

test('SOS mode: the history comes back while the person looks at an incident, reports, or picks/moves a point', () => {
  const sos = { signals: { listening: true } };
  assert.equal(selectHistoryVisible(withState({ ...sos, ui: { popupIncidentId: 'inc-001' } })), true, 'looking at an incident');
  assert.equal(selectHistoryVisible(withState({ ...sos, mode: { type: 'pick' } })), true, 'picking a point for a report');
  assert.equal(selectHistoryVisible(withState({ ...sos, mode: { type: 'move', incidentId: 'x' } })), true, 'moving an incident');
  assert.equal(selectHistoryVisible(withState({ ...sos, draft: { session: 1 } })), true, 'a report draft is open');
  assert.equal(selectHistoryVisible(withState(sos)), false, 'nothing of that: stays hidden');
});

test('listenBarText: count, and the connection state', () => {
  assert.equal(listenBarText({ listeners: 0 }), '👂 Escuchando alertas · Nadie escucha ahora');
  assert.equal(listenBarText({ listeners: 3 }), '👂 Escuchando alertas · 3 vecinos escuchan');
  assert.match(listenBarText({ listeners: 1, status: 'error' }), /sin conexión$/);
  assert.equal(listenBarText(), '👂 Escuchando alertas · Nadie escucha ahora');
});
