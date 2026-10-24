import { $, escapeHtml } from '../../core/dom.js';
import { CATEGORIES, IMPACT_TYPES, SEVERITY_NAMES } from '../../core/config.js';
import { pixelToGps } from '../../map/gpsGrid.js';

/** Qué campo falta para poder enviar el reporte (o null si está completo). Puro. */
export function missingField(draft) {
  if (!draft.description.trim()) return 'repDescription';
  if (!draft.date) return 'repDate';
  return null;
}

/** Título de la hoja según se cree o se edite. */
export const reportTitle = (draft) =>
  draft?.editingId ? `✏️ Editar incidente #${draft.number}` : '➕ Reportar evento anónimo';

/** Formulario de reporte: la entrada va al borrador del store y el borrador se dibuja de vuelta en los controles. */
export function mountReportPane({ store, actions }) {
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
  $('repResolved').addEventListener('change', (e) => actions.patchDraft({ resolved: e.target.checked }));
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
    const missing = missingField(d);
    if (missing) {
      $(missing).closest('.field').classList.add('field-error');
      $(missing).focus();
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
      $('repResolved').checked = Boolean(d.resolved);
      form.querySelectorAll('.field-error').forEach((el) => el.classList.remove('field-error'));
    }
    if (document.activeElement !== $('repSector')) $('repSector').value = d.sector;
  });
}
