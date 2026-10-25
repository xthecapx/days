/**
 * Mantiene al día las señales de ayuda. Reglas (todas con prueba):
 *   - Al abrir la página se lee UNA vez (`refresh`); quien no escucha no sondea después.
 *   - Quien activa "escuchar" sondea cada 30 s, y SOLO mientras la página está a la vista. Pestaña oculta = nada.
 *   - Al volver a la pestaña se sondea de inmediato (los temporizadores se atrasan en segundo plano).
 *   - Si el servidor falla, se espacia (30 s → 60 s → 2 min) y no se avisa en cada intento.
 *   - Nada se ejecuta en segundo plano: no hay Service Worker ni notificaciones push.
 *
 *   const feed = createSignalFeed({ api, listenerId, onUpdate, onNew, onStatus });
 *   await feed.refresh();            // lectura única al arrancar
 *   feed.setListening(true);         // empieza a sondear cada 30 s mientras se vea
 */

import { newSignals, normalizeSignals } from '../domain/signals.js';

export const POLL_MS = 30_000;
export const BACKOFF_MS = [30_000, 60_000, 120_000];

export function createSignalFeed({
  api,
  listenerId,
  onUpdate = () => {},
  onNew = () => {},
  onStatus = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  doc = globalThis.document
} = {}) {
  let listening = false;
  let timer = null;
  let failures = 0;
  let inFlight = null;
  let started = false; // ya hubo una lectura: a partir de aquí, lo que aparezca es "nuevo"
  let status = 'idle'; // 'idle' | 'ok' | 'error'
  const seen = new Set();

  const visible = () => !doc || !doc.hidden;
  const setStatus = (next) => {
    if (next !== status) {
      status = next;
      onStatus(status);
    }
  };

  function apply(payload) {
    const view = normalizeSignals(payload);
    if (started) {
      const fresh = newSignals(view.signals, seen);
      if (fresh.length) onNew(fresh, view);
    }
    for (const s of view.signals) seen.add(s.id);
    started = true;
    onUpdate(view);
  }

  /** Una lectura ahora. Si ya hay una en curso, la comparte (nunca dos a la vez). */
  function run(kind) {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const result = kind === 'poll' ? await api.poll({ listener: listenerId, listening: true }) : await api.state();
      if (result.ok) {
        failures = 0;
        setStatus('ok');
        apply(result.data);
      } else {
        failures += 1;
        setStatus('error');
      }
      return result;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  const delay = () => (failures === 0 ? POLL_MS : BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]);

  function schedule() {
    clearTimer(timer);
    timer = null;
    if (!listening || !visible()) return; // sin escucha o con la pestaña oculta, no hay temporizador
    timer = setTimer(async () => {
      timer = null;
      await run('poll');
      schedule();
    }, delay());
  }

  const onVisibility = async () => {
    if (!listening) return;
    if (visible()) {
      await run('poll'); // al volver se sondea ya
      schedule();
    } else {
      clearTimer(timer);
      timer = null;
    }
  };
  doc?.addEventListener('visibilitychange', onVisibility);

  return {
    /** Lectura pública: no cuenta como oyente. */
    refresh: () => run('state'),

    /** Activa o desactiva la escucha. Al desactivar se avisa al servidor para que deje de contarte. */
    async setListening(value) {
      const next = Boolean(value);
      if (next === listening) return;
      listening = next;
      if (listening) {
        failures = 0;
        if (visible()) await run('poll');
        schedule();
      } else {
        clearTimer(timer);
        timer = null;
        await api.poll({ listener: listenerId, listening: false }); // sale del conteo al momento
      }
    },

    isListening: () => listening,
    status: () => status,
    failures: () => failures,

    /** Para pruebas y para cerrar limpio. */
    stop() {
      listening = false;
      clearTimer(timer);
      timer = null;
      doc?.removeEventListener('visibilitychange', onVisibility);
    }
  };
}
