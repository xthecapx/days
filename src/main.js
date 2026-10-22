import {
  GRID_WIDTH,
  GRID_HEIGHT,
  USER_REFERENCE_PIXEL,
  pixelToGps,
  gpsToPixel,
  detectSectorName
} from './map/gpsGrid.js';
import {
  calculateDaysSince,
  computePixelHeatmap,
  isTranquilityIncident
} from './map/heatmapEngine.js';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  createBasePixelArtMap,
  renderPixelMapFrame
} from './map/pixelArtMapRenderer.js';
import {
  loadWikiStore,
  saveIncidentWikiRevision,
  confirmIncidentAnonymously,
  revertWikiRevision,
  resetToRepositorySeed,
  persistWikiStore,
  getBridgeConfig,
  saveBridgeConfig
} from './storage/wikiJsonStore.js';

const SEVERITY_NAMES = {
  1: '1 / 5 (Baja)',
  2: '2 / 5 (Moderada)',
  3: '3 / 5 (Media-Alta)',
  4: '4 / 5 (Alta)',
  5: '5 / 5 (Crítica)'
};

const appState = {
  store: { incidents: [], revisions: [] },
  referenceDate: new Date(2026, 9, 22, 12, 0, 0), // 22 de octubre de 2026
  decayMode: 'actual',
  selectedPixel: { x: 65, y: 43 },
  hoveredPixel: null,
  selectedIncidentId: 'inc-006',
  movingIncidentId: null,
  pickingPixelForModal: false,
  showGrid: true,
  showReferenceOverlay: false,
  alertDetailsExpanded: true,
  zoom: 1.5,
  panX: 0,
  panY: 0,
  pulsePhase: 0,
  heatmap: null
};

const mapAssets = {
  baseMapCanvas: null,
  referenceImage: null
};

const canvas = document.getElementById('pixelMapCanvas');
const ctx = canvas.getContext('2d');
const mapViewport = document.getElementById('mapViewport');
const mapTransformLayer = document.getElementById('mapTransformLayer');
const mapHoverTooltip = document.getElementById('mapHoverTooltip');

