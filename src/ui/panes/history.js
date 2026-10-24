import { $, escapeHtml } from '../../core/dom.js';

/** Fecha legible de una revisión; si no se puede interpretar, el texto tal cual. */
export function formatRevisionTime(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? timestamp
    : date.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

/** HTML de una revisión del historial. Puro. */
export function revisionHtml(rev) {
  const canRevert = Array.isArray(rev.previousIncidentsSnapshot);
  return `
            <div class="rev-top"><span>[${escapeHtml(rev.revId)}] ${escapeHtml(rev.action)}</span><span>${escapeHtml(formatRevisionTime(rev.timestamp))}</span></div>
            <div>${escapeHtml(rev.note || '')}</div>
            <div class="rev-foot"><span>🕵️ Vecino anónimo</span>${canRevert ? '<button type="button" class="btn btn-sm">↩️ Revertir</button>' : ''}</div>`;
}

/** Historial de revisiones con el botón de revertir, y el aviso de sincronización. */
export function mountHistoryPane({ store, incidents, renderTabs }) {
  const list = $('revisionList');

  store.subscribe(
    (s) => [s.data.revisions, s.ui.sheet === 'history'],
    ([revisions, visible]) => {
      if (!visible) return;
      renderTabs('history');
      list.innerHTML = '';
      for (const rev of revisions || []) {
        const el = document.createElement('div');
        el.className = 'revision-card';
        el.innerHTML = revisionHtml(rev);
        el.querySelector('button')?.addEventListener('click', () => incidents.revert(rev.revId));
        list.appendChild(el);
      }
    }
  );

  store.subscribe((s) => [s.sync.message], ([msg]) => {
    $('syncBadge').textContent = msg ? `• ${msg}` : '';
  });
}
