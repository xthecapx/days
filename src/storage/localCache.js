/**
 * The only place that touches localStorage. Never throws: in private mode or with a full disk it returns the
 * fallback value and leaves a warning in the console.
 */

// v4: the v3 copies (which won over the repository) are ignored and deleted on load.
const STORAGE_KEY = 'vecinos_rio_hato_wiki_json_v4';
const LEGACY_STORAGE_KEYS = ['vecinos_rio_hato_wiki_json_v3'];
const BRIDGE_CONFIG_KEY = 'vecinos_rio_hato_github_bridge_v1';

// Default repository for live reading from GitHub Pages
export const DEFAULT_GITHUB_REPO = 'xthecapx/days';
// URL of the Cloudflare Worker bridge that opens the Pull Request for each report:
export const DEFAULT_BRIDGE_URL = 'https://days.xthecapx.workers.dev/';

const SIGNAL_PREFS_KEY = 'vecinos_rio_hato_signal_v1';
const SIGNAL_OVERRIDE_KEY = 'vecinos_rio_hato_signal_server_v1';

function attempt(what, fallback, fn) {
  try {
    return fn();
  } catch (err) {
    console.warn(`localStorage: could not ${what}`, err);
    return fallback;
  }
}

/** Last saved copy of incidents.json (serves only as an offline backup). */
export const readStore = () =>
  attempt('read the local copy', null, () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  });

/** Returns true if it could be saved. */
export const writeStore = (data) =>
  attempt('save the local copy', false, () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  });

export const purgeLegacyStores = () =>
  attempt('delete old copies', undefined, () => LEGACY_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k)));

/** Bridge and repository configured (defaults are this project's; they can be changed from the console). */
export const readBridgeConfig = () =>
  attempt('read the bridge configuration', null, () => {
    const raw = localStorage.getItem(BRIDGE_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { bridgeUrl: parsed.bridgeUrl || DEFAULT_BRIDGE_URL, githubRepo: parsed.githubRepo || DEFAULT_GITHUB_REPO };
  }) ?? { bridgeUrl: DEFAULT_BRIDGE_URL, githubRepo: DEFAULT_GITHUB_REPO };

/**
 * Help-signal preferences in THIS browser: whether the person turned listening on, their listener identifier
 * (random, does not identify them and is erased with the site data). Always returns an object of that shape, even if what
 * is stored is corrupted (or still has the old `mine` field from when the app could send alerts: it is ignored and dropped).
 */
export const readSignalPrefs = () =>
  attempt('read the signal preferences', null, () => {
    const raw = localStorage.getItem(SIGNAL_PREFS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return {
      listening: p?.listening === true,
      listenerId: typeof p?.listenerId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(p.listenerId) ? p.listenerId : null
    };
  }) ?? { listening: false, listenerId: null };

/** Returns true if it could be saved. */
export const writeSignalPrefs = (prefs) =>
  attempt('save the signal preferences', false, () => {
    localStorage.setItem(SIGNAL_PREFS_KEY, JSON.stringify({ listening: Boolean(prefs.listening), listenerId: prefs.listenerId ?? null }));
    return true;
  });

/** Alternative signal server ({ baseUrl }) set by hand from the console; null if none. */
export const readSignalOverride = () =>
  attempt('read the signal server', null, () => {
    const raw = localStorage.getItem(SIGNAL_OVERRIDE_KEY);
    return raw ? JSON.parse(raw) : null;
  });
