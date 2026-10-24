import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative } from 'node:path';
import { buildSite, SITE_PATHS } from '../scripts/build-site.mjs';

const out = mkdtempSync(join(tmpdir(), 'site-'));
buildSite(out);
test.after(() => rmSync(out, { recursive: true, force: true }));

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const read = (p) => readFileSync(p, 'utf8');

test('el sitio publicado incluye solo index.html, src/ y data/', () => {
  assert.deepEqual(readdirSync(out).sort(), [...SITE_PATHS].sort());
  for (const secret of ['worker', 'scripts', 'tests', '.github', 'server.mjs', 'package.json', 'wrangler.jsonc']) {
    assert.equal(existsSync(join(out, secret)), false, `${secret} no debe publicarse`);
  }
});

test('cada import relativo del código publicado apunta a un archivo que también se publica', () => {
  const broken = [];
  for (const file of walk(join(out, 'src')).filter((f) => f.endsWith('.js'))) {
    for (const m of read(file).matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), m[1]);
      if (!existsSync(target)) broken.push(`${relative(out, file)} -> ${m[1]}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('ningún archivo publicado importa código que se queda fuera (worker/, scripts/)', () => {
  for (const file of walk(join(out, 'src')).filter((f) => f.endsWith('.js'))) {
    assert.doesNotMatch(read(file), /from\s+['"][^'"]*(worker|scripts)\//, relative(out, file));
  }
});

test('index.html: sus hojas de estilo y su script existen en el sitio', () => {
  const html = read(join(out, 'index.html'));
  const refs = [...html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.includes('./src/main.js') && refs.some((r) => r.endsWith('.css')));
  for (const r of refs) assert.ok(existsSync(join(out, r)), r);
});

test('los datos que la app descarga con fetch("./data/...") están en el sitio', () => {
  const wanted = new Set();
  for (const file of walk('src').filter((f) => f.endsWith('.js'))) {
    for (const m of read(file).matchAll(/['"`]\.\/(data\/[A-Za-z0-9_.-]+\.json)/g)) wanted.add(m[1]);
  }
  assert.ok(wanted.has('data/incidents.json') && wanted.has('data/map.json') && wanted.has('data/map-overrides.json'), [...wanted].join());
  for (const f of wanted) assert.ok(existsSync(join(out, f)), f);
});

test('reconstruir limpia la carpeta de salida (no quedan archivos viejos)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'site2-'));
  buildSite(dir);
  const stale = join(dir, 'viejo.txt'); // simula un archivo de una versión anterior
  writeFileSync(stale, 'x');
  buildSite(dir);
  assert.equal(existsSync(stale), false);
  rmSync(dir, { recursive: true, force: true });
});

test('el flujo de despliegue usa el script y publica dist/', () => {
  const wf = read(new URL('../.github/workflows/deploy-pages.yml', import.meta.url));
  assert.match(wf, /node scripts\/build-site\.mjs dist/);
  assert.match(wf, /path:\s*"dist"/);
  assert.doesNotMatch(wf, /path:\s*"\."/);
});
