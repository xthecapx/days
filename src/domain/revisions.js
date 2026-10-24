/**
 * Historial estilo wiki. Cada revisión guarda cómo estaban TODOS los incidentes justo antes del cambio,
 * por eso revertir es solo volver a poner esa foto.
 */

export const MAX_REVISIONS = 40;

const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * Devuelve la lista de revisiones con la nueva al frente (tope MAX_REVISIONS).
 * `store` es el estado ANTERIOR al cambio: de ahí sale la foto y el número de revisión.
 */
export function addRevision(store, { action, incidentId, note }, now = new Date()) {
  const revisions = store.revisions || [];
  const revision = {
    revId: `rev-${String(revisions.length + 1).padStart(3, '0')}`,
    timestamp: now.toISOString(),
    action,
    incidentId,
    note,
    previousIncidentsSnapshot: clone(store.incidents)
  };
  return [revision, ...revisions].slice(0, MAX_REVISIONS);
}

/** Incidentes tal como estaban antes de la revisión `revId`. Lanza si esa revisión no guardó foto. */
export function snapshotOf(store, revId) {
  const rev = (store.revisions || []).find((r) => r.revId === revId);
  if (!rev || !Array.isArray(rev.previousIncidentsSnapshot)) {
    throw new Error('Esta revisión inicial no tiene un estado previo al cual revertir.');
  }
  return { incidents: clone(rev.previousIncidentsSnapshot), incidentId: rev.incidentId };
}
