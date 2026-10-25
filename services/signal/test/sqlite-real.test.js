import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqlStorage } from '../src/sqlStorage.js';
import { createBoard } from '../src/board.js';

/**
 * Tests against a real SQLite (the `node:sqlite` module, the same engine a Durable Object uses). The other storage
 * tests use a fake database that only imitates the calls; these check that the SQL works and that expired rows ARE DELETED.
 * If this version of Node does not ship `node:sqlite`, they are skipped.
 */
let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  /* Node without node:sqlite */
}
const skip = DatabaseSync ? false : 'this Node does not ship node:sqlite';

function open() {
  const db = new DatabaseSync(':memory:');
  // Same contract as ctx.storage.sql: exec(query, ...values) → { toArray() }
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

test('Real SQLite: what expires is DELETED from the database (not just hidden)', { skip }, () => {
  const { sql, rows } = open();
  let t = 1_800_000_000_000;
  const board = createBoard({ storage: createSqlStorage(sql), now: () => t });
  board.send({ client: 'cliente-uno-1', ...HOME });
  board.send({ client: 'cliente-dos-2', lat: 7.006, lng: -73.063 });
  assert.equal(rows().length, 2);
  t += 30 * MIN - 1;
  board.state();
  assert.equal(rows().length, 2, 'at 29:59 they are still active');
  t += 1;
  board.state();
  assert.equal(rows().length, 0, 'at 30:00 no row exists any more');
});

test('Real SQLite: reading the state after expiry deletes, even if nobody sends anything new', { skip }, () => {
  const { sql, rows } = open();
  let t = 1_800_000_000_000;
  const board = createBoard({ storage: createSqlStorage(sql), now: () => t });
  board.send({ client: 'cliente-uno-1', ...HOME });
  t += 31 * MIN;
  board.nextExpiry(); // what the Durable Object cleanup alarm calls
  assert.equal(rows().length, 0);
});

test('Real SQLite: cancelling deletes the row; replacing the same person\'s alert leaves only one', { skip }, () => {
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

test('Real SQLite (anonymity): the table has no columns for exact coordinates, free text or IP', { skip }, () => {
  const { sql, db, rows } = open();
  const board = createBoard({ storage: createSqlStorage(sql), now: () => 1_800_000_000_000 });
  board.send({ client: 'cliente-uno-1', lat: 7.0051234, lng: -73.0645678 });
  const cols = db.prepare('pragma table_info(signals)').all().map((c) => c.name);
  assert.deepEqual(cols, ['id', 'client', 'token', 'x', 'y', 'created_at', 'expires_at']);
  const row = rows()[0];
  assert.ok(Number.isInteger(row.x) && Number.isInteger(row.y), 'only the map tile, as integers');
  assert.doesNotMatch(JSON.stringify(row), /7\.005|73\.064/, 'no exact coordinate');
});

test('Real SQLite: values with quotes and SQL are not executed (they go as parameters)', { skip }, () => {
  const { sql, rows } = open();
  const store = createSqlStorage(sql);
  const evil = "x'); DROP TABLE signals;--";
  store.save({ id: evil, client: evil, token: evil, x: 1, y: 2, at: 1, expiresAt: 2 });
  assert.equal(rows().length, 1, 'the table is still there');
  assert.equal(rows()[0].id, evil, 'and the text was stored as is');
  store.remove(evil);
  assert.equal(rows().length, 0);
});

test('Real SQLite: creating the storage twice (the Durable Object restarts) loses and duplicates nothing', { skip }, () => {
  const { sql, rows } = open();
  createSqlStorage(sql).save({ id: 'abcd1234', client: 'cliente-uno-1', token: 't', x: 1, y: 2, at: 1, expiresAt: 99_999_999_999_999 });
  const again = createSqlStorage(sql);
  assert.equal(again.list().length, 1);
  assert.equal(rows().length, 1);
});
