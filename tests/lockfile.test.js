import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = 'https://registry.npmjs.org/';

test('package-lock.json solo descarga desde el registro público de npm', () => {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const bad = Object.entries(lock.packages)
    // Los paquetes locales del monorepo (workspaces) aparecen como enlaces a una carpeta; no se descargan de ningún registro.
    .filter(([, p]) => p.resolved && !p.link && !p.resolved.startsWith(PUBLIC))
    .map(([name, p]) => `${name || '(raíz)'} -> ${p.resolved}`);
  assert.deepEqual(bad, [], 'GitHub Actions no puede entrar a un registro privado: reescribe esas URLs a registry.npmjs.org');
});

test('el lockfile no menciona hosts internos ni credenciales', () => {
  const raw = readFileSync(join(ROOT, 'package-lock.json'), 'utf8');
  assert.doesNotMatch(raw, /jfrog|artifactory|godaddy/i);
  assert.doesNotMatch(raw, /_authToken|_password|Bearer\s/i);
});

test('.npmrc del proyecto fija el registro público', () => {
  assert.ok(existsSync(join(ROOT, '.npmrc')));
  assert.match(readFileSync(join(ROOT, '.npmrc'), 'utf8'), /^registry=https:\/\/registry\.npmjs\.org\/\s*$/m);
});

test('con ese .npmrc, npm resuelve al registro público aunque la configuración personal apunte a otro', () => {
  // Se simula una persona con un registro privado en su ~/.npmrc y se pregunta a npm qué registro usará aquí.
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

test('el guardián distingue un enlace local (permitido) de una URL privada (prohibida)', () => {
  const check = (entry) => Boolean(entry.resolved && !entry.link && !entry.resolved.startsWith(PUBLIC));
  assert.equal(check({ resolved: 'services/signal', link: true }), false, 'un workspace es una carpeta del repo');
  assert.equal(check({ resolved: 'https://registry.npmjs.org/vite/-/vite-1.0.0.tgz' }), false);
  assert.equal(check({ resolved: 'https://gdartifactory1.jfrog.io/x.tgz' }), true);
  assert.equal(check({ resolved: 'https://gdartifactory1.jfrog.io/x.tgz', link: false }), true);
});
