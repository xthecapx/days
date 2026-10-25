import { isActive, newListenerId } from '../domain/signals.js';
import { createSignalFeed } from './signalFeed.js';

/**
 * Use cases of the help signal: ties together the server client, the polling, the GPS and the browser preferences,
 * and leaves the result in the store. The interface only calls these functions and reads the store.
 *
 * Everything external comes in as parameters (as in gps.js and incidentService.js), to test without network or browser.
 */
export function createSignalService({
  store,
  api,
  gps,
  prefs, // { read(), write(p) }
  now = Date.now,
  makeFeed = createSignalFeed,
  onNew = () => {}
}) {
  const patch = (partial) => store.patch('signals', partial);
  const saved = prefs.read();
  const listenerId = saved.listenerId || newListenerId();
  let mine = saved.mine && isActive(saved.mine, now()) ? saved.mine : null;

  const persist = () => prefs.write({ listening: store.get().signals.listening, listenerId, mine });
  persist();
  patch({ enabled: api.enabled, mine: mine ? { id: mine.id, expiresAt: mine.expiresAt } : null, listening: false });

  const feed = makeFeed({
    api,
    listenerId,
    onUpdate: (view) => {
      // Phone clocks drift: the difference with the server is measured so that "hace 3 min" is accurate.
      const hasServerClock = Number.isFinite(view.serverNow);
      const skew = hasServerClock ? view.serverNow - now() : store.get().signals.skew;
      // My signal is forgotten only once it HAS EXPIRED (by server time). If another device cancelled it, it stays listed
      // until then: a minor detail that avoids wrongly deleting an alert that was just sent.
      if (mine && !isActive(mine, now() + skew)) {
        mine = null;
        persist();
      }
      patch({ active: view.signals, listeners: view.listeners, loaded: true, skew, mine: mine ? { id: mine.id, expiresAt: mine.expiresAt } : null });
    },
    onNew: (signals, view) => onNew(signals.filter((s) => s.id !== mine?.id), view),
    onStatus: (status) => patch({ status })
  });

  return {
    /** Single read on page open (does not count as a listener). If the person left listening on, it resumes it. */
    async start() {
      if (!api.enabled) return;
      await feed.refresh();
      if (saved.listening) await this.setListening(true);
    },

    async setListening(value) {
      if (!api.enabled) return;
      patch({ listening: Boolean(value) });
      persist();
      await feed.setListening(Boolean(value));
    },

    /**
     * Sends the signal with the phone's position. Returns { ok:true, signal } or { ok:false, error }.
     * `no_gps` = the location could not be read (the person must know: without a location there is no signal to send).
     */
    async send() {
      if (!api.enabled) return { ok: false, error: 'not_configured' };
      const position = gps.fix() || (await gps.read());
      if (!position) return { ok: false, error: gps.error() === 'denied' ? 'gps_denied' : 'no_gps' };
      const result = await api.send({ lat: position.lat, lng: position.lng });
      if (!result.ok) return result;
      const { id, cancelToken, expiresAt, listeners } = result.data;
      mine = { id, token: cancelToken, expiresAt };
      persist();
      patch({ mine: { id, expiresAt }, listeners });
      await feed.refresh();
      return { ok: true, signal: { id, expiresAt }, listeners };
    },

    /** Withdraws my active signal (in case it was a false alarm). */
    async cancel() {
      if (!mine) return { ok: false, error: 'nothing_to_cancel' };
      const result = await api.cancel({ id: mine.id, token: mine.token });
      // 404 = it no longer exists (expired): for me that is the same as cancelled.
      if (result.ok || result.status === 404) {
        mine = null;
        persist();
        patch({ mine: null });
        await feed.refresh();
        return { ok: true };
      }
      return result;
    },

    listenerId,
    stop: () => feed.stop()
  };
}
