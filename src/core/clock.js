import { toIsoDate } from './dom.js';

/**
 * The app's "today". It is the device date, at noon (so adding or subtracting hours does not change the day).
 * It updates itself after midnight or when returning to the tab after leaving it open for days.
 */

export const startOfDay = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);

/** Milliseconds until the device clock reads the next day (minimum 1 s). */
export function msUntilNextDay(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

/**
 * Keeps `settings.referenceDate` current. Returns `stop()`.
 * `now`, `setTimer` and `clearTimer` can be replaced in tests.
 */
export function startDayClock(store, { now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout, doc = globalThis.document } = {}) {
  let timer = null;

  function sync() {
    if (toIsoDate(store.get().settings.referenceDate) !== toIsoDate(now())) store.patch('settings', { referenceDate: startOfDay(now()) });
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
      schedule(); // timers fall behind while the tab is in the background
    }
  };
  doc?.addEventListener('visibilitychange', onVisible);
  schedule();

  return function stop() {
    clearTimer(timer);
    doc?.removeEventListener('visibilitychange', onVisible);
  };
}
