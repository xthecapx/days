import { newListenerId } from '../domain/signals.js';
import { createSignalFeed } from './signalFeed.js';

/**
 * Use cases of the help signal: ties together the server client, the polling and the browser preferences,
 * and leaves the result in the store. The interface only calls these functions and reads the store.
 *
 * Everything external comes in as parameters (as in gps.js and incidentService.js), to test without network or browser.
 */
export function createSignalService({
  store,
  api,
  prefs, // { read(), write(p) }
  now = Date.now,
  makeFeed = createSignalFeed,
  onNew = () => {}
}) {
  const patch = (partial) => store.patch('signals', partial);
  const saved = prefs.read();
  const listenerId = saved.listenerId || newListenerId();

  const persist = () => prefs.write({ listening: store.get().signals.listening, listenerId });
  persist();
  patch({ enabled: api.enabled, listening: false });

  const feed = makeFeed({
    api,
    listenerId,
    onUpdate: (view) => {
      // Phone clocks drift: the difference with the server is measured so that "hace 3 min" is accurate.
      const hasServerClock = Number.isFinite(view.serverNow);
      const skew = hasServerClock ? view.serverNow - now() : store.get().signals.skew;
      patch({ active: view.signals, listeners: view.listeners, loaded: true, skew });
    },
    onNew,
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

    listenerId,
    stop: () => feed.stop()
  };
}
