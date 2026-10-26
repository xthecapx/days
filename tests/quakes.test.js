import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, normalizeQuakes, parseUsgs, parseEmsc, quakeSummary, isFresh, newQuakes, QUAKE_CENTER } from '../src/domain/quakes.js';
import { usgsUrl, emscUrl, createQuakeApi } from '../src/services/quakeApi.js';
import { createQuakeFeed, QUAKE_POLL_MS } from '../src/services/quakeFeed.js';

const NOW = Date.UTC(2026, 9, 26, 15, 0, 0);
const MIN = 60_000;
const REF = new Date(2026, 9, 26, 12);
const usgsFeature = (id, minAgo, mag = 4.5, lng = -72.98, lat = 6.75) => ({
  id, properties: { time: NOW - minAgo * MIN, mag, place: '0 km SW of Cepitá, Colombia', url: `https://earthquake.usgs.gov/${id}` },
  geometry: { coordinates: [lng, lat, 160] }
});
const quake = (o = {}) => ({ id: 'q1', time: NOW - 10 * MIN, mag: 4.5, depthKm: 160, lat: 6.75, lng: -72.98, place: 'x', url: null, source: 'USGS', ...o });

test('distanceKm: zero to itself, ~111 km per degree of latitude', () => {
  assert.equal(distanceKm(QUAKE_CENTER, QUAKE_CENTER), 0);
  assert.ok(Math.abs(distanceKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111.2) < 0.5);
});

test('normalizeQuakes: drops malformed, weak and far events; newest first', () => {
  const list = parseUsgs({ features: [
    usgsFeature('a', 100), usgsFeature('b', 10), usgsFeature('weak', 5, 3.2), usgsFeature('far', 5, 5, -75, 4),
    { id: 'bad', properties: {}, geometry: {} }, null
  ] });
  const out = normalizeQuakes(list);
  assert.deepEqual(out.map((q) => q.id), ['usgs:b', 'usgs:a']);
  assert.ok(out[0].distanceKm < 100);
  assert.deepEqual(normalizeQuakes(parseUsgs(null)), []);
});

test('normalizeQuakes: only https links survive', () => {
  const out = normalizeQuakes([quake({ url: 'javascript:alert(1)' }), quake({ id: 'q2', url: 'https://x.org/e' })]);
  assert.deepEqual(out.map((q) => q.url), [null, 'https://x.org/e']); // same time: input order is kept
});

test('parseEmsc: maps fields and makes depth positive', () => {
  const [q] = parseEmsc({ features: [{ id: 'e1', properties: { time: '2026-10-13T21:24:20.93Z', mag: 4.8, depth: 160, lat: 6.77, lon: -73.03, flynn_region: 'NORTHERN COLOMBIA', unid: 'e1', source_id: '99' } }] });
  assert.equal(q.depthKm, 160);
  assert.equal(q.time, Date.parse('2026-10-13T21:24:20.93Z'));
  assert.equal(q.place, 'Northern colombia');
  assert.equal(q.source, 'EMSC');
});

test('quakeSummary: empty, days since, and fresh alert', () => {
  assert.equal(quakeSummary([], REF, NOW).days, '--');
  const old = quakeSummary(normalizeQuakes([quake({ time: new Date(2026, 9, 13, 21, 24).getTime() })]), REF, NOW);
  assert.equal(old.days, '13');
  assert.equal(old.fresh, false);
  assert.match(old.preview, /^M4\.5 · a \d+ km · prof\. 160 km$/);
  const fresh = quakeSummary(normalizeQuakes([quake({ time: NOW - 12 * MIN })]), REF, NOW);
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.days, '!');
  assert.equal(fresh.label, 'SISMO HACE 12 MIN');
});

test('isFresh: 6 h window, not for the future', () => {
  assert.equal(isFresh(quake({ time: NOW - 5 * 60 * MIN }), NOW), true);
  assert.equal(isFresh(quake({ time: NOW - 7 * 60 * MIN }), NOW), false);
  assert.equal(isFresh(quake({ time: NOW + 30 * MIN }), NOW), false);
});

test('newQuakes: only strictly newer than last seen', () => {
  assert.deepEqual(newQuakes([quake({ time: 5 }), quake({ id: 'o', time: 3 })], 4).map((q) => q.time), [5]);
});

