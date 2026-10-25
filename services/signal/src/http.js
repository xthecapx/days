import { runBoard } from './rpc.js';

/**
 * Capa HTTP del servidor de señal: rutas, CORS, límites, lectura del cuerpo. No importa nada de Cloudflare, así que se
 * prueba entera en Node. Recibe `getBoard(room)` → { run(op, input) } (en producción, el Durable Object de esa sala).
 */

export const ROOMS = Object.freeze(['main', 'dev']);
export const MAX_BODY = 2048;
const DEFAULT_ORIGINS = 'https://xthecapx.github.io';
const BASE_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

class HttpError extends Error {
  constructor(status, code, message, headers) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

const respond = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...extra } });
const fail = (status, code, message, extra) => respond({ ok: false, code, error: message }, status, extra);

// ---------- origen (CORS) ----------

function isLocalHost(host) {
  return (
    host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') ||
    /^10\.\d+\.\d+\.\d+$/.test(host) || /^192\.168\.\d+\.\d+$/.test(host) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)
  );
}

/** Los navegadores mandan `Origin`; los Atajos del teléfono y curl no. Un origen desconocido se rechaza. */
export function originAllowed(origin, env = {}) {
  const list = String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes(origin)) return true;
  if (String(env.ALLOW_LOCAL) === 'true') {
    try {
      const u = new URL(origin);
      return u.protocol === 'http:' && isLocalHost(u.hostname);
    } catch {
      return false;
    }
  }
  return false;
}

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': origin,
  Vary: 'Origin',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600'
});

// ---------- identidad anónima del cliente ----------

/**
 * Hash de la IP con un secreto (`SIGNAL_PEPPER`): sirve para "una señal por persona" y para el límite de ritmo sin
 * guardar la IP. Con el secreto, adivinar la IP a partir del hash no se puede hacer recorriendo las 4 000 millones de
 * IPv4; sin él, sí. Nunca sale en una respuesta.
 */
export async function clientHash(request, env = {}) {
  const ip = request.headers.get('CF-Connecting-IP') || 'desconocida';
  const pepper = env.SIGNAL_PEPPER || 'sin-pepper-configurado';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`days-signal:${pepper}:${ip}`));
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- cuerpo ----------

async function readLimited(request, max) {
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > max) throw new HttpError(413, 'too_large', 'Solicitud demasiado grande.');
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, 'too_large', 'Solicitud demasiado grande.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** JSON, formulario o multipart (el "Formulario" de los Atajos de iPhone). Siempre devuelve un objeto plano. */
async function readBody(request) {
  const header = request.headers.get('Content-Type') || '';
  let type = header.split(';')[0].trim().toLowerCase();
  const known = ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data'];
  // Sin cabecera Content-Type (algunos clientes simples no la mandan) se adivina por el contenido. Con una cabecera de otro
  // tipo (p. ej. text/plain) se sigue rechazando: eso sí es un error del que envía.
  if (type && !known.includes(type)) throw new HttpError(415, 'bad_content_type', 'Envía JSON (application/json) o un formulario.');
  const bytes = await readLimited(request, MAX_BODY);
  if (!type) type = new TextDecoder().decode(bytes).trimStart().startsWith('{') ? 'application/json' : 'application/x-www-form-urlencoded';
  try {
    if (type === 'application/json') {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('no es un objeto');
      return parsed;
    }
    if (type === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(new TextDecoder().decode(bytes)));
    const form = await new Response(bytes, { headers: { 'Content-Type': header } }).formData();
    return Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'));
  } catch {
    throw new HttpError(400, 'bad_body', 'El cuerpo de la solicitud no es válido.');
  }
}

// ---------- rutas ----------

const ROUTES = {
  'GET /': { limiter: null },
  'GET /state': { op: 'state', limiter: 'POLL_LIMITER' },
  'POST /poll': { op: 'poll', limiter: 'POLL_LIMITER', pick: (b) => ({ listener: b.listener, listening: b.listening }) },
  'POST /signal': { op: 'send', limiter: 'SIGNAL_LIMITER', pick: (b) => ({ lat: b.lat, lng: b.lng }), withClient: true },
  'POST /signal/cancel': { op: 'cancel', limiter: 'SIGNAL_LIMITER', pick: (b) => ({ id: b.id, token: b.token }) }
};

async function overLimit(env, name, key) {
  const limiter = name && env[name];
  if (!limiter) return false;
  try {
    return !(await limiter.limit({ key })).success;
  } catch {
    return false; // si el limitador falla, una petición de ayuda no se bloquea
  }
}

export async function handle(request, env = {}, { getBoard }) {
  const origin = request.headers.get('Origin');
  let cors = {};
  if (origin) {
    if (!originAllowed(origin, env)) return fail(403, 'origin_not_allowed', 'Origen no permitido.');
    cors = corsHeaders(origin);
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...BASE_HEADERS, ...cors } });

  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const route = ROUTES[`${request.method} ${path}`];
    if (!route) {
      const allowed = Object.keys(ROUTES).filter((k) => k.endsWith(` ${path}`)).map((k) => k.split(' ')[0]);
      if (allowed.length) return fail(405, 'method_not_allowed', 'Método no permitido.', { ...cors, Allow: allowed.join(', ') });
      return fail(404, 'not_found', 'No existe.', cors);
    }

    if (path === '/') {
      return respond({ ok: true, service: 'days-signal', rooms: ROOMS, pepperConfigured: Boolean(env.SIGNAL_PEPPER), limiters: { signal: Boolean(env.SIGNAL_LIMITER), poll: Boolean(env.POLL_LIMITER) } }, 200, cors);
    }

    const room = url.searchParams.get('room') ?? 'main';
    if (!ROOMS.includes(room)) return fail(400, 'bad_room', `La sala debe ser una de: ${ROOMS.join(', ')}.`, cors);

    const client = await clientHash(request, env);
    if (await overLimit(env, route.limiter, client)) {
      return fail(429, 'rate_limited', 'Demasiadas solicitudes seguidas. Espera un minuto.', { ...cors, 'Retry-After': '60' });
    }

    const body = route.pick ? route.pick(await readBody(request)) : undefined;
    const result = await getBoard(room).run(route.op, route.withClient ? { ...body, client } : body);
    if (!result.ok) return fail(result.status, result.code, result.message, cors);
    return respond({ ok: true, ...result.data }, 200, cors);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.code, err.message, { ...cors, ...err.headers });
    return fail(500, 'internal', 'Error interno.', cors);
  }
}

export { runBoard };
