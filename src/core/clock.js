import { toIsoDate } from './dom.js';

/**
 * "Hoy" de la app. Es la fecha del dispositivo, a mediodía (así sumar o restar horas no cambia el día).
 * Una fecha elegida a mano en Ajustes (`settings.referenceOverride`) se respeta; si no, el reloj la
 * actualiza solo al pasar la medianoche o al volver a la pestaña tras dejarla abierta días.
 */

export const startOfDay = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);

/** Milisegundos hasta que el reloj del dispositivo marque el día siguiente (mínimo 1 s). */
export function msUntilNextDay(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

/**
 * Mantiene `settings.referenceDate` al día. Devuelve `stop()`.
 * `now`, `setTimer` y `clearTimer` se pueden reemplazar en pruebas.
 */
export function startDayClock(store, { now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout, doc = globalThis.document } = {}) {
  let timer = null;

  function sync() {
    const { referenceOverride, referenceDate } = store.get().settings;
    if (referenceOverride) return;
    if (toIsoDate(referenceDate) !== toIsoDate(now())) store.patch('settings', { referenceDate: startOfDay(now()) });
  }

  function schedule() {
    clearTimer(timer);
    timer = setTimer(() => {
      sync();
      schedule();
    }, msUntilNextDay(now()));
  }

  const onVisible = () => {
    if (doc && !doc.hidden) {
      sync();
      schedule(); // los temporizadores se atrasan con la pestaña en segundo plano
    }
  };
  doc?.addEventListener('visibilitychange', onVisible);
  schedule();

  return function stop() {
    clearTimer(timer);
    doc?.removeEventListener('visibilitychange', onVisible);
  };
}
