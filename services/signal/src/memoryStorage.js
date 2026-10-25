/**
 * Almacén de señales en memoria. Sirve para las pruebas y define el contrato que debe cumplir cualquier almacén
 * real (el del Durable Object usa SQLite): todo es síncrono y devuelve copias, nunca referencias internas.
 *
 *   list()                → todas las señales (copias)
 *   save(signal)          → inserta o reemplaza por id
 *   remove(id)            → borra una
 *   removeExpired(now)    → borra las que ya vencieron (expiresAt <= now)
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
