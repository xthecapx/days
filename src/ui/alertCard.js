import { $, setHidden } from '../core/dom.js';
import { calculateDaysSince, latestIncident } from '../domain/incident.js';
import { selectHeatmap, selectIncidents, selectPreviewKey } from '../state/selectors.js';

const HEADLINE = 'DÍAS DESDE EL ÚLTIMO INCIDENTE';

/** What the top card shows. Pure: does not touch the DOM. */
export function alertSummary(incidents, referenceDate) {
  const latest = latestIncident(incidents);
  if (!latest) {
    return { latest: null, days: '--', label: HEADLINE, preview: 'Sin incidentes registrados.' };
  }
  const days = calculateDaysSince(latest.date, referenceDate);
  return {
    latest,
    days: String(days).padStart(2, '0'),
    label: days === 1 ? 'DÍA DESDE EL ÚLTIMO INCIDENTE' : HEADLINE,
    preview: `#${latest.number}: ${latest.description}`
  };
}

/** "Days since the last incident" card: counter, summary and expandable detail. */
export function mountAlertCard({ store, actions, measureInsets }) {
  $('alertToggle').addEventListener('click', () => actions.toggleAlert());

  store.subscribe(
    (s) => [s.data.incidents, s.settings.referenceDate, s.settings.decayMode, selectPreviewKey(s)],
    () => render(store.get())
  );

  store.subscribe((s) => [s.ui.alertExpanded], ([open]) => {
    setHidden($('alertDetails'), !open);
    $('alertChevron').textContent = open ? '▴' : '▾';
    $('alertToggle').setAttribute('aria-expanded', String(open));
    measureInsets();
  });

  function render(state) {
    $('redPixels').textContent = `🔴 ${selectHeatmap(state).affectedPixelsCount} px`;

    const { latest, days, label, preview } = alertSummary(selectIncidents(state), state.settings.referenceDate);
    $('daysValue').textContent = days;
    $('daysLabel').textContent = label;
    $('alertPreview').textContent = preview;
    $('latestDesc').textContent = preview;
    if (!latest) return;
    $('latestDate').textContent = latest.dateLabel || latest.date;
    $('latestLocation').textContent = `📍 ${latest.sector}`;
    $('btnFocusLatest').onclick = () => actions.focusIncident(latest);
  }
}
