import { buildIncident, buildSaveChange, buildConfirmChange, confirmedIncident } from './incident.js';

/**
 * Each function receives the current state and returns the next state PLUS what has to be told to the
 * world (note for the commit and message for the bridge). It does not save or send anything: the service does that.
 * The change history is kept by git (each report is a Pull Request), not by the app.
 */

/**
 * Crea (editingId = null) o edita un incidente.
 * `coords` = { pixelX, pixelY, lat, lng } and `sector` already resolved by the caller.
 */
export function planSave(store, input, editingId, { coords, sector, now = new Date() }) {
  const existing = editingId ? store.incidents.find((i) => i.id === editingId) : null;
  if (editingId && !existing) throw new Error(`Incident ${editingId} does not exist.`);

  const savedIncident = buildIncident(input, { existing, incidents: store.incidents, coords, sector, now });
  const incidents = existing
    ? store.incidents.map((i) => (i.id === editingId ? savedIncident : i))
    : [...store.incidents, savedIncident];

  const where = `Píxel (${coords.pixelX}, ${coords.pixelY})`;
  const note = existing
    ? `Edición de incidente #${savedIncident.number} en ${where}`
    : `Nuevo incidente #${savedIncident.number} en ${where} — ${savedIncident.category}`;

  return {
    nextStore: { ...store, incidents },
    savedIncident,
    note,
    change: buildSaveChange(savedIncident, Boolean(existing))
  };
}

export function planConfirm(store, incidentId, { now = new Date() } = {}) {
  const target = store.incidents.find((i) => i.id === incidentId);
  return {
    nextStore: {
      ...store,
      incidents: store.incidents.map((i) => (i.id === incidentId ? confirmedIncident(i, now) : i))
    },
    note: `Confirmación vecinal anónima sumada al incidente #${target ? target.number : 0}`,
    change: buildConfirmChange(incidentId)
  };
}
