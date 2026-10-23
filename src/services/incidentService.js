import { detectSectorName } from '../map/mapData.js';
import {
  loadWikiStore,
  saveIncidentWikiRevision,
  confirmIncidentAnonymously,
  revertWikiRevision,
  resetToRepositorySeed,
  persistWikiStore
} from '../storage/wikiJsonStore.js';

/**
 * Casos de uso sobre los incidentes. Habla con la capa de persistencia
 * (`storage/`) y deja el resultado en el store; la UI nunca toca el storage.
 */
export function createIncidentService(store) {
  const commit = ({ store: data, syncStatus }) => {
    store.set({ data });
    if (syncStatus) store.patch('sync', { message: syncStatus.message });
  };

  const current = () => store.get().data;

  return {
    async load() {
      store.set({ data: await loadWikiStore() });
    },

    async save(payload, editingId = null) {
      const result = await saveIncidentWikiRevision(current(), payload, editingId);
      commit(result);
      return result.savedIncident;
    },

    async confirm(id) {
      commit(await confirmIncidentAnonymously(current(), id));
    },

    async move(id, pixelX, pixelY) {
      const incident = current().incidents.find((i) => i.id === id);
      if (!incident) return null;
      const result = await saveIncidentWikiRevision(
        current(),
        { ...incident, pixelX, pixelY, sector: detectSectorName(pixelX, pixelY) },
        id
      );
      commit(result);
      return result.savedIncident;
    },

    async revert(revId) {
      try {
        commit(await revertWikiRevision(current(), revId));
      } catch (err) {
        store.patch('sync', { message: err.message });
      }
    },

    async importJson(text) {
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.incidents)) throw new Error('incidents.json inválido');
      commit(await persistWikiStore(parsed, 'Importación manual de incidents.json'));
    },

    async resetToSeed() {
      store.set({ data: await resetToRepositorySeed() });
      store.patch('sync', { message: 'Restaurados los incidentes iniciales' });
    }
  };
}
