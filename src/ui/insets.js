import { $ } from '../core/dom.js';

/** Measures the HUD so the camera centre is the centre of the actually free area. Returns `measureInsets`. */
export function mountInsets({ camera }) {
  function measureInsets() {
    // The top bar is the days card, or the slim listening bar when it replaces it (a hidden element measures 0).
    const topBar = $('listenBar').classList.contains('hidden') ? $('alertCard') : $('listenBar');
    const top = topBar.getBoundingClientRect().bottom + 6;
    const dockHidden = $('dock').classList.contains('hidden');
    const dockTop = dockHidden ? window.innerHeight : $('dock').getBoundingClientRect().top;
    camera.setInsets(top, Math.max(0, window.innerHeight - dockTop + 6));
    document.documentElement.style.setProperty('--alert-bottom', `${Math.round(top - 6)}px`); // the help notice sits right below the card
    document.documentElement.style.setProperty(
      '--controls-bottom',
      `${Math.max(120, window.innerHeight - dockTop + 8)}px`
    );
  }

  window.addEventListener('resize', measureInsets);
  new ResizeObserver(measureInsets).observe($('dock'));
  new ResizeObserver(measureInsets).observe($('alertCard'));
  new ResizeObserver(measureInsets).observe($('listenBar'));
  measureInsets();
  return measureInsets;
}
