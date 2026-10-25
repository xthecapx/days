import { $, escapeHtml, setHidden, showToast, toIsoDate } from '../../core/dom.js';
import { CATEGORIES, SEVERITY_NAMES } from '../../core/config.js';

const isoDaysAgo = (today, n) => toIsoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n, 12));

/** 'today' | 'yesterday' | 'other' according to the day the event OCCURRED, or null if there is no date yet. Pure. */
export function whenChoice(date, today) {
  if (!date) return null;
  if (date === isoDaysAgo(today, 0)) return 'today';
  if (date === isoDaysAgo(today, 1)) return 'yesterday';
  return 'other';
}

/** Date (YYYY-MM-DD) of a button. "Otro día" has none: the person picks it in the calendar. Pure. */
export function dateForChoice(choice, today) {
  if (choice === 'today') return isoDaysAgo(today, 0);
  if (choice === 'yesterday') return isoDaysAgo(today, 1);
  return '';
}

/** What the date picker shows for this draft. Pure. */
export function whenView(draft, today) {
  const choice = whenChoice(draft.date, today);
  return {
    active: draft.pickDate ? 'other' : choice,
    showDate: Boolean(draft.pickDate) || choice === 'other',
    // An old incident may carry a date nobody confirmed: a warning is shown so they correct it.
    needsConfirm: Boolean(draft.date) && !draft.dateConfirmed
  };
}

/** Which field is missing before the report can be sent (or null if complete). Pure. */
export function missingField(draft) {
  if (!draft.description.trim()) return 'repDescription';
  if (!draft.date) return 'repWhen';
  return null;
}

/** Sheet title depending on whether it is being created or edited. */
export const reportTitle = (draft) =>
  draft?.editingId ? `✏️ Editar incidente #${draft.number}` : '➕ Reportar evento anónimo';

/** Report form: input goes to the store draft and the draft is drawn back into the controls. */
export function mountReportPane({ store, actions }) {
  const form = $('paneReport');
  const submitBtn = $('btnSubmitReport');
  const whenField = $('repWhen').closest('.field');
  const today = () => store.get().settings.referenceDate;

  $('repCategory').innerHTML = CATEGORIES.map(
    (c) => `<option value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</option>`
  ).join('');

  // Input → draft (the map draws the draft as a live preview).
  // The map colour (security / calm) comes from the category; it is not asked separately.
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
      /* the browser does not allow opening it from here: tapping the field is enough */
    }
  }

  $('repWhen').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-when]');
    if (!btn) return;
    const choice = btn.dataset.when;
    if (choice === 'other') {
      const d = store.get().draft;
      // If they already chose another day, tapping again does not erase the date: it only opens the calendar.
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
    // Saving can take a while (it goes to the bridge): without this, a double tap or Enter would open two Pull Requests.
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
      console.error('Could not save the report', err);
      showToast('No se pudo guardar el reporte. Inténtalo de nuevo.', 6000);
    } finally {
      submitBtn.removeAttribute('aria-busy');
    }
  });
  form.addEventListener('input', (e) => e.target.closest('.field')?.classList.remove('field-error'));

  // Draft → controls. It is filled in completely on open and afterwards only what changes
  // outside the keyboard (location, date) is updated, without overwriting what the person types.
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
    $('repDate').max = toIsoDate(ref); // events in the future are not reported
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
