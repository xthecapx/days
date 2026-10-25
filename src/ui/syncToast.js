import { showToast } from '../core/dom.js';

/** How long the notice lasts: failures stay longer so they can be read. */
export const syncToastMs = (ok) => (ok === false ? 7000 : 4500);

/**
 * Tells the user on screen what happened on save ("Enviado para revisión…", "demasiados reportes pendientes…").
 * It subscribes to the whole `sync` object so that two consecutive saves with the same message notify twice.
 */
export function mountSyncToast({ store, toast = showToast }) {
  store.subscribe(
    (s) => [s.sync],
    ([sync]) => {
      if (sync.message) toast(sync.message, syncToastMs(sync.ok));
    },
    { immediate: false }
  );
}
