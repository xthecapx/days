import { pixelToGps, gpsToPixel } from '../map/gpsGrid.js';
import { detectSectorName } from '../map/mapData.js';
import { buildIncident, buildSaveChange, buildConfirmChange, confirmedIncident } from '../domain/incident.js';
import { addRevision, snapshotOf } from '../domain/revisions.js';

// v4: las copias v3 (que ganaban sobre el repositorio) se ignoran y se borran al cargar.
const STORAGE_KEY = 'vecinos_rio_hato_wiki_json_v4';
const LEGACY_STORAGE_KEYS = ['vecinos_rio_hato_wiki_json_v3'];
const BRIDGE_CONFIG_KEY = 'vecinos_rio_hato_github_bridge_v1';

// Repositorio por defecto para lectura en vivo desde GitHub Pages
export const DEFAULT_GITHUB_REPO = 'xthecapx/days';
// URL del puente Cloudflare Worker para commits anónimos en GitHub:
export const DEFAULT_BRIDGE_URL = 'https://days.xthecapx.workers.dev/';

/**
 * Carga la configuración opcional del Puente GitHub Pages (Cloudflare Worker o Raw URL)
 */
export function getBridgeConfig() {
  try {
    const raw = localStorage.getItem(BRIDGE_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        bridgeUrl: parsed.bridgeUrl || DEFAULT_BRIDGE_URL,
        githubRepo: parsed.githubRepo || DEFAULT_GITHUB_REPO
      };
    }
  } catch (_) {}
  return {
    bridgeUrl: DEFAULT_BRIDGE_URL,
    githubRepo: DEFAULT_GITHUB_REPO
  };
}

export function saveBridgeConfig(config) {
  const clean = {
    bridgeUrl: (config.bridgeUrl || '').trim(),
    githubRepo: (config.githubRepo || '').trim()
  };
  localStorage.setItem(BRIDGE_CONFIG_KEY, JSON.stringify(clean));
  return clean;
}

/**
 * Carga el estado de data/incidents.json (desde GitHub Raw / archivo del repositorio + caché local)
 */
export async function loadWikiStore() {
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch (_) {}
  }
  const bridge = getBridgeConfig();
  let remoteData = null;
  const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  if (!isLocalhost && bridge.githubRepo) {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${bridge.githubRepo}/main/data/incidents.json?t=${Date.now()}`;
      const res = await fetch(rawUrl, { cache: 'no-store' });
      if (res.ok) {
        remoteData = await res.json();
      }
    } catch (_) {}
  }

  if (!remoteData) {
    try {
      const res = await fetch(`./data/incidents.json?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        remoteData = await res.json();
      }
    } catch (err) {
      console.warn('No se pudo cargar ./data/incidents.json remoto, usando respaldo local:', err);
    }
  }

  // El archivo del repositorio es la fuente de verdad. La copia guardada en el navegador solo
  // sirve de respaldo sin conexión; nunca gana sobre el repositorio, así nadie tiene que
  // "restaurar" tras una publicación y los PR aprobados se ven en la siguiente carga.
  if (remoteData) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remoteData));
    } catch (_) {}
    return normalizeStore(remoteData);
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeStore(JSON.parse(saved));
  } catch (_) {}

  return normalizeStore({ incidents: [], revisions: [] });
}

/**
 * lat/lng es la fuente de verdad del incidente; el tile se recalcula en cada carga
 * para que cambiar la grilla o el área del mapa nunca mueva un incidente.
 */
function anchorToGrid(inc) {
  if (!Number.isFinite(inc.lat) || !Number.isFinite(inc.lng)) return inc;
  const { pixelX, pixelY, insideBounds } = gpsToPixel(inc.lat, inc.lng);
  return insideBounds ? { ...inc, pixelX, pixelY } : inc;
}

function normalizeStore(data) {
  const incidents = (Array.isArray(data.incidents) ? data.incidents : []).map(anchorToGrid);
  incidents.sort((a, b) => (a.number || 0) - (b.number || 0));
  const revisions = Array.isArray(data.revisions) ? data.revisions : [];
  return {
    schemaVersion: 3,
    neighborhood: data.neighborhood || 'Sendero Río del Hato y Ciudad Tierrabuena',
    referenceCenter: data.referenceCenter || {
      lat: 7.0060325,
      lng: -73.0640861,
      zoom: 16.21,
      userPositionPixel: { x: 68, y: 49, label: 'Hogar' }
    },
    lastUpdated: data.lastUpdated || new Date().toISOString(),
    incidents,
    revisions
  };
}

/**
 * Persiste el nuevo estado de incidents.json sin guardar ningún dato personal ni IP
 */
