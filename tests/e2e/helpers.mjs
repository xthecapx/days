import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Chrome instalado en la máquina (o el de CI). Devuelve null si no hay: las pruebas de navegador se omiten. */
export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ];
  return candidates.find((p) => p && existsSync(p)) || null;
}

/** Construye el sitio con Vite en una carpeta temporal y lo sirve con `vite preview`. Devuelve { url, stop }. */
export async function serveBuiltSite() {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-site-'));
  execFileSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dir, '--emptyOutDir'], { cwd: ROOT, stdio: 'pipe' });
  const port = 4300 + Math.floor(Math.random() * 500);
  // Se lanza `vite` directo (no `npx`): con npx, `kill()` mata al envoltorio y el servidor queda vivo en Linux,
  // y como además su salida estándar sigue conectada al proceso de prueba, Node nunca termina (CI colgado).
  const proc = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', dir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* aún arrancando */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { url, stop: () => { proc.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); } };
}

/** Abre una página móvil con GPS falso y sin salir a internet (GitHub y fuentes se bloquean). */
/** Estado por defecto del servidor de señal falso: sin alertas. */
export const emptySignalState = () => ({ ok: true, now: Date.now(), signals: [], listeners: 0 });

export async function openApp(browser, url, { geo = { latitude: 7.005, longitude: -73.064, accuracy: 9 }, blockMap = false, intercept = null, signalServer = null } = {}) {
  // Un contexto propio por página: lo que una prueba guarda en el navegador (alerta enviada, escucha activada) no pasa a la siguiente.
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on('close', () => context.close().catch(() => {}));
  await page.setViewport({ width: 390, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const text = m.text();
    // Lo bloqueado a propósito (sin internet en la prueba) no cuenta como fallo de la app.
    if (m.type() === 'error' && !/ERR_FAILED|ERR_BLOCKED|net::ERR_/.test(text)) problems.push(`console: ${text}`);
    if (/Content Security Policy|Refused to/i.test(text)) problems.push(`CSP: ${text}`);
  });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    if (intercept?.(r)) return; // la prueba lo resolvió
    // El servidor de señal jamás se llama de verdad desde las pruebas: se responde aquí (y se anota qué se pidió).
    if (u.includes('days-signal.xthecapx.workers.dev') || u.includes(':8787/')) {
      const pathname = new URL(u).pathname;
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
      // La precomprobación CORS (OPTIONS) del navegador no lleva cuerpo ni cuenta como una petición de la app.
      if (r.method() === 'OPTIONS') return r.respond({ status: 204, headers: cors });
      signalServer?.calls.push(`${r.method()} ${pathname}${new URL(u).search}`);
      const body = signalServer?.respond ? signalServer.respond(pathname, r) : emptySignalState();
      return r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    }
    if (u.includes('raw.githubusercontent.com') || u.includes('fonts.g')) return r.abort();
    if (blockMap && u.includes('/data/map.json')) return r.abort();
    r.continue();
  });
  if (geo) {
    await page.evaluateOnNewDocument((g) => {
      navigator.geolocation.getCurrentPosition = (ok) => setTimeout(() => ok({ coords: g }), 30);
    }, geo);
  }
  return { page, problems };
}

/**
 * Abre la app y espera a que de verdad esté lista (días calculados e incidentes cargados), en vez de esperar a que la
 * red "se calme" (`networkidle0`): en Linux esa señal a veces no llega nunca y cada prueba se quedaba 20 s esperando.
 */
export async function loadApp(page, url, { timeout = 15000 } = {}) {
  await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForFunction(
    () => document.getElementById('daysValue')?.textContent !== '--' && Number(document.getElementById('navCount')?.textContent) > 0,
    { timeout }
  );
}

/** Espera a que un elemento esté visible u oculto (la clase `hidden` de la app), sin pausas fijas. */
export const waitHidden = (page, selector, hidden, timeout = 5000) =>
  page.waitForFunction((s, h) => document.querySelector(s)?.classList.contains('hidden') === h, { timeout }, selector, hidden);
