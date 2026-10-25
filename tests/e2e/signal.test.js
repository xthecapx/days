import test from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, serveBuiltSite, openApp, loadApp, waitHidden } from './helpers.mjs';

const chrome = findChrome();
const skip = chrome ? false : 'no hay Chrome instalado (define CHROME_PATH para correr estas pruebas)';

let browser;
let site;
test.before(async () => {
  if (!chrome) return;
  const { default: puppeteer } = await import('puppeteer-core');
  site = await serveBuiltSite();
  browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
});
test.after(async () => {
  await browser?.close();
  site?.stop();
});

const text = (page, sel) => page.$eval(sel, (e) => e.textContent);

/** Opens the help sheet and waits until it is truly on screen (it enters with an animation). */
async function openHelp(page) {
  await page.click('#btnHelp');
  await waitHidden(page, '#paneHelp', false);
  await page.waitForSelector('#btnHelpSend', { visible: true });
}
/** Presses "Pedir ayuda" and waits for the confirmation to appear. */
async function askForHelp(page) {
  await page.click('#btnHelpSend');
  await waitHidden(page, '#helpConfirm', false);
  await page.waitForSelector('#btnHelpYes', { visible: true });
}
const visible = (page, sel) => page.$eval(sel, (e) => !e.classList.contains('hidden'));

/** Fake signal server with mutable state and a log of what was requested. */
function fakeServer(initial = {}) {
  const server = { calls: [], signals: [], listeners: 0, ...initial };
  server.respond = (pathname, request) => {
    if (pathname === '/signal' && request.method() === 'POST') {
      const body = JSON.parse(request.postData());
      server.sent = body;
      const s = { id: 'mia00001', x: 92, y: 120, at: Date.now(), expiresAt: Date.now() + 30 * 60_000 };
      server.signals = [s, ...server.signals];
      return { ok: true, id: s.id, cancelToken: 'token-de-prueba-123', x: s.x, y: s.y, at: s.at, expiresAt: s.expiresAt, listeners: server.listeners };
    }
    if (pathname === '/signal/cancel') { server.signals = server.signals.filter((s) => s.id !== JSON.parse(request.postData()).id); }
    if (pathname === '/poll') { const b = JSON.parse(request.postData()); server.listeners = b.listening ? 3 : Math.max(0, server.listeners - 1); }
    return { ok: true, now: Date.now(), signals: server.signals, listeners: server.listeners };
  };
  return server;
}
const other = (minAgo = 3) => ({ id: 'otra0001', x: 95, y: 118, at: Date.now() - minAgo * 60_000, expiresAt: Date.now() + (30 - minAgo) * 60_000 });

test('published site: with the server active the 🆘 button and the listener counter appear', async () => {
  const signalServer = fakeServer({ listeners: 2 });
  const { page, problems } = await openApp(browser, site.url, { signalServer });
  await loadApp(page, site.url);
  await page.waitForFunction(() => !document.getElementById('btnHelp').classList.contains('hidden'));
  assert.equal(await visible(page, '#btnHelp'), true);
  await page.waitForFunction(() => !document.getElementById('listenersChip').classList.contains('hidden'));
  assert.match(await text(page, '#listenersChip'), /2 vecinos escuchan/);
  assert.deepEqual(signalServer.calls, ['GET /state'], 'a single read on opening');
  assert.deepEqual(problems, []);
  await page.close();
});

test('whoever reloads sees an active alert, even when not listening; and no polling happens', async () => {
  const signalServer = fakeServer({ signals: [other(3)], listeners: 1 });
  const { page, problems } = await openApp(browser, site.url, { signalServer });
  await loadApp(page, site.url);
  await page.waitForFunction(() => !document.getElementById('helpBanner').classList.contains('hidden'));
  assert.match(await text(page, '#helpBannerText'), /Alguien pidió ayuda hace 3 min/);
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(signalServer.calls.every((c) => c.startsWith('GET /state')), `reads only, no polling: ${signalServer.calls}`);
  assert.deepEqual(problems, []);
  await page.close();
});

test('the banner can be dismissed and "Ver en el mapa" centres the alert and closes the sheet', async () => {
  const signalServer = fakeServer({ signals: [other()] });
  const { page } = await openApp(browser, site.url, { signalServer });
  await loadApp(page, site.url);
  await page.waitForFunction(() => !document.getElementById('helpBanner').classList.contains('hidden'));
  await page.click('#btnHelpBannerView');
  const sel = await page.evaluate(() => window.__app?.store.get().selection.pixel ?? null);
  assert.equal(sel, null, 'the debugger does not exist on the published site, so it is checked through the interface');
  await page.click('#btnHelpBannerClose');
  await waitHidden(page, '#helpBanner', true);
  await page.close();
});

