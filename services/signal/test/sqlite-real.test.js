import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqlStorage } from '../src/sqlStorage.js';
import { createBoard } from '../src/board.js';

/**
 * Pruebas contra un SQLite de verdad (el módulo `node:sqlite`, el mismo motor que usa un Durable Object). Las demás pruebas del
 * almacén usan una base falsa que solo imita las llamadas; estas comprueban que el SQL funciona y que lo vencido SE BORRA.
 * Si esta versión de Node no trae `node:sqlite`, se omiten.
 */
let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  /* Node sin node:sqlite */
}
const skip = DatabaseSync ? false : 'este Node no trae node:sqlite';

function open() {
  const db = new DatabaseSync(':memory:');
  // Mismo contrato que ctx.storage.sql: exec(consulta, ...valores) → { toArray() }
  const sql = {
    exec(q, ...v) {
      const st = db.prepare(q);
      return /^\s*(select|pragma)/i.test(q) ? { toArray: () => st.all(...v) } : (st.run(...v), { toArray: () => [] });
    }
  };
  return { db, sql, rows: () => db.prepare('select * from signals').all() };
}
const MIN = 60_000;
const HOME = { lat: 7.005, lng: -73.064 };

test('SQLite real: lo que vence se BORRA de la base (no solo se oculta)', { skip }, () => {
  const { sql, rows } = open();
  let t = 1_800_000_000_000;
  const board = createBoard({ storage: createSqlStorage(sql), now: () => t });
  board.send({ client: 'cliente-uno-1', ...HOME });
  board.send({ client: 'cliente-dos-2', lat: 7.006, lng: -73.063 });
  assert.equal(rows().length, 2);
  t += 30 * MIN - 1;
  board.state();
  assert.equal(rows().length, 2, 'a los 29:59 siguen activas');
  t += 1;
  board.state();
  assert.equal(rows().length, 0, 'a los 30:00 ya no existe ninguna fila');
});

test('SQLite real: leer el estado después del vencimiento borra, aunque nadie envíe nada nuevo', { skip }, () => {
  const { sql, rows } = open();
  let t = 1_800_000_000_000;
  const board = createBoard({ storage: createSqlStorage(sql), now: () => t });
  board.send({ client: 'cliente-uno-1', ...HOME });
  t += 31 * MIN;
  board.nextExpiry(); // lo que llama la alarma de limpieza del Durable Object
  assert.equal(rows().length, 0);
});

test('SQLite real: cancelar borra la fila; reemplazar la alerta de la misma persona deja una sola', { skip }, () => {
  const { sql, rows } = open();
  const board = createBoard({ storage: createSqlStorage(sql), now: () => 1_800_000_000_000 });
  const first = board.send({ client: 'cliente-uno-1', ...HOME });
  board.send({ client: 'cliente-uno-1', lat: 7.007, lng: -73.062 });
  assert.equal(rows().length, 1);
  assert.notEqual(rows()[0].id, first.id);
  const second = rows()[0];
  board.cancel({ id: second.id, token: second.token });
  assert.equal(rows().length, 0);
});

test('SQLite real (anonimato): la tabla no tiene columnas de coordenadas exactas, texto libre ni IP', { skip }, () => {
  const { sql, db, rows } = open();
  const board = createBoard({ storage: createSqlStorage(sql), now: () => 1_800_000_000_000 });
  board.send({ client: 'cliente-uno-1', lat: 7.0051234, lng: -73.0645678 });
  const cols = db.prepare('pragma table_info(signals)').all().map((c) => c.name);
  assert.deepEqual(cols, ['id', 'client', 'token', 'x', 'y', 'created_at', 'expires_at']);
  const row = rows()[0];
  assert.ok(Number.isInteger(row.x) && Number.isInteger(row.y), 'solo la casilla del mapa, en enteros');
  assert.doesNotMatch(JSON.stringify(row), /7\.005|73\.064/, 'ninguna coordenada exacta');
});

test('SQLite real: valores con comillas y SQL no se ejecutan (van como parámetros)', { skip }, () => {
  const { sql, rows } = open();
  const store = createSqlStorage(sql);
  const evil = "x'); DROP TABLE signals;--";
  store.save({ id: evil, client: evil, token: evil, x: 1, y: 2, at: 1, expiresAt: 2 });
  assert.equal(rows().length, 1, 'la tabla sigue ahí');
  assert.equal(rows()[0].id, evil, 'y el texto se guardó tal cual');
  store.remove(evil);
  assert.equal(rows().length, 0);
});

test('SQLite real: crear el almacén dos veces (el Durable Object se reinicia) no pierde ni duplica nada', { skip }, () => {
  const { sql, rows } = open();
  createSqlStorage(sql).save({ id: 'abcd1234', client: 'cliente-uno-1', token: 't', x: 1, y: 2, at: 1, expiresAt: 99_999_999_999_999 });
  const again = createSqlStorage(sql);
  assert.equal(again.list().length, 1);
  assert.equal(rows().length, 1);
});
