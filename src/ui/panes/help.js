import { $, setHidden, showToast } from '../../core/dom.js';
import { ageLabel, listenersLabel, sendHint, isActive, apiErrorMessage } from '../../domain/signals.js';

/** Texto para quien intenta enviar y no se pudo. Puro. */
export function sendErrorMessage(error) {
  switch (error) {
    case 'gps_denied': return 'No puedo ver tu ubicación: permite la ubicación para este sitio (Ajustes del teléfono) e inténtalo de nuevo.';
    case 'no_gps': return 'Aún no tengo tu ubicación. Espera unos segundos con el GPS activado e inténtalo de nuevo.';
    default: return `${apiErrorMessage(error)} Si es una emergencia, llama al 123 o usa WhatsApp.`;
  }
}

/** "Vence en 12 min" (mínimo 1). Puro. */
export const expiresLabel = (expiresAt, now) => `Vence en ${Math.max(1, Math.ceil((expiresAt - now) / 60_000))} min`;

/** Qué mostrar según el estado de la señal. Puro: recibe el estado y la hora, devuelve datos (no toca el DOM). */
export function helpView(signals, now) {
  const mineActive = Boolean(signals.mine && isActive(signals.mine, now));
  return {
    hint: sendHint(signals.listeners),
    listenersText: listenersLabel(signals.listeners),
    listenHint: signals.listening
      ? signals.status === 'error' ? 'Sin conexión con el servidor: se reintenta solo.' : 'Escuchando mientras esta pantalla esté abierta (revisa cada 30 s). No funciona en segundo plano.'
      : 'Apagado: solo ves las alertas cuando abres o recargas la página.',
    mineActive,
    mineText: mineActive ? expiresLabel(signals.mine.expiresAt, now) : '',
    cards: signals.active.map((s) => ({ id: s.id, x: s.x, y: s.y, label: ageLabel(s.at, now), mine: s.id === signals.mine?.id })),
    empty: signals.active.length === 0
  };
}

/** Hoja "Ayuda": pedir ayuda (con confirmación), retirarla, activar la escucha y ver las alertas activas. */
export function mountHelpPane({ store, actions, signals, now = () => Date.now() }) {
  const clock = () => now() + (store.get().signals.skew || 0);

  $('btnHelpSend').addEventListener('click', () => {
    $('helpError').classList.add('hidden');
    store.patch('ui', { helpConfirm: true });
  });
  $('btnHelpNo').addEventListener('click', () => store.patch('ui', { helpConfirm: false }));
  $('btnHelpYes').addEventListener('click', async () => {
    const btn = $('btnHelpYes');
    if (btn.getAttribute('aria-busy') === 'true') return; // un doble toque no manda dos señales
    btn.setAttribute('aria-busy', 'true');
    try {
      const result = await signals.send();
      store.patch('ui', { helpConfirm: false });
      if (result.ok) showToast('🆘 Alerta enviada. Dura 30 minutos.', 5000);
      else {
        $('helpError').textContent = sendErrorMessage(result.error);
        setHidden($('helpError'), false);
      }
    } finally {
      btn.removeAttribute('aria-busy');
    }
  });
  $('btnHelpCancel').addEventListener('click', async () => {
    const result = await signals.cancel();
    showToast(result.ok ? 'Alerta retirada.' : sendErrorMessage(result.error), 4000);
  });
  $('chkListen').addEventListener('change', (e) => signals.setListening(e.target.checked));
  $('helpList').addEventListener('click', (e) => {
    const card = e.target.closest('[data-signal]');
    if (card) actions.focusSignal(card.dataset.signal);
  });

  store.subscribe((s) => [s.signals, s.ui.helpConfirm, s.ui.sheet === 'help'], ([sig, confirm, visible]) => {
    if (!visible) return;
    const v = helpView(sig, clock());
    $('helpHint').textContent = v.hint;
    $('helpListeners').textContent = `👂 ${v.listenersText}`;
    $('helpListenHint').textContent = v.listenHint;
    $('chkListen').checked = sig.listening;
    setHidden($('helpMine'), !v.mineActive);
    $('helpMineText').textContent = v.mineText;
    setHidden($('helpConfirm'), !confirm);
    setHidden($('btnHelpSend'), confirm || v.mineActive);
    setHidden($('helpEmpty'), !v.empty);

    const list = $('helpList');
    list.replaceChildren(
      ...v.cards.map((c) => {
        const el = document.createElement('div');
        el.className = 'signal-card';
        el.dataset.signal = c.id;
        const text = document.createElement('span');
        text.textContent = `🆘 ${c.mine ? 'Tu alerta' : 'Alguien pidió ayuda'} · ${c.label}`; // textContent: nunca HTML
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'btn btn-sm';
        go.textContent = 'Ver en el mapa';
        el.append(text, go);
        return el;
      })
    );
  });
}