test('ask for help: confirmation, sending with the phone location, and it can be withdrawn', async () => {
  const signalServer = fakeServer({ listeners: 2 });
  const { page, problems } = await openApp(browser, site.url, { signalServer });
  await loadApp(page, site.url);
  await page.waitForFunction(() => document.getElementById('gpsDot').dataset.status === 'ok');
  await page.click('#btnHelp');
  await waitHidden(page, '#paneHelp', false);
  assert.match(await text(page, '#sheetTitle'), /Ayuda entre vecinos/);
  assert.match(await text(page, '#helpHint'), /2 vecinos escuchan y verán tu alerta/);

  await page.click('#btnHelpSend');
  await waitHidden(page, '#helpConfirm', false);
  assert.equal(await visible(page, '#btnHelpSend'), false, 'the red button is hidden while confirming');
  await page.click('#btnHelpNo');
  await waitHidden(page, '#helpConfirm', true);
  assert.equal(signalServer.sent, undefined, 'cancelling the confirmation sends nothing');

  await page.click('#btnHelpSend');
  await page.click('#btnHelpYes');
  await waitHidden(page, '#helpMine', false);
  assert.deepEqual(signalServer.sent, { lat: 7.005, lng: -73.064 });
  assert.match(await text(page, '#helpMineText'), /Vence en \d+ min/);
  assert.equal(await visible(page, '#btnHelpSend'), false, 'with an active alert, sending another is not offered');

  await page.click('#btnHelpCancel');
  await waitHidden(page, '#helpMine', true);
  assert.ok(signalServer.calls.some((c) => c.startsWith('POST /signal/cancel')));
  assert.equal(await visible(page, '#btnHelpSend'), true);
  assert.deepEqual(problems, []);
  await page.close();
});

test('the cancel token only lives in the browser of whoever sent', async () => {
  const signalServer = fakeServer();
  const { page } = await openApp(browser, site.url, { signalServer });
  await loadApp(page, site.url);
  await page.waitForFunction(() => document.getElementById('gpsDot').dataset.status === 'ok');
  await openHelp(page); await askForHelp(page); await page.click('#btnHelpYes');
  await waitHidden(page, '#helpMine', false);
  const dom = await page.evaluate(() => document.documentElement.outerHTML);
  assert.doesNotMatch(dom, /token-de-prueba-123/, 'the token appears nowhere on screen');
  const stored = await page.evaluate(() => localStorage.getItem('vecinos_rio_hato_signal_v1'));
  assert.match(stored, /token-de-prueba-123/);
  await page.close();
});

test('a double tap on "Sí, pedir ayuda" sends a single alert', async () => {
  const signalServer = fakeServer();
  const { page } = await openApp(browser, site.url, { signalServer });
  await loadApp(page, site.url);
  await page.waitForFunction(() => document.getElementById('gpsDot').dataset.status === 'ok');
  await openHelp(page); await askForHelp(page);
  await page.evaluate(() => { const b = document.getElementById('btnHelpYes'); b.click(); b.click(); b.click(); });
  await waitHidden(page, '#helpMine', false);
  assert.equal(signalServer.calls.filter((c) => c === 'POST /signal').length, 1, `calls: ${signalServer.calls}`);
  await page.close();
});

test('listen: it turns on, polls and is remembered on reload; turning it off notifies the server', async () => {
  const signalServer = fakeServer({ listeners: 0 });
  const { page, problems } = await openApp(browser, site.url, { signalServer });
  await loadApp(page, site.url);
  await openHelp(page);
  assert.equal(await page.$eval('#chkListen', (e) => e.checked), false);
  assert.match(await text(page, '#helpListenHint'), /Apagado/);

  await page.click('#chkListen');
  await page.waitForFunction(() => /Escuchando/.test(document.getElementById('helpListenHint').textContent));
  assert.ok(signalServer.calls.some((c) => c.startsWith('POST /poll')));
  assert.match(await text(page, '#helpListenHint'), /30 s/);
  assert.match(await text(page, '#helpListenHint'), /No funciona en segundo plano/);
  await page.waitForFunction(() => /3 vecinos escuchan/.test(document.getElementById('helpListeners').textContent));

  const calls = signalServer.calls.length;
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('daysValue').textContent !== '--');
  await page.waitForFunction(() => document.getElementById('chkListen') && true);
  await page.click('#btnHelp');
  await page.waitForFunction(() => document.getElementById('chkListen').checked === true);
  assert.ok(signalServer.calls.length > calls);

  await page.click('#chkListen');
  await page.waitForFunction(() => /Apagado/.test(document.getElementById('helpListenHint').textContent));
  assert.equal(signalServer.calls.at(-1).startsWith('POST /poll'), true, 'turning off notifies the server so it stops counting');
  assert.deepEqual(problems, []);
  await page.close();
});

