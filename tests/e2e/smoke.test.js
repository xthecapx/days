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

test('reportar: sin fecha no deja guardar; con "Ayer" guarda una sola vez y el contador sube', { skip }, async () => {
  // El sitio de prueba corre en 127.0.0.1 (la app lo toma por "local" e intenta guardar en disco, algo que solo
  // existe en `vite dev`): se contesta aquí para poder contar cuántas veces se intenta guardar.
  const saves = [];
  const intercept = (r) => {
    if (!r.url().endsWith('/api/local-wiki-save')) return false;
    saves.push(JSON.parse(r.postData()));
    r.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    return true;
  };
  const { page, problems } = await openApp(browser, site.url, { intercept });
  await page.goto(site.url, { waitUntil: 'networkidle0' });
  const before = Number(await text(page, '#navCount'));

  await page.click('#navReport');
  await wait(200);
  await page.type('#repDescription', 'Prueba E2E del formulario');
  // Sin fecha no se puede guardar, y se marca qué falta.
  await page.evaluate(() => document.getElementById('paneReport').requestSubmit());
  await wait(100);
  assert.equal(await page.$eval('#repWhen', (e) => e.closest('.field').classList.contains('field-error')), true);
  assert.equal(Number(await text(page, '#navCount')), before);

  await page.click('[data-when="yesterday"]');
  await page.select('#repCategory', 'Ruido Excesivo / Convivencia');
  // Un triple envío seguido tiene que guardar un solo incidente.
  await page.evaluate(() => { const f = document.getElementById('paneReport'); f.requestSubmit(); f.requestSubmit(); f.requestSubmit(); });
  await wait(600);
  assert.equal(Number(await text(page, '#navCount')), before + 1);
  assert.equal(saves.length, 1, 'tres envíos seguidos = un solo guardado');
  const saved = saves[0].incidents.at(-1);
  assert.equal(saved.impactType, 'tranquilidad', 'el color sale de la categoría');
  assert.equal(saved.dateConfirmed, true);
  assert.equal(saved.timeConfirmed, false);
  assert.match(saved.dateLabel, /Hora por confirmar$/);
  assert.equal(await page.$eval('#sheet', (e) => e.classList.contains('hidden')), true, 'la hoja se cierra al guardar');
  assert.deepEqual(problems, []);
  await page.close();
});

test('con las fuentes de Google permitidas, la política de seguridad no bloquea nada', { skip }, async () => {
  // Las demás pruebas bloquean internet a propósito; aquí se deja pasar solo lo que la CSP autoriza.
  const { page, problems } = await openApp(browser, site.url, { intercept: (r) => {
    if (!/fonts\.(googleapis|gstatic)\.com/.test(r.url())) return false;
    r.continue();
    return true;
  } });
  const fontsLoaded = [];
  page.on('response', (r) => { if (/fonts\.gstatic\.com/.test(r.url()) && r.ok()) fontsLoaded.push(r.url()); });
  await page.goto(site.url, { waitUntil: 'networkidle0' }).catch(() => {});
  await wait(1500);
  assert.deepEqual(problems.filter((p) => /CSP|Content Security/i.test(p)), []);
  // Si hay internet, las fuentes tienen que haber cargado; si no hay, la prueba no puede afirmar nada.
  const online = await page.evaluate(() => document.fonts.size > 0);
  if (online) assert.ok(fontsLoaded.length > 0, 'las fuentes no cargaron bajo la CSP');
  await page.close();
});

