import { gpsToPixel } from '../map/gpsGrid.js';
import { detectSectorName } from '../map/mapData.js';

/**
 * Alerta rápida por WhatsApp. No toca el mapa, la selección ni los incidentes:
 * lee el GPS del teléfono, arma un mensaje y abre WhatsApp con el texto ya escrito.
 * La persona elige el grupo y pulsa enviar, así que nada se publica solo.
 */

const GPS_OPTIONS = { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 };

/** Lee el GPS. Devuelve null (nunca lanza) si no hay permiso, señal o contexto seguro (https). */
export function readPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null
        }),
      () => resolve(null),
      GPS_OPTIONS
    );
  });
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

export async function sendWhatsAppAlert(open = (url) => window.location.assign(url)) {
  const position = await readPosition();
  const url = whatsappUrl(buildAlertMessage(position));
  open(url);
  return { gps: Boolean(position), url };
}
