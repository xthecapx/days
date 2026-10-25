import { pixelToGps } from '../map/gpsGrid.js';
import { planSave, planConfirm } from '../domain/storePlans.js';
import { loadStore, persistStore } from '../storage/incidentStore.js';

/**
 * Use cases over incidents: builds the change with the rules from `domain/`, saves it with
 * `storage/` and leaves the result in the store. The UI never touches storage.
 */
export function createIncidentService(store, { sectorName = () => 'Sector Piedecuesta' } = {}) {
  const commit = ({ store: data, syncStatus }) => {
    store.set({ data });
    if (syncStatus) store.patch('sync', { message: syncStatus.message, ok: syncStatus.ok });
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
    }
  };
}
