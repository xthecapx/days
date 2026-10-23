/**
 * PUENTE ANÓNIMO CON MODERACIÓN (CLOUDFLARE WORKERS)
 *
 * Recibe un CAMBIO (nuevo incidente, edición o confirmación) y abre un Pull Request
 * contra la rama principal con ese cambio aplicado sobre el data/incidents.json actual.
 * Nada llega a `main` hasta que el dueño del repositorio hace merge del PR.
 *
 * Variables en Cloudflare (Workers & Pages -> days -> Settings -> Variables and Secrets):
 *   GITHUB_TOKEN  (secreto)  Token fine-grained SOLO para este repositorio, con permisos
 *                            "Contents: Read and write" y "Pull requests: Read and write".
 *   GITHUB_REPO   (opcional) "usuario/repo". Por defecto xthecapx/days.
 *   BASE_BRANCH   (opcional) Rama destino de los PR. Por defecto main.
 *   MAX_OPEN_REPORTS (opcional) Máximo de PR de reportes abiertos a la vez. Por defecto 10.
 *
 * Límites anti-spam:
 *   1. Ráfaga por visitante: binding REPORT_LIMITER (ver wrangler.jsonc). Es aproximado y solo
 *      admite ventanas de 10 o 60 s. La clave es un hash de la IP; la IP no se guarda.
 *   2. Tope de PR abiertos: si ya hay MAX_OPEN_REPORTS sin revisar, se rechazan nuevos reportes.
 *      Es exacto y no depende de quién envía, así que nadie puede llenar tu bandeja de revisión.
 *
 * Cuerpo esperado (POST, JSON):
 *   { "change": { "type": "create" | "edit" | "confirm", "incident": {...}, "id": "inc-001" },
 *     "commitMessage": "texto corto" }
 */

const FILE_PATH = 'data/incidents.json';
const MAX_BODY_BYTES = 20_000;
const BOUNDS = { south: 6.9, north: 7.1, west: -73.15, east: -72.98 };
const GRID = 200;
const IMPACTS = new Set(['seguridad', 'tranquilidad']);

const DEFAULT_MAX_OPEN_REPORTS = 10;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// ---------- utilidades ----------

const b64encode = (text) => {
  let binary = '';
  new TextEncoder().encode(text).forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
};
const b64decode = (b64) => {
  const binary = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
};

const clean = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim()
    .slice(0, max);

const isNum = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;

