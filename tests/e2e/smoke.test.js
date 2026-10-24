import test from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, serveBuiltSite, openApp } from './helpers.mjs';

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page, sel) => page.$eval(sel, (e) => e.textContent);

test('el sitio publicado arranca, dibuja el mapa y no rompe la política de seguridad', { skip }, async () => {
  const { page, problems } = await openApp(browser, site.url);
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await wait(600);

  assert.match(await text(page, '#daysValue'), /^\d\d$/);
  assert.ok(Number(await text(page, '#navCount')) >= 1, 'debe mostrar los incidentes cargados');
  assert.equal(await page.$eval('#gpsDot', (e) => e.dataset.status), 'ok');
  // El lienzo tiene que tener más de un color: si solo hay un color, el mapa no se dibujó.
  const colors = await page.$eval('#mapCanvas', (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 4 * 997) set.add(`${d[i] >> 5},${d[i + 1] >> 5},${d[i + 2] >> 5}`);
    return set.size;
  });
  assert.ok(colors > 10, `el mapa parece vacío (${colors} colores)`);
  assert.equal(await page.evaluate(() => Boolean(window.__app)), false, 'el sitio publicado no expone el depurador');
  assert.deepEqual(problems, []);
  await page.close();
});

test('las hojas abren y cierran, y Ajustes solo trae lo público', { skip }, async () => {
  const { page, problems } = await openApp(browser, site.url);
  await page.goto(site.url, { waitUntil: 'networkidle0' });

  await page.click('#navIncidents');
  await wait(200);
  assert.ok((await page.$$('.incident-card')).length >= 1);
  assert.match(await text(page, '#sheetTitle'), /Incidentes/);
  await page.click('#btnCloseSheet');

  await page.click('#navSettings');
  await wait(200);
  assert.ok(await page.$('#chkGrid'));
  assert.equal(await page.$('#inpImport'), null);
  assert.equal(await page.$('#btnHistory'), null);
  await page.click('#btnCloseSheet');
  assert.equal(await page.$eval('#sheet', (e) => e.classList.contains('hidden')), true);
  assert.deepEqual(problems, []);
  await page.close();
});

test('"Ver" en la lista centra el mapa y abre la tarjeta del incidente', { skip }, async () => {
  const { page } = await openApp(browser, site.url);
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await wait(300);
  await page.click('#navIncidents');
  await wait(200);
  await page.click('.incident-card [data-act="focus"]');
  await wait(300);
  assert.equal(await page.$eval('#sheet', (e) => e.classList.contains('hidden')), true);
  assert.equal(await page.$eval('#peekIncident', (e) => e.classList.contains('hidden')), false);
  assert.match(await text(page, '#peekTitle'), /^#\d+/);
  await page.close();
});

test('el menú de WhatsApp abre WhatsApp con el mensaje y la ubicación', { skip }, async () => {
  const hits = [];
  // Capturamos la navegación a wa.me en vez de salir de la página.
  const intercept = (r) => {
    if (!r.url().startsWith('https://wa.me/')) return false;
    if (r.isNavigationRequest()) hits.push(r.url()); // (Chrome también pide el favicon de la página falsa: no cuenta)
    r.respond({ status: 200, contentType: 'text/html', body: 'wa' });
    return true;
  };
  const { page } = await openApp(browser, site.url, { intercept });
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await wait(300);
  await page.click('#btnWhatsapp');
  await page.click('#waHelp');
  await wait(500);
  assert.equal(hits.length, 1);
  const msg = decodeURIComponent(new URL(hits[0]).searchParams.get('text'));
  assert.match(msg, /NECESITO AYUDA/);
  assert.match(msg, /google\.com\/maps\/search\/\?api=1&query=7\.005/);
  await page.close();
});

test('si el mapa no carga, se muestra un aviso con botón de reintentar (no una pantalla en blanco)', { skip }, async () => {
  const { page } = await openApp(browser, site.url, { blockMap: true });
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#bootError:not(.hidden)', { timeout: 15000 });
  assert.match(await text(page, '#bootError'), /No se pudo cargar el mapa/);
  assert.ok(await page.$('#btnRetryBoot'));
  await page.close();
});
