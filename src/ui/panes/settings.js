import { $, toIsoDate, downloadJson } from '../../core/dom.js';
import { startOfDay } from '../../core/clock.js';

/**
 * Qué guardar cuando la persona cambia "Fecha de hoy". Vacío o igual a hoy = automática (sigue al reloj);
 * cualquier otra fecha se fija a mano. Puro: `now` se puede reemplazar en pruebas.
 */
export function pickReferenceDate(value, now = new Date()) {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d || value === toIsoDate(now)) return { referenceDate: startOfDay(now), referenceOverride: false };
  return { referenceDate: new Date(y, m - 1, d, 12), referenceOverride: true };
}

/** Ajustes del mapa (capas, modo de alerta, fecha de hoy) y herramientas de datos (historial, exportar, importar, restaurar). */
export function mountSettingsPane({ store, actions, incidents }) {
  $('chkGrid').addEventListener('change', (e) => store.patch('settings', { showGrid: e.target.checked }));
  $('selDecay').addEventListener('change', (e) => store.patch('settings', { decayMode: e.target.value }));
  $('inpToday').addEventListener('change', (e) => {
    store.patch('settings', pickReferenceDate(e.target.value));
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
