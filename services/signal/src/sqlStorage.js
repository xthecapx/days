/**
 * Signal storage on a Durable Object's SQLite. It meets the same contract as memoryStorage.js
 * (list / save / remove / removeExpired, all synchronous): `sql` is `ctx.storage.sql`, or any object with
 * `exec(query, ...values)` that returns something with `toArray()`.
 */
export function createSqlStorage(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY,
    client TEXT NOT NULL,
    token TEXT NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`);
  sql.exec('CREATE INDEX IF NOT EXISTS signals_expires ON signals (expires_at)');

  const toSignal = (r) => ({ id: r.id, client: r.client, token: r.token, x: r.x, y: r.y, at: r.created_at, expiresAt: r.expires_at });

  return {
    list: () => sql.exec('SELECT id, client, token, x, y, created_at, expires_at FROM signals').toArray().map(toSignal),
    save: (s) => {
      sql.exec('INSERT OR REPLACE INTO signals (id, client, token, x, y, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)', s.id, s.client, s.token, s.x, s.y, s.at, s.expiresAt);
    },
    remove: (id) => {
      sql.exec('DELETE FROM signals WHERE id = ?', id);
    },
    removeExpired: (now) => {
      sql.exec('DELETE FROM signals WHERE expires_at <= ?', now);
    }
  };
}
