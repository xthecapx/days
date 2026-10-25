import { runBoard } from './rpc.js';

/**
 * HTTP layer of the signal server: routes, CORS, limits, body reading. It imports nothing from Cloudflare, so it is
 * tested entirely in Node. It receives `getBoard()` → { run(op, input) } (in production, the server's single Durable Object).
 */

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

// ---------- origin (CORS) ----------

function isLocalHost(host) {
  return (
    host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') ||
    /^10\.\d+\.\d+\.\d+$/.test(host) || /^192\.168\.\d+\.\d+$/.test(host) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)
  );
}

/** Browsers send `Origin`; phone Shortcuts and curl do not. An unknown origin is rejected. */
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

// ---------- anonymous client identity ----------

/**
 * Hash of the IP with a secret (`SIGNAL_PEPPER`): used for "one signal per person" and for the rate limit without
 * storing the IP. With the secret, the IP cannot be guessed from the hash by walking all 4 billion IPv4
 * addresses; without it, it can. It never appears in a response.
 */
export async function clientHash(request, env = {}) {
  const ip = request.headers.get('CF-Connecting-IP') || 'desconocida';
  const pepper = env.SIGNAL_PEPPER || 'sin-pepper-configurado';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`days-signal:${pepper}:${ip}`));
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- body ----------

async function readLimited(request, max) {
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > max) throw new HttpError(413, 'too_large', 'Request too large.');
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
      throw new HttpError(413, 'too_large', 'Request too large.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** JSON, form or multipart (the "Form" of iPhone Shortcuts). Always returns a plain object. */
async function readBody(request) {
  const header = request.headers.get('Content-Type') || '';
  let type = header.split(';')[0].trim().toLowerCase();
  const known = ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data'];
  // Without a Content-Type header (some simple clients do not send it) the type is guessed from the content. With a header of
  // another type (e.g. text/plain) it is still rejected: that is a mistake by the sender.
  if (type && !known.includes(type)) throw new HttpError(415, 'bad_content_type', 'Send JSON (application/json) or a form.');
  const bytes = await readLimited(request, MAX_BODY);
  if (!type) type = new TextDecoder().decode(bytes).trimStart().startsWith('{') ? 'application/json' : 'application/x-www-form-urlencoded';
  try {
    if (type === 'application/json') {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      return parsed;
    }
    if (type === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(new TextDecoder().decode(bytes)));
    const form = await new Response(bytes, { headers: { 'Content-Type': header } }).formData();
    return Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'));
  } catch {
    throw new HttpError(400, 'bad_body', 'The request body is not valid.');
  }
}

// ---------- routes ----------

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
    return false; // if the limiter fails, a help request is not blocked
  }
}

export async function handle(request, env = {}, { getBoard }) {
  const origin = request.headers.get('Origin');
  let cors = {};
  if (origin) {
    if (!originAllowed(origin, env)) return fail(403, 'origin_not_allowed', 'Origin not allowed.');
    cors = corsHeaders(origin);
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...BASE_HEADERS, ...cors } });

  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const route = ROUTES[`${request.method} ${path}`];
    if (!route) {
      const allowed = Object.keys(ROUTES).filter((k) => k.endsWith(` ${path}`)).map((k) => k.split(' ')[0]);
      if (allowed.length) return fail(405, 'method_not_allowed', 'Method not allowed.', { ...cors, Allow: allowed.join(', ') });
      return fail(404, 'not_found', 'Not found.', cors);
    }

    if (path === '/') {
      return respond({ ok: true, service: 'days-signal', pepperConfigured: Boolean(env.SIGNAL_PEPPER), limiters: { signal: Boolean(env.SIGNAL_LIMITER), poll: Boolean(env.POLL_LIMITER) } }, 200, cors);
    }

    const client = await clientHash(request, env);
    if (await overLimit(env, route.limiter, client)) {
      return fail(429, 'rate_limited', 'Too many requests in a row. Wait a minute.', { ...cors, 'Retry-After': '60' });
    }

    const body = route.pick ? route.pick(await readBody(request)) : undefined;
    const result = await getBoard().run(route.op, route.withClient ? { ...body, client } : body);
    if (!result.ok) return fail(result.status, result.code, result.message, cors);
    return respond({ ok: true, ...result.data }, 200, cors);
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.code, err.message, { ...cors, ...err.headers });
    return fail(500, 'internal', 'Internal error.', cors);
  }
}

export { runBoard };
