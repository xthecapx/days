import { $, setHidden } from '../core/dom.js';
import { ageLabel } from '../domain/signals.js';

/** Texto del aviso. Puro. */
export function bannerText(signal, count, now) {
  const extra = count > 1 ? ` (+${count - 1} más)` : '';
  return `🆘 Alguien pidió ayuda ${ageLabel(signal.at, now)}${extra}`;
}

/**
 * Aviso rojo bajo la tarjeta de días mientras haya una alerta de OTRO vecino que no hayas descartado. Descartarlo solo lo
 * oculta en tu pantalla (la alerta sigue en el mapa y en la hoja de ayuda). Aparece aunque no estés escuchando: lo que se
 * ve al abrir la página es parte de la idea ("quien recarga ve lo que hay ahora").
 */
export function mountHelpBanner({ store, actions, now = () => Date.now() }) {
  const dismissed = new Set();
  const clock = () => now() + (store.get().signals.skew || 0);

  function render() {
    const { active, mine } = store.get().signals;
    const others = active.filter((s) => s.id !== mine?.id && !dismissed.has(s.id));
    setHidden($('helpBanner'), others.length === 0);
    if (others.length) $('helpBannerText').textContent = bannerText(others[0], others.length, clock());
  }

  store.subscribe((s) => [s.signals.active, s.signals.mine], render);
  setInterval(render, 30_000); // "hace 3 min" se actualiza sin sondear al servidor
  $('btnHelpBannerClose').addEventListener('click', () => {
    store.get().signals.active.forEach((s) => dismissed.add(s.id));
    render();
  });
  $('btnHelpBannerView').addEventListener('click', () => {
    const { active, mine } = store.get().signals;
    const first = active.find((s) => s.id !== mine?.id && !dismissed.has(s.id));
    if (first) actions.focusSignal(first.id);
  });
}
