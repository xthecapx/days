import { showToast } from '../core/dom.js';

/** Cuánto dura el aviso: los fallos se quedan más tiempo para que se alcancen a leer. */
export const syncToastMs = (ok) => (ok === false ? 7000 : 4500);

/**
 * Avisa en pantalla qué pasó al guardar ("Enviado para revisión…", "demasiados reportes pendientes…").
 * Se suscribe al objeto `sync` completo para que dos guardados seguidos con el mismo mensaje avisen dos veces.
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
