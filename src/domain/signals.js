/**
 * Pure rules of the help signal in the interface: texts, comparisons and validations. No DOM, no network.
 * (The server rules live in services/signal/src/board.js.)
 */

/** "hace un momento", "hace 3 min", "hace 1 h 5 min"… from the signal's time and the current time (ms). */
export function ageLabel(at, now) {
  const mins = Math.floor(Math.max(0, now - at) / 60_000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `hace ${h} h ${m} min` : `hace ${h} h`;
}

/** How many neighbours are listening, in words. */
export function listenersLabel(count) {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n === 0) return 'Nadie escucha ahora';
  return n === 1 ? '1 vecino escucha' : `${n} vecinos escuchan`;
}

/** Notice shown before sending, depending on whether anyone is listening. */
export function sendHint(listeners) {
  return listeners > 0
    ? `${listenersLabel(listeners)} y verán tu alerta en el mapa.`
    : 'Nadie tiene la escucha activa ahora. Si es una emergencia, llama al 123 o usa WhatsApp.';
}

/** Signals that have not been seen yet. `seen` is a Set of ids. */
export const newSignals = (signals, seen) => signals.filter((s) => !seen.has(s.id));

/** Is it the signal I sent? (`mine` = { id } stored in this browser.) */
export const isMine = (signal, mine) => Boolean(mine && signal && mine.id === signal.id);

/** Is my latest signal still valid? */
export const isActive = (mine, now) => Boolean(mine && Number.isFinite(mine.expiresAt) && mine.expiresAt > now);

/**
 * Turns the server response into what the interface stores. Protects the screen from odd data:
 * any signal without a valid shape is discarded instead of breaking the drawing.
 */
export function normalizeSignals(payload) {
  const list = Array.isArray(payload?.signals) ? payload.signals : [];
  const signals = list
    .filter((s) => s && typeof s.id === 'string' && Number.isInteger(s.x) && Number.isInteger(s.y) && Number.isFinite(s.at))
    .map((s) => ({ id: s.id, x: s.x, y: s.y, at: s.at, expiresAt: Number.isFinite(s.expiresAt) ? s.expiresAt : s.at + 30 * 60_000 }))
    .sort((a, b) => b.at - a.at);
  const listeners = Number.isFinite(payload?.listeners) ? Math.max(0, Math.floor(payload.listeners)) : 0;
  return { signals, listeners, serverNow: Number.isFinite(payload?.now) ? payload.now : null };
}

/** Random identifier of this browser as a listener (it does not identify the person; it can be deleted). */
export function newListenerId(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return [...random(12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Production help-signal server (Cloudflare Worker `days-signal`). */
export const DEFAULT_SIGNAL_URL = 'https://days-signal.xthecapx.workers.dev/';


/**
 * Which server this copy of the app uses. There is a single server and everything is real: no rooms, no test mode.
 *   - By default: the published server.
 *   - `vite dev`: the LOCAL server (`npm run signal:dev`, port 8787), because the published one does not accept requests from
 *     `localhost` (CORS). This is the only special case.
 *   - `override` = { baseUrl } stored in this browser, to point at another server (or at none: baseUrl "").
 */
export function resolveSignalConfig({ dev = false, hostname = 'localhost', override = null } = {}) {
  if (override && typeof override.baseUrl === 'string') return { baseUrl: override.baseUrl.trim() };
  if (dev) return { baseUrl: `http://${hostname}:8787/` };
  return { baseUrl: DEFAULT_SIGNAL_URL };
}

/** Text for the person depending on the reason for the failure. */
export function apiErrorMessage(error) {
  switch (error) {
    case 'not_configured': return 'La señal de ayuda no está activada en esta versión.';
    case 'rate_limited': return 'Demasiados intentos seguidos. Espera un minuto.';
    case 'outside_area': return 'Tu ubicación está fuera del área del mapa.';
    case 'timeout': return 'El servidor tardó demasiado en responder.';
    case 'network': return 'Sin conexión con el servidor de ayuda.';
    default: return 'No se pudo contactar al servidor de ayuda.';
  }
}


/**
 * How the map's 🆘 button looks: the number of neighbours listening sits on the button, visible to everyone without opening anything.
 * It only exists if there is a signal server; the number appears once the first response has arrived (before that it would be a false "0").
 * Pure: returns data, does not touch the DOM.
 */
export function helpButtonView({ enabled = false, loaded = false, listeners = 0 } = {}) {
  const n = Number.isFinite(listeners) ? Math.max(0, Math.floor(listeners)) : 0;
  return {
    hidden: !enabled,
    badgeHidden: !(enabled && loaded),
    badge: n > 99 ? '99+' : String(n),
    badgeDim: n === 0, // 0 = nobody is listening: it is dimmed so it does not look like someone is
    label: `Pedir ayuda a los vecinos${loaded ? `. ${listenersLabel(n)}` : ''}`
  };
}
