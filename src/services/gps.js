/**
 * GPS del teléfono, sin DOM. Una sola lectura al arrancar (no hay seguimiento continuo): la posición vale
 * `freshMs` y después se vuelve a leer solo cuando alguien la necesita.
 *
 *   const gps = createGps();
 *   gps.subscribe((status, fix) => ...);   // se llama al suscribirse y en cada cambio
 *   gps.start();                           // primera lectura (Safari pide el permiso aquí)
 *   const fix = gps.fix() || (await gps.read());
 *
 * Estados: 'ok' (posición vigente) · 'searching' (leyendo) · 'stale' (vencida; se relee al usarla)
 *          · 'denied' | 'unavailable' (no se puede).
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

/** Todo se puede reemplazar en pruebas: `geolocation`, el reloj y los temporizadores. */
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
  let pending = null; // lectura en curso, compartida entre quienes la piden
  let staleTimer = null;
  const listeners = new Set();

  /** Última posición si todavía es reciente (permite actuar al instante, dentro del toque). */
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
    // Este temporizador NO lee el GPS: solo repinta el indicador cuando la posición vence.
    clearTimer(staleTimer);
    staleTimer = setTimer(emit, freshMs + 100);
    return lastFix;
  }

  /** Una lectura. Devuelve la posición o null (nunca lanza); el motivo queda en `error()`. */
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
    /** Relee solo si la posición venció o no existe. */
    ensureFresh() {
      if (!fix()) read();
    },
    start: read
  };
}
