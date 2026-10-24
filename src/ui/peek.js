import { $, setHidden } from '../core/dom.js';
import { pixelToGps } from '../map/gpsGrid.js';
import { findIncident } from '../state/selectors.js';

/** Título de la tarjeta de un incidente. Puro: no toca el DOM. */
export const peekTitle = (inc) =>
  `#${inc.number} · ${inc.dateLabel || inc.date}${inc.resolvedBy === 'policia' ? ' · 👮 Resuelto' : ''}`;

/** Tarjeta inferior: píxel/sector seleccionado y, si se tocó un incidente, su resumen con acciones. */
export function mountPeek({ store, actions, measureInsets, sectorName }) {
  const popupIncident = () => findIncident(store.get(), store.get().ui.popupIncidentId);

  $('btnClosePeek').addEventListener('click', () => actions.showPopup(null));
  $('btnPeekEdit').addEventListener('click', () => {
    const inc = popupIncident();
    if (inc) actions.openReport({ incident: inc });
  });
  $('btnPeekMove').addEventListener('click', () => {
    const inc = popupIncident();
    if (inc) actions.startMove(inc);
  });
  $('btnPeekConfirm').addEventListener('click', () => {
    const inc = popupIncident();
    if (inc) actions.confirmIncident(inc.id);
  });

  store.subscribe((s) => [s.selection.pixel], ([pixel]) => {
    const gps = pixelToGps(pixel.x, pixel.y);
    $('pixelCoord').textContent = `Píxel (${gps.pixelX}, ${gps.pixelY})`;
    $('pixelSector').textContent = sectorName(gps.pixelX, gps.pixelY);
  });

  store.subscribe((s) => [s.ui.popupIncidentId, s.data.incidents], () => {
    const inc = popupIncident();
    setHidden($('peekIncident'), !inc);
    $('peek').classList.toggle('has-incident', Boolean(inc));
    if (inc) {
      $('peekTitle').textContent = peekTitle(inc);
      $('peekDesc').textContent = inc.description;
      $('btnPeekConfirm').textContent = `👍 Confirmar (${inc.confirmations || 1})`;
    }
    measureInsets();
  });
}
