import { isLocalhost } from '../core/env.js';
import { normalizeStore } from './normalize.js';
import * as cache from './localCache.js';
import { loadFromRepository } from './repository.js';
import { saveToDisk } from './localDisk.js';
import { sendChange } from './bridgeClient.js';

/**
 * Fachada de persistencia: junta el repositorio, la copia del navegador, el disco (desarrollo)
 * y el puente. Aquí solo se decide el ORDEN; cada adaptador hace su trabajo.
 */

/**
 * El archivo del repositorio es la fuente de verdad. La copia del navegador solo sirve de respaldo sin
 * conexión; nunca gana sobre el repositorio, así nadie tiene que "restaurar" tras una publicación y los
 * PR aprobados se ven en la siguiente carga.
 */
export async function loadStore() {
  cache.purgeLegacyStores();
  const remote = await loadFromRepository(cache.readBridgeConfig());
  if (remote) {
    cache.writeStore(remote);
    return normalizeStore(remote);
  }
  return normalizeStore(cache.readStore() || { incidents: [] });
}

/**
 * Guarda el nuevo estado sin ningún dato personal ni IP. Con `change` (crear, editar, confirmar) y fuera de
 * localhost, además lo manda al puente para que se abra un PR; un guardado sin `change` solo queda en el navegador.
 */
export async function persistStore(storeData, commitSummary = 'Actualización anónima en incidents.json', change = null) {
  const store = normalizeStore(storeData);
  store.lastUpdated = new Date().toISOString();
  cache.writeStore(store);

  let syncStatus = { mode: 'local', ok: true, message: 'Guardado en memoria local' };

  if (isLocalhost()) {
    if (await saveToDisk(store)) {
      syncStatus = { mode: 'disk', ok: true, message: 'Guardado en data/incidents.json' };
    }
    return { store, syncStatus };
  }

  const { bridgeUrl } = cache.readBridgeConfig();
  if (bridgeUrl && change) syncStatus = await sendChange(bridgeUrl, change, commitSummary);
  return { store, syncStatus };
}
