import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

/** Lista de `paths:` bajo `push:` (YAML simple: sin librerías). */
function pushPaths(yml) {
  const block = yml.match(/push:[\s\S]*?paths:\n((?:\s+- "[^"]+"\n)+)/)?.[1];
  return block ? [...block.matchAll(/- "([^"]+)"/g)].map((m) => m[1]) : null;
}

// Un ejemplo mínimo de los comodines que usa GitHub (`**` = cualquier cosa, `*` = sin barras).
const matches = (pattern, file) => new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$').test(file);
const triggers = (paths, file) => paths.some((p) => matches(p, file));

test('Pages: un reporte aprobado (cambia data/incidents.json) SÍ publica la interfaz', () => {
  const paths = pushPaths(read('.github/workflows/deploy-pages.yml'));
  assert.ok(paths, 'el flujo de Pages debe tener filtro de rutas');
  assert.equal(triggers(paths, 'data/incidents.json'), true, 'si esto falla, los reportes aprobados dejarían de verse');
  assert.equal(triggers(paths, 'data/map.json'), true);
});

test('Pages: publica cuando cambia lo que la interfaz usa', () => {
  const paths = pushPaths(read('.github/workflows/deploy-pages.yml'));
  for (const f of ['src/main.js', 'src/ui/panes/report.js', 'index.html', 'public/favicon.svg', 'vite.config.js', 'package.json', 'package-lock.json', '.npmrc', '.github/workflows/deploy-pages.yml']) {
    assert.equal(triggers(paths, f), true, f);
  }
});

test('Pages: NO se vuelve a publicar por cambios del servidor, las pruebas ni los workflows ajenos', () => {
  const paths = pushPaths(read('.github/workflows/deploy-pages.yml'));
  for (const f of ['services/signal/src/index.js', 'services/signal/wrangler.jsonc', 'tests/ui.test.js', 'README.md', 'worker/github-wiki-bridge.js', '.github/workflows/deploy-signal.yml', '.github/workflows/test.yml']) {
    assert.equal(triggers(paths, f), false, f);
  }
});

test('Pages: se puede lanzar a mano', () => {
  assert.match(read('.github/workflows/deploy-pages.yml'), /workflow_dispatch:/);
});

test('El servidor de señal se despliega desde Cloudflare Workers Builds, no desde GitHub Actions (un solo camino, sin doble despliegue)', () => {
  assert.equal(existsSync(join(ROOT, '.github/workflows/deploy-signal.yml')), false);
  for (const f of readdirSync(join(ROOT, '.github/workflows'))) {
    assert.doesNotMatch(read(`.github/workflows/${f}`), /wrangler deploy|CLOUDFLARE_API_TOKEN/, `${f} no debe desplegar a Cloudflare`);
  }
});

test('Las pruebas del servidor de señal corren en cada PR y en cada push (antes de que Cloudflare construya)', () => {
  const yml = read('.github/workflows/test.yml');
  assert.match(yml, /run: npm test/);
  assert.match(read('package.json'), /services\/\*\/test/);
});

test('Las pruebas (test.yml) siguen corriendo en cada PR y en cada push, sin filtro de rutas', () => {
  const yml = read('.github/workflows/test.yml');
  assert.match(yml, /pull_request:/);
  assert.doesNotMatch(yml, /paths:/);
});

test('el servidor de señal está en el workspace y sus pruebas corren con `npm test`', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(pkg.workspaces, ['services/*']);
  assert.match(pkg.scripts.test, /services\/\*\/test/);
});
