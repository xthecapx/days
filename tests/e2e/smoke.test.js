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

test('the published site starts, draws the map and does not break the security policy', { skip }, async () => {
  const { page, problems } = await openApp(browser, site.url);
  await loadApp(page, site.url);
  await page.waitForFunction(() => document.getElementById('gpsDot').dataset.status === 'ok');

  assert.match(await text(page, '#daysValue'), /^\d\d$/);
  assert.ok(Number(await text(page, '#navCount')) >= 1, 'must show the loaded incidents');
  assert.equal(await page.$eval('#gpsDot', (e) => e.dataset.status), 'ok');
  // The canvas must have more than one colour: if there is only one colour, the map was not drawn.
  const colors = await page.$eval('#mapCanvas', (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 4 * 997) set.add(`${d[i] >> 5},${d[i + 1] >> 5},${d[i + 2] >> 5}`);
    return set.size;
  });
  assert.ok(colors > 10, `the map looks empty (${colors} colours)`);
  assert.equal(await page.evaluate(() => Boolean(window.__app)), false, 'the published site does not expose the debugger');
  assert.deepEqual(problems, []);
  await page.close();
});

test('the sheets open and close, and Settings only brings what is public', { skip }, async () => {
  const { page, problems } = await openApp(browser, site.url);
  await loadApp(page, site.url);

  await page.click('#navIncidents');
  await waitHidden(page, '#sheet', false);
  assert.ok((await page.$$('.incident-card')).length >= 1);
  assert.match(await text(page, '#sheetTitle'), /Incidentes/);
  await page.click('#btnCloseSheet');

  await page.click('#navSettings');
  await waitHidden(page, '#paneSettings', false);
  assert.ok(await page.$('#chkGrid'));
  assert.equal(await page.$('#inpImport'), null);
  assert.equal(await page.$('#btnHistory'), null);
  await page.click('#btnCloseSheet');
  assert.equal(await page.$eval('#sheet', (e) => e.classList.contains('hidden')), true);
  assert.deepEqual(problems, []);
  await page.close();
});

test('"Ver" in the list centres the map and opens the incident card', { skip }, async () => {
  const { page } = await openApp(browser, site.url);
  await loadApp(page, site.url);
  await page.click('#navIncidents');
  await page.waitForSelector('.incident-card [data-act="focus"]');
  await page.click('.incident-card [data-act="focus"]');
  await waitHidden(page, '#peekIncident', false);
  assert.equal(await page.$eval('#sheet', (e) => e.classList.contains('hidden')), true);
  assert.equal(await page.$eval('#peekIncident', (e) => e.classList.contains('hidden')), false);
  assert.match(await text(page, '#peekTitle'), /^#\d+/);
  await page.close();
});

test('the WhatsApp menu opens WhatsApp with the message and the location', { skip }, async () => {
  const hits = [];
  // We capture the navigation to wa.me instead of leaving the page.
  const intercept = (r) => {
    if (!r.url().startsWith('https://wa.me/')) return false;
    if (r.isNavigationRequest()) hits.push(r.url()); // (Chrome also requests the favicon of the fake page: it does not count)
    r.respond({ status: 200, contentType: 'text/html', body: 'wa' });
    return true;
  };
  const { page } = await openApp(browser, site.url, { intercept });
  await loadApp(page, site.url);
  await page.waitForFunction(() => document.getElementById('gpsDot').dataset.status === 'ok');
  await page.click('#btnWhatsapp');
  await page.click('#waHelp');
  for (let i = 0; i < 50 && hits.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(hits.length, 1);
  const msg = decodeURIComponent(new URL(hits[0]).searchParams.get('text'));
  assert.match(msg, /NECESITO AYUDA/);
  assert.match(msg, /google\.com\/maps\/search\/\?api=1&query=7\.005/);
  await page.close();
});

test('if the map fails to load, a notice with a retry button is shown (not a blank screen)', { skip }, async () => {
  const { page } = await openApp(browser, site.url, { blockMap: true });
  await page.goto(site.url, { waitUntil: 'load' });
  await page.waitForSelector('#bootError:not(.hidden)', { timeout: 15000 });
  assert.match(await text(page, '#bootError'), /No se pudo cargar el mapa/);
  assert.ok(await page.$('#btnRetryBoot'));
  await page.close();
});

test('report: without a date it will not save; with "Ayer" it saves once and the counter goes up', { skip }, async () => {
  // The test site runs on 127.0.0.1 (the app takes it for "local" and tries to save to disk, something that only
  // exists in `vite dev`): it is answered here so we can count how many times a save is attempted.
  const saves = [];
  const intercept = (r) => {
    if (!r.url().endsWith('/api/local-wiki-save')) return false;
    saves.push(JSON.parse(r.postData()));
    r.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    return true;
  };
  const { page, problems } = await openApp(browser, site.url, { intercept });
  await loadApp(page, site.url);
  const before = Number(await text(page, '#navCount'));

  await page.click('#navReport');
  await waitHidden(page, '#paneReport', false);
  await page.type('#repDescription', 'Prueba E2E del formulario');
  // Without a date it cannot be saved, and what is missing is flagged.
  await page.evaluate(() => document.getElementById('paneReport').requestSubmit());
  await page.waitForFunction(() => document.getElementById('repWhen').closest('.field').classList.contains('field-error'));
  assert.equal(await page.$eval('#repWhen', (e) => e.closest('.field').classList.contains('field-error')), true);
  assert.equal(Number(await text(page, '#navCount')), before);

  await page.click('[data-when="yesterday"]');
  await page.select('#repCategory', 'Ruido Excesivo / Convivencia');
  // A triple submit in a row must save a single incident.
  await page.evaluate(() => { const f = document.getElementById('paneReport'); f.requestSubmit(); f.requestSubmit(); f.requestSubmit(); });
  await waitHidden(page, '#sheet', true);
  assert.equal(Number(await text(page, '#navCount')), before + 1);
  assert.equal(saves.length, 1, 'three submits in a row = a single save');
  const saved = saves[0].incidents.at(-1);
  assert.equal(saved.impactType, 'tranquilidad', 'the colour comes from the category');
  assert.equal(saved.dateConfirmed, true);
  assert.equal(saved.timeConfirmed, false);
  assert.match(saved.dateLabel, /Hora por confirmar$/);
  assert.equal(await page.$eval('#sheet', (e) => e.classList.contains('hidden')), true, 'the sheet closes on save');
  assert.deepEqual(problems, []);
  await page.close();
});

test('with Google fonts allowed, the security policy blocks nothing', { skip }, async () => {
  // The other tests block the internet on purpose; here only what the CSP allows is let through.
  const { page, problems } = await openApp(browser, site.url, { intercept: (r) => {
    if (!/fonts\.(googleapis|gstatic)\.com/.test(r.url())) return false;
    r.continue();
    return true;
  } });
  const fontsLoaded = [];
  page.on('response', (r) => { if (/fonts\.gstatic\.com/.test(r.url()) && r.ok()) fontsLoaded.push(r.url()); });
  await loadApp(page, site.url);
  await new Promise((r) => setTimeout(r, 1500)); // fonts take a while to be requested after painting; the only fixed pause, and it is the point of the test
  assert.deepEqual(problems.filter((p) => /CSP|Content Security/i.test(p)), []);
  // If there is internet, the fonts must have loaded; if not, the test cannot assert anything.
  const online = await page.evaluate(() => document.fonts.size > 0);
  if (online) assert.ok(fontsLoaded.length > 0, 'the fonts did not load under the CSP');
  await page.close();
});

