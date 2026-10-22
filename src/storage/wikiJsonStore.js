import { pixelToGps, detectSectorName } from '../map/gpsGrid.js';

const STORAGE_KEY = 'vecinos_rio_hato_wiki_json_v3';
const BRIDGE_CONFIG_KEY = 'vecinos_rio_hato_github_bridge_v1';

/**
 * Carga la configuración opcional del Puente GitHub Pages (Cloudflare Worker o Raw URL)
 */
export function getBridgeConfig() {
  try {
    const raw = localStorage.getItem(BRIDGE_CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return {
    bridgeUrl: '',
    githubRepo: ''
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
  const bridge = getBridgeConfig();
  let remoteData = null;

  if (bridge.githubRepo) {
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

  let localData = null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      localData = JSON.parse(saved);
    }
  } catch (_) {}

  if (remoteData && (!localData || (remoteData.revisions?.length || 0) >= (localData.revisions?.length || 0))) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remoteData));
    return normalizeStore(remoteData);
  }

  if (localData) {
    return normalizeStore(localData);
  }

  return normalizeStore(remoteData || { incidents: [], revisions: [] });
}

function normalizeStore(data) {
  const incidents = Array.isArray(data.incidents) ? data.incidents : [];
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
export async function persistWikiStore(storeData, commitSummary = 'Actualización anónima en incidents.json') {
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

  const bridge = getBridgeConfig();
  if (bridge.bridgeUrl) {
    try {
      const res = await fetch(bridge.bridgeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commitMessage: `Wiki Vecinal: ${commitSummary}`,
          content: normalized
        })
      });
      if (res.ok) {
        syncStatus = {
          mode: 'github',
          ok: true,
          message: 'Commit anónimo guardado en GitHub'
        };
      } else {
        syncStatus = {
          mode: 'github-error',
          ok: false,
          message: 'Guardado localmente (error en puente GitHub)'
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

export function formatSpanishDateLabel(dateStr, timeStr, dateConfirmed = true, timeConfirmed = true) {
  const months = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  let datePart = 'Fecha por confirmar';
  if (dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (y && m && d) {
      datePart = `${d} de ${months[m - 1]}`;
      if (!dateConfirmed) datePart += ' (Por confirmar)';
    }
  }

  let timePart = 'Hora por confirmar';
  if (timeStr && timeConfirmed) {
    const [hh, mm] = timeStr.split(':').map(Number);
    if (!Number.isNaN(hh) && !Number.isNaN(mm)) {
      const period = hh >= 12 ? 'p. m.' : 'a. m.';
      const h12 = hh % 12 || 12;
      timePart = `${h12}:${String(mm).padStart(2, '0')} ${period}`;
    }
  } else if (timeStr && !timeConfirmed) {
    timePart = `${timeStr} (Hora por confirmar)`;
  }

  return `${datePart} - ${timePart}`;
}

/**
 * Agrega un nuevo incidente o edita uno existente manteniendo historial estilo Wikipedia
 */
export async function saveIncidentWikiRevision(currentStore, incidentInput, editingId = null) {
  const prevSnapshot = JSON.parse(JSON.stringify(currentStore.incidents));
  const coords = pixelToGps(incidentInput.pixelX, incidentInput.pixelY);
  const autoSector = incidentInput.sector?.trim() || detectSectorName(coords.pixelX, coords.pixelY);

  const dateConfirmed = Boolean(incidentInput.dateConfirmed);
  const timeConfirmed = Boolean(incidentInput.timeConfirmed);
  const dateLabel = formatSpanishDateLabel(
    incidentInput.date,
    incidentInput.time,
    dateConfirmed,
    timeConfirmed
  );

  const impactType = incidentInput.impactType === 'tranquilidad' ? 'tranquilidad' : 'seguridad';

  let updatedIncidents = [...currentStore.incidents];
  let actionType = 'CREATE';
  let targetIncident = null;

  if (editingId) {
    actionType = 'EDIT';
    updatedIncidents = updatedIncidents.map((item) => {
      if (item.id !== editingId) return item;
      targetIncident = {
        ...item,
        date: incidentInput.date,
        time: incidentInput.time || '12:00',
        dateLabel,
        dateConfirmed,
        timeConfirmed,
        impactType,
        category: incidentInput.category,
        severity: Number(incidentInput.severity) || 3,
        pixelX: coords.pixelX,
        pixelY: coords.pixelY,
        lat: coords.lat,
        lng: coords.lng,
        sector: autoSector,
        description: incidentInput.description.trim(),
        updatedAt: new Date().toISOString()
      };
      return targetIncident;
    });
  } else {
    const nextNumber = updatedIncidents.reduce((max, i) => Math.max(max, i.number || 0), 0) + 1;
    targetIncident = {
      id: `inc-${String(nextNumber).padStart(3, '0')}-${Date.now().toString(36).slice(-3)}`,
      number: nextNumber,
      date: incidentInput.date,
      time: incidentInput.time || '12:00',
      dateLabel,
      dateConfirmed,
      timeConfirmed,
      impactType,
      category: incidentInput.category,
      severity: Number(incidentInput.severity) || 3,
      pixelX: coords.pixelX,
      pixelY: coords.pixelY,
      lat: coords.lat,
      lng: coords.lng,
      sector: autoSector,
      description: incidentInput.description.trim(),
      confirmations: 1,
      updatedAt: new Date().toISOString()
    };
    updatedIncidents.push(targetIncident);
  }

  const revNumber = (currentStore.revisions?.length || 0) + 1;
  const summaryNote = actionType === 'CREATE'
    ? `Nuevo incidente #${targetIncident.number} en Píxel (${coords.pixelX}, ${coords.pixelY}) — ${targetIncident.category}`
    : `Edición Wiki de incidente #${targetIncident.number} en Píxel (${coords.pixelX}, ${coords.pixelY})`;

  const newRevision = {
    revId: `rev-${String(revNumber).padStart(3, '0')}`,
    timestamp: new Date().toISOString(),
    action: actionType,
    incidentId: targetIncident.id,
    note: summaryNote,
    previousIncidentsSnapshot: prevSnapshot
  };

  const nextStore = {
    ...currentStore,
    incidents: updatedIncidents,
    revisions: [newRevision, ...(currentStore.revisions || [])].slice(0, 40)
  };

  const result = await persistWikiStore(nextStore, summaryNote);
  return {
    ...result,
    savedIncident: targetIncident
  };
}

export async function confirmIncidentAnonymously(currentStore, incidentId) {
  const prevSnapshot = JSON.parse(JSON.stringify(currentStore.incidents));
  let targetNumber = 0;

  const updatedIncidents = currentStore.incidents.map((inc) => {
    if (inc.id !== incidentId) return inc;
    targetNumber = inc.number;
    return {
      ...inc,
      confirmations: (inc.confirmations || 1) + 1,
      updatedAt: new Date().toISOString()
    };
  });

  const revNumber = (currentStore.revisions?.length || 0) + 1;
  const note = `Confirmación vecinal anónima sumada al incidente #${targetNumber}`;

  const nextStore = {
    ...currentStore,
    incidents: updatedIncidents,
    revisions: [
      {
        revId: `rev-${String(revNumber).padStart(3, '0')}`,
        timestamp: new Date().toISOString(),
        action: 'CONFIRM',
        incidentId,
        note,
        previousIncidentsSnapshot: prevSnapshot
      },
      ...(currentStore.revisions || [])
    ].slice(0, 40)
  };

  return persistWikiStore(nextStore, note);
}

export async function revertWikiRevision(currentStore, revId) {
  const targetRev = (currentStore.revisions || []).find((r) => r.revId === revId);
  if (!targetRev || !Array.isArray(targetRev.previousIncidentsSnapshot)) {
    throw new Error('Esta revisión inicial no tiene un estado previo al cual revertir.');
  }

  const revNumber = (currentStore.revisions?.length || 0) + 1;
  const note = `Reversión Wiki ejecutada: se deshizo ${revId}`;

  const nextStore = {
    ...currentStore,
    incidents: JSON.parse(JSON.stringify(targetRev.previousIncidentsSnapshot)),
    revisions: [
      {
        revId: `rev-${String(revNumber).padStart(3, '0')}`,
        timestamp: new Date().toISOString(),
        action: 'REVERT',
        incidentId: targetRev.incidentId,
        note,
        previousIncidentsSnapshot: JSON.parse(JSON.stringify(currentStore.incidents))
      },
      ...(currentStore.revisions || [])
    ].slice(0, 40)
  };

  return persistWikiStore(nextStore, note);
}

export async function resetToRepositorySeed() {
  localStorage.removeItem(STORAGE_KEY);
  const res = await fetch(`./data/incidents.json?t=${Date.now()}`, { cache: 'no-store' });
  const seed = await res.json();
  return normalizeStore(seed);
}