/** Deja pasar SOLO los campos conocidos y con la forma esperada: nada de campos inventados. */
function sanitizeIncident(raw) {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Falta el incidente.');
  const description = clean(raw.description, 500);
  if (!description) throw new HttpError(400, 'La descripción es obligatoria.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date || '')) throw new HttpError(400, 'Fecha inválida.');
  const time = /^\d{2}:\d{2}$/.test(raw.time || '') ? raw.time : '12:00';
  const severity = Math.round(Number(raw.severity));
  if (!(severity >= 1 && severity <= 5)) throw new HttpError(400, 'Gravedad inválida (1 a 5).');
  if (!Number.isInteger(raw.pixelX) || !Number.isInteger(raw.pixelY) || raw.pixelX < 0 || raw.pixelY < 0 || raw.pixelX >= GRID || raw.pixelY >= GRID) {
    throw new HttpError(400, 'Ubicación inválida.');
  }
  if (!isNum(raw.lat, BOUNDS.south, BOUNDS.north) || !isNum(raw.lng, BOUNDS.west, BOUNDS.east)) {
    throw new HttpError(400, 'Coordenadas fuera del área.');
  }
  return {
    date: raw.date,
    time,
    dateLabel: clean(raw.dateLabel, 80),
    dateConfirmed: Boolean(raw.dateConfirmed),
    timeConfirmed: Boolean(raw.timeConfirmed),
    impactType: IMPACTS.has(raw.impactType) ? raw.impactType : 'seguridad',
    category: clean(raw.category, 80) || 'Otro Incidente en el Sector',
    severity,
    pixelX: raw.pixelX,
    pixelY: raw.pixelY,
    lat: raw.lat,
    lng: raw.lng,
    sector: clean(raw.sector, 100),
    description,
    resolvedBy: raw.resolvedBy === 'policia' ? 'policia' : null
  };
}

/** Aplica el cambio al contenido actual de main. Devuelve { data, title, summary }. */
function applyChange(data, change) {
  if (!change || typeof change !== 'object') throw new HttpError(400, 'Falta el cambio (change).');
  const incidents = data.incidents;
  const now = new Date().toISOString();

  if (change.type === 'create') {
    const inc = sanitizeIncident(change.incident);
    const number = incidents.reduce((m, i) => Math.max(m, i.number || 0), 0) + 1;
    const id = `inc-${String(number).padStart(3, '0')}`;
    incidents.push({ id, number, ...inc, confirmations: 1, updatedAt: now });
    return { data, title: `Nuevo incidente #${number}: ${inc.category}`, summary: 'Nuevo incidente', inc, number };
  }

  if (change.type === 'edit') {
    const idx = incidents.findIndex((i) => i.id === change.incident?.id);
    if (idx < 0) throw new HttpError(404, 'El incidente a editar ya no existe en la rama principal.');
    const inc = sanitizeIncident(change.incident);
    const prev = incidents[idx];
    incidents[idx] = { ...prev, ...inc, updatedAt: now };
    return { data, title: `Edición del incidente #${prev.number}`, summary: 'Edición', inc, number: prev.number };
  }

  if (change.type === 'confirm') {
    const target = incidents.find((i) => i.id === change.id);
    if (!target) throw new HttpError(404, 'El incidente a confirmar ya no existe.');
    target.confirmations = (target.confirmations || 1) + 1;
    target.updatedAt = now;
    return { data, title: `Confirmación del incidente #${target.number}`, summary: 'Confirmación vecinal', number: target.number };
  }

  throw new HttpError(400, 'Tipo de cambio desconocido.');
}

/** El texto del vecino va dentro de un bloque de código: GitHub no avisa menciones (@usuario) ahí. */
function buildBody({ summary, inc, number }) {
  const lines = ['Reporte anónimo enviado desde la app. **No se publica hasta que se haga merge.**', '', `**Acción:** ${summary} (#${number})`];
  if (inc) {
    lines.push(
      `**Ubicación:** píxel (${inc.pixelX}, ${inc.pixelY}) · ${inc.lat}, ${inc.lng}`,
      `**Sector:** ${inc.sector.replace(/[`@]/g, '')}`,
      `**Categoría:** ${inc.category.replace(/[`@]/g, '')} · gravedad ${inc.severity}/5 · ${inc.impactType}`,
      `**Fecha:** ${inc.date} ${inc.time}${inc.dateConfirmed ? '' : ' (por confirmar)'}`,
      `**Atendido por la policía:** ${inc.resolvedBy ? 'sí' : 'no'}`,
      '',
      'Descripción (texto del vecino, sin procesar):',
      '```text',
      inc.description.replace(/`/g, "'"),
      '```'
    );
  }
  lines.push('', 'Para publicar: revisa el diff de `data/incidents.json` y haz merge. Para rechazar: cierra el PR.');
  return lines.join('\n');
}

// ---------- anti-spam ----------

/** Hash corto de la IP: sirve de clave del límite sin conservar la dirección. */
async function clientKey(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'desconocida';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`days-limiter:${ip}`));
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function assertBurstAllowed(request, env) {
  if (!env || !env.REPORT_LIMITER) return; // sin binding configurado, solo rige el tope de PR abiertos
  const { success } = await env.REPORT_LIMITER.limit({ key: await clientKey(request) });
  if (!success) throw new HttpError(429, 'Demasiados reportes seguidos. Intenta de nuevo en un minuto.');
}

async function assertRoomForReports(gh, env, baseBranch) {
  const max = Number(env && env.MAX_OPEN_REPORTS) || DEFAULT_MAX_OPEN_REPORTS;
  const open = await gh('LIST_PRS', `/pulls?state=open&base=${encodeURIComponent(baseBranch)}&per_page=100`);
  const pending = open.filter((p) => p.head && String(p.head.ref).startsWith('reporte/')).length;
  if (pending >= max) {
    throw new HttpError(429, 'Hay muchos reportes pendientes de revisión. Intenta de nuevo más tarde.');
  }
}

// ---------- GitHub ----------

function githubClient(token, repo) {
  const base = `https://api.github.com/repos/${repo}`;
  return async function gh(step, path, init = {}) {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Vecinos-Rio-Del-Hato-Anonymous-Wiki-Bot',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers
      }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new HttpError(502, `GitHub respondió ${res.status} en ${step}`, { step, detail: text.slice(0, 300) });
    }
    return res.json();
  };
}

