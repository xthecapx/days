/**
 * Único lugar que toca localStorage. Nunca lanza: en modo privado o con el disco lleno devuelve el
 * valor de respaldo y deja un aviso en la consola.
 */

// v4: las copias v3 (que ganaban sobre el repositorio) se ignoran y se borran al cargar.
const STORAGE_KEY = 'vecinos_rio_hato_wiki_json_v4';
const LEGACY_STORAGE_KEYS = ['vecinos_rio_hato_wiki_json_v3'];
const BRIDGE_CONFIG_KEY = 'vecinos_rio_hato_github_bridge_v1';

// Repositorio por defecto para lectura en vivo desde GitHub Pages
export const DEFAULT_GITHUB_REPO = 'xthecapx/days';
// URL del puente Cloudflare Worker que abre el Pull Request de cada reporte:
export const DEFAULT_BRIDGE_URL = 'https://days.xthecapx.workers.dev/';

function attempt(what, fallback, fn) {
  try {
    return fn();
  } catch (err) {
    console.warn(`localStorage: no se pudo ${what}`, err);
    return fallback;
  }
}

/** Última copia guardada de incidents.json (solo sirve de respaldo sin conexión). */
export const readStore = () =>
  attempt('leer la copia local', null, () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  });

/** Devuelve true si se pudo guardar. */
export const writeStore = (data) =>
  attempt('guardar la copia local', false, () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  });

export const clearStore = () => attempt('borrar la copia local', undefined, () => localStorage.removeItem(STORAGE_KEY));

export const purgeLegacyStores = () =>
  attempt('borrar copias antiguas', undefined, () => LEGACY_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k)));

/** Puente y repositorio configurados (por defecto los de este proyecto; se pueden cambiar desde la consola). */
export const readBridgeConfig = () =>
  attempt('leer la configuración del puente', null, () => {
    const raw = localStorage.getItem(BRIDGE_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { bridgeUrl: parsed.bridgeUrl || DEFAULT_BRIDGE_URL, githubRepo: parsed.githubRepo || DEFAULT_GITHUB_REPO };
  }) ?? { bridgeUrl: DEFAULT_BRIDGE_URL, githubRepo: DEFAULT_GITHUB_REPO };
