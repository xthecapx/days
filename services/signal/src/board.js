import { gpsToPixel } from '../../../src/map/gpsGrid.js';

/**
 * Reglas de la señal de ayuda. Sin red, sin Cloudflare y sin reloj propio: el almacén, la hora y los generadores de
 * id entran por parámetros, así todo se prueba en milisegundos. Para llevarlo a otro proveedor (Lambda, Cloud Run)
 * solo cambia quien llama a este archivo y el almacén.
 *
 * Privacidad: de una señal solo se guarda y se devuelve la CASILLA del mapa (~14 m), nunca las coordenadas
 * exactas ni la precisión. El identificador del cliente y el token de cancelación nunca salen en una respuesta.
 */

export const DEFAULTS = Object.freeze({
  signalTtlMs: 30 * 60_000, // una señal dura 30 min
  listenerTtlMs: 75_000, // quien escucha cuenta mientras haya sondeado en los últimos 75 s (sondea cada 30 s)
  maxSignals: 20,
  maxListeners: 1000
});

export class BoardError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'BoardError';
    this.status = status;
    this.code = code;
  }
}

const LISTENER_ID = /^[A-Za-z0-9_-]{8,64}$/;
const CLIENT_ID = /^[A-Za-z0-9_-]{8,128}$/;
const SIGNAL_ID = /^[A-Za-z0-9_-]{4,64}$/;

const randomHex = (bytes) => {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Comparación que no se corta en la primera diferencia (no delata cuántos caracteres acertó el que adivina). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Número de una coordenada. Acepta número o texto: los Atajos de iPhone mandan números como texto y, en un teléfono en
 * español, con coma decimal ("7,005"). Cualquier otra cosa da NaN.
 */
export function parseCoordinate(value) {
  let n = value;
  if (typeof n === 'string') {
    const s = n.trim().replace(/^(-?\d+),(\d+)$/, '$1.$2');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
    n = Number(s);
  }
  return typeof n === 'number' && Number.isFinite(n) ? n : NaN;
}

const publicSignal = (s) => ({ id: s.id, x: s.x, y: s.y, at: s.at, expiresAt: s.expiresAt });

export function createBoard({
  storage,
  now = Date.now,
  newId = () => randomHex(6),
  newToken = () => randomHex(16),
  config = {}
}) {
  const cfg = { ...DEFAULTS, ...config };
  /** quien escucha → cuándo deja de contar. Solo en memoria: si el servidor se reinicia, se recupera en ≤30 s. */
  const listeners = new Map();

  function sweep() {
    const t = now();
    storage.removeExpired(t);
    for (const [id, until] of listeners) if (until <= t) listeners.delete(id);
  }

  function state() {
    sweep();
    const signals = storage
      .list()
      .sort((a, b) => b.at - a.at)
      .map(publicSignal);
    return { now: now(), signals, listeners: listeners.size };
  }

  return {
    /** Estado público. NO registra a nadie como oyente. */
    state,

    /** Un sondeo. `listening: true` te cuenta como oyente; `false` te saca. */
    poll({ listener, listening } = {}) {
      if (typeof listener !== 'string' || !LISTENER_ID.test(listener)) {
        throw new BoardError(400, 'bad_listener', 'Identificador de oyente inválido.');
      }
      if (typeof listening !== 'boolean') {
        throw new BoardError(400, 'bad_listening', 'Falta indicar si estás escuchando (true o false).');
      }
      sweep();
      if (!listening) listeners.delete(listener);
      else if (listeners.has(listener) || listeners.size < cfg.maxListeners) listeners.set(listener, now() + cfg.listenerTtlMs);
      return state();
    },

    /** Crea la señal de `client` (reemplaza la que ya tuviera). Devuelve el token para poder cancelarla. */
    send({ client, lat, lng } = {}) {
      if (typeof client !== 'string' || !CLIENT_ID.test(client)) {
        throw new BoardError(400, 'bad_client', 'No se pudo identificar el envío.');
      }
      const la = parseCoordinate(lat);
      const ln = parseCoordinate(lng);
      if (!(Math.abs(la) <= 90 && Math.abs(ln) <= 180)) {
        throw new BoardError(400, 'bad_coordinates', 'La ubicación no es válida.');
      }
      const tile = gpsToPixel(la, ln);
      if (!tile.insideBounds) {
        throw new BoardError(422, 'outside_area', 'Esa ubicación está fuera del área del mapa.');
      }

      sweep();
      for (const s of storage.list()) if (s.client === client) storage.remove(s.id); // una por persona
      // Si el tablero está lleno cae la más antigua: una señal real nunca debe rechazarse por estar lleno.
      const rest = storage.list().sort((a, b) => a.at - b.at);
      while (rest.length >= cfg.maxSignals) storage.remove(rest.shift().id);

      const at = now();
      const signal = { id: newId(), client, token: newToken(), x: tile.pixelX, y: tile.pixelY, at, expiresAt: at + cfg.signalTtlMs };
      storage.save(signal);
      return { id: signal.id, cancelToken: signal.token, x: signal.x, y: signal.y, at, expiresAt: signal.expiresAt, listeners: listeners.size };
    },

    /** Retira una señal con el token que recibió quien la envió. */
    cancel({ id, token } = {}) {
      if (typeof id !== 'string' || !SIGNAL_ID.test(id) || typeof token !== 'string' || !token) {
        throw new BoardError(400, 'bad_cancel', 'Faltan el id o el token de la señal.');
      }
      sweep();
      const signal = storage.list().find((s) => s.id === id);
      if (!signal) throw new BoardError(404, 'not_found', 'Esa señal ya no existe.');
      if (!safeEqual(signal.token, token)) throw new BoardError(403, 'bad_token', 'No puedes cancelar esa señal.');
      storage.remove(id);
      return state();
    },

    /** Cuándo vence la primera señal (para programar la limpieza), o null si no hay ninguna. */
    nextExpiry() {
      sweep();
      const times = storage.list().map((s) => s.expiresAt);
      return times.length ? Math.min(...times) : null;
    }
  };
}
