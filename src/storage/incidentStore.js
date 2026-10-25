import { isLocalhost } from '../core/env.js';
import { normalizeStore } from './normalize.js';
import * as cache from './localCache.js';
import { loadFromRepository } from './repository.js';
import { saveToDisk } from './localDisk.js';
import { sendChange } from './bridgeClient.js';

/**
 * Persistence facade: ties together the repository, the browser copy, the disk (development)
 * and the bridge. Only the ORDER is decided here; each adapter does its own job.
 */

/**
 * The repository file is the source of truth. The browser copy serves only as an offline backup;
 * it never wins over the repository, so nobody has to "restore" after a publish and approved
 * PRs show up on the next load.
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
 * Saves the new state with no personal data or IP. With `change` (create, edit, confirm) and outside
 * localhost, it also sends it to the bridge so a PR is opened; a save without `change` stays only in the browser.
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
