/**
 * Compartir por WhatsApp. No toca el mapa, la selección ni los incidentes: arma un mensaje y abre WhatsApp
 * con el texto ya escrito. La persona elige el chat y pulsa enviar, así que nada se publica solo.
 */

/** Formato documentado de Google Maps (Maps URLs): abre un pin en esas coordenadas. */
export const mapsLink = (lat, lng) =>
  `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)}%2C${lng.toFixed(6)}`;

/** wa.me sin número: WhatsApp abre el selector de chats con el texto listo. */
export const whatsappUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** Texto de la alerta. Sin posición igual avisa, para no perder tiempo en una emergencia. */
export function buildAlertMessage(position, { sector = null, now = new Date() } = {}) {
  const lines = ['🚨 NECESITO AYUDA'];
  if (position) {
    lines.push(`📍 ${mapsLink(position.lat, position.lng)}`);
    if (sector) lines.push(`📌 ${sector}`);
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

/**
 * `gps`: servicio de gps.js · `sectorAt(lat, lng)`: nombre del sector o null si está fuera del mapa ·
 * `open(url)`: cómo navegar (se reemplaza en pruebas).
 */
export function createWhatsApp({ gps, sectorAt = () => null, open = (url) => window.location.assign(url) }) {
  return {
    /**
     * Abre WhatsApp con la alerta. iOS Safari solo abre la app si la navegación ocurre dentro del toque:
     * con una posición reciente se navega en el acto (síncrono, antes de cualquier `await`); si no la hay,
     * se espera el GPS y se abre igual (mejor esfuerzo).
     */
    async sendAlert() {
      const position = gps.fix() || (await gps.read());
      const sector = position ? sectorAt(position.lat, position.lng) : null;
      const url = whatsappUrl(buildAlertMessage(position, { sector }));
      open(url);
      return { located: Boolean(position), url, error: position ? null : gps.error() };
    },

    sharePoint(point, sector) {
      const url = whatsappUrl(buildPointMessage(point, sector));
      open(url);
      return { url };
    }
  };
}
