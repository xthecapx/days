import { isActive, newListenerId } from '../domain/signals.js';
import { createSignalFeed } from './signalFeed.js';

/**
 * Casos de uso de la señal de ayuda: junta el cliente del servidor, el sondeo, el GPS y las preferencias del navegador,
 * y deja el resultado en el store. La interfaz solo llama a estas funciones y lee el store.
 *
 * Todo lo externo entra por parámetros (como en gps.js y incidentService.js), para probarlo sin red ni navegador.
 */
export function createSignalService({
  store,
  api,
  gps,
  prefs, // { read(), write(p) }
  now = Date.now,
  makeFeed = createSignalFeed,
  onNew = () => {}
}) {
  const patch = (partial) => store.patch('signals', partial);
  const saved = prefs.read();
  const listenerId = saved.listenerId || newListenerId();
  let mine = saved.mine && isActive(saved.mine, now()) ? saved.mine : null;

  const persist = () => prefs.write({ listening: store.get().signals.listening, listenerId, mine });
  persist();
  patch({ enabled: api.enabled, mine: mine ? { id: mine.id, expiresAt: mine.expiresAt } : null, listening: false });

  const feed = makeFeed({
    api,
    listenerId,
    onUpdate: (view) => {
      // Los relojes de los teléfonos se desfasan: se mide la diferencia con el servidor para que "hace 3 min" sea cierto.
      const hasServerClock = Number.isFinite(view.serverNow);
      const skew = hasServerClock ? view.serverNow - now() : store.get().signals.skew;
      // Mi señal se olvida solo cuando YA VENCIÓ (con la hora del servidor). Si otro dispositivo la canceló, sigue figurando
      // hasta entonces: es un detalle menor y evita borrar por error una alerta recién enviada.
      if (mine && !isActive(mine, now() + skew)) {
        mine = null;
        persist();
      }
      patch({ active: view.signals, listeners: view.listeners, loaded: true, skew, mine: mine ? { id: mine.id, expiresAt: mine.expiresAt } : null });
    },
    onNew: (signals, view) => onNew(signals.filter((s) => s.id !== mine?.id), view),
    onStatus: (status) => patch({ status })
  });

  return {
    /** Lectura única al abrir la página (no cuenta como oyente). Si la persona dejó la escucha activada, la retoma. */
    async start() {
      if (!api.enabled) return;
      await feed.refresh();
      if (saved.listening) await this.setListening(true);
    },

    async setListening(value) {
      if (!api.enabled) return;
      patch({ listening: Boolean(value) });
      persist();
      await feed.setListening(Boolean(value));
    },

    /**
     * Envía la señal con la posición del teléfono. Devuelve { ok:true, signal } o { ok:false, error }.
     * `no_gps` = no se pudo leer la ubicación (la persona debe saberlo: sin ubicación no hay señal que enviar).
     */
    async send() {
      if (!api.enabled) return { ok: false, error: 'not_configured' };
      const position = gps.fix() || (await gps.read());
      if (!position) return { ok: false, error: gps.error() === 'denied' ? 'gps_denied' : 'no_gps' };
      const result = await api.send({ lat: position.lat, lng: position.lng });
      if (!result.ok) return result;
      const { id, cancelToken, expiresAt, listeners } = result.data;
      mine = { id, token: cancelToken, expiresAt };
      persist();
      patch({ mine: { id, expiresAt }, listeners });
      await feed.refresh();
      return { ok: true, signal: { id, expiresAt }, listeners };
    },

    /** Retira mi señal activa (por si fue una falsa alarma). */
    async cancel() {
      if (!mine) return { ok: false, error: 'nothing_to_cancel' };
      const result = await api.cancel({ id: mine.id, token: mine.token });
      // 404 = ya no existe (venció): para mí es lo mismo que cancelada.
      if (result.ok || result.status === 404) {
        mine = null;
        persist();
        patch({ mine: null });
        await feed.refresh();
        return { ok: true };
      }
      return result;
    },

    listenerId,
    stop: () => feed.stop()
  };
}