export async function persistWikiStore(storeData, commitSummary = 'Actualización anónima en incidents.json', change = null) {
  const normalized = normalizeStore(storeData);
  normalized.lastUpdated = new Date().toISOString();

  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));

  let syncStatus = { mode: 'local', ok: true, message: 'Guardado en memoria local' };

  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    try {
      const res = await fetch('/api/local-wiki-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalized)
      });
      if (res.ok) {
        syncStatus = {
          mode: 'disk',
          ok: true,
          message: 'Guardado en data/incidents.json'
        };
      }
    } catch (_) {}
  }

  // Los cambios no se publican solos: el puente abre un Pull Request y el dueño lo revisa.
  // En localhost no se llama al puente (así probar no abre PRs). Sin `change` (importar,
  // restaurar, revertir) tampoco se envía nada: esos cambios se hacen con git.
  const bridge = getBridgeConfig();
  const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (bridge.bridgeUrl && change && !isLocalhost) {
    try {
      const res = await fetch(bridge.bridgeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitMessage: `Wiki Vecinal: ${commitSummary}`, change })
      });
      if (res.ok) {
        syncStatus = {
          mode: 'pr',
          ok: true,
          message: 'Enviado para revisión (aparecerá cuando se apruebe)'
        };
      } else if (res.status === 429) {
        syncStatus = {
          mode: 'github-limited',
          ok: false,
          message: 'Guardado localmente; hay demasiados reportes pendientes, intenta más tarde'
        };
      } else {
        syncStatus = {
          mode: 'github-error',
          ok: false,
          message: 'Guardado localmente (el puente rechazó el reporte)'
        };
      }
    } catch (_) {
      syncStatus = {
        mode: 'github-offline',
        ok: false,
        message: 'Guardado localmente (sin conexión al puente)'
      };
    }
  }

  return { store: normalized, syncStatus };
}

/**
 * Agrega un nuevo incidente o edita uno existente manteniendo historial estilo Wikipedia
 */
export async function saveIncidentWikiRevision(currentStore, incidentInput, editingId = null) {
  const coords = pixelToGps(incidentInput.pixelX, incidentInput.pixelY);
  const sector = incidentInput.sector?.trim() || detectSectorName(coords.pixelX, coords.pixelY);
  const now = new Date();

  const existing = editingId ? currentStore.incidents.find((i) => i.id === editingId) : null;
  if (editingId && !existing) throw new Error(`No existe el incidente ${editingId}.`);
  const targetIncident = existing
    ? buildIncident(incidentInput, { existing, coords, sector, now })
    : buildIncident(incidentInput, { incidents: currentStore.incidents, coords, sector, now });

  const incidents = existing
    ? currentStore.incidents.map((i) => (i.id === editingId ? targetIncident : i))
    : [...currentStore.incidents, targetIncident];

  const where = `Píxel (${coords.pixelX}, ${coords.pixelY})`;
  const note = editingId
    ? `Edición Wiki de incidente #${targetIncident.number} en ${where}`
    : `Nuevo incidente #${targetIncident.number} en ${where} — ${targetIncident.category}`;

  const nextStore = {
    ...currentStore,
    incidents,
    revisions: addRevision(
      currentStore,
      { action: editingId ? 'EDIT' : 'CREATE', incidentId: targetIncident.id, note },
      now
    )
  };

  const result = await persistWikiStore(nextStore, note, buildSaveChange(targetIncident, Boolean(editingId)));
  return { ...result, savedIncident: targetIncident };
}

export async function confirmIncidentAnonymously(currentStore, incidentId) {
  const now = new Date();
  const target = currentStore.incidents.find((i) => i.id === incidentId);
  const note = `Confirmación vecinal anónima sumada al incidente #${target ? target.number : 0}`;

  const nextStore = {
    ...currentStore,
    incidents: currentStore.incidents.map((i) => (i.id === incidentId ? confirmedIncident(i, now) : i)),
    revisions: addRevision(currentStore, { action: 'CONFIRM', incidentId, note }, now)
  };

  return persistWikiStore(nextStore, note, buildConfirmChange(incidentId));
}

export async function revertWikiRevision(currentStore, revId) {
  const { incidents, incidentId } = snapshotOf(currentStore, revId);
  const note = `Reversión Wiki ejecutada: se deshizo ${revId}`;

  const nextStore = {
    ...currentStore,
    incidents,
    revisions: addRevision(currentStore, { action: 'REVERT', incidentId, note })
  };

  return persistWikiStore(nextStore, note);
}

export async function resetToRepositorySeed() {
  localStorage.removeItem(STORAGE_KEY);
  const res = await fetch(`./data/incidents.json?t=${Date.now()}`, { cache: 'no-store' });
  const seed = await res.json();
  return normalizeStore(seed);
}
