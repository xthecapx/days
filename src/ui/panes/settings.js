import { $ } from '../../core/dom.js';

/** Ajustes del mapa: cuadrícula de píxeles y modo de alerta. */
export function mountSettingsPane({ store }) {
  $('chkGrid').addEventListener('change', (e) => store.patch('settings', { showGrid: e.target.checked }));
  $('selDecay').addEventListener('change', (e) => store.patch('settings', { decayMode: e.target.value }));
  store.subscribe((s) => [s.settings], ([st]) => {
    $('chkGrid').checked = st.showGrid;
    $('selDecay').value = st.decayMode;
  });
}
