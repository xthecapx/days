/**
 * In-memory signal storage. It serves the tests and defines the contract any real storage must meet
 * (the Durable Object one uses SQLite): everything is synchronous and returns copies, never internal references.
 *
 *   list()                → all the signals (copies)
 *   save(signal)          → inserts or replaces by id
 *   remove(id)            → deletes one
 *   removeExpired(now)    → deletes those that have already expired (expiresAt <= now)
 */
export function createMemoryStorage() {
  const rows = new Map();
  return {
    list: () => [...rows.values()].map((r) => ({ ...r })),
    save: (signal) => {
      rows.set(signal.id, { ...signal });
    },
    remove: (id) => {
      rows.delete(id);
    },
    removeExpired: (now) => {
      for (const [id, row] of rows) if (row.expiresAt <= now) rows.delete(id);
    }
  };
}
