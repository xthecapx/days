import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('Servidor de señal: solo se despliega si cambia el servidor o el código de mapa que comparte', () => {
  const paths = pushPaths(read('.github/workflows/deploy-signal.yml'));
  assert.ok(paths);
  for (const f of ['services/signal/src/board.js', 'services/signal/wrangler.jsonc', 'src/core/geo.js', 'src/map/gpsGrid.js']) assert.equal(triggers(paths, f), true, f);
  for (const f of ['src/ui/hud.js', 'data/incidents.json', 'index.html', 'worker/github-wiki-bridge.js']) assert.equal(triggers(paths, f), false, f);
});

test('Servidor de señal: prueba antes de desplegar, usa secretos y no falla en rojo si aún no hay credenciales', () => {
  const yml = read('.github/workflows/deploy-signal.yml');
  assert.ok(yml.indexOf('npm run signal:test') < yml.indexOf('npm run deploy'), 'las pruebas van antes del despliegue');
  assert.match(yml, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(yml, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(yml, /::warning::/);
  assert.match(yml, /if: steps\.ready\.outputs\.go == 'true'/);
  assert.match(yml, /timeout-minutes: 10/);
  assert.doesNotMatch(yml, /CLOUDFLARE_API_TOKEN:\s*[A-Za-z0-9_-]{20,}/, 'ningún token escrito en el archivo');
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
