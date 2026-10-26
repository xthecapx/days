/**
 * Phone GPS, no DOM. Used only by the 📍 button ("where am I on the map"). There is NO read on page load and no
 * continuous tracking: the position is requested when the button is tapped and is then reused for `freshMs`.
 *
 *   const gps = createGps();
 *   const fix = gps.fix() || (await gps.read());   // { lat, lng, accuracy, at } or null
 *   gps.error();                                    // 'denied' | 'unavailable' | 'timeout' | null
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

/** Everything can be replaced in tests: `geolocation` and the clock. */
export function createGps({
  geolocation = globalThis.navigator?.geolocation,
  now = Date.now,
  freshMs = DEFAULTS.freshMs,
  options = DEFAULTS.options
} = {}) {
  let lastFix = null; // { lat, lng, accuracy, at }
  let lastError = null; // 'denied' | 'unavailable' | 'timeout' | null
  let pending = null; // read in progress, shared among those who request it

  /** Last position if it is still recent (so a second tap does not ask the phone again). */
  const fix = () => (lastFix && now() - lastFix.at < freshMs ? lastFix : null);

  /** One read. Returns the position or null (never throws); the reason is left in `error()`. */
  function read() {
    if (pending) return pending;
    pending = new Promise((resolve) => {
      if (!geolocation) {
        lastError = 'unavailable';
        return resolve(null);
      }
      geolocation.getCurrentPosition(
        (pos) => {
          lastError = null;
          lastFix = toFix(pos, now());
          resolve(lastFix);
        },
        (err) => {
          lastError = toError(err);
          resolve(null);
        },
        options
      );
    }).finally(() => {
      pending = null;
    });
    return pending;
  }

  return { fix, read, error: () => lastError };
}