test('if the signal server fails, the interface stays alive and says so', async () => {
  const signalServer = { calls: [], respond: () => { throw new Error('caído'); } };
  const { page } = await openApp(browser, site.url, { signalServer, intercept: (r) => {
    if (!r.url().includes('days-signal') && !r.url().includes(':8787')) return false;
    r.abort();
    return true;
  } });
  await loadApp(page, site.url);
  assert.match(await text(page, '#daysValue'), /^\d\d$/, 'the day counter works the same');
  await openHelp(page); await askForHelp(page); await page.click('#btnHelpYes');
  await page.waitForFunction(() => !document.getElementById('helpError').classList.contains('hidden'));
  assert.match(await text(page, '#helpError'), /123/, 'the real alternative always stays in view');
  await page.close();
});

test('the ?sos=1 shortcut opens the help screen directly', async () => {
  const { page } = await openApp(browser, site.url, { signalServer: fakeServer() });
  await page.goto(`${site.url}?sos=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('daysValue').textContent !== '--');
  await waitHidden(page, '#paneHelp', false);
  assert.match(await text(page, '#sheetTitle'), /Ayuda entre vecinos/);
  await page.close();
});

test('the manifest is valid and the icon can be installed on the home screen', async () => {
  const { page, problems } = await openApp(browser, site.url, { signalServer: fakeServer() });
  await loadApp(page, site.url);
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.shortcuts[0].url, './?sos=1');
  for (const icon of manifest.icons) assert.equal((await fetch(new URL(icon.src, site.url))).status, 200, icon.src);
  assert.equal((await fetch(new URL('apple-touch-icon.png', site.url))).status, 200);
  assert.deepEqual(problems, [], 'no "Manifest" errors in the console');
  await page.close();
});

test('the count of neighbours listening shows on the 🆘 button, without opening anything, and updates on listening', async () => {
  const signalServer = fakeServer({ listeners: 2 });
  const { page, problems } = await openApp(browser, site.url, { signalServer });
  await page.goto(site.url, { waitUntil: 'load' });
  // Before the first response there is no count.
  await page.waitForFunction(() => document.getElementById('daysValue').textContent !== '--');
  await page.waitForFunction(() => !document.getElementById('helpCount').classList.contains('hidden'));
  assert.equal(await text(page, '#helpCount'), '2');
  assert.match(await page.$eval('#btnHelp', (e) => e.getAttribute('aria-label')), /2 vecinos escuchan/);
  assert.equal(await page.$eval('#helpCount', (e) => e.classList.contains('dim')), false);
  // The count stays inside the screen and does not cover the button.
  const box = await page.$eval('#helpCount', (e) => { const r = e.getBoundingClientRect(); return [r.left >= 0, r.right <= innerWidth, r.top >= 0]; });
  assert.deepEqual(box, [true, true, true]);

  await openHelp(page);
  await page.click('#chkListen');
  await page.waitForFunction(() => document.getElementById('helpCount').textContent === '3');
  assert.deepEqual(problems, []);
  await page.close();
});

test('with nobody listening the count is 0 and shown dimmed', async () => {
  const { page } = await openApp(browser, site.url, { signalServer: fakeServer({ listeners: 0 }) });
  await loadApp(page, site.url);
  await page.waitForFunction(() => !document.getElementById('helpCount').classList.contains('hidden'));
  assert.equal(await text(page, '#helpCount'), '0');
  assert.equal(await page.$eval('#helpCount', (e) => e.classList.contains('dim')), true);
  await page.close();
});

test('tests never reach the real server: any call to days-signal is answered inside the test', async () => {
  // There is no test room any more: the protection is that the test browser intercepts the server address.
  const { page } = await openApp(browser, site.url); // no fake server: the default empty one is used
  const reached = [];
  page.on('response', (r) => { if (r.url().includes('days-signal.xthecapx.workers.dev') && r.headers()['server'] === 'cloudflare') reached.push(r.url()); });
  await loadApp(page, site.url);
  await page.waitForFunction(() => !document.getElementById('btnHelp').classList.contains('hidden'));
  assert.deepEqual(reached, [], 'no response came from the Cloudflare server');
  await page.close();
});

// ---------- SOS mode (listening) vs history ----------

/** Counts non-background pixels in a region of the map canvas: red incident labels and heat tiles leave a lot of them. */
const redPixels = (page) => page.$eval('#mapCanvas', (c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 90) n++; // incident label red (#dc2626 / #ff1744 family)
  return n;
});

test('turning on listening hides the days card, the incident list, and the markers; turning it off brings them back', async () => {
  const signalServer = fakeServer({ listeners: 1 });
  const { page, problems } = await openApp(browser, site.url, { signalServer });
  await loadApp(page, site.url);
  await page.waitForFunction(() => !document.getElementById('helpCount').classList.contains('hidden'));
  assert.equal(await visible(page, '#alertCard'), true, 'history mode: the days card is shown');
  assert.equal(await visible(page, '#listenBar'), false);
  const markersBefore = await redPixels(page);
  assert.ok(markersBefore > 200, `the incident markers are drawn at first (${markersBefore} red px)`);

  await openHelp(page);
  await page.click('#chkListen');
  await page.waitForFunction(() => document.getElementById('listenBar') && !document.getElementById('listenBar').classList.contains('hidden'));
  assert.equal(await visible(page, '#alertCard'), false, 'listening: the days card is gone');
  assert.match(await text(page, '#listenBarText'), /Escuchando alertas/);
  await page.click('#btnCloseSheet');
  await waitHidden(page, '#sheet', true);
  await new Promise((r) => setTimeout(r, 250)); // let the render loop draw a frame
  const markersDuring = await redPixels(page);
  assert.ok(markersDuring < markersBefore * 0.2, `incident markers/heat map are not drawn while listening (${markersBefore} -> ${markersDuring} red px)`);

  // tapping the slim bar opens the help sheet, where listening is turned off
  await page.click('#listenBar');
  await waitHidden(page, '#paneHelp', false);
  await page.click('#chkListen');
  await page.waitForFunction(() => !document.getElementById('alertCard').classList.contains('hidden'));
  assert.equal(await visible(page, '#listenBar'), false);
  await page.click('#btnCloseSheet');
  await new Promise((r) => setTimeout(r, 250));
  assert.ok((await redPixels(page)) > markersBefore * 0.8, 'the history is back');
  assert.deepEqual(problems, []);
  await page.close();
});

test('while listening, a help signal still shows on the map and the history stays out of the way', async () => {
  const signalServer = fakeServer({ listeners: 2, signals: [other(2)] });
  const { page } = await openApp(browser, site.url, { signalServer });
  await loadApp(page, site.url);
  await openHelp(page);
  await page.click('#chkListen');
  await page.waitForFunction(() => !document.getElementById('listenBar').classList.contains('hidden'));
  await page.click('#btnCloseSheet');
  await waitHidden(page, '#sheet', true);
  assert.equal(await visible(page, '#helpBanner'), true, 'the SOS banner is shown');
  // the banner must sit under the slim bar, not overlap it
  const [barBottom, bannerTop] = await page.evaluate(() => [document.getElementById('listenBar').getBoundingClientRect().bottom, document.getElementById('helpBanner').getBoundingClientRect().top]);
  assert.ok(bannerTop >= barBottom - 1, `banner (${Math.round(bannerTop)}) is below the listening bar (${Math.round(barBottom)})`);
  await page.close();
});

test('the listening choice survives a reload: the page opens straight in SOS mode', async () => {
  const signalServer = fakeServer({ listeners: 1 });
  const { page } = await openApp(browser, site.url, { signalServer });
  await loadApp(page, site.url);
  await openHelp(page);
  await page.click('#chkListen');
  await page.waitForFunction(() => !document.getElementById('listenBar').classList.contains('hidden'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('listenBar').classList.contains('hidden'));
  assert.equal(await visible(page, '#alertCard'), false);
  await page.close();
});

test('while listening, reporting an incident brings the history back for the form, then hides it again', async () => {
  const { page } = await openApp(browser, site.url, { signalServer: fakeServer({ listeners: 1 }) });
  await loadApp(page, site.url);
  await openHelp(page);
  await page.click('#chkListen');
  await page.waitForFunction(() => !document.getElementById('listenBar').classList.contains('hidden'));
  await page.click('#btnCloseSheet');
  await waitHidden(page, '#sheet', true);
  await page.click('#navReport');
  await waitHidden(page, '#paneReport', false);
  await page.waitForFunction(() => !document.getElementById('alertCard').classList.contains('hidden'));
  await page.click('#btnCancelReport');
  await waitHidden(page, '#sheet', true);
  await page.waitForFunction(() => !document.getElementById('listenBar').classList.contains('hidden'));
  await page.close();
});
