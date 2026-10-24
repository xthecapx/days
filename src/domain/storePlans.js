import { buildIncident, buildSaveChange, buildConfirmChange, confirmedIncident } from './incident.js';
import { addRevision, snapshotOf } from './revisions.js';

/**
 * Cada función recibe el estado actual y devuelve el estado siguiente MÁS lo que hay que contarle al
 * mundo (nota del historial y mensaje para el puente). No guarda ni envía nada: eso lo hace el servicio.
 */

/**
 * Crea (editingId = null) o edita un incidente.
 * `coords` = { pixelX, pixelY, lat, lng } y `sector` ya resuelto por quien llama.
 */
export function planSave(store, input, editingId, { coords, sector, now = new Date() }) {
  const existing = editingId ? store.incidents.find((i) => i.id === editingId) : null;
  if (editingId && !existing) throw new Error(`No existe el incidente ${editingId}.`);

  const savedIncident = buildIncident(input, { existing, incidents: store.incidents, coords, sector, now });
  const incidents = existing
    ? store.incidents.map((i) => (i.id === editingId ? savedIncident : i))
    : [...store.incidents, savedIncident];

  const where = `Píxel (${coords.pixelX}, ${coords.pixelY})`;
  const note = existing
    ? `Edición Wiki de incidente #${savedIncident.number} en ${where}`
    : `Nuevo incidente #${savedIncident.number} en ${where} — ${savedIncident.category}`;

  return {
    nextStore: {
      ...store,
      incidents,
      revisions: addRevision(
        store,
        { action: existing ? 'EDIT' : 'CREATE', incidentId: savedIncident.id, note },
        now
      )
    },
    savedIncident,
    note,
    change: buildSaveChange(savedIncident, Boolean(existing))
  };
}

export function planConfirm(store, incidentId, { now = new Date() } = {}) {
  const target = store.incidents.find((i) => i.id === incidentId);
  const note = `Confirmación vecinal anónima sumada al incidente #${target ? target.number : 0}`;
  return {
    nextStore: {
      ...store,
      incidents: store.incidents.map((i) => (i.id === incidentId ? confirmedIncident(i, now) : i)),
      revisions: addRevision(store, { action: 'CONFIRM', incidentId, note }, now)
    },
    note,
    change: buildConfirmChange(incidentId)
  };
}

/** Vuelve al estado anterior a `revId`. Lanza si esa revisión no guardó foto. No genera mensaje para el puente. */
export function planRevert(store, revId, { now = new Date() } = {}) {
  const { incidents, incidentId } = snapshotOf(store, revId);
  const note = `Reversión Wiki ejecutada: se deshizo ${revId}`;
  return {
    nextStore: { ...store, incidents, revisions: addRevision(store, { action: 'REVERT', incidentId, note }, now) },
    note,
    change: null
  };
}
