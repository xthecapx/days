import { $, escapeHtml } from '../../core/dom.js';
import { calculateDaysSince, isTranquilityIncident } from '../../domain/incident.js';
import { selectIncidents } from '../../state/selectors.js';

/** HTML de una tarjeta de incidente. Puro: recibe datos, devuelve texto (todo lo del usuario va escapado). */
export function incidentCardHtml(inc, referenceDate) {
  const calm = isTranquilityIncident(inc);
  const ago = calculateDaysSince(inc.date, referenceDate);
  const pending = !inc.dateConfirmed || !inc.timeConfirmed;
  return `
      <div class="ic-head">
        <div><span class="badge ${calm ? 'calm' : ''}">#${inc.number}</span>${inc.resolvedBy === 'policia' ? '<span class="tag-resolved" title="Atendido por la policía">👮 Resuelto</span>' : ''}<span class="ic-date">${escapeHtml(inc.dateLabel || inc.date)}</span></div>
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
}

/** Lista de incidentes, del más nuevo al más viejo (por número de reporte). */
export function mountIncidentsPane({ store, actions, renderTabs }) {
  const list = $('incidentList');

  store.subscribe(
    (s) => [s.data.incidents, s.selection.incidentId, s.settings.referenceDate, s.ui.sheet === 'incidents'],
    ([, , , visible]) => {
      if (!visible) return;
      renderTabs('incidents');
      const state = store.get();
      const rows = [...selectIncidents(state)].sort((a, b) => (b.number || 0) - (a.number || 0));
      list.innerHTML = '';
      for (const inc of rows) list.appendChild(card(inc, state));
    }
  );

  function card(inc, state) {
    const el = document.createElement('article');
    el.className = `incident-card ${inc.id === state.selection.incidentId ? 'active' : ''} ${isTranquilityIncident(inc) ? 'calm' : ''}`;
    el.innerHTML = incidentCardHtml(inc, state.settings.referenceDate);
    el.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'edit') actions.openReport({ incident: inc });
      else if (act === 'confirm') actions.confirmIncident(inc.id);
      else actions.focusIncident(inc);
    });
    return el;
  }
}
