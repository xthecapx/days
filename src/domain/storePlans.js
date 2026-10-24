import { buildIncident, buildSaveChange, buildConfirmChange, confirmedIncident } from './incident.js';

/**
 * Cada función recibe el estado actual y devuelve el estado siguiente MÁS lo que hay que contarle al
 * mundo (nota para el commit y mensaje para el puente). No guarda ni envía nada: eso lo hace el servicio.
 * El historial de cambios lo lleva git (cada reporte es un Pull Request), no la app.
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
