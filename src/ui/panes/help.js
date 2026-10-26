import { $, setHidden } from '../../core/dom.js';
import { ageLabel, listenersLabel } from '../../domain/signals.js';

/** What to show depending on the signal state. Pure: receives the state and the time, returns data (does not touch the DOM). */
function helpView(signals, now) {
  return {
    listenersText: listenersLabel(signals.listeners),
    listenHint:
      signals.status === 'error'
        ? signals.listening
          ? 'Sin conexión con el servidor: se reintenta solo.'
          : 'Sin conexión con el servidor de alertas. Recarga la página para intentarlo de nuevo.'
        : signals.listening
          ? 'Escuchando mientras esta pantalla esté abierta (revisa cada 30 s). No funciona en segundo plano.'
          : 'Apagado: solo ves las alertas cuando abres o recargas la página.',
    cards: signals.active.map((s) => ({ id: s.id, label: ageLabel(s.at, now) })),
    empty: signals.active.length === 0
  };
}

/**
 * "Help" sheet: turn listening on and see the active alerts. Alerts are SENT from the phone (a Shortcut), never from
 * this screen: the app only shows them.
 */
export function mountHelpPane({ store, actions, signals, now = () => Date.now() }) {
  const clock = () => now() + (store.get().signals.skew || 0);

  $('chkListen').addEventListener('change', (e) => signals.setListening(e.target.checked));
  $('helpList').addEventListener('click', (e) => {
    const card = e.target.closest('[data-signal]');
    if (card) actions.focusSignal(card.dataset.signal);
  });

  store.subscribe((s) => [s.signals, s.ui.sheet === 'help'], ([sig, visible]) => {
    if (!visible) return;
    const v = helpView(sig, clock());
    $('helpListeners').textContent = `👂 ${v.listenersText}`;
    $('helpListenHint').textContent = v.listenHint;
    $('chkListen').checked = sig.listening;
    setHidden($('helpEmpty'), !v.empty);

    $('helpList').replaceChildren(
      ...v.cards.map((c) => {
        const el = document.createElement('div');
        el.className = 'signal-card';
        el.dataset.signal = c.id;
        const text = document.createElement('span');
        text.textContent = `🆘 Alguien pidió ayuda · ${c.label}`; // textContent: never HTML
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
