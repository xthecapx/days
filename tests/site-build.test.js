import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'site-'));
// Construye con Vite de verdad (el mismo comando que usa el despliegue), en una carpeta temporal.
execFileSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir'], { cwd: ROOT, stdio: 'pipe' });
test.after(() => rmSync(out, { recursive: true, force: true }));

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const read = (p) => readFileSync(p, 'utf8');
const html = read(join(out, 'index.html'));

test('el sitio publicado tiene index.html, assets/ y data/, y nada del repositorio', () => {
  assert.deepEqual(readdirSync(out).sort(), ['apple-touch-icon.png', 'assets', 'data', 'favicon.svg', 'icon-192.png', 'icon-512-maskable.png', 'icon-512.png', 'index.html', 'manifest.webmanifest']);
  for (const leak of ['worker', 'scripts', 'tests', '.github', 'src', 'package.json', 'vite.config.js', 'wrangler.jsonc', 'node_modules']) {
    assert.equal(existsSync(join(out, leak)), false, `${leak} no debe publicarse`);
  }
});

test('index.html referencia solo archivos que existen, con rutas relativas (sirve en un subdirectorio de Pages)', () => {
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((r) => !/^(https?:|#|data:)/.test(r));
  assert.ok(refs.some((r) => r.endsWith('.js')) && refs.some((r) => r.endsWith('.css')), refs.join());
  for (const r of refs) {
    assert.doesNotMatch(r, /^\//, `${r} debe ser relativa`);
    assert.ok(existsSync(join(out, r)), r);
  }
});

test('el código va empaquetado: un solo .js y un solo .css con nombre con hash', () => {
  const assets = readdirSync(join(out, 'assets'));
  assert.equal(assets.filter((f) => f.endsWith('.js')).length, 1, assets.join());
  assert.equal(assets.filter((f) => f.endsWith('.css')).length, 1, assets.join());
  assert.ok(assets.every((f) => /-[A-Za-z0-9_-]{8}\./.test(f)), 'los nombres llevan hash: un despliegue nuevo no mezcla archivos viejos y nuevos');
});

test('el bundle no arrastra código del Worker ni de los scripts', () => {
  const js = read(join(out, 'assets', readdirSync(join(out, 'assets')).find((f) => f.endsWith('.js'))));
  assert.doesNotMatch(js, /PUENTE ANÓNIMO|GITHUB_TOKEN|overpass/i);
});

test('data/ queda en la ruta original y con los tres archivos que la app descarga', () => {
  const wanted = new Set();
  for (const file of walk(join(ROOT, 'src')).filter((f) => f.endsWith('.js'))) {
    for (const m of read(file).matchAll(/['"`]\.\/(data\/[A-Za-z0-9_.-]+\.json)/g)) wanted.add(m[1]);
  }
  assert.ok(wanted.has('data/incidents.json') && wanted.has('data/map.json') && wanted.has('data/map-overrides.json'), [...wanted].join());
  for (const f of wanted) {
    assert.ok(existsSync(join(out, f)), f);
    assert.equal(read(join(out, f)), read(join(ROOT, f)), `${f} se copia sin cambios`);
    JSON.parse(read(join(out, f)));
  }
});

test('cada $("id") del bundle existe en el index.html publicado', () => {
  const js = read(join(out, 'assets', readdirSync(join(out, 'assets')).find((f) => f.endsWith('.js'))));
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const missing = [...new Set([...js.matchAll(/\$\("([A-Za-z0-9_]+)"\)/g)].map((m) => m[1]))].filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
});

test('el sitio publicado lleva una política de seguridad que permite solo lo que la app usa', () => {
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(csp, 'falta el <meta> de CSP');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /object-src 'none'/);
  // Todo host al que la app llama con fetch tiene que estar permitido en connect-src.
  const connect = csp.match(/connect-src ([^;]+)/)[1];
  for (const host of ['https://raw.githubusercontent.com', 'https://days.xthecapx.workers.dev', 'https://days-signal.xthecapx.workers.dev']) assert.ok(connect.includes(host), host);
  assert.match(read(join(ROOT, 'src/storage/localCache.js')), /days\.xthecapx\.workers\.dev/);
  // En desarrollo no se aplica (el servidor de Vite necesita su WebSocket).
  assert.doesNotMatch(read(join(ROOT, 'index.html')), /Content-Security-Policy/);
});

test('el bundle no escribe estilos en línea en el HTML (los bloquearía la CSP)', () => {
  const js = read(join(out, 'assets', readdirSync(join(out, 'assets')).find((f) => f.endsWith('.js'))));
  assert.doesNotMatch(js, /style="/);
  assert.doesNotMatch(html, /\sstyle="/);
});

test('la configuración de Vite sigue guardando en dev y copiando data/', () => {
  const cfg = read(join(ROOT, 'vite.config.js'));
  assert.match(cfg, /base:\s*'\.\/'/);
  assert.match(cfg, /\/api\/local-wiki-save/);
  assert.match(cfg, /closeBundle/);
  assert.match(cfg, /LOOPBACK/, 'el guardado local solo acepta a este computador');
});

test('los flujos de CI instalan, prueban y construyen con npm', () => {
  const deploy = read(join(ROOT, '.github/workflows/deploy-pages.yml'));
  assert.match(deploy, /npm ci/);
  assert.match(deploy, /npm run build/);
  assert.match(deploy, /path:\s*"dist"/);
  assert.doesNotMatch(deploy, /build-site/);
  const ci = read(join(ROOT, '.github/workflows/test.yml'));
  assert.match(ci, /npm ci/);
  assert.match(ci, /npm test/);
  assert.match(ci, /npm run build/);
});

test('el servidor y el script de build caseros ya no existen', () => {
  assert.equal(existsSync(join(ROOT, 'server.mjs')), false);
  assert.equal(existsSync(join(ROOT, 'scripts/build-site.mjs')), false);
});
