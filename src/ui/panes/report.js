import { $, escapeHtml, setHidden, showToast, toIsoDate } from '../../core/dom.js';
import { CATEGORIES, SEVERITY_NAMES } from '../../core/config.js';

const isoDaysAgo = (today, n) => toIsoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n, 12));

/** 'today' | 'yesterday' | 'other' según el día en que OCURRIÓ el hecho, o null si todavía no hay fecha. Puro. */
export function whenChoice(date, today) {
  if (!date) return null;
  if (date === isoDaysAgo(today, 0)) return 'today';
  if (date === isoDaysAgo(today, 1)) return 'yesterday';
  return 'other';
}

/** Fecha (YYYY-MM-DD) de un botón. "Otro día" no tiene: la persona la elige en el calendario. Puro. */
export function dateForChoice(choice, today) {
  if (choice === 'today') return isoDaysAgo(today, 0);
  if (choice === 'yesterday') return isoDaysAgo(today, 1);
  return '';
}

/** Qué muestra el selector de fecha para este borrador. Puro. */
export function whenView(draft, today) {
  const choice = whenChoice(draft.date, today);
  return {
    active: draft.pickDate ? 'other' : choice,
    showDate: Boolean(draft.pickDate) || choice === 'other',
    // Un incidente antiguo puede traer una fecha que nadie confirmó: se avisa para que la corrijan.
    needsConfirm: Boolean(draft.date) && !draft.dateConfirmed
  };
}

/** Qué campo falta para poder enviar el reporte (o null si está completo). Puro. */
export function missingField(draft) {
  if (!draft.description.trim()) return 'repDescription';
  if (!draft.date) return 'repWhen';
  return null;
}

/** Título de la hoja según se cree o se edite. */
export const reportTitle = (draft) =>
  draft?.editingId ? `✏️ Editar incidente #${draft.number}` : '➕ Reportar evento anónimo';

/** Formulario de reporte: la entrada va al borrador del store y el borrador se dibuja de vuelta en los controles. */
export function mountReportPane({ store, actions }) {
  const form = $('paneReport');
  const submitBtn = $('btnSubmitReport');
  const whenField = $('repWhen').closest('.field');
  const today = () => store.get().settings.referenceDate;

  $('repCategory').innerHTML = CATEGORIES.map(
    (c) => `<option value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</option>`
  ).join('');

  // Entrada → borrador (el mapa dibuja el borrador como vista previa en vivo).
  // El color del mapa (seguridad / tranquilidad) sale de la categoría; no se pregunta aparte.
  $('repDescription').addEventListener('input', (e) => actions.patchDraft({ description: e.target.value }));
  $('repCategory').addEventListener('change', (e) => actions.patchDraft({ category: e.target.value }));
  $('repSeverity').addEventListener('input', (e) => actions.patchDraft({ severity: Number(e.target.value) }));
  $('repDate').addEventListener('change', (e) => actions.patchDraft({ date: e.target.value }));
  $('repTime').addEventListener('change', (e) => actions.patchDraft({ time: e.target.value }));
  $('repResolved').addEventListener('change', (e) => actions.patchDraft({ resolved: e.target.checked }));

  function openDatePicker() {
    const input = $('repDate');
    input.focus();
    try {
      input.showPicker?.();
    } catch {
      /* el navegador no deja abrirlo desde aquí: basta con tocar el campo */
    }
  }

  $('repWhen').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-when]');
    if (!btn) return;
    const choice = btn.dataset.when;
    if (choice === 'other') {
      const d = store.get().draft;
      // Si ya eligió otro día, tocar de nuevo no le borra la fecha: solo abre el calendario.
      if (!(d?.date && whenChoice(d.date, today()) === 'other')) actions.patchDraft({ date: '', pickDate: true });
      openDatePicker();
      return;
    }
    actions.patchDraft({ date: dateForChoice(choice, today()) });
    whenField.classList.remove('field-error');
  });

  $('btnPickOnMap').addEventListener('click', () => actions.startPickForReport());
  $('btnCancelReport').addEventListener('click', () => actions.closeSheet());

  function focusMissing(id) {
    if (id !== 'repWhen') return $(id).focus();
    ($('repDate').classList.contains('hidden') ? $('repWhen').querySelector('button') : $('repDate')).focus();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Guardar puede tardar (va al puente): sin esto, un doble toque o Enter abriría dos Pull Requests.
    if (submitBtn.getAttribute('aria-busy') === 'true') return;
    const d = store.get().draft;
    if (!d) return;
    const missing = missingField(d);
    if (missing) {
      $(missing).closest('.field').classList.add('field-error');
      focusMissing(missing);
      return;
    }
    submitBtn.setAttribute('aria-busy', 'true');
    try {
      await actions.submitDraft();
    } catch (err) {
      console.error('No se pudo guardar el reporte', err);
      showToast('No se pudo guardar el reporte. Inténtalo de nuevo.', 6000);
    } finally {
      submitBtn.removeAttribute('aria-busy');
    }
  });
  form.addEventListener('input', (e) => e.target.closest('.field')?.classList.remove('field-error'));

  // Borrador → controles. Se rellena completo al abrir y después solo se actualiza lo que cambia
  // por fuera del teclado (ubicación, fecha), sin pisar lo que la persona escribe.
  let lastSession = null;
  store.subscribe((s) => [s.draft, s.settings.referenceDate], ([d, ref]) => {
    if (!d) {
      lastSession = null;
      return;
    }
    $('repSector').textContent = d.sector;
    $('repSeverityLabel').textContent = SEVERITY_NAMES[d.severity] || `${d.severity} / 5`;

    const when = whenView(d, ref);
    for (const b of $('repWhen').children) {
      const on = b.dataset.when === when.active;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    setHidden($('repDate'), !when.showDate);
    setHidden($('repWhenHint'), !when.needsConfirm);
    $('repDate').max = toIsoDate(ref); // no se reportan hechos del futuro
    if (document.activeElement !== $('repDate')) $('repDate').value = d.date;

    if (lastSession !== d.session) {
      lastSession = d.session;
      $('repDescription').value = d.description;
      $('repCategory').value = d.category;
      $('repSeverity').value = String(d.severity);
      $('repTime').value = d.time;
      $('repResolved').checked = Boolean(d.resolved);
      form.querySelectorAll('.field-error').forEach((el) => el.classList.remove('field-error'));
    }
  });
}
