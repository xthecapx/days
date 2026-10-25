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

/** Abre la hoja de ayuda y espera a que esté de verdad en pantalla (entra con una animación). */
async function openHelp(page) {
  await page.click('#btnHelp');
  await waitHidden(page, '#paneHelp', false);
  await page.waitForSelector('#btnHelpSend', { visible: true });
}
/** Pulsa "Pedir ayuda" y espera a que aparezca la confirmación. */
async function askForHelp(page) {
  await page.click('#btnHelpSend');
  await waitHidden(page, '#helpConfirm', false);
  await page.waitForSelector('#btnHelpYes', { visible: true });
}
const visible = (page, sel) => page.$eval(sel, (e) => !e.classList.contains('hidden'));

/** Servidor de señal falso con estado mutable y registro de lo que se pidió. */
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

test('sitio publicado: con el servidor activo aparece el botón 🆘 y el contador de oyentes', async () => {
  const signalServer = fakeServer({ listeners: 2 });
  const { page, problems } = await openApp(browser, site.url, { signalServer });
  await loadApp(page, site.url);
  await page.waitForFunction(() => !document.getElementById('btnHelp').classList.contains('hidden'));
  assert.equal(await visible(page, '#btnHelp'), true);
  await page.waitForFunction(() => !document.getElementById('listenersChip').classList.contains('hidden'));
  assert.match(await text(page, '#listenersChip'), /2 vecinos escuchan/);
  assert.deepEqual(signalServer.calls, ['GET /state?room=dev'], 'una sola lectura al abrir, y en la sala dev (la página corre en 127.0.0.1)');
  assert.deepEqual(problems, []);
  await page.close();
});

test('quien recarga ve una alerta activa, aunque no esté escuchando; y no se sondea', async () => {
  const signalServer = fakeServer({ signals: [other(3)], listeners: 1 });
  const { page, problems } = await openApp(browser, site.url, { signalServer });
  await loadApp(page, site.url);
  await page.waitForFunction(() => !document.getElementById('helpBanner').classList.contains('hidden'));
  assert.match(await text(page, '#helpBannerText'), /Alguien pidió ayuda hace 3 min/);
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(signalServer.calls.every((c) => c.startsWith('GET /state')), `solo lecturas, sin sondeo: ${signalServer.calls}`);
  assert.deepEqual(problems, []);
  await page.close();
});

test('el aviso se puede descartar y "Ver en el mapa" centra la alerta y cierra la hoja', async () => {
  const signalServer = fakeServer({ signals: [other()] });
  const { page } = await openApp(browser, site.url, { signalServer });
  await loadApp(page, site.url);
  await page.waitForFunction(() => !document.getElementById('helpBanner').classList.contains('hidden'));
  await page.click('#btnHelpBannerView');
  const sel = await page.evaluate(() => window.__app?.store.get().selection.pixel ?? null);
  assert.equal(sel, null, 'el depurador no existe en el sitio publicado, así que se comprueba por la interfaz');
  await page.click('#btnHelpBannerClose');
  await waitHidden(page, '#helpBanner', true);
  await page.close();
});

test('pedir ayuda: confirmación, envío con la ubicación del teléfono, y se puede retirar', async () => {
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
  assert.equal(await visible(page, '#btnHelpSend'), false, 'el botón rojo se oculta mientras se confirma');
  await page.click('#btnHelpNo');
  await waitHidden(page, '#helpConfirm', true);
  assert.equal(signalServer.sent, undefined, 'cancelar la confirmación no envía nada');

  await page.click('#btnHelpSend');
  await page.click('#btnHelpYes');
  await waitHidden(page, '#helpMine', false);
  assert.deepEqual(signalServer.sent, { lat: 7.005, lng: -73.064 });
  assert.match(await text(page, '#helpMineText'), /Vence en \d+ min/);
  assert.equal(await visible(page, '#btnHelpSend'), false, 'con una alerta activa no se ofrece enviar otra');

  await page.click('#btnHelpCancel');
  await waitHidden(page, '#helpMine', true);
  assert.ok(signalServer.calls.some((c) => c.startsWith('POST /signal/cancel')));
  assert.equal(await visible(page, '#btnHelpSend'), true);
  assert.deepEqual(problems, []);
  await page.close();
});

test('el token para cancelar solo vive en el navegador de quien envió', async () => {
  const signalServer = fakeServer();
  const { page } = await openApp(browser, site.url, { signalServer });
  await loadApp(page, site.url);
  await page.waitForFunction(() => document.getElementById('gpsDot').dataset.status === 'ok');
  await openHelp(page); await askForHelp(page); await page.click('#btnHelpYes');
  await waitHidden(page, '#helpMine', false);
  const dom = await page.evaluate(() => document.documentElement.outerHTML);
  assert.doesNotMatch(dom, /token-de-prueba-123/, 'el token no aparece en ninguna parte de la pantalla');
  const stored = await page.evaluate(() => localStorage.getItem('vecinos_rio_hato_signal_v1'));
  assert.match(stored, /token-de-prueba-123/);
  await page.close();
});

