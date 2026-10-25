import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = 'https://registry.npmjs.org/';

test('package-lock.json only downloads from the public npm registry', () => {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const bad = Object.entries(lock.packages)
    // The monorepo's local packages (workspaces) appear as links to a folder; they are not downloaded from any registry.
    .filter(([, p]) => p.resolved && !p.link && !p.resolved.startsWith(PUBLIC))
    .map(([name, p]) => `${name || '(raíz)'} -> ${p.resolved}`);
  assert.deepEqual(bad, [], 'GitHub Actions cannot reach a private registry: rewrite those URLs to registry.npmjs.org');
});

test('the lockfile mentions no internal hosts or credentials', () => {
  const raw = readFileSync(join(ROOT, 'package-lock.json'), 'utf8');
  assert.doesNotMatch(raw, /jfrog|artifactory|godaddy/i);
  assert.doesNotMatch(raw, /_authToken|_password|Bearer\s/i);
});

test('the project .npmrc pins the public registry', () => {
  assert.ok(existsSync(join(ROOT, '.npmrc')));
  assert.match(readFileSync(join(ROOT, '.npmrc'), 'utf8'), /^registry=https:\/\/registry\.npmjs\.org\/\s*$/m);
});

test('with that .npmrc, npm resolves to the public registry even if the personal config points elsewhere', () => {
  // Simulate a person with a private registry in their ~/.npmrc and ask npm which registry it will use here.
  const home = mkdtempSync(join(tmpdir(), 'npmhome-'));
  try {
    writeFileSync(join(home, '.npmrc'), 'registry=https://registro-privado.example.com/artifactory/api/npm/virt/\n');
    const out = execFileSync('npm', ['config', 'get', 'registry'], {
      cwd: ROOT, encoding: 'utf8',
      env: { ...process.env, HOME: home, npm_config_userconfig: join(home, '.npmrc') }
    }).trim();
    assert.equal(out, PUBLIC);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the guard tells a local link (allowed) from a private URL (forbidden)', () => {
  const check = (entry) => Boolean(entry.resolved && !entry.link && !entry.resolved.startsWith(PUBLIC));
  assert.equal(check({ resolved: 'services/signal', link: true }), false, 'a workspace is a folder in the repo');
  assert.equal(check({ resolved: 'https://registry.npmjs.org/vite/-/vite-1.0.0.tgz' }), false);
  assert.equal(check({ resolved: 'https://gdartifactory1.jfrog.io/x.tgz' }), true);
  assert.equal(check({ resolved: 'https://gdartifactory1.jfrog.io/x.tgz', link: false }), true);
});
