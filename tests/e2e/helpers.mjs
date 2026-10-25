import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Chrome installed on the machine (or the CI one). Returns null if there is none: browser tests are skipped. */
export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ];
  return candidates.find((p) => p && existsSync(p)) || null;
}

/** Builds the site with Vite into a temporary folder and serves it with `vite preview`. Returns { url, stop }. */
export async function serveBuiltSite() {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-site-'));
  execFileSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dir, '--emptyOutDir'], { cwd: ROOT, stdio: 'pipe' });
  const port = 4300 + Math.floor(Math.random() * 500);
  // `vite` is launched directly (not `npx`): with npx, `kill()` kills the wrapper and the server stays alive on Linux,
  // and since its standard output also stays attached to the test process, Node never exits (hung CI).
  const proc = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', dir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* still starting up */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { url, stop: () => { proc.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); } };
}

/** Opens a mobile page with fake GPS and no internet access (GitHub and fonts are blocked). */
/** Default state of the fake signal server: no alerts. */
export const emptySignalState = () => ({ ok: true, now: Date.now(), signals: [], listeners: 0 });

export async function openApp(browser, url, { geo = { latitude: 7.005, longitude: -73.064, accuracy: 9 }, blockMap = false, intercept = null, signalServer = null } = {}) {
  // One context per page: what a test stores in the browser (alert sent, listening on) does not carry over to the next one.
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on('close', () => context.close().catch(() => {}));
  await page.setViewport({ width: 390, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const text = m.text();
    // What is blocked on purpose (no internet in the test) does not count as an app failure.
    if (m.type() === 'error' && !/ERR_FAILED|ERR_BLOCKED|net::ERR_/.test(text)) problems.push(`console: ${text}`);
    if (/Content Security Policy|Refused to/i.test(text)) problems.push(`CSP: ${text}`);
  });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    if (intercept?.(r)) return; // the test handled it
    // The signal server is never really called from tests: it is answered here (and what was requested is recorded).
    if (u.includes('days-signal.xthecapx.workers.dev') || u.includes(':8787/')) {
      const pathname = new URL(u).pathname;
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
      // The browser's CORS preflight (OPTIONS) has no body and does not count as an app request.
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
 * Opens the app and waits until it is truly ready (days computed and incidents loaded), instead of waiting for the
 * network to "settle" (`networkidle0`): on Linux that signal sometimes never arrives and each test would wait 20 s.
 */
export async function loadApp(page, url, { timeout = 15000 } = {}) {
  await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForFunction(
    () => document.getElementById('daysValue')?.textContent !== '--' && Number(document.getElementById('navCount')?.textContent) > 0,
    { timeout }
  );
}

/** Waits for an element to be visible or hidden (the app's `hidden` class), without fixed pauses. */
export const waitHidden = (page, selector, hidden, timeout = 5000) =>
  page.waitForFunction((s, h) => document.querySelector(s)?.classList.contains('hidden') === h, { timeout }, selector, hidden);
