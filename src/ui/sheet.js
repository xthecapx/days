import { $, setHidden, escapeHtml, toIsoDate, downloadJson } from '../core/dom.js';
import { CATEGORIES, IMPACT_TYPES, SEVERITY_NAMES } from '../core/config.js';
import { pixelToGps } from '../map/gpsGrid.js';
import { calculateDaysSince, isTranquilityIncident } from '../map/heatmapEngine.js';
import { selectIncidents, selectRevisions } from '../state/selectors.js';

const TITLES = {
  settings: '⚙️ Mapa y datos',
  report: null // se calcula según edición / creación
};

/**
 * Hoja inferior única. Cada panel (incidentes, historial, ajustes, reporte)
 * es una función que pinta su contenido; la hoja solo decide cuál mostrar.
 */
export function mountSheet({ store, actions, incidents }) {
  const panes = {
    incidents: $('paneIncidents'),
    history: $('paneHistory'),
    settings: $('paneSettings'),
    report: $('paneReport')
  };

  $('btnCloseSheet').addEventListener('click', () => actions.closeSheet());
  $('sheetBackdrop').addEventListener('click', () => actions.closeSheet());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') actions.closeSheet();
  });

  mountIncidentList();
  mountHistory();
  mountSettings();
  mountReportForm();

  // ----- Visibilidad ------------------------------------------------------------
  store.subscribe((s) => [s.ui.sheet, s.draft?.editingId, s.draft?.number], ([sheet]) => {
    const open = Boolean(sheet);
    setHidden($('sheet'), !open);
    setHidden($('sheetBackdrop'), !open);
    $('sheet').classList.toggle('sheet-tall', sheet === 'report');
    for (const [name, el] of Object.entries(panes)) setHidden(el, name !== sheet);

    renderTabs(sheet);
    const draft = store.get().draft;
    $('sheetTitle').textContent =
      sheet === 'report'
        ? draft?.editingId ? `✏️ Editar incidente #${draft.number}` : '➕ Reportar evento anónimo'
        : TITLES[sheet] || '';
  });

  function renderTabs(sheet) {
    const tabs = $('sheetTabs');
    if (sheet !== 'incidents' && sheet !== 'history') {
      tabs.innerHTML = '';
      return;
    }
    const state = store.get();
    tabs.innerHTML = `
      <button class="tab ${sheet === 'incidents' ? 'active' : ''}" data-tab="incidents" type="button">📋 Incidentes (${selectIncidents(state).length})</button>
      <button class="tab ${sheet === 'history' ? 'active' : ''}" data-tab="history" type="button">🕓 Historial (${selectRevisions(state).length})</button>`;
    tabs.querySelectorAll('.tab').forEach((btn) =>
      btn.addEventListener('click', () => actions.openSheet(btn.dataset.tab))
    );
  }

  // ----- Lista de incidentes ---------------------------------------------------------
  function mountIncidentList() {
    const list = $('incidentList');
    store.subscribe(
      (s) => [s.data.incidents, s.selection.incidentId, s.settings.referenceDate, s.ui.sheet === 'incidents'],
      ([, , , visible]) => {
        if (!visible) return;
        renderTabs('incidents');
        const state = store.get();
        const rows = [...selectIncidents(state)].sort((a, b) => (b.number || 0) - (a.number || 0));
        list.innerHTML = '';
        for (const inc of rows) list.appendChild(incidentCard(inc, state));
      }
    );
  }

  function incidentCard(inc, state) {
    const calm = isTranquilityIncident(inc);
    const ago = calculateDaysSince(inc.date, state.settings.referenceDate);
    const pending = !inc.dateConfirmed || !inc.timeConfirmed;
    const card = document.createElement('article');
    card.className = `incident-card ${inc.id === state.selection.incidentId ? 'active' : ''} ${calm ? 'calm' : ''}`;
    card.innerHTML = `
      <div class="ic-head">
        <div><span class="badge ${calm ? 'calm' : ''}">#${inc.number}</span><span class="ic-date">${escapeHtml(inc.dateLabel || inc.date)}</span></div>
        ${pending ? '<span class="tag-warn">⚠️ Por confirmar</span>' : ''}
      </div>
      <div class="ic-cat">
        <span>${escapeHtml(inc.category)}</span>
        <span class="sev ${calm ? 'sev-calm' : `sev-${inc.severity}`}">${calm ? '🟡 Tranquilidad' : `🔴 ${inc.severity}/5`} · ${ago}d</span>
      </div>
      <p class="ic-desc">${escapeHtml(inc.description)}</p>
      <div class="ic-foot"><span>📍 ${escapeHtml(inc.sector)}</span><span>(${inc.pixelX}, ${inc.pixelY})</span></div>
      <div class="ic-actions">
        <button class="btn btn-sm" data-act="focus" type="button">🎯 Ver</button>
        <button class="btn btn-sm" data-act="edit" type="button">✏️ Editar</button>
        <button class="btn btn-sm" data-act="confirm" type="button">👍 ${inc.confirmations || 1}</button>
      </div>`;
    card.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'edit') actions.openReport({ incident: inc });
      else if (act === 'confirm') actions.confirmIncident(inc.id);
      else actions.focusIncident(inc);
    });
    return card;
  }

  // ----- Historial -------------------------------------------------------------------
  function mountHistory() {
    const list = $('revisionList');
    store.subscribe(
      (s) => [s.data.revisions, s.ui.sheet === 'history'],
      ([revisions, visible]) => {
        if (!visible) return;
        renderTabs('history');
        list.innerHTML = '';
        for (const rev of revisions || []) {
          const date = new Date(rev.timestamp);
          const when = Number.isNaN(date.getTime())
            ? rev.timestamp
            : date.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
          const canRevert = Array.isArray(rev.previousIncidentsSnapshot);
          const el = document.createElement('div');
          el.className = 'revision-card';
          el.innerHTML = `
            <div class="rev-top"><span>[${escapeHtml(rev.revId)}] ${escapeHtml(rev.action)}</span><span>${escapeHtml(when)}</span></div>
            <div>${escapeHtml(rev.note || '')}</div>
            <div class="rev-foot"><span>🕵️ Vecino anónimo</span>${canRevert ? '<button type="button" class="btn btn-sm">↩️ Revertir</button>' : ''}</div>`;
          el.querySelector('button')?.addEventListener('click', () => incidents.revert(rev.revId));
          list.appendChild(el);
        }
      }
    );
    store.subscribe((s) => [s.sync.message], ([msg]) => {
      $('syncBadge').textContent = msg ? `• ${msg}` : '';
    });
  }

  // ----- Ajustes ---------------------------------------------------------------------
  function mountSettings() {
    $('chkGrid').addEventListener('change', (e) => store.patch('settings', { showGrid: e.target.checked }));
    $('selDecay').addEventListener('change', (e) => store.patch('settings', { decayMode: e.target.value }));
    $('inpToday').addEventListener('change', (e) => {
      const [y, m, d] = e.target.value.split('-').map(Number);
      if (y && m && d) store.patch('settings', { referenceDate: new Date(y, m - 1, d, 12) });
    });
    store.subscribe((s) => [s.settings], ([st]) => {
      $('chkGrid').checked = st.showGrid;
      $('selDecay').value = st.decayMode;
      $('inpToday').value = toIsoDate(st.referenceDate);
    });

    $('btnHistory').addEventListener('click', () => actions.openSheet('history'));
    $('btnDownload').addEventListener('click', () => downloadJson(store.get().data, 'incidents.json'));
    $('btnResetSeed').addEventListener('click', () => incidents.resetToSeed());
    $('inpImport').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await incidents.importJson(await file.text());
      } catch {
        alert('El archivo seleccionado no es un incidents.json válido.');
      }
      e.target.value = '';
    });
  }

  // ----- Formulario de reporte ------------------------------------------------------
  function mountReportForm() {
    const form = $('paneReport');
    $('repCategory').innerHTML = CATEGORIES.map(
      (c) => `<option value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</option>`
    ).join('');
    $('repImpact').innerHTML = IMPACT_TYPES.map(
      (t) => `<button type="button" data-impact="${t.value}">${t.label}</button>`
    ).join('');

    // Entrada → borrador (el mapa dibuja el borrador como vista previa en vivo).
    $('repDescription').addEventListener('input', (e) => actions.patchDraft({ description: e.target.value }));
    $('repCategory').addEventListener('change', (e) => actions.patchDraft({ category: e.target.value }));
    $('repSeverity').addEventListener('input', (e) => actions.patchDraft({ severity: Number(e.target.value) }));
    $('repDate').addEventListener('change', (e) => actions.patchDraft({ date: e.target.value }));
    $('repTime').addEventListener('change', (e) => actions.patchDraft({ time: e.target.value }));
    $('repDateOk').addEventListener('change', (e) => actions.patchDraft({ dateConfirmed: e.target.checked }));
    $('repTimeOk').addEventListener('change', (e) => actions.patchDraft({ timeConfirmed: e.target.checked }));
    $('repSector').addEventListener('input', (e) => actions.patchDraft({ sector: e.target.value, sectorTouched: true }));
    $('repImpact').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-impact]');
      if (btn) actions.patchDraft({ impactType: btn.dataset.impact });
    });

    $('btnPickOnMap').addEventListener('click', () => actions.startPickForReport());
    $('btnCancelReport').addEventListener('click', () => actions.closeSheet());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = store.get().draft;
      if (!d) return;
      const missing = !d.description.trim() ? $('repDescription') : !d.date ? $('repDate') : null;
      if (missing) {
        missing.closest('.field').classList.add('field-error');
        missing.focus();
        return;
      }
      await actions.submitDraft();
    });
    form.addEventListener('input', (e) => e.target.closest('.field')?.classList.remove('field-error'));

    // Borrador → controles. Se rellena completo al abrir y se actualiza lo que cambia
    // por fuera del teclado (ubicación, impacto) sin pisar lo que la persona escribe.
    let lastSession = null;
    store.subscribe((s) => [s.draft], ([d]) => {
      if (!d) {
        lastSession = null;
        return;
      }
      const gps = pixelToGps(d.pixelX, d.pixelY);
      $('repPixel').textContent = `Píxel (${d.pixelX}, ${d.pixelY})`;
      $('repGps').textContent = `GPS ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`;
      $('repSeverityLabel').textContent = SEVERITY_NAMES[d.severity] || `${d.severity} / 5`;
      for (const b of $('repImpact').children) b.classList.toggle('active', b.dataset.impact === d.impactType);

      if (lastSession !== d.session) {
        lastSession = d.session;
        $('repDescription').value = d.description;
        $('repCategory').value = d.category;
        $('repSeverity').value = String(d.severity);
        $('repDate').value = d.date;
        $('repTime').value = d.time;
        $('repDateOk').checked = d.dateConfirmed;
        $('repTimeOk').checked = d.timeConfirmed;
        form.querySelectorAll('.field-error').forEach((el) => el.classList.remove('field-error'));
      }
      if (document.activeElement !== $('repSector')) $('repSector').value = d.sector;
    });
  }
}
