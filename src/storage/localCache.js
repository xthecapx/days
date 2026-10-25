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

const SIGNAL_PREFS_KEY = 'vecinos_rio_hato_signal_v1';
const SIGNAL_OVERRIDE_KEY = 'vecinos_rio_hato_signal_server_v1';

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

/**
 * Preferencias de la señal de ayuda en ESTE navegador: si la persona activó la escucha, su identificador de oyente
 * (aleatorio, no la identifica y se borra con los datos del sitio) y la última señal que envió, con el token para
 * poder cancelarla. Siempre devuelve un objeto con esa forma, aunque lo guardado esté dañado.
 */
export const readSignalPrefs = () =>
  attempt('leer las preferencias de la señal', null, () => {
    const raw = localStorage.getItem(SIGNAL_PREFS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    const mine = p?.mine && typeof p.mine.id === 'string' && typeof p.mine.token === 'string' && Number.isFinite(p.mine.expiresAt) ? p.mine : null;
    return {
      listening: p?.listening === true,
      listenerId: typeof p?.listenerId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(p.listenerId) ? p.listenerId : null,
      mine
    };
  }) ?? { listening: false, listenerId: null, mine: null };

/** Devuelve true si se pudo guardar. */
export const writeSignalPrefs = (prefs) =>
  attempt('guardar las preferencias de la señal', false, () => {
    localStorage.setItem(SIGNAL_PREFS_KEY, JSON.stringify({ listening: Boolean(prefs.listening), listenerId: prefs.listenerId ?? null, mine: prefs.mine ?? null }));
    return true;
  });

/** Servidor de señal alternativo ({ baseUrl }) fijado a mano desde la consola; null si no hay. */
export const readSignalOverride = () =>
  attempt('leer el servidor de señal', null, () => {
    const raw = localStorage.getItem(SIGNAL_OVERRIDE_KEY);
    return raw ? JSON.parse(raw) : null;
  });