async function initApp() {
  mapAssets.baseMapCanvas = createBasePixelArtMap();
  const refImg = new Image();
  refImg.src = './assets/google-maps-reference.png';
  mapAssets.referenceImage = refImg;

  appState.store = await loadWikiStore();

  bindFloatingControlsEvents();
  bindFullScreenMapInteraction();
  bindModalEvents();

  recomputeAndRenderUI();
  updateInspectorBar(appState.selectedPixel.x, appState.selectedPixel.y);

  // Centrar inicialmente en la zona de los 6 incidentes (alrededor de 68, 49) adaptado a teléfono o PC
  focusSectorCluster();
  window.addEventListener('resize', () => {
    applyTransform(appState.zoom, appState.panX, appState.panY);
  });

  function animate(ts) {
    appState.pulsePhase = ts / 1000;
    renderPixelMapFrame(ctx, appState, mapAssets);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

/**
 * Centra la cámara en Hogar (68, 49) y el grupo de incidentes cercanos
 */
function focusSectorCluster() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const coverZoom = Math.max(vw / CANVAS_WIDTH, vh / CANVAS_HEIGHT);
  const idealZoom = Math.max(coverZoom * 1.35, 1.85);
  centerMapOnPixel(USER_REFERENCE_PIXEL.x, USER_REFERENCE_PIXEL.y, idealZoom);
}

function recomputeAndRenderUI() {
  const incidents = appState.store.incidents || [];

  let previewIncident = null;
  const modalOverlay = document.getElementById('incidentModalOverlay');
  if (!modalOverlay.classList.contains('hidden') || appState.pickingPixelForModal) {
    const px = Number(document.getElementById('formPixelX').value);
    const py = Number(document.getElementById('formPixelY').value);
    const sev = Number(document.getElementById('formSeverity').value) || 4;
    const dateVal = document.getElementById('formDate').value || '2026-10-22';
    const impactType = document.getElementById('formImpactType').value || 'seguridad';
    if (!Number.isNaN(px) && !Number.isNaN(py)) {
      previewIncident = {
        id: 'preview-inc',
        pixelX: px,
        pixelY: py,
        severity: sev,
        date: dateVal,
        impactType
      };
    }
  }

  appState.heatmap = computePixelHeatmap(incidents, {
    now: appState.referenceDate,
    decayMode: appState.decayMode,
    previewIncident
  });

  renderFloatingAlertCard(incidents);
  renderIncidentsDrawer(incidents);
  renderWikiRevisionsDrawer(appState.store.revisions || []);
}

/**
 * Renderiza el elemento flotante superior: "DÍAS DESDE EL ÚLTIMO INCIDENTE"
 */
function renderFloatingAlertCard(incidents) {
  const daysValueEl = document.getElementById('daysCounterValue');
  const daysLabelEl = document.getElementById('daysCounterLabel');
  const latestDateEl = document.getElementById('latestIncidentDate');
  const latestDescEl = document.getElementById('latestIncidentDesc');
  const latestLocEl = document.getElementById('latestIncidentLocation');
  const redBadgeEl = document.getElementById('statRedPixelsBadge');
  const dockCountEl = document.getElementById('dockIncidentsCount');

  dockCountEl.textContent = String(incidents.length);
  redBadgeEl.textContent = `🔴 ${appState.heatmap?.affectedPixelsCount || 0} px en alerta`;

  if (!incidents.length) {
    daysValueEl.textContent = '--';
    daysLabelEl.textContent = 'DÍAS DESDE EL ÚLTIMO INCIDENTE';
    latestDescEl.textContent = 'Sin incidentes registrados.';
    return;
  }

  const sortedByDate = [...incidents].sort((a, b) => {
    const cmp = (b.date || '').localeCompare(a.date || '');
    if (cmp !== 0) return cmp;
    return (b.number || 0) - (a.number || 0);
  });

  const latest = sortedByDate[0];
  const minDays = calculateDaysSince(latest.date, appState.referenceDate);

  daysValueEl.textContent = String(minDays).padStart(2, '0');
  daysLabelEl.textContent = minDays === 1
    ? 'DÍA DESDE EL ÚLTIMO INCIDENTE'
    : 'DÍAS DESDE EL ÚLTIMO INCIDENTE';

  latestDateEl.textContent = latest.dateLabel || latest.date;
  latestDescEl.textContent = `#${latest.number}: ${latest.description}`;
  latestLocEl.textContent = `📍 ${latest.sector} • Píxel (${latest.pixelX}, ${latest.pixelY})`;

  document.getElementById('btnFocusLatest').onclick = () => {
    focusOnIncident(latest);
  };
}

/**
 * Renderiza la lista de incidentes dentro del Drawer Flotante
 */
function renderIncidentsDrawer(incidents) {
  const container = document.getElementById('incidentsContainer');
  document.getElementById('tabCountIncidents').textContent = String(incidents.length);
  container.innerHTML = '';

  const sorted = [...incidents].sort((a, b) => (a.number || 0) - (b.number || 0));

  for (const inc of sorted) {
    const daysAgo = calculateDaysSince(inc.date, appState.referenceDate);
    const isSelected = inc.id === appState.selectedIncidentId;
    const needsConfirmation = !inc.dateConfirmed || !inc.timeConfirmed;
    const isTranquility = isTranquilityIncident(inc);

    const card = document.createElement('article');
    card.className = `incident-card ${isSelected ? 'active' : ''} ${isTranquility ? 'tranquility-card' : ''}`;
    card.innerHTML = `
      <div class="incident-card-header">
        <div>
          <span class="incident-num-badge ${isTranquility ? 'badge-tranquility' : ''}">#${inc.number}</span>
          <span class="incident-date-text">${escapeHtml(inc.dateLabel || inc.date)}</span>
        </div>
        ${needsConfirmation ? '<span class="wiki-unconfirmed-tag">⚠️ Por confirmar</span>' : ''}
      </div>

      <div class="incident-category-row">
        <span class="incident-category">${escapeHtml(inc.category)}</span>
        <span class="severity-pill ${isTranquility ? 'sev-tranquility' : `sev-${inc.severity}`}">
          ${isTranquility ? '🟡 Tranquilidad / Ruido' : `🔴 Gravedad ${inc.severity}/5`} • Hace ${daysAgo}d
        </span>
      </div>

      <p class="incident-desc">${escapeHtml(inc.description)}</p>

      <div class="incident-meta-footer">
        <span>📍 ${escapeHtml(inc.sector)}</span>
        <span>Píxel <strong>(${inc.pixelX}, ${inc.pixelY})</strong></span>
      </div>

      <div class="incident-actions">
        <button class="btn-pixel btn-xs btn-focus-inc" type="button">
          🎯 Ver en Mapa
        </button>
        <button class="btn-pixel btn-xs btn-move-inc" type="button">
          📍 Mover Píxel
        </button>
        <button class="btn-pixel btn-xs btn-edit-inc" type="button">
          ✏️ Editar
        </button>
        <button class="btn-pixel btn-xs btn-confirm-inc" type="button">
          👍 Confirmar (${inc.confirmations || 1})
        </button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      closeDrawer();
      focusOnIncident(inc);
    });

    card.querySelector('.btn-focus-inc').addEventListener('click', () => {
      closeDrawer();
      focusOnIncident(inc);
    });

    card.querySelector('.btn-move-inc').addEventListener('click', () => {
      closeDrawer();
      startMovingIncidentPixel(inc);
    });

    card.querySelector('.btn-edit-inc').addEventListener('click', () => {
      closeDrawer();
      openIncidentModal(inc);
    });

    card.querySelector('.btn-confirm-inc').addEventListener('click', async () => {
      const { store, syncStatus } = await confirmIncidentAnonymously(appState.store, inc.id);
      appState.store = store;
      updateSyncBadge(syncStatus);
      recomputeAndRenderUI();
    });

    container.appendChild(card);
  }
}

/**
 * Renderiza el historial de revisiones de incidents.json (Estilo Wikipedia)
 */
function renderWikiRevisionsDrawer(revisions) {
  const container = document.getElementById('revisionsContainer');
  document.getElementById('tabCountRevisions').textContent = String(revisions.length);
  container.innerHTML = '';

  for (const rev of revisions) {
    const dateObj = new Date(rev.timestamp);
    const formattedTime = Number.isNaN(dateObj.getTime())
      ? rev.timestamp
      : dateObj.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

    const canRevert = Array.isArray(rev.previousIncidentsSnapshot);

    const item = document.createElement('div');
    item.className = 'revision-card';
    item.innerHTML = `
      <div class="revision-top">
        <span>[${escapeHtml(rev.revId)}] • ${escapeHtml(rev.action)}</span>
        <span>${escapeHtml(formattedTime)}</span>
      </div>
      <div>${escapeHtml(rev.note || '')}</div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
        <span style="color:#6ee7b7; font-size:0.68rem;">🕵️ Vecino Anónimo (Sin IP)</span>
        ${canRevert ? '<button type="button" class="btn-pixel btn-xs btn-revert-rev">↩️ Revertir</button>' : ''}
      </div>
    `;

    if (canRevert) {
      item.querySelector('.btn-revert-rev').addEventListener('click', async () => {
        const { store, syncStatus } = await revertWikiRevision(appState.store, rev.revId);
        appState.store = store;
        updateSyncBadge(syncStatus);
        recomputeAndRenderUI();
      });
    }

    container.appendChild(item);
  }
}

function updateInspectorBar(px, py) {
  const gps = pixelToGps(px, py);
  const sector = detectSectorName(gps.pixelX, gps.pixelY);
  document.getElementById('inspectorPixelCoord').textContent = `Píxel (${gps.pixelX}, ${gps.pixelY})`;
  document.getElementById('inspectorGpsCoord').textContent = `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`;
  document.getElementById('inspectorSectorName').textContent = sector;
}

function focusOnIncident(inc) {
  appState.selectedIncidentId = inc.id;
  appState.selectedPixel = { x: inc.pixelX, y: inc.pixelY };
  updateInspectorBar(inc.pixelX, inc.pixelY);
  centerMapOnPixel(inc.pixelX, inc.pixelY, Math.max(appState.zoom, 2.1));
  recomputeAndRenderUI();
}

function centerMapOnPixel(px, py, targetZoom = 1.8) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const z = Math.max(0.6, Math.min(5.5, targetZoom));

  const worldX = ((px + 0.5) / GRID_WIDTH) * CANVAS_WIDTH;
  const worldY = ((py + 0.5) / GRID_HEIGHT) * CANVAS_HEIGHT;

  const targetPanX = vw / 2 - worldX * z;
  const targetPanY = vh * 0.54 - worldY * z; // Ligeramente debajo del centro para compensar la tarjeta superior

  applyTransform(z, targetPanX, targetPanY);
}

function applyTransform(zoom, panX, panY) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const minZoom = Math.max(vw / CANVAS_WIDTH, vh / CANVAS_HEIGHT, 0.8);
  const z = Math.max(minZoom, Math.min(6, zoom));

  const scaledW = CANVAS_WIDTH * z;
  const scaledH = CANVAS_HEIGHT * z;

  const minPanX = Math.min(0, vw - scaledW);
  const maxPanX = 0;
  const minPanY = Math.min(0, vh - scaledH);
  const maxPanY = 0;

  appState.zoom = z;
  appState.panX = Math.min(maxPanX, Math.max(minPanX, panX));
  appState.panY = Math.min(maxPanY, Math.max(minPanY, panY));

  mapTransformLayer.style.transform = `translate3d(${appState.panX}px, ${appState.panY}px, 0) scale(${appState.zoom})`;
}

/**
 * Interacción Táctil (Móvil Pinch-to-Zoom + Pan) y Ratón sobre el Mapa Full-Screen
 */
function bindFullScreenMapInteraction() {
  const activePointers = new Map();
  let initialPanX = 0;
  let initialPanY = 0;
  let dragStartX = 0;
  let dragStartY = 0;
  let movedDistance = 0;
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let pinchCenterWorldX = 0;
  let pinchCenterWorldY = 0;

  function clientEventToPixel(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;
    const px = Math.floor(relX * GRID_WIDTH);
    const py = Math.floor(relY * GRID_HEIGHT);
    if (px < 0 || px >= GRID_WIDTH || py < 0 || py >= GRID_HEIGHT) return null;
    return { x: px, y: py };
  }

  mapViewport.addEventListener('pointerdown', (e) => {
    document.getElementById('layersPopover').classList.add('hidden');
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    mapViewport.setPointerCapture(e.pointerId);

    if (activePointers.size === 1) {
      movedDistance = 0;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      initialPanX = appState.panX;
      initialPanY = appState.panY;
    } else if (activePointers.size === 2) {
      const pts = Array.from(activePointers.values());
      pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartZoom = appState.zoom;
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      pinchCenterWorldX = (midX - appState.panX) / appState.zoom;
      pinchCenterWorldY = (midY - appState.panY) / appState.zoom;
    }
  });

  mapViewport.addEventListener('pointermove', (e) => {
    if (activePointers.has(e.pointerId)) {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (activePointers.size === 2) {
      const pts = Array.from(activePointers.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (pinchStartDist > 10) {
        const scale = dist / pinchStartDist;
        const nextZoom = Math.max(0.6, Math.min(6, pinchStartZoom * scale));
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const nextPanX = midX - pinchCenterWorldX * nextZoom;
        const nextPanY = midY - pinchCenterWorldY * nextZoom;
        applyTransform(nextZoom, nextPanX, nextPanY);
        movedDistance = 99;
      }
      return;
    }

    const hovered = clientEventToPixel(e.clientX, e.clientY);
    appState.hoveredPixel = hovered;

    if (hovered && e.pointerType === 'mouse' && activePointers.size === 0) {
      updateHoverTooltip(e.clientX, e.clientY, hovered.x, hovered.y);
    } else if (activePointers.size > 0) {
      mapHoverTooltip.classList.add('hidden');
    }

    if (activePointers.size === 1) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      movedDistance = Math.hypot(dx, dy);
      if (movedDistance > 4) {
        applyTransform(appState.zoom, initialPanX + dx, initialPanY + dy);
      }
    }
  });

  mapViewport.addEventListener('pointerup', async (e) => {
    activePointers.delete(e.pointerId);
    try {
      mapViewport.releasePointerCapture(e.pointerId);
    } catch (_) {}

    if (activePointers.size === 1) {
      const remaining = Array.from(activePointers.values())[0];
      dragStartX = remaining.x;
      dragStartY = remaining.y;
      initialPanX = appState.panX;
      initialPanY = appState.panY;
      return;
    }

    if (activePointers.size === 0 && movedDistance < 7) {
      const clicked = clientEventToPixel(e.clientX, e.clientY);
      if (clicked) {
        await handlePixelClick(clicked.x, clicked.y, e.clientX, e.clientY);
      }
    }
  });

  mapViewport.addEventListener('pointercancel', (e) => {
    activePointers.delete(e.pointerId);
  });

  mapViewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    const zoomFactor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const nextZoom = Math.max(0.6, Math.min(6, appState.zoom * zoomFactor));

    const worldX = (mouseX - appState.panX) / appState.zoom;
    const worldY = (mouseY - appState.panY) / appState.zoom;

    const nextPanX = mouseX - worldX * nextZoom;
    const nextPanY = mouseY - worldY * nextZoom;

    applyTransform(nextZoom, nextPanX, nextPanY);
  }, { passive: false });
}

async function handlePixelClick(px, py, clientX, clientY) {
  appState.selectedPixel = { x: px, y: py };
  updateInspectorBar(px, py);

  // 1. ¿Estamos moviendo el píxel de un incidente existente?
  if (appState.movingIncidentId) {
    const targetInc = appState.store.incidents.find((i) => i.id === appState.movingIncidentId);
    appState.movingIncidentId = null;
    document.getElementById('mapSelectionBanner').classList.add('hidden');

    if (targetInc) {
      const newSector = detectSectorName(px, py);
      const { store, syncStatus } = await saveIncidentWikiRevision(
        appState.store,
        {
          ...targetInc,
          pixelX: px,
          pixelY: py,
          sector: newSector
        },
        targetInc.id
      );
      appState.store = store;
      updateSyncBadge(syncStatus);
      recomputeAndRenderUI();
    }
    return;
  }

  // 2. ¿Estamos eligiendo un píxel desde el modal?
  if (appState.pickingPixelForModal) {
    appState.pickingPixelForModal = false;
    document.getElementById('mapSelectionBanner').classList.add('hidden');
    setModalPixelCoordinates(px, py);
    document.getElementById('incidentModalOverlay').classList.remove('hidden');
    recomputeAndRenderUI();
    return;
  }

  // 3. Si toca cerca de un incidente existente, seleccionarlo y mostrar información
  const clickedIncident = appState.store.incidents.find(
    (inc) => Math.hypot(inc.pixelX - px, inc.pixelY - py) <= 1.2
  );
  if (clickedIncident) {
    appState.selectedIncidentId = clickedIncident.id;
    recomputeAndRenderUI();
    updateHoverTooltip(clientX, clientY, px, py);
  } else {
    updateHoverTooltip(clientX, clientY, px, py);
  }
}

function updateHoverTooltip(clientX, clientY, px, py) {
  const cell = appState.heatmap?.grid?.[py * GRID_WIDTH + px];
  const gps = pixelToGps(px, py);
  const sector = detectSectorName(px, py);

  let html = `<div><strong>Píxel (${px}, ${py})</strong> • <span style="color:#94a3b8">${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}</span></div>`;
  html += `<div style="color:#fcd34d; margin-bottom:4px;">${escapeHtml(sector)}</div>`;

  if (cell && cell.incidents && cell.incidents.length > 0) {
    for (const item of cell.incidents) {
      const isTrq = item.impactType === 'tranquilidad';
      const colorTag = isTrq ? '#fef08a' : '#ff5252';
      const distLabel = item.distance === 0 ? 'Epicentro en este píxel' : `A ${item.distance} px del punto`;
      html += `
        <div style="border-top:1px solid #334155; padding-top:4px; margin-top:4px;">
          <span style="color:${colorTag}; font-weight:700;">#${item.number} (${escapeHtml(item.dateLabel)})</span><br/>
          <span>${escapeHtml(item.description)}</span><br/>
          <small style="color:#cbd5e1;">${distLabel}</small>
        </div>
      `;
    }
  } else {
    html += `<div style="color:#94a3b8; font-size:0.66rem;">Toca "📌 Reportar aquí" abajo para asociar un evento a este píxel.</div>`;
  }

  mapHoverTooltip.innerHTML = html;
  mapHoverTooltip.classList.remove('hidden');

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(vw - 270, Math.max(10, clientX + 12));
  const top = Math.min(vh - 160, Math.max(90, clientY - 20));

  mapHoverTooltip.style.left = `${left}px`;
  mapHoverTooltip.style.top = `${top}px`;
}

function startMovingIncidentPixel(inc) {
  appState.movingIncidentId = inc.id;
  appState.selectedIncidentId = inc.id;
  const banner = document.getElementById('mapSelectionBanner');
  document.getElementById('mapSelectionBannerText').textContent =
    `📍 Moviendo Incidente #${inc.number}: Toca el nuevo píxel en el mapa...`;
  banner.classList.remove('hidden');
}

function openDrawer(tab = 'incidents') {
  document.getElementById('drawerBackdrop').classList.remove('hidden');
  document.getElementById('incidentsDrawer').classList.remove('hidden');
  const tabBtnIncidents = document.getElementById('tabBtnIncidents');
  const tabBtnWikiHistory = document.getElementById('tabBtnWikiHistory');
  const panelIncidentsList = document.getElementById('panelIncidentsList');
  const panelWikiHistory = document.getElementById('panelWikiHistory');

  if (tab === 'history') {
    tabBtnWikiHistory.classList.add('active');
    tabBtnIncidents.classList.remove('active');
    panelWikiHistory.classList.remove('hidden');
    panelIncidentsList.classList.add('hidden');
  } else {
    tabBtnIncidents.classList.add('active');
    tabBtnWikiHistory.classList.remove('active');
    panelIncidentsList.classList.remove('hidden');
    panelWikiHistory.classList.add('hidden');
  }
}

function closeDrawer() {
  document.getElementById('drawerBackdrop').classList.add('hidden');
  document.getElementById('incidentsDrawer').classList.add('hidden');
}

function bindFloatingControlsEvents() {
  // Colapsar / expandir detalles de la Alerta Superior
  document.getElementById('btnToggleAlertDetails').addEventListener('click', () => {
    appState.alertDetailsExpanded = !appState.alertDetailsExpanded;
    const detailsEl = document.getElementById('alertExpandedDetails');
    const btnEl = document.getElementById('btnToggleAlertDetails');
    if (appState.alertDetailsExpanded) {
      detailsEl.classList.remove('hidden');
      btnEl.textContent = '▾';
    } else {
      detailsEl.classList.add('hidden');
      btnEl.textContent = '▴';
    }
  });

  // Controles flotantes de Zoom y GPS
  document.getElementById('btnZoomIn').addEventListener('click', () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const nextZoom = Math.min(6, appState.zoom * 1.35);
    applyTransform(
      nextZoom,
      vw / 2 - ((vw / 2 - appState.panX) / appState.zoom) * nextZoom,
      vh / 2 - ((vh / 2 - appState.panY) / appState.zoom) * nextZoom
    );
  });

  document.getElementById('btnZoomOut').addEventListener('click', () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const nextZoom = Math.max(0.6, appState.zoom / 1.35);
    applyTransform(
      nextZoom,
      vw / 2 - ((vw / 2 - appState.panX) / appState.zoom) * nextZoom,
      vh / 2 - ((vh / 2 - appState.panY) / appState.zoom) * nextZoom
    );
  });

  document.getElementById('btnFocusSector').addEventListener('click', () => {
    focusSectorCluster();
  });

  document.getElementById('btnUseMyGps').addEventListener('click', () => {
    if (!navigator.geolocation) {
      selectReferenceUserPixel();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const mapped = gpsToPixel(pos.coords.latitude, pos.coords.longitude);
        if (mapped.insideBounds) {
          appState.selectedPixel = { x: mapped.pixelX, y: mapped.pixelY };
          updateInspectorBar(mapped.pixelX, mapped.pixelY);
          centerMapOnPixel(mapped.pixelX, mapped.pixelY, 2.3);
        } else {
          selectReferenceUserPixel();
        }
      },
      () => selectReferenceUserPixel(),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  });

  // Popover de Capas
  document.getElementById('btnToggleLayersPopover').addEventListener('click', () => {
    document.getElementById('layersPopover').classList.toggle('hidden');
  });

  document.getElementById('chkShowGrid').addEventListener('change', (e) => {
    appState.showGrid = e.target.checked;
  });

  document.getElementById('chkCompareGoogleMap').addEventListener('change', (e) => {
    appState.showReferenceOverlay = e.target.checked;
  });

  document.getElementById('selectDecayMode').addEventListener('change', (e) => {
    appState.decayMode = e.target.value;
    recomputeAndRenderUI();
  });

  document.getElementById('referenceDateInput').addEventListener('change', (e) => {
    if (!e.target.value) return;
    const [y, m, d] = e.target.value.split('-').map(Number);
    if (y && m && d) {
      appState.referenceDate = new Date(y, m - 1, d, 12, 0, 0);
      recomputeAndRenderUI();
    }
  });

  // Botones flotantes inferiores (Drawer de Incidentes)
  document.getElementById('btnOpenIncidentsDrawer').addEventListener('click', () => {
    openDrawer('incidents');
  });

  document.getElementById('btnCloseDrawer').addEventListener('click', closeDrawer);
  document.getElementById('drawerBackdrop').addEventListener('click', closeDrawer);

  document.getElementById('tabBtnIncidents').addEventListener('click', () => openDrawer('incidents'));
  document.getElementById('tabBtnWikiHistory').addEventListener('click', () => openDrawer('history'));

  document.getElementById('btnCancelMovePixel').addEventListener('click', () => {
    appState.movingIncidentId = null;
    appState.pickingPixelForModal = false;
    document.getElementById('mapSelectionBanner').classList.add('hidden');
    recomputeAndRenderUI();
  });

  // Descargar / Importar / Restaurar incidents.json
  const triggerDownloadJson = () => {
    const jsonString = JSON.stringify(appState.store, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'incidents.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  document.getElementById('btnDownloadJson').addEventListener('click', triggerDownloadJson);
  document.getElementById('btnDownloadJsonModal').addEventListener('click', triggerDownloadJson);

  document.getElementById('inputImportJson').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.incidents)) {
        const { store, syncStatus } = await persistWikiStore(parsed, 'Importación manual de incidents.json');
        appState.store = store;
        updateSyncBadge(syncStatus);
        recomputeAndRenderUI();
      }
    } catch (_) {
      alert('El archivo seleccionado no es un incidents.json válido.');
    }
  });

  document.getElementById('btnResetSeed').addEventListener('click', async () => {
    appState.store = await resetToRepositorySeed();
    updateSyncBadge({ ok: true, message: 'Restaurados los 6 incidentes iniciales' });
    recomputeAndRenderUI();
  });
}

