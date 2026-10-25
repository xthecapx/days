import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

/** List of `paths:` under `push:` (simple YAML: no libraries). */
function pushPaths(yml) {
  const block = yml.match(/push:[\s\S]*?paths:\n((?:\s+- "[^"]+"\n)+)/)?.[1];
  return block ? [...block.matchAll(/- "([^"]+)"/g)].map((m) => m[1]) : null;
}

// A minimal take on the wildcards GitHub uses (`**` = anything, `*` = no slashes).
const matches = (pattern, file) => new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$').test(file);
const triggers = (paths, file) => paths.some((p) => matches(p, file));

test('Pages: an approved report (changes data/incidents.json) DOES publish the interface', () => {
  const paths = pushPaths(read('.github/workflows/deploy-pages.yml'));
  assert.ok(paths, 'the Pages workflow must have a path filter');
  assert.equal(triggers(paths, 'data/incidents.json'), true, 'if this fails, approved reports would stop showing up');
  assert.equal(triggers(paths, 'data/map.json'), true);
});

test('Pages: publishes when something the interface uses changes', () => {
  const paths = pushPaths(read('.github/workflows/deploy-pages.yml'));
  for (const f of ['src/main.js', 'src/ui/panes/report.js', 'index.html', 'public/favicon.svg', 'vite.config.js', 'package.json', 'package-lock.json', '.npmrc', '.github/workflows/deploy-pages.yml']) {
    assert.equal(triggers(paths, f), true, f);
  }
});

test('Pages: does NOT republish for changes to the server, the tests or unrelated workflows', () => {
  const paths = pushPaths(read('.github/workflows/deploy-pages.yml'));
  for (const f of ['services/signal/src/index.js', 'services/signal/wrangler.jsonc', 'tests/ui.test.js', 'README.md', 'worker/github-wiki-bridge.js', '.github/workflows/deploy-signal.yml', '.github/workflows/test.yml']) {
    assert.equal(triggers(paths, f), false, f);
  }
});

test('Pages: can be triggered manually', () => {
  assert.match(read('.github/workflows/deploy-pages.yml'), /workflow_dispatch:/);
});

test('The signal server is deployed from Cloudflare Workers Builds, not from GitHub Actions (a single path, no double deployment)', () => {
  assert.equal(existsSync(join(ROOT, '.github/workflows/deploy-signal.yml')), false);
  for (const f of readdirSync(join(ROOT, '.github/workflows'))) {
    assert.doesNotMatch(read(`.github/workflows/${f}`), /wrangler deploy|CLOUDFLARE_API_TOKEN/, `${f} must not deploy to Cloudflare`);
  }
});

test('The signal server tests run on every PR and every push (before Cloudflare builds)', () => {
  const yml = read('.github/workflows/test.yml');
  assert.match(yml, /run: npm test/);
  assert.match(read('package.json'), /services\/\*\/test/);
});

test('The tests (test.yml) keep running on every PR and every push, with no path filter', () => {
  const yml = read('.github/workflows/test.yml');
  assert.match(yml, /pull_request:/);
  assert.doesNotMatch(yml, /paths:/);
});

test('the signal server is in the workspace and its tests run with `npm test`', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(pkg.workspaces, ['services/*']);
  assert.match(pkg.scripts.test, /services\/\*\/test/);
});

// ---------- each Worker in its own folder (otherwise Cloudflare builds everything on every push) ----------

const stripComments = (jsonc) => JSON.parse(jsonc.replace(/^\s*\/\/.*$/gm, ''));

test('there is no wrangler.jsonc/.toml at the root: each Worker lives in its own folder', () => {
  for (const f of ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml']) {
    assert.equal(existsSync(join(ROOT, f)), false, `${f} at the root makes Cloudflare build that Worker on EVERY push to main`);
  }
});

test('each Worker has its wrangler.jsonc next to its code, with `main` relative to that folder', () => {
  const workers = { 'worker': 'days', 'services/signal': 'days-signal' };
  for (const [dir, name] of Object.entries(workers)) {
    const cfgPath = join(ROOT, dir, 'wrangler.jsonc');
    assert.ok(existsSync(cfgPath), `${dir}/wrangler.jsonc`);
    const cfg = stripComments(readFileSync(cfgPath, 'utf8'));
    assert.equal(cfg.name, name);
    assert.ok(existsSync(join(ROOT, dir, cfg.main)), `${dir}/${cfg.main} ("main" is resolved from the wrangler.jsonc folder)`);
    assert.doesNotMatch(cfg.main, /^(worker|services)\//, '"main" must not carry the folder prefix: it is already resolved from it');
  }
});

test('the two Workers have different names and no rate limit shares a namespace_id', () => {
  const a = stripComments(read('worker/wrangler.jsonc'));
  const b = stripComments(read('services/signal/wrangler.jsonc'));
  assert.notEqual(a.name, b.name);
  const ids = [...a.ratelimits, ...b.ratelimits].map((r) => r.namespace_id);
  assert.equal(new Set(ids).size, ids.length);
});

test('what each Worker imports from outside its folder is in its Cloudflare watch paths list (README)', () => {
  const readme = read('README.md');
  const imports = (file) => [...read(file).matchAll(/from\s+'(\.\.[^']+)'/g)].map((m) => m[1]);
  // worker/ imports ../src/core/geo.js → it must be in its "watch paths"; likewise for the signal server with gpsGrid.js
  assert.deepEqual(imports('worker/github-wiki-bridge.js'), ['../src/core/geo.js']);
  assert.match(readme, /`days` \(report bridge\) \| `worker` \| `worker\/\*`, `src\/core\/geo\.js`/);
  assert.deepEqual(imports('services/signal/src/board.js'), ['../../../src/map/gpsGrid.js']);
  assert.match(readme, /`days-signal` \(help signal\) \| `services\/signal` \| `services\/signal\/\*`, `src\/core\/geo\.js`, `src\/map\/gpsGrid\.js`/);
});

test('the published site includes no Worker folder', () => {
  const ui = read('.github/workflows/deploy-pages.yml');
  assert.doesNotMatch(ui, /"worker\/|"services\//, 'changing a Worker must not republish the interface');
});
