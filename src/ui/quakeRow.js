import { $, setHidden } from '../core/dom.js';
import { quakeSummary, quakeDetail } from '../domain/quakes.js';

const dateLabel = (ms) => new Date(ms).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' });

/** Earthquake row of the top card (and its one-line copy in the listening bar). Appears once the first read arrives. */
export function mountQuakeRow({ store, measureInsets, now = Date.now }) {
  let open = false;
  $('quakeToggle').addEventListener('click', () => {
    open = !open;
    renderOpen();
  });

  function renderOpen() {
    const has = Boolean(store.get().quakes.items[0]);
    setHidden($('quakeDetails'), !(open && has));
    $('quakeChevron').textContent = open ? '▴' : '▾';
    $('quakeToggle').setAttribute('aria-expanded', String(open));
    measureInsets();
  }

  store.subscribe((s) => [s.quakes.items, s.quakes.loaded, s.settings.referenceDate], () => render(store.get()));

  function render(state) {
    const { loaded, items } = state.quakes;
    setHidden($('quakeToggle'), !loaded);
    if (!loaded) return;
    const v = quakeSummary(items, state.settings.referenceDate, now());
    $('quakeValue').textContent = v.days;
    $('quakeLabel').textContent = v.label;
    $('quakePreview').textContent = v.preview;
    $('quakeToggle').classList.toggle('fresh', v.fresh);
    $('listenBarQuake').textContent = v.fresh ? `🌎 ${v.label} · ${v.preview}` : '';
    setHidden($('listenBarQuake'), !v.fresh);
    if (v.quake) {
      $('quakeDate').textContent = dateLabel(v.quake.time);
      $('quakeDesc').textContent = quakeDetail(v.quake);
      $('quakeSource').textContent = `Fuente: ${v.quake.source}`;
      const link = $('quakeLink');
      if (v.quake.url) link.href = v.quake.url;
      else link.removeAttribute('href');
      setHidden(link, !v.quake.url);
    }
    renderOpen();
  }
}