function selectReferenceUserPixel() {
  appState.selectedPixel = { x: USER_REFERENCE_PIXEL.x, y: USER_REFERENCE_PIXEL.y };
  updateInspectorBar(USER_REFERENCE_PIXEL.x, USER_REFERENCE_PIXEL.y);
  centerMapOnPixel(USER_REFERENCE_PIXEL.x, USER_REFERENCE_PIXEL.y, 2.2);
}

function bindModalEvents() {
  const modalOverlay = document.getElementById('incidentModalOverlay');
  const form = document.getElementById('incidentForm');
  const severityInput = document.getElementById('formSeverity');
  const severityLabel = document.getElementById('formSeverityLabel');
  const categorySelect = document.getElementById('formCategory');
  const impactSelect = document.getElementById('formImpactType');

  document.getElementById('btnOpenNewReport').addEventListener('click', () => {
    openIncidentModal(null);
  });

  document.getElementById('btnReportAtSelectedPixel').addEventListener('click', () => {
    openIncidentModal(null, appState.selectedPixel);
  });

  document.getElementById('btnCloseModal').addEventListener('click', closeIncidentModal);
  document.getElementById('btnCancelModal').addEventListener('click', closeIncidentModal);

  // Cambiar automáticamente a Amarillo Claro si elige Ruido Excesivo / Convivencia
  categorySelect.addEventListener('change', () => {
    if (categorySelect.value.toLowerCase().includes('ruido')) {
      impactSelect.value = 'tranquilidad';
    }
    recomputeAndRenderUI();
  });

  impactSelect.addEventListener('change', () => {
    recomputeAndRenderUI();
  });

  severityInput.addEventListener('input', () => {
    const val = Number(severityInput.value) || 4;
    severityLabel.textContent = SEVERITY_NAMES[val] || `${val} / 5`;
    recomputeAndRenderUI();
  });

  document.getElementById('formPixelX').addEventListener('input', () => {
    const px = Number(document.getElementById('formPixelX').value) || 0;
    const py = Number(document.getElementById('formPixelY').value) || 0;
    setModalPixelCoordinates(px, py);
    recomputeAndRenderUI();
  });

  document.getElementById('formPixelY').addEventListener('input', () => {
    const px = Number(document.getElementById('formPixelX').value) || 0;
    const py = Number(document.getElementById('formPixelY').value) || 0;
    setModalPixelCoordinates(px, py);
    recomputeAndRenderUI();
  });

  document.getElementById('btnPickOnMapFromModal').addEventListener('click', () => {
    modalOverlay.classList.add('hidden');
    appState.pickingPixelForModal = true;
    const banner = document.getElementById('mapSelectionBanner');
    document.getElementById('mapSelectionBannerText').textContent =
      '🎯 Toca cualquier píxel del mapa para asignarlo al incidente...';
    banner.classList.remove('hidden');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editingId = document.getElementById('formEditingId').value || null;
    const payload = {
      pixelX: Number(document.getElementById('formPixelX').value),
      pixelY: Number(document.getElementById('formPixelY').value),
      impactType: document.getElementById('formImpactType').value,
      sector: document.getElementById('formSector').value,
      date: document.getElementById('formDate').value,
      time: document.getElementById('formTime').value,
      dateConfirmed: document.getElementById('formDateConfirmed').checked,
      timeConfirmed: document.getElementById('formTimeConfirmed').checked,
      category: document.getElementById('formCategory').value,
      severity: Number(document.getElementById('formSeverity').value),
      description: document.getElementById('formDescription').value
    };

    const { store, syncStatus, savedIncident } = await saveIncidentWikiRevision(
      appState.store,
      payload,
      editingId
    );
    appState.store = store;
    appState.selectedIncidentId = savedIncident.id;
    appState.selectedPixel = { x: savedIncident.pixelX, y: savedIncident.pixelY };
    updateSyncBadge(syncStatus);
    closeIncidentModal();
    updateInspectorBar(savedIncident.pixelX, savedIncident.pixelY);
    recomputeAndRenderUI();
  });

  // Modal de Configuración GitHub Pages / JSON
  const bridgeOverlay = document.getElementById('bridgeModalOverlay');
  document.getElementById('btnOpenWikiTools').addEventListener('click', () => {
    const cfg = getBridgeConfig();
    document.getElementById('inputGithubRepo').value = cfg.githubRepo || '';
    document.getElementById('inputBridgeUrl').value = cfg.bridgeUrl || '';
    bridgeOverlay.classList.remove('hidden');
  });

  document.getElementById('btnOpenHistoryFromBridge').addEventListener('click', () => {
    bridgeOverlay.classList.add('hidden');
    openDrawer('history');
  });

  document.getElementById('btnCloseBridgeModal').addEventListener('click', () => {
    bridgeOverlay.classList.add('hidden');
  });
  document.getElementById('btnCloseBridgeModal2').addEventListener('click', () => {
    bridgeOverlay.classList.add('hidden');
  });

  document.getElementById('bridgeConfigForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveBridgeConfig({
      githubRepo: document.getElementById('inputGithubRepo').value,
      bridgeUrl: document.getElementById('inputBridgeUrl').value
    });
    bridgeOverlay.classList.add('hidden');
  });
}

