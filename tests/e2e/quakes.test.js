import test from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, serveBuiltSite, openApp, loadApp, waitHidden, usgsQuake } from './helpers.mjs';

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
const visible = (page, sel) => page.$eval(sel, (e) => !e.classList.contains('hidden'));
const MIN_PER_DAY = 24 * 60;

test('earthquake row counts days since the last quake and expands with the details and the source', { skip }, async () => {
  const quakes = { calls: [], features: [usgsQuake('us1', 13 * MIN_PER_DAY + 30), usgsQuake('us0', 40 * MIN_PER_DAY)] };
  const { page, problems } = await openApp(browser, site.url, { quakes });
  await loadApp(page, site.url);
  await page.waitForFunction(() => !document.getElementById('quakeToggle').classList.contains('hidden'));
  assert.equal(await text(page, '#quakeValue'), '13');
  assert.match(await text(page, '#quakeLabel'), /DÍAS DESDE EL ÚLTIMO SISMO/);
  assert.match(await text(page, '#quakePreview'), /^M4\.6 · a \d+ km · prof\. 150 km$/);
  assert.deepEqual(quakes.calls, ['earthquake.usgs.gov'], 'one read on opening, from USGS');
  assert.equal(await visible(page, '#quakeDetails'), false);
  await page.click('#quakeToggle');
  await waitHidden(page, '#quakeDetails', false);
  assert.match(await text(page, '#quakeSource'), /Fuente: USGS/);
  assert.match(await page.$eval('#quakeLink', (a) => a.href), /^https:\/\/earthquake\.usgs\.gov\//);
  assert.deepEqual(problems, []);
  await page.close();
});

test('a very recent earthquake shows as an alert with its age instead of a day count', { skip }, async () => {
  const { page } = await openApp(browser, site.url, { quakes: { calls: [], features: [usgsQuake('now1', 12)] } });
  await loadApp(page, site.url);
  await page.waitForFunction(() => !document.getElementById('quakeToggle').classList.contains('hidden'));
  assert.equal(await text(page, '#quakeValue'), '!');
  assert.equal(await text(page, '#quakeLabel'), 'SISMO HACE 12 MIN');
  assert.equal(await page.$eval('#quakeToggle', (e) => e.classList.contains('fresh')), true);
  await page.close();
});

test('if the earthquake services are down the history works the same and the row stays hidden', { skip }, async () => {
  const { page } = await openApp(browser, site.url, { quakes: { calls: [], fail: true } });
  await loadApp(page, site.url);
  assert.match(await text(page, '#daysValue'), /^\d\d$/);
  assert.equal(await visible(page, '#quakeToggle'), false);
  await page.close();
});

test('with no earthquake in range the row says so', { skip }, async () => {
  const { page } = await openApp(browser, site.url, { quakes: { calls: [], features: [] } });
  await loadApp(page, site.url);
  await page.waitForFunction(() => !document.getElementById('quakeToggle').classList.contains('hidden'));
  assert.equal(await text(page, '#quakeValue'), '--');
  assert.match(await text(page, '#quakePreview'), /Sin sismos recientes/);
  await page.close();
});

test('while listening, only a fresh earthquake is shown, as a line in the listening bar', { skip }, async () => {
  const { page } = await openApp(browser, site.url, { quakes: { calls: [], features: [usgsQuake('now2', 5)] } });
  await loadApp(page, site.url);
  await page.waitForFunction(() => !document.getElementById('quakeToggle').classList.contains('hidden'));
  await page.click('#btnHelp');
  await waitHidden(page, '#paneHelp', false);
  await page.waitForSelector('#chkListen', { visible: true });
  await page.click('#chkListen');
  await page.waitForFunction(() => !document.getElementById('listenBar').classList.contains('hidden'));
  assert.equal(await visible(page, '#listenBarQuake'), true);
  assert.match(await text(page, '#listenBarQuake'), /SISMO HACE 5 MIN/);
  await page.close();
});