async function openPullRequest(env, change, commitMessage) {
  const repo = ((env && env.GITHUB_REPO) || 'xthecapx/days').trim();
  const baseBranch = ((env && env.BASE_BRANCH) || 'main').trim();
  const token = ((env && env.GITHUB_TOKEN) || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!token) throw new HttpError(500, 'Falta configurar la variable GITHUB_TOKEN en Cloudflare.');
  const gh = githubClient(token, repo);

  await assertRoomForReports(gh, env, baseBranch);

  // 1. Estado actual de la rama principal y del archivo
  const ref = await gh('GET_REF', `/git/ref/heads/${baseBranch}`);
  const file = await gh('GET_FILE', `/contents/${FILE_PATH}?ref=${encodeURIComponent(baseBranch)}`);
  const current = JSON.parse(b64decode(file.content));
  if (!Array.isArray(current.incidents)) throw new HttpError(502, 'El incidents.json de la rama principal no tiene el formato esperado.');

  // 2. Aplicar el cambio sobre ESE contenido (nunca sobre datos del navegador del vecino)
  const { data, title, summary, inc, number } = applyChange(current, change);

  // 3. Rama nueva -> commit -> PR
  const branch = `reporte/${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
  await gh('CREATE_BRANCH', '/git/refs', {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha })
  });
  await gh('PUT_FILE', `/contents/${FILE_PATH}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: clean(commitMessage, 120) || `Reporte vecinal: ${title}`,
      content: b64encode(JSON.stringify(data, null, 2) + '\n'),
      sha: file.sha,
      branch,
      committer: { name: 'Vecinos Río del Hato (Anónimo)', email: 'anonimo@vecinos-rio-del-hato.local' }
    })
  });
  const pr = await gh('CREATE_PR', '/pulls', {
    method: 'POST',
    body: JSON.stringify({
      title: `Reporte vecinal: ${title}`.replace(/@/g, '').slice(0, 120),
      head: branch,
      base: baseBranch,
      body: buildBody({ summary, inc, number })
    })
  });
  return { url: pr.html_url, number: pr.number, branch };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (request.method !== 'POST') {
      return json({ ok: true, message: 'Usa POST para enviar un reporte (se abre un Pull Request).', hasGithubTokenConfigured: Boolean(env && env.GITHUB_TOKEN), burstLimiterConfigured: Boolean(env && env.REPORT_LIMITER) }, 405);
    }

    try {
      await assertBurstAllowed(request, env);
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'Solicitud demasiado grande.');
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new HttpError(400, 'JSON inválido.');
      }
      if (!body || !body.change) throw new HttpError(400, 'Falta "change".');

      const pr = await openPullRequest(env, body.change, body.commitMessage);
      return json({ ok: true, pr });
    } catch (err) {
      if (err instanceof HttpError) return json({ ok: false, error: err.message, ...err.extra }, err.status);
      return json({ ok: false, error: err.message }, 500);
    }
  }
};