function openIncidentModal(existingIncident = null, defaultPixel = null) {
  const modalOverlay = document.getElementById('incidentModalOverlay');
  const titleEl = document.getElementById('modalTitle');
  const editingIdEl = document.getElementById('formEditingId');

  if (existingIncident) {
    titleEl.textContent = `✏️ Editar Incidente #${existingIncident.number}`;
    editingIdEl.value = existingIncident.id;
    setModalPixelCoordinates(existingIncident.pixelX, existingIncident.pixelY, existingIncident.sector);
    document.getElementById('formImpactType').value = isTranquilityIncident(existingIncident) ? 'tranquilidad' : 'seguridad';
    document.getElementById('formDate').value = existingIncident.date || '2026-10-21';
    document.getElementById('formTime').value = existingIncident.time || '19:00';
    document.getElementById('formDateConfirmed').checked = Boolean(existingIncident.dateConfirmed);
    document.getElementById('formTimeConfirmed').checked = Boolean(existingIncident.timeConfirmed);
    document.getElementById('formCategory').value = existingIncident.category || 'Otro Incidente en el Sector';
    document.getElementById('formSeverity').value = String(existingIncident.severity || 4);
    document.getElementById('formSeverityLabel').textContent = SEVERITY_NAMES[existingIncident.severity || 4];
    document.getElementById('formDescription').value = existingIncident.description || '';
  } else {
    const px = defaultPixel ? defaultPixel.x : appState.selectedPixel.x;
    const py = defaultPixel ? defaultPixel.y : appState.selectedPixel.y;
    titleEl.textContent = '➕ Reportar Evento Anónimo';
    editingIdEl.value = '';
    setModalPixelCoordinates(px, py);
    document.getElementById('formImpactType').value = 'seguridad';
    const refIso = appState.referenceDate.toISOString().slice(0, 10);
    document.getElementById('formDate').value = refIso;
    document.getElementById('formTime').value = '19:30';
    document.getElementById('formDateConfirmed').checked = true;
    document.getElementById('formTimeConfirmed').checked = true;
    document.getElementById('formCategory').value = 'Violencia / Robo y Lesiones';
    document.getElementById('formSeverity').value = '4';
    document.getElementById('formSeverityLabel').textContent = SEVERITY_NAMES[4];
    document.getElementById('formDescription').value = '';
  }

  modalOverlay.classList.remove('hidden');
  recomputeAndRenderUI();
}

function closeIncidentModal() {
  document.getElementById('incidentModalOverlay').classList.add('hidden');
  appState.pickingPixelForModal = false;
  recomputeAndRenderUI();
}

function setModalPixelCoordinates(px, py, customSector = null) {
  const gps = pixelToGps(px, py);
  document.getElementById('formPixelX').value = String(gps.pixelX);
  document.getElementById('formPixelY').value = String(gps.pixelY);
  document.getElementById('formGpsPreview').textContent = `GPS: ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`;
  document.getElementById('formSector').value = customSector || detectSectorName(gps.pixelX, gps.pixelY);
}

function updateSyncBadge(syncStatus) {
  const badge = document.getElementById('wikiSyncBadge');
  if (!syncStatus || !badge) return;
  badge.textContent = `• ${syncStatus.message}`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

initApp();
