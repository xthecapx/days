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
  execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir'], { cwd: ROOT, stdio: 'pipe' });
  const port = 4300 + Math.floor(Math.random() * 500);
  const proc = spawn('npx', ['vite', 'preview', '--outDir', dir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'pipe' });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* aún arrancando */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { url, stop: () => { proc.kill(); rmSync(dir, { recursive: true, force: true }); } };
}

/** Abre una página móvil con GPS falso y sin salir a internet (GitHub y fuentes se bloquean). */
export async function openApp(browser, url, { geo = { latitude: 7.005, longitude: -73.064, accuracy: 9 }, blockMap = false, intercept = null } = {}) {
  const page = await browser.newPage();
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
