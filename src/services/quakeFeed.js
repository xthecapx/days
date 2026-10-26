/**
 * Keeps the earthquake notice up to date. Rules (all tested):
 *   - One read on start, then every 60 s (the sources cache for 60 s: faster gains nothing), ONLY while the page is visible.
 *   - Hidden tab = no timer. Back on screen = immediate read.
 *   - On failure it backs off (60 s → 2 min → 5 min) and stays quiet.
 *   - A quake is "new" only if it is newer than everything seen before and the first read does not count.
 */
export const QUAKE_POLL_MS = 60_000;
export const QUAKE_BACKOFF_MS = [60_000, 120_000, 300_000];

export function createQuakeFeed({
  api,
  onUpdate = () => {},
  onNew = () => {},
  onStatus = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  doc = globalThis.document
} = {}) {
  let timer = null;
  let failures = 0;
  let inFlight = null;
  let running = false;
  let lastSeen = null; // time of the newest quake seen; null = first read not done yet
  let status = 'idle';

  const visible = () => !doc || !doc.hidden;
  const setStatus = (next) => {
    if (next !== status) {
      status = next;
      onStatus(status);
    }
  };

  function apply(result) {
    const newest = result.quakes[0]?.time ?? -Infinity;
    if (lastSeen !== null) {
      const fresh = result.quakes.filter((q) => q.time > lastSeen);
      if (fresh.length) onNew(fresh);
    }
    lastSeen = Math.max(lastSeen ?? -Infinity, newest);
    onUpdate(result);
  }

  function read() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const result = await api.latest();
      if (result.ok) {
        failures = 0;
        setStatus('ok');
        apply(result);
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

  const delay = () => (failures === 0 ? QUAKE_POLL_MS : QUAKE_BACKOFF_MS[Math.min(failures, QUAKE_BACKOFF_MS.length) - 1]);

  function schedule() {
    clearTimer(timer);
    timer = null;
    if (!running || !visible()) return;
    timer = setTimer(async () => {
      timer = null;
      await read();
      schedule();
    }, delay());
  }

  const onVisibility = async () => {
    if (!running) return;
    if (visible()) {
      await read();
      schedule();
    } else {
      clearTimer(timer);
      timer = null;
    }
  };
  doc?.addEventListener('visibilitychange', onVisibility);

  return {
    async start() {
      if (!api.enabled || running) return;
      running = true;
      if (visible()) await read();
      schedule();
    },
    refresh: read,
    status: () => status,
    stop() {
      running = false;
      clearTimer(timer);
      timer = null;
      doc?.removeEventListener('visibilitychange', onVisibility);
    }
  };
}
