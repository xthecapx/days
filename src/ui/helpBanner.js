import { $, setHidden } from '../core/dom.js';
import { ageLabel } from '../domain/signals.js';

/** Texto del aviso. Puro. */
function bannerText(signal, count, now) {
  const extra = count > 1 ? ` (+${count - 1} más)` : '';
  return `🆘 Alguien pidió ayuda ${ageLabel(signal.at, now)}${extra}`;
}

/**
 * Red notice under the days card while there is an alert from a neighbour that you have not dismissed. Dismissing it only
 * hides it on your screen (the alert stays on the map and in the help sheet). It appears even if you are not listening: what is
 * seen when opening the page is part of the idea ("whoever reloads sees what is there now").
 */
export function mountHelpBanner({ store, actions, now = () => Date.now() }) {
  const dismissed = new Set();
  const clock = () => now() + (store.get().signals.skew || 0);

  function render() {
    const { active } = store.get().signals;
    const others = active.filter((s) => !dismissed.has(s.id));
    setHidden($('helpBanner'), others.length === 0);
    if (others.length) $('helpBannerText').textContent = bannerText(others[0], others.length, clock());
  }

  store.subscribe((s) => [s.signals.active], render);
  setInterval(render, 30_000); // "hace 3 min" updates without polling the server
  $('btnHelpBannerClose').addEventListener('click', () => {
    store.get().signals.active.forEach((s) => dismissed.add(s.id));
    render();
  });
  $('btnHelpBannerView').addEventListener('click', () => {
    const first = store.get().signals.active.find((s) => !dismissed.has(s.id));
    if (first) actions.focusSignal(first.id);
  });
}
