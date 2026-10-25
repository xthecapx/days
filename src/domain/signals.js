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
 * Qué servidor usa esta copia de la app. Hay un solo servidor y todo es real: no hay salas ni modo de pruebas.
 *   - Por defecto: el servidor publicado.
 *   - `vite dev`: el servidor LOCAL (`npm run signal:dev`, puerto 8787), porque el publicado no acepta peticiones de
 *     `localhost` (CORS). Es el único caso especial.
 *   - `override` = { baseUrl } guardado en este navegador, para apuntar a otro servidor (o a ninguno: baseUrl "").
 */
export function resolveSignalConfig({ dev = false, hostname = 'localhost', override = null } = {}) {
  if (override && typeof override.baseUrl === 'string') return { baseUrl: override.baseUrl.trim() };
  if (dev) return { baseUrl: `http://${hostname}:8787/` };
  return { baseUrl: DEFAULT_SIGNAL_URL };
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


/**
 * Cómo se ve el botón 🆘 del mapa: la cifra de vecinos escuchando va sobre el botón, visible para todos sin abrir nada.
 * Solo existe si hay servidor de señal; la cifra aparece cuando ya llegó la primera respuesta (antes sería un "0" falso).
 * Puro: devuelve datos, no toca el DOM.
 */
export function helpButtonView({ enabled = false, loaded = false, listeners = 0 } = {}) {
  const n = Number.isFinite(listeners) ? Math.max(0, Math.floor(listeners)) : 0;
  return {
    hidden: !enabled,
    badgeHidden: !(enabled && loaded),
    badge: n > 99 ? '99+' : String(n),
    badgeDim: n === 0, // 0 = nadie escucha: se atenúa para que no parezca que hay alguien
    label: `Pedir ayuda a los vecinos${loaded ? `. ${listenersLabel(n)}` : ''}`
  };
}
