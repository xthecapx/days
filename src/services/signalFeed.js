/**
 * Keeps the help signals up to date. Rules (all tested):
 *   - On page open it reads ONCE (`refresh`); whoever is not listening does not poll afterwards.
 *   - Whoever turns on "listen" polls every 30 s, and ONLY while the page is visible. Hidden tab = nothing.
 *   - When returning to the tab it polls immediately (timers fall behind in the background).
 *   - If the server fails, polling backs off (30 s → 60 s → 2 min) and the user is not notified on every attempt.
 *   - Nothing runs in the background: no Service Worker and no push notifications.
 *
 *   const feed = createSignalFeed({ api, listenerId, onUpdate, onNew, onStatus });
 *   await feed.refresh();            // single read at startup
 *   feed.setListening(true);         // starts polling every 30 s while visible
 */

import { newSignals, normalizeSignals } from '../domain/signals.js';

export const POLL_MS = 30_000;
export const BACKOFF_MS = [30_000, 60_000, 120_000];

export function createSignalFeed({
  api,
  listenerId,
  onUpdate = () => {},
  onNew = () => {},
  onStatus = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  doc = globalThis.document
} = {}) {
  let listening = false;
  let timer = null;
  let failures = 0;
  let inFlight = null;
  let started = false; // there has already been a read: from here on, whatever appears is "new"
  let status = 'idle'; // 'idle' | 'ok' | 'error'
  const seen = new Set();

  const visible = () => !doc || !doc.hidden;
  const setStatus = (next) => {
    if (next !== status) {
      status = next;
      onStatus(status);
    }
  };

  function apply(payload) {
    const view = normalizeSignals(payload);
    if (started) {
      const fresh = newSignals(view.signals, seen);
      if (fresh.length) onNew(fresh, view);
    }
    for (const s of view.signals) seen.add(s.id);
    started = true;
    onUpdate(view);
  }

  /** One read now. If one is already in progress, it shares it (never two at once). */
  function run(kind) {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const result = kind === 'poll' ? await api.poll({ listener: listenerId, listening: true }) : await api.state();
      if (result.ok) {
        failures = 0;
        setStatus('ok');
        apply(result.data);
      } else {
        failures += 1;
        setStatus('error');
      }
      return result;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  const delay = () => (failures === 0 ? POLL_MS : BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]);

  function schedule() {
    clearTimer(timer);
    timer = null;
    if (!listening || !visible()) return; // without listening or with the tab hidden, there is no timer
    timer = setTimer(async () => {
      timer = null;
      await run('poll');
      schedule();
    }, delay());
  }

  const onVisibility = async () => {
    if (!listening) return;
    if (visible()) {
      await run('poll'); // when returning, poll right away
      schedule();
    } else {
      clearTimer(timer);
      timer = null;
    }
  };
  doc?.addEventListener('visibilitychange', onVisibility);

  return {
    /** Public read: does not count as a listener. */
    refresh: () => run('state'),

    /** Turns listening on or off. When turned off, the server is told to stop counting you. */
    async setListening(value) {
      const next = Boolean(value);
      if (next === listening) return;
      listening = next;
      if (listening) {
        failures = 0;
        if (visible()) await run('poll');
        schedule();
      } else {
        clearTimer(timer);
        timer = null;
        await api.poll({ listener: listenerId, listening: false }); // leaves the count immediately
      }
    },

    isListening: () => listening,
    status: () => status,
    failures: () => failures,

    /** For tests and for a clean shutdown. */
    stop() {
      listening = false;
      clearTimer(timer);
      timer = null;
      doc?.removeEventListener('visibilitychange', onVisibility);
    }
  };
}
