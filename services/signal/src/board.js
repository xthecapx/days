import { gpsToPixel } from '../../../src/map/gpsGrid.js';

/**
 * Rules of the help signal. No network, no Cloudflare and no clock of its own: the storage, the time and the id
 * generators come in as parameters, so everything is tested in milliseconds. To move it to another provider (Lambda,
 * Cloud Run) only the caller of this file and the storage change.
 *
 * Privacy: of a signal only the map TILE (~14 m) is stored and returned, never the exact coordinates or the
 * accuracy. The client identifier and the cancel token never appear in a response.
 */

export const DEFAULTS = Object.freeze({
  signalTtlMs: 30 * 60_000, // a signal lasts 30 min
  listenerTtlMs: 75_000, // a listener counts as long as they have polled in the last 75 s (they poll every 30 s)
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

/** Comparison that does not stop at the first difference (it does not reveal how many characters the guesser got right). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Number from a coordinate. Accepts a number or text: iPhone Shortcuts send numbers as text and, on a phone set to
 * Spanish, with a decimal comma ("7,005"). Anything else gives NaN.
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
  /** listener → when they stop counting. In memory only: if the server restarts, it recovers in ≤30 s. */
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
    /** Public state. Does NOT register anyone as a listener. */
    state,

    /** A poll. `listening: true` counts you as a listener; `false` removes you. */
    poll({ listener, listening } = {}) {
      if (typeof listener !== 'string' || !LISTENER_ID.test(listener)) {
        throw new BoardError(400, 'bad_listener', 'Invalid listener identifier.');
      }
      if (typeof listening !== 'boolean') {
        throw new BoardError(400, 'bad_listening', 'Missing whether you are listening (true or false).');
      }
      sweep();
      if (!listening) listeners.delete(listener);
      else if (listeners.has(listener) || listeners.size < cfg.maxListeners) listeners.set(listener, now() + cfg.listenerTtlMs);
      return state();
    },

    /** Creates the signal of `client` (replacing any it already had). Returns the token needed to cancel it. */
    send({ client, lat, lng } = {}) {
      if (typeof client !== 'string' || !CLIENT_ID.test(client)) {
        throw new BoardError(400, 'bad_client', 'The sender could not be identified.');
      }
      const la = parseCoordinate(lat);
      const ln = parseCoordinate(lng);
      if (!(Math.abs(la) <= 90 && Math.abs(ln) <= 180)) {
        throw new BoardError(400, 'bad_coordinates', 'The location is not valid.');
      }
      const tile = gpsToPixel(la, ln);
      if (!tile.insideBounds) {
        throw new BoardError(422, 'outside_area', 'That location is outside the map area.');
      }

      sweep();
      for (const s of storage.list()) if (s.client === client) storage.remove(s.id); // one per person
      // If the board is full the oldest one drops: a real signal must never be rejected because the board is full.
      const rest = storage.list().sort((a, b) => a.at - b.at);
      while (rest.length >= cfg.maxSignals) storage.remove(rest.shift().id);

      const at = now();
      const signal = { id: newId(), client, token: newToken(), x: tile.pixelX, y: tile.pixelY, at, expiresAt: at + cfg.signalTtlMs };
      storage.save(signal);
      return { id: signal.id, cancelToken: signal.token, x: signal.x, y: signal.y, at, expiresAt: signal.expiresAt, listeners: listeners.size };
    },

    /** Removes a signal using the token its sender received. */
    cancel({ id, token } = {}) {
      if (typeof id !== 'string' || !SIGNAL_ID.test(id) || typeof token !== 'string' || !token) {
        throw new BoardError(400, 'bad_cancel', 'The signal id or token is missing.');
      }
      sweep();
      const signal = storage.list().find((s) => s.id === id);
      if (!signal) throw new BoardError(404, 'not_found', 'That signal no longer exists.');
      if (!safeEqual(signal.token, token)) throw new BoardError(403, 'bad_token', 'You cannot cancel that signal.');
      storage.remove(id);
      return state();
    },

    /** When the first signal expires (to schedule cleanup), or null if there are none. */
    nextExpiry() {
      sweep();
      const times = storage.list().map((s) => s.expiresAt);
      return times.length ? Math.min(...times) : null;
    }
  };
}
