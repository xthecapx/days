/**
 * Reglas puras de la señal de ayuda en la interfaz: textos, comparaciones y validaciones. Sin DOM, sin red.
 * (Las reglas del servidor viven en services/signal/src/board.js.)
 */

/** "hace un momento", "hace 3 min", "hace 1 h 5 min"… a partir de la hora de la señal y la de ahora (ms). */
export function ageLabel(at, now) {
  const mins = Math.floor(Math.max(0, now - at) / 60_000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `hace ${h} h ${m} min` : `hace ${h} h`;
}

/** Cuántos vecinos escuchan, en palabras. */
export function listenersLabel(count) {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (n === 0) return 'Nadie escucha ahora';
  return n === 1 ? '1 vecino escucha' : `${n} vecinos escuchan`;
}

/** Aviso que se muestra antes de enviar, según haya o no quien escuche. */
export function sendHint(listeners) {
  return listeners > 0
    ? `${listenersLabel(listeners)} y verán tu alerta en el mapa.`
    : 'Nadie tiene la escucha activa ahora. Si es una emergencia, llama al 123 o usa WhatsApp.';
}

/** Señales que no se habían visto aún. `seen` es un Set de ids. */
export const newSignals = (signals, seen) => signals.filter((s) => !seen.has(s.id));

/** ¿Es la señal que envié yo? (`mine` = { id } guardado en este navegador.) */
export const isMine = (signal, mine) => Boolean(mine && signal && mine.id === signal.id);

/** ¿Sigue vigente mi última señal? */
export const isActive = (mine, now) => Boolean(mine && Number.isFinite(mine.expiresAt) && mine.expiresAt > now);

/**
 * Convierte la respuesta del servidor en lo que guarda la interfaz. Defiende a la pantalla de datos raros:
 * cualquier señal sin forma válida se descarta en vez de romper el dibujo.
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

/** Identificador aleatorio de este navegador como oyente (no identifica a la persona; se puede borrar). */
export function newListenerId(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return [...random(12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Servidor de producción de la señal de ayuda (Cloudflare Worker `days-signal`). */
export const DEFAULT_SIGNAL_URL = 'https://days-signal.xthecapx.workers.dev/';

/**
 * Qué servidor y qué sala usa esta copia de la app.
 *   - Sitio publicado: el servidor real, sala "main".
 *   - Desarrollo (`vite dev`): el servidor LOCAL (`npm run signal:dev`, puerto 8787) y la sala "dev", así probar nunca avisa
 *     a los vecinos de verdad, ni siquiera desde un celular conectado a tu red.
 *   - `override` = { baseUrl, room } guardado en este navegador, para apuntar a otro servidor (o a ninguno: baseUrl "").
 */
export function resolveSignalConfig({ dev = false, hostname = 'localhost', override = null } = {}) {
  if (override && typeof override.baseUrl === 'string') {
    return { baseUrl: override.baseUrl.trim(), room: override.room === 'main' ? 'main' : 'dev' };
  }
  if (dev) return { baseUrl: `http://${hostname}:8787/`, room: 'dev' };
  // Un sitio construido pero servido desde esta máquina o una red local (`vite preview`, pruebas en el navegador) NO es el
  // sitio real: usa la sala "dev" para no avisar a los vecinos de verdad. Servidor real = solo desde el dominio publicado.
  if (isLocalHostname(hostname)) return { baseUrl: DEFAULT_SIGNAL_URL, room: 'dev' };
  return { baseUrl: DEFAULT_SIGNAL_URL, room: 'main' };
}

/** localhost, direcciones de red local y nombres .local. */
export function isLocalHostname(host) {
  return (
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local') ||
    /^10\.\d+\.\d+\.\d+$/.test(host) || /^192\.168\.\d+\.\d+$/.test(host) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)
  );
}

/** Texto para la persona según el motivo del fallo. */
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
