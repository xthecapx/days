import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'site-'));
// Build with Vite for real (the same command the deployment uses), in a temporary folder.
execFileSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir'], { cwd: ROOT, stdio: 'pipe' });
test.after(() => rmSync(out, { recursive: true, force: true }));

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const read = (p) => readFileSync(p, 'utf8');
const html = read(join(out, 'index.html'));

test('the published site has index.html, assets/ and data/, and nothing from the repository', () => {
  assert.deepEqual(readdirSync(out).sort(), ['apple-touch-icon.png', 'assets', 'data', 'favicon.svg', 'icon-192.png', 'icon-512-maskable.png', 'icon-512.png', 'index.html', 'manifest.webmanifest']);
  for (const leak of ['worker', 'services', 'scripts', 'tests', '.github', 'src', 'package.json', 'vite.config.js', 'wrangler.jsonc', 'node_modules']) {
    assert.equal(existsSync(join(out, leak)), false, `${leak} must not be published`);
  }
});

test('index.html references only files that exist, with relative paths (works in a Pages subdirectory)', () => {
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((r) => !/^(https?:|#|data:)/.test(r));
  assert.ok(refs.some((r) => r.endsWith('.js')) && refs.some((r) => r.endsWith('.css')), refs.join());
  for (const r of refs) {
    assert.doesNotMatch(r, /^\//, `${r} must be relative`);
    assert.ok(existsSync(join(out, r)), r);
  }
});

test('the code is bundled: a single .js and a single .css with a hashed name', () => {
  const assets = readdirSync(join(out, 'assets'));
  assert.equal(assets.filter((f) => f.endsWith('.js')).length, 1, assets.join());
  assert.equal(assets.filter((f) => f.endsWith('.css')).length, 1, assets.join());
  assert.ok(assets.every((f) => /-[A-Za-z0-9_-]{8}\./.test(f)), 'the names are hashed: a new deployment does not mix old and new files');
});

test('the bundle does not pull in code from the Worker or the scripts', () => {
  const js = read(join(out, 'assets', readdirSync(join(out, 'assets')).find((f) => f.endsWith('.js'))));
  assert.doesNotMatch(js, /PUENTE ANÓNIMO|GITHUB_TOKEN|overpass/i);
});

test('data/ stays at the original path with the three files the app downloads', () => {
  const wanted = new Set();
  for (const file of walk(join(ROOT, 'src')).filter((f) => f.endsWith('.js'))) {
    for (const m of read(file).matchAll(/['"`]\.\/(data\/[A-Za-z0-9_.-]+\.json)/g)) wanted.add(m[1]);
  }
  assert.ok(wanted.has('data/incidents.json') && wanted.has('data/map.json') && wanted.has('data/map-overrides.json'), [...wanted].join());
  for (const f of wanted) {
    assert.ok(existsSync(join(out, f)), f);
    assert.equal(read(join(out, f)), read(join(ROOT, f)), `${f} is copied unchanged`);
    JSON.parse(read(join(out, f)));
  }
});

test('every $("id") in the bundle exists in the published index.html', () => {
  const js = read(join(out, 'assets', readdirSync(join(out, 'assets')).find((f) => f.endsWith('.js'))));
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const missing = [...new Set([...js.matchAll(/\$\("([A-Za-z0-9_]+)"\)/g)].map((m) => m[1]))].filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
});

test('the published site carries a security policy that allows only what the app uses', () => {
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(csp, 'the CSP <meta> is missing');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /object-src 'none'/);
  // Every host the app calls with fetch must be allowed in connect-src.
  const connect = csp.match(/connect-src ([^;]+)/)[1];
  for (const host of ['https://raw.githubusercontent.com', 'https://days.xthecapx.workers.dev', 'https://days-signal.xthecapx.workers.dev']) assert.ok(connect.includes(host), host);
  assert.match(read(join(ROOT, 'src/storage/localCache.js')), /days\.xthecapx\.workers\.dev/);
  // It does not apply in development (the Vite server needs its WebSocket).
  assert.doesNotMatch(read(join(ROOT, 'index.html')), /Content-Security-Policy/);
});

test('the bundle writes no inline styles into the HTML (the CSP would block them)', () => {
  const js = read(join(out, 'assets', readdirSync(join(out, 'assets')).find((f) => f.endsWith('.js'))));
  assert.doesNotMatch(js, /style="/);
  assert.doesNotMatch(html, /\sstyle="/);
});

test('the Vite config still saves in dev and copies data/', () => {
  const cfg = read(join(ROOT, 'vite.config.js'));
  assert.match(cfg, /base:\s*'\.\/'/);
  assert.match(cfg, /\/api\/local-wiki-save/);
  assert.match(cfg, /closeBundle/);
  assert.match(cfg, /LOOPBACK/, 'local saving only accepts this computer');
});

test('the CI workflows install, test and build with npm', () => {
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

test('the homemade server and build script no longer exist', () => {
  assert.equal(existsSync(join(ROOT, 'server.mjs')), false);
  assert.equal(existsSync(join(ROOT, 'scripts/build-site.mjs')), false);
});