test('query URLs carry the radius, magnitude and a lookback date derived from the injected time', () => {
  const u = new URL(usgsUrl(NOW));
  assert.equal(u.searchParams.get('maxradiuskm'), '100');
  assert.equal(u.searchParams.get('minmagnitude'), '4');
  assert.equal(u.searchParams.get('starttime'), '2025-10-26');
  assert.equal(new URL(emscUrl(NOW)).searchParams.get('start'), '2025-10-26');
});

const jsonResponse = (body, ok = true) => ({ ok, json: async () => body });

test('api: uses USGS; falls back to EMSC when USGS fails; fails quietly when both fail', async () => {
  const urls = [];
  const emsc = { features: [{ id: 'e1', properties: { time: new Date(NOW - 20 * MIN).toISOString(), mag: 4.4, depth: 150, lat: 6.8, lon: -73, unid: 'e1' } }] };
  const fetchImpl = async (url) => {
    urls.push(new URL(url).host);
    if (url.includes('usgs')) return jsonResponse({}, false);
    return jsonResponse(emsc);
  };
  const api = createQuakeApi({ fetchImpl, now: () => NOW });
  const r = await api.latest();
  assert.equal(r.ok, true);
  assert.equal(r.source, 'EMSC');
  assert.deepEqual(urls, ['earthquake.usgs.gov', 'www.seismicportal.eu']);

  const down = createQuakeApi({ fetchImpl: async () => { throw new Error('offline'); }, now: () => NOW });
  assert.deepEqual(await down.latest(), { ok: false, error: 'network' });
  assert.deepEqual(await createQuakeApi({ fetchImpl: null }).latest(), { ok: false, error: 'not_configured' });
});

// ---------- feed ----------

function feedRig(results) {
  const timers = [];
  const doc = { hidden: false, listeners: [], addEventListener(_, f) { this.listeners.push(f); }, removeEventListener() {} };
  const events = { updates: [], news: [], status: [] };
  let calls = 0;
  const api = { enabled: true, latest: async () => results[Math.min(calls++, results.length - 1)] };
  const feed = createQuakeFeed({
    api, doc,
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.cleared = true; },
    onUpdate: (r) => events.updates.push(r), onNew: (f) => events.news.push(f), onStatus: (s) => events.status.push(s)
  });
  const live = () => timers.filter((t) => !t.cleared && !t.fired);
  const fire = async () => { const t = live().at(-1); t.fired = true; await t.fn(); };
  return { feed, doc, events, live, fire, calls: () => calls };
}
const ok = (...qs) => ({ ok: true, source: 'USGS', quakes: qs });

test('feed: first read is not "new"; a later newer quake is; polls every 60 s', async () => {
  const r = feedRig([ok(quake({ time: 1000 })), ok(quake({ time: 1000 })), ok(quake({ id: 'n', time: 2000 }), quake({ time: 1000 }))]);
  await r.feed.start();
  assert.equal(r.events.news.length, 0);
  assert.equal(r.live()[0].ms, QUAKE_POLL_MS);
  await r.fire();
  assert.equal(r.events.news.length, 0, 'same quake again is not new');
  await r.fire();
  assert.deepEqual(r.events.news.map((f) => f.map((q) => q.id)), [['n']]);
  assert.equal(r.events.updates.length, 3);
});

test('feed: hidden tab has no timer; coming back reads right away', async () => {
  const r = feedRig([ok(quake())]);
  await r.feed.start();
  r.doc.hidden = true;
  await r.doc.listeners[0]();
  assert.equal(r.live().length, 0);
  const before = r.calls();
  r.doc.hidden = false;
  await r.doc.listeners[0]();
  assert.equal(r.calls(), before + 1);
  assert.equal(r.live().length, 1);
});

test('feed: failures back off and report status once; recovery resets', async () => {
  const r = feedRig([{ ok: false, error: 'network' }, { ok: false, error: 'network' }, ok(quake())]);
  await r.feed.start();
  assert.deepEqual(r.events.status, ['error']);
  assert.equal(r.live()[0].ms, 60_000);
  await r.fire();
  assert.equal(r.live()[0].ms, 120_000);
  await r.fire();
  assert.deepEqual(r.events.status, ['error', 'ok']);
  assert.equal(r.live()[0].ms, QUAKE_POLL_MS);
});

test('feed: disabled api does nothing; stop clears the timer', async () => {
  const off = createQuakeFeed({ api: { enabled: false }, doc: null });
  await off.start();
  const r = feedRig([ok(quake())]);
  await r.feed.start();
  r.feed.stop();
  assert.equal(r.live().length, 0);
});
