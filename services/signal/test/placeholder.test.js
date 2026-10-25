import test from 'node:test';
import assert from 'node:assert/strict';
import pkg from '../package.json' with { type: 'json' };

test('el paquete del servidor existe y es independiente (sin dependencias de ejecución)', () => {
  assert.equal(pkg.name, '@days/signal');
  assert.equal(pkg.dependencies, undefined, 'el Worker no debe traer dependencias propias');
});
