import { pixelToGps } from '../map/gpsGrid.js';
import { planSave, planConfirm, planRevert } from '../domain/storePlans.js';
import { loadStore, persistStore, loadSeed } from '../storage/incidentStore.js';

/**
 * Casos de uso sobre los incidentes: arma el cambio con las reglas de `domain/`, lo guarda con
 * `storage/` y deja el resultado en el store. La UI nunca toca el almacenamiento.
 */
export function createIncidentService(store, { sectorName = () => 'Sector Piedecuesta' } = {}) {
  const commit = ({ store: data, syncStatus }) => {
    store.set({ data });
    if (syncStatus) store.patch('sync', { message: syncStatus.message });
  };

  const current = () => store.get().data;
  const apply = async (plan) => {
    commit(await persistStore(plan.nextStore, plan.note, plan.change));
    return plan;
  };

  async function save(payload, editingId = null) {
    const coords = pixelToGps(payload.pixelX, payload.pixelY);
    const sector = payload.sector?.trim() || sectorName(coords.pixelX, coords.pixelY);
    const plan = planSave(current(), payload, editingId, { coords, sector });
    return (await apply(plan)).savedIncident;
  }

  return {
    async load() {
      store.set({ data: await loadStore() });
    },

    save,

    async confirm(id) {
      await apply(planConfirm(current(), id));
    },

    async move(id, pixelX, pixelY) {
      const incident = current().incidents.find((i) => i.id === id);
      if (!incident) return null;
      return save({ ...incident, pixelX, pixelY, sector: sectorName(pixelX, pixelY) }, id);
    },

    async revert(revId) {
      try {
        await apply(planRevert(current(), revId));
      } catch (err) {
        store.patch('sync', { message: err.message });
      }
    },

    async importJson(text) {
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.incidents)) throw new Error('incidents.json inválido');
      commit(await persistStore(parsed, 'Importación manual de incidents.json'));
    },

    async resetToSeed() {
      store.set({ data: await loadSeed() });
      store.patch('sync', { message: 'Restaurados los incidentes iniciales' });
    }
  };
}
