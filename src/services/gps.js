/**
 * Phone GPS, no DOM. A single read at startup (no continuous tracking): the position is valid for
 * `freshMs` and afterwards it is re-read only when someone needs it.
 *
 *   const gps = createGps();
 *   gps.subscribe((status, fix) => ...);   // called on subscribe and on every change
 *   gps.start();                           // first read (Safari asks for permission here)
 *   const fix = gps.fix() || (await gps.read());
 *
 * States: 'ok' (position valid) · 'searching' (reading) · 'stale' (expired; re-read on use)
 *          · 'denied' | 'unavailable' (cannot be used).
 */

const DEFAULTS = {
  freshMs: 2 * 60_000,
  options: { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
};

const toFix = (pos, at) => ({
  lat: pos.coords.latitude,
  lng: pos.coords.longitude,
  accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
  at
});
const toError = (err) => (err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'unavailable');

/** Everything can be replaced in tests: `geolocation`, the clock and the timers. */
export function createGps({
  geolocation = globalThis.navigator?.geolocation,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  freshMs = DEFAULTS.freshMs,
  options = DEFAULTS.options
} = {}) {
  let lastFix = null; // { lat, lng, accuracy, at }
  let lastError = null; // 'denied' | 'unavailable' | 'timeout' | null
  let pending = null; // read in progress, shared among those who request it
  let staleTimer = null;
  const listeners = new Set();

  /** Last position if it is still recent (allows acting instantly, within the tap). */
  const fix = () => (lastFix && now() - lastFix.at < freshMs ? lastFix : null);

  function status() {
    if (lastError === 'denied' || lastError === 'unavailable') return lastError;
    if (fix()) return 'ok';
    if (pending || (!lastFix && !lastError)) return 'searching';
    return 'stale';
  }

  const emit = () => listeners.forEach((fn) => fn(status(), lastFix));

  function subscribe(fn) {
    listeners.add(fn);
    fn(status(), lastFix);
    return () => listeners.delete(fn);
  }

  function gotFix(pos) {
    lastFix = toFix(pos, now());
    lastError = null;
    // This timer does NOT read the GPS: it only repaints the indicator when the position expires.
    clearTimer(staleTimer);
    staleTimer = setTimer(emit, freshMs + 100);
    return lastFix;
  }

  /** One read. Returns the position or null (never throws); the reason is left in `error()`. */
  function read() {
    if (pending) return pending;
    pending = new Promise((resolve) => {
      if (!geolocation) {
        lastError = 'unavailable';
        return resolve(null);
      }
      geolocation.getCurrentPosition(
        (pos) => resolve(gotFix(pos)),
        (err) => {
          lastError = toError(err);
          resolve(null);
        },
        options
      );
    }).finally(() => {
      pending = null;
      emit();
    });
    emit();
    return pending;
  }

  return {
    status,
    fix,
    error: () => lastError,
    subscribe,
    read,
    /** Re-reads only if the position has expired or does not exist. */
    ensureFresh() {
      if (!fix()) read();
    },
    start: read
  };
}