test('un doble toque en "Sí, pedir ayuda" envía una sola alerta', async () => {
  const signalServer = fakeServer();
  const { page } = await openApp(browser, site.url, { signalServer });
  await loadApp(page, site.url);
  await page.waitForFunction(() => document.getElementById('gpsDot').dataset.status === 'ok');
  await openHelp(page); await askForHelp(page);
  await page.evaluate(() => { const b = document.getElementById('btnHelpYes'); b.click(); b.click(); b.click(); });
  await waitHidden(page, '#helpMine', false);
  assert.equal(signalServer.calls.filter((c) => c.startsWith('POST /signal?')).length, 1);
  await page.close();
});

test('escuchar: se activa, sondea y se recuerda al recargar; apagarlo avisa al servidor', async () => {
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
  assert.equal(signalServer.calls.at(-1).startsWith('POST /poll'), true, 'al apagar se avisa para dejar de contar');
  assert.deepEqual(problems, []);
  await page.close();
});

test('si el servidor de señal falla, la interfaz sigue viva y lo dice', async () => {
  const signalServer = { calls: [], respond: () => { throw new Error('caído'); } };
  const { page } = await openApp(browser, site.url, { signalServer, intercept: (r) => {
    if (!r.url().includes('days-signal') && !r.url().includes(':8787')) return false;
    r.abort();
    return true;
  } });
  await loadApp(page, site.url);
  assert.match(await text(page, '#daysValue'), /^\d\d$/, 'el contador de días funciona igual');
  await openHelp(page); await askForHelp(page); await page.click('#btnHelpYes');
  await page.waitForFunction(() => !document.getElementById('helpError').classList.contains('hidden'));
  assert.match(await text(page, '#helpError'), /123/, 'siempre queda a la vista la alternativa real');
  await page.close();
});

test('el atajo ?sos=1 abre directamente la pantalla de ayuda', async () => {
  const { page } = await openApp(browser, site.url, { signalServer: fakeServer() });
  await page.goto(`${site.url}?sos=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('daysValue').textContent !== '--');
  await waitHidden(page, '#paneHelp', false);
  assert.match(await text(page, '#sheetTitle'), /Ayuda entre vecinos/);
  await page.close();
});

test('el manifiesto es válido y el icono se puede instalar en la pantalla de inicio', async () => {
  const { page, problems } = await openApp(browser, site.url, { signalServer: fakeServer() });
  await loadApp(page, site.url);
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.shortcuts[0].url, './?sos=1');
  for (const icon of manifest.icons) assert.equal((await fetch(new URL(icon.src, site.url))).status, 200, icon.src);
  assert.equal((await fetch(new URL('apple-touch-icon.png', site.url))).status, 200);
  assert.deepEqual(problems, [], 'sin errores de "Manifest" en la consola');
  await page.close();
});

test('la cifra de vecinos escuchando se ve sobre el botón 🆘, sin abrir nada, y se actualiza al escuchar', async () => {
  const signalServer = fakeServer({ listeners: 2 });
  const { page, problems } = await openApp(browser, site.url, { signalServer });
  await page.goto(site.url, { waitUntil: 'load' });
  // Antes de la primera respuesta no hay cifra.
  await page.waitForFunction(() => document.getElementById('daysValue').textContent !== '--');
  await page.waitForFunction(() => !document.getElementById('helpCount').classList.contains('hidden'));
  assert.equal(await text(page, '#helpCount'), '2');
  assert.match(await page.$eval('#btnHelp', (e) => e.getAttribute('aria-label')), /2 vecinos escuchan/);
  assert.equal(await page.$eval('#helpCount', (e) => e.classList.contains('dim')), false);
  // La cifra queda dentro de la pantalla y no tapa el botón.
  const box = await page.$eval('#helpCount', (e) => { const r = e.getBoundingClientRect(); return [r.left >= 0, r.right <= innerWidth, r.top >= 0]; });
  assert.deepEqual(box, [true, true, true]);

  await openHelp(page);
  await page.click('#chkListen');
  await page.waitForFunction(() => document.getElementById('helpCount').textContent === '3');
  assert.deepEqual(problems, []);
  await page.close();
});

test('con nadie escuchando la cifra es 0 y se ve atenuada', async () => {
  const { page } = await openApp(browser, site.url, { signalServer: fakeServer({ listeners: 0 }) });
  await loadApp(page, site.url);
  await page.waitForFunction(() => !document.getElementById('helpCount').classList.contains('hidden'));
  assert.equal(await text(page, '#helpCount'), '0');
  assert.equal(await page.$eval('#helpCount', (e) => e.classList.contains('dim')), true);
  await page.close();
});
