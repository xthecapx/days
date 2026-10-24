import { gpsToPixel } from '../map/gpsGrid.js';
import { detectSectorName } from '../map/mapData.js';

/**
 * Alerta rápida por WhatsApp. No toca el mapa, la selección ni los incidentes:
 * lee el GPS del teléfono, arma un mensaje y abre WhatsApp con el texto ya escrito.
 * La persona elige el grupo y pulsa enviar, así que nada se publica solo.
 */

const GPS_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 };
// Una posición vale 2 min. Pasado ese tiempo se vuelve a leer, pero solo cuando hace falta (nunca en continuo).
const FRESH_MS = 2 * 60_000;

let lastFix = null; // { lat, lng, accuracy, at }
let lastError = null; // 'denied' | 'unavailable' | 'timeout' | null
let staleTimer = null;
let pending = null; // lectura puntual en curso, compartida entre llamadas
const listeners = new Set();

const toFix = (pos) => ({
  lat: pos.coords.latitude,
  lng: pos.coords.longitude,
  accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
  at: Date.now()
});
const toError = (err) => (err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'unavailable');

/**
 * 'ok' = posición vigente · 'searching' = leyendo · 'stale' = posición vieja (se relee al usarla)
 * · 'denied' | 'unavailable' = no se puede.
 */
export function gpsStatus() {
  if (lastError === 'denied' || lastError === 'unavailable') return lastError;
  if (freshPosition()) return 'ok';
  if (pending || (!lastFix && !lastError)) return 'searching';
  return 'stale';
}

const emit = () => listeners.forEach((fn) => fn(gpsStatus(), lastFix));

/** Avisa cada vez que cambia el estado del GPS. Devuelve la función para desuscribirse. */
export function onGpsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const gotFix = (pos) => {
  lastFix = toFix(pos);
  lastError = null;
  // Un solo temporizador (no lee el GPS): solo repinta el indicador cuando la posición caduca.
  clearTimeout(staleTimer);
  staleTimer = setTimeout(emit, FRESH_MS + 100);
  return lastFix;
};

/**
 * Una sola lectura al cargar la página (Safari pide el permiso aquí). En cuanto hay posición se deja
 * de leer. Al volver a la pestaña se relee solo si la posición ya caducó; recargar la página también relee.
 */
export function startGps() {
  readPosition();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) warmUpPosition();
  });
}

/**
 * Lectura puntual del GPS. Devuelve null (nunca lanza) si no hay permiso, señal o contexto seguro
 * (https). El motivo del fallo queda en `lastGpsError()`.
 */
export function readPosition() {
  if (pending) return pending;
  pending = new Promise((resolve) => {
    if (!navigator.geolocation) {
      lastError = 'unavailable';
      return resolve(null);
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(gotFix(pos)),
      (err) => {
        lastError = toError(err);
        resolve(null);
      },
      { ...GPS_OPTIONS, timeout: 8000 }
    );
  }).finally(() => {
    pending = null;
    emit();
  });
  emit();
  return pending;
}

export const lastGpsError = () => lastError;

/** Última posición si es reciente. Permite abrir WhatsApp sin esperar (ver `sendWhatsAppAlert`). */
export const freshPosition = () => (lastFix && Date.now() - lastFix.at < FRESH_MS ? lastFix : null);

/** Relee el GPS solo si la posición guardada caducó (o no existe). Una lectura, no un seguimiento. */
export function warmUpPosition() {
  if (!freshPosition()) readPosition();
}

/** Formato documentado de Google Maps (Maps URLs): abre un pin en esas coordenadas. */
export const mapsLink = (lat, lng) =>
  `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)}%2C${lng.toFixed(6)}`;

/** Texto del mensaje. Sin posición, igual avisa para no perder tiempo en una emergencia. */
export function buildAlertMessage(position, now = new Date()) {
  const lines = ['🚨 NECESITO AYUDA'];
  if (position) {
    lines.push(`📍 ${mapsLink(position.lat, position.lng)}`);
    const tile = gpsToPixel(position.lat, position.lng);
    if (tile.insideBounds) lines.push(`📌 ${detectSectorName(tile.pixelX, tile.pixelY)}`);
    const hour = now.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    lines.push(position.accuracy ? `Precisión: ±${position.accuracy} m · ${hour}` : hour);
  } else {
    lines.push('⚠️ No pude obtener mi ubicación GPS.');
  }
  return lines.join('\n');
}

/** Mensaje para compartir un punto del mapa (sin pedir ayuda): sector + enlace de Google Maps. */
export function buildPointMessage(point, sector) {
  const lines = ['📍 Ubicación compartida'];
  if (sector) lines.push(sector);
  lines.push(mapsLink(point.lat, point.lng));
  return lines.join('\n');
}

/** wa.me sin número: WhatsApp abre el selector de chats con el texto listo. */
export const whatsappUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/**
 * Lee el GPS y abre WhatsApp. Devuelve { gps: boolean } para que la interfaz avise
 * cuando se abrió sin ubicación. `open` se puede reemplazar en pruebas para no navegar.
 */
export function sharePoint(point, sector, open = (url) => window.location.assign(url)) {
  const url = whatsappUrl(buildPointMessage(point, sector));
  open(url);
  return { url };
}

/**
 * Abre WhatsApp con la alerta. iOS Safari solo abre la app si la navegación ocurre dentro del
 * toque de la persona: con una posición reciente en caché se navega al instante (síncrono);
 * si no la hay, se espera el GPS y se abre igual (mejor esfuerzo).
 */
export async function sendWhatsAppAlert(open = (url) => window.location.assign(url)) {
  const position = freshPosition() || (await readPosition());
  const url = whatsappUrl(buildAlertMessage(position));
  open(url);
  return { gps: Boolean(position), url, error: position ? null : lastError };
}
